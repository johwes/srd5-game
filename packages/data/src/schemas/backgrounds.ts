import { z } from 'zod';
import { ChoiceSpecSchema } from './choices.js';
import { StartingEquipmentItemEntrySchema } from './classes.js';
import { SkillIdSchema } from './enums.js';

/**
 * Narrative/discovery feature granted by an SRD 5.1 Background (e.g., Acolyte "Shelter of the Faithful").
 */
export const BackgroundFeatureSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
});
export type BackgroundFeatureData = z.infer<typeof BackgroundFeatureSchema>;

/**
 * Starting coin purse granted by a Background.
 */
export const BackgroundCurrencySchema = z.object({
  cp: z.number().int().nonnegative().optional(),
  sp: z.number().int().nonnegative().optional(),
  ep: z.number().int().nonnegative().optional(),
  gp: z.number().int().nonnegative().optional(),
  pp: z.number().int().nonnegative().optional(),
});
export type BackgroundCurrency = z.infer<typeof BackgroundCurrencySchema>;

/**
 * Roleplay characteristic tables (personality traits, ideals, bonds, flaws) for a Background.
 */
export const BackgroundCharacteristicsSchema = z.object({
  personalityTraits: z.array(z.string().min(1)),
  ideals: z.array(z.string().min(1)),
  bonds: z.array(z.string().min(1)),
  flaws: z.array(z.string().min(1)),
});
export type BackgroundCharacteristics = z.infer<typeof BackgroundCharacteristicsSchema>;

/**
 * SRD 5.1 Background schema (`packages/data/src/srd/backgrounds.json`).
 */
export const BackgroundSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  skillProficiencies: z.array(SkillIdSchema),
  toolProficiencies: z.array(z.string().min(1)),
  languages: z.array(z.string().min(1)),
  choices: z.array(ChoiceSpecSchema),
  startingEquipment: z.array(StartingEquipmentItemEntrySchema),
  startingCurrency: BackgroundCurrencySchema.optional(),
  feature: BackgroundFeatureSchema,
  suggestedCharacteristics: BackgroundCharacteristicsSchema.optional(),
  description: z.string().min(1),
  source: z.enum(['srd-5.1', 'homebrew']).optional(),
  humanReviewed: z.boolean().optional(),
});
export type BackgroundData = z.infer<typeof BackgroundSchema>;
