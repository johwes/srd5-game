import { z } from 'zod';
import {
  type MonsterData,
  type SrdCompendium,
  SRD_CR_TO_XP,
  defaultCompendium,
} from '@srd5/data';
import {
  type GridPoint,
  type LightLevel,
  type TacticalGrid,
  type TileTerrainType,
  GridPointSchema,
  TacticalGridSchema,
  createTacticalGrid,
  isCellPassable,
  setGridCells,
} from '../grid/model.js';
import { type Combatant } from '../combat/types.js';
import { createMonsterCombatant } from '../combat/combatant.js';
import { startCombatEncounter } from '../combat/state-machine.js';
import { awardLootToCharacter } from '../dungeon/loot.js';
import { transitionCombatToExploration } from '../dungeon/encounters.js';
import { normalizeSeed, nextRandomFloat, nextRandomUint32 } from '../dice/prng.js';
import { createInitialGameState } from '../state/reducer.js';
import {
  type GameEvent,
  type GameState,
  type PlayerSlotAssignment,
} from '../state/types.js';
import {
  type OverworldMap,
  type OverworldPOI,
  type OverworldTerrainType,
  type OverworldTravelState,
  OverworldTerrainTypeSchema,
  getOverworldTile,
} from './schemas.js';

/**
 * SRD-804 — Seamless Overworld-to-Tactical Grid battle generator
 * (Spec 06 Sections 4.2 & 4.3).
 *
 * Translates an overworld terrain / POI into a temporary 5-ft tactical grid,
 * spawns a terrain-themed SRD monster group, and starts a deterministic
 * initiative-driven combat. On victory, XP and gold are committed back to the
 * persistent party combatants so the Realm travel loop can continue.
 *
 * Architectural invariant: every random choice threads `rngState` through the
 * seeded Mulberry32 PRNG. `Math.random()` is never called.
 */

export class OverworldBattleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OverworldBattleError';
  }
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const OVERWORLD_BATTLE_ORIGINS = [
  'wilderness',
  'monster_lair',
  'dungeon_entrance',
] as const;
export const OverworldBattleOriginSchema = z.enum(OVERWORLD_BATTLE_ORIGINS);
export type OverworldBattleOrigin = z.infer<typeof OverworldBattleOriginSchema>;

export const OverworldBattleConfigSchema = z.object({
  seed: z.number().int(),
  terrain: OverworldTerrainTypeSchema.default('plains'),
  origin: OverworldBattleOriginSchema.default('wilderness'),
  /** Temporary tactical grid dimensions (Spec 06 Section 4.2: 24 x 24). */
  width: z.number().int().min(12).max(64).default(24),
  height: z.number().int().min(12).max(64).default(24),
  /** Danger tier for the encounter; maps to a maximum monster CR. */
  crTier: z.number().int().min(0).max(20).default(1),
  /** How many hero spawn cells to reserve on the tactical grid. */
  partySize: z.number().int().min(1).max(6).default(4),
  monsterCount: z.number().int().min(1).max(12).optional(),
  /** Optional explicit SRD monster-id pool override. */
  monsterPool: z.array(z.string().min(1)).min(1).optional(),
  bossMonsterId: z.string().min(1).optional(),
  poiId: z.string().min(1).optional(),
});
export type OverworldBattleConfigInput = z.input<typeof OverworldBattleConfigSchema>;
export type OverworldBattleConfig = z.output<typeof OverworldBattleConfigSchema>;

export const OverworldBattleMonsterSpawnSchema = z.object({
  monsterId: z.string().min(1),
  instanceId: z.string().min(1),
  position: GridPointSchema,
});
export type OverworldBattleMonsterSpawn = z.infer<typeof OverworldBattleMonsterSpawnSchema>;

