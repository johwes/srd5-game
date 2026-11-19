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
  // SRD-1101 — strategic war POIs (Spec 10 Section 3).
  'fortress',
  'mine',
  'bridge',
  'supply_depot',
  'prison_keep',
  'subfaction_camp',
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

/**
 * Dynamic war status of a strategic POI (SRD-1101, Spec 10 Section 3).
 *
 * - `intact`: generates War Power each tick.
 * - `sabotaged`: generates nothing until repaired (mission hook, SRD-1103).
 * - `destroyed`: generates nothing; bridges rebuild on `recoveryDay`.
 * - `cursed`: necromantic curse; generates nothing, holds undead (cleanse hook).
 * - `contested`: rival claim in progress; generates nothing (capture hook).
 * - `under_attack`: timed incoming assault; defend before `attackDeadlineDay`.
 */
export const STRATEGIC_POI_STATUSES = [
  'intact',
  'sabotaged',
  'destroyed',
  'cursed',
  'contested',
  'under_attack',
] as const;
export const StrategicPOIStatusSchema = z.enum(STRATEGIC_POI_STATUSES);
export type StrategicPOIStatus = z.infer<typeof StrategicPOIStatusSchema>;

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
  // --- SRD-1101 strategic war metadata (all optional; absent on non-war POIs) ---
  /** Dynamic war status; only meaningful on strategic POI kinds. */
  strategicStatus: StrategicPOIStatusSchema.optional(),
  /** War day the status last changed. */
  statusChangedDay: z.number().int().min(1).optional(),
  /** War day a destroyed bridge finishes rebuilding (owner restores logistics). */
  recoveryDay: z.number().int().min(1).optional(),
  /** Countdown day for an incoming `under_attack` defense (protect_poi hook). */
  attackDeadlineDay: z.number().int().min(1).optional(),
  /** War Power generated per war tick while `intact`. */
  powerValue: z.number().int().min(0).max(10).optional(),
  /** War nation currently holding this POI (defaults to `factionId`). */
  ownerNationId: z.string().min(1).optional(),
  /** Rival nation contesting / besieging this POI (for `contested` / `under_attack`). */
  contestedByNationId: z.string().min(1).optional(),
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

// ---------------------------------------------------------------------------
// Overworld Party Travel loop (SRD-802, Spec 06 Section 4.1 / 4.3)
// ---------------------------------------------------------------------------

/**
 * Overland travel pace (5e DMG: Fast 30 mi/day, Normal 24 mi/day, Slow 18 mi/day).
 * Movement points are an abstract daily budget where a Normal day grants 6
 * points (~24 miles across open plains). Fast/Slow grant 8/4 points so the
 * canonical mileages stay integer-friendly and free of floating-point drift.
 */
export const TRAVEL_PACES = ['slow', 'normal', 'fast'] as const;
export const TravelPaceSchema = z.enum(TRAVEL_PACES);
export type TravelPace = z.infer<typeof TravelPaceSchema>;

export interface TravelPaceProfile {
  /** Abstract movement points refreshed each dawn. */
  movementPointsPerDay: number;
  /** Canonical 5e overland miles covered in one day of this pace. */
  milesPerDay: number;
  /** Modifier to Survival (Forage) checks. */
  foragingModifier: number;
  /** Modifier to passive Perception / noticing hazards while travelling. */
  detectionModifier: number;
}

export const TRAVEL_PACE_PROFILES: Record<TravelPace, TravelPaceProfile> = {
  slow: { movementPointsPerDay: 4, milesPerDay: 18, foragingModifier: 2, detectionModifier: 2 },
  normal: { movementPointsPerDay: 6, milesPerDay: 24, foragingModifier: 0, detectionModifier: 0 },
  fast: { movementPointsPerDay: 8, milesPerDay: 30, foragingModifier: -2, detectionModifier: -5 },
};

