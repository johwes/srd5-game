import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { SrdCompendium } from '@srd5/data';
import { defaultCompendium } from '@srd5/data';
import {
  type Combatant,
  type DiceRollRecord,
  type GameCommand,
  type GameEvent,
  type GameState,
  type GeneratedOverworldBattle,
  type GridPoint,
  type WaveReinforcementSpec,
  findPath,
  getDueReinforcementWaves,
  planAiTurn,
  truncatePathToBudget,
} from '@srd5/engine';
import { LocalTransport, type PlayerViewState } from '@srd5/transport';
import { TacticalCanvasViewport } from '../../canvas/index.js';
import { useEscHandler, ESC_PRIORITY } from '../../hooks/useEscStack.js';
import { TacticalCombatHud, TargetingCommitBar, buildCastSpellContext, useManualTargeting } from '../combat/index.js';

/**
 * Tactical battle view for Realm encounters (SRD-805, Spec 06 Section 4.2).
 *
 * Wraps the standard engine combat loop (LocalTransport + reduceGame + AI
 * planner) around a `startOverworldBattle` GameState. When combat ends, the
 * authoritative state is handed back to the Realm view, which commits XP,
 * gold, HP and quest progress via `resolveRealmBattle`.
 */

export type RealmBattleOutcome = 'victory' | 'defeat';

export interface RealmBattleViewProps {
  transport: LocalTransport;
  battle: GeneratedOverworldBattle;
  title: string;
  subtitle?: string;
  compendium?: SrdCompendium;
  onBattleEnd: (outcome: RealmBattleOutcome, gameState: GameState) => void;
  onOpenCharacterSheet?: (characterId: string) => void;
  /** Timed wave schedule for war-mission defenses (SRD-1102/1105, Spec 10 §4.2). */
  waves?: WaveReinforcementSpec[];
  /** Scheduled (not yet spawned) reinforcements deployed on their `deployRound`. */
  reinforcementQueue?: Combatant[];
}