export const GeneratedOverworldBattleSchema = z.object({
  battleId: z.string().min(1),
  seed: z.number().int(),
  nextRngState: z.number().int(),
  origin: OverworldBattleOriginSchema,
  terrain: OverworldTerrainTypeSchema,
  crTier: z.number().int().min(0),
  grid: TacticalGridSchema,
  partySpawnCells: z.array(GridPointSchema).min(1),
  monsters: z.array(OverworldBattleMonsterSpawnSchema).min(1),
  poiId: z.string().min(1).optional(),
});
export type GeneratedOverworldBattle = z.infer<typeof GeneratedOverworldBattleSchema>;

// ---------------------------------------------------------------------------
// Terrain-to-tactical translation templates (Spec 06 Section 4.2)
// ---------------------------------------------------------------------------

export interface OverworldTerrainBattleTemplate {
  terrain: OverworldTerrainType;
  name: string;
  /** Floor terrain used for open cells on the generated tactical grid. */
  floorTerrain: TileTerrainType;
  /** Impassable / full-cover terrain (trees, boulders, rubble heaps). */
  obstacleTerrain: TileTerrainType;
  /** Difficult-terrain or hazard cells (bushes, chasms, shallow water). */
  hazardTerrain?: TileTerrainType;
  /** Ambient illumination (swamp mist -> dim, caves -> darkness, etc.). */
  defaultLight: LightLevel;
  obstacleDensity: number;
  hazardDensity: number;
  /** Whether some cells gain a positive `elevationFeet` (hills / mountains). */
  elevationPlateaus: boolean;
  monsterPool: string[];
  bossPool: string[];
}

/**
 * Canonical SRD monster pool for each overworld terrain (Spec 06 Section 4.2).
 * Every id here is a bundled SRD 5.1 monster; ids are validated against the
 * compendium at generation time so custom/partial datasets never yield broken
 * references.
 */
