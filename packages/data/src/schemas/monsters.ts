import { z } from 'zod';
import {
  ActivatedAbilitySpecSchema,
  EffectStepSpecSchema,
  ModifierSpecSchema,
  ReactionTriggerSpecSchema,
  SpellTargetSpecSchema,
} from './effects.js';
import {
  AbilityIdSchema,
  ActionCostSchema,
  ConditionIdSchema,
  CreatureSizeSchema,
  CreatureTypeSchema,
  DamageTypeSchema,
  FormulaStringSchema,
  RestTypeSchema,
  SKILL_IDS,
  type SkillId,
} from './enums.js';
import { AbilityBonusMapSchema } from './races.js';

/**
 * Canonical SRD 5.1 Challenge Rating values (`0`, `1/8`, `1/4`, `1/2`, `1..30`).
 */
export const CHALLENGE_RATINGS = [
  0, 0.125, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
  22, 23, 24, 25, 26, 27, 28, 29, 30,
] as const;
export type ChallengeRating = (typeof CHALLENGE_RATINGS)[number];

const CHALLENGE_RATING_SET: ReadonlySet<number> = new Set(CHALLENGE_RATINGS);

export const ChallengeRatingSchema = z.custom<ChallengeRating>(
  (val): val is ChallengeRating => typeof val === 'number' && CHALLENGE_RATING_SET.has(val),
  { message: 'Invalid SRD 5.1 Challenge Rating' },
);

/**
 * Tactical Monster AI behavioral archetypes (`docs/spec/04-dungeon-and-ai.md`).
 */
export const AI_ARCHETYPES = [
  'brute',
  'skirmisher',
  'artillery',
  'controller',
  'support',
] as const;
export const AiArchetypeSchema = z.enum(AI_ARCHETYPES);
export type AiArchetype = z.infer<typeof AiArchetypeSchema>;

/**
 * Monster Armor Class breakdown.
 */
export const MonsterArmorClassSchema = z.object({
  value: z.number().int().positive(),
  type: z.enum(['natural', 'armor', 'mage_armor', 'unarmored']),
  armorIds: z.array(z.string().min(1)).optional(),
  hasShield: z.boolean().optional(),
  notes: z.string().min(1).optional(),
});
export type MonsterArmorClass = z.infer<typeof MonsterArmorClassSchema>;

/**
 * Monster Hit Points (fixed average and Hit Dice roll formula).
 */
export const MonsterHitPointsSchema = z.object({
  average: z.number().int().positive(),
  rollFormula: FormulaStringSchema,
});
export type MonsterHitPoints = z.infer<typeof MonsterHitPointsSchema>;

/**
 * Monster movement speeds (in feet) across movement modes.
 */
export const MonsterSpeedSchema = z.object({
  walk: z.number().int().nonnegative(),
  fly: z.number().int().nonnegative().optional(),
  hover: z.boolean().optional(),
  swim: z.number().int().nonnegative().optional(),
  climb: z.number().int().nonnegative().optional(),
  burrow: z.number().int().nonnegative().optional(),
});
export type MonsterSpeed = z.infer<typeof MonsterSpeedSchema>;

/**
 * Complete 6-ability score block (`1..30`) for a Monster.
 */
export const MonsterAbilitiesSchema = z
  .object({
    str: z.number().int().min(1).max(30),
    dex: z.number().int().min(1).max(30),
    con: z.number().int().min(1).max(30),
    int: z.number().int().min(1).max(30),
    wis: z.number().int().min(1).max(30),
    cha: z.number().int().min(1).max(30),
  })
  .strict();
export type MonsterAbilities = z.infer<typeof MonsterAbilitiesSchema>;

/**
 * Partial map of SkillId -> total skill modifier for a Monster.
 */
const skillShape = Object.fromEntries(
  SKILL_IDS.map((skillId) => [skillId, z.number().int().optional()]),
) as { [K in SkillId]: z.ZodOptional<z.ZodNumber> };

export const MonsterSkillsSchema = z.object(skillShape).strict();
export type MonsterSkills = z.infer<typeof MonsterSkillsSchema>;

/**
 * Monster sensory radii and Passive Perception score.
 */
export const MonsterSensesSchema = z.object({
  darkvisionFeet: z.number().int().nonnegative().optional(),
  blindsightFeet: z.number().int().nonnegative().optional(),
  tremorsenseFeet: z.number().int().nonnegative().optional(),
  truesightFeet: z.number().int().nonnegative().optional(),
  passivePerception: z.number().int(),
});
export type MonsterSenses = z.infer<typeof MonsterSensesSchema>;

/**
 * Innate or class-based spellcasting block for a Monster (e.g., Mage, Priest, Lich).
 */
