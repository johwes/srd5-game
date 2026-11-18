import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  type CharacterBuildState,
  type DungeonFloorSpec,
  type SrdCompendium,
  defaultCompendium,
  getCampaignFloor,
  getPregenCharacter,
  getSunkenCryptModule,
} from '@srd5/data';
import {
  type Combatant,
  type DeepDescentRunState,
  type DiceRollRecord,
  type GameCommand,
  type GameEvent,
  type GameState,
  type GraveyardEntry,
  type GridPoint,
  type InteractiveProp,
  type RealmDelveState,
  activateShrine,
  advanceRealmDelveFloor,
  advanceRogueliteFloor,
  calculateGoldFromLoot,
  canAdvanceRealmDelve,
  checkRogueliteWipe,
  completeRealmDelve,
  endRogueliteRun,
  findPath,
  getFootprintDistanceFeet,
  isLairFloorCleared,
  planAiTurn,
  recordRunMonstersSlain,
  resolveRogueliteLongRest,
  truncatePathToBudget,
} from '@srd5/engine';
import { LocalTransport, type PlayerViewProp, type PlayerViewState } from '@srd5/transport';
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
import { LevelUpModal } from '../roster/index.js';
import { resolveSpellTargets } from '../../utils/combatTargeting.js';
import { isUntargetableSummon } from '../../utils/summonPresentation.js';
import { DungeonExplorationHud } from './DungeonExplorationHud.js';
import { LootInventoryModal } from './LootInventoryModal.js';
import { MarchingOrderModal } from './MarchingOrderModal.js';
import { RestCampModal } from './RestCampModal.js';
import { SaveLoadModal } from './SaveLoadModal.js';
import { ShrineModal } from './ShrineModal.js';
import { GraveyardModal } from './GraveyardModal.js';
import { RogueliteHud } from './RogueliteHud.js';
import { PauseMenuModal } from '../system/index.js';
import {
  buildDungeonSession,
  buildRogueliteSession,
  getAdjacentProps,
  isFinalCampaignBossDefeated,
  transitionToNextFloor,
} from './dungeonEngine.js';
import {
  saveGraveyardEntry,
  defaultDungeonStorageAdapter,
  type DungeonStorageAdapter,
  quickSaveDungeonGame,
  saveDungeonGameToSlot,
} from '../../persistence/index.js';
import type { DungeonModalMode } from './types.js';

export type DungeonGameMode = 'campaign' | 'roguelite' | 'realm_delve';

export interface DungeonViewProps {
  partyCharacters?: CharacterBuildState[];
  compendium?: SrdCompendium;
  initialFloorId?: string;
  initialGameState?: GameState;
  gameMode?: DungeonGameMode;
  storageAdapter?: DungeonStorageAdapter;
  onExitToRoster: () => void;
  onOpenCharacterSheet?: (characterId: string) => void;
  /** SRD-806: scoped POI delve state when gameMode is 'realm_delve'. */
  initialDelveState?: RealmDelveState;
  /** SRD-806: generated first-floor spec for the POI delve. */
  initialFloorSpec?: DungeonFloorSpec;
  /** SRD-806: called once when the delve concludes (clear, lair clear, or wipe). */
  onDelveResolved?: (delve: RealmDelveState, gameState: GameState) => void;
}