export function getBattleTerrainTemplate(
  terrain: OverworldTerrainType,
): OverworldTerrainBattleTemplate {
  switch (terrain) {
    case 'forest':
      return {
        terrain,
        name: 'Forest — trees and dense undergrowth',
        floorTerrain: 'floor_wood',
        obstacleTerrain: 'wall_solid', // Tree trunks: full cover / impassable.
        hazardTerrain: 'rubble', // Bushes: difficult terrain + light cover.
        defaultLight: 'dim',
        obstacleDensity: 0.12,
        hazardDensity: 0.18,
        elevationPlateaus: false,
        monsterPool: ['goblin', 'wolf', 'bandit', 'giant-wolf-spider', 'scout', 'dire-wolf', 'giant-spider', 'hell-hound', 'veteran', 'owlbear'],
        bossPool: ['owlbear', 'bugbear', 'harpy', 'oni', 'hydra', 'vampire'],
      };
    case 'mountains':
      return {
        terrain,
        name: 'Mountains — boulders, chasms and plateaus',
        floorTerrain: 'floor_stone',
        obstacleTerrain: 'wall_solid', // Stone boulders.
        hazardTerrain: 'chasm', // Chasm drops: block walking, allow LoS.
        defaultLight: 'bright',
        obstacleDensity: 0.13,
        hazardDensity: 0.07,
        elevationPlateaus: true,
        monsterPool: ['kobold', 'orc', 'berserker', 'ogre', 'troll', 'minotaur', 'hill-giant'],
        bossPool: ['hill-giant', 'minotaur', 'manticore', 'wyvern', 'oni', 'berserker', 'fire-giant', 'frost-giant', 'young-red-dragon', 'adult-red-dragon', 'stone-golem'],
      };
    case 'swamp':
      return {
        terrain,
        name: 'Swamp — flooded mire and clinging mist',
        floorTerrain: 'floor_stone',
        obstacleTerrain: 'wall_solid',
        hazardTerrain: 'water_shallow', // Difficult terrain.
        defaultLight: 'dim', // Mist: light obscurement / dim light.
        obstacleDensity: 0.07,
        hazardDensity: 0.3,
        elevationPlateaus: false,
        monsterPool: ['giant-rat', 'giant-bat', 'zombie', 'shadow', 'ghoul', 'giant-spider', 'specter', 'mummy', 'ghost', 'troll', 'gelatinous-cube', 'cultist'],
        bossPool: ['ghoul', 'wight', 'specter', 'wraith', 'gelatinous-cube', 'hydra', 'clay-golem', 'mummy-lord'],
      };
    case 'hills':
      return {
        terrain,
        name: 'Hills — broken ground and high ground',
        floorTerrain: 'floor_stone',
        obstacleTerrain: 'wall_solid',
        hazardTerrain: 'rubble',
        defaultLight: 'bright',
        obstacleDensity: 0.1,
        hazardDensity: 0.12,
        elevationPlateaus: true,
        monsterPool: ['goblin', 'kobold', 'bandit', 'thug', 'orc', 'scout', 'veteran', 'knight', 'minotaur'],
        bossPool: ['minotaur', 'ogre', 'bugbear', 'berserker', 'gladiator', 'wyvern', 'frost-giant', 'young-red-dragon'],
      };
    case 'desert':
      return {
        terrain,
        name: 'Desert — open sands and scattered rocks',
        floorTerrain: 'floor_sand',
        obstacleTerrain: 'wall_solid',
        hazardTerrain: 'rubble',
        defaultLight: 'bright',
        obstacleDensity: 0.06,
        hazardDensity: 0.1,
        elevationPlateaus: false,
        monsterPool: ['bandit', 'thug', 'cultist', 'goblin', 'mummy', 'hell-hound', 'harpy', 'manticore'],
        bossPool: ['manticore', 'harpy', 'ogre', 'gladiator', 'oni', 'clay-golem', 'fire-giant', 'mummy-lord'],
      };
    case 'tundra':
      return {
        terrain,
        name: 'Tundra — frozen wastes and ice',
        floorTerrain: 'floor_stone',
        obstacleTerrain: 'wall_solid',
        hazardTerrain: 'rubble',
        defaultLight: 'dim',
        obstacleDensity: 0.07,
        hazardDensity: 0.14,
        elevationPlateaus: false,
        monsterPool: ['wolf', 'dire-wolf', 'goblin', 'berserker', 'ogre', 'troll', 'wight'],
        bossPool: ['ogre', 'wight', 'dire-wolf', 'berserker', 'oni', 'wraith', 'frost-giant', 'vampire', 'archmage'],
      };
    case 'coast':
      return {
        terrain,
        name: 'Coast — surf and rocky shore',
        floorTerrain: 'floor_sand',
        obstacleTerrain: 'wall_solid',
        hazardTerrain: 'water_shallow',
        defaultLight: 'bright',
        obstacleDensity: 0.08,
        hazardDensity: 0.16,
        elevationPlateaus: false,
        monsterPool: ['bandit', 'guard', 'thug', 'spy', 'skeleton', 'zombie', 'veteran', 'gladiator', 'harpy', 'ogre'],
        bossPool: ['harpy', 'ogre', 'bandit', 'noble', 'knight', 'hydra', 'stone-golem', 'archmage'],
      };
    case 'ocean':
      return {
        terrain,
        name: 'Open water — shallows and swells',
        floorTerrain: 'water_shallow',
        obstacleTerrain: 'water_deep',
        hazardTerrain: 'water_deep',
        defaultLight: 'bright',
        obstacleDensity: 0.1,
        hazardDensity: 0.2,
        elevationPlateaus: false,
        monsterPool: ['skeleton', 'zombie', 'harpy', 'gelatinous-cube'],
        bossPool: ['harpy', 'gelatinous-cube'],
      };
    case 'plains':
    default:
      return {
        terrain: 'plains',
        name: 'Plains — open grassland',
        floorTerrain: 'floor_stone',
        obstacleTerrain: 'wall_solid',
        hazardTerrain: 'rubble',
        defaultLight: 'bright',
        obstacleDensity: 0.05,
        hazardDensity: 0.08,
        elevationPlateaus: false,
        monsterPool: ['goblin', 'bandit', 'guard', 'scout', 'thug', 'wolf', 'orc', 'dire-wolf', 'warhorse-skeleton', 'veteran', 'knight'],
        bossPool: ['bugbear', 'orc', 'ogre', 'berserker', 'knight', 'gladiator', 'frost-giant', 'archmage', 'vampire'],
      };
  }
}

