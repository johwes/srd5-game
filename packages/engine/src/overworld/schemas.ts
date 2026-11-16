import { z } from 'zod';

/**
 * The Realm — strategic overworld map model (Spec 06 Section 4.1).
 *
 * The macro map uses an orthogonal tile grid: `q` is the column (x) and `r`
 * the row (y), both 0-indexed from the top-left (north-west) corner. Spec 06
 * permits either hex axial or orthogonal coordinates; the orthogonal variant
 * keeps travel, road routing, and rendering deterministic and simple.
 */

/**
 * Overworld biome / terrain types (Spec 06 Section 4.1).
 */
export const OVERWORLD_TERRAIN_TYPES = [
  'plains',
  'forest',
  'hills',
  'mountains',
  'swamp',
  'desert',
  'tundra',
  'coast',
  'ocean',
] as const;
export const OverworldTerrainTypeSchema = z.enum(OVERWORLD_TERRAIN_TYPES);
export type OverworldTerrainType = z.infer<typeof OverworldTerrainTypeSchema>;

/**
 * Canonical macro movement costs per terrain (Spec 06 Section 4.1:
 * Plains 1, Forest 1.5, Hills 2, Swamp 2, Mountains 3). Ocean is impassable
 * for overland travel; its cost is a large finite sentinel so maps remain
 * JSON-serializable. Travel logic (SRD-802) must block ocean tiles outright.
 */
export const OVERWORLD_MOVEMENT_COSTS: Record<OverworldTerrainType, number> = {
  plains: 1,
  forest: 1.5,
  hills: 2,
  mountains: 3,
  swamp: 2,
  desert: 1.5,
  tundra: 2,
  coast: 1,
  ocean: 99,
};

/**
 * Returns the macro movement cost for an overworld terrain type.
 */
export function getOverworldMovementCost(terrain: OverworldTerrainType): number {
  return OVERWORLD_MOVEMENT_COSTS[terrain];
}

/**
 * Orthogonal overworld coordinate (`q` = column, `r` = row).
 */
export const OverworldCoordSchema = z.object({
  q: z.number().int(),
  r: z.number().int(),
});
export type OverworldCoord = z.infer<typeof OverworldCoordSchema>;

/**
 * River edge indices follow the orthogonal direction convention:
 * 0 = North, 1 = East, 2 = South, 3 = West. The opposite edge is `(e + 2) % 4`.
 */
export const OVERWORLD_EDGE_DIRECTIONS: readonly OverworldCoord[] = [
  { q: 0, r: -1 },
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 0 },
];

/**
 * A single macro tile on the overworld map (Spec 06 Section 4.1).
 */
export const OverworldTileSchema = z.object({
  q: z.number().int().min(0),
  r: z.number().int().min(0),
  terrain: OverworldTerrainTypeSchema,
  movementCost: z.number().positive(),
  elevation: z.number().min(0).max(1),
  riverEdges: z.array(z.number().int().min(0).max(3)).optional(),
  roadThrough: z.boolean().optional(),
  poiId: z.string().min(1).optional(),
  factionControlId: z.string().min(1).optional(),
});
export type OverworldTile = z.infer<typeof OverworldTileSchema>;

/**
 * Points of interest: settlements, dungeon entrances, shrines, and lairs.
 * Settlement kinds are authored by the faction/settlement engine (SRD-803);
 * wilderness kinds are placed by the world generator (SRD-801).
 */
export const OVERWORLD_POI_KINDS = [
  'capital',
  'town',
  'village',
  'dungeon_entrance',
  'ancient_shrine',
  'monster_lair',
] as const;
export const OverworldPOIKindSchema = z.enum(OVERWORLD_POI_KINDS);
export type OverworldPOIKind = z.infer<typeof OverworldPOIKindSchema>;

