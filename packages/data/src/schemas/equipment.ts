import { z } from 'zod';
import { StartingEquipmentItemEntrySchema } from './classes.js';
import { ActivatedAbilitySpecSchema, ModifierSpecSchema } from './effects.js';
import { AbilityIdSchema, DamageTypeSchema, FormulaStringSchema, RestTypeSchema } from './enums.js';

/**
 * The eleven canonical SRD 5.1 Weapon Properties.
 */
export const WEAPON_PROPERTIES = [
  'ammunition',
  'finesse',
  'heavy',
  'light',
  'loading',
  'range',
  'reach',
  'special',
  'thrown',
  'two-handed',
  'versatile',
] as const;
export const WeaponPropertySchema = z.enum(WEAPON_PROPERTIES);
export type WeaponProperty = z.infer<typeof WeaponPropertySchema>;

/**
 * SRD 5.1 Weapon proficiency category (`simple` or `martial`).
 */
export const WEAPON_CATEGORIES = ['simple', 'martial'] as const;
export const WeaponCategorySchema = z.enum(WEAPON_CATEGORIES);
export type WeaponCategory = z.infer<typeof WeaponCategorySchema>;

/**
 * SRD 5.1 Weapon range classification (`melee` or `ranged`).
 */
export const WEAPON_RANGE_TYPES = ['melee', 'ranged'] as const;
export const WeaponRangeTypeSchema = z.enum(WEAPON_RANGE_TYPES);
export type WeaponRangeType = z.infer<typeof WeaponRangeTypeSchema>;

/**
 * Normal and long range increments (in feet) for ranged or thrown weapons.
 */
export const WeaponRangeFeetSchema = z
  .object({
    normal: z.number().int().positive(),
    long: z.number().int().positive(),
  })
  .refine((r) => r.long >= r.normal, {
    message: 'Weapon long range must be greater than or equal to normal range',
  });
export type WeaponRangeFeet = z.infer<typeof WeaponRangeFeetSchema>;

/**
 * SRD 5.1 Weapon schema (`kind: 'weapon'` in `packages/data/src/srd/equipment.json`).
 */
export const WeaponSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('weapon'),
  name: z.string().min(1),
  category: WeaponCategorySchema,
  rangeType: WeaponRangeTypeSchema,
  costCopper: z.number().int().nonnegative(),
  weightLb: z.number().nonnegative(),
  damageDice: FormulaStringSchema,
  damageType: DamageTypeSchema,
  versatileDamageDice: FormulaStringSchema.optional(),
  properties: z.array(WeaponPropertySchema),
  rangeFeet: WeaponRangeFeetSchema.optional(),
  specialDescription: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
});
export type WeaponData = z.infer<typeof WeaponSchema>;

/**
 * SRD 5.1 Armor proficiency categories (`light`, `medium`, `heavy`, `shield`).
 */
export const ARMOR_CATEGORIES = ['light', 'medium', 'heavy', 'shield'] as const;
export const ArmorCategorySchema = z.enum(ARMOR_CATEGORIES);
export type ArmorCategory = z.infer<typeof ArmorCategorySchema>;

/**
 * SRD 5.1 Armor & Shield schema (`kind: 'armor'` in `packages/data/src/srd/equipment.json`).
 */
export const ArmorSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('armor'),
  name: z.string().min(1),
  category: ArmorCategorySchema,
  costCopper: z.number().int().nonnegative(),
  weightLb: z.number().nonnegative(),
  baseAc: z.number().int().positive(),
  addDexModifier: z.boolean(),
  maxDexBonus: z.number().int().nonnegative().optional(),
  strengthRequirement: z.number().int().positive().optional(),
  stealthDisadvantage: z.boolean(),
  description: z.string().min(1).optional(),
});
export type ArmorData = z.infer<typeof ArmorSchema>;

/**
 * SRD 5.1 Adventuring Gear categories.
 */
export const GEAR_CATEGORIES = [
  'standard_gear',
  'ammunition',
  'arcane_focus',
  'druidic_focus',
  'holy_symbol',
  'kit',
  'consumable',
  'container',
  'clothing',
  'mount_or_vehicle',
  'other',
] as const;
export const GearCategorySchema = z.enum(GEAR_CATEGORIES);
export type GearCategory = z.infer<typeof GearCategorySchema>;

