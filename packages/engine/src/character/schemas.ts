import { z } from 'zod';
import {
  ABILITY_GENERATION_METHODS,
  type AbilityGenerationMethod,
  AbilityGenerationMethodSchema,
  type AbilityId,
  AbilityIdSchema,
  ActivatedAbilitySpecSchema,
  type ActiveConditionInstance,
  ActiveConditionInstanceSchema,
  type ActiveEffectInstance,
  ActiveEffectInstanceSchema,
  AlignmentSchema,
  type AsiBonusesMap,
  AsiBonusesMapSchema,
  type AsiBonusValue,
  AsiBonusValueSchema,
  type AsiOrFeatSelection,
  AsiOrFeatSelectionSchema,
  type AsiSelection,
  AsiSelectionSchema,
  type BaseAbilities,
  BaseAbilitiesSchema,
  type CharacterBuildState,
  CharacterBuildStateSchema,
  type CharacterClassEntry,
  CharacterClassEntrySchema,
  type CharacterCurrency,
  CharacterCurrencySchema,
  type CharacterRuntimeState,
  CharacterRuntimeStateSchema,
  type CharacterSpellcastingSelection,
  CharacterSpellcastingSelectionSchema,
  type ConcentrationState,
  ConcentrationStateSchema,
  ConditionIdSchema,
  CreatureSizeSchema,
  type CustomBackgroundSpec,
  CustomBackgroundSpecSchema,
  DamageTypeSchema,
  type DeathSaveCount,
  DeathSaveCountSchema,
  type DeathSavesState,
  DeathSavesStateSchema,
  type EquippedSlots,
  EquippedSlotsSchema,
  type ExhaustionLevel,
  ExhaustionLevelSchema,
  type ExpendedSpellSlots,
  ExpendedSpellSlotsSchema,
  type FeatSelection,
  FeatSelectionSchema,
  type HitDiceSpent,
  HitDiceSpentSchema,
  HitDieSizeSchema,
  type InventoryItemInstance,
  InventoryItemInstanceSchema,
  ModifierSpecSchema,
  RestTypeSchema,
  SKILL_IDS,
  type SkillId,
  SkillIdSchema,
  SpellPreparationModeSchema,
  WeaponPropertySchema,
  WeaponRangeFeetSchema,
  WeaponRangeTypeSchema,
  createDefaultCharacterRuntimeState,
  createDefaultCurrency,
  createDefaultExpendedSpellSlots,
  createDefaultSpellcastingSelection,
  createUniformAbilities,
} from '@srd5/data';

// ============================================================================
// 1. Re-exported Character Build State Schemas & Default Factories (`@srd5/data`)
// ============================================================================

export {
  ABILITY_GENERATION_METHODS,
  type AbilityGenerationMethod,
  AbilityGenerationMethodSchema,
  type ActiveConditionInstance,
  ActiveConditionInstanceSchema,
  type ActiveEffectInstance,
  ActiveEffectInstanceSchema,
  type AsiBonusesMap,
  AsiBonusesMapSchema,
  type AsiBonusValue,
  AsiBonusValueSchema,
  type AsiOrFeatSelection,
  AsiOrFeatSelectionSchema,
  type AsiSelection,
  AsiSelectionSchema,
  type BaseAbilities,
  BaseAbilitiesSchema,
  type CharacterBuildState,
  CharacterBuildStateSchema,
  type CharacterClassEntry,
  CharacterClassEntrySchema,
  type CharacterCurrency,
  CharacterCurrencySchema,
  type CharacterRuntimeState,
  CharacterRuntimeStateSchema,
  type CharacterSpellcastingSelection,
  CharacterSpellcastingSelectionSchema,
  type ConcentrationState,
  ConcentrationStateSchema,
  type CustomBackgroundSpec,
  CustomBackgroundSpecSchema,
  type DeathSaveCount,
  DeathSaveCountSchema,
  type DeathSavesState,
  DeathSavesStateSchema,
  type EquippedSlots,
  EquippedSlotsSchema,
  type ExhaustionLevel,
  ExhaustionLevelSchema,
  type ExpendedSpellSlots,
  ExpendedSpellSlotsSchema,
  type FeatSelection,
  FeatSelectionSchema,
  type HitDiceSpent,
  HitDiceSpentSchema,
  type InventoryItemInstance,
  InventoryItemInstanceSchema,
  createDefaultCharacterRuntimeState,
  createDefaultCurrency,
  createDefaultExpendedSpellSlots,
  createDefaultSpellcastingSelection,
  createUniformAbilities,
};

