import { z } from 'zod';
import {
  type AbilityId,
  type ConditionId,
  type CreatureSize,
  type DamageType,
  type CharacterCurrency,
  type InventoryItemInstance,
} from '@srd5/data';
import {
  type Combatant,
  type CombatantState,
  type CombatEvent,
  type CombatState,
  type CombatVictoryOutcome,
  type PendingReactionPrompt,
  type ResolveReactionDecision,
} from '../combat/types.js';
import { type DispositionMatrix } from '../combat/allegiance.js';
import {
  type GridPoint,
  type LightLevel,
  type TacticalGrid,
  type TileTerrainType,
} from '../grid/model.js';
import { type LightSource } from '../grid/vision.js';
import { type CharacterClassEntry, type EquippedSlots } from '../character/schemas.js';
import { type LevelUpRequest, type LevelUpSummary } from '../character/level-up.js';
import {
  type LootBundleSpec,
  type MarchingFormation,
  type MarchingOrderConfig,
} from '../dungeon/schemas.js';
import { type DungeonFloorState } from '../dungeon/state.js';

/**
 * Game operating modes.
 */
export const GAME_MODES = ['exploration', 'combat'] as const;
export const GameModeSchema = z.enum(GAME_MODES);
export type GameMode = z.infer<typeof GameModeSchema>;

/**
 * Interactive prop types and states (Spec 04 Section 2).
 */
export const PROP_KINDS = [
  'door',
  'secret_door',
  'chest',
  'trap',
  'lever',
  'shrine',
  'stairs_down',
  'stairs_up',
  'furniture',
  'corpse',
] as const;
export const PropKindSchema = z.enum(PROP_KINDS);
export type PropKind = z.infer<typeof PropKindSchema>;

export const PROP_STATES = [
  'closed',
  'open',
  'locked',
  'destroyed',
  'disarmed',
  'triggered',
] as const;
export const PropStateSchema = z.enum(PROP_STATES);
export type PropState = z.infer<typeof PropStateSchema>;

export interface InteractiveProp {
  id: string;
  x: number;
  y: number;
  kind: PropKind;
  state: PropState;
  blocksMovement: boolean;
  blocksSight: boolean;
  lockDc?: number;
  detectionDc?: number;
  disarmDc?: number;
  /** SRD-510 §3.2: WIS (Perception) DC to hear through (doors). */
  listenDc?: number;
  /** SRD-512: furniture subtype (desk, throne, …). Only for kind 'furniture'. */
  furnitureType?: string;
  /** SRD-512: hiding behind/inside grants advantage on Stealth checks. */
  hideSpot?: boolean;
  /** SRD-1307: slain monster id this corpse prop holds loot for. Only for kind 'corpse'. */
  monsterId?: string;
  /** SRD-1307: display name ("Remains of Goblin"). Only for kind 'corpse'. */
  label?: string;
  /** SRD-1307: whether the fallen have been searched (skill bonus resolved). */
  searched?: boolean;
  /** SRD-1307: Search-the-Fallen DC (10 + floor(CR)). Only for kind 'corpse'. */
  searchDc?: number;
  discovered?: boolean;
  ac?: number;
  hp?: number;
  maxHp?: number;
  trapDamageFormula?: string;
  trapDamageType?: DamageType;
  trapSaveDc?: number;
  trapSaveAbility?: AbilityId;
  trapHalfDamageOnSave?: boolean;
  lootTable?: LootBundleSpec;
  shrineType?: string;
}

/**
 * Player seat/slot mapping (Spec 05 Section 2.3).
 */
export interface PlayerSlotAssignment {
  playerId: string;
  displayName: string;
  controlledCharacterIds: string[];
}

/**
 * Full Game Command Union Schema (Spec 05 Section 2.1).
 */