/** Maximum CR admitted into a wilderness/POI battle at a given danger tier. */
export function getMaxCrForBattleTier(tier: number): number {
  if (tier <= 1) return 0.5;
  if (tier === 2) return 1;
  if (tier === 3) return 2;
  if (tier === 4) return 3;
  if (tier === 5) return 5;
  if (tier === 6) return 7;
  return 20;
}

/** Combines several integer seeds deterministically into one uint32 seed. */
export function mixBattleSeed(...values: number[]): number {
  let state = normalizeSeed(values[0] ?? 0);
  for (let i = 1; i < values.length; i++) {
    const step = nextRandomUint32(state ^ normalizeSeed(values[i]!));
    state = (step.value ^ step.nextState) >>> 0;
  }
  return normalizeSeed(state);
}

// ---------------------------------------------------------------------------
// Terrain grid generation
// ---------------------------------------------------------------------------

export interface GeneratedBattleTerrain {
  grid: TacticalGrid;
  partySpawnCells: GridPoint[];
  monsterSpawnCells: GridPoint[];
  template: OverworldTerrainBattleTemplate;
}

/** Reports whether a walkable path connects `from` to `to` on a tactical grid. */
export function hasWalkablePath(grid: TacticalGrid, from: GridPoint, to: GridPoint): boolean {
  const key = (p: GridPoint): string => `${p.x},${p.y}`;
  const visited = new Set<string>([key(from)]);
  const queue: GridPoint[] = [from];
  const dirs: GridPoint[] = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.x === to.x && current.y === to.y) return true;
    for (const d of dirs) {
      const next = { x: current.x + d.x, y: current.y + d.y };
      const nextKey = key(next);
      if (visited.has(nextKey)) continue;
      const cell = grid.cells[next.y * grid.width + next.x];
      if (!cell || !isCellPassable(cell, 'walk')) continue;
      visited.add(nextKey);
      queue.push(next);
    }
  }
  return false;
}

/**
 * Builds a temporary tactical grid from an overworld terrain type (Spec 06
 * Section 4.2). A guaranteed central corridor plus open spawn zones keep every
 * party spawn cell connected to every monster spawn cell; obstacles, hazards
 * and elevation plateaus are placed deterministically everywhere else.
 */
