import { z } from 'zod';
import {
  type AbilityId,
  type DamageType,
  type GridPoint,
  type SpecialRoomKind,
  type TileTerrainType,
  type LightLevel,
} from '@srd5/data';
import {
  type BiomeTier,
  BiomeTierSchema,
  type DungeonCellSpec,
  type DungeonFloorSpec,
  type DungeonRoomSpec,
  type EncounterSpawnGroup,
  type InteractivePropSpec,
  DungeonFloorSpecSchema,
} from './schemas.js';
import {
  normalizeSeed,
  nextRandomFloat,
  rollDie,
} from '../dice/prng.js';
import { generateFloorRecallTags } from './recall.js';
import { pickFromBand } from './encounter-tables.js';
import { rollChampionForEncounter } from './champions.js';
import {
  CURSED_SHRINE_TYPE,
  NEST_XP_MULTIPLIER,
  VAULT_TRAP_CHANCE,
  rollNestPack,
  rollSpecialRoomForFloor,
  rollVaultHoard,
  specialRoomDisplayName,
  vaultLockDcForDepth,
} from './special-rooms.js';
import {
  WorldOptionsSchema,
  applyScopeToFloorSize,
  applyWildnessToMonsterCount,
  scaleLootForScarcity,
} from '../world-options.js';

/**
 * Procedural dungeon floor generator configuration (Spec 06 Section 3.1).
 */
export const ProceduralFloorConfigSchema = z.object({
  depth: z.number().int().min(1),
  seed: z.number().int(),
  width: z.number().int().min(20).default(40),
  height: z.number().int().min(20).default(40),
  biome: BiomeTierSchema.optional(),
  targetRoomCount: z.number().int().min(2).max(24).optional(),
  minRoomDimension: z.number().int().min(4).max(12).default(5),
  maxRoomDimension: z.number().int().min(6).max(20).default(10),
  chasmProbability: z.number().min(0).max(1).default(0.1),
  trapDensity: z.number().min(0).max(1).default(0.4),
  shrineProbability: z.number().min(0).max(1).default(0.35),
  chestProbability: z.number().min(0).max(1).default(0.5),
  furnitureDensity: z.number().min(0).max(1).default(0.65),
  doorProbability: z.number().min(0).max(1).default(0.8),
  lockedStairsDoor: z.boolean().optional(),
  /** SRD-1403 world options (Civ setup screen). Defaults reproduce today's generation bit-exact. */
  worldOptions: WorldOptionsSchema.optional(),
});
export type ProceduralFloorConfigInput = z.input<typeof ProceduralFloorConfigSchema>;
export type ProceduralFloorConfig = z.output<typeof ProceduralFloorConfigSchema>;

/**
 * Generated floor result package.
 */
export interface GeneratedDungeonFloor {
  floor: DungeonFloorSpec;
  biome: BiomeTier;
  depth: number;
  seed: number;
  nextRngState: number;
  stairsUp: GridPoint;
  stairsDown: GridPoint;
  keyLocation?: {
    roomId: string;
    propId?: string;
    keyItem: string;
  };
}

/**
 * Thematic definition of each biome tier.
 *
 * SRD-1401: regular encounters no longer draw from `monsters` — they draw
 * from CR-banded tables (`encounter-tables.ts`) over the full 61-monster
 * roster. `monsters` is retained as a legacy per-biome flavor hint and for
 * backwards-compatible tests, while `bossMonsters` remains the curated
 * authority for boss rooms (untouched).
 */
export interface BiomeTheme {
  biome: BiomeTier;
  name: string;
  defaultLight: LightLevel;
  primaryFloorTerrain: TileTerrainType;
  wallTerrain: TileTerrainType;
  hazardTerrain?: TileTerrainType;
  monsters: string[];
  bossMonsters: string[];
  trapType: {
    damageFormula: string;
    damageType: DamageType;
    saveAbility: AbilityId;
    dc: number;
    detectionDc: number;
    disarmDc: number;
  };
}

/**
 * Returns the canonical biome tier for a given dungeon depth (Spec 06 Section 3.1).
 */
export function getBiomeForDepth(depth: number): BiomeTier {
  if (depth <= 3) return 'catacombs';
  if (depth <= 6) return 'sunken_tombs';
  if (depth <= 9) return 'magma_caverns';
  if (depth <= 12) return 'deep_vaults';
  return 'abyssal_rift';
}

/**
 * Returns the aesthetic and tactical theme for a biome tier.
 */
export function getBiomeTheme(biome: BiomeTier): BiomeTheme {
  switch (biome) {
    case 'catacombs':
      return {
        biome,
        name: 'The Catacombs',
        defaultLight: 'dim',
        primaryFloorTerrain: 'floor_stone',
        wallTerrain: 'wall_solid',
        hazardTerrain: 'rubble',
        monsters: ['kobold', 'giant-rat', 'giant-bat', 'goblin', 'giant-wolf-spider', 'skeleton', 'zombie'],
        bossMonsters: ['goblin-boss', 'bugbear', 'warhorse-skeleton', 'shadow', 'thug', 'knight', 'stone-golem', 'vampire'],
        trapType: {
          damageFormula: '1d6',
          damageType: 'bludgeoning',
          saveAbility: 'dex',
          dc: 12,
          detectionDc: 12,
          disarmDc: 12,
        },
      };
    case 'sunken_tombs':
      return {
        biome,
        name: 'The Sunken Tombs',
        defaultLight: 'darkness',
        primaryFloorTerrain: 'floor_stone',
        wallTerrain: 'wall_solid',
        hazardTerrain: 'water_shallow',
        monsters: ['ghoul', 'giant-spider', 'giant-wolf-spider', 'shadow', 'mummy', 'ghost', 'cultist'],
        bossMonsters: ['wight', 'gelatinous-cube', 'specter', 'wraith', 'cult-fanatic', 'hydra', 'mummy-lord', 'vampire'],
        trapType: {
          damageFormula: '1d8',
          damageType: 'poison',
          saveAbility: 'con',
          dc: 13,
          detectionDc: 13,
          disarmDc: 13,
        },
      };
    case 'magma_caverns':
      return {
        biome,
        name: 'The Magma Caverns',
        defaultLight: 'dim',
        primaryFloorTerrain: 'floor_stone',
        wallTerrain: 'wall_solid',
        hazardTerrain: 'lava',
        monsters: ['orc', 'bandit', 'thug', 'hell-hound'],
        bossMonsters: ['minotaur', 'ogre', 'berserker', 'troll', 'harpy', 'fire-giant', 'young-red-dragon', 'adult-red-dragon'],
        trapType: {
          damageFormula: '2d6',
          damageType: 'fire',
          saveAbility: 'dex',
          dc: 14,
          detectionDc: 14,
          disarmDc: 14,
        },
      };
    case 'deep_vaults':
      return {
        biome,
        name: 'The Deep Vaults',
        defaultLight: 'darkness',
        primaryFloorTerrain: 'floor_stone',
        wallTerrain: 'wall_solid',
        hazardTerrain: 'rubble',
        monsters: ['cult-fanatic', 'mage', 'knight', 'veteran'],
        bossMonsters: ['medusa', 'manticore', 'hill-giant', 'gladiator', 'oni', 'frost-giant', 'clay-golem', 'stone-golem', 'archmage'],
        trapType: {
          damageFormula: '2d8',
          damageType: 'lightning',
          saveAbility: 'dex',
          dc: 15,
          detectionDc: 15,
          disarmDc: 15,
        },
      };
    case 'abyssal_rift':
      return {
        biome,
        name: 'The Abyssal Rift',
        defaultLight: 'darkness',
        primaryFloorTerrain: 'floor_stone',
        wallTerrain: 'wall_solid',
        hazardTerrain: 'chasm',
        monsters: ['mage', 'wight', 'wraith', 'cult-fanatic'],
        bossMonsters: ['young-black-dragon', 'adult-black-dragon', 'wyvern', 'oni', 'vampire', 'archmage', 'mummy-lord', 'adult-red-dragon'],
        trapType: {
          damageFormula: '3d6',
          damageType: 'necrotic',
          saveAbility: 'con',
          dc: 16,
          detectionDc: 16,
          disarmDc: 16,
        },
      };
  }
}

