import { z } from 'zod';
import {
  AbilityIdSchema,
  DamageTypeSchema,
  EffectStepSpecSchema,
} from '@srd5/data';
import {
  GridPointSchema,
  LightLevelSchema,
  TileTerrainTypeSchema,
} from '../grid/model.js';
import {
  PropKindSchema,
  PropStateSchema,
} from '../state/types.js';

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
  trapEffect: z.array(EffectStepSpecSchema).optional(),
  trapDamageFormula: z.string().optional(),
  trapDamageType: DamageTypeSchema.optional(),
  trapSaveDc: z.number().int().positive().optional(),
  trapSaveAbility: AbilityIdSchema.optional(),
  trapHalfDamageOnSave: z.boolean().optional(),
  lootTable: LootBundleSpecSchema.optional(),
  discovered: z.boolean().optional(),
  ac: z.number().int().positive().optional(),
  hp: z.number().int().positive().optional(),
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
 * Marching formation types (Spec 04 Section 3.1).
 */
export const MARCHING_FORMATIONS = ['single_file', 'two_by_two'] as const;
export const MarchingFormationSchema = z.enum(MARCHING_FORMATIONS);
export type MarchingFormation = z.infer<typeof MarchingFormationSchema>;

/**
 * Party marching order configuration.
 */
export const MarchingOrderConfigSchema = z.object({
  order: z.array(z.string().min(1)),
  formation: MarchingFormationSchema.default('single_file'),
  leadExplorerId: z.string().min(1),
});
export type MarchingOrderConfig = z.infer<typeof MarchingOrderConfigSchema>;
