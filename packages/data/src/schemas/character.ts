import { z } from 'zod';
import { HIT_DIE_SIZES } from './classes.js';
import { ModifierSpecSchema } from './effects.js';
import {
  ABILITY_IDS,
  type AbilityId,
  AbilityIdSchema,
  AlignmentSchema,
  ConditionIdSchema,
  SkillIdSchema,
} from './enums.js';
import { FeatSchema, type FeatData } from './feats.js';

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
 * Gold-only coin purse. The game economy tracks whole gold pieces exclusively
 * (BG3-style): legacy copper/silver/electrum/platinum are converted on load
 * and at loot-generation time via `coinsToGoldPieces`.
 */
export const CharacterCurrencySchema = z.object({
  gp: z.number().int().nonnegative(),
});
export type CharacterCurrency = z.infer<typeof CharacterCurrencySchema>;

/**
 * Legacy 5-denomination SRD purse, accepted on load for pre-gold saves and
 * immediately migrated with `migrateCharacterCurrencyToGold`.
 */
export const LegacyCharacterCurrencySchema = z.object({
  cp: z.number().int().nonnegative().optional(),
  sp: z.number().int().nonnegative().optional(),
  ep: z.number().int().nonnegative().optional(),
  gp: z.number().int().nonnegative().optional(),
  pp: z.number().int().nonnegative().optional(),
});
export type LegacyCharacterCurrency = z.infer<typeof LegacyCharacterCurrencySchema>;

/** Standard SRD 5.1 coin rates, in copper pieces: 10cp=1sp, 5sp=1ep, 1gp=100cp, 1pp=5gp. */
const COPPER_PER_GP = 100;

/**
 * Converts a mixed coin purse to whole gold pieces (rounded to nearest, so
 * stray silver still reads as pocket change instead of vanishing).
 */
export function coinsToGoldPieces(coins: LegacyCharacterCurrency): number {
  const copper =
    (coins.cp ?? 0) +
    (coins.sp ?? 0) * 10 +
    (coins.ep ?? 0) * 50 +
    (coins.gp ?? 0) * COPPER_PER_GP +
    (coins.pp ?? 0) * 500;
  return Math.max(0, Math.round(copper / COPPER_PER_GP));
}

/**
 * Migrates any purse (gold-only or legacy 5-denomination) to the gold-only
 * shape. New saves persist `{ gp }`; old saves convert once on load.
 */
export function migrateCharacterCurrencyToGold(
  purse: LegacyCharacterCurrency,
): CharacterCurrency {
  if (
    purse.cp === undefined &&
    purse.sp === undefined &&
    purse.ep === undefined &&
    purse.pp === undefined
  ) {
    return { gp: Math.max(0, purse.gp ?? 0) };
  }
  return { gp: coinsToGoldPieces(purse) };
}

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
  description: z.string().optional(),
  skillProficiencies: z.tuple([SkillIdSchema, SkillIdSchema]),
  toolProficiencies: z.array(z.string().min(1)).max(2),
  languages: z.array(z.string().min(1)).max(2),
  feature: z
    .object({
      name: z.string().min(1),
      description: z.string().min(1),
    })
    .optional(),
  source: z.literal('homebrew').optional(),
  humanReviewed: z.boolean().optional(),
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

    // 3. Custom / Homebrew Feats authored or carried by this character
    customFeats: z.array(FeatSchema).optional(),

    // 4. Base Ability Scores (before racial bonuses & ASIs)
    abilityMethod: AbilityGenerationMethodSchema,
    baseAbilities: BaseAbilitiesSchema,
    abilityRollSeed: z.number().int().nonnegative().optional(),

    // 5. Class & Level Progression (L1-20 single-class or multiclass)
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
// 2. Deterministic Default State Factories
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
 * In-place migration of legacy multi-denomination purses and loot tables to
 * the gold-only economy. Walks any parsed-JSON structure and rewrites:
 * - `currency` objects carrying cp/sp/ep/pp → `{ gp }` (rates via
 *   `coinsToGoldPieces`);
 * - `lootTable` objects carrying cp/sp/ep/pp → gp-only (items, origin and
 *   sourceName preserved).
 * Gold-only shapes pass through untouched. No randomness involved.
 */
export function migrateGoldEconomyInPlace(raw: unknown): void {
  const seen = new Set<object>();
  const toNumber = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
  const hasLegacyCoins = (obj: Record<string, unknown>): boolean =>
    toNumber(obj['cp']) > 0 ||
    toNumber(obj['sp']) > 0 ||
    toNumber(obj['ep']) > 0 ||
    toNumber(obj['pp']) > 0;

  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry);
      return;
    }
    const record = node as Record<string, unknown>;

    const purse = record['currency'];
    if (purse && typeof purse === 'object' && !Array.isArray(purse)) {
      const purseRecord = purse as Record<string, unknown>;
      if (hasLegacyCoins(purseRecord)) {
        record['currency'] = {
          gp: coinsToGoldPieces({
            cp: toNumber(purseRecord['cp']),
            sp: toNumber(purseRecord['sp']),
            ep: toNumber(purseRecord['ep']),
            gp: toNumber(purseRecord['gp']),
            pp: toNumber(purseRecord['pp']),
          }),
        };
      }
    }

    const table = record['lootTable'];
    if (table && typeof table === 'object' && !Array.isArray(table)) {
      const tableRecord = table as Record<string, unknown>;
      if (hasLegacyCoins(tableRecord)) {
        const gp = coinsToGoldPieces({
          cp: toNumber(tableRecord['cp']),
          sp: toNumber(tableRecord['sp']),
          ep: toNumber(tableRecord['ep']),
          gp: toNumber(tableRecord['gp']),
          pp: toNumber(tableRecord['pp']),
        });
        const next: Record<string, unknown> = {};
        if (gp > 0) next['gp'] = gp;
        if (Array.isArray(tableRecord['items'])) next['items'] = tableRecord['items'];
        if (typeof tableRecord['origin'] === 'string') next['origin'] = tableRecord['origin'];
        if (typeof tableRecord['sourceName'] === 'string') {
          next['sourceName'] = tableRecord['sourceName'];
        }
        record['lootTable'] = next;
      }
    }

    for (const value of Object.values(record)) visit(value);
  };

  visit(raw);
}

/**
 * Creates a zeroed-out gold-only coin purse with optional overrides.
 */
export function createDefaultCurrency(
  overrides?: Partial<CharacterCurrency>,
): CharacterCurrency {
  return {
    gp: 0,
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
