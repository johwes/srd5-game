import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  type CharacterBuildState,
  type SrdCompendium,
  defaultCompendium,
} from '@srd5/data';
import {
  type DiceRollRecord,
  type GameCommand,
  type GameEvent,
  type GameState,
  type GridPoint,
  findPath,
  planAiTurn,
  reduceGame,
} from '@srd5/engine';
import { LocalTransport, type PlayerViewState } from '@srd5/transport';
import { TacticalCanvasViewport } from '../../canvas/index.js';
import { TacticalCombatHud } from '../combat/index.js';
import {
  applyArenaBreather,
  buildArenaPveEncounter,
  buildArenaPvpEncounter,
  evaluateArenaOutcome,
  spawnNextWave,
} from './arenaEngine.js';
import type { ArenaConfig } from './types.js';

export interface ArenaCombatViewProps {
  config: ArenaConfig;
  partyCharacters?: CharacterBuildState[];
  compendium?: SrdCompendium;
  onExitToSetup: () => void;
  onOpenCharacterSheet?: (characterId: string) => void;
}

export function ArenaCombatView({
  config,
  partyCharacters = [],
  compendium = defaultCompendium,
  onExitToSetup,
  onOpenCharacterSheet,
}: ArenaCombatViewProps) {
  const [transport, setTransport] = useState<LocalTransport>(() => {
    if (config.mode === 'pvp_duel') {
      return buildArenaPvpEncounter(config, compendium).transport;
    }
    return buildArenaPveEncounter(config, partyCharacters, 1, compendium).transport;
  });

  const [viewState, setViewState] = useState<PlayerViewState>(() =>
    transport.getPlayerViewState(),
  );
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [activeRoll, setActiveRoll] = useState<DiceRollRecord | null>(null);
  const [rollHistory, setRollHistory] = useState<DiceRollRecord[]>([]);

  const [currentWave, setCurrentWave] = useState(1);
  const [monstersDefeated, setMonstersDefeated] = useState(0);
  const [score, setScore] = useState(0);

  const [selectedCombatantId, setSelectedCombatantId] = useState<string | null>(
    null,
  );
  const [hoveredCell, setHoveredCell] = useState<GridPoint | null>(null);

  // Match progression modals
  const [showBreatherModal, setShowBreatherModal] = useState(false);
  const [showMatchEndModal, setShowMatchEndModal] = useState(false);
  const [matchOutcome, setMatchOutcome] = useState<{
    status: 'in_progress' | 'victory' | 'defeat' | 'wave_cleared' | 'draw';
    winnerTeamId?: string;
    winnerName?: string;
  }>({ status: 'in_progress' });

  // AI automation for PvE
  const [autoAiTurn, setAutoAiTurn] = useState(true);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const aiTurnTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Subscribe to transport state changes
  useEffect(() => {
    let active = true;
    void transport.connect().then(() => {
      if (active) {
        setViewState(transport.getPlayerViewState());
      }
    });

    const unsubscribe = transport.subscribe((nextView, nextEvents) => {
      setViewState(nextView);
      setEvents((prev) => [...prev, ...nextEvents]);

      // Inspect any newly emitted dice rolls
      for (const ev of nextEvents) {
        if (ev.type === 'DICE_ROLLED') {
          const r: DiceRollRecord = {
            formula: ev.notation,
            resolvedNotation: ev.notation,
            mode: ev.mode,
            diceGroups: [
              {
                notation: ev.notation,
                count: ev.rolls.length,
                faces: 20,
                dice: ev.rolls.map((val) => ({
                  faces: 20,
                  value: val,
                  initialRoll: val,
                  history: [val],
                  kept: ev.kept.includes(val),
                  rerolled: false,
                })),
                rolls: ev.rolls,
                kept: ev.kept,
                dropped: ev.rolls.filter((v) => !ev.kept.includes(v)),
                subtotal: ev.kept.reduce((a, b) => a + b, 0),
              },
            ],
            rolls: ev.rolls,
            kept: ev.kept,
            rerolledInitialRolls: [],
            modifier: ev.modifier,
            total: ev.total,
            naturalRoll: ev.rolls[0],
          };
          setActiveRoll(r);
          setRollHistory((prev) => [r, ...prev.slice(0, 49)]);
        }
      }

      // Evaluate victory / defeat / wave cleared outcome
      const outcome = evaluateArenaOutcome(
        nextView,
        config.mode,
        config.pvpSettings,
      );

      if (outcome.status === 'wave_cleared') {
        setMatchOutcome(outcome);
        setShowBreatherModal(true);
      } else if (
        outcome.status === 'victory' ||
        outcome.status === 'defeat' ||
        outcome.status === 'draw'
      ) {
        setMatchOutcome(outcome);
        setShowMatchEndModal(true);
      }
    });

    return () => {
      active = false;
      unsubscribe();
      if (aiTurnTimeoutRef.current) {
        clearTimeout(aiTurnTimeoutRef.current);
      }
    };
  }, [transport, config]);

  const combat = viewState.combat;
  const activeCombatantId = combat?.activeCombatantId ?? null;
  const activeCombatant = activeCombatantId
    ? viewState.combatants[activeCombatantId] ?? null
    : null;

  // Determine active combatant allegiance & player control
  const isPvp = config.mode === 'pvp_duel';
  const activeTeamId = activeCombatant?.teamId ?? activeCombatant?.side ?? 'party';

  const isMonsterTurn =
    !isPvp && Boolean(activeCombatant && activeCombatant.side === 'monster');

  const isPlayerControlled = isPvp ? true : !isMonsterTurn;

  // Dispatch a command through the transport
  const handleDispatch = useCallback(
    async (command: GameCommand) => {
      try {
        await transport.dispatch(command);
      } catch (err) {
        console.error('Error dispatching Arena command:', err);
      }
    },
    [transport],
  );

  // AI monster turn execution
  const executeAiMonsterTurn = useCallback(async () => {
    if (!activeCombatant || !activeCombatantId || !isMonsterTurn || isAiThinking) {
      return;
    }

    setIsAiThinking(true);
    try {
      const authState = transport.getAuthoritativeState();
      if (!authState.combat) return;

      const plan = planAiTurn({
        state: authState.combat,
        activeCombatantId,
        grid: authState.grid,
      });

      for (const cmd of plan.commands) {
        await transport.dispatch(cmd);
      }
    } catch (err) {
      console.error('Error executing AI monster turn:', err);
      // Fallback: force end turn if AI encounters an unexpected issue
      await transport.dispatch({ type: 'END_TURN', actorId: activeCombatantId });
    } finally {
      setIsAiThinking(false);
    }
  }, [activeCombatant, activeCombatantId, isMonsterTurn, isAiThinking, transport]);

  // Trigger automatic AI turn if enabled
  useEffect(() => {
    if (
      isMonsterTurn &&
      autoAiTurn &&
      !isAiThinking &&
      !showBreatherModal &&
      !showMatchEndModal
    ) {
      aiTurnTimeoutRef.current = setTimeout(() => {
        void executeAiMonsterTurn();
      }, 500);
    }
    return () => {
      if (aiTurnTimeoutRef.current) {
        clearTimeout(aiTurnTimeoutRef.current);
      }
    };
  }, [
    isMonsterTurn,
    autoAiTurn,
    isAiThinking,
    showBreatherModal,
    showMatchEndModal,
    executeAiMonsterTurn,
  ]);

  // Canvas cell click handler (movement or target selection)
  const handleCellClick = async (cell: GridPoint) => {
    if (!activeCombatant || !isPlayerControlled || isMonsterTurn) {
      return;
    }

    // If active combatant is selected and clicking an adjacent or pathable cell, dispatch COMBAT_MOVE
    const startPt = activeCombatant.position;
    if (startPt.x === cell.x && startPt.y === cell.y) {
      return;
    }

    const authState = transport.getAuthoritativeState();
    const allLivingCombatants = [
      ...Object.values(authState.party),
      ...Object.values(authState.monsters),
    ];

    const mover = {
      id: activeCombatant.id,
      x: activeCombatant.position.x,
      y: activeCombatant.position.y,
      size: activeCombatant.size,
      speedFeet: combat?.turnBudget?.movementRemainingFeet ?? 30,
    };

    const creatures = allLivingCombatants
      .filter((c) => c.id !== activeCombatant.id && !c.isDead && c.currentHp > 0)
      .map((c) => ({
        id: c.id,
        x: c.position.x,
        y: c.position.y,
        size: c.size,
        faction: ((c.teamId ?? c.side) === (activeCombatant.teamId ?? activeCombatant.side)
          ? 'party'
          : 'enemy') as 'party' | 'enemy',
        isHostile:
          (c.teamId ?? c.side) !== (activeCombatant.teamId ?? activeCombatant.side),
      }));

    const pathResult = findPath({
      grid: authState.grid,
      mover,
      goal: cell,
      creatures,
      movementRemainingFeet: combat?.turnBudget?.movementRemainingFeet ?? 30,
    });

    if (pathResult.found && pathResult.path.length > 1) {
      await handleDispatch({
        type: 'COMBAT_MOVE',
        actorId: activeCombatant.id,
        path: pathResult.path,
      });
    }
  };

  // Next wave launcher from breather modal
  const handleStartNextWave = (withBreatherRest: boolean) => {
    setShowBreatherModal(false);
    let nextState = transport.getAuthoritativeState();

    if (withBreatherRest) {
      nextState = applyArenaBreather(nextState);
    }

    const nextWaveNum = currentWave + 1;
    setCurrentWave(nextWaveNum);
    setMonstersDefeated((prev) => prev + 3);
    setScore((prev) => prev + currentWave * 500 + (withBreatherRest ? 200 : 500));

    const spawnedState = spawnNextWave(
      nextState,
      nextWaveNum,
      config,
      compendium,
    );

    const freshTransport = new LocalTransport({
      initialState: spawnedState,
      defaultPlayerId: 'player-1',
    });
    setTransport(freshTransport);
  };

  // Rematch restart handler
  const handleRematch = () => {
    setShowMatchEndModal(false);
    setCurrentWave(1);
    setMonstersDefeated(0);
    setScore(0);
    setEvents([]);
    setActiveRoll(null);
    setRollHistory([]);

    const freshTransport = isPvp
      ? buildArenaPvpEncounter(config, compendium).transport
      : buildArenaPveEncounter(config, partyCharacters, 1, compendium).transport;

    setTransport(freshTransport);
  };

  return (
    <div
      data-testid="arena-combat-view"
      className="relative w-full h-[calc(100vh-140px)] min-h-[640px] flex flex-col bg-slate-950 overflow-hidden rounded-xl border border-slate-800"
    >
      {/* Top Arena Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 bg-slate-900/90 border-b border-slate-800 z-10">
        <div className="flex items-center gap-3">
          <button
            type="button"
            data-testid="arena-exit-button"
            onClick={onExitToSetup}
            className="px-2.5 py-1 text-xs font-semibold rounded-md border border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
          >
            &larr; Exit Arena
          </button>

          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-amber-400">
              {config.name}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full font-bold uppercase bg-slate-800 text-slate-300 border border-slate-700">
              {config.mode === 'pvp_duel'
                ? '1v1 PvP Duel'
                : config.mode === 'endless_waves'
                ? `Wave ${currentWave}`
                : 'Custom Skirmish'}
            </span>
          </div>
        </div>

        {/* Dynamic Mode Turn & Metric Indicators */}
        <div className="flex items-center gap-4">
          {isPvp ? (
            <div
              data-testid="pvp-turn-indicator"
              className={`px-3 py-1 rounded-full text-xs font-bold border flex items-center gap-1.5 transition-colors ${
                activeTeamId === 'team_red'
                  ? 'bg-red-950/80 border-red-600 text-red-300'
                  : 'bg-blue-950/80 border-blue-600 text-blue-300'
              }`}
            >
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{
                  backgroundColor:
                    activeTeamId === 'team_red'
                      ? config.pvpSettings?.teamA.color ?? '#ef4444'
                      : config.pvpSettings?.teamB.color ?? '#3b82f6',
                }}
              />
              <span>
                {activeTeamId === 'team_red'
                  ? `${config.pvpSettings?.teamA.teamName ?? 'Team Red'}'s Turn (Player 1)`
                  : `${config.pvpSettings?.teamB.teamName ?? 'Team Blue'}'s Turn (Player 2)`}
              </span>
            </div>
          ) : (
            <>
              {config.mode === 'endless_waves' && (
                <div className="text-xs text-slate-400 flex items-center gap-3">
                  <span>
                    Score:{' '}
                    <strong className="text-amber-400 font-mono">
                      {score}
                    </strong>
                  </span>
                  <span>
                    Slain:{' '}
                    <strong className="text-slate-200 font-mono">
                      {monstersDefeated}
                    </strong>
                  </span>
                </div>
              )}

              {isMonsterTurn && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-rose-400 font-medium animate-pulse">
                    Monster AI is acting...
                  </span>
                  <button
                    type="button"
                    data-testid="step-ai-turn-button"
                    disabled={isAiThinking}
                    onClick={() => void executeAiMonsterTurn()}
                    className="px-2 py-0.5 text-xs font-semibold rounded bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50"
                  >
                    Step AI Turn
                  </button>
                  <label className="text-[11px] text-slate-400 flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      data-testid="auto-ai-toggle"
                      checked={autoAiTurn}
                      onChange={(e) => setAutoAiTurn(e.target.checked)}
                      className="rounded bg-slate-800 border-slate-700 text-amber-500 focus:ring-0"
                    />
                    Auto
                  </label>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Main HUD & PixiJS Tactical Canvas */}
      <div className="relative flex-1 w-full h-full">
        <TacticalCombatHud
          viewState={viewState}
          compendium={compendium}
          selectedCombatantId={selectedCombatantId}
          isPlayerControlled={isPlayerControlled}
          events={events}
          activeRoll={activeRoll}
          rollHistory={rollHistory}
          title={config.name}
          subtitle={
            isPvp
              ? activeTeamId === 'team_red'
                ? `${config.pvpSettings?.teamA.teamName} (Player 1)`
                : `${config.pvpSettings?.teamB.teamName} (Player 2)`
              : config.mode === 'endless_waves'
              ? `Endless Wave ${currentWave} &middot; Score ${score}`
              : `Skirmish &middot; Tier: ${config.pveSettings?.difficultyTier ?? 'medium'}`
          }
          onSelectCombatant={(id) => setSelectedCombatantId(id)}
          onOpenCharacterSheet={onOpenCharacterSheet}
          onDeclareAttack={(weapon, opts) => {
            if (!activeCombatantId) return;
            // Target first conscious enemy
            const target = Object.values(viewState.combatants).find(
              (c) =>
                (c.teamId ?? c.side) !== activeTeamId &&
                !c.isDead &&
                c.currentHp > 0,
            );
            if (target) {
              void handleDispatch({
                type: 'DECLARE_ATTACK',
                actorId: activeCombatantId,
                targetId: target.id,
                attackProfileId: weapon.id,
                weaponInstanceId: weapon.weaponId,
                isOffHand: opts?.isOffHand,
                twoHanded: opts?.twoHanded,
              });
            }
          }}
          onCastSpell={(spellId, slotLevel) => {
            if (!activeCombatantId) return;
            const target = Object.values(viewState.combatants).find(
              (c) =>
                (c.teamId ?? c.side) !== activeTeamId &&
                !c.isDead &&
                c.currentHp > 0,
            );
            void handleDispatch({
              type: 'DECLARE_CAST_SPELL',
              actorId: activeCombatantId,
              spellId,
              slotLevel,
              targetIds: target ? [target.id] : [],
            });
          }}
          onUseClassFeature={(featureId, optionId) => {
            if (!activeCombatantId) return;
            void handleDispatch({
              type: 'USE_CLASS_FEATURE',
              actorId: activeCombatantId,
              featureId,
              optionId,
            });
          }}
          onStandardAction={(action) => {
            if (!activeCombatantId) return;
            void handleDispatch({
              type: 'USE_STANDARD_ACTION',
              actorId: activeCombatantId,
              action,
            });
          }}
          onUseItem={(itemId) => {
            if (!activeCombatantId) return;
            void handleDispatch({
              type: 'USE_ITEM',
              actorId: activeCombatantId,
              itemInstanceId: itemId,
            });
          }}
          onEndTurn={() => {
            if (!activeCombatantId) return;
            void handleDispatch({
              type: 'END_TURN',
              actorId: activeCombatantId,
            });
          }}
          onResolveReaction={(decision) => {
            const pending = combat?.pendingReactionPrompt;
            if (!pending) return;
            void handleDispatch({
              type: 'RESOLVE_REACTION_PROMPT',
              promptId: pending.promptId,
              reactorId: pending.reactorEntityId,
              decision,
            });
          }}
        >
          <TacticalCanvasViewport
            grid={viewState.grid}
            combatants={viewState.combatants}
            selectedCombatantId={selectedCombatantId}
            activeCombatantId={activeCombatantId}
            hoveredCell={hoveredCell}
            onCellHover={(pt) => setHoveredCell(pt)}
            onCellClick={(pt) => void handleCellClick(pt)}
            onCombatantClick={(combatantId) => setSelectedCombatantId(combatantId)}
            enableHoverPathPreview={true}
            showTokenHpArcs={true}
            showConditionBadges={true}
            showTokenNames={true}
          />
        </TacticalCombatHud>
      </div>

      {/* Breather Rest Modal between Waves */}
      {showBreatherModal && (
        <div
          data-testid="arena-breather-modal"
          className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        >
          <div className="max-w-md w-full bg-slate-900 border border-amber-500/50 rounded-2xl p-6 shadow-2xl text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-3xl">
              🏕️
            </div>

            <div>
              <h3 className="text-xl font-bold text-amber-400">
                Wave {currentWave} Cleared!
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                The battlefield falls quiet for a brief moment. You can take a
                breather to recover hit points and spell slots before the next wave arrives.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 text-xs text-left space-y-1">
              <div className="flex justify-between text-slate-300">
                <span>Waves Survived:</span>
                <span className="font-bold text-white">{currentWave}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Monsters Slain:</span>
                <span className="font-bold text-white">{monstersDefeated}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Current Score:</span>
                <span className="font-bold text-amber-400 font-mono">
                  {score}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <button
                type="button"
                data-testid="start-next-wave-button"
                onClick={() => handleStartNextWave(true)}
                className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 transition-all"
              >
                Take Short Rest &amp; Begin Wave {currentWave + 1}
              </button>
              <button
                type="button"
                onClick={() => handleStartNextWave(false)}
                className="w-full py-2 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
              >
                Skip Breather (+300 Bonus Score)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Match Complete Victory / Defeat Modal */}
      {showMatchEndModal && (
        <div
          data-testid="arena-match-end-modal"
          className="absolute inset-0 bg-slate-950/90 backdrop-blur-md z-50 flex items-center justify-center p-4"
        >
          <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-slate-800 flex items-center justify-center text-3xl">
              {matchOutcome.status === 'victory'
                ? '🏆'
                : matchOutcome.status === 'defeat'
                ? '💀'
                : '⚖️'}
            </div>

            <div>
              <h3
                data-testid="arena-match-outcome-title"
                className={`text-2xl font-black tracking-tight ${
                  matchOutcome.status === 'victory'
                    ? 'text-amber-400'
                    : matchOutcome.status === 'defeat'
                    ? 'text-rose-500'
                    : 'text-slate-300'
                }`}
              >
                {isPvp
                  ? `${matchOutcome.winnerName ?? 'Champion'} Triumphs!`
                  : matchOutcome.status === 'victory'
                  ? 'Encounter Victory!'
                  : 'Party Defeated!'}
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                {isPvp
                  ? `Gladiatorial duel concluded. The opposing party has been vanquished.`
                  : matchOutcome.status === 'victory'
                  ? 'All hostile creatures on the battlefield have been slain.'
                  : 'Your heroes were overwhelmed in the arena.'}
              </p>
            </div>

            {!isPvp && (
              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 text-xs text-left space-y-1">
                <div className="flex justify-between text-slate-300">
                  <span>Waves Cleared:</span>
                  <span className="font-bold text-white">{currentWave}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>Monsters Defeated:</span>
                  <span className="font-bold text-white">{monstersDefeated}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>Final Score:</span>
                  <span className="font-bold text-amber-400 font-mono">
                    {score}
                  </span>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2 pt-2">
              <button
                type="button"
                data-testid="arena-rematch-button"
                onClick={handleRematch}
                className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 transition-all"
              >
                Rematch
              </button>
              <button
                type="button"
                data-testid="arena-return-setup-button"
                onClick={onExitToSetup}
                className="w-full py-2 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
              >
                Return to Arena Setup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
