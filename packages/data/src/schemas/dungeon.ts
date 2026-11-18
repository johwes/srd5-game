import { z } from 'zod';
import { AbilityIdSchema, DamageTypeSchema } from './enums.js';
import { EffectStepSpecSchema } from './effects.js';

/**
 * 2D Cartesian grid coordinate (0-indexed).
 */
export const GridPointSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
});
export type GridPoint = z.infer<typeof GridPointSchema>;

/**
 * Procedural dungeon biomes by depth tier (Spec 06 Section 3.1).
 */
export const BIOME_TIERS = [
  'catacombs',
  'sunken_tombs',
  'magma_caverns',
  'deep_vaults',
  'abyssal_rift',
] as const;
export const BiomeTierSchema = z.enum(BIOME_TIERS);
export type BiomeTier = z.infer<typeof BiomeTierSchema>;

/**
 * Tactical lighting levels.
 */
export const LIGHT_LEVELS = ['bright', 'dim', 'darkness'] as const;
export const LightLevelSchema = z.enum(LIGHT_LEVELS);
export type LightLevel = z.infer<typeof LightLevelSchema>;

/**
 * Dungeon and tactical map terrain tile types.
 */
export const TILE_TERRAIN_TYPES = [
  'void',
  'floor_stone',
  'floor_wood',
  'floor_sand',
  'floor_basalt',
  'wall_solid',
  'chasm',
  'water_shallow',
  'water_deep',
  'rubble',
  'lava',
] as const;
export const TileTerrainTypeSchema = z.enum(TILE_TERRAIN_TYPES);
export type TileTerrainType = z.infer<typeof TileTerrainTypeSchema>;

/**
 * Interactive prop kinds and states.
 */
export const PROP_KINDS = [
  'door',
  'secret_door',
  'chest',
  'trap',
  'lever',
  'shrine',
  'stairs_down',
  'stairs_up',
  'furniture',
] as const;
export const PropKindSchema = z.enum(PROP_KINDS);
export type PropKind = z.infer<typeof PropKindSchema>;

export const PROP_STATES = [
  'closed',
  'open',
  'locked',
  'destroyed',
  'disarmed',
  'triggered',
] as const;
export const PropStateSchema = z.enum(PROP_STATES);
export type PropState = z.infer<typeof PropStateSchema>;

/**
 * Loot bundle specification for chests and drop containers (Spec 04 Section 2 & SRD-505).
 */
export const LootBundleSpecSchema = z.object({
  cp: z.number().int().nonnegative().optional(),
  sp: z.number().int().nonnegative().optional(),
  ep: z.number().int().nonnegative().optional(),
  gp: z.number().int().nonnegative().optional(),
  pp: z.number().int().nonnegative().optional(),
  items: z.array(z.string()).optional(),
});
export type LootBundleSpec = z.infer<typeof LootBundleSpecSchema>;

/**
 * A single dungeon cell specification on the floor grid (Spec 04 Section 2).
 */
export const DungeonCellSpecSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  roomId: z.string().optional(),
  terrain: TileTerrainTypeSchema,
  baseLight: LightLevelSchema.default('bright'),
  elevationFeet: z.number().int().default(0).optional(),
});
export type DungeonCellSpec = z.infer<typeof DungeonCellSpecSchema>;

/**
 * Placeable furniture types for dungeon dressing (Spec 04 §3.2 / SRD-512).
 * Wardrobes, curtains and alcoves double as hiding spots.
 */
export const FURNITURE_TYPES = [
  'desk',
  'throne',
  'bookshelf',
  'wardrobe',
  'altar',
  'table',
  'crate',
  'bed',
  'curtains',
  'alcove',
] as const;
export const FurnitureTypeSchema = z.enum(FURNITURE_TYPES);
export type FurnitureType = z.infer<typeof FurnitureTypeSchema>;

/**
 * Interactive prop specification (doors, chests, traps, etc.) (Spec 04 Section 2).
 */
