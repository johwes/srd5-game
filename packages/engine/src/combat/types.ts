import { z } from 'zod';
import {
  type AbilityId,
  AbilityIdSchema,
  ConditionIdSchema,
  CreatureSizeSchema,
  type ConditionId,
  type CreatureSize,
  type DamageType,
  DamageTypeSchema,
  type MonsterData,
  ActiveConditionInstanceSchema,
  type ActiveConditionInstance,
  ActiveEffectInstanceSchema,
  type ActiveEffectInstance,
  type LootBundleSpec,
  AoeShapeTypeSchema,
  type AoeShapeType,
  type EffectStepSpec,
  type ActivatedAbilitySpec,
  type SummonControlMode,
  type SummonTrigger,
} from '@srd5/data';
import {
  type DiceRollRecord,
  type RollMode,
} from '../dice/evaluator.js';
import {
  DeathSavesStateSchema,
  type DeathSavesState,
  type DerivedCharacterSheet,
  type CharacterBuildState,
} from '../character/schemas.js';
import {
  GridPointSchema,
  type GridPoint,
} from '../grid/model.js';
import { type CoverLevel } from '../grid/vision.js';
import { type DispositionMatrix } from './allegiance.js';

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
  sourceName: z.string().min(1).optional(),
  targetEntityIds: z.array(z.string().min(1)),
  remainingRounds: z.number().int().nonnegative(),
  hazardZoneIds: z.array(z.string().min(1)).optional(),
});
export type ActiveConcentration = z.infer<typeof ActiveConcentrationSchema>;

/**
 * Tracked spell slot pool on a Combatant.
 */
export const CombatantSpellSlotPoolSchema = z.object({
  max: z.number().int().nonnegative(),
  expended: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
});
export type CombatantSpellSlotPool = z.infer<typeof CombatantSpellSlotPoolSchema>;

/**
 * Tracked pact magic slots on a Combatant.
 */
export const CombatantPactMagicSchema = z.object({
  slotLevel: z.number().int().min(1).max(9),
  maxSlots: z.number().int().nonnegative(),
  expendedSlots: z.number().int().nonnegative(),
  availableSlots: z.number().int().nonnegative(),
});
export type CombatantPactMagic = z.infer<typeof CombatantPactMagicSchema>;

/**
 * Active ground hazard zone state.
 */
export const HazardZoneSchema = z.object({
  id: z.string().min(1),
  zoneId: z.string().min(1),
  casterId: z.string().min(1),
  sourceName: z.string().min(1),
  shape: AoeShapeTypeSchema,
  origin: GridPointSchema,
  targetPoint: GridPointSchema.optional(),
  sizeFeet: z.number().positive(),
  cells: z.array(GridPointSchema),
  durationRounds: z.number().int().positive(),
  remainingRounds: z.number().int().nonnegative(),
  requiresConcentration: z.boolean(),
  difficultTerrain: z.boolean(),
  obscurement: z.enum(['light', 'heavy']).optional(),
  saveDc: z.number().int().positive().optional(),
  spellLevel: z.number().int().nonnegative().optional(),
  onEnterOrStartTurn: z.array(z.any()),
  triggeredCreaturesThisTurn: z.array(z.string()).optional().default([]),
});
export type HazardZone = z.infer<typeof HazardZoneSchema>;

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
  spellSlots: z.record(z.string(), CombatantSpellSlotPoolSchema).optional(),
  pactMagic: CombatantPactMagicSchema.optional(),
  damageResistances: z.array(DamageTypeSchema).default([]),
  damageImmunities: z.array(DamageTypeSchema).default([]),
  damageVulnerabilities: z.array(DamageTypeSchema).default([]),
  conditionImmunities: z.array(ConditionIdSchema).default([]),
  exhaustionLevel: z.number().int().min(0).max(6).optional(),
  activeConditions: z.array(ActiveConditionInstanceSchema).optional(),
  activeEffects: z.array(ActiveEffectInstanceSchema).optional(),
  charmedByEntityId: z.string().optional(),
  frightenedByEntityId: z.string().optional(),
  grappledByEntityId: z.string().optional(),
  reactionAvailable: z.boolean().optional(),
  teamId: z.string().min(1).optional(),
  factionId: z.string().min(1).optional(),
  playerId: z.string().min(1).optional(),
  roomId: z.string().optional(),
  levelUpAvailable: z.boolean().optional(),
  blessings: z.array(z.string()).optional(),
  // --- Summoned Creature & Conjured Token state (Spec 08) ---
  isSummon: z.boolean().optional(),
  summonId: z.string().optional(),
  summonedByEntityId: z.string().optional(),
  summonSourceName: z.string().optional(),
  summonControl: z.enum(['commanded', 'autonomous']).optional(),
  untargetable: z.boolean().optional(),
  summonExpiryRound: z.number().int().nonnegative().optional(),
  summonActions: z.array(z.any()).optional(),
  summonTriggers: z.array(z.any()).optional(),
  summonDamageCap: z.number().int().positive().optional(),
  summonDamageDealt: z.number().int().nonnegative().optional(),
  summonTriggeredCreaturesThisTurn: z.array(z.string()).optional(),
  summonDismissible: z.boolean().optional(),
  summonConcentrationLinked: z.boolean().optional(),
});
export type CombatantState = z.infer<typeof CombatantStateSchema>;