interface BspPartition {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface InternalRoom {
  id: string;
  name: string;
  bounds: { x: number; y: number; width: number; height: number };
  center: GridPoint;
  cells: GridPoint[];
}

/**
 * Evaluates whether two integer points are equal.
 */
function isSamePoint(a: GridPoint, b: GridPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Computes Manhattan distance between two points.
 */
function manhattanDistance(a: GridPoint, b: GridPoint): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Breadth-First Search (BFS) pathfinder on a grid of passable cells.
 */
export function findPathBfs(
  floor: DungeonFloorSpec,
  start: GridPoint,
  goal: GridPoint,
): GridPoint[] | null {
  if (isSamePoint(start, goal)) {
    return [start];
  }

  const width = floor.width;
  const height = floor.height;
  const passable = new Set<string>();

  for (const c of floor.cells) {
    if (c.terrain !== 'wall_solid' && c.terrain !== 'void') {
      passable.add(`${c.x},${c.y}`);
    }
  }

  // Blocking props (e.g. locked doors) might block movement during play,
  // but for topological connectivity validation we treat doors as traversable pathways.
  if (!passable.has(`${start.x},${start.y}`) || !passable.has(`${goal.x},${goal.y}`)) {
    return null;
  }

  const queue: GridPoint[] = [start];
  const cameFrom = new Map<string, GridPoint>();
  const startKey = `${start.x},${start.y}`;
  const goalKey = `${goal.x},${goal.y}`;
  cameFrom.set(startKey, start);

  const directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currKey = `${current.x},${current.y}`;

    if (currKey === goalKey) {
      // Reconstruct path
      const path: GridPoint[] = [];
      let stepKey = goalKey;
      let currStep = current;

      while (`${currStep.x},${currStep.y}` !== startKey) {
        path.unshift(currStep);
        currStep = cameFrom.get(stepKey)!;
        stepKey = `${currStep.x},${currStep.y}`;
      }
      path.unshift(start);
      return path;
    }

    for (const d of directions) {
      const nx = current.x + d.x;
      const ny = current.y + d.y;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nKey = `${nx},${ny}`;
      if (passable.has(nKey) && !cameFrom.has(nKey)) {
        cameFrom.set(nKey, current);
        queue.push({ x: nx, y: ny });
      }
    }
  }

  return null;
}

/**
 * Validates topological connectivity across all rooms and portals on a dungeon floor.
 */
export function verifyDungeonConnectivity(floor: DungeonFloorSpec): {
  isFullyConnected: boolean;
  reachableRooms: string[];
  unreachableRooms: string[];
  stairsDownReachable: boolean;
} {
  const rooms = floor.rooms ?? [];
  const stairsUpProp = floor.props.find((p) => p.kind === 'stairs_up');
  const stairsDownProp = floor.props.find((p) => p.kind === 'stairs_down');

  const startPoint: GridPoint = stairsUpProp
    ? { x: stairsUpProp.x, y: stairsUpProp.y }
    : floor.partySpawnCells[0] ?? { x: 0, y: 0 };

  const reachableRooms: string[] = [];
  const unreachableRooms: string[] = [];

  for (const r of rooms) {
    if (!r.bounds) continue;
    const roomCenter: GridPoint = {
      x: Math.floor(r.bounds.x + r.bounds.width / 2),
      y: Math.floor(r.bounds.y + r.bounds.height / 2),
    };
    const path = findPathBfs(floor, startPoint, roomCenter);
    if (path !== null) {
      reachableRooms.push(r.id);
    } else {
      unreachableRooms.push(r.id);
    }
  }

  let stairsDownReachable = true;
  if (stairsDownProp) {
    const pathToDown = findPathBfs(floor, startPoint, {
      x: stairsDownProp.x,
      y: stairsDownProp.y,
    });
    stairsDownReachable = pathToDown !== null;
  }

  const isFullyConnected = unreachableRooms.length === 0 && stairsDownReachable;

  return {
    isFullyConnected,
    reachableRooms,
    unreachableRooms,
    stairsDownReachable,
  };
}

/**
 * Procedural Dungeon Floor Generator (`DungeonGenerator`).
 *
 * Implements:
 * 1. Binary Space Partitioning (BSP) subdivision of the floor rectangle into leaf regions.
 * 2. Room generation with non-overlapping bounds within leaf regions.
 * 3. Minimum Spanning Tree (MST) + loop corridor network connecting all rooms.
 * 4. Guaranteed Breadth-First Search (BFS) path connectivity from entrance to all rooms and stairs.
 * 5. Furthest-room topological placement of `stairs_down`.
 * 6. Doorways with depth-scaled locked gates and key item placement.
 * 7. Biome-themed hazards, light levels, monster spawns, traps, and shrines.
 */
export function generateDungeonFloor(rawConfig: ProceduralFloorConfigInput): GeneratedDungeonFloor {
  const config = ProceduralFloorConfigSchema.parse(rawConfig);
  let rngState = normalizeSeed(config.seed);

  // SRD-1403: world options are replay-safe — standard/default takes the exact
  // historical code path (no extra RNG, no scaling).
  const worldScope = config.worldOptions?.scope ?? 'standard';
  const wildness = config.worldOptions?.wildness ?? 'standard';
  const scarcity = config.worldOptions?.scarcity ?? 'standard';

  function nextFloat(): number {
    const res = nextRandomFloat(rngState);
    rngState = res.nextState;
    return res.value;
  }

  function nextDie(faces: number): number {
    const res = rollDie(rngState, faces);
    rngState = res.nextState;
    return res.roll;
  }

  const biome: BiomeTier = config.biome ?? getBiomeForDepth(config.depth);
  const theme = getBiomeTheme(biome);

  const scopedSize = applyScopeToFloorSize(
    {
      width: config.width,
      height: config.height,
      targetRoomCount:
        config.targetRoomCount ??
        Math.min(10, Math.max(5, Math.floor(4 + config.depth * 0.4))),
    },
    worldScope,
  );
  const floorWidth = scopedSize.width;
  const floorHeight = scopedSize.height;
  const targetRooms = scopedSize.targetRoomCount;

  const minPartitionSize = config.minRoomDimension + 4; // e.g. 5 + 4 = 9
  const minSplitThreshold = minPartitionSize * 2; // e.g. 18

  // Root partition leaves 1 tile border on all 4 sides
  const partitions: BspPartition[] = [
    {
      id: 0,
      x: 1,
      y: 1,
      width: floorWidth - 2,
      height: floorHeight - 2,
    },
  ];

  let nextPartId = 1;

  // 1. Binary Space Partitioning
  while (partitions.length < targetRooms) {
    // Pick largest partition capable of splitting
    let bestIdx = -1;
    let maxArea = -1;

    for (let i = 0; i < partitions.length; i++) {
      const p = partitions[i];
      if (p.width >= minSplitThreshold || p.height >= minSplitThreshold) {
        const area = p.width * p.height;
        if (area > maxArea) {
          maxArea = area;
          bestIdx = i;
        }
      }
    }

    if (bestIdx === -1) {
      break; // No partitions can be split further
    }

    const p = partitions[bestIdx];

    // Determine split axis
    const canSplitV = p.width >= minSplitThreshold;
    const canSplitH = p.height >= minSplitThreshold;

    let splitVertically: boolean;
    if (canSplitV && canSplitH) {
      if (p.width > p.height * 1.25) {
        splitVertically = true;
      } else if (p.height > p.width * 1.25) {
        splitVertically = false;
      } else {
        splitVertically = nextFloat() < 0.5;
      }
    } else {
      splitVertically = canSplitV;
    }

    if (splitVertically) {
      const minSplit = minPartitionSize;
      const maxSplit = p.width - minPartitionSize;
      const splitX = minSplit + Math.floor(nextFloat() * (maxSplit - minSplit + 1));

      const p1: BspPartition = {
        id: p.id,
        x: p.x,
        y: p.y,
        width: splitX,
        height: p.height,
      };
      const p2: BspPartition = {
        id: nextPartId++,
        x: p.x + splitX,
        y: p.y,
        width: p.width - splitX,
        height: p.height,
      };
      partitions.splice(bestIdx, 1, p1, p2);
    } else {
      const minSplit = minPartitionSize;
      const maxSplit = p.height - minPartitionSize;
      const splitY = minSplit + Math.floor(nextFloat() * (maxSplit - minSplit + 1));

      const p1: BspPartition = {
        id: p.id,
        x: p.x,
        y: p.y,
        width: p.width,
        height: splitY,
      };
      const p2: BspPartition = {
        id: nextPartId++,
        x: p.x,
        y: p.y + splitY,
        width: p.width,
        height: p.height - splitY,
      };
      partitions.splice(bestIdx, 1, p1, p2);
    }
  }

  // 2. Generate Rooms inside Partitions
  const internalRooms: InternalRoom[] = [];
  const floorId = `floor_depth_${config.depth}_seed_${config.seed}`;

  for (let i = 0; i < partitions.length; i++) {
    const p = partitions[i];
    const availableW = p.width - 2;
    const availableH = p.height - 2;

    const maxW = Math.min(config.maxRoomDimension, availableW);
    const maxH = Math.min(config.maxRoomDimension, availableH);
    const minW = Math.min(config.minRoomDimension, maxW);
    const minH = Math.min(config.minRoomDimension, maxH);

    const roomW = minW + Math.floor(nextFloat() * (maxW - minW + 1));
    const roomH = minH + Math.floor(nextFloat() * (maxH - minH + 1));

    const maxOffX = p.width - roomW - 1;
    const maxOffY = p.height - roomH - 1;
    const offX = 1 + Math.floor(nextFloat() * Math.max(1, maxOffX));
    const offY = 1 + Math.floor(nextFloat() * Math.max(1, maxOffY));

    const roomX = p.x + offX;
    const roomY = p.y + offY;
    const roomId = `room_${i}`;
    const name =
      i === 0
        ? `Entrance Hall`
        : `${theme.name} Chamber ${i}`;

    const cells: GridPoint[] = [];
    for (let ry = roomY; ry < roomY + roomH; ry++) {
      for (let rx = roomX; rx < roomX + roomW; rx++) {
        cells.push({ x: rx, y: ry });
      }
    }

    internalRooms.push({
      id: roomId,
      name,
      bounds: { x: roomX, y: roomY, width: roomW, height: roomH },
      center: {
        x: Math.floor(roomX + roomW / 2),
        y: Math.floor(roomY + roomH / 2),
      },
      cells,
    });
  }

  // 3. Grid cell tracking map: "x,y" => cell spec
  const cellMap = new Map<string, DungeonCellSpec>();

  // Carve all room cells
  for (const room of internalRooms) {
    for (const pt of room.cells) {
      cellMap.set(`${pt.x},${pt.y}`, {
        x: pt.x,
        y: pt.y,
        roomId: room.id,
        terrain: theme.primaryFloorTerrain,
        baseLight: theme.defaultLight,
        elevationFeet: 0,
      });
    }
  }

  // 4. Corridors via Minimum Spanning Tree (MST) + Loops
  interface Edge {
    u: number;
    v: number;
    weight: number;
  }
  const allEdges: Edge[] = [];
  for (let i = 0; i < internalRooms.length; i++) {
    for (let j = i + 1; j < internalRooms.length; j++) {
      allEdges.push({
        u: i,
        v: j,
        weight: manhattanDistance(internalRooms[i].center, internalRooms[j].center),
      });
    }
  }
  allEdges.sort((a, b) => a.weight - b.weight);

  // Kruskal's MST
  const parent = Array.from({ length: internalRooms.length }, (_, i) => i);
  function findRoot(x: number): number {
    if (parent[x] !== x) parent[x] = findRoot(parent[x]);
    return parent[x];
  }
  function unionRoots(x: number, y: number): boolean {
    const rx = findRoot(x);
    const ry = findRoot(y);
    if (rx === ry) return false;
    parent[rx] = ry;
    return true;
  }

  const mstEdges: Edge[] = [];
  const remainingEdges: Edge[] = [];

  for (const e of allEdges) {
    if (unionRoots(e.u, e.v)) {
      mstEdges.push(e);
    } else {
      remainingEdges.push(e);
    }
  }

  // Add 1-2 extra loop connections if available
  const loopCount = Math.min(2, remainingEdges.length);
  const corridorEdges = [...mstEdges, ...remainingEdges.slice(0, loopCount)];

  // Helper to carve corridor segment
  function carveCorridorPoint(x: number, y: number) {
    const key = `${x},${y}`;
    const existing = cellMap.get(key);
    if (!existing) {
      cellMap.set(key, {
        x,
        y,
        terrain: theme.primaryFloorTerrain,
        baseLight: theme.defaultLight,
        elevationFeet: 0,
      });
    }
  }

  function carveLCorridor(p1: GridPoint, p2: GridPoint, hFirst: boolean) {
    if (hFirst) {
      // Horizontal from p1.x to p2.x at p1.y
      const stepX = p1.x <= p2.x ? 1 : -1;
      for (let x = p1.x; x !== p2.x + stepX; x += stepX) {
        carveCorridorPoint(x, p1.y);
      }
      // Vertical from p1.y to p2.y at p2.x
      const stepY = p1.y <= p2.y ? 1 : -1;
      for (let y = p1.y; y !== p2.y + stepY; y += stepY) {
        carveCorridorPoint(p2.x, y);
      }
    } else {
      // Vertical from p1.y to p2.y at p1.x
      const stepY = p1.y <= p2.y ? 1 : -1;
      for (let y = p1.y; y !== p2.y + stepY; y += stepY) {
        carveCorridorPoint(p1.x, y);
      }
      // Horizontal from p1.x to p2.x at p2.y
      const stepX = p1.x <= p2.x ? 1 : -1;
      for (let x = p1.x; x !== p2.x + stepX; x += stepX) {
        carveCorridorPoint(x, p2.y);
      }
    }
  }

  for (const e of corridorEdges) {
    const r1 = internalRooms[e.u];
    const r2 = internalRooms[e.v];
    const hFirst = nextFloat() < 0.5;
    carveLCorridor(r1.center, r2.center, hFirst);
  }

  // 5. Guaranteed BFS Connectivity & Auto-Heal
  function getReachableCenters(start: GridPoint): Set<string> {
    const visited = new Set<string>();
    const q: GridPoint[] = [start];
    visited.add(`${start.x},${start.y}`);

    const dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];

    while (q.length > 0) {
      const curr = q.shift()!;
      for (const d of dirs) {
        const nx = curr.x + d.x;
        const ny = curr.y + d.y;
        const key = `${nx},${ny}`;
        if (cellMap.has(key) && !visited.has(key)) {
          visited.add(key);
          q.push({ x: nx, y: ny });
        }
      }
    }
    return visited;
  }

