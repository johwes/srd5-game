import { z } from 'zod';
import {
  type AbilityId,
  type ConditionId,
  type CreatureSize,
  type DamageType,
} from '@srd5/data';
import {
  type Combatant,
  type CombatantState,
  type CombatEvent,
  type CombatState,
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
import { type MarchingFormation, type MarchingOrderConfig } from '../dungeon/schemas.js';
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
  discovered?: boolean;
  ac?: number;
  hp?: number;
  trapDamageFormula?: string;
  trapDamageType?: DamageType;
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
      type: 'INTERACT_PROP';
      actorId: string;
      propId: string;
      interaction: 'open' | 'close' | 'pick_lock' | 'disarm_trap' | 'force_open' | 'search';
    }
  | {
      type: 'START_REST';
      restType: 'short' | 'long';
      hitDiceToSpend?: Record<string, number>;
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
      slotLevel: number;
      targetIds?: string[];
      targetCell?: GridPoint;
      directionRad?: number;
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
      type: 'LEVEL_UP_CHARACTER';
      characterId: string;
      classEntryUpdate: CharacterClassEntry;
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
      reason: 'trap_detected' | 'trap_triggered' | 'obstacle';
      at: GridPoint;
    }
  | {
      type: 'REST_COMPLETED';
      restType: 'short' | 'long';
      hpRecovered: Record<string, number>;
    }
  | {
      type: 'MODE_CHANGED';
      fromMode: GameMode;
      toMode: GameMode;
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
}