/** Derives the scheduled wave number from a reinforcement combatant id. */
export function getReinforcementWaveNumber(combatantId: string): number | null {
  const waveMatch = combatantId.match(/_wave(\d+)/) ?? combatantId.match(/_w(\d+)_/);
  if (!waveMatch) return null;
  const parsed = Number.parseInt(waveMatch[1]!, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function RealmBattleView({
  transport,
  battle,
  title,
  subtitle,
  compendium = defaultCompendium,
  onBattleEnd,
  onOpenCharacterSheet,
  waves = [],
  reinforcementQueue = [],
}: RealmBattleViewProps) {
  const [viewState, setViewState] = useState<PlayerViewState>(() =>
    transport.getPlayerViewState(),
  );
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [activeRoll, setActiveRoll] = useState<DiceRollRecord | null>(null);
  const [rollHistory, setRollHistory] = useState<DiceRollRecord[]>([]);
  const [hoveredCell, setHoveredCell] = useState<GridPoint | null>(null);
  const [selectedCombatantId, setSelectedCombatantId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [isAiThinking, setIsAiThinking] = useState(false);

  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiTurnTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const battleEndedRef = useRef(false);
  const onBattleEndRef = useRef(onBattleEnd);
  onBattleEndRef.current = onBattleEnd;

  const showFeedback = useCallback((msg: string) => {
    setActionFeedback(msg);
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    feedbackTimeoutRef.current = setTimeout(() => setActionFeedback(null), 3500);
  }, []);

  // --- Multi-wave reinforcements (SRD-1102/1105, Spec 10 §4.2) ---
  const wavesRef = useRef(waves);
  wavesRef.current = waves;
  const queueRef = useRef(reinforcementQueue);
  queueRef.current = reinforcementQueue;
  const spawnedWavesRef = useRef<Set<number>>(new Set());
  const spawningWavesRef = useRef<Set<number>>(new Set());
  const battleIdRef = useRef(battle.battleId);
  if (battleIdRef.current !== battle.battleId) {
    battleIdRef.current = battle.battleId;
    spawnedWavesRef.current = new Set();
    spawningWavesRef.current = new Set();
  }

  /** Combatant ids from the queue not yet present in the live combat. */
  const getUnspawned = useCallback((auth: GameState): Combatant[] => {
    const live = auth.combat?.combatants ?? {};
    return queueRef.current.filter((c) => !live[c.id]);
  }, []);

  const spawnWave = useCallback(
    async (waveNum: number, members: Combatant[]) => {
      if (members.length === 0 || spawningWavesRef.current.has(waveNum)) return;
      spawningWavesRef.current.add(waveNum);
      try {
        await transport.dispatch({
          type: 'SPAWN_REINFORCEMENTS',
          combatants: members,
          wave: waveNum,
        });
        spawnedWavesRef.current.add(waveNum);
        const edge = wavesRef.current.find((w) => w.wave === waveNum)?.spawnEdge ?? 'the field';
        showFeedback(`⚔️ Enemy wave ${waveNum} storms in from the ${edge}!`);
      } catch (err: unknown) {
        console.error('Error spawning war reinforcements:', err);
      } finally {
        spawningWavesRef.current.delete(waveNum);
      }
    },
    [transport, showFeedback],
  );

  /**
   * Deploys scheduled waves whose `deployRound` has arrived, or rushes the
   * next wave forward when the field is clear but reserves remain (so a fast
   * party cannot end the battle before wave 2 musters).
   */
  const maybeSpawnDueWaves = useCallback(
    (auth: GameState) => {
      const queue = queueRef.current;
      if (queue.length === 0 || !auth.combat) return;
      const unspawned = getUnspawned(auth);
      if (unspawned.length === 0) return;
      const spawned = [...spawnedWavesRef.current];

      const due = getDueReinforcementWaves(wavesRef.current, auth.combat.round, spawned);
      for (const wave of due) {
        let members = unspawned.filter((c) => getReinforcementWaveNumber(c.id) === wave.wave);
        if (members.length === 0) {
          // Fallback for queue entries without a wave-tagged id: deploy them
          // with the earliest due wave rather than stranding them.
          members = unspawned.filter((c) => getReinforcementWaveNumber(c.id) === null);
        }
        void spawnWave(wave.wave, members);
      }

      const livingEnemies = Object.values(auth.combat.combatants).filter(
        (c) => c.side === 'monster' && !c.isDead && c.currentHp > 0,
      );
      if (livingEnemies.length === 0 && auth.combat.phase !== 'combat_ended') {
        const nextWaveNum = unspawned
          .map((c) => getReinforcementWaveNumber(c.id))
          .filter((n): n is number => n !== null && !spawnedWavesRef.current.has(n))
          .sort((a, b) => a - b)[0];
        if (nextWaveNum !== undefined) {
          void spawnWave(
            nextWaveNum,
            unspawned.filter((c) => getReinforcementWaveNumber(c.id) === nextWaveNum),
          );
        }
      }
    },
    [getUnspawned, spawnWave],
  );

  // Subscribe to the authoritative combat transport.
  useEffect(() => {
    battleEndedRef.current = false;
    let active = true;
    void transport.connect().then(() => {
      if (active) setViewState(transport.getPlayerViewState());
    });

    const unsubscribe = transport.subscribe((nextView, nextEvents) => {
      setViewState(nextView);
      setEvents((prev) => [...prev, ...nextEvents]);

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

      // Battle end detection: hand the authoritative state back to the Realm.
      // Scheduled reserves muster first — a cleared field with unspawned
      // waves rushes the next wave forward instead of ending the battle.
      const auth = transport.getAuthoritativeState();
      maybeSpawnDueWaves(auth);
      const reservesRemain =
        queueRef.current.length > 0 &&
        queueRef.current.some((c) => !auth.combat?.combatants[c.id]);
      if (!battleEndedRef.current && auth.combat?.phase === 'combat_ended' && !reservesRemain) {
        battleEndedRef.current = true;
        const outcome: RealmBattleOutcome =
          auth.combat.outcome === 'party_victory' ? 'victory' : 'defeat';
        onBattleEndRef.current(outcome, auth);
      }
    });

    return () => {
      active = false;
      unsubscribe();
      if (aiTurnTimeoutRef.current) clearTimeout(aiTurnTimeoutRef.current);
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    };
  }, [transport, maybeSpawnDueWaves]);

  const handleDispatch = useCallback(
    async (command: GameCommand) => {
      try {
        await transport.dispatch(command);
      } catch (err: unknown) {
        console.error('Error dispatching realm battle command:', err);
        showFeedback(err instanceof Error ? err.message : String(err));
      }
    },
    [transport, showFeedback],
  );

  const activeCombatantId = viewState.combat?.activeCombatantId ?? null;
  const activeCombatant = activeCombatantId
    ? (viewState.combatants[activeCombatantId] ?? null)
    : null;
  const isMonsterTurn =
    viewState.mode === 'combat' &&
    Boolean(activeCombatant && activeCombatant.side === 'monster');
  const hasPendingReaction = Boolean(viewState.combat?.pendingReactionPrompt);

  // SRD-410 shared manual targeting (armed pending target, token pick
  // commits, AOE origin/bearing preview, commit bar).
  const manualTargeting = useManualTargeting({
    combatants: viewState.combatants,
    activeCombatant,
    activeCombatantId,
    isMonsterTurn,
    hoveredCell,
    compendium,
    showFeedback,
    dispatch: (command) => {
      void handleDispatch(command);
    },
    getCombatContext: () => {
      const auth = transport.getAuthoritativeState();
      return {
        dispositionMatrix: auth.combat?.dispositionMatrix,
        friendlyFireEnabled: (auth as unknown as { friendlyFireEnabled?: boolean }).friendlyFireEnabled,
      };
    },
    onInspectCombatant: (id) => setSelectedCombatantId(id),
  });

  // SRD-410: Esc cancels armed targeting (turn-change reset lives in the hook).
  // Routed through the shared Escape stack so modals and the pause menu win.
  useEscHandler(
    () => {
      manualTargeting.cancelPendingTarget();
      return true;
    },
    {
      priority: ESC_PRIORITY.targeting,
      active: manualTargeting.pendingTarget.kind !== 'none',
    },
  );

  // AI monster turn execution (mirrors the dungeon combat loop).
  const executeAiMonsterTurn = useCallback(async () => {
    if (!activeCombatant || !activeCombatantId || !isMonsterTurn || isAiThinking) return;
    setIsAiThinking(true);
    try {
      const auth = transport.getAuthoritativeState();
      if (!auth.combat || auth.combat.pendingReactionPrompt) return;
      const plan = planAiTurn({
        state: auth.combat,
        activeCombatantId,
        grid: auth.grid,
      });
      for (const cmd of plan.commands) {
        if (transport.getAuthoritativeState().combat?.pendingReactionPrompt) return;
        try {
          await transport.dispatch(cmd);
        } catch (cmdErr) {
          const msg = cmdErr instanceof Error ? cmdErr.message : String(cmdErr);
          if (cmd.type === 'COMBAT_MOVE' && msg.includes('Not enough movement')) {
            console.warn('[AI] Skipping over-budget monster move, continuing plan:', msg);
            continue;
          }
          throw cmdErr;
        }
        if (transport.getAuthoritativeState().combat?.pendingReactionPrompt) return;
      }
    } catch (err) {
      console.error('Error executing realm battle AI turn:', err);
      if (!transport.getAuthoritativeState().combat?.pendingReactionPrompt && activeCombatantId) {
        try {
          await transport.dispatch({ type: 'END_TURN', actorId: activeCombatantId });
        } catch {
          // Ignore fallback dispatch failure
        }
      }
    } finally {
      setIsAiThinking(false);
    }
  }, [activeCombatant, activeCombatantId, isMonsterTurn, isAiThinking, transport]);

  useEffect(() => {
    if (isMonsterTurn && !isAiThinking && !hasPendingReaction) {
      aiTurnTimeoutRef.current = setTimeout(() => {
        void executeAiMonsterTurn();
      }, 500);
    }
    return () => {
      if (aiTurnTimeoutRef.current) clearTimeout(aiTurnTimeoutRef.current);
    };
  }, [isMonsterTurn, isAiThinking, hasPendingReaction, executeAiMonsterTurn]);

  // Combat movement on cell click. SRD-410 manual targeting consumes the
  // click while an action is armed (right-click cancels).
  const handleCellClick = async (cell: GridPoint, button?: number) => {
    if (viewState.mode !== 'combat' || !activeCombatant || activeCombatant.side === 'monster') {
      return;
    }
    if (manualTargeting.handleCombatCellClick(cell, button)) return;
    const startPt = activeCombatant.position;
    if (startPt.x === cell.x && startPt.y === cell.y) return;

    const authState = transport.getAuthoritativeState();
    const mover = {
      id: activeCombatant.id,
      x: startPt.x,
      y: startPt.y,
      size: activeCombatant.size,
      speedFeet: viewState.combat?.turnBudget?.movementRemainingFeet ?? 30,
    };
    const creatures = Object.values(authState.party)
      .concat(Object.values(authState.monsters))
      .filter((c) => c.id !== activeCombatant.id && !c.isDead && c.currentHp > 0)
      .map((c) => ({
        id: c.id,
        x: c.position.x,
        y: c.position.y,
        size: c.size,
        faction: (c.side === 'party' ? 'party' : 'enemy') as 'party' | 'enemy',
        isHostile: c.side !== activeCombatant.side,
      }));

    const movementBudget = viewState.combat?.turnBudget?.movementRemainingFeet ?? 30;
    if (movementBudget <= 0) {
      showFeedback('No movement remaining this turn.');
      return;
    }
    const pathResult = findPath({
      grid: authState.grid,
      mover,
      goal: cell,
      creatures,
      movementRemainingFeet: movementBudget,
    });
    const truncated = truncatePathToBudget(
      authState.grid,
      mover,
      pathResult,
      movementBudget,
      creatures,
    );
    if (truncated && truncated.path.length > 1) {
      await handleDispatch({
        type: 'COMBAT_MOVE',
        actorId: activeCombatant.id,
        path: truncated.path,
      });
    }
  };

  return (
    <div
      data-testid="realm-battle-container"
      className="relative w-full h-full overflow-hidden bg-slate-950"
    >
      {actionFeedback && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-red-950/95 border border-red-500 text-red-200 rounded-lg text-xs font-semibold shadow-2xl flex items-center gap-2 pointer-events-none">
          <span>⚠️</span>
          <span>{actionFeedback}</span>
        </div>
      )}

      <TacticalCombatHud
        className="w-full h-full"
        viewState={viewState}
        compendium={compendium}
        selectedCombatantId={selectedCombatantId}
        title={title}
        subtitle={subtitle ?? `Wilderness battle · ${battle.terrain}`}
        events={events}
        activeRoll={activeRoll}
        rollHistory={rollHistory}
        isPlayerControlled={!isMonsterTurn}
        onSelectCombatant={manualTargeting.handleCombatantClick}
        onOpenCharacterSheet={onOpenCharacterSheet}
        onDeclareAttack={(weapon, opts) => manualTargeting.armAttack(weapon, opts)}
        onCastSpell={(spellId, slotLevel) => manualTargeting.armSpell(spellId, slotLevel)}
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
        onUseItem={(itemInstanceId, targetId) => {
          if (!activeCombatantId) return;
          void handleDispatch({
            type: 'USE_ITEM',
            actorId: activeCombatantId,
            itemInstanceId: itemInstanceId,
            ...(targetId ?? selectedCombatantId ? { targetId: (targetId ?? selectedCombatantId)! } : {}),
          });
        }}
        onUseSummonAction={(actionId) => {
          if (!activeCombatantId) return;
          void handleDispatch({
            type: 'USE_SUMMON_ACTION',
            actorId: activeCombatantId,
            actionId,
            targetId: selectedCombatantId ?? undefined,
          });
        }}
        onDismissSummon={(summon) => {
          if (!activeCombatantId) return;
          void handleDispatch({
            type: 'DISMISS_SUMMON',
            actorId: activeCombatantId,
            summonEntityId: summon.id,
          });
        }}
        onEndTurn={() => {
          if (!activeCombatantId) return;
          void handleDispatch({ type: 'END_TURN', actorId: activeCombatantId });
        }}
        onResolveReaction={(decision) => {
          const pending = viewState.combat?.pendingReactionPrompt;
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
          onCellHover={setHoveredCell}
          onCellClick={handleCellClick}
          onCombatantClick={manualTargeting.handleCombatantClick}
          targetingMode={manualTargeting.pendingTargetingMode}
          activeAoeTemplate={manualTargeting.pendingAoeOverlay as never}
          enableHoverPathPreview={manualTargeting.pendingTarget.kind === 'none'}
          enableFogOfWar={true}
          showTokenHpArcs={true}
          showConditionBadges={true}
          showTokenNames={true}
          hazardZones={viewState.combat?.hazardZones ?? []}
          props={viewState.props ?? []}
          events={events}
          className="w-full h-full"
        />
      </TacticalCombatHud>

      {/* SRD-410 manual targeting commit bar — sibling of the HUD so it
          stacks above the docked hotbar instead of behind it. */}
      <TargetingCommitBar
        pendingTarget={manualTargeting.pendingTarget}
        pendingAoeFoes={manualTargeting.pendingAoeFoes}
        pendingAoeAllies={manualTargeting.pendingAoeAllies}
        pendingMultiNames={manualTargeting.pendingMultiNames}
        friendlyFireOff={manualTargeting.friendlyFireOff}
        onConfirmMulti={manualTargeting.handleCommitMulti}
        onConfirmAoe={manualTargeting.handleCommitAoe}
        onCancel={manualTargeting.cancelPendingTarget}
        castSpell={buildCastSpellContext(
          manualTargeting.pendingTarget,
          activeCombatant,
          compendium,
          viewState.combat?.turnBudget?.bonusActionSpellCast,
          manualTargeting.reslotSpell,
        )}
      />
    </div>
  );
}
