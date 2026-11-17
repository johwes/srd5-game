import { z } from 'zod';

/**
 * The six core SRD 5.1 Ability Score identifiers.
 */
export const ABILITY_IDS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export const AbilityIdSchema = z.enum(ABILITY_IDS);
export type AbilityId = z.infer<typeof AbilityIdSchema>;

/**
 * The eighteen canonical SRD 5.1 Skill identifiers (lowercase kebab-case).
 */
export const SKILL_IDS = [
  'acrobatics',
  'animal-handling',
  'arcana',
  'athletics',
  'deception',
  'history',
  'insight',
  'intimidation',
  'investigation',
  'medicine',
  'nature',
  'perception',
  'performance',
  'persuasion',
  'religion',
  'sleight-of-hand',
  'stealth',
  'survival',
] as const;
export const SkillIdSchema = z.enum(SKILL_IDS);
export type SkillId = z.infer<typeof SkillIdSchema>;

/**
 * Default governing ability score for each SRD 5.1 skill.
 */
export const SKILL_DEFAULT_ABILITY: Readonly<Record<SkillId, AbilityId>> = {
  acrobatics: 'dex',
  'animal-handling': 'wis',
  arcana: 'int',
  athletics: 'str',
  deception: 'cha',
  history: 'int',
  insight: 'wis',
  intimidation: 'cha',
  investigation: 'int',
  medicine: 'wis',
  nature: 'int',
  perception: 'wis',
  performance: 'cha',
  persuasion: 'cha',
  religion: 'int',
  'sleight-of-hand': 'dex',
  stealth: 'dex',
  survival: 'wis',
};

/**
 * The thirteen SRD 5.1 Damage Types.
 */
export const DAMAGE_TYPES = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
] as const;
export const DamageTypeSchema = z.enum(DAMAGE_TYPES);
export type DamageType = z.infer<typeof DamageTypeSchema>;

/**
 * The fifteen SRD 5.1 Conditions (including exhaustion).
 */
export const CONDITION_IDS = [
  'blinded',
  'charmed',
  'deafened',
  'exhaustion',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
] as const;
export const ConditionIdSchema = z.enum(CONDITION_IDS);
export type ConditionId = z.infer<typeof ConditionIdSchema>;

/**
 * SRD 5.1 Creature Size categories.
 */
export const CREATURE_SIZES = [
  'tiny',
  'small',
  'medium',
  'large',
  'huge',
  'gargantuan',
] as const;
export const CreatureSizeSchema = z.enum(CREATURE_SIZES);
export type CreatureSize = z.infer<typeof CreatureSizeSchema>;

/**
 * SRD 5.1 Creature Types.
 */
export const CREATURE_TYPES = [
  'aberration',
  'beast',
  'celestial',
  'construct',
  'dragon',
  'elemental',
  'fey',
  'fiend',
  'giant',
  'humanoid',
  'monstrosity',
  'ooze',
  'plant',
  'undead',
] as const;
export const CreatureTypeSchema = z.enum(CREATURE_TYPES);
export type CreatureType = z.infer<typeof CreatureTypeSchema>;

/**
 * The eight SRD 5.1 Schools of Magic.
 */
export const MAGIC_SCHOOLS = [
  'abjuration',
  'conjuration',
  'divination',
  'enchantment',
  'evocation',
  'illusion',
  'necromancy',
  'transmutation',
] as const;
export const MagicSchoolSchema = z.enum(MAGIC_SCHOOLS);
export type MagicSchool = z.infer<typeof MagicSchoolSchema>;

/**
 * Resource recovery and duration reset boundaries.
 */
export const REST_TYPES = [
  'turn',
  'round',
  'short_rest',
  'long_rest',
  'dawn',
] as const;
export const RestTypeSchema = z.enum(REST_TYPES);
export type RestType = z.infer<typeof RestTypeSchema>;

/**
 * Tactical action economy costs.
 */