  let reachableSet = getReachableCenters(internalRooms[0].center);

  // If any room center is somehow unreachable, connect directly to nearest reachable room
  for (let i = 1; i < internalRooms.length; i++) {
    const rCenter = internalRooms[i].center;
    if (!reachableSet.has(`${rCenter.x},${rCenter.y}`)) {
      // Find closest visited room
      let closestRoom = internalRooms[0];
      let minDist = Infinity;
      for (let j = 0; j < internalRooms.length; j++) {
        const otherCenter = internalRooms[j].center;
        if (reachableSet.has(`${otherCenter.x},${otherCenter.y}`)) {
          const d = manhattanDistance(rCenter, otherCenter);
          if (d < minDist) {
            minDist = d;
            closestRoom = internalRooms[j];
          }
        }
      }
      carveLCorridor(rCenter, closestRoom.center, nextFloat() < 0.5);
      reachableSet = getReachableCenters(internalRooms[0].center);
    }
  }

  // 6. BFS Distance Mapping & Furthest Room (Stairs Down)
  // Compute exact shortest cell path distance from Room 0 center to every other room center
  function getShortestPathDist(start: GridPoint, goal: GridPoint): number {
    const q: Array<{ pt: GridPoint; dist: number }> = [{ pt: start, dist: 0 }];
    const seen = new Set<string>([`${start.x},${start.y}`]);
    const goalKey = `${goal.x},${goal.y}`;

    const dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];