export type GameCommand =
  // Exploration Commands
  | {
      type: 'EXPLORE_MOVE';
      actorId: string;
      path: GridPoint[];
      followMarchingOrder?: boolean;
    }
  | {
      type: 'SET_MARCHING_ORDER';
      marchingOrder?: string[];
      formation?: MarchingFormation;
      leadExplorerId?: string;
    }
  | {
      type: 'SET_PARTY_STEALTH';
      inStealth: boolean;
    }
  | {
      type: 'TRIGGER_DUNGEON_ENCOUNTER';
      encounterId: string;
      explicitSurprisedEntityIds?: string[];
    }
  | {
      type: 'END_COMBAT';
    }
  | {
      type: 'INTERACT_PROP';
      actorId: string;
      propId: string;
      interaction:
        | 'open'
        | 'close'
        | 'pick_lock'
        | 'disarm_trap'
        | 'force_open'
        | 'search'
        | 'attack';
    }
  | {
      type: 'ACTIVATE_SHRINE';
      actorId: string;
      shrineId: string;
      /** SRD-1404: cursed-shrine offering (`hp` | `gp` | `decline`). */
      offering?: 'hp' | 'gp' | 'decline';
    }
  | {
      type: 'EXPLORE_SEARCH';
      actorId: string;
    }
  | {
      type: 'LISTEN_AT_DOOR';
      actorId: string;
      propId: string;
    }
  | {
      type: 'ATTEMPT_THEFT';
      actorId: string;
      targetId: string;
      kind: 'pickpocket' | 'plant' | 'lift';
      liftWhat?: 'key' | 'pouch';
      asBonusAction?: boolean;
      dcOverride?: number;
    }
  | {
      type: 'ATTEMPT_RECALL';
      actorId: string;
      skill: 'history' | 'religion' | 'arcana' | 'nature';
      dc: number;
      reward:
        | { kind: 'reveal_quest'; questId: string }
        | { kind: 'trap_bonus'; bonus: number; scope: string }
        | { kind: 'ward_info'; target: string }
        | { kind: 'lore_note'; text: string };
      roomId?: string;
    }
  | {
      type: 'CONTEST_INSIGHT';
      actorId: string;
      targetId: string;
      speakerDeceptionTotal?: number;
      speakerDeceptionModifierOverride?: number;
      asBonusAction?: boolean;
    }
  | {
      type: 'ATTEMPT_STABILIZE';
      actorId: string;
      targetId: string;
      asBonusAction?: boolean;
      hasHealersKitOverride?: boolean;
      dcOverride?: number;
    }
  | {
      type: 'DIAGNOSE_AILMENT';
      actorId: string;
      targetId: string;
      dcOverride?: number;
    }
  | {
      type: 'ATTEMPT_INTIMIDATION';
      actorId: string;
      targetId: string;
      asBonusAction?: boolean;
      dcOverride?: number;
    }
  | {
      type: 'ATTEMPT_ANIMAL_HANDLING';
      actorId: string;
      targetId: string;
      intent?: 'calm' | 'befriend' | 'command';
      asBonusAction?: boolean;
      dcOverride?: number;
    }
  | {
      type: 'ATTEMPT_NATURE_LORE';
      actorId: string;
      subject?: string;
      dc?: number;
      dcOverride?: number;
    }
  | {
      type: 'ATTEMPT_PERFORMANCE';
      actorId: string;
      targetId?: string;
      intent?: 'earn' | 'distract' | 'cover';
      asBonusAction?: boolean;
      dc?: number;
      dcOverride?: number;
    }
  | {
      type: 'START_REST';
      restType: 'short' | 'long';
      hitDiceToSpend?: Record<string, number | Record<number, number>>;
      arcaneRecovery?: Record<string, number[]>;
      preparedSpellUpdates?: Record<string, string[]>;
      attunements?: Record<string, { attune?: string[]; unattune?: string[] }>;
      forceSafe?: boolean;
    }

  // Tactical Combat Commands
  | {
      type: 'START_COMBAT';
      encounterId?: string;
      combatants?: Combatant[];
      rngState?: number;
      dispositionMatrix?: DispositionMatrix;
    }
  | { type: 'COMBAT_MOVE'; actorId: string; path: GridPoint[] }
  | {
      type: 'DECLARE_ATTACK';
      actorId: string;
      targetId: string;
      weaponInstanceId?: string;
      attackProfileId?: string;
      monsterActionId?: string;
      twoHanded?: boolean;
      reckless?: boolean;
      isOffHand?: boolean;
    }
  | {
      type: 'DECLARE_CAST_SPELL';
      actorId: string;
      spellId: string;
      slotLevel?: number;
      targetIds?: string[];
      targetCell?: GridPoint;
      directionRad?: number;
      /** SRD-1203: ritual casting out of combat (no slot, +10 min). */
      castAsRitual?: boolean;
    }
  | {
      type: 'USE_CLASS_FEATURE';
      actorId: string;
      featureId: string;
      optionId?: string;
      targetIds?: string[];
      targetCell?: GridPoint;
    }
  | {
      type: 'USE_STANDARD_ACTION';
      actorId: string;
      action:
        | 'dash'
        | 'disengage'
        | 'dodge'
        | 'help'
        | 'hide'
        | 'search'
        | 'stand_up'
        | 'drop_concentration'
        | 'action_surge';
      targetId?: string;
      asBonusAction?: boolean;
    }
  | {
      type: 'EXECUTE_MONSTER_ACTION';
      actorId: string;
      actionId: string;
      targetId?: string;
      targetIds?: string[];
      targetCell?: GridPoint;
    }
  | {
      type: 'USE_GRAPPLE_OR_SHOVE';
      actorId: string;
      mode: 'grapple' | 'shove_prone' | 'shove_push';
      targetId: string;
    }
  | {
      type: 'USE_ITEM';
      actorId: string;
      itemInstanceId: string;
      targetId?: string;
    }
  | {
      type: 'RESOLVE_REACTION_PROMPT';
      promptId: string;
      reactorId: string;
      decision:
        | { execute: false }
        | { execute: true; reactionId: string; slotLevel?: number };
    }
  | { type: 'END_TURN'; actorId: string }

  // War Campaign multi-wave reinforcements (Spec 10 §4.2, SRD-1105): injects
  // scheduled wave combatants mid-combat with seeded initiative.
  | {
      type: 'SPAWN_REINFORCEMENTS';
      combatants: Combatant[];
      wave?: number;
    }

  // Summoned Creature Commands (Spec 08 §4.2)
  | {
      type: 'DISMISS_SUMMON';
      actorId: string;
      summonId?: string;
      summonEntityId?: string;
    }
  | {
      type: 'USE_SUMMON_ACTION';
      actorId: string;
      actionId: string;
      targetId?: string;
      targetIds?: string[];
      targetCell?: GridPoint;
    }

  // Inventory & Progression Commands
  | {
      type: 'EQUIP_LOADOUT';
      characterId: string;
      equippedSlots: EquippedSlots;
    }
  | {
      type: 'UPDATE_PREPARED_SPELLS';
      characterId: string;
      preparedSpellIds: string[];
    }
  | {
      type: 'CLAIM_LOOT';
      characterId: string;
      propId?: string;
      loot?: LootBundleSpec;
    }
  | {
      type: 'ATTUNE_ITEM';
      characterId: string;
      itemInstanceId: string;
    }
  | {
      type: 'UNATTUNE_ITEM';
      characterId: string;
      itemInstanceId: string;
    }
  | {
      type: 'TRANSFER_ITEM';
      fromCharacterId: string;
      toCharacterId: string;
      itemInstanceId: string;
      quantity?: number;
    }
  | {
      type: 'DROP_ITEM';
      characterId: string;
      itemInstanceId: string;
      quantity?: number;
    }
  | {
      type: 'SPLIT_ITEM_STACK';
      characterId: string;
      itemInstanceId: string;
      quantity: number;
    }
  | {
      type: 'IDENTIFY_ITEM';
      characterId: string;
      itemInstanceId: string;
    }
  | {
      type: 'SELL_ITEM';
      characterId: string;
      itemInstanceId: string;
      quantity?: number;
    }
  | {
      type: 'LEVEL_UP_CHARACTER';
      characterId: string;
      levelUpRequest: LevelUpRequest;
      classEntryUpdate?: CharacterClassEntry;
    };

