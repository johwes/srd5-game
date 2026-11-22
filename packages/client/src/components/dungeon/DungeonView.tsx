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
  type PropInteractionKind,
  type RealmDelveState,
  activateShrine,
  advanceRealmDelveFloor,
  advanceRogueliteFloor,
  calculateGoldFromLoot,
  canAdvanceRealmDelve,
  checkRogueliteWipe,
  collectVeteranCandidates,
  completeRealmDelve,
  endRogueliteRun,
  findPath,
  getAvailablePropInteractions,
  isLairFloorCleared,
  planAiTurn,
  planVeteranRetirement,
  recordRunMonstersSlain,
  resolveRogueliteLongRest,
  truncatePathToBudget,
  type VeteranRosterEntry,
} from '@srd5/engine';
import { LocalTransport, type PlayerViewProp, type PlayerViewState } from '@srd5/transport';
import { useEscHandler, ESC_PRIORITY } from '../../hooks/useEscStack.js';
import { TacticalCanvasViewport } from '../../canvas/index.js';
import { TacticalCombatHud, TargetingCommitBar, useManualTargeting } from '../combat/index.js';
import { LevelUpModal } from '../roster/index.js';
import { DungeonExplorationHud } from './DungeonExplorationHud.js';
import { PropInteractionCard } from './PropInteractionCard.js';
import { LootInventoryModal } from './LootInventoryModal.js';
import { MarchingOrderModal } from './MarchingOrderModal.js';
import { RestCampModal } from './RestCampModal.js';
import { SaveLoadModal } from './SaveLoadModal.js';
import { ShrineModal } from './ShrineModal.js';
import { GraveyardModal } from './GraveyardModal.js';
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
  loadVeteranRoster,
  quickSaveDungeonGame,
  saveDungeonGameToSlot,
  saveVeteranRoster,
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
  /** SRD-1005: Daily Descent run options */
  isDaily?: boolean;
  dailyDate?: string;
  seed?: number;
  /** SRD-1403: Civ setup-screen session config. */
  worldOptions?: import('@srd5/engine').WorldOptions;
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
  isDaily,
  dailyDate,
  seed,
  worldOptions,
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
      const sess = buildRogueliteSession(partyCharacters, compendium, seed ?? worldOptions?.seed, {
        isDaily,
        dailyDate,
        ...(worldOptions ? { worldOptions } : {}),
      });
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
      const sess = buildRogueliteSession(partyCharacters, compendium, seed ?? worldOptions?.seed, {
        isDaily,
        dailyDate,
        ...(worldOptions ? { worldOptions } : {}),
      });
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
  // SRD-510 click-to-inspect: prop id whose interaction card is open.
  // Visibility is derived (card shows only while the prop is adjacent).
  const [inspectedPropId, setInspectedPropId] = useState<string | null>(null);
  // Latest manual-targeting API for the Escape handler below (the hook
  // itself is instantiated after the active combatant is resolved).
  const [graveyardEntry, setGraveyardEntry] = useState<GraveyardEntry | null>(null);
  // SRD-1405: living heroes (level 3+) offered retirement at run conclusion,
  // plus the persisted veteran roster they retire into.
  const [retirementCandidates, setRetirementCandidates] = useState<CharacterBuildState[]>([]);
  const [veteranRoster, setVeteranRoster] = useState<VeteranRosterEntry[]>([]);

  useEffect(() => {
    let active = true;
    void loadVeteranRoster().then((loaded) => {
      if (active) setVeteranRoster(loaded);
    });
    return () => {
      active = false;
    };
  }, []);

  // SRD-1405: retire a concluded run's hero into the persistent roster.
  const handleRetireVeteran = useCallback(
    (heroId: string, confirmRelease: boolean) => {
      const hero = retirementCandidates.find((c) => c.id === heroId);
      if (!hero) return;
      const planned = planVeteranRetirement(veteranRoster, [hero], {
        runId: graveyardEntry?.runId,
        source: 'descent',
        confirmRelease,
      });
      // The offer UI previews a full roster and asks for confirmation first,
      // so a pending plan here means a stale roster — reload and bail out.
      if (planned.requiresConfirmation) {
        void loadVeteranRoster().then(setVeteranRoster);
        return;
      }
      setVeteranRoster(planned.roster);
      setRetirementCandidates((prev) => prev.filter((c) => c.id !== heroId));
      void saveVeteranRoster(planned.roster);
    },
    [retirementCandidates, veteranRoster, graveyardEntry],
  );
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

  // Escape-key priority stack (BG3 layering: armed targeting > prop card >
  // modal / pause menu). Registered on the shared useEscStack — a single
  // global listener dispatches to the topmost layer only.

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
            // SRD-1405: offer retirement to surviving leveled heroes.
            setRetirementCandidates(collectVeteranCandidates(auth.party));
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

  // AI monster turn execution
  const activeCombatantId = viewState.combat?.activeCombatantId ?? null;
  const activeCombatant = activeCombatantId
    ? viewState.combatants[activeCombatantId] ?? null
    : null;
  const isMonsterTurn =
    viewState.mode === 'combat' &&
    Boolean(activeCombatant && activeCombatant.side === 'monster');

  // Keep selected party hero synced with the active turn in combat and the lead
  // explorer in exploration so opening Character Sheet / Inventory targets the
  // currently active hero rather than reverting to party slot 1.
  useEffect(() => {
    if (
      viewState.mode === 'combat' &&
      activeCombatantId &&
      viewState.party[activeCombatantId]
    ) {
      setSelectedCombatantId(activeCombatantId);
    }
  }, [viewState.mode, activeCombatantId, viewState.party]);

  useEffect(() => {
    if (viewState.mode === 'exploration' && leadExplorerId && viewState.party[leadExplorerId]) {
      setSelectedCombatantId(leadExplorerId);
    }
  }, [viewState.mode, leadExplorerId, viewState.party]);

  const selectedPartyHeroId =
    selectedCombatantId && viewState.party[selectedCombatantId]
      ? selectedCombatantId
      : null;
  const activeTurnHeroId =
    viewState.mode === 'combat' &&
    activeCombatantId &&
    viewState.party[activeCombatantId]
      ? activeCombatantId
      : null;
  const focusedPartyHeroId =
    selectedPartyHeroId ??
    activeTurnHeroId ??
    (viewState.party[leadExplorerId] ? leadExplorerId : (partyList[0]?.id ?? null));

  // Targeting-aware Character Sheet shortcut ('C' / 'I'): opens the sheet for
  // the currently focused party hero (selected party member -> active combat
  // turn hero -> lead explorer). Registered on capture so the App-level
  // fallback (which always opens the first party member) never fires while the
  // dungeon view is mounted.
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
      if (focusedPartyHeroId && onOpenCharacterSheet) {
        onOpenCharacterSheet(focusedPartyHeroId);
      }
    };

    window.addEventListener('keydown', handleSheetShortcut, { capture: true });
    return () => window.removeEventListener('keydown', handleSheetShortcut, { capture: true });
  }, [focusedPartyHeroId, onOpenCharacterSheet]);

  const hasPendingReaction = Boolean(viewState.combat?.pendingReactionPrompt);

  // SRD-410 shared manual targeting (armed pending target, token pick
  // commits, AOE origin/bearing preview, commit bar). Replaces the old
  // nearest-enemy auto-pick in combat mode.
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
    getCombatContext: () => ({
      dispositionMatrix: getAuthState().combat?.dispositionMatrix,
      friendlyFireEnabled: getAuthState().combat?.friendlyFireEnabled,
    }),
    onInspectCombatant: (id) => setSelectedCombatantId(id),
  });
  // Escape-key priority stack (BG3 layering), registered after the targeting
  // hook exists so `active` reads live render state (no stale-ref timing gap).
  // A single global listener dispatches each Escape press to the topmost layer.
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
  useEscHandler(
    () => {
      setInspectedPropId(null);
      return true;
    },
    { priority: ESC_PRIORITY.modal, active: inspectedPropId !== null },
  );
  useEscHandler(
    () => {
      setModalState((current) => {
        if (current === 'pause_menu') {
          return null; // Resume Game
        }
        if (current !== null) {
          return null; // Close any active submodal
        }
        return 'pause_menu'; // Open Pause Menu
      });
      return true;
    },
    { priority: ESC_PRIORITY.base },
  );

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
        try {
          await transport.dispatch(cmd);
        } catch (cmdErr) {
          const msg = cmdErr instanceof Error ? cmdErr.message : String(cmdErr);
          // Stale over-budget AI paths (e.g. hazard difficult applied at
          // execution) must not cost the monster its attacks: skip the move
          // and continue with the remaining plan (attack + END_TURN).
          if (cmd.type === 'COMBAT_MOVE' && msg.includes('Not enough movement')) {
            console.warn('[AI] Skipping over-budget monster move, continuing plan:', msg);
            continue;
          }
          throw cmdErr;
        }
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

  // SRD-510 inspected prop: full authoritative record for check previews,
  // visible only while it stays adjacent (auto-dismisses when walking away).
  const inspectedProp = inspectedPropId
    ? (getAuthState().props.find((p) => p.id === inspectedPropId) ?? null)
    : null;
  const inspectedPropAdjacent =
    inspectedProp !== null && adjacentProps.some((p) => p.id === inspectedProp.id);
  const visibleInspectedProp = inspectedPropAdjacent ? inspectedProp : null;
  const inspectedPropOptions = visibleInspectedProp
    ? getAvailablePropInteractions(visibleInspectedProp, leadCombatant ?? undefined)
    : [];

  const handleCardInteract = useCallback(
    (propId: string, interaction: PropInteractionKind) => {
      const target = getAuthState().props.find((p) => p.id === propId);
      if (target?.kind === 'shrine' && interaction === 'open') {
        setActiveShrine(target);
        setModalState('shrine');
        setInspectedPropId(null);
        return;
      }
      if (interaction === 'listen') {
        void handleDispatch({ type: 'LISTEN_AT_DOOR', actorId: leadExplorerId, propId });
        return;
      }
      void handleDispatch({
        type: 'INTERACT_PROP',
        actorId: leadExplorerId,
        propId,
        interaction,
      });
      // Keep the card open on state-changing actions so the player sees the
      // result (it auto-dismisses when walking away). Close on explicit close.
      if (interaction === 'close') {
        setInspectedPropId(null);
      }
    },
    [getAuthState, handleDispatch, leadExplorerId],
  );

  // Latest listen result for the inspected prop (CHECK_RESOLVED carries the
  // hint in `note`; searching the same prop never sets one).
  const inspectedPropListenNote = (() => {
    if (!visibleInspectedProp) return null;
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i]!;
      if (ev.type === 'CHECK_RESOLVED' && ev.targetId === visibleInspectedProp.id && typeof ev.note === 'string') {
        return ev.note;
      }
    }
    return null;
  })();

  // Cell click handling. SRD-410 manual targeting consumes combat clicks
  // while an action is armed (right-click cancels).
  const handleCellClick = async (cell: GridPoint, button?: number) => {
    if (viewState.mode === 'exploration') {
      if (!leadCombatant) return;

      // Check if clicking directly on an adjacent interactive prop:
      // SRD-510 opens the interaction card instead of acting immediately.
      const clickedProp = adjacentProps.find(
        (p) => p.x === cell.x && p.y === cell.y,
      );
      if (clickedProp) {
        if (clickedProp.kind === 'chest' && clickedProp.state === 'open') {
          setModalState('loot_inventory');
          return;
        }
        // SRD-1307: corpses holding unclaimed drops open the per-corpse loot
        // card; unsearched remains open the inspect card first (Search the
        // Fallen), fully-looted remains stay inert.
        if (clickedProp.kind === 'corpse') {
          const authProp = getAuthState().props.find((p) => p.id === clickedProp.id);
          if (!authProp?.lootTable) return;
          if (authProp.searched !== true) {
            setInspectedPropId(clickedProp.id);
            return;
          }
          setActiveLoot({
            sourcePropId: authProp.id,
            sourceName: authProp.label ?? authProp.id.replace(/[-_]/g, ' '),
            bundle: authProp.lootTable,
          });
          setInspectedPropId(null);
          setModalState('loot_inventory');
          return;
        }
        if (clickedProp.kind !== 'stairs_down' && clickedProp.kind !== 'stairs_up') {
          setInspectedPropId(clickedProp.id);
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
      // SRD-410 manual targeting consumes the click while an action is armed.
      if (manualTargeting.handleCombatCellClick(cell, button)) return;

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

  // Shrine activation handler (SRD-1404: cursed shrines pass an offering)
  const handleActivateShrine = async (propId: string, offering?: 'hp' | 'gp' | 'decline') => {
    if (isRunMode && rogueliteState) {
      const currentAuth = getAuthState();
      const shrineRes = activateShrine(
        rogueliteState.runState,
        currentAuth,
        propId,
        leadExplorerId,
        offering ? { offering } : undefined,
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
      ...(offering ? { offering } : {}),
    });
  };

  // Start new roguelite descent from Graveyard
  const handleStartNewDescent = () => {
    const sess = buildRogueliteSession(partyCharacters, compendium, seed ?? worldOptions?.seed, {
      isDaily,
      dailyDate,
      ...(worldOptions ? { worldOptions } : {}),
    });
    setRogueliteState({
      runState: sess.session.runState,
      floor: sess.session.generatedFloor.floor,
    });
    setTransport(sess.transport);
    setModalState(null);
    setGraveyardEntry(null);
    setRetirementCandidates([]);
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
          onSelectCombatant={manualTargeting.handleCombatantClick}
          onOpenCharacterSheet={onOpenCharacterSheet}
          onLevelUpCharacter={handleOpenLevelUp}
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
              itemInstanceId,
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
            stacks above the z-30 docked hotbar instead of behind it. */}
        <TargetingCommitBar
          pendingTarget={manualTargeting.pendingTarget}
          pendingAoeFoes={manualTargeting.pendingAoeFoes}
          pendingAoeAllies={manualTargeting.pendingAoeAllies}
          pendingMultiNames={manualTargeting.pendingMultiNames}
          friendlyFireOff={manualTargeting.friendlyFireOff}
          onConfirmMulti={manualTargeting.handleCommitMulti}
          onConfirmAoe={manualTargeting.handleCommitAoe}
          onCancel={manualTargeting.cancelPendingTarget}
        />
        </>
      ) : (
        /* EXPLORATION MODE */
        <div className="relative w-full h-full flex flex-col overflow-hidden">
          <div className="relative flex-1 min-h-0 w-full overflow-hidden">
            <TacticalCanvasViewport
              grid={viewState.grid}
              combatants={viewState.party}
              selectedCombatantId={selectedCombatantId}
              activeCombatantId={leadExplorerId}
              hoveredCell={hoveredCell}
              onCellHover={setHoveredCell}
              onCellClick={handleCellClick}
              onCombatantClick={(combatantId) => {
                setSelectedCombatantId(combatantId);
                if (viewState.party[combatantId]) {
                  void handleDispatch({
                    type: 'SET_MARCHING_ORDER',
                    leadExplorerId: combatantId,
                  });
                }
              }}
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
              selectedProp={visibleInspectedProp}
              runState={isRunMode && rogueliteState ? rogueliteState.runState : null}
              onInspectProp={(id) =>
                setInspectedPropId((prev) => (prev === id ? null : id))
              }
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
              onSelectLeadExplorer={(id) => {
                setSelectedCombatantId(id);
                void handleDispatch({
                  type: 'SET_MARCHING_ORDER',
                  leadExplorerId: id,
                });
              }}
              onInspectCharacter={onOpenCharacterSheet}
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

            {/* SRD-510 inspected prop interaction card */}
            {visibleInspectedProp && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 w-full max-w-xl px-3 pointer-events-none">
                <PropInteractionCard
                  prop={visibleInspectedProp}
                  options={inspectedPropOptions}
                  resultNote={inspectedPropListenNote}
                  onInteract={handleCardInteract}
                  onClose={() => setInspectedPropId(null)}
                  onTakeLoot={
                    visibleInspectedProp.kind === 'corpse' &&
                    visibleInspectedProp.lootTable
                      ? (propId) => {
                          const target = getAuthState().props.find((p) => p.id === propId);
                          if (!target?.lootTable) return;
                          setActiveLoot({
                            sourcePropId: target.id,
                            sourceName:
                              target.label ?? target.id.replace(/[-_]/g, ' '),
                            bundle: target.lootTable,
                          });
                          setInspectedPropId(null);
                          setModalState('loot_inventory');
                        }
                      : undefined
                  }
                  onUseShrine={(propId) => {
                    const target = getAuthState().props.find((p) => p.id === propId);
                    if (target) {
                      setActiveShrine(target);
                      setModalState('shrine');
                      setInspectedPropId(null);
                    }
                  }}
                />
              </div>
            )}
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
                // SRD-1405: offer retirement to surviving leveled heroes.
                setRetirementCandidates(
                  collectVeteranCandidates(restRes.nextGameState.party),
                );
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
        initialHeroId={focusedPartyHeroId}
        compendium={compendium}
        activeLoot={(() => {
          // Resolve the bundle live from authoritative state so BG3-style
          // per-item takes shrink the box without a stale snapshot. Fully
          // looted props resolve to null and the modal falls back to inventory.
          if (!activeLoot) return null;
          if (!activeLoot.sourcePropId) return activeLoot;
          const liveTable = authState.props.find((p) => p.id === activeLoot.sourcePropId)?.lootTable as
            | typeof activeLoot.bundle
            | undefined;
          return liveTable ? { ...activeLoot, bundle: liveTable } : null;
        })()}
        onClose={() => {
          setModalState(null);
          setActiveLoot(null);
        }}
        onClaimLoot={(charId, propId, loot, itemIndex, takeCoins) =>
          handleDispatch({
            type: 'CLAIM_LOOT',
            characterId: charId,
            propId,
            loot,
            ...(itemIndex !== undefined ? { itemIndex } : {}),
            ...(takeCoins ? { takeCoins } : {}),
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
        onUseItem={(charId, instId) =>
          handleDispatch({
            type: 'USE_ITEM',
            actorId: charId,
            itemInstanceId: instId,
          })
        }
        onTransferItem={(fromCharId, instId, toCharId) =>
          handleDispatch({
            type: 'TRANSFER_ITEM',
            fromCharacterId: fromCharId,
            toCharacterId: toCharId,
            itemInstanceId: instId,
          })
        }
        onDropItem={(charId, instId) =>
          handleDispatch({
            type: 'DROP_ITEM',
            characterId: charId,
            itemInstanceId: instId,
          })
        }
        onSplitStack={(charId, instId, qty) =>
          handleDispatch({
            type: 'SPLIT_ITEM_STACK',
            characterId: charId,
            itemInstanceId: instId,
            quantity: qty,
          })
        }
        onIdentifyItem={(charId, instId) =>
          handleDispatch({
            type: 'IDENTIFY_ITEM',
            characterId: charId,
            itemInstanceId: instId,
          })
        }
        onSellItem={(charId, instId) =>
          handleDispatch({
            type: 'SELL_ITEM',
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
        retirementCandidates={retirementCandidates}
        veteranRoster={veteranRoster}
        onRetireVeteran={handleRetireVeteran}
      />
    </div>
  );
}