export const ACTION_COSTS = [
  'action',
  'bonus_action',
  'reaction',
  'movement',
  'free',
  'special',
] as const;
export const ActionCostSchema = z.enum(ACTION_COSTS);
export type ActionCost = z.infer<typeof ActionCostSchema>;

/**
 * Area of Effect geometric template shapes.
 */
export const AOE_SHAPE_TYPES = [
  'sphere',
  'cube',
  'cone',
  'line',
  'cylinder',
] as const;
export const AoeShapeTypeSchema = z.enum(AOE_SHAPE_TYPES);
export type AoeShapeType = z.infer<typeof AoeShapeTypeSchema>;

/**
 * Standard nine-point alignment grid values.
 */
export const ALIGNMENTS = [
  'lawful_good',
  'neutral_good',
  'chaotic_good',
  'lawful_neutral',
  'true_neutral',
  'chaotic_neutral',
  'lawful_evil',
  'neutral_evil',
  'chaotic_evil',
] as const;
export const AlignmentSchema = z.enum(ALIGNMENTS);
export type Alignment = z.infer<typeof AlignmentSchema>;

/**
 * Canonical SRD 5.1 Race IDs.
 */
export const SRD_RACE_IDS = [
  'dwarf',
  'elf',
  'halfling',
  'human',
  'dragonborn',
  'gnome',
  'half-elf',
  'half-orc',
  'tiefling',
] as const;
export const SrdRaceIdSchema = z.enum(SRD_RACE_IDS);
export type SrdRaceId = z.infer<typeof SrdRaceIdSchema>;

/**
 * Canonical SRD 5.1 Subrace IDs.
 */
export const SRD_SUBRACE_IDS = [
  'hill-dwarf',
  'high-elf',
  'lightfoot-halfling',
  'rock-gnome',
] as const;
export const SrdSubraceIdSchema = z.enum(SRD_SUBRACE_IDS);
export type SrdSubraceId = z.infer<typeof SrdSubraceIdSchema>;

/**
 * Canonical SRD 5.1 Class IDs.
 */
export const SRD_CLASS_IDS = [
  'barbarian',
  'bard',
  'cleric',
  'druid',
  'fighter',
  'monk',
  'paladin',
  'ranger',
  'rogue',
  'sorcerer',
  'warlock',
  'wizard',
] as const;
export const SrdClassIdSchema = z.enum(SRD_CLASS_IDS);
export type SrdClassId = z.infer<typeof SrdClassIdSchema>;

/**
 * Canonical SRD 5.1 Subclass IDs (one per class in SRD 5.1).
 */
export const SRD_SUBCLASS_IDS = [
  'berserker',
  'lore',
  'life',
  'land',
  'champion',
  'open-hand',
  'devotion',
  'hunter',
  'thief',
  'draconic',
  'fiend',
  'evocation',
] as const;
export const SrdSubclassIdSchema = z.enum(SRD_SUBCLASS_IDS);
export type SrdSubclassId = z.infer<typeof SrdSubclassIdSchema>;

/**
 * Allowed variable references in FormulaString expressions.
 */
export const FORMULA_VARIABLES = [
  '@strMod',
  '@dexMod',
  '@conMod',
  '@intMod',
  '@wisMod',
  '@chaMod',
  '@prof',
  '@charLevel',
  '@classLevel',
  '@slotLevel',
  '@spellMod',
  '@spellSaveDC',
  '@casterMaxHp',
] as const;
export type FormulaVariable = (typeof FORMULA_VARIABLES)[number];

/**
 * Allowed function names in FormulaString expressions.
 */
export const FORMULA_FUNCTIONS = ['max', 'min', 'floor', 'ceil'] as const;
export type FormulaFunction = (typeof FORMULA_FUNCTIONS)[number];

/**
 * Restricted arithmetic/dice formula string evaluated by `@srd5/engine`.
 */
export const FormulaStringSchema = z.string().trim().min(1);
export type FormulaString = z.infer<typeof FormulaStringSchema>;
