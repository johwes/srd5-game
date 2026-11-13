import { z } from 'zod';
import { AbilityIdSchema, MagicSchoolSchema } from './enums.js';

/**
 * Source pool for proficiency, skill, language, or tool choices.
 */
export const ChoiceFromSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('explicit'),
    options: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    mode: z.literal('category'),
    category: z.string().min(1),
  }),
]);
export type ChoiceFrom = z.infer<typeof ChoiceFromSchema>;

/**
 * Individual item or category choice entry within a starting equipment bundle branch.
 */
export const EquipmentOptionItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('item'),
    itemId: z.string().min(1),
    quantity: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('category_choice'),
    category: z.string().min(1),
    count: z.number().int().positive(),
  }),
]);
export type EquipmentOptionItem = z.infer<typeof EquipmentOptionItemSchema>;

/**
 * A selectable branch in an `equipment_bundle` ChoiceSpec (e.g., "(a) a martial weapon and a shield or (b) two martial weapons").
 */
export const EquipmentOptionBranchSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  items: z.array(EquipmentOptionItemSchema).min(1),
});
export type EquipmentOptionBranch = z.infer<typeof EquipmentOptionBranchSchema>;

const BaseChoiceFields = {
  id: z.string().min(1),
  label: z.string().min(1),
  count: z.number().int().positive(),
};

/**
 * Choice for proficiencies, skills, languages, or tools.
 */
export const ProficiencyChoiceSpecSchema = z.object({
  ...BaseChoiceFields,
  type: z.enum(['proficiency', 'skill', 'language', 'tool']),
  from: ChoiceFromSchema,
});
export type ProficiencyChoiceSpec = z.infer<typeof ProficiencyChoiceSpecSchema>;

/**
 * Choice for ability score bonuses (e.g., Half-Elf +1 to two distinct abilities other than CHA).
 */
export const AbilityScoreBonusChoiceSpecSchema = z.object({
  ...BaseChoiceFields,
  type: z.literal('ability_score_bonus'),
  bonus: z.number().int().positive(),
  excludeAbilities: z.array(AbilityIdSchema).optional(),
  distinct: z.boolean().optional(),
});
export type AbilityScoreBonusChoiceSpec = z.infer<typeof AbilityScoreBonusChoiceSpecSchema>;

/**
 * Choice for bonus cantrips or spells (e.g., High Elf Wizard cantrip, Bard Magical Secrets).
 */
export const SpellChoiceSpecSchema = z.object({
  ...BaseChoiceFields,
  type: z.literal('spell'),
  classList: z.string().min(1),
  maxSpellLevel: z.number().int().min(0).max(9),
  schoolRestriction: z.array(MagicSchoolSchema).min(1).optional(),
});
export type SpellChoiceSpec = z.infer<typeof SpellChoiceSpecSchema>;

/**
 * Choice for class/racial feature options (e.g., Fighting Style, Draconic Ancestry, Land Circle, Hunter's Prey).
 */
export const FeatureOptionChoiceSpecSchema = z.object({
  ...BaseChoiceFields,
  type: z.literal('feature_option'),
  featureGroup: z.string().min(1),
  options: z.array(z.string().min(1)).min(1),
});
export type FeatureOptionChoiceSpec = z.infer<typeof FeatureOptionChoiceSpecSchema>;

/**
 * Choice for starting equipment bundles.
 */
export const EquipmentBundleChoiceSpecSchema = z.object({
  ...BaseChoiceFields,
  type: z.literal('equipment_bundle'),
  options: z.array(EquipmentOptionBranchSchema).min(1),
});
export type EquipmentBundleChoiceSpec = z.infer<typeof EquipmentBundleChoiceSpecSchema>;

/**
 * Unified Choice Tree specification used across SRD 5.1 races, classes, subclasses, backgrounds, and feats.
 */
export const ChoiceSpecSchema = z.discriminatedUnion('type', [
  ProficiencyChoiceSpecSchema,
  AbilityScoreBonusChoiceSpecSchema,
  SpellChoiceSpecSchema,
  FeatureOptionChoiceSpecSchema,
  EquipmentBundleChoiceSpecSchema,
]);
export type ChoiceSpec = z.infer<typeof ChoiceSpecSchema>;
