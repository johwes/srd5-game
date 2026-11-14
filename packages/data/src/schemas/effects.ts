import { z } from 'zod';
import {
  type AbilityId,
  AbilityIdSchema,
  ActionCostSchema,
  type AoeShapeType,
  AoeShapeTypeSchema,
  type ConditionId,
  ConditionIdSchema,
  type DamageType,
  DamageTypeSchema,
  FormulaStringSchema,
  RestTypeSchema,
  type SkillId,
  SkillIdSchema,
} from './enums.js';

/**
 * Canonical predicate tags and custom predicate expressions for conditional modifiers.
 */
export const KNOWN_PREDICATE_IDS = [
  'wielding_ranged_weapon',
  'one_handed_melee_no_other_weapon',
  'wielding_two_handed_or_versatile_melee',
  'wielding_shield',
  'wearing_armor',
  'wearing_no_armor',
  'wearing_heavy_armor',
  'not_wearing_heavy_armor',
  'save_against_poison',
  'save_against_magic',
  'save_against_charmed',
  'save_against_frightened',
  'save_against_traps',
  'in_dim_light_or_darkness',
  'in_sunlight',
  'ally_within_5ft_of_target',
] as const;
export type KnownPredicateId = (typeof KNOWN_PREDICATE_IDS)[number];

/**
 * Predicate specification guarding when a ModifierSpec applies.
 * Supports canonical string predicate IDs (e.g., "wielding_ranged_weapon", "save_against_poison")
 * as well as structured predicate objects.
 */
