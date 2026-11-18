import { z } from 'zod';
import { ChoiceSpecSchema } from './choices.js';
import { ActivatedAbilitySpecSchema, ModifierSpecSchema } from './effects.js';
import { AbilityIdSchema, FormulaStringSchema } from './enums.js';

/**
 * Allowed SRD 5.1 class Hit Die sizes (`d6`, `d8`, `d10`, `d12`).
 */
export const HIT_DIE_SIZES = [6, 8, 10, 12] as const;
export const HitDieSizeSchema = z.union([
  z.literal(6),
  z.literal(8),
  z.literal(10),
  z.literal(12),
]);
export type HitDieSize = z.infer<typeof HitDieSizeSchema>;

/**
 * Spellcasting progression categories for single-class and multiclass slot calculation.
 */
export const SPELLCASTING_PROGRESSIONS = ['full', 'half', 'third', 'pact'] as const;
export const SpellcastingProgressionSchema = z.enum(SPELLCASTING_PROGRESSIONS);
export type SpellcastingProgression = z.infer<typeof SpellcastingProgressionSchema>;

/**
 * Spell preparation / learning model for a spellcasting class.
 */
export const SPELL_PREPARATION_MODES = ['known', 'prepared_full_list', 'spellbook'] as const;
export const SpellPreparationModeSchema = z.enum(SPELL_PREPARATION_MODES);
export type SpellPreparationMode = z.infer<typeof SpellPreparationModeSchema>;

/**
 * Class-level spellcasting metadata (`ClassData.spellcasting`).
 */
export const ClassSpellcastingSchema = z.object({
  ability: AbilityIdSchema,
  progression: SpellcastingProgressionSchema,
  preparationMode: SpellPreparationModeSchema,
  cantripsKnownByLevel: z.array(z.number().int().nonnegative()).length(20),
  spellsKnownByLevel: z.array(z.number().int().nonnegative()).length(20).optional(),
  ritualCasting: z.boolean(),
  spellcastingFocusType: z.string().min(1).optional(),
});
export type ClassSpellcasting = z.infer<typeof ClassSpellcastingSchema>;

/**
 * Spell slot table entry at a specific class level (levels 1..9 plus optional Warlock Pact Magic).
 */
export const ClassLevelSpellSlotsSchema = z.object({
  level1: z.number().int().nonnegative(),
  level2: z.number().int().nonnegative(),
  level3: z.number().int().nonnegative(),
  level4: z.number().int().nonnegative(),
  level5: z.number().int().nonnegative(),
  level6: z.number().int().nonnegative(),
  level7: z.number().int().nonnegative(),
  level8: z.number().int().nonnegative(),
  level9: z.number().int().nonnegative(),
  pactSlots: z.number().int().nonnegative().optional(),
  pactSlotLevel: z.number().int().min(1).max(9).optional(),
});
export type ClassLevelSpellSlots = z.infer<typeof ClassLevelSpellSlotsSchema>;

/**
 * Per-level (1..20) progression row for an SRD 5.1 class.
 */
export const ClassLevelProgressionSchema = z.object({
  level: z.number().int().min(1).max(20),
  proficiencyBonus: z.number().int().min(2).max(6),
  featureIds: z.array(z.string().min(1)),
  classSpecific: z.record(z.string(), z.union([z.number(), z.string()])),
  spellSlots: ClassLevelSpellSlotsSchema.optional(),
});
export type ClassLevelProgression = z.infer<typeof ClassLevelProgressionSchema>;

/**
 * Fixed starting item grant (used by classes and backgrounds alongside equipment bundle choices).
 */
export const StartingEquipmentItemEntrySchema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().positive(),
});
export type StartingEquipmentItemEntry = z.infer<typeof StartingEquipmentItemEntrySchema>;

/**
 * SRD 5.1 Class schema (`packages/data/src/srd/classes.json`), covering levels 1 through 20.
 */
export const ClassSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  hitDie: HitDieSizeSchema,
  primaryAbilities: z.array(AbilityIdSchema).min(1),
  savingThrowProficiencies: z.tuple([AbilityIdSchema, AbilityIdSchema]),
  armorProficiencies: z.array(z.string().min(1)),
  weaponProficiencies: z.array(z.string().min(1)),
  toolProficiencies: z.array(z.string().min(1)),
  toolChoices: z.array(ChoiceSpecSchema).optional(),
  skillChoices: ChoiceSpecSchema,
  startingEquipmentChoices: z.array(ChoiceSpecSchema),
  startingEquipmentDefault: z.array(StartingEquipmentItemEntrySchema).optional(),
  startingGoldFormula: FormulaStringSchema,
  subclassLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  subclassTitle: z.string().min(1),
  subclassIds: z.array(z.string().min(1)).optional(),
  spellcasting: ClassSpellcastingSchema.optional(),
  levels: z
    .array(ClassLevelProgressionSchema)
    .length(20)
    .refine((levels) => levels.every((entry, idx) => entry.level === idx + 1), {
      message: 'Class levels must contain 20 sequential entries for levels 1 through 20',
    }),
  description: z.string().min(1).optional(),
});
export type ClassData = z.infer<typeof ClassSchema>;

/**
 * Bonus spell grant for a Subclass (e.g., Cleric Life Domain, Paladin Oath of Devotion,
 * Druid Circle of the Land terrain spells, or Warlock Fiend Patron expanded spell list).
 */
export const SubclassSpellGrantSchema = z.object({
  classLevel: z.number().int().min(1).max(20),
  spellIds: z.array(z.string().min(1)).min(1),
  mode: z.enum(['always_prepared', 'expanded_spell_list']),
  terrain: z.string().min(1).optional(),
});
export type SubclassSpellGrant = z.infer<typeof SubclassSpellGrantSchema>;

/**
 * Per-level feature unlock entry for an SRD 5.1 Subclass.
 */
export const SubclassLevelProgressionSchema = z.object({
  level: z.number().int().min(1).max(20),
  featureIds: z.array(z.string().min(1)).min(1),
});
export type SubclassLevelProgression = z.infer<typeof SubclassLevelProgressionSchema>;

/**
 * SRD 5.1 Subclass schema (`packages/data/src/srd/subclasses.json`).
 */
export const SubclassSchema = z.object({
  id: z.string().min(1),
  classId: z.string().min(1),
  name: z.string().min(1),
  subclassFlavor: z.string().min(1),
  description: z.string().min(1),
  levels: z.array(SubclassLevelProgressionSchema).min(1),
  spells: z.array(SubclassSpellGrantSchema).optional(),
  source: z.enum(['srd-5.1', 'homebrew']).optional(),
});
export type SubclassData = z.infer<typeof SubclassSchema>;

/**
 * SRD 5.1 Class or Subclass Feature schema (`packages/data/src/srd/features.json`).
 */
export const FeatureSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  classId: z.string().min(1),
  subclassId: z.string().min(1).optional(),
  level: z.number().int().min(1).max(20),
  featureGroup: z.string().min(1).optional(),
  prerequisite: z.string().min(1).optional(),
  description: z.string().min(1),
  choices: z.array(ChoiceSpecSchema).optional(),
  modifiers: z.array(ModifierSpecSchema),
  activatedAbilities: z.array(ActivatedAbilitySpecSchema).optional(),
});
export type FeatureData = z.infer<typeof FeatureSchema>;