export interface Combatant extends CombatantState {
  characterSheet?: DerivedCharacterSheet | undefined;
  monsterData?: MonsterData | undefined;
  buildState?: CharacterBuildState | undefined;
  // Typed summon metadata (the Zod schema stores these structurally as `any[]`)
  summonActions?: ActivatedAbilitySpec[] | undefined;
  summonTriggers?: SummonTrigger[] | undefined;
  summonControl?: SummonControlMode | undefined;
}

/**
 * Supported reaction action categories.
 */
export const AVAILABLE_REACTION_TYPES = [
  'opportunity_attack',
  'shield',
  'counterspell',
  'protection',
  'uncanny_dodge',
  'custom',
] as const;
export const AvailableReactionTypeSchema = z.enum(AVAILABLE_REACTION_TYPES);
export type AvailableReactionType = z.infer<typeof AvailableReactionTypeSchema>;

/**
 * Candidate reaction choice presented in an interrupt prompt.
 */
export const AvailableReactionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  reactionType: AvailableReactionTypeSchema,
  slotLevel: z.number().int().min(1).max(9).optional(),
  description: z.string().optional(),
});
export type AvailableReaction = z.infer<typeof AvailableReactionSchema>;

/**
 * Interactive Reaction Interrupt Prompt (Spec 03 Section 5.2 / Spec 05 Section 2.2).
 */
export const PendingReactionPromptSchema = z.object({
  promptId: z.string().min(1),
  reactorEntityId: z.string().min(1),
  triggerType: z.enum([
    'movement_reach_exit',
    'attack_roll_hit',
    'attack_declared',
    'spell_cast',
    'damage_taken',
  ]),
  triggerDescription: z.string().min(1),
  availableReactions: z.array(AvailableReactionSchema).min(1),
  timeoutMs: z.number().positive().optional(),
});
export type PendingReactionPrompt = z.infer<typeof PendingReactionPromptSchema>;

/**
 * Interrupted action context preserved while paused at an interrupt checkpoint.
 */
export type ReactionInterruptContext =
  | {
      type: 'movement';
      actorId: string;
      fullPath: GridPoint[];
      completedPath: GridPoint[];
      currentStepIndex: number;
      spentMovementFeet: number;
      remainingPath: GridPoint[];
      stepFrom: GridPoint;
      stepTo: GridPoint;
    }
  | {
      type: 'attack_declared';
      attackerId: string;
      targetId: string;
      protectorId: string;
      options: any;
    }
  | {
      type: 'attack_hit';
      attackerId: string;
      targetId: string;
      options: any;
      attackDetails: any;
      attackRollRecord: DiceRollRecord;
      targetEffectiveAc: number;
      cover: CoverLevel;
      outcome: 'hit' | 'critical_hit';
      rollMode: RollMode;
      advantageSources: string[];
      disadvantageSources: string[];
    }
  | {
      type: 'damage_taken';
      attackerId?: string | undefined;
      targetId: string;
      damageAmount: number;
      damageType: DamageType;
      options?: any;
    }
  | {
      type: 'spell_cast';
      casterId: string;
      spell: any;
      spellId?: string | undefined;
      slotLevel: number;
      options: any;
      reactorId: string;
    };

/**
 * Decision submitted by a player or adapter to resolve a pending reaction prompt.
 */