// ============================================================================
// 2. Derived Character Sheet Schemas (`DerivedCharacterSheet`)
// ============================================================================

/**
 * Single modifier contribution entry for transparent UI formula breakdown tooltips.
 */
export const ModifierContributionSchema = z.object({
  sourceId: z.string().min(1),
  sourceName: z.string().min(1),
  value: z.number(),
});
export type ModifierContribution = z.infer<typeof ModifierContributionSchema>;

/**
 * An active passive `ModifierSpec` annotated with its origin source.
 */
export const SourcedModifierSchema = z.object({
  sourceId: z.string().min(1),
  sourceName: z.string().min(1),
  sourceCategory: z.enum([
    'race',
    'subrace',
    'class_feature',
    'subclass_feature',
    'feat',
    'background',
    'equipment',
    'magic_item',
    'active_effect',
    'condition',
  ]),
  modifier: ModifierSpecSchema,
});
export type SourcedModifier = z.infer<typeof SourcedModifierSchema>;

/**
 * Roll mode state after evaluating Advantage and Disadvantage sources.
 */
export const RollModeSchema = z.enum(['normal', 'advantage', 'disadvantage']);

/**
 * Stage 2: Computed ability score and modifier with full breakdown.
 */
export const DerivedAbilityScoreSchema = z.object({
  ability: AbilityIdSchema,
  base: z.number().int(),
  racialBonus: z.number().int(),
  asiBonus: z.number().int(),
  featBonus: z.number().int(),
  itemMinimum: z.number().int().optional(),
  maxCap: z.number().int().positive(),
  score: z.number().int().min(1).max(30),
  modifier: z.number().int(),
  breakdown: z.array(ModifierContributionSchema),
});
export type DerivedAbilityScore = z.infer<typeof DerivedAbilityScoreSchema>;

export const DerivedAbilitiesMapSchema = z
  .object({
    str: DerivedAbilityScoreSchema,
    dex: DerivedAbilityScoreSchema,
    con: DerivedAbilityScoreSchema,
    int: DerivedAbilityScoreSchema,
    wis: DerivedAbilityScoreSchema,
    cha: DerivedAbilityScoreSchema,
  })
  .strict();
export type DerivedAbilitiesMap = z.infer<typeof DerivedAbilitiesMapSchema>;

/**
 * Consolidated proficiencies across armor, weapons, tools, saves, skills, expertise, and languages.
 */
export const DerivedProficienciesSchema = z.object({
  armor: z.array(z.string().min(1)),
  weapons: z.array(z.string().min(1)),
  tools: z.array(z.string().min(1)),
  savingThrows: z.array(AbilityIdSchema),
  skills: z.array(SkillIdSchema),
  expertise: z.array(z.string().min(1)),
  languages: z.array(z.string().min(1)),
});
export type DerivedProficiencies = z.infer<typeof DerivedProficienciesSchema>;

/**
 * Stage 4: Computed saving throw bonus and roll mode for a single ability.
 */
export const DerivedSavingThrowSchema = z.object({
  ability: AbilityIdSchema,
  proficient: z.boolean(),
  abilityModifier: z.number().int(),
  proficiencyBonus: z.number().int().nonnegative(),
  flatBonus: z.number().int(),
  totalBonus: z.number().int(),
  rollMode: RollModeSchema,
  breakdown: z.array(ModifierContributionSchema),
});
export type DerivedSavingThrow = z.infer<typeof DerivedSavingThrowSchema>;

export const DerivedSavingThrowsMapSchema = z
  .object({
    str: DerivedSavingThrowSchema,
    dex: DerivedSavingThrowSchema,
    con: DerivedSavingThrowSchema,
    int: DerivedSavingThrowSchema,
    wis: DerivedSavingThrowSchema,
    cha: DerivedSavingThrowSchema,
  })
  .strict();
export type DerivedSavingThrowsMap = z.infer<typeof DerivedSavingThrowsMapSchema>;

/**
 * Skill proficiency tier (`none`, `half` for Jack of All Trades, `proficient`, `expertise`).
 */
export const SKILL_PROFICIENCY_LEVELS = [
  'none',
  'half',
  'proficient',
  'expertise',
] as const;
export const SkillProficiencyLevelSchema = z.enum(SKILL_PROFICIENCY_LEVELS);
export type SkillProficiencyLevel = z.infer<typeof SkillProficiencyLevelSchema>;