export function generateBattleTerrainGrid(
  terrain: OverworldTerrainType,
  seed: number,
  options: { width?: number; height?: number; partySize?: number } = {},
): GeneratedBattleTerrain {
  const template = getBattleTerrainTemplate(terrain);
  const width = options.width ?? 24;
  const height = options.height ?? 24;
  const partySize = options.partySize ?? 4;
  if (width < 12 || height < 12) {
    throw new OverworldBattleError('Tactical battle grids must be at least 12x12 cells');
  }

  let rngState = normalizeSeed(seed);
  function nextFloat(): number {
    const result = nextRandomFloat(rngState);
    rngState = result.nextState;
    return result.value;
  }

  let grid = createTacticalGrid(width, height, template.floorTerrain, template.defaultLight);
  const centerY = Math.floor(height / 2);

  // Reserve a central horizontal corridor (always open) plus left/right spawn
  // zones so the generated encounter can never be split by obstacles.
  const reserved = new Set<string>();
  for (let x = 0; x < width; x++) {
    for (let y = centerY - 1; y <= centerY + 1; y++) {
      reserved.add(`${x},${y}`);
    }
  }
  const partySpawnCells: GridPoint[] = [];
  const partyOffsets: GridPoint[] = [
    { x: 2, y: 0 },
    { x: 2, y: -1 },
    { x: 2, y: 1 },
    { x: 3, y: -1 },
    { x: 3, y: 0 },
    { x: 3, y: 1 },
  ];
  for (let i = 0; i < partySize; i++) {
    const off = partyOffsets[i % partyOffsets.length]!;
    const point = { x: off.x, y: centerY + off.y };
    partySpawnCells.push(point);
    reserved.add(`${point.x},${point.y}`);
  }

  const monsterSpawnCells: GridPoint[] = [];
  for (let i = 0; i < 6; i++) {
    const point = { x: width - 3 - (i % 2), y: centerY + Math.floor(i / 2) - 1 };
    monsterSpawnCells.push(point);
    reserved.add(`${point.x},${point.y}`);
  }

  const updates: Array<Partial<(typeof grid.cells)[number]> & { x: number; y: number }> = [];
  for (const cell of grid.cells) {
    if (reserved.has(`${cell.x},${cell.y}`)) continue;

    let terrain = cell.terrain;
    let elevationFeet = 0;
    const roll = nextFloat();
    if (roll < template.obstacleDensity) {
      terrain = template.obstacleTerrain;
    } else if (roll < template.obstacleDensity + template.hazardDensity && template.hazardTerrain) {
      terrain = template.hazardTerrain;
    }
    if (template.elevationPlateaus && terrain === template.floorTerrain && nextFloat() < 0.18) {
      elevationFeet = nextFloat() < 0.5 ? 5 : 10;
    }
    if (terrain !== cell.terrain || elevationFeet !== 0) {
      updates.push({ x: cell.x, y: cell.y, terrain, elevationFeet });
    }
  }
  grid = setGridCells(grid, updates);

  // Defensive connectivity check: remove any non-spawn obstacle that breaks a
  // route between the party and monster zones (should not happen, but keeps the
  // generator trustworthy if densities are overridden by a caller in future).
  for (const monsterSpawn of monsterSpawnCells) {
    if (hasWalkablePath(grid, partySpawnCells[0]!, monsterSpawn)) continue;
    for (const update of updates) {
      if (update.terrain === template.obstacleTerrain) {
        grid = setGridCells(grid, [
          { x: update.x, y: update.y, terrain: template.floorTerrain, blocksMovement: false },
        ]);
        if (hasWalkablePath(grid, partySpawnCells[0]!, monsterSpawn)) break;
      }
    }
  }

  return { grid, partySpawnCells, monsterSpawnCells, template };
}

// ---------------------------------------------------------------------------
// Battle generation
// ---------------------------------------------------------------------------

function xpForMonster(monster: MonsterData): number {
  if (typeof monster.xp === 'number') return monster.xp;
  const byCr = (SRD_CR_TO_XP as Record<number, number>)[monster.challengeRating];
  return typeof byCr === 'number' ? byCr : 0;
}

function validMonsterIds(
  ids: string[],
  maxCr: number,
  compendium: SrdCompendium,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const monster = compendium.getMonster(id);
    if (monster && monster.challengeRating <= maxCr) result.push(id);
  }
  return result;
}

/**
 * Generates a complete, serializable overworld battle descriptor (grid + monster
 * spawns) from a deterministic seed. No authoritative state is mutated.
 */