export const InteractivePropSpecSchema = z.object({
  id: z.string().min(1),
  x: z.number().int(),
  y: z.number().int(),
  kind: PropKindSchema,
  state: PropStateSchema.default('closed'),
  blocksMovement: z.boolean().default(false),
  blocksSight: z.boolean().default(false),
  lockDc: z.number().int().positive().optional(),
  detectionDc: z.number().int().positive().optional(),
  disarmDc: z.number().int().positive().optional(),
  listenDc: z.number().int().positive().optional(),
  furnitureType: FurnitureTypeSchema.optional(),
  hideSpot: z.boolean().optional(),
  trapDamageFormula: z.string().optional(),
  trapDamageType: DamageTypeSchema.optional(),
  trapSaveDc: z.number().int().positive().optional(),
  trapSaveAbility: AbilityIdSchema.optional(),
  trapHalfDamageOnSave: z.boolean().optional(),
  lootTable: LootBundleSpecSchema.optional(),
  discovered: z.boolean().optional(),
  ac: z.number().int().positive().optional(),
  hp: z.number().int().positive().optional(),
  targetFloorId: z.string().optional(),
  targetSpawnPoint: GridPointSchema.optional(),
  shrineType: z.string().optional(),
});
export type InteractivePropSpec = z.infer<typeof InteractivePropSpecSchema>;

/**
 * Monster spawn specification in an encounter group.
 */
export const EncounterSpawnMonsterSchema = z.object({
  monsterId: z.string().min(1),
  spawnX: z.number().int(),
  spawnY: z.number().int(),
  patrolWaypoints: z.array(GridPointSchema).optional(),
});
export type EncounterSpawnMonster = z.infer<typeof EncounterSpawnMonsterSchema>;

/**
 * Encounter spawn group (Spec 04 Section 2).
 */
export const EncounterSpawnGroupSchema = z.object({
  id: z.string().min(1),
  roomId: z.string().min(1),
  triggered: z.boolean().default(false),
  monsters: z.array(EncounterSpawnMonsterSchema),
  surpriseCondition: z
    .object({
      monstersStealthedDc: z.number().int().positive().optional(),
    })
    .optional(),
});
export type EncounterSpawnGroup = z.infer<typeof EncounterSpawnGroupSchema>;

/**
 * Logical room specification partitioning a floor (Spec 04 Section 2 & 6).
 */
export const DungeonRoomSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  isSafeRoom: z.boolean().default(false).optional(),
  lighting: LightLevelSchema.optional(),
  bounds: z
    .object({
      x: z.number().int(),
      y: z.number().int(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
});
export type DungeonRoomSpec = z.infer<typeof DungeonRoomSpecSchema>;

/**
 * Complete Dungeon Floor Specification (Spec 04 Section 2).
 */
export const DungeonFloorSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  partySpawnCells: z.array(GridPointSchema).min(1),
  cells: z.array(DungeonCellSpecSchema),
  props: z.array(InteractivePropSpecSchema).default([]),
  encounters: z.array(EncounterSpawnGroupSchema).default([]),
  rooms: z.array(DungeonRoomSpecSchema).optional(),
});
export type DungeonFloorSpec = z.infer<typeof DungeonFloorSpecSchema>;

/**
 * Level range specification for campaigns and adventures.
 */
export const LevelRangeSchema = z.object({
  min: z.number().int().min(1).max(20),
  max: z.number().int().min(1).max(20),
});
export type LevelRange = z.infer<typeof LevelRangeSchema>;

/**
 * Campaign Module Specification (Spec 04 Section 6).
 */
export const CampaignModuleSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  author: z.string().optional(),
  version: z.string().optional(),
  levelRange: LevelRangeSchema,
  startingFloorId: z.string().min(1),
  floors: z.array(DungeonFloorSpecSchema).min(1),
});
export type CampaignModuleSpec = z.infer<typeof CampaignModuleSpecSchema>;
