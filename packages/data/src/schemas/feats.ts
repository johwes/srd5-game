import { z } from 'zod';
import { ChoiceSpecSchema } from './choices.js';
import { ActivatedAbilitySpecSchema, ModifierSpecSchema } from './effects.js';
import { AbilityIdSchema } from './enums.js';
import { AbilityBonusMapSchema } from './races.js';

/**
 * Structured prerequisite requirement for selecting an SRD 5.1 Feat
 * (e.g., Grappler requires Strength 13 or higher).
 */
export const FeatPrerequisiteSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ability_minimum'),
    ability: AbilityIdSchema,
    minimum: z.number().int().min(1).max(30),
  }),
  z.object({
    type: z.literal('spellcasting'),
  }),
  z.object({
    type: z.literal('proficiency'),
    proficiencyId: z.string().min(1),
  }),
  z.object({
    type: z.literal('level'),
    minimumLevel: z.number().int().min(1).max(20),
  }),
]);
export type FeatPrerequisite = z.infer<typeof FeatPrerequisiteSchema>;

/**
 * SRD 5.1 Feat schema (`packages/data/src/srd/feats.json`).
 */
export const FeatSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  prerequisites: z.array(FeatPrerequisiteSchema),
  abilityBonuses: AbilityBonusMapSchema.optional(),
  choices: z.array(ChoiceSpecSchema).optional(),
  modifiers: z.array(ModifierSpecSchema),
  activatedAbilities: z.array(ActivatedAbilitySpecSchema).optional(),
});
export type FeatData = z.infer<typeof FeatSchema>;
