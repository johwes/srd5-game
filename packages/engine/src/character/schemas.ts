import { z } from 'zod';
import {
  ABILITY_IDS,
  type AbilityId,
  AbilityIdSchema,
  ActivatedAbilitySpecSchema,
  AlignmentSchema,
  ConditionIdSchema,
  CreatureSizeSchema,
  DamageTypeSchema,
  HIT_DIE_SIZES,
  HitDieSizeSchema,
  ModifierSpecSchema,
  RestTypeSchema,
  SKILL_IDS,
  type SkillId,
  SkillIdSchema,
  SpellPreparationModeSchema,
  WeaponPropertySchema,
  WeaponRangeFeetSchema,
  WeaponRangeTypeSchema,
} from '@srd5/data';

// ============================================================================
// 1. Character Build State Schemas (`CharacterBuildState`)
// ============================================================================

/**
 * Supported ability score generation methods in the Character Builder.
 */
export const ABILITY_GENERATION_METHODS = [
  'standard_array',
  'point_buy',
  'rolled',
  'manual',
] as const;
export const AbilityGenerationMethodSchema = z.enum(ABILITY_GENERATION_METHODS);
export type AbilityGenerationMethod = z.infer<typeof AbilityGenerationMethodSchema>;

/**
 * Complete map of all six core ability scores (`str`, `dex`, `con`, `int`, `wis`, `cha`).
 */
export const BaseAbilitiesSchema = z
  .object({
    str: z.number().int().min(1).max(30),
    dex: z.number().int().min(1).max(30),
    con: z.number().int().min(1).max(30),
    int: z.number().int().min(1).max(30),
    wis: z.number().int().min(1).max(30),
    cha: z.number().int().min(1).max(30),
  })
  .strict();
export type BaseAbilities = z.infer<typeof BaseAbilitiesSchema>;

/**
 * Allowed increment values for an Ability Score Improvement (+1 or +2).
 */
export const AsiBonusValueSchema = z.union([z.literal(1), z.literal(2)]);
export type AsiBonusValue = z.infer<typeof AsiBonusValueSchema>;

/**
 * Partial map of ability score increases chosen at an ASI level.
 * Must total +2 across either 1 ability (+2) or 2 distinct abilities (+1 each).
 */
export const AsiBonusesMapSchema = z
  .object({
    str: AsiBonusValueSchema.optional(),
    dex: AsiBonusValueSchema.optional(),
    con: AsiBonusValueSchema.optional(),
    int: AsiBonusValueSchema.optional(),
    wis: AsiBonusValueSchema.optional(),
    cha: AsiBonusValueSchema.optional(),
  })
  .strict()
  .refine(
    (bonuses) => {
      const values = Object.values(bonuses).filter((v): v is 1 | 2 => v !== undefined);
      const total = values.reduce((sum, v) => sum + v, 0);
      return total === 2;
    },
    {
      message: 'ASI bonuses must total exactly +2 (+2 to one ability or +1 to two abilities)',
    },
  );
export type AsiBonusesMap = z.infer<typeof AsiBonusesMapSchema>;

/**
 * Ability Score Improvement (ASI) selection at an eligible class level.
 */
export const AsiSelectionSchema = z.object({
  type: z.literal('asi'),
  bonuses: AsiBonusesMapSchema,
});
export type AsiSelection = z.infer<typeof AsiSelectionSchema>;

/**
 * Feat selection (replacing an ASI) at an eligible class level.
 */
export const FeatSelectionSchema = z.object({
  type: z.literal('feat'),
  featId: z.string().min(1),
  choices: z.record(z.string().min(1), z.array(z.string().min(1))).optional(),
});
export type FeatSelection = z.infer<typeof FeatSelectionSchema>;

/**
 * Discriminated union of ASI or Feat chosen at a class ASI level.
 */
export const AsiOrFeatSelectionSchema = z.discriminatedUnion('type', [
  AsiSelectionSchema,
  FeatSelectionSchema,
]);
export type AsiOrFeatSelection = z.infer<typeof AsiOrFeatSelectionSchema>;

/**
 * Schema for class level key (`1..20`) in level-indexed records.
 */
const ClassLevelKeySchema = z.coerce.number().int().min(1).max(20);

/**
 * Per-class progression entry supporting single-class (L1–20) and multiclassing.
 */