/**
 * Domain Game Events emitted by state transitions (Spec 05 Section 2.2).
 */
export type GameEvent =
  | CombatEvent
  | {
      type: 'PROP_STATE_CHANGED';
      propId: string;
      prevState: PropState;
      nextState: PropState;
      actorId?: string;
    }
  | {
      type: 'SECRET_DISCOVERED';
      propId: string;
      finderId: string;
      kind: PropKind;
    }
  | {
      type: 'TRAP_TRIGGERED';
      propId: string;
      targetId: string;
      damage?: number;
      damageType?: DamageType;
      saveMade?: boolean;
      saveSuccess?: boolean;
    }
  | {
      type: 'CHECK_RESOLVED';
      actorId: string;
      checkType:
        | 'perception'
        | 'investigation'
        | 'thieves_tools'
        | 'sleight_of_hand'
        | 'athletics'
        | 'attack'
        | 'saving_throw'
        | 'history'
        | 'religion'
        | 'arcana'
        | 'nature'
        | 'insight'
        | 'deception'
        | 'medicine'
        | 'intimidation'
        | 'animal_handling'
        | 'performance'
        | 'persuasion'
        | 'stealth'
        | 'survival';
      targetId?: string;
      dc?: number;
      roll: number;
      modifier: number;
      total: number;
      success: boolean;
      triggered?: boolean;
      /** Human-readable finding (e.g. a Listen-at-door hint). */
      note?: string;
    }
  | {
      type: 'THEFT_RESOLVED';
      actorId: string;
      targetId: string;
      kind: 'pickpocket' | 'plant' | 'lift';
      liftWhat?: 'key' | 'pouch';
      success: boolean;
      caught: boolean;
      roll: number;
      modifier: number;
      total: number;
      dc: number;
      hadToolsAdvantage: boolean;
      asBonusAction: boolean;
      goldStolen?: number;
      headline: string;
    }
  | {
      type: 'RECALL_RESOLVED';
      actorId: string;
      skill: 'history' | 'religion' | 'arcana' | 'nature';
      dc: number;
      roll: number;
      modifier: number;
      total: number;
      success: boolean;
      questId?: string;
      trapBonus?: number;
      scope?: string;
      revealedPropIds?: string[];
      loreNote?: string;
      headline: string;
    }
  | {
      type: 'LOOT_ACQUIRED';
      actorId: string;
      propId: string;
      loot: LootBundleSpec;
    }
  | {
      type: 'ROOM_DISCOVERED';
      roomId: string;
      roomName?: string;
    }
  | {
      type: 'ROOM_ENTERED';
      actorId: string;
      roomId: string;
      prevRoomId?: string;
    }
  | {
      type: 'MARCHING_ORDER_CHANGED';
      order: string[];
      formation: MarchingFormation;
      leadExplorerId: string;
    }
  | {
      type: 'MOVEMENT_HALTED';
      actorId: string;
      reason: 'trap_detected' | 'trap_triggered' | 'obstacle' | 'encounter_spotted';
      at: GridPoint;
    }
  | {
      type: 'PARTY_STEALTH_CHANGED';
      inStealth: boolean;
    }
  | {
      type: 'ENCOUNTER_TRIGGERED';
      encounterId: string;
      roomId: string;
      monsterIds: string[];
      isSurprisedParty: boolean;
      isSurprisedMonsters: boolean;
    }
  | {
      type: 'ROOM_CLEARED';
      roomId: string;
      roomName: string;
    }
  | {
      type: 'REST_COMPLETED';
      restType: 'short' | 'long';
      hpRecovered: Record<string, number>;
      hitDiceRecovered?: Record<string, number>;
      hitDiceSpent?: Record<string, number>;
      songOfRestHp?: Record<string, number>;
      slotsRecovered?: Record<string, number[]>;
    }
  | {
      type: 'REST_INTERRUPTED';
      restType: 'short' | 'long';
      reason: 'ambush' | 'combat';
      ambushRoll?: number;
      encounterId?: string;
    }
  | {
      type: 'PREPARED_SPELLS_UPDATED';
      characterId: string;
      preparedSpellIds: string[];
    }
  | {
      type: 'MODE_CHANGED';
      fromMode: GameMode;
      toMode: GameMode;
    }
  | {
      type: 'ENCOUNTER_VICTORY';
      encounterId?: string;
      outcome?: CombatVictoryOutcome | string;
      round?: number;
      xpAwarded: number;
      totalXp: number;
      survivingHeroIds?: string[];
      lootUnlocked?: InventoryItemInstance[];
      lootBundle?: LootBundleSpec;
    }
  | {
      type: 'LEVEL_UP_UNLOCKED';
      characterId: string;
      currentLevel: number;
      eligibleLevel: number;
    }
  | {
      type: 'LEVEL_UP_APPLIED';
      characterId: string;
      newLevel: number;
      hpIncrease: number;
      summary?: LevelUpSummary;
    }
  | {
      type: 'ATTUNEMENT_CHANGED';
      characterId: string;
      attunedItemInstanceIds: string[];
    }
  | {
      type: 'INVENTORY_UPDATED';
      characterId: string;
      inventory: InventoryItemInstance[];
      currency?: CharacterCurrency;
    }
  | {
      type: 'ITEM_TRANSFERRED';
      fromCharacterId: string;
      toCharacterId: string;
      itemInstanceId: string;
      itemId: string;
      quantity: number;
    }
  | {
      type: 'ITEM_DROPPED';
      characterId: string;
      itemInstanceId: string;
      itemId: string;
      quantity: number;
    }
  | {
      type: 'ITEM_STACK_SPLIT';
      characterId: string;
      sourceInstanceId: string;
      newInstanceId: string;
      itemId: string;
      splitQuantity: number;
    }
  | {
      type: 'ITEM_IDENTIFIED';
      characterId: string;
      itemInstanceId: string;
      itemId: string;
    }
  | {
      type: 'ITEM_SOLD';
      characterId: string;
      itemInstanceId: string;
      itemId: string;
      quantity: number;
      goldEarned: number;
    }
  | {
      type: 'ITEM_CONSUMED';
      characterId: string;
      itemInstanceId: string;
      itemId: string;
      quantityRemaining: number;
    }
  | {
      type: 'CHARGES_CHANGED';
      characterId: string;
      itemInstanceId: string;
      itemId: string;
      chargesRemaining: number;
      chargesMax: number;
    }
  | {
      type: 'SHRINE_ACTIVATED';
      shrineId: string;
      shrineType: string;
      actorId: string;
      effectDescription: string;
    }
  | {
      type: 'ROGUELITE_STARVATION';
      actorId: string;
      rationsConsumed: number;
      rationsShort: number;
      exhaustionLevel: number;
    };

/**
 * Authoritative Master Game State in @srd5/engine.
 */
export interface GameState {
  id: string;
  mode: GameMode;
  grid: TacticalGrid;
  combat: CombatState | null;
  party: Record<string, Combatant>;
  monsters: Record<string, Combatant>;
  props: InteractiveProp[];
  lightSources: LightSource[];
  exploredCells: Record<string, boolean>;
  slots: PlayerSlotAssignment[];
  rngState: number;
  dungeon?: DungeonFloorState;
  marchingOrder?: MarchingOrderConfig;
  partyInStealth?: boolean;
}
