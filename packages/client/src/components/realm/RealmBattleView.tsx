import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { SrdCompendium } from '@srd5/data';
import { defaultCompendium } from '@srd5/data';
import {
  type DiceRollRecord,
  type GameCommand,
  type GameEvent,
  type GameState,
  type GeneratedOverworldBattle,
  type GridPoint,
  findPath,
  getFootprintDistanceFeet,
  planAiTurn,
  truncatePathToBudget,
} from '@srd5/engine';
import { LocalTransport, type PlayerViewState } from '@srd5/transport';
import { TacticalCanvasViewport } from '../../canvas/index.js';
import { TacticalCombatHud } from '../combat/index.js';
import { resolveSpellTargets } from '../../utils/combatTargeting.js';

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
}

export function RealmBattleView({
  transport,
  battle,
  title,
  subtitle,
  compendium = defaultCompendium,
  onBattleEnd,
  onOpenCharacterSheet,
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
      const auth = transport.getAuthoritativeState();
      if (!battleEndedRef.current && auth.combat?.phase === 'combat_ended') {
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
  }, [transport]);

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
        await transport.dispatch(cmd);
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

  // Combat movement on cell click.
  const handleCellClick = async (cell: GridPoint) => {
    if (viewState.mode !== 'combat' || !activeCombatant || activeCombatant.side === 'monster') {
      return;
    }
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
        onSelectCombatant={(id) => setSelectedCombatantId(id)}
        onOpenCharacterSheet={onOpenCharacterSheet}
        onDeclareAttack={(weapon, opts) => {
          if (!activeCombatantId || !activeCombatant) return;
          const selectedCandidate = selectedCombatantId
            ? viewState.combatants[selectedCombatantId]
            : null;
          const isSelectedHostile = Boolean(
            selectedCandidate &&
              selectedCandidate.side !== activeCombatant.side &&
              !selectedCandidate.isDead &&
              selectedCandidate.currentHp > 0,
          );
          const livingHostiles = Object.values(viewState.combatants).filter(
            (c) =>
              c.side !== activeCombatant.side && !c.isDead && c.currentHp > 0,
          );
          if (livingHostiles.length === 0) {
            showFeedback('No conscious enemies remaining.');
            return;
          }
          const reachOrRange =
            weapon.rangeType === 'ranged'
              ? (weapon.rangeFeet?.long ?? weapon.rangeFeet?.normal ?? 120)
              : (weapon.reachFeet ?? 5);

          let target: (typeof livingHostiles)[0] | null = null;
          if (isSelectedHostile && selectedCandidate) {
            const dist = getFootprintDistanceFeet(
              activeCombatant.position,
              activeCombatant.size,
              selectedCandidate.position,
              selectedCandidate.size,
            );
            if (dist <= reachOrRange) {
              target = selectedCandidate;
            } else {
              target =
                livingHostiles.find(
                  (h) =>
                    getFootprintDistanceFeet(
                      activeCombatant.position,
                      activeCombatant.size,
                      h.position,
                      h.size,
                    ) <= reachOrRange,
                ) ?? null;
              if (!target) {
                showFeedback(
                  `Target "${selectedCandidate.name}" is out of reach (${dist}ft > ${reachOrRange}ft). Move closer to attack!`,
                );
                return;
              }
            }
          } else {
            const sorted = livingHostiles
              .map((h) => ({
                enemy: h,
                dist: getFootprintDistanceFeet(
                  activeCombatant.position,
                  activeCombatant.size,
                  h.position,
                  h.size,
                ),
              }))
              .sort((a, b) => a.dist - b.dist);
            const closest = sorted[0]!;
            if (closest.dist <= reachOrRange) {
              target = closest.enemy;
            } else {
              showFeedback(
                `Nearest enemy is out of reach (${closest.dist}ft > ${reachOrRange}ft). Move closer to attack!`,
              );
              return;
            }
          }

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
          if (!activeCombatantId || !activeCombatant) return;
          const spell = compendium.getSpell(spellId);
          if (!spell) return;
          const authState = transport.getAuthoritativeState();
          const targetResult = resolveSpellTargets({
            spell,
            slotLevel,
            caster: activeCombatant,
            combatants: viewState.combatants,
            selectedCombatantId,
            dispositionMatrix: authState.combat?.dispositionMatrix,
          });
          if (targetResult.errorFeedback) {
            showFeedback(targetResult.errorFeedback);
            return;
          }
          void handleDispatch({
            type: 'DECLARE_CAST_SPELL',
            actorId: activeCombatantId,
            spellId,
            slotLevel,
            targetIds: targetResult.targetIds,
            targetCell: targetResult.primaryTarget
              ? targetResult.primaryTarget.position
              : activeCombatant.position,
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
          onCombatantClick={(combatantId) => setSelectedCombatantId(combatantId)}
          enableHoverPathPreview={true}
          enableFogOfWar={true}
          showTokenHpArcs={true}
          showConditionBadges={true}
          showTokenNames={true}
          hazardZones={viewState.combat?.hazardZones ?? []}
          events={events}
          className="w-full h-full"
        />
      </TacticalCombatHud>
    </div>
  );
}