export const CharacterClassEntrySchema = z
  .object({
    classId: z.string().min(1),
    subclassId: z.string().min(1).optional(),
    level: z.number().int().min(1).max(20),
    hpRollsByLevel: z.array(z.number().int().positive()).min(1).max(20),
    choiceSelectionsByLevel: z.record(
      ClassLevelKeySchema,
      z.record(z.string().min(1), z.array(z.string().min(1))),
    ),
    asiOrFeatByLevel: z.record(ClassLevelKeySchema, AsiOrFeatSelectionSchema),
  })
  .refine((entry) => entry.hpRollsByLevel.length === entry.level, {
    message: 'hpRollsByLevel length must match class level',
    path: ['hpRollsByLevel'],
  })
  .refine(
    (entry) =>
      Object.keys(entry.choiceSelectionsByLevel).every((lvl) => Number(lvl) <= entry.level),
    {
      message: 'choiceSelectionsByLevel cannot contain entries above the current class level',
      path: ['choiceSelectionsByLevel'],
    },
  )
  .refine(
    (entry) => Object.keys(entry.asiOrFeatByLevel).every((lvl) => Number(lvl) <= entry.level),
    {
      message: 'asiOrFeatByLevel cannot contain entries above the current class level',
      path: ['asiOrFeatByLevel'],
    },
  );
export type CharacterClassEntry = z.infer<typeof CharacterClassEntrySchema>;

/**
 * Character coin purse across the 5 SRD currency denominations.
 */
export const CharacterCurrencySchema = z.object({
  cp: z.number().int().nonnegative(),
  sp: z.number().int().nonnegative(),
  ep: z.number().int().nonnegative(),
  gp: z.number().int().nonnegative(),
  pp: z.number().int().nonnegative(),
});
export type CharacterCurrency = z.infer<typeof CharacterCurrencySchema>;

/**
 * Individual item stack or equipment instance in a character's inventory.
 */
export const InventoryItemInstanceSchema = z.object({
  instanceId: z.string().min(1),
  itemId: z.string().min(1),
  quantity: z.number().int().positive(),
  isMagicItem: z.boolean().optional(),
  chargesRemaining: z.number().int().nonnegative().optional(),
  identified: z.boolean().optional(),
  customName: z.string().min(1).optional(),
});
export type InventoryItemInstance = z.infer<typeof InventoryItemInstanceSchema>;

/**
 * Currently equipped gear slots referencing `InventoryItemInstance.instanceId`.
 */
export const EquippedSlotsSchema = z.object({
  armorInstanceId: z.string().min(1).optional(),
  shieldInstanceId: z.string().min(1).optional(),
  mainHandInstanceId: z.string().min(1).optional(),
  offHandInstanceId: z.string().min(1).optional(),
  rangedInstanceId: z.string().min(1).optional(),
});
export type EquippedSlots = z.infer<typeof EquippedSlotsSchema>;

/**
 * Player spell selections for cantrips, known spells, wizard spellbook, and prepared spells.
 */
export const CharacterSpellcastingSelectionSchema = z.object({
  knownCantripIds: z.array(z.string().min(1)),
  knownSpellIds: z.array(z.string().min(1)),
  spellbookSpellIds: z.array(z.string().min(1)),
  preparedSpellIds: z.array(z.string().min(1)),
});
export type CharacterSpellcastingSelection = z.infer<
  typeof CharacterSpellcastingSelectionSchema
>;

/**
 * Active condition instance on a character during exploration or tactical combat.
 */
export const ActiveConditionInstanceSchema = z.object({
  conditionId: ConditionIdSchema,
  sourceId: z.string().min(1).optional(),
  sourceName: z.string().min(1).optional(),
  sourceEntityId: z.string().min(1).optional(),
  durationRounds: z.number().int().positive().optional(),
  requiresConcentration: z.boolean().optional(),
  repeatSaveAtTurnEnd: z
    .object({
      ability: AbilityIdSchema,
      dc: z.number().int().positive(),
    })
    .optional(),
});
export type ActiveConditionInstance = z.infer<typeof ActiveConditionInstanceSchema>;

/**
 * Active buff/debuff effect instance carrying declarative `ModifierSpec`s (e.g., Mage Armor, Bless, Shield).
 */
export const ActiveEffectInstanceSchema = z.object({
  effectId: z.string().min(1),
  name: z.string().min(1),
  sourceId: z.string().min(1).optional(),
  sourceEntityId: z.string().min(1).optional(),
  remainingRounds: z.number().int().nonnegative().optional(),
  requiresConcentration: z.boolean(),
  modifiers: z.array(ModifierSpecSchema),
});
export type ActiveEffectInstance = z.infer<typeof ActiveEffectInstanceSchema>;

