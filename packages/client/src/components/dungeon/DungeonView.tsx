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
  type DiceRollRecord,
  type GameCommand,
  type GameEvent,
  type GameState,
  type GridPoint,
  findPath,
  planAiTurn,
} from '@srd5/engine';
import { LocalTransport, type PlayerViewState } from '@srd5/transport';
import { TacticalCanvasViewport } from '../../canvas/index.js';
import { TacticalCombatHud } from '../combat/index.js';
import { LevelUpModal } from '../roster/index.js';
import { DungeonExplorationHud } from './DungeonExplorationHud.js';
import { LootInventoryModal } from './LootInventoryModal.js';
import { MarchingOrderModal } from './MarchingOrderModal.js';
import { RestCampModal } from './RestCampModal.js';
import { SaveLoadModal } from './SaveLoadModal.js';
import {
  buildDungeonSession,
  getAdjacentProps,
  isFinalCampaignBossDefeated,
  transitionToNextFloor,
} from './dungeonEngine.js';
import type { DungeonModalMode } from './types.js';

export interface DungeonViewProps {
  partyCharacters?: CharacterBuildState[];
  compendium?: SrdCompendium;
  initialFloorId?: string;
  onExitToRoster: () => void;
  onOpenCharacterSheet?: (characterId: string) => void;
}

export function DungeonView({
  partyCharacters = [],
  compendium = defaultCompendium,
  initialFloorId = 'kaelen-floor-1',
  onExitToRoster,
  onOpenCharacterSheet,
}: DungeonViewProps) {
  const campaignModule = getSunkenCryptModule();
  const [currentFloorId, setCurrentFloorId] = useState<string>(initialFloorId);

  const floorSpec =
    getCampaignFloor(campaignModule, currentFloorId) ??
    campaignModule.floors[0]!;

  const [transport, setTransport] = useState<LocalTransport>(() => {
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
  const [campaignVictory, setCampaignVictory] = useState(false);

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
      }

      // Check if boss defeated on Floor 3
      const auth = transport.getAuthoritativeState();
      if (isFinalCampaignBossDefeated(auth)) {
        setCampaignVictory(true);
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
      } catch (err) {
        console.error('Error dispatching dungeon command:', err);
      }
    },
    [transport],
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

      const plan = planAiTurn({
        state: auth.combat,
        activeCombatantId,
        grid: auth.grid,
      });

      for (const cmd of plan.commands) {
        await transport.dispatch(cmd);
      }
    } catch (err) {
      console.error('Error executing AI monster turn:', err);
      await transport.dispatch({ type: 'END_TURN', actorId: activeCombatantId });
    } finally {
      setIsAiThinking(false);
    }
  }, [activeCombatant, activeCombatantId, isMonsterTurn, isAiThinking, transport]);

  useEffect(() => {
    if (isMonsterTurn && !isAiThinking) {
      aiTurnTimeoutRef.current = setTimeout(() => {
        void executeAiMonsterTurn();
      }, 500);
    }
    return () => {
      if (aiTurnTimeoutRef.current) {
        clearTimeout(aiTurnTimeoutRef.current);
      }
    };
  }, [isMonsterTurn, isAiThinking, executeAiMonsterTurn]);

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

      const pathResult = findPath({
        grid: authState.grid,
        mover,
        goal: cell,
        creatures,
        movementRemainingFeet:
          viewState.combat?.turnBudget?.movementRemainingFeet ?? 30,
      });

      if (pathResult.found && pathResult.path.length > 1) {
        await handleDispatch({
          type: 'COMBAT_MOVE',
          actorId: activeCombatant.id,
          path: pathResult.path,
        });
      }
    }
  };

  // Descend stairs handler
  const handleDescendStairs = () => {
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
      className="relative w-full h-[calc(100vh-140px)] min-h-[580px] bg-slate-950 rounded-xl overflow-hidden border border-slate-800 shadow-2xl flex flex-col"
    >
      {/* PixiJS Tactical Canvas Viewport */}
      <TacticalCanvasViewport
        grid={viewState.grid}
        combatants={
          viewState.mode === 'combat' ? viewState.combatants : viewState.party
        }
        activeCombatantId={
          viewState.mode === 'combat' ? activeCombatantId : leadExplorerId
        }
        hoveredCell={hoveredCell}
        onCellHover={setHoveredCell}
        onCellClick={handleCellClick}
        enableFogOfWar={true}
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
          onInteractProp={(propId, interaction) =>
            handleDispatch({
              type: 'INTERACT_PROP',
              actorId: leadExplorerId,
              propId,
              interaction,
            })
          }
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
          title={`${campaignModule.name} — ${floorSpec.name}`}
          subtitle="Combat Encounter in Progress"
          events={events}
          activeRoll={activeRoll}
          rollHistory={rollHistory}
          isPlayerControlled={!isMonsterTurn}
          onDeclareAttack={(weapon, opts) => {
            if (!activeCombatantId) return;
            const target = Object.values(viewState.combatants).find(
              (c) => c.side !== activeCombatant?.side && !c.isDead && c.currentHp > 0,
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
              (c) => c.side !== activeCombatant?.side && !c.isDead && c.currentHp > 0,
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
        onStartLongRest={(options) =>
          handleDispatch({
            type: 'START_REST',
            restType: 'long',
            forceSafe: options?.forceSafe,
          })
        }
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
    </div>
  );
}