export const StructuredPredicateSchema = z.object({
  type: z.string().min(1),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type StructuredPredicate = z.infer<typeof StructuredPredicateSchema>;

export const PredicateSpecSchema = z.union([
  z.enum(KNOWN_PREDICATE_IDS),
  z.string().min(1),
  StructuredPredicateSchema,
]);
export type PredicateSpec = KnownPredicateId | (string & {}) | StructuredPredicate;

/**
 * Valid targets for `flat_bonus` modifiers.
 */
export const FLAT_BONUS_BASE_TARGETS = [
  'ac',
  'initiative',
  'speed',
  'melee_attack',
  'ranged_attack',
  'spell_attack',
  'spell_save_dc',
  'melee_damage',
  'ranged_damage',
  'all_saving_throws',
  'hp_per_level',
] as const;

export type SaveTarget = `save:${AbilityId}`;
export type SkillTarget = `skill:${SkillId}`;

export type FlatBonusTarget =
  | (typeof FLAT_BONUS_BASE_TARGETS)[number]
  | SaveTarget
  | SkillTarget;

const FLAT_BONUS_BASE_TARGET_SET: ReadonlySet<string> = new Set(FLAT_BONUS_BASE_TARGETS);

export function isValidSaveTarget(val: string): val is SaveTarget {
  if (!val.startsWith('save:')) return false;
  return AbilityIdSchema.safeParse(val.slice('save:'.length)).success;
}

export function isValidSkillTarget(val: string): val is SkillTarget {
  if (!val.startsWith('skill:')) return false;
  return SkillIdSchema.safeParse(val.slice('skill:'.length)).success;
}

export const FlatBonusTargetSchema = z.custom<FlatBonusTarget>(
  (val): val is FlatBonusTarget =>
    typeof val === 'string' &&
    (FLAT_BONUS_BASE_TARGET_SET.has(val) || isValidSaveTarget(val) || isValidSkillTarget(val)),
  { message: 'Invalid FlatBonusTarget' },
);

/**
 * Valid targets for `roll_mode` (Advantage/Disadvantage) modifiers.
 */
export const ROLL_MODE_BASE_TARGETS = [
  'attack_rolls',
  'attacks_against_self',
  'initiative',
  'concentration_saves',
  'death_saves',
  'all_saving_throws',
  'all_ability_checks',
] as const;

export type RollModeTarget =
  | (typeof ROLL_MODE_BASE_TARGETS)[number]
  | SaveTarget
  | SkillTarget;

const ROLL_MODE_BASE_TARGET_SET: ReadonlySet<string> = new Set(ROLL_MODE_BASE_TARGETS);

export const RollModeTargetSchema = z.custom<RollModeTarget>(
  (val): val is RollModeTarget =>
    typeof val === 'string' &&
    (ROLL_MODE_BASE_TARGET_SET.has(val) || isValidSaveTarget(val) || isValidSkillTarget(val)),
  { message: 'Invalid RollModeTarget' },
);

/**
 * Passive Modifier DSL specifications applied by racial traits, class features,
 * equipped items, and active buffs/conditions.
 */
export const AbilityScoreModifierSchema = z.object({
  type: z.literal('ability_score'),
  ability: AbilityIdSchema,
  bonus: z.number().int(),
  maxCap: z.number().int().positive().optional(),
});

export const SetAbilityMinimumModifierSchema = z.object({
  type: z.literal('set_ability_minimum'),
  ability: AbilityIdSchema,
  minimum: z.number().int().positive(),
});

export const AcCalculationModifierSchema = z.object({
  type: z.literal('ac_calculation'),
  id: z.string().min(1),
  formula: FormulaStringSchema,
  allowsShield: z.boolean(),
  requiresNoArmor: z.boolean(),
});

export const FlatBonusModifierSchema = z.object({
  type: z.literal('flat_bonus'),
  target: FlatBonusTargetSchema,
  value: z.union([z.number(), FormulaStringSchema]),
  condition: PredicateSpecSchema.optional(),
});

export const RollModeModifierSchema = z.object({
  type: z.literal('roll_mode'),
  mode: z.enum(['advantage', 'disadvantage']),
  target: RollModeTargetSchema,
  condition: PredicateSpecSchema.optional(),
});

export const DamageMitigationModifierSchema = z.object({
  type: z.literal('damage_mitigation'),
  mitigation: z.enum(['resistance', 'immunity', 'vulnerability']),
  damageTypes: z.array(DamageTypeSchema).min(1),
  bypassedBy: z.enum(['magical', 'silvered', 'adamantine']).optional(),
});

export const ConditionImmunityModifierSchema = z.object({
  type: z.literal('condition_immunity'),
  conditions: z.array(ConditionIdSchema).min(1),
});

export const DieManipulationRuleSchema = z.enum([
  'halfling_lucky',
  'great_weapon_fighting',
  'brutal_critical',
  'savage_attacks',
  'expanded_crit_range',
]);
export type DieManipulationRule = z.infer<typeof DieManipulationRuleSchema>;

export const DieManipulationModifierSchema = z.object({
  type: z.literal('die_manipulation'),
  rule: DieManipulationRuleSchema,
  params: z.record(z.string(), z.number()).optional(),
});

export const ExtraAttackModifierSchema = z.object({
  type: z.literal('extra_attack'),
  attacksPerAction: z.union([z.literal(2), z.literal(3), z.literal(4)]),
});

export const GrantResourceModifierSchema = z.object({
  type: z.literal('grant_resource'),
  resourceId: z.string().min(1),
  name: z.string().min(1),
  maxFormula: FormulaStringSchema,
  recovery: RestTypeSchema,
  recoveryAmountFormula: FormulaStringSchema.optional(),
});

export const ModifierSpecSchema = z.discriminatedUnion('type', [
  AbilityScoreModifierSchema,
  SetAbilityMinimumModifierSchema,
  AcCalculationModifierSchema,
  FlatBonusModifierSchema,
  RollModeModifierSchema,
  DamageMitigationModifierSchema,
  ConditionImmunityModifierSchema,
  DieManipulationModifierSchema,
  ExtraAttackModifierSchema,
  GrantResourceModifierSchema,
]);
export type ModifierSpec = z.infer<typeof ModifierSpecSchema>;

/**
 * Reaction interrupt trigger specification (used by Shield, Counterspell, Feather Fall, Hellish Rebuke, Protection, Uncanny Dodge).
 */
export const REACTION_TRIGGER_EVENTS = [
  'enemy_leaves_reach',
  'hit_by_attack',
  'ally_within_5ft_targeted_by_attack',
  'creature_within_60ft_casts_spell',
  'damaged_by_visible_creature_within_60ft',
  'creature_falls',
  'custom',
] as const;
export const ReactionTriggerEventSchema = z.enum(REACTION_TRIGGER_EVENTS);
export type ReactionTriggerEvent = z.infer<typeof ReactionTriggerEventSchema>;

export const ReactionTriggerSpecSchema = z.object({
  event: ReactionTriggerEventSchema,
  rangeFeet: z.number().nonnegative().optional(),
  description: z.string().min(1).optional(),
});
export type ReactionTriggerSpec = z.infer<typeof ReactionTriggerSpecSchema>;

/**
 * Targeting and Area-of-Effect specification for spells, abilities, and monster actions.
 */
export const SpellTargetAoeSchema = z.object({
  shape: AoeShapeTypeSchema,
  sizeFeet: z.number().positive(),
  widthFeet: z.number().positive().optional(),
});
export type SpellTargetAoe = z.infer<typeof SpellTargetAoeSchema>;

export const SpellTargetSpecSchema = z.object({
  type: z.enum(['self', 'touch', 'single', 'multiple', 'point_aoe', 'self_aoe']),
  rangeFeet: z.number().nonnegative(),
  requiresSight: z.boolean().optional(),
  targetFilter: z
    .enum(['creature', 'ally', 'enemy', 'willing', 'corpse', 'object_or_creature'])
    .optional(),
  maxTargets: z.union([z.number().int().positive(), FormulaStringSchema]).optional(),
  aoe: SpellTargetAoeSchema.optional(),
});
export type SpellTargetSpec = z.infer<typeof SpellTargetSpecSchema>;

/**
 * Recursive Active Effect Step union executed by `@srd5/engine` during combat/exploration.
 */
export type EffectStepSpec =
  | {
      step: 'attack_roll';
      attackType: 'melee_weapon' | 'ranged_weapon' | 'melee_spell' | 'ranged_spell';
      attackBonusOverride?: number | undefined;
      critRange?: number | undefined;
      onHit: EffectStepSpec[];
      onMiss?: EffectStepSpec[] | undefined;
    }
  | {
      step: 'saving_throw';
      ability: AbilityId;
      dcFormula: string;
      onFail: EffectStepSpec[];
      onSuccess?: EffectStepSpec[] | undefined;
    }
  | {
      step: 'deal_damage';
      diceFormula: string;
      damageType: DamageType;
      halfOnSaveSuccess?: boolean | undefined;
      isMagical?: boolean | undefined;
    }
  | {
      step: 'heal';
      diceFormula: string;
    }
  | {
      step: 'grant_temp_hp';
      amountFormula: string;
    }
  | {
      step: 'apply_condition';
      conditionId: ConditionId;
      durationRounds?: number | undefined;
      requiresConcentration?: boolean | undefined;
      repeatSaveAtTurnEnd?:
        | {
            ability: AbilityId;
            dcFormula: string;
          }
        | undefined;
    }
  | {
      step: 'apply_active_effect';
      effectId: string;
      name: string;
      durationRounds: number;
      requiresConcentration: boolean;
      modifiers: ModifierSpec[];
    }
  | {
      step: 'forced_movement';
      direction: 'push_from_actor' | 'pull_to_actor';
      distanceFeet: number;
    }
  | {
      step: 'teleport';
      maxDistanceFeet: number;
    }
  | {
      step: 'create_hazard_zone';
      zoneId: string;
      shape: AoeShapeType;
      sizeFeet: number;
      durationRounds: number;
      requiresConcentration: boolean;
      difficultTerrain: boolean;
      obscurement?: 'light' | 'heavy' | undefined;
      onEnterOrStartTurn: EffectStepSpec[];
    }
  | {
      step: 'spend_resource';
      resourceId: string;
      amount: number;
    };

export const EffectStepSpecSchema: z.ZodType<EffectStepSpec> = z.lazy(() =>
  z.discriminatedUnion('step', [
    z.object({
      step: z.literal('attack_roll'),
      attackType: z.enum(['melee_weapon', 'ranged_weapon', 'melee_spell', 'ranged_spell']),
      attackBonusOverride: z.number().int().optional(),
      critRange: z.number().int().min(1).max(20).optional(),
      onHit: z.array(EffectStepSpecSchema).min(1),
      onMiss: z.array(EffectStepSpecSchema).optional(),
    }),
    z.object({
      step: z.literal('saving_throw'),
      ability: AbilityIdSchema,
      dcFormula: FormulaStringSchema,
      onFail: z.array(EffectStepSpecSchema).min(1),
      onSuccess: z.array(EffectStepSpecSchema).optional(),
    }),
    z.object({
      step: z.literal('deal_damage'),
      diceFormula: FormulaStringSchema,
      damageType: DamageTypeSchema,
      halfOnSaveSuccess: z.boolean().optional(),
      isMagical: z.boolean().optional(),
    }),
    z.object({
      step: z.literal('heal'),
      diceFormula: FormulaStringSchema,
    }),
    z.object({
      step: z.literal('grant_temp_hp'),
      amountFormula: FormulaStringSchema,
    }),
    z.object({
      step: z.literal('apply_condition'),
      conditionId: ConditionIdSchema,
      durationRounds: z.number().int().positive().optional(),
      requiresConcentration: z.boolean().optional(),
      repeatSaveAtTurnEnd: z
        .object({
          ability: AbilityIdSchema,
          dcFormula: FormulaStringSchema,
        })
        .optional(),
    }),
    z.object({
      step: z.literal('apply_active_effect'),
      effectId: z.string().min(1),
      name: z.string().min(1),
      durationRounds: z.number().int().nonnegative(),
      requiresConcentration: z.boolean(),
      modifiers: z.array(ModifierSpecSchema),
    }),
    z.object({
      step: z.literal('forced_movement'),
      direction: z.enum(['push_from_actor', 'pull_to_actor']),
      distanceFeet: z.number().positive(),
    }),
    z.object({
      step: z.literal('teleport'),
      maxDistanceFeet: z.number().positive(),
    }),
    z.object({
      step: z.literal('create_hazard_zone'),
      zoneId: z.string().min(1),
      shape: AoeShapeTypeSchema,
      sizeFeet: z.number().positive(),
      durationRounds: z.number().int().positive(),
      requiresConcentration: z.boolean(),
      difficultTerrain: z.boolean(),
      obscurement: z.enum(['light', 'heavy']).optional(),
      onEnterOrStartTurn: z.array(EffectStepSpecSchema),
    }),
    z.object({
      step: z.literal('spend_resource'),
      resourceId: z.string().min(1),
      amount: z.number().int().positive(),
    }),
  ]),
);

/**
 * Activated ability specification attached to racial traits, class features, or magic items.
 */
export const ActivatedAbilitySpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  actionCost: ActionCostSchema,
  reactionTrigger: ReactionTriggerSpecSchema.optional(),
  resourceCost: z
    .object({
      resourceId: z.string().min(1),
      amount: z.number().int().positive(),
    })
    .optional(),
  targeting: SpellTargetSpecSchema.optional(),
  effects: z.array(EffectStepSpecSchema).min(1),
});
export type ActivatedAbilitySpec = z.infer<typeof ActivatedAbilitySpecSchema>;
