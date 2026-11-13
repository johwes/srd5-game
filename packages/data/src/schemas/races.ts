import { z } from 'zod';
import { ChoiceSpecSchema } from './choices.js';
import { ActivatedAbilitySpecSchema, ModifierSpecSchema } from './effects.js';
import { AbilityIdSchema, CreatureSizeSchema, RestTypeSchema } from './enums.js';

/**
 * Partial map of AbilityId -> integer bonus (e.g., `{ str: 2, cha: 1 }` for Dragonborn).
 */
export const AbilityBonusMapSchema = z
  .object({
    str: z.number().int().optional(),
    dex: z.number().int().optional(),
    con: z.number().int().optional(),
    int: z.number().int().optional(),
    wis: z.number().int().optional(),
    cha: z.number().int().optional(),
  })
  .strict();
export type AbilityBonusMap = z.infer<typeof AbilityBonusMapSchema>;

/**
 * Sensory capabilities granted by a Race or Subrace (e.g., 60 ft Darkvision).
 */
export const RacialSensesSchema = z.object({
  darkvisionFeet: z.number().int().nonnegative().optional(),
});
export type RacialSenses = z.infer<typeof RacialSensesSchema>;

/**
 * Innate spellcasting grant attached to a racial trait (e.g., Tiefling Infernal Legacy).
 */
export const InnateSpellGrantSchema = z.object({
  spellId: z.string().min(1),
  minCharacterLevel: z.number().int().min(1).max(20).optional(),
  ability: AbilityIdSchema.optional(),
  oncePerRest: RestTypeSchema.optional(),
  castAtSlotLevel: z.number().int().min(1).max(9).optional(),
});
export type InnateSpellGrant = z.infer<typeof InnateSpellGrantSchema>;

/**
 * SRD 5.1 Racial Trait specification with passive ModifierSpecs and optional ActivatedAbilitySpecs.
 */
export const RacialTraitSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  modifiers: z.array(ModifierSpecSchema),
  activatedAbilities: z.array(ActivatedAbilitySpecSchema).optional(),
  choices: z.array(ChoiceSpecSchema).optional(),
  innateSpells: z.array(InnateSpellGrantSchema).optional(),
});
export type RacialTraitData = z.infer<typeof RacialTraitSchema>;

/**
 * SRD 5.1 Race schema (`packages/data/src/srd/races.json`).
 */
export const RaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  size: CreatureSizeSchema,
  speedFeet: z.number().int().positive(),
  abilityBonuses: AbilityBonusMapSchema,
  choices: z.array(ChoiceSpecSchema),
  senses: RacialSensesSchema,
  proficiencies: z.array(z.string().min(1)),
  languages: z.array(z.string().min(1)),
  traits: z.array(RacialTraitSchema),
  subraceIds: z.array(z.string().min(1)),
  description: z.string().min(1),
});
export type RaceData = z.infer<typeof RaceSchema>;

/**
 * SRD 5.1 Subrace schema (`hill-dwarf`, `high-elf`, `lightfoot-halfling`, `rock-gnome`).
 */
export const SubraceSchema = z.object({
  id: z.string().min(1),
  parentRaceId: z.string().min(1),
  name: z.string().min(1),
  abilityBonuses: AbilityBonusMapSchema,
  choices: z.array(ChoiceSpecSchema),
  senses: RacialSensesSchema.optional(),
  proficiencies: z.array(z.string().min(1)),
  languages: z.array(z.string().min(1)).optional(),
  traits: z.array(RacialTraitSchema),
  description: z.string().min(1),
});
export type SubraceData = z.infer<typeof SubraceSchema>;