export interface ResolveReactionDecision {
  promptId: string;
  reactorEntityId?: string;
  decision:
    | {
        execute: false;
      }
    | {
        execute: true;
        reactionId: string;
        slotLevel?: number;
      };
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
      cost: 'action' | 'bonus_action' | 'free' | 'movement' | 'reaction' | 'special';
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
      instantDeath?: boolean;
      deathSaveFailuresAdded?: number;
      resistanceApplied?: boolean;
      vulnerabilityApplied?: boolean;
      immunityApplied?: boolean;
    }
  | {
      type: 'TEMP_HP_APPLIED';
      targetId: string;
      amount: number;
      tempHpBefore: number;
      tempHpAfter: number;
      sourceName?: string | undefined;
    }
  | {
      type: 'CREATURE_DIED';
      entityId: string;
      reason: 'instant_death' | 'zero_hp' | 'death_save_failures';
    }
  | {
      type: 'SPELL_CAST';
      actorId: string;
      spellId: string;
      spellName: string;
      spellLevel: number;
      castAtLevel: number;
      actionCost: 'action' | 'bonus_action' | 'reaction' | string;
      slotExpended?: number | undefined;
      targetEntityIds: string[];
    }
  | {
      type: 'SAVING_THROW_RESOLVED';
      entityId: string;
      ability: AbilityId;
      dc: number;
      roll: number;
      total: number;
      outcome: 'success' | 'failure';
      sourceSpellOrAbilityName?: string | undefined;
    }
  | {
      type: 'HEAL_APPLIED';
      targetId: string;
      amount: number;
      hpBefore: number;
      hpAfter: number;
      sourceName?: string | undefined;
      revivedFromZero?: boolean;
    }
  | {
      type: 'CONCENTRATION_STARTED';
      entityId: string;
      spellId: string;
      spellName: string;
      targetEntityIds: string[];
    }
  | {
      type: 'CONCENTRATION_ENDED';
      entityId: string;
      spellId?: string | undefined;
      reason: 'new_spell' | 'damaged' | 'incapacitated' | 'turn_expiry' | 'manual';
    }
  | {
      type: 'HAZARD_ZONE_CREATED';
      instanceId: string;
      zoneId: string;
      casterId: string;
      sourceName: string;
      shape: AoeShapeType;
      origin: GridPoint;
      sizeFeet: number;
      cells: GridPoint[];
      durationRounds: number;
      difficultTerrain: boolean;
      obscurement?: 'light' | 'heavy' | undefined;
    }
  | {
      type: 'HAZARD_ZONE_REMOVED';
      instanceId: string;
      zoneId: string;
      casterId: string;
      reason: 'expired' | 'concentration_ended' | 'dispelled' | 'cleared';
    }
  | {
      type: 'HAZARD_ZONE_TRIGGERED';
      instanceId: string;
      zoneId: string;
      entityId: string;
      trigger: 'enter' | 'start_turn';
    }
  | {
      type: 'EXHAUSTION_CHANGED';
      entityId: string;
      oldLevel: number;
      newLevel: number;
    }
  | {
      type: 'REACTION_PROMPTED';
      prompt: PendingReactionPrompt;
    }
  | {
      type: 'REACTION_RESOLVED';
      promptId: string;
      reactorEntityId: string;
      actionTaken: 'executed' | 'passed';
      reactionId?: string | undefined;
      reactionType?: AvailableReactionType | undefined;
    }
  | {
      type: 'ENCOUNTER_VICTORY';
      outcome: 'party_victory' | 'monsters_victory' | 'draw' | string;
      round?: number;
      totalXp?: number;
      xpAwarded?: number;
      survivingHeroIds?: string[];
      encounterId?: string;
      lootBundle?: LootBundleSpec;
    }
  /** A summoned creature/conjured token was spawned onto the tactical board. */
  | {
      type: 'SUMMON_SPAWNED';
      entityId: string;
      summonId: string;
      casterId: string;
      sourceName: string;
      control: SummonControlMode;
      untargetable: boolean;
      position: GridPoint;
      expiryRound: number;
    }
  /** A summon was removed from play (duration, concentration, dismissal, leash, damage cap or death). */
  | {
      type: 'SUMMON_EXPIRED';
      entityId: string;
      summonId: string;
      reason:
        | 'duration'
        | 'concentration'
        | 'dismissed'
        | 'leash'
        | 'damage_cap'
        | 'death';
      sourceName?: string | undefined;
    }
  /** An autonomous summon trigger resolved (e.g. hound bark/bite, guardian aura). */
  | {
      type: 'SUMMON_TRIGGERED';
      entityId: string;
      summonId: string;
      trigger: 'bark' | 'bite' | 'hostile_enter_radius' | 'leash';
      targetEntityId?: string | undefined;
      detail?: string | undefined;
    }
  /**
   * Tier C fallback: a spell/feature whose full effect cannot be resolved
   * automatically. Carries a structured card the UI can surface to the player.
   */
  | {
      type: 'MANUAL_ADJUDICATION_REQUIRED';
      actorId: string;
      sourceName: string;
      adjudicationId: string;
      title: string;
      guidance: string;
      suggestedRoll?: string | undefined;
      targetId?: string | undefined;
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
  hazardZones?: Record<string, HazardZone>;
  dispositionMatrix?: DispositionMatrix;
  roundHistory?: Array<{ round: number; turns: Array<{ entityId: string; timestamp: number }> }>;
  pendingReactionPrompt?: PendingReactionPrompt | null;
  reactionInterruptContext?: ReactionInterruptContext | null;
  friendlyFireEnabled?: boolean;
}