/** Day phases cycled by the travel loop. */
export const TIME_OF_DAY_PHASES = ['dawn', 'noon', 'dusk', 'night'] as const;
export const TimeOfDaySchema = z.enum(TIME_OF_DAY_PHASES);
export type TimeOfDay = z.infer<typeof TimeOfDaySchema>;

/** Deterministic daily weather states (Spec 06 Section 4). */
export const OVERWORLD_WEATHER_TYPES = [
  'clear',
  'cloudy',
  'rain',
  'storm',
  'snow',
  'fog',
  'heatwave',
] as const;
export const WeatherTypeSchema = z.enum(OVERWORLD_WEATHER_TYPES);
export type WeatherType = z.infer<typeof WeatherTypeSchema>;

export interface WeatherProfile {
  label: string;
  /** Multiplies movement-point cost of each step. */
  travelMultiplier: number;
  /** Modifier to Survival (Forage) checks. */
  foragingModifier: number;
  /** Modifier to Perception while travelling. */
  perceptionModifier: number;
}

export const WEATHER_PROFILES: Record<WeatherType, WeatherProfile> = {
  clear: { label: 'Clear skies', travelMultiplier: 1, foragingModifier: 0, perceptionModifier: 0 },
  cloudy: { label: 'Overcast', travelMultiplier: 1, foragingModifier: 0, perceptionModifier: 0 },
  rain: { label: 'Steady rain', travelMultiplier: 1.25, foragingModifier: -2, perceptionModifier: -2 },
  storm: { label: 'Thunderstorm', travelMultiplier: 1.5, foragingModifier: -4, perceptionModifier: -5 },
  snow: { label: 'Snowfall', travelMultiplier: 1.5, foragingModifier: -3, perceptionModifier: -3 },
  fog: { label: 'Thick fog', travelMultiplier: 1.1, foragingModifier: -2, perceptionModifier: -5 },
  heatwave: { label: 'Sweltering heat', travelMultiplier: 1.25, foragingModifier: -3, perceptionModifier: 0 },
};

/**
 * Runtime state for the Overworld Party Travel loop. The static world map is
 * held separately (and passed to travel functions), matching the split in
 * Spec 06 Section 4.1 between `OverworldMapSpec` and `OverworldState`.
 */
export const OverworldTravelStateSchema = z.object({
  worldSeed: z.number().int(),
  worldName: z.string().min(1),
  /** 1-indexed day counter; dawn of day 1 is the default start. */
  currentDay: z.number().int().min(1),
  timeOfDay: TimeOfDaySchema,
  weather: WeatherTypeSchema,
  partyPosition: OverworldCoordSchema,
  travelPace: TravelPaceSchema,
  travelPointsRemaining: z.number().min(0),
  forcedMarchDay: z.number().int().positive().optional(),
  earlyCampDay: z.number().int().positive().optional(),
  rations: z.number().int().min(0),
  gold: z.number().int().min(0),
  milesTraveled: z.number().min(0),
  foragedRations: z.number().int().min(0),
  /** Persisted so day rollover knows whether to reroll the weather. */
  weatherEnabled: z.boolean(),
  rngState: z.number().int(),
});
export type OverworldTravelState = z.infer<typeof OverworldTravelStateSchema>;

export const OverworldTravelConfigSchema = z.object({
  /** Defaults to the world map seed when omitted. */
  seed: z.number().int().optional(),
  /** Defaults to the world's first settlement site (or first land tile). */
  start: OverworldCoordSchema.optional(),
  pace: TravelPaceSchema.default('normal'),
  startingRations: z.number().int().min(0).default(10),
  startingGold: z.number().int().min(0).default(0),
  initialWeather: WeatherTypeSchema.optional(),
  /** When false the weather stays fixed at `initialWeather` (or 'clear'). */
  weatherEnabled: z.boolean().default(true),
});
export type OverworldTravelConfigInput = z.input<typeof OverworldTravelConfigSchema>;
export type OverworldTravelConfig = z.output<typeof OverworldTravelConfigSchema>;