export function generateOverworldBattle(
  rawConfig: OverworldBattleConfigInput,
  compendium: SrdCompendium = defaultCompendium,
): GeneratedOverworldBattle {
  const config: OverworldBattleConfig = OverworldBattleConfigSchema.parse(rawConfig);
  const terrainGen = generateBattleTerrainGrid(config.terrain, config.seed, {
    width: config.width,
    height: config.height,
    partySize: config.partySize,
  });

  const maxCr = getMaxCrForBattleTier(config.crTier);
  let rngState = normalizeSeed(config.seed);
  function nextIndex(length: number): number {
    const result = nextRandomUint32(rngState);
    rngState = result.nextState;
    return result.value % Math.max(1, length);
  }

  const bossBattle = config.origin !== 'wilderness';
  const poolIds = config.monsterPool ?? terrainGen.template.monsterPool;
  let candidates = validMonsterIds(poolIds, maxCr, compendium);
  if (candidates.length === 0) {
    // Danger tier may exceed every themed monster's CR: fall back to the least
    // dangerous SRD monsters so generation always succeeds.
    candidates = validMonsterIds(['goblin', 'kobold', 'wolf', 'bandit', 'giant-rat'], maxCr, compendium);
  }
  if (candidates.length === 0) {
    throw new OverworldBattleError(
      `No resolvable SRD monsters for battle seed ${config.seed} (terrain ${config.terrain})`,
    );
  }

  const defaultCount = bossBattle
    ? 1 + nextIndex(2)
    : 1 + nextIndex(Math.min(3, Math.max(1, config.crTier + 1)));
  const count = config.monsterCount ?? defaultCount;
  const monsterIds: string[] = [];
  for (let i = 0; i < count; i++) {
    monsterIds.push(candidates[nextIndex(candidates.length)]!);
  }

  if (bossBattle) {
    const bossCandidates = validMonsterIds(
      config.bossMonsterId
        ? [config.bossMonsterId, ...terrainGen.template.bossPool]
        : terrainGen.template.bossPool,
      maxCr,
      compendium,
    );
    if (bossCandidates.length > 0) {
      monsterIds[0] = bossCandidates[nextIndex(bossCandidates.length)]!;
    }
  }

  const monsters = monsterIds.map((monsterId, index) => ({
    monsterId,
    instanceId: `${config.origin}_${config.seed}_${monsterId}_${index + 1}`,
    position: { ...terrainGen.monsterSpawnCells[index % terrainGen.monsterSpawnCells.length]! },
  }));

  return GeneratedOverworldBattleSchema.parse({
    battleId: `overworld_${config.origin}_${config.seed}`,
    seed: config.seed,
    nextRngState: normalizeSeed(rngState),
    origin: config.origin,
    terrain: config.terrain,
    crTier: config.crTier,
    grid: terrainGen.grid,
    partySpawnCells: terrainGen.partySpawnCells,
    monsters,
    poiId: config.poiId,
  });
}

/** Total XP of the monsters in a generated battle (used for quest rewards/scoring). */
export function getOverworldBattleXp(
  battle: GeneratedOverworldBattle,
  compendium: SrdCompendium = defaultCompendium,
): number {
  return battle.monsters.reduce((sum, spawn) => {
    const monster = compendium.getMonster(spawn.monsterId);
    return sum + (monster ? xpForMonster(monster) : 0);
  }, 0);
}

// ---------------------------------------------------------------------------
// Overworld context helpers (SRD-802 integration)
// ---------------------------------------------------------------------------

/** Danger tier for wandering encounters, scaled slowly by elapsed travel days. */
export function getWildernessCrTier(currentDay: number): number {
  return Math.min(6, 1 + Math.floor(Math.max(1, currentDay - 1) / 3));
}

/** Generates a wandering-monster battle for the party's current map tile. */
export function generateWildernessBattle(
  map: OverworldMap,
  travelState: OverworldTravelState,
  partySize = 4,
  options: Partial<OverworldBattleConfigInput> = {},
  compendium: SrdCompendium = defaultCompendium,
): GeneratedOverworldBattle {
  const { q, r } = travelState.partyPosition;
  const tile = getOverworldTile(map, q, r);
  if (!tile || tile.terrain === 'ocean') {
    throw new OverworldBattleError(`Cannot stage a wilderness battle at (${q},${r})`);
  }
  const seed = mixBattleSeed(map.worldSeed, travelState.currentDay, q, r, travelState.rngState);
  return generateOverworldBattle(
    {
      seed,
      terrain: tile.terrain,
      origin: 'wilderness',
      partySize,
      crTier: getWildernessCrTier(travelState.currentDay),
      ...options,
    },
    compendium,
  );
}

