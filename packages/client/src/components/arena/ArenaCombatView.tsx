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
  type LevelUpSummary,
  computeDerivedCharacter,
  findPath,
  getFootprintDistanceFeet,
  planAiTurn,
  reduceGame,
  truncatePathToBudget,
} from '@srd5/engine';
import { LocalTransport, type PlayerViewState } from '@srd5/transport';
import { TacticalCanvasViewport } from '../../canvas/index.js';
import { TacticalCombatHud } from '../combat/index.js';
import { LevelUpModal } from '../roster/index.js';
import { resolveSpellTargets } from '../../utils/combatTargeting.js';
import {
  buildPendingTargetForAttack,
  buildPendingTargetForSpell,
  canCommitPending,
  pendingTargetHint,
  validateTargetPick,
  type PendingTarget,
} from '../../utils/pendingTargeting.js';
import { computeAoeOverlay } from '../../canvas/layers/PathAndAoeLayer.js';
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
  const [hoveredCombatantId, setHoveredCombatantId] = useState<string | null>(null);
  // SRD-410 manual targeting: armed action awaiting token/cell picks.
  const [pendingTarget, setPendingTarget] = useState<PendingTarget>({ kind: 'none' });

  // Match progression modals
  const [showBreatherModal, setShowBreatherModal] = useState(false);
  const [showMatchEndModal, setShowMatchEndModal] = useState(false);
  const [levelUpCharacter, setLevelUpCharacter] = useState<CharacterBuildState | null>(null);
  const [matchOutcome, setMatchOutcome] = useState<{
    status: 'in_progress' | 'victory' | 'defeat' | 'wave_cleared' | 'draw';
    winnerTeamId?: string;
    winnerName?: string;
  }>({ status: 'in_progress' });

  // AI automation for PvE
  const [autoAiTurn, setAutoAiTurn] = useState(true);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const aiTurnTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // User action feedback banner
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // HUD sidebar panels (Log & Dice Tray)
  const [showLog, setShowLog] = useState(false);
  const [showDiceTray, setShowDiceTray] = useState(false);

  const handleInspectRoll = (roll: DiceRollRecord) => {
    setActiveRoll(roll);
    setShowDiceTray(true);
  };

  const showFeedback = useCallback((msg: string) => {
    setActionFeedback(msg);
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
    }
    feedbackTimeoutRef.current = setTimeout(() => {
      setActionFeedback(null);
    }, 3500);
  }, []);

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
      } catch (err: unknown) {
        console.error('Error dispatching Arena command:', err);
        const msg = err instanceof Error ? err.message : String(err);
        showFeedback(msg);
      }
    },
    [transport, showFeedback],
  );

  const cancelPendingTarget = useCallback(() => {
    setPendingTarget({ kind: 'none' });
  }, []);

  // SRD-410: Esc cancels armed targeting; clear pending when turn changes.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPendingTarget((prev) => (prev.kind === 'none' ? prev : { kind: 'none' }));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Targeting-aware Character Sheet shortcut ('C' / 'I'): opens the sheet for
  // the currently selected combatant instead of always the first party member.
  useEffect(() => {
    const handleSheetShortcut = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key !== 'c' && key !== 'i') return;
      e.preventDefault();
      e.stopPropagation();
      const heroId = selectedCombatantId ?? viewState.party[viewState.combat?.activeCombatantId ?? '']?.id ?? Object.keys(viewState.party)[0];
      if (heroId && onOpenCharacterSheet) {
        onOpenCharacterSheet(heroId);
      }
    };

    window.addEventListener('keydown', handleSheetShortcut, { capture: true });
    return () => window.removeEventListener('keydown', handleSheetShortcut, { capture: true });
  }, [selectedCombatantId, viewState.party, viewState.combat, onOpenCharacterSheet]);

  useEffect(() => {
    setPendingTarget({ kind: 'none' });
  }, [activeCombatantId]);

  // AI monster turn execution
  const executeAiMonsterTurn = useCallback(async () => {
    if (!activeCombatant || !activeCombatantId || !isMonsterTurn || isAiThinking) {
      return;
    }

    setIsAiThinking(true);
    try {
      const authState = transport.getAuthoritativeState();
      if (!authState.combat) return;

      // Halt if waiting for a reaction prompt to resolve
      if (authState.combat.pendingReactionPrompt) {
        return;
      }

      const plan = planAiTurn({
        state: authState.combat,
        activeCombatantId,
        grid: authState.grid,
      });

      for (const cmd of plan.commands) {
        const currentCombat = transport.getAuthoritativeState().combat;
        if (currentCombat?.pendingReactionPrompt) {
          return;
        }
        await transport.dispatch(cmd);
        const postCombat = transport.getAuthoritativeState().combat;
        if (postCombat?.pendingReactionPrompt) {
          return;
        }
      }
    } catch (err) {
      console.error('Error executing AI monster turn:', err);
      // Fallback: force end turn only if not waiting on a reaction prompt
      const postCombat = transport.getAuthoritativeState().combat;
      if (!postCombat?.pendingReactionPrompt && activeCombatantId) {
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

  const hasPendingReaction = Boolean(combat?.pendingReactionPrompt);

  // Trigger automatic AI turn if enabled
  useEffect(() => {
    if (
      isMonsterTurn &&
      autoAiTurn &&
      !isAiThinking &&
      !hasPendingReaction &&
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
    hasPendingReaction,
    showBreatherModal,
    showMatchEndModal,
    executeAiMonsterTurn,
  ]);

  // Canvas cell click handler (SRD-410 targeting, else movement)
  const handleCellClick = async (cell: GridPoint, button?: number) => {
    if (button === 2) {
      cancelPendingTarget();
      return;
    }
    if (!activeCombatant || !isPlayerControlled || isMonsterTurn) {
      return;
    }

    // SRD-410: armed AOE origin selection
    if (pendingTarget.kind === 'aoe') {
      if (!activeCombatant) return;
      const dist = getFootprintDistanceFeet(
        activeCombatant.position,
        activeCombatant.size,
        cell,
        'small',
      );
      if (dist > pendingTarget.rangeFeet) {
        showFeedback(
          `AOE origin out of range (${dist}ft > ${pendingTarget.rangeFeet}ft). Pick a closer point!`,
        );
        return;
      }
      setPendingTarget({ ...pendingTarget, origin: { x: cell.x, y: cell.y } });
      return;
    }

    // While single/multi targeting is armed, cell clicks do not move.
    if (pendingTarget.kind !== 'none') {
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

    const movementBudget = combat?.turnBudget?.movementRemainingFeet ?? 30;
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

    const truncated = truncatePathToBudget(authState.grid, mover, pathResult, movementBudget, creatures);

    if (truncated && truncated.path.length > 1) {
      await handleDispatch({
        type: 'COMBAT_MOVE',
        actorId: activeCombatant.id,
        path: truncated.path,
      });
    }
  };

  // SRD-410: token click handler for manual targeting picks.
  // Targeting clicks commit the armed action and must NOT change selection:
  // otherwise every attack/spell pick also pops the enemy info card.
  // Selection only changes when no targeting is armed (plain inspect clicks).
  const handleCombatantClickForTarget = useCallback(
    (combatantId: string) => {
      if (!activeCombatant || !isPlayerControlled || isMonsterTurn) {
        setSelectedCombatantId(combatantId);
        return;
      }
      if (pendingTarget.kind === 'none') {
        setSelectedCombatantId(combatantId);
        return;
      }
      const candidate = viewState.combatants[combatantId];
      if (!candidate) {
        return;
      }
      const authState = transport.getAuthoritativeState() as unknown as {
        combat?: { dispositionMatrix?: Record<string, Record<string, 'allied' | 'hostile' | 'neutral'>> };
      };
      const validation = validateTargetPick(
        pendingTarget,
        candidate,
        activeCombatant,
        viewState.combatants,
        { dispositionMatrix: authState.combat?.dispositionMatrix },
      );
      if (!validation.ok) {
        showFeedback(validation.error ?? 'Invalid target.');
        return;
      }

      if (pendingTarget.kind === 'single') {
        if (pendingTarget.action === 'attack') {
          const weaponId = pendingTarget.weaponId ?? '';
          const attackProfileId =
            pendingTarget.attackProfileId ?? pendingTarget.weaponId ?? '';
          void handleDispatch({
            type: 'DECLARE_ATTACK',
            actorId: activeCombatant.id,
            targetId: combatantId,
            attackProfileId,
            weaponInstanceId: weaponId,
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
        setPendingTarget((prev) => {
          if (prev.kind !== 'multi') return prev;
          if (prev.picked.includes(combatantId)) {
            // Toggle off (distinct mode); stacked mode keeps stacking.
            if (prev.allowDuplicates) {
              if (prev.picked.length >= prev.maxTargets) {
                showFeedback(`${prev.label} can target at most ${prev.maxTargets}.`);
                return prev;
              }
              return { ...prev, picked: [...prev.picked, combatantId] };
            }
            return { ...prev, picked: prev.picked.filter((id) => id !== combatantId) };
          }
          if (prev.picked.length >= prev.maxTargets) {
            showFeedback(`${prev.label} can target at most ${prev.maxTargets}.`);
            return prev;
          }
          return { ...prev, picked: [...prev.picked, combatantId] };
        });
      }
      // AOE: token clicks never change selection while armed; origin comes from cell clicks.
    },
    [activeCombatant, handleDispatch, isMonsterTurn, isPlayerControlled, pendingTarget, showFeedback, transport, viewState.combatants],
  );

  // SRD-410: commit armed multi picks.
  const handleCommitMulti = useCallback(() => {
    if (pendingTarget.kind !== 'multi' || !activeCombatantId || !activeCombatant) return;
    if (!canCommitPending(pendingTarget)) {
      showFeedback(`Pick at least 1 target for ${pendingTarget.label}.`);
      return;
    }
    const spell = compendium.getSpell(pendingTarget.spellId);
    if (!spell) return;
    const authState = transport.getAuthoritativeState() as unknown as {
      combat?: { dispositionMatrix?: Record<string, Record<string, 'allied' | 'hostile' | 'neutral'>> };
    };
    const targetResult = resolveSpellTargets({
      spell,
      slotLevel: pendingTarget.slotLevel,
      caster: activeCombatant,
      combatants: viewState.combatants,
      pickedTargetIds: pendingTarget.picked,
      allowDuplicates: pendingTarget.allowDuplicates,
      dispositionMatrix: authState.combat?.dispositionMatrix,
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
  }, [activeCombatant, activeCombatantId, compendium, handleDispatch, pendingTarget, showFeedback, transport, viewState.combatants]);

  // SRD-410: commit armed AOE origin.
  const handleCommitAoe = useCallback(() => {
    if (pendingTarget.kind !== 'aoe' || !activeCombatantId || !activeCombatant) return;
    if (!pendingTarget.origin) {
      showFeedback(`Pick a point within range for ${pendingTarget.label}.`);
      return;
    }
    void handleDispatch({
      type: 'DECLARE_CAST_SPELL',
      actorId: activeCombatantId,
      spellId: pendingTarget.spellId,
      slotLevel: pendingTarget.slotLevel,
      targetCell: pendingTarget.origin,
    });
    setPendingTarget({ kind: 'none' });
  }, [activeCombatant, activeCombatantId, handleDispatch, pendingTarget, showFeedback]);

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

  // Level-up handlers
  const handleOpenLevelUp = (characterId: string) => {
    const found =
      partyCharacters?.find((c) => c.id === characterId) ??
      viewState.party[characterId]?.buildState ??
      null;
    if (found) {
      setLevelUpCharacter(found);
    }
  };

  const handleApplyLevelUp = (
    updatedCharacter: CharacterBuildState,
    summary: LevelUpSummary,
  ) => {
    const authState = transport.getAuthoritativeState();
    const hero = authState.party[updatedCharacter.id];
    if (hero) {
      const nextSheet = computeDerivedCharacter(updatedCharacter, compendium);
      const nextParty = {
        ...authState.party,
        [updatedCharacter.id]: {
          ...hero,
          buildState: updatedCharacter,
          characterSheet: nextSheet,
          maxHp: nextSheet.maxHp,
          currentHp: Math.min(nextSheet.maxHp, hero.currentHp + summary.hpGained),
          armorClass: nextSheet.armorClass.totalAc,
          levelUpAvailable: false,
        },
      };

      let nextCombat = authState.combat;
      if (nextCombat && nextCombat.combatants[updatedCharacter.id]) {
        nextCombat = {
          ...nextCombat,
          combatants: {
            ...nextCombat.combatants,
            [updatedCharacter.id]: {
              ...nextCombat.combatants[updatedCharacter.id]!,
              characterSheet: nextSheet,
              maxHp: nextSheet.maxHp,
              currentHp: Math.min(nextSheet.maxHp, hero.currentHp + summary.hpGained),
              armorClass: nextSheet.armorClass.totalAc,
              levelUpAvailable: false,
            },
          },
        };
      }

      const updatedState: GameState = {
        ...authState,
        party: nextParty,
        combat: nextCombat,
      };
      (transport as any).authoritativeState = updatedState;
      setViewState(transport.getPlayerViewState());
    }
    setLevelUpCharacter(null);
  };

  // SRD-410 derived targeting overlay state (AOE preview + rays + commit bar).
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
    (transport.getAuthoritativeState() as unknown as { friendlyFireEnabled?: boolean })
      .friendlyFireEnabled === false;
  const pendingAoeFoes = (pendingAoePreview?.affectedCreatureIds ?? []).filter((id) => {
    const c = viewState.combatants[id];
    return c && (c.teamId ?? c.side) !== activeTeamId && !c.isDead && c.currentHp > 0;
  });
  const pendingAoeAllies = (pendingAoePreview?.affectedCreatureIds ?? []).filter((id) => {
    const c = viewState.combatants[id];
    return c && (c.teamId ?? c.side) === activeTeamId && !c.isDead && c.currentHp > 0;
  });
  const pendingTargetingMode =
    pendingTarget.kind === 'aoe' ? 'aoe' : pendingTarget.kind === 'none' ? 'none' : 'attack';
  const pendingSingleRay =
    pendingTarget.kind === 'single' && hoveredCombatantId && activeCombatant
      ? (() => {
          const target = viewState.combatants[hoveredCombatantId];
          if (!target || target.id === activeCombatant.id) return null;
          return { attacker: activeCombatant, target, grid: viewState.grid };
        })()
      : null;
  const pendingMultiNames =
    pendingTarget.kind === 'multi'
      ? pendingTarget.picked.map((id) => viewState.combatants[id]?.name ?? id)
      : [];

  return (
    <div
      data-testid="arena-combat-view"
      className="fixed inset-0 z-40 w-screen h-screen overflow-hidden bg-slate-950 flex flex-col select-none"
    >
      {actionFeedback && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-red-950/95 border border-red-500 text-red-200 rounded-lg text-xs font-semibold shadow-2xl flex items-center gap-2 pointer-events-none">
          <span>⚠️</span>
          <span>{actionFeedback}</span>
        </div>
      )}

      <TacticalCombatHud
        viewState={viewState}
        compendium={compendium}
        selectedCombatantId={selectedCombatantId}
        isPlayerControlled={isPlayerControlled}
        events={events}
        activeRoll={activeRoll}
        rollHistory={rollHistory}
        showCombatLog={showLog}
        showDiceTray={showDiceTray}
        onToggleCombatLog={() => setShowLog((prev) => !prev)}
        onToggleDiceTray={() => setShowDiceTray((prev) => !prev)}
        onInspectRoll={handleInspectRoll}
        title={config.name}
        subtitle={
          isPvp
            ? activeTeamId === 'team_red'
              ? `${config.pvpSettings?.teamA.teamName} (Player 1)`
              : `${config.pvpSettings?.teamB.teamName} (Player 2)`
            : config.mode === 'endless_waves'
            ? `Endless Wave ${currentWave} · Score ${score}`
            : `Skirmish · Tier: ${config.pveSettings?.difficultyTier ?? 'medium'}`
        }
        onToggleMenu={onExitToSetup}
        menuButtonText="&larr; Exit Arena"
        menuButtonTestId="arena-exit-button"
        headerExtras={
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-0.5 rounded-full font-bold uppercase bg-slate-800 text-slate-300 border border-slate-700">
              {config.mode === 'pvp_duel'
                ? '1v1 PvP Duel'
                : config.mode === 'endless_waves'
                ? `Wave ${currentWave}`
                : 'Custom Skirmish'}
            </span>

            {isPvp && (
              <div
                data-testid="pvp-turn-indicator"
                className={`px-2.5 py-0.5 rounded-full text-xs font-bold border flex items-center gap-1.5 transition-colors ${
                  activeTeamId === 'team_red'
                    ? 'bg-red-950/80 border-red-600 text-red-300'
                    : 'bg-blue-950/80 border-blue-600 text-blue-300'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{
                    backgroundColor:
                      activeTeamId === 'team_red'
                        ? config.pvpSettings?.teamA.color ?? '#ef4444'
                        : config.pvpSettings?.teamB.color ?? '#3b82f6',
                  }}
                />
                <span>
                  {activeTeamId === 'team_red'
                    ? `${config.pvpSettings?.teamA.teamName ?? 'Team Red'}'s Turn`
                    : `${config.pvpSettings?.teamB.teamName ?? 'Team Blue'}'s Turn`}
                </span>
              </div>
            )}

            {config.mode === 'endless_waves' && (
              <div className="text-xs text-slate-400 flex items-center gap-2">
                <span>
                  Score: <strong className="text-amber-400 font-mono">{score}</strong>
                </span>
                <span>
                  Slain: <strong className="text-slate-200 font-mono">{monstersDefeated}</strong>
                </span>
              </div>
            )}

            {isMonsterTurn && (
              <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-slate-700">
                <span className="text-xs text-rose-400 font-medium animate-pulse hidden md:inline">
                  AI Turn:
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
          </div>
        }
          onSelectCombatant={(id) => handleCombatantClickForTarget(id)}
          onOpenCharacterSheet={onOpenCharacterSheet}
          onLevelUpCharacter={handleOpenLevelUp}
          onDeclareAttack={(weapon) => {
            if (!activeCombatantId || !activeCombatant) return;
            // SRD-410: arm manual targeting; click a token to commit.
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
            setPendingTarget(pending);
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
            hoveredCombatantId={hoveredCombatantId}
            targetingMode={pendingTargetingMode}
            activeAoeTemplate={pendingAoeOverlay as never}
            targetingRay={pendingSingleRay as never}
            onCellHover={(pt) => setHoveredCell(pt)}
            onCellClick={(pt, button) => void handleCellClick(pt, button)}
            onCombatantClick={(combatantId) => handleCombatantClickForTarget(combatantId)}
            onCombatantHover={(combatantId) => setHoveredCombatantId(combatantId)}
            enableHoverPathPreview={pendingTarget.kind === 'none'}
            enableFogOfWar={false}
            showTokenHpArcs={true}
            showConditionBadges={true}
            showTokenNames={true}
            events={events}
          />
        </TacticalCombatHud>

      {/* SRD-410 manual targeting commit bar — sibling of the HUD (not a viewport
          child) so it stacks above the z-30 docked hotbar instead of behind it. */}
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

            {/* Level-Up Opportunities during Breather */}
            {Object.values(viewState.party).some((h) => h.levelUpAvailable) && (
              <div className="p-3 bg-emerald-950/40 border border-emerald-500/40 rounded-xl text-left space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-300">Level-Up Unlocked!</span>
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded font-mono">
                    XP Threshold Reached
                  </span>
                </div>
                {Object.values(viewState.party)
                  .filter((h) => h.levelUpAvailable)
                  .map((hero) => (
                    <button
                      key={hero.id}
                      type="button"
                      data-testid={`breather-level-up-${hero.id}`}
                      onClick={() => handleOpenLevelUp(hero.id)}
                      className="w-full py-1.5 px-3 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/50 text-emerald-200 text-xs font-semibold flex items-center justify-between transition-colors"
                    >
                      <span>{hero.name}</span>
                      <span>Advance Level &rarr;</span>
                    </button>
                  ))}
              </div>
            )}

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

      {/* Between-Combat Level-Up Modal */}
      {levelUpCharacter && (
        <LevelUpModal
          character={levelUpCharacter}
          compendium={compendium}
          onClose={() => setLevelUpCharacter(null)}
          onApplyLevelUp={handleApplyLevelUp}
        />
      )}
    </div>
  );
}