/**
 * Stage 4: Computed skill bonus, passive score, and roll mode for a single skill.
 */
export const DerivedSkillSchema = z.object({
  skill: SkillIdSchema,
  ability: AbilityIdSchema,
  proficiencyLevel: SkillProficiencyLevelSchema,
  abilityModifier: z.number().int(),
  proficiencyBonus: z.number().int().nonnegative(),
  flatBonus: z.number().int(),
  totalBonus: z.number().int(),
  passiveScore: z.number().int(),
  rollMode: RollModeSchema,
  breakdown: z.array(ModifierContributionSchema),
});
export type DerivedSkill = z.infer<typeof DerivedSkillSchema>;

export type DerivedSkillsMap = Record<SkillId, DerivedSkill>;

const derivedSkillsShape = Object.fromEntries(
  SKILL_IDS.map((skillId) => [skillId, DerivedSkillSchema]),
) as { [K in SkillId]: typeof DerivedSkillSchema };

export const DerivedSkillsMapSchema: z.ZodType<DerivedSkillsMap> = z
  .object(derivedSkillsShape)
  .strict();

/**
 * Stage 5: Hit Die pool entry for a specific die size (`d6`, `d8`, `d10`, `d12`).
 */
export const HitDiePoolEntrySchema = z.object({
  dieSize: HitDieSizeSchema,
  total: z.number().int().nonnegative(),
  spent: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
});
export type HitDiePoolEntry = z.infer<typeof HitDiePoolEntrySchema>;

/**
 * Stage 6: Candidate base Armor Class calculation evaluated during competing formula resolution.
 */
export const AcFormulaCandidateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  formula: z.string().min(1),
  baseAc: z.number().int(),
  allowsShield: z.boolean(),
  valid: z.boolean(),
  invalidReason: z.string().min(1).optional(),
});
export type AcFormulaCandidate = z.infer<typeof AcFormulaCandidateSchema>;

/**
 * Stage 6: Resolved Armor Class with competing base formula selection and additive bonuses.
 */
export const DerivedArmorClassSchema = z.object({
  totalAc: z.number().int(),
  selectedFormulaId: z.string().min(1),
  selectedFormulaName: z.string().min(1),
  baseAc: z.number().int(),
  shieldBonus: z.number().int().nonnegative(),
  additiveBonuses: z.array(ModifierContributionSchema),
  minimumAcOverride: z.number().int().positive().optional(),
  stealthDisadvantage: z.boolean(),
  candidateFormulas: z.array(AcFormulaCandidateSchema).min(1),
  formulaTooltip: z.string().min(1),
});
export type DerivedArmorClass = z.infer<typeof DerivedArmorClassSchema>;

/**
 * Stage 7: Computed sensory ranges (in feet).
 */
export const DerivedSensesSchema = z.object({
  darkvisionFeet: z.number().int().nonnegative(),
  blindsightFeet: z.number().int().nonnegative().optional(),
  tremorsenseFeet: z.number().int().nonnegative().optional(),
  truesightFeet: z.number().int().nonnegative().optional(),
});
export type DerivedSenses = z.infer<typeof DerivedSensesSchema>;

/**
 * Stage 7: Computed initiative modifier and roll mode.
 */
export const DerivedInitiativeSchema = z.object({
  bonus: z.number().int(),
  rollMode: RollModeSchema,
  breakdown: z.array(ModifierContributionSchema),
});
export type DerivedInitiative = z.infer<typeof DerivedInitiativeSchema>;

/**
 * Stage 8: Equipped weapon slot classification.
 */
export const WEAPON_SLOT_TYPES = [
  'main_hand',
  'off_hand',
  'ranged',
  'unarmed',
] as const;
export const WeaponSlotTypeSchema = z.enum(WEAPON_SLOT_TYPES);
export type WeaponSlotType = z.infer<typeof WeaponSlotTypeSchema>;

/**
 * Stage 8: Computed weapon or unarmed attack profile.
 */