/** Generates the tactical entry battle for a dungeon/lair POI (Spec 06 Section 4.3). */
export function generatePoiBattle(
  map: OverworldMap,
  poi: OverworldPOI,
  partySize = 4,
  options: Partial<OverworldBattleConfigInput> = {},
  compendium: SrdCompendium = defaultCompendium,
): GeneratedOverworldBattle {
  if (poi.kind !== 'monster_lair' && poi.kind !== 'dungeon_entrance') {
    throw new OverworldBattleError(
      `POI ${poi.id} (${poi.kind}) does not stage a tactical battle`,
    );
  }
  const tile = getOverworldTile(map, poi.q, poi.r);
  if (!tile) {
    throw new OverworldBattleError(`POI ${poi.id} is outside the world map`);
  }
  const origin: OverworldBattleOrigin =
    poi.kind === 'monster_lair' ? 'monster_lair' : 'dungeon_entrance';
  const rawSeed = poi.dungeonSeed ?? mixBattleSeed(map.worldSeed, poi.q, poi.r);
  const depthTier = poi.depthTier ?? 1;
  const crTier = poi.kind === 'monster_lair' ? Math.min(6, 1 + depthTier) : Math.min(6, depthTier);
  return generateOverworldBattle(
    {
      seed: rawSeed,
      terrain: tile.terrain,
      origin,
      partySize,
      crTier,
      poiId: poi.id,
      monsterCount: poi.kind === 'monster_lair' ? 1 : 2,
      ...options,
    },
    compendium,
  );
}

// ---------------------------------------------------------------------------
// Seamless combat entry / resolution
// ---------------------------------------------------------------------------

export interface StartOverworldBattleOptions {
  battle: GeneratedOverworldBattle;
  /** Persistent party combatants (their HP, slots and conditions are preserved). */
  party: Combatant[];
  compendium?: SrdCompendium;
  id?: string;
  slots?: PlayerSlotAssignment[];
  partyInStealth?: boolean;
  monsterAmbushDc?: number;
  explicitSurprisedEntityIds?: string[];
}

export interface OverworldBattleSession {
  battle: GeneratedOverworldBattle;
  gameState: GameState;
  events: GameEvent[];
}

/**
 * Drops the party straight into an initiative-driven tactical combat on the
 * generated grid (Spec 06 Section 4.2 step 2). Persistent party combatants are
 * only cloned, never mutated; victory can therefore be committed back later.
 */
