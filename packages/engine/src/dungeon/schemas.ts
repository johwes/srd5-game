import { z } from 'zod';
export {
  BIOME_TIERS,
  BiomeTierSchema,
  type BiomeTier,
  LootBundleSpecSchema,
  type LootBundleSpec,
  DungeonCellSpecSchema,
  type DungeonCellSpec,
  InteractivePropSpecSchema,
  type InteractivePropSpec,
  EncounterSpawnMonsterSchema,
  type EncounterSpawnMonster,
  EncounterSpawnGroupSchema,
  type EncounterSpawnGroup,
  DungeonRoomSpecSchema,
  type DungeonRoomSpec,
  DungeonFloorSpecSchema,
  type DungeonFloorSpec,
  CampaignModuleSpecSchema,
  type CampaignModuleSpec,
} from '@srd5/data';

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
