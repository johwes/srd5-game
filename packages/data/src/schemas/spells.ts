import { z } from 'zod';
import {
  type EffectStepSpec,
  EffectStepSpecSchema,
  ReactionTriggerSpecSchema,
  SpellTargetSpecSchema,
} from './effects.js';
import {
  ActionCostSchema,
  FormulaStringSchema,
  MagicSchoolSchema,
} from './enums.js';

/**
 * Allowed SRD 5.1 Spell Levels (`0` for cantrips, `1..9` for leveled spells).
 */
export const SPELL_LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export const SpellLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
  z.literal(9),
]);
export type SpellLevel = z.infer<typeof SpellLevelSchema>;

/**
 * Extended ritual / non-combat casting times in addition to tactical `ActionCost` values.
 */
export const EXTENDED_SPELL_CASTING_TIMES = [
  '1_minute',
  '10_minutes',
  '1_hour',
  '8_hours',
  '12_hours',
  '24_hours',
] as const;
export const SpellCastingTimeSchema = z.union([
  ActionCostSchema,
  z.enum(EXTENDED_SPELL_CASTING_TIMES),
]);
export type SpellCastingTime = z.infer<typeof SpellCastingTimeSchema>;

/**
 * Structured SRD 5.1 Spell Duration specification.
 */
export const SpellDurationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('instantaneous'),
  }),
  z.object({
    type: z.literal('rounds'),
    rounds: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('minutes'),
    amount: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('hours'),
    amount: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('days'),
    amount: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('until_dispelled'),
  }),
  z.object({
    type: z.literal('special'),
  }),
]);
export type SpellDuration = z.infer<typeof SpellDurationSchema>;

/**
 * Verbal, Somatic, and Material (V, S, M) component requirements for casting a spell.
 */
export const SpellComponentsSchema = z.object({
  verbal: z.boolean(),
  somatic: z.boolean(),
  material: z.boolean(),
  materialDescription: z.string().min(1).optional(),
  materialCostGold: z.number().nonnegative().optional(),
  materialConsumed: z.boolean().optional(),
});
export type SpellComponents = z.infer<typeof SpellComponentsSchema>;

/**
 * Partial override for an EffectStepSpec at a higher spell slot level or character cantrip tier.
 */
export const SpellEffectStepOverrideSchema: z.ZodType<Partial<EffectStepSpec>> = z
  .object({
    step: z
      .enum([
        'attack_roll',
        'saving_throw',
        'deal_damage',
        'heal',
        'grant_temp_hp',
        'apply_condition',
        'apply_active_effect',
        'forced_movement',
        'teleport',
        'create_hazard_zone',
        'spend_resource',
      ])
      .optional(),
    diceFormula: FormulaStringSchema.optional(),
    amountFormula: FormulaStringSchema.optional(),
    durationRounds: z.number().int().positive().optional(),
    distanceFeet: z.number().positive().optional(),
    maxDistanceFeet: z.number().positive().optional(),
    sizeFeet: z.number().positive().optional(),
    onHit: z.array(EffectStepSpecSchema).optional(),
    onMiss: z.array(EffectStepSpecSchema).optional(),
    onFail: z.array(EffectStepSpecSchema).optional(),
    onSuccess: z.array(EffectStepSpecSchema).optional(),
  })
  .passthrough() as z.ZodType<Partial<EffectStepSpec>>;

/**
 * Higher-level scaling specification for cantrips (`character_level`: L5, L11, L17)
 * and leveled spells (`slot_level` upcasting).
 */
export const SpellHigherLevelScalingSchema = z.object({
  mode: z.enum(['slot_level', 'character_level']),
  overrides: z.record(z.string(), SpellEffectStepOverrideSchema).optional(),
  bonusDicePerSlotAboveBase: FormulaStringSchema.optional(),
  bonusTargetsPerSlotAboveBase: z.number().int().positive().optional(),
});
export type SpellHigherLevelScaling = z.infer<typeof SpellHigherLevelScalingSchema>;

/**
 * SRD 5.1 Spell schema (`packages/data/src/srd/spells.json`).
 */
export const SpellSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  level: SpellLevelSchema,
  school: MagicSchoolSchema,
  castingTime: SpellCastingTimeSchema,
  reactionTrigger: ReactionTriggerSpecSchema.optional(),
  ritual: z.boolean(),
  concentration: z.boolean(),
  duration: SpellDurationSchema,
  components: SpellComponentsSchema,
  classes: z.array(z.string().min(1)).min(1),
  subclasses: z.array(z.string().min(1)).optional(),
  targeting: SpellTargetSpecSchema,
  effects: z.array(EffectStepSpecSchema),
  higherLevelScaling: SpellHigherLevelScalingSchema.optional(),
  description: z.string().min(1),
  higherLevelDescription: z.string().min(1).optional(),
});
export type SpellData = z.infer<typeof SpellSchema>;