/**
 * SRD 5.1 Adventuring Gear schema (`kind: 'gear'` in `packages/data/src/srd/equipment.json`).
 */
export const GearSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('gear'),
  name: z.string().min(1),
  category: GearCategorySchema,
  costCopper: z.number().int().nonnegative(),
  weightLb: z.number().nonnegative(),
  quantity: z.number().int().positive().optional(),
  modifiers: z.array(ModifierSpecSchema).optional(),
  activatedAbilities: z.array(ActivatedAbilitySpecSchema).optional(),
  description: z.string().min(1).optional(),
});
export type GearData = z.infer<typeof GearSchema>;

/**
 * SRD 5.1 Tool categories (`artisans_tools`, `gaming_set`, `musical_instrument`, `thieves_tools`, `other`).
 */
export const TOOL_CATEGORIES = [
  'artisans_tools',
  'gaming_set',
  'musical_instrument',
  'thieves_tools',
  'other',
] as const;
export const ToolCategorySchema = z.enum(TOOL_CATEGORIES);
export type ToolCategory = z.infer<typeof ToolCategorySchema>;

/**
 * SRD 5.1 Tool schema (`kind: 'tool'` in `packages/data/src/srd/equipment.json`).
 */
export const ToolSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('tool'),
  name: z.string().min(1),
  category: ToolCategorySchema,
  costCopper: z.number().int().nonnegative(),
  weightLb: z.number().nonnegative(),
  defaultAbility: AbilityIdSchema.optional(),
  description: z.string().min(1).optional(),
});
export type ToolData = z.infer<typeof ToolSchema>;

/**
 * SRD 5.1 Equipment Pack schema (`kind: 'pack'`, e.g., Explorer's Pack, Dungeoneer's Pack).
 */
export const EquipmentPackSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('pack'),
  name: z.string().min(1),
  costCopper: z.number().int().nonnegative(),
  weightLb: z.number().nonnegative(),
  contents: z.array(StartingEquipmentItemEntrySchema).min(1),
  description: z.string().min(1).optional(),
});
export type EquipmentPackData = z.infer<typeof EquipmentPackSchema>;

/**
 * Unified discriminated union for all SRD 5.1 mundane equipment items (`packages/data/src/srd/equipment.json`).
 */
export const EquipmentSchema = z.discriminatedUnion('kind', [
  WeaponSchema,
  ArmorSchema,
  GearSchema,
  ToolSchema,
  EquipmentPackSchema,
]);
export type EquipmentData = z.infer<typeof EquipmentSchema>;

/**
 * SRD 5.1 Magic Item categories.
 */
export const MAGIC_ITEM_CATEGORIES = [
  'armor',
  'potion',
  'ring',
  'rod',
  'scroll',
  'staff',
  'wand',
  'weapon',
  'wondrous',
] as const;
export const MagicItemCategorySchema = z.enum(MAGIC_ITEM_CATEGORIES);
export type MagicItemCategory = z.infer<typeof MagicItemCategorySchema>;

/**
 * SRD 5.1 Magic Item rarities.
 */
export const MAGIC_ITEM_RARITIES = [
  'common',
  'uncommon',
  'rare',
  'very_rare',
  'legendary',
  'artifact',
] as const;
export const MagicItemRaritySchema = z.enum(MAGIC_ITEM_RARITIES);
export type MagicItemRarity = z.infer<typeof MagicItemRaritySchema>;

/**
 * Charge pool and recharge rules for staves, wands, and wondrous items.
 */
export const MagicItemChargesSchema = z.object({
  max: z.number().int().positive(),
  rechargeFormula: FormulaStringSchema.optional(),
  rechargeTiming: RestTypeSchema.optional(),
});
export type MagicItemCharges = z.infer<typeof MagicItemChargesSchema>;

/**
 * SRD 5.1 Magic Item schema (`packages/data/src/srd/magic-items.json`).
 */
export const MagicItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: MagicItemCategorySchema,
  rarity: MagicItemRaritySchema,
  requiresAttunement: z.boolean(),
  attunementRestriction: z.string().min(1).optional(),
  baseEquipmentId: z.string().min(1).optional(),
  charges: MagicItemChargesSchema.optional(),
  modifiers: z.array(ModifierSpecSchema),
  activatedAbilities: z.array(ActivatedAbilitySpecSchema).optional(),
  description: z.string().min(1),
});
export type MagicItemData = z.infer<typeof MagicItemSchema>;