export const MonsterSpellcastingSpecSchema = z.object({
  ability: AbilityIdSchema,
  spellSaveDc: z.number().int().positive(),
  spellAttackBonus: z.number().int(),
  casterLevel: z.number().int().min(1).max(20).optional(),
  classId: z.string().min(1).optional(),
  slotsByLevel: z.record(z.string(), z.number().int().nonnegative()).optional(),
  atWillSpellIds: z.array(z.string().min(1)).optional(),
  perDaySpells: z
    .array(
      z.object({
        perDay: z.number().int().positive(),
        spellIds: z.array(z.string().min(1)).min(1),
      }),
    )
    .optional(),
  preparedSpellIds: z.array(z.string().min(1)).optional(),
});
export type MonsterSpellcastingSpec = z.infer<typeof MonsterSpellcastingSpecSchema>;

/**
 * Special trait on a Monster stat block (e.g., Pack Tactics, Nimble Escape, Amphibious, Magic Resistance).
 */
export const MonsterTraitSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  modifiers: z.array(ModifierSpecSchema).optional(),
  activatedAbilities: z.array(ActivatedAbilitySpecSchema).optional(),
  spellcasting: MonsterSpellcastingSpecSchema.optional(),
});
export type MonsterTraitSpec = z.infer<typeof MonsterTraitSpecSchema>;

/**
 * Recharge specification for a Monster action (e.g., Dragon Breath `Recharge 5-6` or `3/Day`).
 */
export const MonsterActionRechargeSchema = z.union([
  z.object({
    minRoll: z.union([z.literal(4), z.literal(5), z.literal(6)]),
    die: z.literal(6),
  }),
  z.object({
    perDay: z.number().int().positive(),
  }),
  z.object({
    restType: RestTypeSchema,
    uses: z.number().int().positive().optional(),
  }),
]);
export type MonsterActionRecharge = z.infer<typeof MonsterActionRechargeSchema>;

/**
 * Multiattack sequence specification referencing sub-action IDs and counts.
 */
export const MonsterMultiattackSpecSchema = z.object({
  sequence: z
    .array(
      z.object({
        actionId: z.string().min(1),
        count: z.number().int().positive(),
      }),
    )
    .min(1),
  description: z.string().min(1).optional(),
});
export type MonsterMultiattackSpec = z.infer<typeof MonsterMultiattackSpecSchema>;

/**
 * Action, Bonus Action, Reaction, or Legendary Action entry on a Monster stat block.
 */
export const MonsterActionSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  actionCost: ActionCostSchema,
  reactionTrigger: ReactionTriggerSpecSchema.optional(),
  legendaryCost: z.number().int().min(1).max(3).optional(),
  recharge: MonsterActionRechargeSchema.optional(),
  multiattack: MonsterMultiattackSpecSchema.optional(),
  targeting: SpellTargetSpecSchema.optional(),
  effects: z.array(EffectStepSpecSchema),
});
export type MonsterActionSpec = z.infer<typeof MonsterActionSpecSchema>;

/**
 * Legendary Action pool and action list for boss monsters.
 */
export const MonsterLegendaryActionsSchema = z.object({
  perRound: z.number().int().positive(),
  description: z.string().min(1).optional(),
  actions: z.array(MonsterActionSpecSchema).min(1),
});
export type MonsterLegendaryActions = z.infer<typeof MonsterLegendaryActionsSchema>;

/**
 * SRD 5.1 Monster schema (`packages/data/src/srd/monsters.json`).
 */
export const MonsterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  size: CreatureSizeSchema,
  type: CreatureTypeSchema,
  subtype: z.string().min(1).optional(),
  alignment: z.string().min(1),
  armorClass: MonsterArmorClassSchema,
  hitPoints: MonsterHitPointsSchema,
  speed: MonsterSpeedSchema,
  abilities: MonsterAbilitiesSchema,
  savingThrows: AbilityBonusMapSchema,
  skills: MonsterSkillsSchema,
  damageVulnerabilities: z.array(DamageTypeSchema),
  damageResistances: z.array(DamageTypeSchema),
  damageImmunities: z.array(DamageTypeSchema),
  conditionImmunities: z.array(ConditionIdSchema),
  senses: MonsterSensesSchema,
  languages: z.array(z.string().min(1)),
  challengeRating: ChallengeRatingSchema,
  xp: z.number().int().nonnegative(),
  aiArchetype: AiArchetypeSchema,
  traits: z.array(MonsterTraitSpecSchema),
  spellcasting: MonsterSpellcastingSpecSchema.optional(),
  actions: z.array(MonsterActionSpecSchema),
  bonusActions: z.array(MonsterActionSpecSchema).optional(),
  reactions: z.array(MonsterActionSpecSchema).optional(),
  legendaryActions: MonsterLegendaryActionsSchema.optional(),
  description: z.string().min(1).optional(),
});
export type MonsterData = z.infer<typeof MonsterSchema>;
