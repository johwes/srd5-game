import { z } from 'zod';
import {
  ConditionIdSchema,
  CreatureSizeSchema,
  type ConditionId,
  type CreatureSize,
  type DamageType,
  type MonsterData,
} from '@srd5/data';
import {
  type DiceRollRecord,
  type RollMode,
} from '../dice/evaluator.js';
import {
  DeathSavesStateSchema,
  type DeathSavesState,
  type DerivedCharacterSheet,
} from '../character/schemas.js';
import {
  GridPointSchema,
  type GridPoint,
} from '../grid/model.js';
import { type CoverLevel } from '../grid/vision.js';

/**
 * Combatant allegiance sides.
 */
export const COMBATANT_SIDES = ['party', 'monster', 'neutral'] as const;
export const CombatantSideSchema = z.enum(COMBATANT_SIDES);
export type CombatantSide = z.infer<typeof CombatantSideSchema>;

/**
 * SRD 5.1 Per-turn Action Budget (Spec 03 Section 4.1).
 */
export const TurnBudgetSchema = z.object({
  action: z.number().int().nonnegative(),
  bonusAction: z.number().int().nonnegative(),
  reactionAvailable: z.boolean(),
  movementRemainingFeet: z.number().int().nonnegative(),
  freeObjectInteraction: z.number().int().nonnegative(),
  bonusActionSpellCast: z.boolean(),
  leveledActionSpellCast: z.boolean(),
  attackActionTaken: z.boolean(),
  extraAttacksRemaining: z.number().int().nonnegative(),
  disengaged: z.boolean(),
  dodging: z.boolean(),
});
export type TurnBudget = z.infer<typeof TurnBudgetSchema>;

/**
 * Concentrating spell runtime tracker (aligned with ConcentrationStateSchema).
 */
export const ActiveConcentrationSchema = z.object({
  sourceId: z.string().min(1),
  targetEntityIds: z.array(z.string().min(1)),
  remainingRounds: z.number().int().nonnegative(),
});
export type ActiveConcentration = z.infer<typeof ActiveConcentrationSchema>;

/**
 * Serializable Combatant state participating in tactical combat.
 */
export const CombatantStateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  side: CombatantSideSchema,
  size: CreatureSizeSchema,
  position: GridPointSchema,
  speedFeet: z.number().int().nonnegative(),
  currentHp: z.number().int().nonnegative(),
  maxHp: z.number().int().positive(),
  tempHp: z.number().int().nonnegative(),
  armorClass: z.number().int().positive(),
  dexterityScore: z.number().int().min(1).max(30),
  dexterityModifier: z.number().int(),
  strengthScore: z.number().int().min(1).max(30).optional(),
  strengthModifier: z.number().int().optional(),
  initiativeBonus: z.number().int(),
  initiativeRollMode: z.enum(['normal', 'advantage', 'disadvantage']),
  passivePerception: z.number().int(),
  stealthModifier: z.number().int(),
  isSurprised: z.boolean(),
  isDodging: z.boolean().optional(),
  conditions: z.array(ConditionIdSchema),
  deathSaves: DeathSavesStateSchema,
  isDead: z.boolean(),
  isStable: z.boolean(),
  attacksPerAction: z.number().int().min(1).max(4),
  concentratingOn: ActiveConcentrationSchema.optional(),
});
export type CombatantState = z.infer<typeof CombatantStateSchema>;

export interface Combatant extends CombatantState {
  characterSheet?: DerivedCharacterSheet | undefined;
  monsterData?: MonsterData | undefined;
}

/**
 * Single entry in the initiative track order.
 */
export const InitiativeEntrySchema = z.object({
  entityId: z.string().min(1),
  initiative: z.number().int(),
  naturalRoll: z.number().int().min(1).max(20),
  dexterityScore: z.number().int().min(1).max(30),
  tieBreaker: z.number().int(),
});
export type InitiativeEntry = z.infer<typeof InitiativeEntrySchema>;

/**
 * Tactical Combat phases.
 */
export const COMBAT_PHASES = [
  'not_started',
  'active_turn',
  'reaction_prompt',
  'combat_ended',
] as const;
export const CombatPhaseSchema = z.enum(COMBAT_PHASES);
export type CombatPhase = z.infer<typeof CombatPhaseSchema>;

/**
 * Encounter victory outcomes.
 */
