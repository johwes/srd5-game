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
import { computeAoeOverlay } from '../../canvas/layers/PathAndAoeLayer.js';
import {
  buildPendingTargetForAttack,
  buildPendingTargetForSpell,
  canCommitPending,
  commitAoeTarget,
  isSelfEmanation,
  needsDirectionPick,
  pendingTargetHint,
  aimRangeFeet,
  validateTargetPick,
  type PendingTarget,
} from '../../utils/pendingTargeting.js';
import { TacticalCombatHud } from '../combat/index.js';
import { resolveSpellTargets } from '../../utils/combatTargeting.js';
import { isUntargetableSummon } from '../../utils/summonPresentation.js';

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
  // SRD-410 manual targeting: hotbar action awaiting token/cell picks.
  // Replaces the old nearest-enemy auto-pick.
  const [pendingTarget, setPendingTarget] = useState<PendingTarget>({ kind: 'none' });
  const cancelPendingTarget = useCallback(() => {
    setPendingTarget({ kind: 'none' });
  }, []);
  const pendingAttackOptsRef = useRef<{ isOffHand?: boolean; twoHanded?: boolean } | null>(null);
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

  // SRD-410: clear armed targeting when the turn changes; Esc cancels it.
  useEffect(() => {
    setPendingTarget({ kind: 'none' });
    pendingAttackOptsRef.current = null;
  }, [activeCombatantId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPendingTarget((prev) => (prev.kind === 'none' ? prev : { kind: 'none' }));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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

  // SRD-410: token click handler for manual targeting picks. Targeting
  // clicks commit the armed action and must NOT change selection.
  const handleCombatantClickForTarget = useCallback(
    (combatantId: string) => {
      if (!activeCombatant || isMonsterTurn) {
        setSelectedCombatantId(combatantId);
        return;
      }
      if (pendingTarget.kind === 'none') {
        setSelectedCombatantId(combatantId);
        return;
      }
      const candidate = viewState.combatants[combatantId];
      if (!candidate) return;
      const auth = transport.getAuthoritativeState();
      const validation = validateTargetPick(
        pendingTarget,
        candidate,
        activeCombatant,
        viewState.combatants,
        { dispositionMatrix: auth.combat?.dispositionMatrix },
      );
      if (!validation.ok) {
        showFeedback(validation.error ?? 'Invalid target.');
        return;
      }
      if (pendingTarget.kind === 'single') {
        if (pendingTarget.action === 'attack') {
          const attackOpts = pendingAttackOptsRef.current ?? {};
          pendingAttackOptsRef.current = null;
          void handleDispatch({
            type: 'DECLARE_ATTACK',
            actorId: activeCombatant.id,
            targetId: combatantId,
            attackProfileId: pendingTarget.attackProfileId ?? pendingTarget.weaponId ?? '',
            weaponInstanceId: pendingTarget.weaponId,
            ...(attackOpts.isOffHand ? { isOffHand: attackOpts.isOffHand } : {}),
            ...(attackOpts.twoHanded ? { twoHanded: attackOpts.twoHanded } : {}),
          });
        } else if (pendingTarget.spellId) {
          void handleDispatch({
            type: 'DECLARE_CAST_SPELL',
            actorId: activeCombatant.id,
            spellId: pendingTarget.spellId,
            slotLevel: pendingTarget.slotLevel ?? 0,
            targetIds: [combatantId],
            targetCell: candidate.position,
          });
        }
        setPendingTarget({ kind: 'none' });
        return;
      }
      if (pendingTarget.kind === 'multi') {
        const picked = pendingTarget.picked;
        if (picked.includes(combatantId)) {
          if (pendingTarget.allowDuplicates) {
            if (picked.length >= pendingTarget.maxTargets) {
              showFeedback(`${pendingTarget.label} can target at most ${pendingTarget.maxTargets}.`);
              return;
            }
            setPendingTarget({ ...pendingTarget, picked: [...picked, combatantId] });
          } else {
            setPendingTarget({ ...pendingTarget, picked: picked.filter((id) => id !== combatantId) });
          }
        } else {
          if (picked.length >= pendingTarget.maxTargets) {
            showFeedback(`${pendingTarget.label} can target at most ${pendingTarget.maxTargets}.`);
            return;
          }
          setPendingTarget({ ...pendingTarget, picked: [...picked, combatantId] });
        }
      }
    },
    [activeCombatant, isMonsterTurn, pendingTarget, viewState.combatants, transport, handleDispatch, showFeedback],
  );

  const handleCommitMulti = useCallback(() => {
    if (pendingTarget.kind !== 'multi' || !activeCombatantId || !activeCombatant) return;
    if (!canCommitPending(pendingTarget)) {
      showFeedback(`Pick at least 1 target for ${pendingTarget.label}.`);
      return;
    }
    const spell = compendium.getSpell(pendingTarget.spellId);
    if (!spell) return;
    const auth = transport.getAuthoritativeState();
    const targetResult = resolveSpellTargets({
      spell,
      slotLevel: pendingTarget.slotLevel,
      caster: activeCombatant,
      combatants: viewState.combatants,
      pickedTargetIds: pendingTarget.picked,
      allowDuplicates: pendingTarget.allowDuplicates,
      dispositionMatrix: auth.combat?.dispositionMatrix,
    });
    if (targetResult.errorFeedback) {
      showFeedback(targetResult.errorFeedback);
      return;
    }
    void handleDispatch({
      type: 'DECLARE_CAST_SPELL',
      actorId: activeCombatantId,
      spellId: pendingTarget.spellId,
      slotLevel: pendingTarget.slotLevel,
      targetIds: targetResult.targetIds,
      targetCell: targetResult.primaryTarget
        ? targetResult.primaryTarget.position
        : activeCombatant.position,
    });
    setPendingTarget({ kind: 'none' });
  }, [pendingTarget, activeCombatantId, activeCombatant, compendium, transport, viewState.combatants, handleDispatch, showFeedback]);

  const handleCommitAoe = useCallback(() => {
    if (pendingTarget.kind !== 'aoe' || !activeCombatantId || !activeCombatant) return;
    const commit = commitAoeTarget(pendingTarget, activeCombatant.position);
    if (!commit) {
      showFeedback(`Pick a point within range for ${pendingTarget.label}.`);
      return;
    }
    void handleDispatch({
      type: 'DECLARE_CAST_SPELL',
      actorId: activeCombatantId,
      spellId: pendingTarget.spellId,
      slotLevel: pendingTarget.slotLevel,
      targetCell: commit.targetCell,
      ...(commit.directionRad !== undefined ? { directionRad: commit.directionRad } : {}),
    });
    setPendingTarget({ kind: 'none' });
  }, [pendingTarget, activeCombatantId, activeCombatant, handleDispatch, showFeedback]);

  // SRD-410 derived targeting overlay state (AOE preview + commit bar).
  const activeTeamId = activeCombatant?.teamId ?? activeCombatant?.side ?? 'party';
  const pendingAoeCursor =
    pendingTarget.kind === 'aoe' ? (pendingTarget.origin ?? hoveredCell) : null;
  const pendingAoeOverlay =
    pendingTarget.kind === 'aoe' && pendingAoeCursor && activeCombatant
      ? {
          shape: pendingTarget.shape,
          cursor: pendingAoeCursor,
          casterPosition: activeCombatant.position,
          casterSize: activeCombatant.size,
          radiusFeet: pendingTarget.shape === 'sphere' || pendingTarget.shape === 'cylinder' ? pendingTarget.sizeFeet : undefined,
          lengthFeet:
            pendingTarget.shape === 'cone' || pendingTarget.shape === 'line' ? pendingTarget.sizeFeet : undefined,
          widthFeet: pendingTarget.widthFeet,
          sideFeet: pendingTarget.shape === 'cube' ? pendingTarget.sizeFeet : undefined,
          creatures: Object.values(viewState.combatants),
        }
      : null;
  const pendingAoePreview =
    pendingAoeOverlay && pendingTarget.kind === 'aoe'
      ? computeAoeOverlay(pendingAoeOverlay as never)
      : null;
  const friendlyFireOff =
    (transport.getAuthoritativeState() as unknown as { friendlyFireEnabled?: boolean }).friendlyFireEnabled === false;
  const pendingAoeFoes = (pendingAoePreview?.affectedCreatureIds ?? []).filter((id) => {
    const c = viewState.combatants[id];
    return (
      c &&
      (c.teamId ?? c.side) !== activeTeamId &&
      !c.isDead &&
      c.currentHp > 0 &&
      !isUntargetableSummon(c)
    );
  });
  const pendingAoeAllies = (pendingAoePreview?.affectedCreatureIds ?? []).filter((id) => {
    const c = viewState.combatants[id];
    return (
      c &&
      (c.teamId ?? c.side) === activeTeamId &&
      !c.isDead &&
      c.currentHp > 0 &&
      !isUntargetableSummon(c)
    );
  });
  const pendingTargetingMode =
    pendingTarget.kind === 'aoe' ? 'aoe' : pendingTarget.kind === 'none' ? 'none' : 'attack';
  const pendingMultiNames =
    pendingTarget.kind === 'multi'
      ? pendingTarget.picked.map((id) => viewState.combatants[id]?.name ?? id)
      : [];

  // Combat movement on cell click.
  const handleCellClick = async (cell: GridPoint, button?: number) => {
    if (button === 2) {
      cancelPendingTarget();
      return;
    }
    if (viewState.mode !== 'combat' || !activeCombatant || activeCombatant.side === 'monster') {
      return;
    }
    // SRD-410 manual targeting: armed AOE origin selection first; while a
    // single/multi pick is armed, cell clicks never move.
    if (pendingTarget.kind === 'aoe') {
      // Self spheres/cubes are anchored on the caster — just Confirm.
      if (isSelfEmanation(pendingTarget) && !needsDirectionPick(pendingTarget)) {
        showFeedback(`${pendingTarget.label} originates from you — Confirm to cast.`);
        return;
      }
      const dist = getFootprintDistanceFeet(
        activeCombatant.position,
        activeCombatant.size,
        cell,
        'small',
      );
      const aimRange = aimRangeFeet(pendingTarget);
      if (dist > aimRange) {
        showFeedback(
          `AOE ${needsDirectionPick(pendingTarget) ? 'direction' : 'origin'} out of range (${dist}ft > ${aimRange}ft). Pick a closer point!`,
        );
        return;
      }
      setPendingTarget({ ...pendingTarget, origin: { x: cell.x, y: cell.y } });
      return;
    }
    if (pendingTarget.kind !== 'none') {
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
        onSelectCombatant={handleCombatantClickForTarget}
        onOpenCharacterSheet={onOpenCharacterSheet}
        onDeclareAttack={(weapon, opts) => {
          if (!activeCombatantId || !activeCombatant) return;
          // SRD-410: arm manual targeting; click a token to commit.
          pendingAttackOptsRef.current = {
            ...(opts?.isOffHand ? { isOffHand: opts.isOffHand } : {}),
            ...(opts?.twoHanded ? { twoHanded: opts.twoHanded } : {}),
          };
          setPendingTarget(
            buildPendingTargetForAttack({
              id: weapon.id,
              weaponId: weapon.weaponId,
              name: weapon.name,
              rangeType: weapon.rangeType,
              rangeFeet: weapon.rangeFeet,
              reachFeet: weapon.reachFeet,
            }),
          );
        }}
        onCastSpell={(spellId, slotLevel) => {
          if (!activeCombatantId || !activeCombatant) return;
          const spell = compendium.getSpell(spellId);
          if (!spell) return;
          // SRD-410: arm manual targeting; self spells fire immediately.
          const pending = buildPendingTargetForSpell(spell, slotLevel);
          if (!pending || pending.kind === 'none') {
            void handleDispatch({
              type: 'DECLARE_CAST_SPELL',
              actorId: activeCombatantId,
              spellId,
              slotLevel,
              targetIds: [activeCombatant.id],
              targetCell: activeCombatant.position,
            });
            return;
          }
          // Self spheres/cubes anchor on the caster — pre-set the origin
          // so the player only Confirms (cones/lines still pick a bearing).
          if (
            pending.kind === 'aoe' &&
            isSelfEmanation(pending) &&
            !needsDirectionPick(pending)
          ) {
            setPendingTarget({ ...pending, origin: { ...activeCombatant.position } });
          } else {
            setPendingTarget(pending);
          }
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
          onCombatantClick={handleCombatantClickForTarget}
          targetingMode={pendingTargetingMode}
          activeAoeTemplate={pendingAoeOverlay as never}
          enableHoverPathPreview={pendingTarget.kind === 'none'}
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
      {pendingTarget.kind !== 'none' && (
        <div
          data-testid="targeting-commit-bar"
          className="absolute bottom-56 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-2 bg-slate-950/95 border border-amber-500/50 rounded-xl shadow-2xl text-xs max-w-[92vw]"
          onContextMenu={(e) => {
            e.preventDefault();
            cancelPendingTarget();
          }}
        >
          <span data-testid="targeting-hint" className="text-slate-200">
            {pendingTargetHint(pendingTarget)}
          </span>
          {pendingTarget.kind === 'multi' && (
            <span
              data-testid="targeting-counter"
              className="px-2 py-0.5 rounded-full bg-purple-950 border border-purple-500 text-purple-200 font-mono font-bold shrink-0"
            >
              🪄 ×{pendingTarget.maxTargets - pendingTarget.picked.length} left
            </span>
          )}
          {pendingTarget.kind === 'aoe' && pendingAoePreview && (
            <span
              data-testid="targeting-aoe-preview"
              className="px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700 font-mono shrink-0"
            >
              <span className="text-rose-300">{pendingAoeFoes.length} foe{pendingAoeFoes.length === 1 ? '' : 's'}</span>
              <span className="text-slate-500"> · </span>
              <span className={friendlyFireOff ? 'text-slate-500 line-through' : 'text-emerald-300'}>
                {pendingAoeAllies.length} ally{pendingAoeAllies.length === 1 ? '' : 'ies'}
                {friendlyFireOff ? ' (spared)' : ''}
              </span>
            </span>
          )}
          {pendingTarget.kind === 'multi' && pendingMultiNames.length > 0 && (
            <span data-testid="targeting-picked-list" className="text-slate-400 truncate max-w-[30vw]">
              {pendingMultiNames.join(', ')}
            </span>
          )}
          {(pendingTarget.kind === 'multi' || pendingTarget.kind === 'aoe') && (
            <button
              type="button"
              data-testid="targeting-confirm-btn"
              disabled={!canCommitPending(pendingTarget)}
              onClick={() =>
                pendingTarget.kind === 'multi' ? handleCommitMulti() : handleCommitAoe()
              }
              className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold shrink-0"
            >
              Confirm
            </button>
          )}
          <button
            type="button"
            data-testid="targeting-cancel-btn"
            onClick={cancelPendingTarget}
            className="px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold shrink-0"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