export const OVERWORLD_POI_SERVICES = [
  'inn',
  'blacksmith',
  'magic_shop',
  'temple',
  'quest_board',
] as const;
export const OverworldPOIServiceSchema = z.enum(OVERWORLD_POI_SERVICES);
export type OverworldPOIService = z.infer<typeof OverworldPOIServiceSchema>;

export const OverworldPOISchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: OverworldPOIKindSchema,
  q: z.number().int().min(0),
  r: z.number().int().min(0),
  factionId: z.string().min(1).optional(),
  /** Seeds the bounded Deep Descent delve launched on entry (Spec 06 Section 4.3). */
  dungeonSeed: z.number().int().optional(),
  /** Depth tier for the generated delve (Spec 06 Section 4.3). */
  depthTier: z.number().int().min(1).optional(),
  services: z.array(OverworldPOIServiceSchema).optional(),
});
export type OverworldPOI = z.infer<typeof OverworldPOISchema>;

/**
 * Macro-faction data (Spec 06 Section 4.1). Reputation mechanics and
 * settlement assignment are implemented by SRD-803; the generator emits
 * an empty faction registry.
 */
export const FactionAlignmentSchema = z.enum(['good', 'neutral', 'evil']);
export type FactionAlignment = z.infer<typeof FactionAlignmentSchema>;

export const FactionDataSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  bannerColor: z.string().min(1),
  alignment: FactionAlignmentSchema,
  relationshipWithParty: z.number().int().min(-100).max(100),
  capitalPoiId: z.string().min(1),
  townPoiIds: z.array(z.string().min(1)),
});
export type FactionData = z.infer<typeof FactionDataSchema>;

/**
 * Static procedural world map (`OverworldMapSpec`, Spec 06 Section 4.1).
 * Runtime travel state (day counter, party position, travel points, quests)
 * is layered on top by the Overworld Party Travel loop (SRD-802).
 */
export const OverworldMapSchema = z.object({
  worldSeed: z.number().int(),
  worldName: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tiles: z.record(z.string(), OverworldTileSchema),
  pois: z.record(z.string(), OverworldPOISchema),
  factions: z.record(z.string(), FactionDataSchema),
});
export type OverworldMap = z.infer<typeof OverworldMapSchema>;

/**
 * Canonical tile key for the `tiles` record: `"q,r"`.
 */
export function overworldTileKey(q: number, r: number): string {
  return `${q},${r}`;
}

/**
 * Looks up a tile by coordinate, returning undefined outside map bounds.
 */
export function getOverworldTile(
  map: OverworldMap,
  q: number,
  r: number,
): OverworldTile | undefined {
  if (q < 0 || q >= map.width || r < 0 || r >= map.height) return undefined;
  return map.tiles[overworldTileKey(q, r)];
}

/**
 * World generation configuration for `generateOverworldMap()` (SRD-801).
 */
export const OverworldGenerationConfigSchema = z.object({
  seed: z.number().int(),
  width: z.number().int().min(24).max(256).default(64),
  height: z.number().int().min(24).max(256).default(64),
  worldName: z.string().min(1).optional(),
  /** Elevation below this threshold is ocean (0.0 sea floor .. 1.0 peaks). */
  seaLevel: z.number().min(0.1).max(0.6).default(0.35),
  riverCount: z.number().int().min(0).max(24).optional(),
  settlementSiteCount: z.number().int().min(2).max(12).default(5),
  dungeonEntranceCount: z.number().int().min(0).max(24).default(3),
  ancientShrineCount: z.number().int().min(0).max(24).default(2),
  monsterLairCount: z.number().int().min(0).max(24).default(3),
  /** Global climate offsets: positive = hotter / wetter. */
  temperatureBias: z.number().min(-1).max(1).default(0),
  moistureBias: z.number().min(-1).max(1).default(0),
  roadsEnabled: z.boolean().default(true),
});
export type OverworldGenerationConfigInput = z.input<typeof OverworldGenerationConfigSchema>;
export type OverworldGenerationConfig = z.output<typeof OverworldGenerationConfigSchema>;