export const COMBAT_VICTORY_OUTCOMES = [
  'in_progress',
  'party_victory',
  'monsters_victory',
  'draw',
] as const;
export const CombatVictoryOutcomeSchema = z.enum(COMBAT_VICTORY_OUTCOMES);
export type CombatVictoryOutcome = z.infer<typeof CombatVictoryOutcomeSchema>;

/**
 * Combat Domain Events emitted by state transitions (Spec 05 Section 2.2).
 */
export type CombatEvent =
  | {
      type: 'COMBAT_STARTED';
      encounterId: string;
      initiativeOrder: Array<{ entityId: string; initiative: number }>;
    }
  | {
      type: 'ROUND_STARTED';
      round: number;
    }
  | {
      type: 'TURN_STARTED';
      entityId: string;
      round: number;
    }
  | {
      type: 'TURN_ENDED';
      entityId: string;
      round: number;
    }
  | {
      type: 'SURPRISE_DETERMINED';
      surprisedEntityIds: string[];
    }
  | {
      type: 'SURPRISE_ENDED';
      entityId: string;
    }
  | {
      type: 'DICE_ROLLED';
      actorId: string;
      rollPurpose: string;
      notation: string;
      rolls: number[];
      kept: number[];
      modifier: number;
      total: number;
      mode: RollMode;
      naturalCrit?: boolean;
      naturalFumble?: boolean;
    }
  | {
      type: 'DEATH_SAVE_ROLLED';
      entityId: string;
      roll: number;
      outcome: 'success' | 'failure' | 'revived' | 'dead';
      deathSaves: DeathSavesState;
      currentHp: number;
    }
  | {
      type: 'CONDITION_ADDED';
      targetId: string;
      conditionId: ConditionId;
      sourceName?: string;
    }
  | {
      type: 'CONDITION_REMOVED';
      targetId: string;
      conditionId: ConditionId;
      sourceName?: string;
    }
  | {
      type: 'ACTION_USED';
      actorId: string;
      actionName: 'dash' | 'disengage' | 'dodge' | 'stand_up' | 'action_surge' | 'custom';
      cost: 'action' | 'bonus_action' | 'free' | 'movement';
      movementCostFeet?: number;
    }
  | {
      type: 'ATTACK_RESOLVED';
      attackerId: string;
      targetId: string;
      weaponOrSpellName: string;
      attackType: 'melee_weapon' | 'ranged_weapon' | 'melee_spell' | 'ranged_spell';
      roll: number;
      totalToHit: number;
      targetAc: number;
      outcome: 'miss' | 'hit' | 'critical_hit';
      damage?: {
        total: number;
        damageType: DamageType;
        diceFormula: string;
      };
      cover?: CoverLevel;
    }
  | {
      type: 'GRAPPLE_RESOLVED';
      attackerId: string;
      targetId: string;
      success: boolean;
      attackerAthleticsTotal: number;
      targetContestTotal: number;
      targetSkillUsed: 'athletics' | 'acrobatics';
    }
  | {
      type: 'SHOVE_RESOLVED';
      attackerId: string;
      targetId: string;
      success: boolean;
      shoveType: 'knock_prone' | 'push_away';
      attackerAthleticsTotal: number;
      targetContestTotal: number;
      targetSkillUsed: 'athletics' | 'acrobatics';
      destination?: GridPoint;
    }
  | {
      type: 'ENTITY_MOVED';
      entityId: string;
      path: GridPoint[];
      mode: 'walk' | 'dash' | 'teleport' | 'forced';
    }
  | {
      type: 'DAMAGE_APPLIED';
      targetId: string;
      rawAmount: number;
      finalAmount: number;
      damageType: DamageType;
      tempHpAbsorbed: number;
      hpRemaining: number;
    }
  | {
      type: 'ENCOUNTER_VICTORY';
      outcome: 'party_victory' | 'monsters_victory' | 'draw';
      round: number;
    };

/**
 * Authoritative Tactical Combat State.
 */
export interface CombatState {
  encounterId: string;
  round: number;
  phase: CombatPhase;
  initiativeOrder: InitiativeEntry[];
  activeCombatantIndex: number;
  activeCombatantId: string | null;
  turnBudget: TurnBudget | null;
  combatants: Record<string, Combatant>;
  surprisedCombatantIds: string[];
  outcome: CombatVictoryOutcome;
  rngState: number;
  roundHistory?: Array<{ round: number; turns: Array<{ entityId: string; timestamp: number }> }>;
}
