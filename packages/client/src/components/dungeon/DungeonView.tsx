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
  activateShrine,
  advanceRogueliteFloor,
  calculateGoldFromLoot,
  checkRogueliteWipe,
  endRogueliteRun,
  findPath,
  getFootprintDistanceFeet,
  planAiTurn,
  recordRunMonstersSlain,
  resolveRogueliteLongRest,
  truncatePathToBudget,
} from '@srd5/engine';
import { LocalTransport, type PlayerViewProp, type PlayerViewState } from '@srd5/transport';
import { TacticalCanvasViewport } from '../../canvas/index.js';
import { TacticalCombatHud } from '../combat/index.js';
import { LevelUpModal } from '../roster/index.js';
import { resolveSpellTargets } from '../../utils/combatTargeting.js';
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

export interface DungeonViewProps {
  partyCharacters?: CharacterBuildState[];
  compendium?: SrdCompendium;
  initialFloorId?: string;
  initialGameState?: GameState;
  gameMode?: 'campaign' | 'roguelite';
  storageAdapter?: DungeonStorageAdapter;
  onExitToRoster: () => void;
  onOpenCharacterSheet?: (characterId: string) => void;
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
}: DungeonViewProps) {
  const campaignModule = getSunkenCryptModule();
  const [dungeonMode, setDungeonMode] = useState<'campaign' | 'roguelite'>(gameMode);
  const [currentFloorId, setCurrentFloorId] = useState<string>(
    initialGameState?.dungeon?.floorId ?? initialFloorId,
  );

  const [rogueliteState, setRogueliteState] = useState<{
    runState: DeepDescentRunState;
    floor: DungeonFloorSpec;
  } | null>(() => {
    if (gameMode === 'roguelite') {
      const sess = buildRogueliteSession(partyCharacters, compendium);
      return {
        runState: sess.session.runState,
        floor: sess.session.generatedFloor.floor,
      };
    }
    return null;
  });

  const floorSpec =
    dungeonMode === 'roguelite' && rogueliteState
      ? rogueliteState.floor
      : (getCampaignFloor(campaignModule, currentFloorId) ?? campaignModule.floors[0]!);

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
  const [activeLoot, setActiveLoot] = useState<{
    sourcePropId?: string;
    sourceName?: string;
    bundle: any;
  } | null>(null);
  const [activeShrine, setActiveShrine] =
    useState<InteractiveProp | PlayerViewProp | null>(null);
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

        // Encounter victory in roguelite mode
        if (ev.type === 'ENCOUNTER_VICTORY' && dungeonMode === 'roguelite') {
          setRogueliteState((prev) => {
            if (!prev) return null;
            const updated = recordRunMonstersSlain(
              prev.runState,
              1,
              ev.xpAwarded ?? 0,
              calculateGoldFromLoot('lootBundle' in ev ? ev.lootBundle : undefined),
            );
            return { ...prev, runState: updated };
          });
        }
      }

      // Check if boss defeated on Floor 3 in campaign mode
      const auth = transport.getAuthoritativeState();
      if (dungeonMode === 'campaign' && isFinalCampaignBossDefeated(auth)) {
        setCampaignVictory(true);
      }

      // Check for party wipe in roguelite mode
      if (dungeonMode === 'roguelite' && rogueliteState && !rogueliteState.runState.isComplete) {
        if (checkRogueliteWipe(rogueliteState.runState, auth)) {
          const completed = endRogueliteRun(
            rogueliteState.runState,
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
  const handleCellClick = async (cell: GridPoint) => {
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
    if (dungeonMode === 'roguelite' && rogueliteState) {
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

  return (
    <div
      data-testid="dungeon-view-container"
      className="relative w-full h-[calc(100vh-140px)] min-h-[460px] bg-slate-950 rounded-xl overflow-hidden border border-slate-800 shadow-2xl flex flex-col"
    >
      {/* Roguelite Top Status HUD */}
      {dungeonMode === 'roguelite' && rogueliteState && (
        <RogueliteHud
          runState={rogueliteState.runState}
          onOpenRestCamp={() => setModalState('rest_camp')}
        />
      )}

      {/* Action feedback banner */}
      {actionFeedback && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-red-950/95 border border-red-500 text-red-200 rounded-lg text-xs font-semibold shadow-2xl flex items-center gap-2 pointer-events-none">
          <span>⚠️</span>
          <span>{actionFeedback}</span>
        </div>
      )}

      {/* PixiJS Tactical Canvas Viewport */}
      <TacticalCanvasViewport
        grid={viewState.grid}
        combatants={
          viewState.mode === 'combat' ? viewState.combatants : viewState.party
        }
        selectedCombatantId={selectedCombatantId}
        activeCombatantId={
          viewState.mode === 'combat' ? activeCombatantId : leadExplorerId
        }
        hoveredCell={hoveredCell}
        onCellHover={setHoveredCell}
        onCellClick={handleCellClick}
        onCombatantClick={(combatantId) => setSelectedCombatantId(combatantId)}
        enableHoverPathPreview={true}
        enableFogOfWar={true}
        showTokenHpArcs={true}
        showConditionBadges={true}
        showTokenNames={true}
        className="w-full h-full"
      />

      {/* Exploration HUD (Active during Exploration Mode) */}
      {viewState.mode === 'exploration' && (
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
      )}

      {/* Tactical Combat HUD (Active during Tactical Combat Mode) */}
      {viewState.mode === 'combat' && (
        <TacticalCombatHud
          viewState={viewState}
          compendium={compendium}
          selectedCombatantId={selectedCombatantId}
          title={`${campaignModule.name} — ${floorSpec.name}`}
          subtitle="Combat Encounter in Progress"
          onToggleMenu={() => setModalState('pause_menu')}
          menuButtonText="⚙️ Menu"
          menuButtonTestId="combat-hud-system-menu-btn"
          events={events}
          activeRoll={activeRoll}
          rollHistory={rollHistory}
          isPlayerControlled={!isMonsterTurn}
          onSelectCombatant={(id) => setSelectedCombatantId(id)}
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
                c.side !== activeCombatant.side &&
                !c.isDead &&
                c.currentHp > 0,
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
                const inReachEnemy = livingHostiles.find(
                  (h) =>
                    getFootprintDistanceFeet(
                      activeCombatant.position,
                      activeCombatant.size,
                      h.position,
                      h.size,
                    ) <= reachOrRange,
                );
                if (inReachEnemy) {
                  target = inReachEnemy;
                } else {
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

            const targetResult = resolveSpellTargets({
              spell,
              slotLevel,
              caster: activeCombatant,
              combatants: viewState.combatants,
              selectedCombatantId,
              dispositionMatrix: (authState as any)?.combat?.dispositionMatrix,
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
          onOpenCharacterSheet={onOpenCharacterSheet}
        />
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
          if (dungeonMode === 'roguelite' && rogueliteState) {
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
            if (
              restRes.nextRunState.isComplete &&
              restRes.nextRunState.graveyardEntry
            ) {
              saveGraveyardEntry(restRes.nextRunState.graveyardEntry);
              setGraveyardEntry(restRes.nextRunState.graveyardEntry);
              setModalState('graveyard');
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