export function DungeonView({
  partyCharacters = [],
  compendium = defaultCompendium,
  initialFloorId = 'kaelen-floor-1',
  initialGameState,
  gameMode = 'campaign',
  storageAdapter = defaultDungeonStorageAdapter,
  onExitToRoster,
  onOpenCharacterSheet,
  initialDelveState,
  initialFloorSpec,
  onDelveResolved,
}: DungeonViewProps) {
  const campaignModule = getSunkenCryptModule();
  const [dungeonMode, setDungeonMode] = useState<DungeonGameMode>(gameMode);
  const [currentFloorId, setCurrentFloorId] = useState<string>(
    initialGameState?.dungeon?.floorId ?? initialFloorId,
  );

  const [rogueliteState, setRogueliteState] = useState<{
    runState: DeepDescentRunState;
    floor: DungeonFloorSpec;
  } | null>(() => {
    if (gameMode === 'realm_delve' && initialDelveState && initialFloorSpec) {
      return { runState: initialDelveState, floor: initialFloorSpec };
    }
    if (gameMode === 'roguelite') {
      const sess = buildRogueliteSession(partyCharacters, compendium);
      return {
        runState: sess.session.runState,
        floor: sess.session.generatedFloor.floor,
      };
    }
    return null;
  });

  /** Run-based modes (classic Descent + Realm POI delves) share the run loop. */
  const isRunMode = dungeonMode === 'roguelite' || dungeonMode === 'realm_delve';
  /** The scoped POI delve when in realm_delve mode (runState carries delve fields). */
  const activeDelve =
    dungeonMode === 'realm_delve' && rogueliteState
      ? (rogueliteState.runState as RealmDelveState)
      : null;

  // Guard so a delve conclusion is committed back exactly once.
  const delveResolvedRef = useRef(false);
  const onDelveResolvedRef = useRef(onDelveResolved);
  onDelveResolvedRef.current = onDelveResolved;
  const resolveDelveOnce = useCallback(
    (delve: RealmDelveState, gameState: GameState) => {
      if (delveResolvedRef.current) return;
      delveResolvedRef.current = true;
      onDelveResolvedRef.current?.(delve, gameState);
    },
    [],
  );

  const floorSpec =
    isRunMode && rogueliteState
      ? rogueliteState.floor
      : (getCampaignFloor(campaignModule, currentFloorId) ?? campaignModule.floors[0]!);

  // Latest-value refs for the transport subscription closure (avoids staleness).
  const runStateRef = useRef(rogueliteState);
  runStateRef.current = rogueliteState;
  const dungeonModeRef = useRef(dungeonMode);
  dungeonModeRef.current = dungeonMode;

  const [transport, setTransport] = useState<LocalTransport>(() => {
    if (initialGameState) {
      return new LocalTransport({
        initialState: initialGameState,
        defaultPlayerId: 'player-1',
      });
    }
    if (gameMode === 'roguelite') {
      const sess = buildRogueliteSession(partyCharacters, compendium);
      return sess.transport;
    }
    return buildDungeonSession(floorSpec, partyCharacters, compendium).transport;
  });

  const [viewState, setViewState] = useState<PlayerViewState>(() =>
    transport.getPlayerViewState(),
  );
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [activeRoll, setActiveRoll] = useState<DiceRollRecord | null>(null);
  const [rollHistory, setRollHistory] = useState<DiceRollRecord[]>([]);

  const [hoveredCell, setHoveredCell] = useState<GridPoint | null>(null);
  const [modalState, setModalState] = useState<DungeonModalMode>(null);
  const [levelUpCharacter, setLevelUpCharacter] =
    useState<CharacterBuildState | null>(null);

  const handleOpenLevelUp = useCallback(
    (characterId: string) => {
      const hero = partyCharacters.find((c) => c.id === characterId);
      if (hero) {
        setLevelUpCharacter(hero);
      }
    },
    [partyCharacters],
  );
  const [activeLoot, setActiveLoot] = useState<{
    sourcePropId?: string;
    sourceName?: string;
    bundle: any;
  } | null>(null);
  const [activeShrine, setActiveShrine] =
    useState<InteractiveProp | PlayerViewProp | null>(null);
  // SRD-410 manual targeting: hotbar action awaiting token/cell picks.
  // Replaces the old nearest-enemy auto-pick in combat mode.
  const [pendingTarget, setPendingTarget] = useState<PendingTarget>({ kind: 'none' });
  const cancelPendingTarget = useCallback(() => {
    setPendingTarget({ kind: 'none' });
  }, []);
  const pendingTargetRef = useRef(pendingTarget);
  pendingTargetRef.current = pendingTarget;
  // Off-hand / versatile flags for the armed attack (consumed on commit).
  const pendingAttackOptsRef = useRef<{ isOffHand?: boolean; twoHanded?: boolean } | null>(null);
  const [graveyardEntry, setGraveyardEntry] = useState<GraveyardEntry | null>(null);
  const [campaignVictory, setCampaignVictory] = useState(false);
  const [selectedCombatantId, setSelectedCombatantId] = useState<string | null>(null);

  // User action feedback banner
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFeedback = useCallback((msg: string) => {
    setActionFeedback(msg);
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
    }
    feedbackTimeoutRef.current = setTimeout(() => {
      setActionFeedback(null);
    }, 3500);
  }, []);

  // Global Escape key handler to toggle Pause Menu or close active modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // An armed manual target takes precedence: Esc cancels targeting first.
        if (pendingTargetRef.current.kind !== 'none') {
          e.preventDefault();
          e.stopPropagation();
          setPendingTarget({ kind: 'none' });
          return;
        }
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

        e.preventDefault();
        setModalState((current) => {
          if (current === 'pause_menu') {
            return null; // Resume Game
          }
          if (current !== null) {
            return null; // Close any active submodal
          }
          return 'pause_menu'; // Open Pause Menu
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // AI automation for combat
  const [isAiThinking, setIsAiThinking] = useState(false);
  const aiTurnTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Authoritative state accessor
  const getAuthState = useCallback(() => {
    return transport.getAuthoritativeState();
  }, [transport]);

  // Subscribe to transport state updates
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

      // Inspect emitted dice rolls
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

        // Open chest with loot
        if (ev.type === 'PROP_STATE_CHANGED' && ev.nextState === 'open') {
          const auth = transport.getAuthoritativeState();
          const prop = auth.props.find((p) => p.id === ev.propId);
          if (prop?.lootTable) {
            setActiveLoot({
              sourcePropId: prop.id,
              sourceName: prop.id.replace(/[-_]/g, ' '),
              bundle: prop.lootTable,
            });
            setModalState('loot_inventory');
          }
        }

        // Encounter victory in run-based modes (Descent + Realm delves)
        if (ev.type === 'ENCOUNTER_VICTORY' && isRunMode) {
          setRogueliteState((prev) => {
            if (!prev) return null;
            const updated = recordRunMonstersSlain(
              prev.runState,
              1,
              ev.totalXp ?? ev.xpAwarded ?? 0,
              calculateGoldFromLoot('lootBundle' in ev ? ev.lootBundle : undefined),
            );
            // Lairs clear with no run scoring (Spec 06 §4.3).
            if ((prev.runState as RealmDelveState).kind === 'lair_clear') {
              updated.score = 0;
            }
            return { ...prev, runState: updated };
          });
        }
      }

      // Check if boss defeated on Floor 3 in campaign mode
      const auth = transport.getAuthoritativeState();
      if (dungeonMode === 'campaign' && isFinalCampaignBossDefeated(auth)) {
        setCampaignVictory(true);
      }

      // Check for party wipe / lair clear in run-based modes. Read the latest
      // run state via ref so the conclusion uses current delve metadata.
      const currentRun = runStateRef.current;
      const currentMode = dungeonModeRef.current;
      if (currentMode === 'roguelite' && currentRun && !currentRun.runState.isComplete) {
        if (checkRogueliteWipe(currentRun.runState, auth)) {
          const completed = endRogueliteRun(
            currentRun.runState,
            auth,
            'Overcome by the Dungeons',
          );
          if (completed.graveyardEntry) {
            saveGraveyardEntry(completed.graveyardEntry);
            setGraveyardEntry(completed.graveyardEntry);
          }
          setRogueliteState((prev) => (prev ? { ...prev, runState: completed } : null));
          setModalState('graveyard');
        }
      } else if (currentMode === 'realm_delve' && currentRun && !currentRun.runState.isComplete) {
        const delve = currentRun.runState as RealmDelveState;
        if (checkRogueliteWipe(delve, auth)) {
          const completed = completeRealmDelve(delve, auth, { cleared: false });
          setRogueliteState((prev) => (prev ? { ...prev, runState: completed } : null));
          resolveDelveOnce(completed, auth);
        } else if (delve.kind === 'lair_clear' && isLairFloorCleared(auth)) {
          const completed = completeRealmDelve(delve, auth, { cleared: true });
          setRogueliteState((prev) => (prev ? { ...prev, runState: completed } : null));
          resolveDelveOnce(completed, auth);
        }
      }
    });

    return () => {
      active = false;
      unsubscribe();
      if (aiTurnTimeoutRef.current) {
        clearTimeout(aiTurnTimeoutRef.current);
      }
    };
  }, [transport]);

  const handleDispatch = useCallback(
    async (command: GameCommand) => {
      try {
        await transport.dispatch(command);
      } catch (err: unknown) {
        console.error('Error dispatching dungeon command:', err);
        const msg = err instanceof Error ? err.message : String(err);
        showFeedback(msg);
      }
    },
    [transport, showFeedback],
  );

  const authState = getAuthState();
  const partyList = Object.values(authState.party);
  const marchingConfig = authState.marchingOrder ?? {
    order: partyList.map((p) => p.id),
    formation: 'single_file',
    leadExplorerId: partyList[0]?.id ?? 'hero-1',
  };
  const leadExplorerId = marchingConfig.leadExplorerId;
  const leadCombatant = authState.party[leadExplorerId] ?? partyList[0];

  // Targeting-aware Character Sheet shortcut ('C' / 'I'): opens the sheet for
  // the currently selected combatant (falling back to the lead explorer) so
  // targeting actually determines whose sheet opens. Registered on capture so
  // the App-level fallback (which always opens the first party member) never
  // fires while the dungeon view is mounted.
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
      const heroId = selectedCombatantId ?? leadExplorerId;
      if (heroId && onOpenCharacterSheet) {
        onOpenCharacterSheet(heroId);
      }
    };

    window.addEventListener('keydown', handleSheetShortcut, { capture: true });
    return () => window.removeEventListener('keydown', handleSheetShortcut, { capture: true });
  }, [selectedCombatantId, leadExplorerId, onOpenCharacterSheet]);

  // AI monster turn execution
  const activeCombatantId = viewState.combat?.activeCombatantId ?? null;
  const activeCombatant = activeCombatantId
    ? viewState.combatants[activeCombatantId] ?? null
    : null;
  const isMonsterTurn =
    viewState.mode === 'combat' &&
    Boolean(activeCombatant && activeCombatant.side === 'monster');

  // SRD-410: clear armed targeting when the turn changes.
  useEffect(() => {
    setPendingTarget({ kind: 'none' });
    pendingAttackOptsRef.current = null;
  }, [activeCombatantId]);

  const executeAiMonsterTurn = useCallback(async () => {
    if (!activeCombatant || !activeCombatantId || !isMonsterTurn || isAiThinking) {
      return;
    }

    setIsAiThinking(true);
    try {
      const auth = transport.getAuthoritativeState();
      if (!auth.combat) return;

      if (auth.combat.pendingReactionPrompt) {
        return;
      }

      const plan = planAiTurn({
        state: auth.combat,
        activeCombatantId,
        grid: auth.grid,
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

  const hasPendingReaction = Boolean(viewState.combat?.pendingReactionPrompt);

  useEffect(() => {
    if (isMonsterTurn && !isAiThinking && !hasPendingReaction) {
      aiTurnTimeoutRef.current = setTimeout(() => {
        void executeAiMonsterTurn();
      }, 500);
    }
    return () => {
      if (aiTurnTimeoutRef.current) {
        clearTimeout(aiTurnTimeoutRef.current);
      }
    };
  }, [isMonsterTurn, isAiThinking, hasPendingReaction, executeAiMonsterTurn]);

  // Adjacent props relative to lead explorer
  const adjacentProps = leadCombatant?.position
    ? getAdjacentProps(leadCombatant.position, viewState.props)
    : [];

  // Cell click handling
  const handleCellClick = async (cell: GridPoint, button?: number) => {
    if (button === 2) {
      cancelPendingTarget();
      return;
    }
    if (viewState.mode === 'exploration') {
      if (!leadCombatant) return;

      // Check if clicking directly on an adjacent interactive prop
      const clickedProp = adjacentProps.find(
        (p) => p.x === cell.x && p.y === cell.y,
      );
      if (clickedProp) {
        if (clickedProp.kind === 'door') {
          await handleDispatch({
            type: 'INTERACT_PROP',
            actorId: leadExplorerId,
            propId: clickedProp.id,
            interaction: clickedProp.state === 'open' ? 'close' : 'open',
          });
          return;
        }
        if (clickedProp.kind === 'shrine') {
          setActiveShrine(clickedProp);
          setModalState('shrine');
          return;
        }
        if (clickedProp.kind === 'chest') {
          if (clickedProp.state === 'open') {
            setModalState('loot_inventory');
            return;
          }
          await handleDispatch({
            type: 'INTERACT_PROP',
            actorId: leadExplorerId,
            propId: clickedProp.id,
            interaction: 'open',
          });
          return;
        }
      }

      // Movement path calculation for party lead
      const startPt = leadCombatant.position;
      if (startPt.x === cell.x && startPt.y === cell.y) return;

      const mover = {
        id: leadCombatant.id,
        x: leadCombatant.position.x,
        y: leadCombatant.position.y,
        size: leadCombatant.size,
        speedFeet: 30,
      };

      const pathResult = findPath({
        grid: authState.grid,
        mover,
        goal: cell,
        creatures: [],
        movementRemainingFeet: 100,
      });

      if (pathResult.found && pathResult.path.length > 1) {
        await handleDispatch({
          type: 'EXPLORE_MOVE',
          actorId: leadExplorerId,
          path: pathResult.path,
          followMarchingOrder: true,
        });
      }
    } else if (viewState.mode === 'combat') {
      // SRD-410 manual targeting: armed AOE origin selection first; while a
      // single/multi pick is armed, cell clicks never move.
      if (pendingTarget.kind === 'aoe') {
        if (!activeCombatant) return;
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

      // In combat mode, handle combat movement
      if (!activeCombatant || activeCombatant.side === 'monster') return;

      const startPt = activeCombatant.position;
      if (startPt.x === cell.x && startPt.y === cell.y) return;

      const mover = {
        id: activeCombatant.id,
        x: activeCombatant.position.x,
        y: activeCombatant.position.y,
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

      const movementBudget =
        viewState.combat?.turnBudget?.movementRemainingFeet ?? 30;
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
    }
  };

  // SRD-410: token click handler for manual targeting picks. Targeting
  // clicks commit the armed action and must NOT change selection; plain
  // inspect clicks only change selection.
  const handleCombatantClickForTarget = useCallback(
    (combatantId: string) => {
      if (viewState.mode !== 'combat' || !activeCombatant || isMonsterTurn) {
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
      const auth = getAuthState();
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
          // Toggle off (distinct mode); stacked mode keeps stacking.
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
      // AOE: token clicks never change selection while armed; origin comes from cell clicks.
    },
    [viewState, activeCombatant, isMonsterTurn, pendingTarget, getAuthState, handleDispatch, showFeedback],
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
    const auth = getAuthState();
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
  }, [pendingTarget, activeCombatantId, activeCombatant, compendium, getAuthState, viewState.combatants, handleDispatch, showFeedback]);

  // SRD-410: commit armed AOE origin.
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

  // Descend stairs handler
  const handleDescendStairs = () => {
    if (dungeonMode === 'realm_delve') {
      if (!rogueliteState) return;
      const delve = rogueliteState.runState as RealmDelveState;
      const currentAuth = getAuthState();
      if (canAdvanceRealmDelve(delve)) {
        const nextSess = advanceRealmDelveFloor(delve, currentAuth, compendium);
        setRogueliteState({
          runState: nextSess.delve,
          floor: nextSess.generatedFloor.floor,
        });
        setTransport(
          new LocalTransport({
            initialState: nextSess.gameState,
            defaultPlayerId: 'player-1',
          }),
        );
      } else {
        // Descending the final floor's stairs clears the bounded delve.
        const completed = completeRealmDelve(delve, currentAuth, { cleared: true });
        setRogueliteState((prev) => (prev ? { ...prev, runState: completed } : null));
        resolveDelveOnce(completed, currentAuth);
      }
      return;
    }

    if (dungeonMode === 'roguelite') {
      if (!rogueliteState) return;
      const currentAuth = getAuthState();
      const nextSess = advanceRogueliteFloor(
        rogueliteState.runState,
        currentAuth,
        compendium,
      );
      const nextTransport = new LocalTransport({
        initialState: nextSess.gameState,
        defaultPlayerId: 'player-1',
      });
      setRogueliteState({
        runState: nextSess.runState,
        floor: nextSess.generatedFloor.floor,
      });
      setTransport(nextTransport);
      return;
    }

    let nextFloorId: string | null = null;
    if (currentFloorId === 'kaelen-floor-1') nextFloorId = 'kaelen-floor-2';
    else if (currentFloorId === 'kaelen-floor-2') nextFloorId = 'kaelen-floor-3';

    if (!nextFloorId) return;

    const nextSpec = getCampaignFloor(campaignModule, nextFloorId);
    if (!nextSpec) return;

    const currentAuth = getAuthState();
    const { transport: nextTransport } = transitionToNextFloor(
      currentAuth,
      nextSpec,
      compendium,
    );

    setCurrentFloorId(nextFloorId);
    setTransport(nextTransport);
  };

  // Shrine activation handler
  const handleActivateShrine = async (propId: string) => {
    if (isRunMode && rogueliteState) {
      const currentAuth = getAuthState();
      const shrineRes = activateShrine(
        rogueliteState.runState,
        currentAuth,
        propId,
        leadExplorerId,
      );
      const nextTransport = new LocalTransport({
        initialState: shrineRes.nextGameState,
        defaultPlayerId: 'player-1',
      });
      setRogueliteState((prev) =>
        prev ? { ...prev, runState: shrineRes.nextRunState } : null,
      );
      setTransport(nextTransport);
      setEvents((prev) => [...prev, ...shrineRes.events]);
      return;
    }
    await handleDispatch({
      type: 'ACTIVATE_SHRINE',
      actorId: leadExplorerId,
      shrineId: propId,
    });
  };

  // Start new roguelite descent from Graveyard
  const handleStartNewDescent = () => {
    const sess = buildRogueliteSession(partyCharacters, compendium);
    setRogueliteState({
      runState: sess.session.runState,
      floor: sess.session.generatedFloor.floor,
    });
    setTransport(sess.transport);
    setModalState(null);
    setGraveyardEntry(null);
  };

  // Ascend stairs handler
  const handleAscendStairs = () => {
    let prevFloorId: string | null = null;
    if (currentFloorId === 'kaelen-floor-3') prevFloorId = 'kaelen-floor-2';
    else if (currentFloorId === 'kaelen-floor-2') prevFloorId = 'kaelen-floor-1';

    if (!prevFloorId) return;

    const prevSpec = getCampaignFloor(campaignModule, prevFloorId);
    if (!prevSpec) return;

    const currentAuth = getAuthState();
    const { transport: nextTransport } = transitionToNextFloor(
      currentAuth,
      prevSpec,
      compendium,
    );

    setCurrentFloorId(prevFloorId);
    setTransport(nextTransport);
  };

  // SRD-410 derived targeting overlay state (AOE preview + commit bar).
  const activeTeamId =
    activeCombatant?.teamId ?? activeCombatant?.side ?? 'party';
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
  const friendlyFireOff = getAuthState().combat?.friendlyFireEnabled === false;
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

  return (
    <div
      data-testid="dungeon-view-container"
      className="fixed inset-0 z-40 w-screen h-screen overflow-hidden bg-slate-950 select-none shadow-2xl"
    >
      {/* Action feedback banner */}
      {actionFeedback && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-red-950/95 border border-red-500 text-red-200 rounded-lg text-xs font-semibold shadow-2xl flex items-center gap-2 pointer-events-none">
          <span>⚠️</span>
          <span>{actionFeedback}</span>
        </div>
      )}

      {/* COMBAT MODE: Full-bleed BG3-docked TacticalCombatHud wrapping TacticalCanvasViewport */}
      {viewState.mode === 'combat' ? (
        <>
        <TacticalCombatHud
          className="w-full h-full"
          viewState={viewState}
          compendium={compendium}
          selectedCombatantId={selectedCombatantId}
          title={
            dungeonMode === 'realm_delve' && activeDelve
              ? `${activeDelve.poiName} — Depth ${activeDelve.currentDepth}/${activeDelve.finalDepth}`
              : dungeonMode === 'roguelite'
                ? `The Deep Descent — Depth ${rogueliteState?.runState.currentDepth ?? 1}`
                : `${campaignModule.name} — ${floorSpec.name}`
          }
          subtitle={
            isRunMode && rogueliteState
              ? `${rogueliteState.floor.name} · Rations: ${rogueliteState.runState.suppliesRemaining}`
              : "Combat Encounter in Progress"
          }
          headerExtras={
            isRunMode && rogueliteState ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  🍖 {rogueliteState.runState.suppliesRemaining} Rations
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
                  ⭐ {rogueliteState.runState.score.toLocaleString()} pts
                </span>
              </div>
            ) : undefined
          }
          onToggleMenu={() => setModalState('pause_menu')}
          menuButtonText="⚙️ Menu"
          menuButtonTestId="combat-hud-system-menu-btn"
          events={events}
          activeRoll={activeRoll}
          rollHistory={rollHistory}
          isPlayerControlled={!isMonsterTurn}
          onSelectCombatant={handleCombatantClickForTarget}
          onOpenCharacterSheet={onOpenCharacterSheet}
          onLevelUpCharacter={handleOpenLevelUp}
          onDeclareAttack={(weapon, opts) => {
            if (!activeCombatantId || !activeCombatant) return;
            // SRD-410: arm manual targeting; click a token to commit.
            // (Replaces the old nearest-enemy auto-pick.)
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
            void handleDispatch({
              type: 'END_TURN',
              actorId: activeCombatantId,
            });
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
            stacks above the z-30 docked hotbar instead of behind it. */}
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
        </>
      ) : (
        /* EXPLORATION MODE */
        <div className="relative w-full h-full flex flex-col overflow-hidden">
          {/* Run-loop Top Status HUD (Descent + Realm delves) */}
          {isRunMode && rogueliteState && (
            <RogueliteHud
              runState={rogueliteState.runState}
              onOpenRestCamp={() => setModalState('rest_camp')}
            />
          )}

          <div className="relative flex-1 min-h-0 w-full overflow-hidden">
            <TacticalCanvasViewport
              grid={viewState.grid}
              combatants={viewState.party}
              selectedCombatantId={selectedCombatantId}
              activeCombatantId={leadExplorerId}
              hoveredCell={hoveredCell}
              onCellHover={setHoveredCell}
              onCellClick={handleCellClick}
              onCombatantClick={(combatantId) => setSelectedCombatantId(combatantId)}
              enableHoverPathPreview={true}
              enableFogOfWar={true}
              showTokenHpArcs={true}
              showConditionBadges={true}
              showTokenNames={true}
              props={viewState.props ?? []}
              className="w-full h-full"
            />

            <DungeonExplorationHud
              viewState={viewState}
              gameState={authState}
              compendium={compendium}
              campaignName={campaignModule.name}
              floorSpec={floorSpec}
              leadExplorerId={leadExplorerId}
              inStealth={authState.partyInStealth ?? false}
              formation={marchingConfig.formation}
              adjacentProps={adjacentProps}
              hasUnclaimedLoot={Boolean(activeLoot)}
              onToggleStealth={() =>
                handleDispatch({
                  type: 'SET_PARTY_STEALTH',
                  inStealth: !authState.partyInStealth,
                })
              }
              onOpenMarchingOrder={() => setModalState('marching_order')}
              onOpenRestCamp={() => setModalState('rest_camp')}
              onOpenLootInventory={() => setModalState('loot_inventory')}
              onOpenSaveLoad={() => setModalState('save_load')}
              onOpenPauseMenu={() => setModalState('pause_menu')}
              onPerformSearch={() =>
                handleDispatch({
                  type: 'EXPLORE_SEARCH',
                  actorId: leadExplorerId,
                })
              }
              onSelectLeadExplorer={(id) =>
                handleDispatch({
                  type: 'SET_MARCHING_ORDER',
                  leadExplorerId: id,
                })
              }
              onInspectCharacter={onOpenCharacterSheet}
              onInteractProp={(propId, interaction) => {
                const p = adjacentProps.find((pr) => pr.id === propId);
                if (p && p.kind === 'shrine') {
                  setActiveShrine(p);
                  setModalState('shrine');
                  return;
                }
                handleDispatch({
                  type: 'INTERACT_PROP',
                  actorId: leadExplorerId,
                  propId,
                  interaction,
                });
              }}
              onDescendStairs={
                adjacentProps.some((p) => p.kind === 'stairs_down')
                  ? handleDescendStairs
                  : undefined
              }
              onAscendStairs={
                adjacentProps.some((p) => p.kind === 'stairs_up')
                  ? handleAscendStairs
                  : undefined
              }
              onExitDelve={onExitToRoster}
            />
          </div>
        </div>
      )}

      {/* Marching Order Modal */}
      <MarchingOrderModal
        isOpen={modalState === 'marching_order'}
        marchingOrder={marchingConfig}
        party={viewState.party}
        onClose={() => setModalState(null)}
        onApplyMarchingOrder={(order, formation, leadId) =>
          handleDispatch({
            type: 'SET_MARCHING_ORDER',
            marchingOrder: order,
            formation,
            leadExplorerId: leadId,
          })
        }
      />

      {/* Rest Camp Modal */}
      <RestCampModal
        isOpen={modalState === 'rest_camp'}
        party={viewState.party}
        compendium={compendium}
        isSafeRoom={
          leadCombatant?.position
            ? authState.grid.cells[
                leadCombatant.position.y * authState.grid.width +
                  leadCombatant.position.x
              ]?.roomId
              ? authState.dungeon?.rooms[
                  authState.grid.cells[
                    leadCombatant.position.y * authState.grid.width +
                      leadCombatant.position.x
                  ]!.roomId!
                ]?.isSafeRoom ?? false
              : false
            : false
        }
        currentRoomName={
          leadCombatant?.position
            ? authState.grid.cells[
                leadCombatant.position.y * authState.grid.width +
                  leadCombatant.position.x
              ]?.roomId
              ? authState.dungeon?.rooms[
                  authState.grid.cells[
                    leadCombatant.position.y * authState.grid.width +
                      leadCombatant.position.x
                  ]!.roomId!
                ]?.name
              : undefined
            : undefined
        }
        onClose={() => setModalState(null)}
        onStartShortRest={(hitDiceToSpend) =>
          handleDispatch({
            type: 'START_REST',
            restType: 'short',
            hitDiceToSpend,
          })
        }
        onStartLongRest={(options) => {
          if (isRunMode && rogueliteState) {
            const currentAuth = getAuthState();
            const restRes = resolveRogueliteLongRest(
              rogueliteState.runState,
              currentAuth,
              {
                forceSafe: options?.forceSafe,
                compendium,
              },
            );
            const nextTransport = new LocalTransport({
              initialState: restRes.nextGameState,
              defaultPlayerId: 'player-1',
            });
            setRogueliteState((prev) =>
              prev ? { ...prev, runState: restRes.nextRunState } : null,
            );
            setTransport(nextTransport);
            setEvents((prev) => [...prev, ...restRes.events]);
            if (restRes.nextRunState.isComplete) {
              if (dungeonMode === 'realm_delve') {
                // Starvation wipe concludes the POI delve and commits back.
                const completed = completeRealmDelve(
                  restRes.nextRunState as RealmDelveState,
                  restRes.nextGameState,
                  { cleared: false },
                );
                setRogueliteState((prev) => (prev ? { ...prev, runState: completed } : null));
                resolveDelveOnce(completed, restRes.nextGameState);
              } else if (restRes.nextRunState.graveyardEntry) {
                saveGraveyardEntry(restRes.nextRunState.graveyardEntry);
                setGraveyardEntry(restRes.nextRunState.graveyardEntry);
                setModalState('graveyard');
              }
            }
            return;
          }
          handleDispatch({
            type: 'START_REST',
            restType: 'long',
            forceSafe: options?.forceSafe,
          });
        }}
      />

      {/* Loot & Inventory Modal */}
      <LootInventoryModal
        isOpen={modalState === 'loot_inventory'}
        party={viewState.party}
        initialHeroId={selectedCombatantId ?? leadExplorerId}
        compendium={compendium}
        activeLoot={activeLoot}
        onClose={() => {
          setModalState(null);
          setActiveLoot(null);
        }}
        onClaimLoot={(charId, propId, loot) =>
          handleDispatch({
            type: 'CLAIM_LOOT',
            characterId: charId,
            propId,
            loot,
          })
        }
        onEquipItem={(charId, slotName, instId) => {
          const charSheet = authState.party[charId]?.characterSheet as any;
          const currentSlots = charSheet?.equippedSlots ?? {};
          handleDispatch({
            type: 'EQUIP_LOADOUT',
            characterId: charId,
            equippedSlots: {
              ...currentSlots,
              [`${slotName}InstanceId`]: instId,
            },
          });
        }}
        onAttuneItem={(charId, instId) =>
          handleDispatch({
            type: 'ATTUNE_ITEM',
            characterId: charId,
            itemInstanceId: instId,
          })
        }
        onUnattuneItem={(charId, instId) =>
          handleDispatch({
            type: 'UNATTUNE_ITEM',
            characterId: charId,
            itemInstanceId: instId,
          })
        }
      />

      {/* Save & Load Modal */}
      <SaveLoadModal
        isOpen={modalState === 'save_load'}
        gameState={authState}
        campaignId={campaignModule.id}
        campaignName={campaignModule.name}
        floorName={floorSpec.name}
        onClose={() => setModalState(null)}
        onSaveToSlot={async () => {
          // Handled inside SaveLoadModal
        }}
        onLoadFromSlot={async (slotId) => {
          const { loadDungeonGameFromSlot } = await import(
            '../../persistence/index.js'
          );
          const loaded = await loadDungeonGameFromSlot(slotId);
          if (loaded) {
            const nextTransport = new LocalTransport({
              initialState: loaded.gameState,
              defaultPlayerId: 'player-1',
            });
            setTransport(nextTransport);
            if (loaded.floorId) {
              setCurrentFloorId(loaded.floorId);
            }
          }
        }}
        onImportSaveState={(importedState) => {
          const nextTransport = new LocalTransport({
            initialState: importedState,
            defaultPlayerId: 'player-1',
          });
          setTransport(nextTransport);
          if (importedState.dungeon?.floorId) {
            setCurrentFloorId(importedState.dungeon.floorId);
          }
        }}
      />

      {/* Universal Pause / System Menu */}
      <PauseMenuModal
        isOpen={modalState === 'pause_menu'}
        onClose={() => setModalState(null)}
        gameState={authState}
        campaignId={campaignModule.id}
        campaignName={campaignModule.name}
        floorName={floorSpec.name}
        party={authState.party}
        storageAdapter={storageAdapter}
        onQuickSave={async () => {
          await quickSaveDungeonGame(
            authState,
            {
              campaignId: campaignModule.id,
              campaignName: campaignModule.name,
              floorName: floorSpec.name,
            },
            storageAdapter,
          );
          showFeedback('Game quicksaved successfully!');
        }}
        onSaveToSlot={async (slotId, label) => {
          await saveDungeonGameToSlot(
            slotId,
            label,
            authState,
            {
              campaignId: campaignModule.id,
              campaignName: campaignModule.name,
              floorName: floorSpec.name,
            },
            storageAdapter,
          );
          showFeedback(`Game saved to ${label}!`);
        }}
        onLoadFromSlot={async (slotId) => {
          const { loadDungeonGameFromSlot } = await import(
            '../../persistence/index.js'
          );
          const loaded = await loadDungeonGameFromSlot(slotId, storageAdapter);
          if (loaded) {
            const nextTransport = new LocalTransport({
              initialState: loaded.gameState,
              defaultPlayerId: 'player-1',
            });
            setTransport(nextTransport);
            setViewState(nextTransport.getPlayerViewState());
            if (loaded.floorId) {
              setCurrentFloorId(loaded.floorId);
            }
            setModalState(null);
            showFeedback(`Loaded game from ${loaded.slotName || loaded.slotId}!`);
          }
        }}
        onOpenCharacterSheet={(charId) => {
          setModalState(null);
          if (onOpenCharacterSheet) {
            onOpenCharacterSheet(charId);
          }
        }}
        onOpenInventory={() => {
          setModalState('loot_inventory');
        }}
        onExitToTitle={onExitToRoster}
      />

      {/* Level-Up Modal */}
      {levelUpCharacter && (
        <LevelUpModal
          character={levelUpCharacter}
          compendium={compendium}
          onClose={() => setLevelUpCharacter(null)}
          onApplyLevelUp={(updatedChar) => {
            // Apply level up
            setLevelUpCharacter(null);
          }}
        />
      )}

      {/* Campaign Victory Modal */}
      {campaignVictory && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-300"
        >
          <div className="w-full max-w-md rounded-2xl border border-amber-500/80 bg-slate-900 p-6 text-center text-slate-100 shadow-[0_0_50px_rgba(245,158,11,0.25)] space-y-4">
            <span className="text-5xl block animate-bounce">🏆</span>
            <h2 className="text-2xl font-black text-amber-400">
              Campaign Victory!
            </h2>
            <div className="text-sm font-semibold text-slate-200">
              The Sunken Crypt of Kaelen Has Been Cleared!
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Wight Lord Kaelen and his undead legion have been vanquished. Your party
              emerges from the crypt laden with ancient treasure, magical relics, and
              immortal glory across the realm!
            </p>
            <button
              type="button"
              data-testid="campaign-victory-return-btn"
              onClick={onExitToRoster}
              className="w-full py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-sm shadow-lg transition-all"
            >
              Return to Party Tavern
            </button>
          </div>
        </div>
      )}

      {/* Shrine of Fate Modal */}
      <ShrineModal
        isOpen={modalState === 'shrine'}
        shrine={activeShrine}
        actorName={leadCombatant?.name ?? 'Party Lead'}
        onClose={() => {
          setModalState(null);
          setActiveShrine(null);
        }}
        onActivate={handleActivateShrine}
      />

      {/* Roguelite Graveyard & Hall of the Slain Modal */}
      <GraveyardModal
        isOpen={modalState === 'graveyard'}
        currentEntry={graveyardEntry}
        onStartNewRun={handleStartNewDescent}
        onExitToRoster={onExitToRoster}
      />
    </div>
  );
}
