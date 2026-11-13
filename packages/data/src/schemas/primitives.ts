import { z } from 'zod';
import { ModifierSpecSchema } from './effects.js';
import {
  AbilityIdSchema,
  ConditionIdSchema,
  DamageTypeSchema,
  SkillIdSchema,
} from './enums.js';

/**
 * SRD 5.1 Ability Score metadata definition (`packages/data/src/srd/abilities-and-skills.json`).
 */
export const AbilityScoreDefinitionSchema = z.object({
  id: AbilityIdSchema,
  name: z.string().min(1),
  abbreviation: z.string().min(1),
  description: z.string().min(1),
  skills: z.array(SkillIdSchema),
});
export type AbilityScoreDefinition = z.infer<typeof AbilityScoreDefinitionSchema>;

/**
 * SRD 5.1 Skill metadata definition (`packages/data/src/srd/abilities-and-skills.json`).
 */
export const SkillDefinitionSchema = z.object({
  id: SkillIdSchema,
  name: z.string().min(1),
  ability: AbilityIdSchema,
  description: z.string().min(1),
});
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;

/**
 * Combined schema for `packages/data/src/srd/abilities-and-skills.json`.
 */
export const AbilitiesAndSkillsFileSchema = z.object({
  abilities: z.array(AbilityScoreDefinitionSchema).length(6),
  skills: z.array(SkillDefinitionSchema).length(18),
});
export type AbilitiesAndSkillsFile = z.infer<typeof AbilitiesAndSkillsFileSchema>;

/**
 * SRD 5.1 Condition definition (`packages/data/src/srd/conditions.json`).
 */
export const ConditionDefinitionSchema = z.object({
  id: ConditionIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  bullets: z.array(z.string().min(1)).min(1),
  modifiers: z.array(ModifierSpecSchema).optional(),
});
export type ConditionDefinition = z.infer<typeof ConditionDefinitionSchema>;

/**
 * SRD 5.1 Damage Type definition (`packages/data/src/srd/damage-types.json`).
 */
export const DamageTypeDefinitionSchema = z.object({
  id: DamageTypeSchema,
  name: z.string().min(1),
  description: z.string().min(1),
});
export type DamageTypeDefinition = z.infer<typeof DamageTypeDefinitionSchema>;

/**
 * SRD 5.1 Proficiency categories.
 */
export const PROFICIENCY_CATEGORIES = [
  'armor',
  'weapon',
  'tool',
  'saving_throw',
  'skill',
  'other',
] as const;
export const ProficiencyCategorySchema = z.enum(PROFICIENCY_CATEGORIES);
export type ProficiencyCategory = z.infer<typeof ProficiencyCategorySchema>;

/**
 * SRD 5.1 Proficiency definition (`packages/data/src/srd/proficiencies-and-languages.json`).
 */
export const ProficiencyDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: ProficiencyCategorySchema,
  equipmentIds: z.array(z.string().min(1)).optional(),
  description: z.string().min(1).optional(),
});
export type ProficiencyDefinition = z.infer<typeof ProficiencyDefinitionSchema>;

/**
 * SRD 5.1 Language categories (`standard` or `exotic`).
 */
export const LANGUAGE_CATEGORIES = ['standard', 'exotic'] as const;
export const LanguageCategorySchema = z.enum(LANGUAGE_CATEGORIES);
export type LanguageCategory = z.infer<typeof LanguageCategorySchema>;

/**
 * SRD 5.1 Language definition (`packages/data/src/srd/proficiencies-and-languages.json`).
 */
export const LanguageDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: LanguageCategorySchema,
  typicalSpeakers: z.array(z.string().min(1)),
  script: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
});
export type LanguageDefinition = z.infer<typeof LanguageDefinitionSchema>;

/**
 * Combined schema for `packages/data/src/srd/proficiencies-and-languages.json`.
 */
export const ProficienciesAndLanguagesFileSchema = z.object({
  proficiencies: z.array(ProficiencyDefinitionSchema).min(1),
  languages: z.array(LanguageDefinitionSchema).min(1),
});
export type ProficienciesAndLanguagesFile = z.infer<typeof ProficienciesAndLanguagesFileSchema>;