/**
 * Active concentration state tracked on a spellcaster.
 */
export const ConcentrationStateSchema = z.object({
  sourceId: z.string().min(1),
  targetEntityIds: z.array(z.string().min(1)),
  remainingRounds: z.number().int().nonnegative(),
});
export type ConcentrationState = z.infer<typeof ConcentrationStateSchema>;

/**
 * Death saving throw tally (`0..3` successes and `0..3` failures).
 */
export const DeathSaveCountSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
export type DeathSaveCount = z.infer<typeof DeathSaveCountSchema>;

export const DeathSavesStateSchema = z.object({
  successes: DeathSaveCountSchema,
  failures: DeathSaveCountSchema,
  stable: z.boolean().optional(),
});
export type DeathSavesState = z.infer<typeof DeathSavesStateSchema>;

/**
 * SRD 5.1 Exhaustion level (`0..6`).
 */
export const ExhaustionLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);
export type ExhaustionLevel = z.infer<typeof ExhaustionLevelSchema>;

/**
 * Expended spell slots by spell level (`1..9`).
 */
export type ExpendedSpellSlots = Record<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9, number>;

export const ExpendedSpellSlotsSchema: z.ZodType<ExpendedSpellSlots> = z
  .object({
    1: z.number().int().nonnegative(),
    2: z.number().int().nonnegative(),
    3: z.number().int().nonnegative(),
    4: z.number().int().nonnegative(),
    5: z.number().int().nonnegative(),
    6: z.number().int().nonnegative(),
    7: z.number().int().nonnegative(),
    8: z.number().int().nonnegative(),
    9: z.number().int().nonnegative(),
  })
  .strict();

/**
 * Hit dice spent keyed by Hit Die size (`6 | 8 | 10 | 12`).
 */
const HitDieRecordKeySchema = z.coerce
  .number()
  .int()
  .refine((n): n is 6 | 8 | 10 | 12 => (HIT_DIE_SIZES as readonly number[]).includes(n), {
    message: 'Hit die size key must be 6, 8, 10, or 12',
  });

export const HitDiceSpentSchema = z.record(
  HitDieRecordKeySchema,
  z.number().int().nonnegative(),
);
export type HitDiceSpent = z.infer<typeof HitDiceSpentSchema>;

/**
 * Live runtime state mutated during dungeon exploration, rests, and tactical combat.
 */
export const CharacterRuntimeStateSchema = z.object({
  xp: z.number().int().nonnegative(),
  currentHp: z.number().int().nonnegative(),
  tempHp: z.number().int().nonnegative(),
  hitDiceSpent: HitDiceSpentSchema,
  deathSaves: DeathSavesStateSchema,
  exhaustionLevel: ExhaustionLevelSchema,
  expendedSpellSlots: ExpendedSpellSlotsSchema,
  expendedPactSlots: z.number().int().nonnegative(),
  resourceChargesSpent: z.record(z.string().min(1), z.number().int().nonnegative()),
  activeConditions: z.array(ActiveConditionInstanceSchema),
  activeEffects: z.array(ActiveEffectInstanceSchema),
  concentratingOn: ConcentrationStateSchema.optional(),
});
export type CharacterRuntimeState = z.infer<typeof CharacterRuntimeStateSchema>;

/**
 * Optional Custom SRD Background definition (2 skills + 2 tools/languages).
 */
export const CustomBackgroundSpecSchema = z.object({
  name: z.string().min(1),
  skillProficiencies: z.tuple([SkillIdSchema, SkillIdSchema]),
  toolProficiencies: z.array(z.string().min(1)).max(2),
  languages: z.array(z.string().min(1)).max(2),
});
export type CustomBackgroundSpec = z.infer<typeof CustomBackgroundSpecSchema>;

/**
 * Persisted source-of-truth schema for a Player Character (`CharacterBuildState`).
 */