    while (q.length > 0) {
      const { pt, dist } = q.shift()!;
      if (`${pt.x},${pt.y}` === goalKey) return dist;

      for (const d of dirs) {
        const nx = pt.x + d.x;
        const ny = pt.y + d.y;
        const key = `${nx},${ny}`;
        if (cellMap.has(key) && !seen.has(key)) {
          seen.add(key);
          q.push({ pt: { x: nx, y: ny }, dist: dist + 1 });
        }
      }
    }
    return Infinity;
  }

  let furthestRoomIdx = 1;
  let maxPathDist = -1;
  const roomDistances: number[] = [0];

  for (let i = 1; i < internalRooms.length; i++) {
    const dist = getShortestPathDist(internalRooms[0].center, internalRooms[i].center);
    roomDistances.push(dist);
    if (dist > maxPathDist) {
      maxPathDist = dist;
      furthestRoomIdx = i;
    }
  }

  const entranceRoom = internalRooms[0];
  const descentRoom = internalRooms[furthestRoomIdx];

  const stairsUp: GridPoint = { ...entranceRoom.center };
  const stairsDown: GridPoint = { ...descentRoom.center };

  // Party Spawn Cells: 4 walkable cells in entrance room adjacent or near stairs_up
  const partySpawnCells: GridPoint[] = [];
  const candidateSpawnOffsets = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
    { x: 1, y: -1 },
    { x: -1, y: -1 },
  ];

  for (const off of candidateSpawnOffsets) {
    const sx = stairsUp.x + off.x;
    const sy = stairsUp.y + off.y;
    if (
      sx >= entranceRoom.bounds.x &&
      sx < entranceRoom.bounds.x + entranceRoom.bounds.width &&
      sy >= entranceRoom.bounds.y &&
      sy < entranceRoom.bounds.y + entranceRoom.bounds.height
    ) {
      if (!partySpawnCells.some((p) => p.x === sx && p.y === sy)) {
        partySpawnCells.push({ x: sx, y: sy });
      }
      if (partySpawnCells.length >= 4) break;
    }
  }

  // 7. Interactive Props: Stairs Up and Stairs Down
  const props: InteractivePropSpec[] = [];

  props.push({
    id: `stairs_up_${config.depth}`,
    x: stairsUp.x,
    y: stairsUp.y,
    kind: 'stairs_up',
    state: 'open',
    blocksMovement: false,
    blocksSight: false,
    targetFloorId: config.depth > 1 ? `floor_depth_${config.depth - 1}` : undefined,
  });

  props.push({
    id: `stairs_down_${config.depth}`,
    x: stairsDown.x,
    y: stairsDown.y,
    kind: 'stairs_down',
    state: 'open',
    blocksMovement: false,
    blocksSight: false,
    targetFloorId: `floor_depth_${config.depth + 1}`,
  });

  // 8. Doorways and Gate Mechanics
  // Doorway detection: corridor cells (outside room) directly adjacent to a room perimeter
  interface DoorwayCandidate {
    pt: GridPoint;
    intoRoomId: string;
    isStrictThreshold: boolean;
  }
  const doorwayCandidates: DoorwayCandidate[] = [];

  function checkDoorwayCell(x: number, y: number, intoRoomId: string) {
    const key = `${x},${y}`;
    const cell = cellMap.get(key);
    // Must be a carved passable tile and NOT already inside a room
    if (!cell || cell.roomId !== undefined) return;

    const left = cellMap.get(`${x - 1},${y}`);
    const right = cellMap.get(`${x + 1},${y}`);
    const top = cellMap.get(`${x},${y - 1}`);
    const bottom = cellMap.get(`${x},${y + 1}`);

    // SRD-1701: only true 1-wide thresholds qualify. A corridor merely
    // grazing past a room has extra carved neighbors (room floor on the
    // perpendicular side), so it is never strict — this rejects the
    // wall-embedded door rows and doors with no room opening behind them.
    const isVerticalPassage = !left && !right && !!top && !!bottom;
    const isHorizontalPassage = !top && !bottom && !!left && !!right;
    if (!isVerticalPassage && !isHorizontalPassage) return;

    if (!doorwayCandidates.some((d) => d.pt.x === x && d.pt.y === y)) {
      doorwayCandidates.push({
        pt: { x, y },
        intoRoomId,
        isStrictThreshold: true,
      });
    }
  }

  for (const room of internalRooms) {
    const rx1 = room.bounds.x;
    const ry1 = room.bounds.y;
    const rx2 = room.bounds.x + room.bounds.width - 1;
    const ry2 = room.bounds.y + room.bounds.height - 1;

    for (let x = rx1; x <= rx2; x++) {
      checkDoorwayCell(x, ry1 - 1, room.id);
      checkDoorwayCell(x, ry2 + 1, room.id);
    }
    for (let y = ry1; y <= ry2; y++) {
      checkDoorwayCell(rx1 - 1, y, room.id);
      checkDoorwayCell(rx2 + 1, y, room.id);
    }
  }

  // Key & Gate requirement: if depth >= 3 or lockedStairsDoor is explicitly true
  const isStairsLocked =
    config.lockedStairsDoor ?? (config.depth >= 3);

  let keyLocation: GeneratedDungeonFloor['keyLocation'] | undefined;
  let lockedDoorPlaced = false;

  const propOccupied = new Set<string>([
    `${stairsUp.x},${stairsUp.y}`,
    `${stairsDown.x},${stairsDown.y}`,
  ]);

  // SRD-1701: door adjacency suppression set (declared before both passes).
  // Once any door lands, Chebyshev-neighboring candidates are skipped, so
  // locked gates and standard doors can never sit side by side.
  const doorBlocked = new Set<string>();
  const suppressDoorNeighbors = (x: number, y: number) => {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        doorBlocked.add(`${x + dx},${y + dy}`);
      }
    }
  };

  // First pass: if stairs locked, place locked gate at entrance to descent room
  if (isStairsLocked) {
    const descentCandidates = doorwayCandidates.filter(
      (c) => c.intoRoomId === descentRoom.id,
    );
    // Prefer strict threshold
    const chosen =
      descentCandidates.find((c) => c.isStrictThreshold) ?? descentCandidates[0];

    if (chosen) {
      const doorId = `locked_gate_depth_${config.depth}`;
      props.push({
        id: doorId,
        x: chosen.pt.x,
        y: chosen.pt.y,
        kind: 'door',
        state: 'locked',
        blocksMovement: true,
        blocksSight: true,
        lockDc: Math.min(20, 12 + config.depth),
      });
      propOccupied.add(`${chosen.pt.x},${chosen.pt.y}`);
      suppressDoorNeighbors(chosen.pt.x, chosen.pt.y);
      lockedDoorPlaced = true;
    }
  }

  // Second pass: standard doors. SRD-1701: placement-level adjacency
  // suppression — once a door lands, Chebyshev-neighboring candidates are
  // skipped outright, so L-elbow kisses and double-wide carves can never
  // yield adjacent door pairs. Suppression lives in a dedicated set so the
  // shared propOccupied map (traps/chests/spawns) keeps its exact-cell
  // semantics.
  let doorCounter = 0;
  for (const dw of doorwayCandidates) {
    const key = `${dw.pt.x},${dw.pt.y}`;
    if (propOccupied.has(key) || doorBlocked.has(key)) continue;

    if (nextFloat() < config.doorProbability) {
      props.push({
        id: `door_${config.depth}_${++doorCounter}`,
        x: dw.pt.x,
        y: dw.pt.y,
        kind: 'door',
        state: 'closed',
        blocksMovement: true,
        blocksSight: true,
      });
      propOccupied.add(key);
      suppressDoorNeighbors(dw.pt.x, dw.pt.y);
    }
  }

  // If locked door was placed (or needed), place key in an intermediate room
  if (isStairsLocked) {
    // Pick room with second-longest path distance (or any non-entrance, non-descent room)
    let keyRoomIdx = 1;
    let secondMaxDist = -1;

    for (let i = 1; i < internalRooms.length; i++) {
      if (i === furthestRoomIdx) continue;
      const d = roomDistances[i];
      if (d > secondMaxDist) {
        secondMaxDist = d;
        keyRoomIdx = i;
      }
    }

    const keyRoom = internalRooms[keyRoomIdx];
    // Find an empty corner in keyRoom for a chest
    const keyChestPt = {
      x: keyRoom.bounds.x + 1,
      y: keyRoom.bounds.y + 1,
    };
    const chestId = `chest_key_${config.depth}`;

    props.push({
      id: chestId,
      x: keyChestPt.x,
      y: keyChestPt.y,
      kind: 'chest',
      state: 'closed',
      blocksMovement: false,
      blocksSight: false,
      lootTable: {
        items: ['iron_dungeon_key'],
        gp: 25 * config.depth,
      },
    });
    propOccupied.add(`${keyChestPt.x},${keyChestPt.y}`);

    keyLocation = {
      roomId: keyRoom.id,
      propId: chestId,
      keyItem: 'iron_dungeon_key',
    };
  }

  // 9. Chests, Traps & Shrines
  let chestCount = 0;
  let trapCount = 0;

  for (let i = 1; i < internalRooms.length; i++) {
    const room = internalRooms[i];

    // Chest placement
    if (nextFloat() < config.chestProbability) {
      const cornerCandidate = {
        x: room.bounds.x + room.bounds.width - 2,
        y: room.bounds.y + 1,
      };
      const key = `${cornerCandidate.x},${cornerCandidate.y}`;
      if (!propOccupied.has(key)) {
        const chestLoot = scaleLootForScarcity(
          {
            gp: nextDie(20) * config.depth,
            sp: nextDie(50) * config.depth,
          },
          scarcity,
        );
        props.push({
          id: `chest_${config.depth}_${++chestCount}`,
          x: cornerCandidate.x,
          y: cornerCandidate.y,
          kind: 'chest',
          state: 'closed',
          blocksMovement: false,
          blocksSight: false,
          lootTable: {
            ...chestLoot,
            items: ['potion-of-healing'],
          },
        });
        propOccupied.add(key);
      }
    }

    // Trap placement
    if (nextFloat() < config.trapDensity) {
      const trapCandidate = {
        x: room.bounds.x + 2,
        y: room.bounds.y + 2,
      };
      const key = `${trapCandidate.x},${trapCandidate.y}`;
      if (!propOccupied.has(key)) {
        props.push({
          id: `trap_${config.depth}_${++trapCount}`,
          x: trapCandidate.x,
          y: trapCandidate.y,
          kind: 'trap',
          state: 'closed',
          blocksMovement: false,
          blocksSight: false,
          discovered: false,
          detectionDc: theme.trapType.detectionDc,
          disarmDc: theme.trapType.disarmDc,
          trapDamageFormula: theme.trapType.damageFormula,
          trapDamageType: theme.trapType.damageType,
          trapSaveDc: theme.trapType.dc,
          trapSaveAbility: theme.trapType.saveAbility,
          trapHalfDamageOnSave: true,
        });
        propOccupied.add(key);
      }
    }
  }

  // Shrine placement: place in middle room if shrineProbability fires
  if (nextFloat() < config.shrineProbability && internalRooms.length >= 3) {
    const shrineRoomIdx = Math.floor(internalRooms.length / 2);
    const shrineRoom = internalRooms[shrineRoomIdx];
    const shrinePt = {
      x: shrineRoom.center.x,
      y: shrineRoom.center.y,
    };
    const key = `${shrinePt.x},${shrinePt.y}`;
    if (!propOccupied.has(key)) {
      const shrineTypes = [
        'shrine_blood_god',
        'shrine_arcane_weave',
        'fountain_restoration',
      ] as const;
      const shrineType = shrineTypes[Math.floor(nextFloat() * shrineTypes.length)];
      props.push({
        id: `shrine_${config.depth}`,
        x: shrinePt.x,
        y: shrinePt.y,
        kind: 'shrine',
        shrineType,
        state: 'closed',
        blocksMovement: false,
        blocksSight: false,
      });
      propOccupied.add(key);
    }
  }

  // 9b. Furniture dressing (SRD-512): placeable set dressing with interaction
  // support. Only in large rooms (never the entrance), never blocking, never
  // on stairs/doors/chests/traps (propOccupied) — later encounter spawns also
  // avoid these cells, so connectivity guarantees are unaffected.
  const FURNITURE_TABLE = [
    'table', 'table', 'crate', 'crate', 'desk', 'bookshelf',
    'bed', 'wardrobe', 'altar', 'throne', 'curtains', 'alcove',
  ] as const;
  const HIDE_SPOT_TYPES = new Set(['wardrobe', 'crate', 'curtains', 'alcove', 'bed']);
  let furnitureCount = 0;
  for (let i = 1; i < internalRooms.length; i++) {
    const room = internalRooms[i];
    const area = room.bounds.width * room.bounds.height;
    if (area < 40) continue;
    if (nextFloat() >= (config.furnitureDensity ?? 0.65)) continue;
    // One statement piece, occasionally a second.
    const pieces = 1 + (nextFloat() < 0.4 ? 1 : 0);
    for (let f = 0; f < pieces; f++) {
      let spot: GridPoint | undefined;
      for (let attempt = 0; attempt < 10 && !spot; attempt++) {
        const cx = room.bounds.x + 1 + Math.floor(nextFloat() * Math.max(1, room.bounds.width - 2));
        const cy = room.bounds.y + 1 + Math.floor(nextFloat() * Math.max(1, room.bounds.height - 2));
        if (!propOccupied.has(`${cx},${cy}`)) {
          spot = { x: cx, y: cy };
        }
      }
      if (!spot) continue;
      const furnitureType = FURNITURE_TABLE[Math.floor(nextFloat() * FURNITURE_TABLE.length)];
      const withCompartment = (furnitureType === 'desk' || furnitureType === 'bookshelf') && nextFloat() < 0.5;
      props.push({
        id: `furniture_${config.depth}_${++furnitureCount}`,
        x: spot.x,
        y: spot.y,
        kind: 'furniture',
        furnitureType,
        state: 'closed',
        blocksMovement: false,
        blocksSight: false,
        ...(withCompartment ? { detectionDc: 10 + Math.floor(nextFloat() * 6) } : {}),
        ...(HIDE_SPOT_TYPES.has(furnitureType) ? { hideSpot: true } : {}),
      });
      propOccupied.add(`${spot.x},${spot.y}`);
    }
  }

  // 10. Themed Encounters (SRD-1401: regulars via CR-banded tables, bosses curated)
  const encounters: EncounterSpawnGroup[] = [];

  for (let i = 1; i < internalRooms.length; i++) {
    const room = internalRooms[i];
    const isBossRoom = i === furthestRoomIdx;

    const baseMonsterCount = isBossRoom ? 1 + (nextFloat() < 0.5 ? 1 : 0) : 1 + Math.floor(nextFloat() * 2);
    // SRD-1403 wildness: pure count scaling, standard is identity (bit-exact).
    const monsterCount = applyWildnessToMonsterCount(baseMonsterCount, wildness);

    const monsters = [];
    const usedMonsterPositions = new Set<string>();

    for (let m = 0; m < monsterCount; m++) {
      let monsterId: string;
      if (isBossRoom) {
        const bossList = theme.bossMonsters;
        monsterId = bossList[Math.floor(nextFloat() * bossList.length)]!;
      } else {
        // Weighted CR-band pick, dice-driven via the shared seeded RNG.
        const pick = pickFromBand(rngState, config.depth);
        rngState = pick.nextState;
        monsterId = pick.monsterId;
      }
      // Find empty walkable cell in room
      let spawnPt: GridPoint | undefined;
      for (let attempt = 0; attempt < 15; attempt++) {
        const cx = room.bounds.x + 1 + Math.floor(nextFloat() * (room.bounds.width - 2));
        const cy = room.bounds.y + 1 + Math.floor(nextFloat() * (room.bounds.height - 2));
        const posKey = `${cx},${cy}`;
        if (!propOccupied.has(posKey) && !usedMonsterPositions.has(posKey)) {
          spawnPt = { x: cx, y: cy };
          usedMonsterPositions.add(posKey);
          break;
        }
      }

      if (spawnPt) {
        monsters.push({
          monsterId,
          spawnX: spawnPt.x,
          spawnY: spawnPt.y,
        });
      }
    }

    // SRD-1402: at most one champion per encounter, never on depth 1.
    // The trait rides on the spawn spec; the template is applied at
    // trigger time (`triggerDungeonEncounter`) before initiative.
    if (monsters.length > 0) {
      const champRoll = rollChampionForEncounter(rngState, config.depth);
      rngState = champRoll.nextState;
      if (champRoll.isChampion && champRoll.trait) {
        const idxRes = nextRandomFloat(rngState);
        rngState = idxRes.nextState;
        const idx = Math.floor(idxRes.value * monsters.length) % monsters.length;
        monsters[idx] = { ...monsters[idx]!, championTrait: champRoll.trait };
      }
    }

    if (monsters.length > 0) {
      encounters.push({
        id: `enc_${config.depth}_room_${i}`,
        roomId: room.id,
        triggered: false,
        monsters,
        surpriseCondition: {
          monstersStealthedDc: 12 + Math.min(config.depth, 6),
        },
      });
    }
  }

  // SRD-1403 grand scope: +1 encounter monster per floor budget. Applied to the
  // first non-boss encounter (boss rooms stay curated); consumes RNG only for
  // grand scope so standard replays stay bit-exact.
  if (worldScope === 'grand' && encounters.length > 0) {
    const target = encounters.find((e) => e.roomId !== descentRoom.id) ?? encounters[0]!;
    const pick = pickFromBand(rngState, config.depth);
    rngState = pick.nextState;
    const hostRoom = internalRooms.find((r) => r.id === target.roomId);
    if (hostRoom) {
      let spawnPt: GridPoint | undefined;
      for (let attempt = 0; attempt < 15 && !spawnPt; attempt++) {
        const cx = hostRoom.bounds.x + 1 + Math.floor(nextFloat() * Math.max(1, hostRoom.bounds.width - 2));
        const cy = hostRoom.bounds.y + 1 + Math.floor(nextFloat() * Math.max(1, hostRoom.bounds.height - 2));
        const posKey = `${cx},${cy}`;
        const occupied = target.monsters.some((m) => m.spawnX === cx && m.spawnY === cy);
        if (!propOccupied.has(posKey) && !occupied) spawnPt = { x: cx, y: cy };
      }
      if (spawnPt) {
        target.monsters.push({ monsterId: pick.monsterId, spawnX: spawnPt.x, spawnY: spawnPt.y });
      }
    }
  }

  // 10b. Special Room (SRD-1404, Spec 13 §6): at most one per floor, never
  // on depth 1. Seeded pick among eligible non-entrance, non-boss rooms.
  // Depth-1 floors consume no RNG here, preserving the SRD-1403 bit-exact
  // baseline, and the pick runs after encounters so the earlier RNG stream
  // (rooms, corridors, encounters) is untouched.
  const specialRoomMarks = new Map<string, SpecialRoomKind>();
  {
    const eligibleRoomIdx: number[] = [];
    for (let i = 1; i < internalRooms.length; i++) {
      if (i === furthestRoomIdx) continue; // boss room stays curated
      eligibleRoomIdx.push(i);
    }
    if (config.depth >= 2 && eligibleRoomIdx.length > 0) {
      const specialRoll = rollSpecialRoomForFloor(rngState, config.depth, eligibleRoomIdx.length);
      rngState = specialRoll.nextState;
      if (specialRoll.kind !== undefined) {
        // SRD-1701: a vault is only vault-worthy if it has a lockable
        // threshold. Grazed rooms (corridor running alongside the wall with
        // direct room/corridor adjacency and no 1-wide threshold cell) can
        // never receive a vault gate, so re-pick among thresholded rooms
        // using the same roll (no extra RNG); if no room qualifies, skip
        // the special room for this floor.
        let resolvedKind: SpecialRoomKind | undefined = specialRoll.kind;
        let roomIdx = eligibleRoomIdx[specialRoll.eligibleIndex % eligibleRoomIdx.length]!;
        if (resolvedKind === 'vault') {
          const withEntry = eligibleRoomIdx.filter((idx) =>
            doorwayCandidates.some((c) => c.intoRoomId === internalRooms[idx]!.id),
          );
          if (withEntry.length === 0) {
            resolvedKind = undefined;
          } else {
            roomIdx = withEntry[specialRoll.eligibleIndex % withEntry.length]!;
          }
        }
        if (resolvedKind !== undefined) {
          const specialRoom = internalRooms[roomIdx]!;
          specialRoom.name = specialRoomDisplayName(resolvedKind);
          specialRoomMarks.set(specialRoom.id, resolvedKind);

        const encounterSpawnCells = new Set<string>();
        for (const e of encounters) {
          for (const m of e.monsters) encounterSpawnCells.add(`${m.spawnX},${m.spawnY}`);
        }

        if (resolvedKind === 'vault') {
          const lockDc = vaultLockDcForDepth(config.depth);
          // Lock the threshold into the vault room (prefer a free strict
          // threshold; otherwise convert an existing closed door into the
          // vault gate so the room is always actually locked).
          const vaultEntries = doorwayCandidates.filter((c) => c.intoRoomId === specialRoom.id);
          const freeEntry =
            vaultEntries.find(
              (c) =>
                !propOccupied.has(`${c.pt.x},${c.pt.y}`) &&
                !doorBlocked.has(`${c.pt.x},${c.pt.y}`) &&
                c.isStrictThreshold,
            ) ??
            vaultEntries.find(
              (c) =>
                !propOccupied.has(`${c.pt.x},${c.pt.y}`) &&
                !doorBlocked.has(`${c.pt.x},${c.pt.y}`),
            );
          if (freeEntry) {
            props.push({
              id: `vault_door_${config.depth}`,
              x: freeEntry.pt.x,
              y: freeEntry.pt.y,
              kind: 'door',
              state: 'locked',
              blocksMovement: true,
              blocksSight: true,
              lockDc,
            });
            propOccupied.add(`${freeEntry.pt.x},${freeEntry.pt.y}`);
            suppressDoorNeighbors(freeEntry.pt.x, freeEntry.pt.y);
          } else {
            const existingDoor = props.find(
              (p) =>
                p.kind === 'door' &&
                p.state === 'closed' &&
                vaultEntries.some((c) => c.pt.x === p.x && c.pt.y === p.y),
            );
            if (existingDoor) {
              existingDoor.state = 'locked';
              existingDoor.lockDc = lockDc;
            }
          }
          // Hoard chest with a magic-item bias at a free room cell.
          const hoard = rollVaultHoard(rngState, config.depth);
          rngState = hoard.nextRng;
          const chestSpot = specialRoom.cells.find(
            (pt) =>
              !propOccupied.has(`${pt.x},${pt.y}`) &&
              !encounterSpawnCells.has(`${pt.x},${pt.y}`),
          );
          if (chestSpot) {
            const trapped = nextFloat() < VAULT_TRAP_CHANCE;
            props.push({
              id: `vault_chest_${config.depth}`,
              x: chestSpot.x,
              y: chestSpot.y,
              kind: 'chest',
              state: 'locked',
              blocksMovement: false,
              blocksSight: false,
              lockDc,
              lootTable: hoard.loot,
              ...(trapped
                ? {
                    detectionDc: theme.trapType.detectionDc,
                    disarmDc: theme.trapType.disarmDc,
                    trapDamageFormula: theme.trapType.damageFormula,
                    trapDamageType: theme.trapType.damageType,
                    trapSaveDc: theme.trapType.dc,
                    trapSaveAbility: theme.trapType.saveAbility,
                    trapHalfDamageOnSave: true,
                  }
                : {}),
            });
            propOccupied.add(`${chestSpot.x},${chestSpot.y}`);
          }
        } else if (resolvedKind === 'cursed_shrine') {
          const centerKey = `${specialRoom.center.x},${specialRoom.center.y}`;
          const centerFree = !propOccupied.has(centerKey) && !encounterSpawnCells.has(centerKey);
          const shrineSpot = centerFree
            ? specialRoom.center
            : specialRoom.cells.find(
                (pt) =>
                  !propOccupied.has(`${pt.x},${pt.y}`) &&
                  !encounterSpawnCells.has(`${pt.x},${pt.y}`),
              );
          if (shrineSpot) {
            props.push({
              id: `cursed_shrine_${config.depth}`,
              x: shrineSpot.x,
              y: shrineSpot.y,
              kind: 'shrine',
              shrineType: CURSED_SHRINE_TYPE,
              state: 'closed',
              blocksMovement: false,
              blocksSight: false,
            });
            propOccupied.add(`${shrineSpot.x},${shrineSpot.y}`);
          }
        } else {
          // Nest: replace (or create) the room encounter with a 3–5 pack of
          // one band monster, with bonus XP via the existing award path.
          // Nests are listenable per SRD-511 because their encounters sit in
          // rooms neighboring the doors heroes listen at.
          const nestPack = rollNestPack(rngState, config.depth);
          rngState = nestPack.nextState;
          const occupiedForNest = new Set<string>([...propOccupied]);
          const existing = encounters.find((e) => e.roomId === specialRoom.id);
          if (existing) {
            for (const m of existing.monsters) occupiedForNest.delete(`${m.spawnX},${m.spawnY}`);
          }
          const freeCells = specialRoom.cells.filter(
            (pt) => !occupiedForNest.has(`${pt.x},${pt.y}`),
          );
          const placed: { monsterId: string; spawnX: number; spawnY: number }[] = [];
          for (let n = 0; n < nestPack.packSize && freeCells.length > 0; n++) {
            const pickIdx = Math.floor(nextFloat() * freeCells.length) % freeCells.length;
            const cell = freeCells.splice(pickIdx, 1)[0]!;
            placed.push({ monsterId: nestPack.monsterId, spawnX: cell.x, spawnY: cell.y });
          }
          if (placed.length > 0) {
            if (existing) {
              existing.monsters = placed;
              existing.xpMultiplier = NEST_XP_MULTIPLIER;
            } else {
              encounters.push({
                id: `enc_${config.depth}_${specialRoom.id}_nest`,
                roomId: specialRoom.id,
                triggered: false,
                monsters: placed,
                xpMultiplier: NEST_XP_MULTIPLIER,
                surpriseCondition: {
                  monstersStealthedDc: 12 + Math.min(config.depth, 6),
                },
              });
            }
          }
        }
        }
      }
    }
  }

  // 11. Biome Hazards & Decorative Tiles
  // SRD-1404: special rooms are placed first (section 10b above) so hazard
  // scatter avoids the new vault/cursed-shrine prop cells via propOccupied.
  if (theme.hazardTerrain) {
    for (let i = 1; i < internalRooms.length; i++) {
      const room = internalRooms[i];
      // Hazard cells on 8-15% of non-essential room tiles
      const hazardCount = Math.floor(room.cells.length * 0.1);
      for (let h = 0; h < hazardCount; h++) {
        const pt = room.cells[Math.floor(nextFloat() * room.cells.length)];
        const key = `${pt.x},${pt.y}`;
        // Never put hazards on center or prop cells
        if (
          !propOccupied.has(key) &&
          !isSamePoint(pt, room.center) &&
          !partySpawnCells.some((sp) => isSamePoint(sp, pt))
        ) {
          const c = cellMap.get(key);
          if (c) {
            c.terrain = theme.hazardTerrain;
          }
        }
      }
    }
  }

  // 12. Full Dense Grid Generation (Filling uncarved void cells with wall_solid)
  const fullCells: DungeonCellSpec[] = [];
  for (let y = 0; y < floorHeight; y++) {
    for (let x = 0; x < floorWidth; x++) {
      const key = `${x},${y}`;
      const existing = cellMap.get(key);
      if (existing) {
        fullCells.push(existing);
      } else {
        fullCells.push({
          x,
          y,
          terrain: 'wall_solid',
          baseLight: 'darkness',
          elevationFeet: 0,
        });
      }
    }
  }

  // 13. Room Specs (+ SRD-1213 recall tags from seeded theme tables).
  // Recall tags are a pure function of (floorId, seed, room id, theme) via
  // fnv1a hashing — they never consume the generation RNG, so bit-exact
  // replay of `generateDungeonFloor` (including `nextRngState`) stays green.
  const allEncounterMonsterIds = encounters.flatMap((e) => e.monsters.map((m) => m.monsterId));
  const recallTagsByRoom = generateFloorRecallTags({
    floorId,
    seed: config.seed,
    rooms: internalRooms.map((r) => ({ id: r.id, name: r.name })),
    monsterIds: allEncounterMonsterIds,
    depth: config.depth,
  });
  const roomSpecs: DungeonRoomSpec[] = internalRooms.map((r, idx) => ({
    id: r.id,
    name: r.name,
    description: `A chamber in ${theme.name}.`,
    isSafeRoom: idx === 0,
    lighting: theme.defaultLight,
    bounds: {
      x: r.bounds.x,
      y: r.bounds.y,
      width: r.bounds.width,
      height: r.bounds.height,
    },
    // SRD-1404: tag the floor's single special room, if any.
    ...(specialRoomMarks.get(r.id) ? { specialRoom: specialRoomMarks.get(r.id)! } : {}),
    ...(recallTagsByRoom[r.id] ? { recallTags: recallTagsByRoom[r.id] } : {}),
  }));

  const floor: DungeonFloorSpec = {
    id: floorId,
    name: `${theme.name} — Depth ${config.depth}`,
    width: floorWidth,
    height: floorHeight,
    partySpawnCells,
    cells: fullCells,
    props,
    encounters,
    rooms: roomSpecs,
  };

  // 14. Validation
  DungeonFloorSpecSchema.parse(floor);

  const connectivity = verifyDungeonConnectivity(floor);
  if (!connectivity.isFullyConnected) {
    throw new Error(
      `Procedural floor generation failed connectivity verification for seed ${config.seed}, depth ${config.depth}: ${connectivity.unreachableRooms.join(', ')}`,
    );
  }

  return {
    floor,
    biome,
    depth: config.depth,
    seed: config.seed,
    nextRngState: rngState,
    stairsUp,
    stairsDown,
    keyLocation,
  };
}