export function startOverworldBattle(options: StartOverworldBattleOptions): OverworldBattleSession {
  const { battle } = options;
  const compendium = options.compendium ?? defaultCompendium;

  const party = options.party.map((hero, index) => {
    const spawn = battle.partySpawnCells[index] ?? battle.partySpawnCells[0]!;
    return {
      ...structuredClone(hero),
      side: 'party' as const,
      teamId: 'party',
      position: { ...spawn },
      isSurprised: false,
    };
  });

  const monsters = battle.monsters.map((spawn) => {
    const monsterData = compendium.getMonster(spawn.monsterId);
    if (!monsterData) {
      throw new OverworldBattleError(`Unknown SRD monster in battle: ${spawn.monsterId}`);
    }
    return createMonsterCombatant(monsterData, spawn.instanceId, spawn.position, {
      side: 'monster',
      teamId: 'monster',
      factionId: battle.poiId ? `poi_${battle.poiId}` : undefined,
    });
  });

  let gameState = createInitialGameState({
    id: options.id ?? battle.battleId,
    grid: battle.grid,
    party,
    monsters,
    slots: options.slots,
    rngState: battle.nextRngState,
  });

  const fromMode = gameState.mode;
  const transition = startCombatEncounter({
    encounterId: battle.battleId,
    combatants: [...party, ...monsters],
    rngState: battle.nextRngState,
    partyStealth: options.partyInStealth ? { partyInStealth: true } : undefined,
    monsterAmbush:
      options.monsterAmbushDc !== undefined
        ? { monstersAmbushing: true, monsterStealthDc: options.monsterAmbushDc }
        : undefined,
    explicitSurprisedEntityIds: options.explicitSurprisedEntityIds,
  });

  const nextParty: Record<string, Combatant> = {};
  const nextMonsters: Record<string, Combatant> = {};
  for (const [id, combatant] of Object.entries(transition.state.combatants)) {
    if (combatant.side === 'party') nextParty[id] = combatant;
    else nextMonsters[id] = combatant;
  }

  gameState = {
    ...gameState,
    mode: 'combat',
    combat: transition.state,
    party: nextParty,
    monsters: nextMonsters,
    rngState: transition.state.rngState,
    partyInStealth: options.partyInStealth ?? false,
  };

  const events: GameEvent[] = [
    { type: 'MODE_CHANGED', fromMode, toMode: 'combat' },
    ...transition.events,
  ];

  return { battle, gameState, events };
}

export interface OverworldBattleResolution {
  nextState: GameState;
  totalXp: number;
  xpAwarded: number;
  goldAwarded: number;
  survivingHeroIds: string[];
  events: GameEvent[];
}

/**
 * Commits a finished overworld battle back to the persistent party (Spec 06
 * Section 4.2 step 3): shared XP, a deterministic gold purse, and a return to
 * exploration mode. The input state is never mutated.
 */
export function resolveOverworldBattle(
  state: GameState,
  options: { goldPerXp?: number; compendium?: SrdCompendium } = {},
): OverworldBattleResolution {
  if (state.mode !== 'combat') {
    throw new OverworldBattleError('Cannot resolve an overworld battle outside combat mode');
  }

  const compendium = options.compendium ?? defaultCompendium;
  const defeated = Object.values(state.monsters).filter(
    (monster) => monster.isDead || monster.currentHp <= 0,
  );
  const totalXp = defeated.reduce((sum, monster) => {
    if (typeof monster.monsterData?.xp === 'number') return sum + monster.monsterData.xp;
    return sum + (monster.monsterData ? xpForMonster(monster.monsterData) : 0);
  }, 0);
  const goldAwarded = Math.floor(totalXp * (options.goldPerXp ?? 0.1));

  const transition = transitionCombatToExploration(state);
  const survivingHeroes = Object.values(transition.nextState.party).filter((hero) => !hero.isDead);
  const goldPerHero = survivingHeroes.length > 0 ? Math.floor(goldAwarded / survivingHeroes.length) : 0;

  const events = [...transition.events];
  const nextParty: Record<string, Combatant> = {};
  for (const [id, hero] of Object.entries(transition.nextState.party)) {
    if (goldPerHero > 0 && hero.buildState) {
      nextParty[id] = {
        ...hero,
        buildState: awardLootToCharacter(hero.buildState, { gp: goldPerHero }, compendium),
      };
      events.push({
        type: 'INVENTORY_UPDATED',
        characterId: id,
        inventory: nextParty[id]!.buildState!.inventory,
        currency: nextParty[id]!.buildState!.currency,
      });
    } else {
      nextParty[id] = hero;
    }
  }

  return {
    nextState: { ...transition.nextState, party: nextParty },
    totalXp,
    xpAwarded: transition.events.find((event) => event.type === 'ENCOUNTER_VICTORY')?.xpAwarded ?? 0,
    goldAwarded,
    survivingHeroIds: survivingHeroes.map((hero) => hero.id),
    events,
  };
}