export const CharacterBuildStateSchema = z
  .object({
    id: z.string().min(1),
    version: z.literal(1),
    name: z.string().trim().min(1),
    playerId: z.string().min(1).optional(),
    portraitId: z.string().min(1),
    tokenSpriteId: z.string().min(1),
    alignment: AlignmentSchema,

    // 1. Origin (Race & Subrace)
    raceId: z.string().min(1),
    subraceId: z.string().min(1).optional(),
    racialChoices: z.record(z.string().min(1), z.array(z.string().min(1))),

    // 2. Background
    backgroundId: z.string().min(1),
    backgroundChoices: z.record(z.string().min(1), z.array(z.string().min(1))),
    customBackground: CustomBackgroundSpecSchema.optional(),

    // 3. Base Ability Scores (before racial bonuses & ASIs)
    abilityMethod: AbilityGenerationMethodSchema,
    baseAbilities: BaseAbilitiesSchema,
    abilityRollSeed: z.number().int().nonnegative().optional(),

    // 4. Class & Level Progression (L1-20 single-class or multiclass)
    classes: z.array(CharacterClassEntrySchema).min(1),

    // 5. Inventory, Equipment & Currency
    currency: CharacterCurrencySchema,
    inventory: z.array(InventoryItemInstanceSchema),
    equippedSlots: EquippedSlotsSchema,
    attunedItemInstanceIds: z.array(z.string().min(1)).max(3),

    // 6. Spellcasting Selection
    spellcasting: CharacterSpellcastingSelectionSchema,

    // 7. Live Runtime State
    runtime: CharacterRuntimeStateSchema,
  })
  .refine(
    (state) => {
      const totalLevel = state.classes.reduce((sum, c) => sum + c.level, 0);
      return totalLevel >= 1 && totalLevel <= 20;
    },
    {
      message: 'Total character level across all classes must be between 1 and 20',
      path: ['classes'],
    },
  )
  .refine(
    (state) => {
      const classIds = state.classes.map((c) => c.classId);
      return new Set(classIds).size === classIds.length;
    },
    {
      message: 'Duplicate classId entries are not allowed in classes array',
      path: ['classes'],
    },
  )
  .refine(
    (state) => {
      const instanceIds = state.inventory.map((item) => item.instanceId);
      return new Set(instanceIds).size === instanceIds.length;
    },
    {
      message: 'Inventory item instanceIds must be unique',
      path: ['inventory'],
    },
  )
  .refine(
    (state) =>
      new Set(state.attunedItemInstanceIds).size === state.attunedItemInstanceIds.length,
    {
      message: 'attunedItemInstanceIds cannot contain duplicate instance IDs',
      path: ['attunedItemInstanceIds'],
    },
  );
export type CharacterBuildState = z.infer<typeof CharacterBuildStateSchema>;

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

// ============================================================================
// 3. Deterministic Default State Factories
// ============================================================================

/**
 * Creates a zeroed-out `ExpendedSpellSlots` record for spell levels 1 through 9.
 */
export function createDefaultExpendedSpellSlots(): ExpendedSpellSlots {
  return {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
    6: 0,
    7: 0,
    8: 0,
    9: 0,
  };
}

/**
 * Creates a zeroed-out `CharacterCurrency` coin purse with optional overrides.
 */
export function createDefaultCurrency(
  overrides?: Partial<CharacterCurrency>,
): CharacterCurrency {
  return {
    cp: 0,
    sp: 0,
    ep: 0,
    gp: 0,
    pp: 0,
    ...overrides,
  };
}

/**
 * Creates an empty `CharacterSpellcastingSelection` object with optional overrides.
 */
export function createDefaultSpellcastingSelection(
  overrides?: Partial<CharacterSpellcastingSelection>,
): CharacterSpellcastingSelection {
  return {
    knownCantripIds: [],
    knownSpellIds: [],
    spellbookSpellIds: [],
    preparedSpellIds: [],
    ...overrides,
  };
}

/**
 * Creates a fresh `CharacterRuntimeState` with sensible defaults.
 */
export function createDefaultCharacterRuntimeState(
  overrides?: Partial<CharacterRuntimeState>,
): CharacterRuntimeState {
  return {
    xp: 0,
    currentHp: 1,
    tempHp: 0,
    hitDiceSpent: {},
    deathSaves: { successes: 0, failures: 0 },
    exhaustionLevel: 0,
    expendedSpellSlots: createDefaultExpendedSpellSlots(),
    expendedPactSlots: 0,
    resourceChargesSpent: {},
    activeConditions: [],
    activeEffects: [],
    ...overrides,
  };
}

/**
 * Creates a map of all 6 ability scores initialized to a uniform default (e.g. 10 or 8).
 */
export function createUniformAbilities(defaultScore = 10): Record<AbilityId, number> {
  return Object.fromEntries(
    ABILITY_IDS.map((abilityId) => [abilityId, defaultScore]),
  ) as Record<AbilityId, number>;
}