export const DerivedWeaponAttackProfileSchema = z.object({
  id: z.string().min(1),
  weaponId: z.string().min(1),
  name: z.string().min(1),
  slot: WeaponSlotTypeSchema,
  rangeType: WeaponRangeTypeSchema,
  abilityUsed: AbilityIdSchema,
  proficient: z.boolean(),
  toHitBonus: z.number().int(),
  toHitBreakdown: z.array(ModifierContributionSchema),
  damageDice: z.string().min(1),
  versatileDamageDice: z.string().min(1).optional(),
  damageBonus: z.number().int(),
  damageBreakdown: z.array(ModifierContributionSchema),
  damageFormula: z.string().min(1),
  versatileDamageFormula: z.string().min(1).optional(),
  damageType: DamageTypeSchema,
  properties: z.array(WeaponPropertySchema),
  reachFeet: z.number().int().positive(),
  rangeFeet: WeaponRangeFeetSchema.optional(),
  critRange: z.number().int().min(1).max(20),
  isMagical: z.boolean(),
  actionCost: z.enum(['action', 'bonus_action']),
});
export type DerivedWeaponAttackProfile = z.infer<typeof DerivedWeaponAttackProfileSchema>;

/**
 * Stage 9: Per-class spellcasting DC, attack bonus, and preparation limits.
 */
export const DerivedClassSpellcastingSchema = z.object({
  classId: z.string().min(1),
  ability: AbilityIdSchema,
  abilityModifier: z.number().int(),
  spellSaveDc: z.number().int(),
  spellAttackBonus: z.number().int(),
  preparationMode: SpellPreparationModeSchema,
  maxPreparedSpells: z.number().int().positive().optional(),
  cantripsKnownCount: z.number().int().nonnegative(),
  spellsKnownCount: z.number().int().nonnegative().optional(),
  ritualCasting: z.boolean(),
  alwaysPreparedSpellIds: z.array(z.string().min(1)),
});
export type DerivedClassSpellcasting = z.infer<typeof DerivedClassSpellcastingSchema>;

/**
 * Stage 9: Spell slot pool for a single spell slot level (`1..9`).
 */
export const DerivedSpellSlotPoolSchema = z.object({
  max: z.number().int().nonnegative(),
  expended: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
});
export type DerivedSpellSlotPool = z.infer<typeof DerivedSpellSlotPoolSchema>;

export type DerivedSpellSlotsMap = Record<
  1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
  DerivedSpellSlotPool
>;

export const DerivedSpellSlotsMapSchema: z.ZodType<DerivedSpellSlotsMap> = z
  .object({
    1: DerivedSpellSlotPoolSchema,
    2: DerivedSpellSlotPoolSchema,
    3: DerivedSpellSlotPoolSchema,
    4: DerivedSpellSlotPoolSchema,
    5: DerivedSpellSlotPoolSchema,
    6: DerivedSpellSlotPoolSchema,
    7: DerivedSpellSlotPoolSchema,
    8: DerivedSpellSlotPoolSchema,
    9: DerivedSpellSlotPoolSchema,
  })
  .strict();

/**
 * Stage 9: Warlock Pact Magic slot pool (tracked separately from standard/multiclass spell slots).
 */
export const DerivedPactMagicSchema = z.object({
  slotLevel: z.number().int().min(1).max(9),
  maxSlots: z.number().int().nonnegative(),
  expendedSlots: z.number().int().nonnegative(),
  availableSlots: z.number().int().nonnegative(),
});
export type DerivedPactMagic = z.infer<typeof DerivedPactMagicSchema>;

/**
 * Stage 9: Complete derived spellcasting summary across all classes and racial innate spells.
 */
export const DerivedSpellcastingSummarySchema = z.object({
  isSpellcaster: z.boolean(),
  effectiveCasterLevel: z.number().int().min(0).max(20),
  classes: z.array(DerivedClassSpellcastingSchema),
  primaryAbility: AbilityIdSchema.optional(),
  primarySpellSaveDc: z.number().int().optional(),
  primarySpellAttackBonus: z.number().int().optional(),
  spellSlots: DerivedSpellSlotsMapSchema,
  pactMagic: DerivedPactMagicSchema.optional(),
  cantripIds: z.array(z.string().min(1)),
  preparedOrKnownSpellIds: z.array(z.string().min(1)),
  alwaysPreparedSpellIds: z.array(z.string().min(1)),
  spellbookSpellIds: z.array(z.string().min(1)),
});
export type DerivedSpellcastingSummary = z.infer<typeof DerivedSpellcastingSummarySchema>;

/**
 * Stage 10: Tracked class/racial/feat resource pool (e.g., Rage, Ki, Second Wind, Channel Divinity, Lay on Hands).
 */
export const DerivedResourcePoolSchema = z.object({
  resourceId: z.string().min(1),
  name: z.string().min(1),
  max: z.number().int().nonnegative(),
  spent: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
  recovery: RestTypeSchema,
  sourceId: z.string().min(1).optional(),
});
export type DerivedResourcePool = z.infer<typeof DerivedResourcePoolSchema>;

/**
 * Summary of a character's class & subclass levels on the derived sheet.
 */
export const DerivedClassSummarySchema = z.object({
  classId: z.string().min(1),
  className: z.string().min(1),
  subclassId: z.string().min(1).optional(),
  subclassName: z.string().min(1).optional(),
  level: z.number().int().min(1).max(20),
  hitDie: HitDieSizeSchema,
});
export type DerivedClassSummary = z.infer<typeof DerivedClassSummarySchema>;

/**
 * Complete deterministic projection computed by `computeDerivedCharacter(buildState, compendium)`.
 */
export const DerivedCharacterSheetSchema = z.object({
  // Identity & Stage 1: Total Level & Proficiency Bonus
  id: z.string().min(1),
  name: z.string().min(1),
  playerId: z.string().min(1).optional(),
  portraitId: z.string().min(1),
  tokenSpriteId: z.string().min(1),
  raceId: z.string().min(1),
  raceName: z.string().min(1),
  subraceId: z.string().min(1).optional(),
  subraceName: z.string().min(1).optional(),
  backgroundId: z.string().min(1),
  backgroundName: z.string().min(1),
  alignment: AlignmentSchema,
  size: CreatureSizeSchema,
  classes: z.array(DerivedClassSummarySchema).min(1),
  totalLevel: z.number().int().min(1).max(20),
  xp: z.number().int().nonnegative(),
  proficiencyBonus: z.number().int().min(2).max(6),

  // Stage 2: Final Ability Scores & Modifiers
  abilities: DerivedAbilitiesMapSchema,

  // Stage 3: Active Modifiers, Proficiencies, Mitigations & Unlocked Features
  activeModifiers: z.array(SourcedModifierSchema),
  proficiencies: DerivedProficienciesSchema,
  damageResistances: z.array(DamageTypeSchema),
  damageImmunities: z.array(DamageTypeSchema),
  damageVulnerabilities: z.array(DamageTypeSchema),
  conditionImmunities: z.array(ConditionIdSchema),
  traitIds: z.array(z.string().min(1)),
  featureIds: z.array(z.string().min(1)),
  featIds: z.array(z.string().min(1)),

  // Stage 4: Saving Throws, Skills & Passive Scores
  savingThrows: DerivedSavingThrowsMapSchema,
  skills: DerivedSkillsMapSchema,
  passivePerception: z.number().int(),
  passiveInvestigation: z.number().int(),
  passiveInsight: z.number().int(),

  // Stage 5: Maximum Hit Points & Hit Dice Pool
  maxHp: z.number().int().positive(),
  currentHp: z.number().int().nonnegative(),
  tempHp: z.number().int().nonnegative(),
  hpBreakdown: z.array(ModifierContributionSchema),
  hitDicePools: z.array(HitDiePoolEntrySchema).min(1),
  deathSaves: DeathSavesStateSchema,
  exhaustionLevel: ExhaustionLevelSchema,

  // Stage 6: Armor Class (AC) Resolution
  armorClass: DerivedArmorClassSchema,

  // Stage 7: Speed, Senses & Initiative
  speedFeet: z.number().int().nonnegative(),
  senses: DerivedSensesSchema,
  initiative: DerivedInitiativeSchema,

  // Stage 8: Weapon Attack Profiles
  weaponAttacks: z.array(DerivedWeaponAttackProfileSchema).min(1),

  // Stage 9: Spellcasting DC, Attack & Slots
  spellcasting: DerivedSpellcastingSummarySchema,

  // Stage 10: Action Economy & Resource Pools
  attacksPerAction: z.number().int().min(1).max(4),
  resources: z.record(z.string().min(1), DerivedResourcePoolSchema),
  activatedAbilities: z.array(ActivatedAbilitySpecSchema),

  // Live tactical state references
  activeConditions: z.array(ActiveConditionInstanceSchema),
  activeEffects: z.array(ActiveEffectInstanceSchema),
  concentratingOn: ConcentrationStateSchema.optional(),
});
export type DerivedCharacterSheet = z.infer<typeof DerivedCharacterSheetSchema>;
