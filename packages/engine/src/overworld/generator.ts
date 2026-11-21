import {
  type OverworldCoord,
  type OverworldGenerationConfig,
  type OverworldGenerationConfigInput,
  type OverworldMap,
  type OverworldPOI,
  type OverworldPOIKind,
  type OverworldTile,
  type OverworldTerrainType,
  OverworldGenerationConfigSchema,
  OverworldMapSchema,
  OVERWORLD_EDGE_DIRECTIONS,
  getOverworldMovementCost,
  getOverworldTile,
  overworldTileKey,
} from './schemas.js';
import { normalizeSeed, nextRandomFloat, nextRandomUint32 } from '../dice/prng.js';
import { applyScopeToOverworldSize } from '../world-options.js';

/**
 * Procedural Overworld Map Generator (`OverworldMap`, Spec 06 Section 4.1).
 *
 * Implements:
 * 1. Seeded fractal value-noise elevation field with continental edge falloff.
 * 2. Downhill river carving from highland sources to the sea (symmetric river edges).
 * 3. Latitude temperature + noise moisture climate fields (river/ocean humidity bonuses).
 * 4. Biome classification into the 9 canonical overworld terrains.
 * 5. Settlement site selection on the largest connected landmass.
 * 6. MST + loop road network routed by movement-cost Dijkstra (river-crossing penalty).
 * 7. Wilderness POIs: dungeon entrances (with delve seeds), ancient shrines, monster lairs.
 * 8. Guaranteed land connectivity between all settlement sites, validated before emit.
 *
 * Architectural invariant: every random choice threads the seeded Mulberry32
 * PRNG state; `Math.random()` is never called.
 */

/**
 * Generated world result package.
 */
export interface GeneratedOverworldMap {
  map: OverworldMap;
  seed: number;
  nextRngState: number;
  /** Candidate settlement locations promoted to towns/capitals by SRD-803. */
  settlementSites: OverworldCoord[];
  /** Carved river courses (highland source -> sea/lake terminus), for debugging & UI. */
  riverPaths: OverworldCoord[][];
}

/**
 * Connectivity verification report for a generated world.
 */
export interface OverworldConnectivityReport {
  isFullyConnected: boolean;
  reachableSites: OverworldCoord[];
  unreachableSites: OverworldCoord[];
  roadsConnected: boolean;
}

// ---------------------------------------------------------------------------
// Deterministic value noise
// ---------------------------------------------------------------------------

/**
 * Pure integer hash of a lattice point -> uniform float in [0, 1).
 */
function latticeHash(seed: number, x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * Bilinear-interpolated value noise at fractional coordinates.
 */
function valueNoise2D(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);
  const v00 = latticeHash(seed, x0, y0);
  const v10 = latticeHash(seed, x0 + 1, y0);
  const v01 = latticeHash(seed, x0, y0 + 1);
  const v11 = latticeHash(seed, x0 + 1, y0 + 1);
  const top = v00 + (v10 - v00) * tx;
  const bottom = v01 + (v11 - v01) * tx;
  return top + (bottom - top) * ty;
}

/**
 * Fractal Brownian motion: 4 octaves of value noise, normalized to [0, 1].
 */
function fbm2D(seed: number, x: number, y: number, octaves = 4): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amplitude * valueNoise2D(seed + o * 1013, x * frequency, y * frequency);
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------
// Terrain classification
// ---------------------------------------------------------------------------

/**
 * Classifies a macro tile into one of the 9 overworld terrains from its
 * elevation, temperature (0 cold .. 1 hot), moisture (0 arid .. 1 soaked),
 * and coastal adjacency. Pure and exported for unit testing.
 */
export function classifyOverworldTerrain(opts: {
  elevation: number;
  temperature: number;
  moisture: number;
  seaLevel: number;
  adjacentToOcean: boolean;
}): OverworldTerrainType {
  const { elevation, temperature, moisture, seaLevel, adjacentToOcean } = opts;
  if (elevation < seaLevel) return 'ocean';
  if (adjacentToOcean && elevation < seaLevel + 0.06) return 'coast';
  if (elevation >= 0.82) return 'mountains';
  if (elevation >= 0.68) return 'hills';
  if (temperature <= 0.22) return 'tundra';
  if (temperature >= 0.6 && moisture <= 0.33) return 'desert';
  if (moisture >= 0.66 && elevation <= seaLevel + 0.14) return 'swamp';
  if (moisture >= 0.45) return 'forest';
  return 'plains';
}

// ---------------------------------------------------------------------------
// Pathfinding (movement-cost Dijkstra with river-crossing penalty)
// ---------------------------------------------------------------------------

interface OverworldPathResult {
  path: OverworldCoord[];
  cost: number;
}

/** Minimal binary min-heap keyed by accumulated travel cost. */
class CostHeap {
  private items: Array<{ key: string; cost: number }> = [];

  get size(): number {
    return this.items.length;
  }

  push(key: string, cost: number): void {
    const items = this.items;
    items.push({ key, cost });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].cost <= items[i].cost) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop(): { key: string; cost: number } | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && items[left].cost < items[smallest].cost) smallest = left;
        if (right < items.length && items[right].cost < items[smallest].cost) smallest = right;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

/**
 * Finds the cheapest overland path between two macro tiles. Ocean tiles are
 * impassable; fording an unbridged river edge adds +2 movement cost, while an
 * intact `bridge` POI waives the river-crossing penalty (+0).
 * Returns null when no land route exists.
 */
export function findOverworldPath(
  map: OverworldMap,
  start: OverworldCoord,
  goal: OverworldCoord,
): OverworldPathResult | null {
  const startTile = getOverworldTile(map, start.q, start.r);
  const goalTile = getOverworldTile(map, goal.q, goal.r);
  if (!startTile || !goalTile) return null;
  if (startTile.terrain === 'ocean' || goalTile.terrain === 'ocean') return null;
  if (start.q === goal.q && start.r === goal.r) return { path: [{ ...start }], cost: 0 };

  const hasIntactBridge = (tile: OverworldTile): boolean => {
    if (!tile.poiId) return false;
    const poi = map.pois[tile.poiId];
    return poi?.kind === 'bridge' && poi.strategicStatus !== 'destroyed';
  };

  const startKey = overworldTileKey(start.q, start.r);
  const goalKey = overworldTileKey(goal.q, goal.r);
  const dist = new Map<string, number>([[startKey, 0]]);
  const cameFrom = new Map<string, string>();
  const heap = new CostHeap();
  heap.push(startKey, 0);

  while (heap.size > 0) {
    const current = heap.pop()!;
    if (current.cost > (dist.get(current.key) ?? Infinity)) continue;
    if (current.key === goalKey) {
      const path: OverworldCoord[] = [];
      let stepKey: string | undefined = goalKey;
      while (stepKey !== undefined) {
        const [q, r] = stepKey.split(',').map(Number);
        path.unshift({ q, r });
        stepKey = cameFrom.get(stepKey);
      }
      return { path, cost: current.cost };
    }

    const [cq, cr] = current.key.split(',').map(Number);
    const currentTile = map.tiles[current.key];
    for (let e = 0; e < OVERWORLD_EDGE_DIRECTIONS.length; e++) {
      const dir = OVERWORLD_EDGE_DIRECTIONS[e];
      const nq = cq + dir.q;
      const nr = cr + dir.r;
      const neighbor = getOverworldTile(map, nq, nr);
      if (!neighbor || neighbor.terrain === 'ocean') continue;
      const crossesRiver = currentTile.riverEdges?.includes(e) ?? false;
      const riverPenalty =
        crossesRiver && !hasIntactBridge(currentTile) && !hasIntactBridge(neighbor) ? 2 : 0;
      const nextCost = current.cost + neighbor.movementCost + riverPenalty;
      const nKey = overworldTileKey(nq, nr);
      if (nextCost < (dist.get(nKey) ?? Infinity)) {
        dist.set(nKey, nextCost);
        cameFrom.set(nKey, current.key);
        heap.push(nKey, nextCost);
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Connectivity verification
// ---------------------------------------------------------------------------

/**
 * Validates that every settlement site lies on the same connected landmass
 * and that the road network links all sites. Mirrors the SRD-508 guaranteed
 * BFS connectivity contract for the macro map.
 */
export function verifyOverworldConnectivity(
  map: OverworldMap,
  settlementSites: OverworldCoord[],
): OverworldConnectivityReport {
  const reachableSites: OverworldCoord[] = [];
  const unreachableSites: OverworldCoord[] = [];

  if (settlementSites.length === 0) {
    return { isFullyConnected: true, reachableSites, unreachableSites, roadsConnected: true };
  }

  // BFS over passable (non-ocean) land from the first site.
  const origin = settlementSites[0];
  const visited = new Set<string>([overworldTileKey(origin.q, origin.r)]);
  const queue: OverworldCoord[] = [origin];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const dir of OVERWORLD_EDGE_DIRECTIONS) {
      const nq = curr.q + dir.q;
      const nr = curr.r + dir.r;
      const neighbor = getOverworldTile(map, nq, nr);
      const key = overworldTileKey(nq, nr);
      if (neighbor && neighbor.terrain !== 'ocean' && !visited.has(key)) {
        visited.add(key);
        queue.push({ q: nq, r: nr });
      }
    }
  }

  for (const site of settlementSites) {
    if (visited.has(overworldTileKey(site.q, site.r))) {
      reachableSites.push(site);
    } else {
      unreachableSites.push(site);
    }
  }

  // BFS restricted to road tiles: every site must sit on one road network.
  // When no roads exist (roadsEnabled: false), road connectivity is vacuous.
  let roadsConnected = true;
  const hasRoads = Object.values(map.tiles).some((t) => t.roadThrough === true);
  const roadSites = settlementSites.filter(
    (s) => getOverworldTile(map, s.q, s.r)?.roadThrough === true,
  );
  if (hasRoads && roadSites.length !== settlementSites.length) {
    roadsConnected = false;
  } else if (hasRoads && roadSites.length > 1) {
    const roadVisited = new Set<string>([overworldTileKey(roadSites[0].q, roadSites[0].r)]);
    const roadQueue: OverworldCoord[] = [roadSites[0]];
    while (roadQueue.length > 0) {
      const curr = roadQueue.shift()!;
      for (const dir of OVERWORLD_EDGE_DIRECTIONS) {
        const nq = curr.q + dir.q;
        const nr = curr.r + dir.r;
        const neighbor = getOverworldTile(map, nq, nr);
        const key = overworldTileKey(nq, nr);
        if (neighbor?.roadThrough === true && !roadVisited.has(key)) {
          roadVisited.add(key);
          roadQueue.push({ q: nq, r: nr });
        }
      }
    }
    roadsConnected = roadSites.every((s) => roadVisited.has(overworldTileKey(s.q, s.r)));
  }

  return {
    isFullyConnected: unreachableSites.length === 0 && roadsConnected,
    reachableSites,
    unreachableSites,
    roadsConnected,
  };
}

// ---------------------------------------------------------------------------
// Name generation
// ---------------------------------------------------------------------------

const WORLD_NAME_PREFIXES = [
  'Ash', 'Ember', 'Raven', 'Storm', 'Thorn', 'Wyrm',
  'Frost', 'Gloom', 'Star', 'Iron', 'Mist', 'Sun',
];
const WORLD_NAME_SUFFIXES = [
  'moor', 'reach', 'vale', 'march', 'fell', 'gard',
  'hollow', 'watch', 'mere', 'spire',
];
const DUNGEON_NAME_PREFIXES = ['Sunken', 'Forgotten', 'Whispering', 'Broken', 'Shadowed', 'Ancient'];
const DUNGEON_NAME_NOUNS = ['Barrow', 'Crypt', 'Delve', 'Catacomb', 'Undercroft', 'Tomb'];
const SHRINE_ASPECTS = ['the Moon', 'the Wild', 'Forgotten Kings', 'the Deep', 'the Flame', 'the Weave'];
const LAIR_NAMES = ['Gloomfang', 'Rotmaw', 'Ashclaw', 'Dreadwing', 'Stonehide', 'Nightcoil'];

// ---------------------------------------------------------------------------
// World generation
// ---------------------------------------------------------------------------

/**
 * Generates a complete procedural overworld map (SRD-801).
 */
export function generateOverworldMap(
  rawConfig: OverworldGenerationConfigInput,
): GeneratedOverworldMap {
  const config: OverworldGenerationConfig = OverworldGenerationConfigSchema.parse(rawConfig);
  let rngState = normalizeSeed(config.seed);

  // SRD-1403: grand scope widens the map; standard is bit-exact.
  const scoped = applyScopeToOverworldSize(
    { width: config.width, height: config.height },
    config.worldOptions?.scope ?? 'standard',
  );

  function nextFloat(): number {
    const res = nextRandomFloat(rngState);
    rngState = res.nextState;
    return res.value;
  }

  function nextUint32(): number {
    const res = nextRandomUint32(rngState);
    rngState = res.nextState;
    return res.value;
  }

  const { seaLevel } = config;
  const width = scoped.width;
  const height = scoped.height;
  const tileCount = width * height;

  const elevationSeed = nextUint32();
  const moistureSeed = nextUint32();
  const temperatureSeed = nextUint32();

  // 1. Elevation field: fractal noise + continental falloff toward map edges
  //    so oceans fringe the world and a central landmass emerges.
  const elevation = new Float64Array(tileCount);
  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) {
      const nx = q / (width - 1) - 0.5;
      const ny = r / (height - 1) - 0.5;
      const edgeDist = Math.max(Math.abs(nx), Math.abs(ny)) * 2; // 0 center .. 1 border
      const falloff = Math.pow(edgeDist, 2.2) * 0.6;
      const base = fbm2D(elevationSeed, q / 14, r / 14);
      elevation[r * width + q] = clamp01(base + 0.1 - falloff);
    }
  }

  // Guarantee a playable landmass: if the sea swallowed too much of the map,
  // uniformly lower the elevation field (deterministic auto-heal).
  let landFraction = 0;
  for (let shift = 0; shift <= 6; shift++) {
    let landCount = 0;
    for (let i = 0; i < tileCount; i++) {
      if (elevation[i] >= seaLevel) landCount++;
    }
    landFraction = landCount / tileCount;
    if (landFraction >= 0.2) break;
    if (shift === 6) {
      throw new Error(
        `Overworld generation failed to produce a viable landmass for seed ${config.seed} (land fraction ${landFraction.toFixed(3)})`,
      );
    }
    for (let i = 0; i < tileCount; i++) {
      elevation[i] = clamp01(elevation[i] - 0.05);
    }
  }

  const elevAt = (q: number, r: number): number => elevation[r * width + q];
  const inBounds = (q: number, r: number): boolean => q >= 0 && q < width && r >= 0 && r < height;

  // 2. Rivers: continuous downhill-biased courses from highland sources all the
  //    way to the ocean (or merging into an existing river), never dead-ending
  //    in shallow local elevation dips.
  const riverEdgeSets: Array<Set<number>> = Array.from({ length: tileCount }, () => new Set<number>());
  const riverPaths: OverworldCoord[][] = [];
  const riverTiles = new Set<string>();
  const riverCount =
    config.riverCount ?? Math.min(8, Math.max(3, Math.floor(tileCount / 600)));

  if (riverCount > 0) {
    let sourceCandidates: OverworldCoord[] = [];
    for (let r = 0; r < height; r++) {
      for (let q = 0; q < width; q++) {
        if (elevAt(q, r) >= Math.max(0.62, seaLevel + 0.22)) {
          sourceCandidates.push({ q, r });
        }
      }
    }
    // Fallback: the highest land tiles when no true highlands exist.
    if (sourceCandidates.length === 0) {
      const landTiles: OverworldCoord[] = [];
      for (let r = 0; r < height; r++) {
        for (let q = 0; q < width; q++) {
          if (elevAt(q, r) >= seaLevel) landTiles.push({ q, r });
        }
      }
      landTiles.sort((a, b) => elevAt(b.q, b.r) - elevAt(a.q, a.r));
      sourceCandidates = landTiles.slice(0, 12);
    }

    const usedSources = new Set<string>();
    const minSourceSpacing = Math.max(5, Math.floor(Math.min(width, height) / 6));

    const routeRiverToSea = (start: OverworldCoord): OverworldCoord[] | null => {
      const startKey = overworldTileKey(start.q, start.r);
      const dist = new Map<string, number>([[startKey, 0]]);
      const cameFrom = new Map<string, string>();
      const heap = new CostHeap();
      heap.push(startKey, 0);

      let terminusKey: string | null = null;
      while (heap.size > 0) {
        const cur = heap.pop()!;
        if (cur.cost > (dist.get(cur.key) ?? Infinity)) continue;
        const [cq, cr] = cur.key.split(',').map(Number);

        // Stop as soon as the river reaches the ocean
        if (cur.key !== startKey && elevAt(cq, cr) < seaLevel) {
          terminusKey = cur.key;
          break;
        }

        const cElev = elevAt(cq, cr);
        for (let e = 0; e < OVERWORLD_EDGE_DIRECTIONS.length; e++) {
          const dir = OVERWORLD_EDGE_DIRECTIONS[e];
          const nq = cq + dir.q;
          const nr = cr + dir.r;
          if (!inBounds(nq, nr)) continue;
          const nKey = overworldTileKey(nq, nr);
          const nElev = elevAt(nq, nr);
          // Strongly prefer downhill flow, but allow carving through shallow local basins
          // so every river reaches the ocean or joins a larger river.
          const uphillPenalty = nElev >= cElev ? (nElev - cElev) * 14 + 0.35 : 0;
          const meanderBias = ((nq * 31 + nr * 17 + config.seed) & 7) * 0.015;
          const stepCost = 0.1 + uphillPenalty + meanderBias;
          const nextCost = cur.cost + stepCost;
          if (nextCost < (dist.get(nKey) ?? Infinity)) {
            dist.set(nKey, nextCost);
            cameFrom.set(nKey, cur.key);
            heap.push(nKey, nextCost);
          }
        }
      }

      if (!terminusKey) return null;
      const path: OverworldCoord[] = [];
      let step: string | undefined = terminusKey;
      while (step !== undefined) {
        const [q, r] = step.split(',').map(Number);
        path.unshift({ q, r });
        step = cameFrom.get(step);
      }
      return path;
    };

    for (let riverIdx = 0; riverIdx < riverCount; riverIdx++) {
      // Pick a spread-out highland source not already on an existing river.
      let source: OverworldCoord | undefined;
      for (let attempt = 0; attempt < 32; attempt++) {
        if (sourceCandidates.length === 0) break;
        const cand = sourceCandidates[Math.floor(nextFloat() * sourceCandidates.length)];
        const candKey = overworldTileKey(cand.q, cand.r);
        if (usedSources.has(candKey) || riverTiles.has(candKey)) continue;
        let tooClose = false;
        for (const usedKey of usedSources) {
          const [uq, ur] = usedKey.split(',').map(Number);
          if (Math.abs(uq - cand.q) + Math.abs(ur - cand.r) < minSourceSpacing) {
            tooClose = true;
            break;
          }
        }
        if (!tooClose || attempt >= 20) {
          source = cand;
          usedSources.add(candKey);
          break;
        }
      }
      if (!source) continue;

      const path = routeRiverToSea(source);
      if (!path || path.length < 2) continue;

      // Erode a gentle monotonic downhill valley along the carved river channel
      // so water always strictly flows downhill without turning land into ocean.
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]!;
        const b = path[i]!;
        const aIdx = a.r * width + a.q;
        const bIdx = b.r * width + b.q;
        const prevElev = elevation[aIdx]!;
        const curElev = elevation[bIdx]!;
        const isLast = i === path.length - 1;
        if (curElev >= prevElev) {
          const floorElev = isLast && curElev < seaLevel ? 0 : seaLevel;
          const remaining = path.length - i;
          const drop = Math.min(0.002, Math.max(0.00001, (prevElev - floorElev) / (remaining + 1)));
          elevation[bIdx] = Math.max(floorElev + 0.00001, prevElev - drop);
        }
      }

      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i]!;
        const b = path[i + 1]!;
        const dirIdx = OVERWORLD_EDGE_DIRECTIONS.findIndex(
          (d) => a.q + d.q === b.q && a.r + d.r === b.r,
        );
        if (dirIdx !== -1) {
          riverEdgeSets[a.r * width + a.q].add(dirIdx);
          riverEdgeSets[b.r * width + b.q].add((dirIdx + 2) % 4);
        }
        riverTiles.add(overworldTileKey(a.q, a.r));
      }
      const last = path[path.length - 1]!;
      riverTiles.add(overworldTileKey(last.q, last.r));
      riverPaths.push(path);
    }
  }

  // River humidity bonus: river tiles and their banks are wetter.
  const riverMoistureBonus = new Float64Array(tileCount);
  for (const path of riverPaths) {
    for (const pt of path) {
      riverMoistureBonus[pt.r * width + pt.q] += 0.25;
      for (const dir of OVERWORLD_EDGE_DIRECTIONS) {
        const nq = pt.q + dir.q;
        const nr = pt.r + dir.r;
        if (inBounds(nq, nr)) {
          riverMoistureBonus[nr * width + nq] += 0.12;
        }
      }
    }
  }

  // Ocean proximity humidity: multi-source BFS distance from all sea tiles.
  const oceanDist = new Int32Array(tileCount).fill(-1);
  const oceanQueue: number[] = [];
  for (let i = 0; i < tileCount; i++) {
    if (elevation[i] < seaLevel) {
      oceanDist[i] = 0;
      oceanQueue.push(i);
    }
  }
  for (let head = 0; head < oceanQueue.length; head++) {
    const idx = oceanQueue[head];
    const cq = idx % width;
    const cr = Math.floor(idx / width);
    for (const dir of OVERWORLD_EDGE_DIRECTIONS) {
      const nq = cq + dir.q;
      const nr = cr + dir.r;
      if (!inBounds(nq, nr)) continue;
      const nIdx = nr * width + nq;
      if (oceanDist[nIdx] === -1) {
        oceanDist[nIdx] = oceanDist[idx] + 1;
        oceanQueue.push(nIdx);
      }
    }
  }

  // 3. Climate fields + 4. Biome classification.
  const tiles: OverworldTile[] = new Array(tileCount);

  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) {
      const idx = r * width + q;
      const elev = elevation[idx];

      // Latitude gradient: north (r = 0) cold, south hot; altitude cools.
      const tempNoise = fbm2D(temperatureSeed, q / 16, r / 16);
      const temperature = clamp01(
        r / (height - 1) + (tempNoise - 0.5) * 0.3 - elev * 0.3 + config.temperatureBias,
      );

      const moistNoise = fbm2D(moistureSeed, q / 11, r / 11);
      const seaDist = oceanDist[idx];
      const seaBonus = seaDist > 0 ? Math.max(0, 0.25 - seaDist * 0.06) : 0;
      const moisture = clamp01(
        moistNoise + riverMoistureBonus[idx] + seaBonus + config.moistureBias,
      );

      const adjacentToOcean = OVERWORLD_EDGE_DIRECTIONS.some((dir) => {
        const nq = q + dir.q;
        const nr = r + dir.r;
        return inBounds(nq, nr) && elevAt(nq, nr) < seaLevel;
      });

      const terrain = classifyOverworldTerrain({
        elevation: elev,
        temperature,
        moisture,
        seaLevel,
        adjacentToOcean,
      });

      const riverEdges = riverEdgeSets[idx];
      tiles[idx] = {
        q,
        r,
        terrain,
        movementCost: getOverworldMovementCost(terrain),
        elevation: elev,
        ...(riverEdges.size > 0 ? { riverEdges: [...riverEdges].sort((a, b) => a - b) } : {}),
      };
    }
  }

  const tileMap: Record<string, OverworldTile> = {};
  for (const tile of tiles) {
    tileMap[overworldTileKey(tile.q, tile.r)] = tile;
  }

  // 5. Largest connected landmass (BFS over non-ocean tiles).
  const componentOf = new Int32Array(tileCount).fill(-1);
  let largestComponent: number[] = [];
  let componentId = 0;
  for (let i = 0; i < tileCount; i++) {
    if (componentOf[i] !== -1 || tiles[i].terrain === 'ocean') continue;
    const members: number[] = [];
    const queue: number[] = [i];
    componentOf[i] = componentId;
    for (let head = 0; head < queue.length; head++) {
      const idx = queue[head];
      members.push(idx);
      const cq = idx % width;
      const cr = Math.floor(idx / width);
      for (const dir of OVERWORLD_EDGE_DIRECTIONS) {
        const nq = cq + dir.q;
        const nr = cr + dir.r;
        if (!inBounds(nq, nr)) continue;
        const nIdx = nr * width + nq;
        if (componentOf[nIdx] === -1 && tiles[nIdx].terrain !== 'ocean') {
          componentOf[nIdx] = componentId;
          queue.push(nIdx);
        }
      }
    }
    if (members.length > largestComponent.length) {
      largestComponent = members;
    }
    componentId++;
  }

  const landTileOf = (idx: number): OverworldTile => tiles[idx];
  const isRiverAdjacent = (q: number, r: number): boolean => {
    const idx = r * width + q;
    if (riverEdgeSets[idx].size > 0) return true;
    return OVERWORLD_EDGE_DIRECTIONS.some((dir) => {
      const nq = q + dir.q;
      const nr = r + dir.r;
      return inBounds(nq, nr) && riverEdgeSets[nr * width + nq].size > 0;
    });
  };

  // Settlement site candidates: hospitable terrain on the main landmass.
  const siteTerrainScores: Partial<Record<OverworldTerrainType, number>> = {
    plains: 3,
    coast: 2.5,
    forest: 1.5,
    hills: 1,
  };
  interface SiteCandidate {
    coord: OverworldCoord;
    score: number;
  }
  const siteCandidates: SiteCandidate[] = [];
  for (const idx of largestComponent) {
    const tile = landTileOf(idx);
    const baseScore = siteTerrainScores[tile.terrain];
    if (baseScore === undefined) continue;
    const score =
      baseScore +
      (isRiverAdjacent(tile.q, tile.r) ? 1.5 : 0) +
      nextFloat() * 0.5;
    siteCandidates.push({ coord: { q: tile.q, r: tile.r }, score });
  }
  siteCandidates.sort((a, b) => b.score - a.score);

  const settlementSites: OverworldCoord[] = [];
  const minSiteSpacing = Math.max(4, Math.floor(Math.min(width, height) / 8));
  let spacing = minSiteSpacing;

  if (siteCandidates.length > 0) {
    settlementSites.push({ ...siteCandidates[0].coord });
    const selectedKeys = new Set<string>([
      overworldTileKey(siteCandidates[0].coord.q, siteCandidates[0].coord.r),
    ]);

    while (settlementSites.length < config.settlementSiteCount) {
      let best: SiteCandidate | undefined;
      let bestValue = -Infinity;
      for (const cand of siteCandidates) {
        const candKey = overworldTileKey(cand.coord.q, cand.coord.r);
        if (selectedKeys.has(candKey)) continue;
        let minDist = Infinity;
        for (const site of settlementSites) {
          const d = Math.hypot(cand.coord.q - site.q, cand.coord.r - site.r);
          if (d < minDist) minDist = d;
        }
        if (minDist < spacing) continue;
        const value = minDist + cand.score * 0.25;
        if (value > bestValue) {
          bestValue = value;
          best = cand;
        }
      }
      if (!best) {
        if (spacing > 2) {
          spacing = Math.max(2, Math.floor(spacing / 2));
          continue;
        }
        break; // landmass too small for more sites
      }
      settlementSites.push({ ...best.coord });
      selectedKeys.add(overworldTileKey(best.coord.q, best.coord.r));
    }
  }

  // Assemble the map object early so road routing can use findOverworldPath.
  const worldName =
    config.worldName ??
    `${WORLD_NAME_PREFIXES[Math.floor(nextFloat() * WORLD_NAME_PREFIXES.length)]}${
      WORLD_NAME_SUFFIXES[Math.floor(nextFloat() * WORLD_NAME_SUFFIXES.length)]
    }`;

  const map: OverworldMap = {
    worldSeed: config.seed,
    worldName,
    width,
    height,
    tiles: tileMap,
    pois: {},
    factions: {},
  };

  // 6. Road network: MST over settlement sites + one loop, routed by
  //    movement-cost Dijkstra so roads prefer cheap terrain and easy fords.
  if (config.roadsEnabled && settlementSites.length >= 2) {
    interface SiteEdge {
      u: number;
      v: number;
      weight: number;
      path: OverworldCoord[];
    }
    const siteEdges: SiteEdge[] = [];
    for (let i = 0; i < settlementSites.length; i++) {
      for (let j = i + 1; j < settlementSites.length; j++) {
        const routed = findOverworldPath(map, settlementSites[i], settlementSites[j]);
        if (routed) {
          siteEdges.push({ u: i, v: j, weight: routed.cost, path: routed.path });
        }
      }
    }
    siteEdges.sort((a, b) => a.weight - b.weight);

    // Kruskal's MST (same pattern as the SRD-508 corridor network).
    const parent = Array.from({ length: settlementSites.length }, (_, i) => i);
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

    const roadEdges: SiteEdge[] = [];
    const spareEdges: SiteEdge[] = [];
    for (const edge of siteEdges) {
      if (unionRoots(edge.u, edge.v)) {
        roadEdges.push(edge);
      } else {
        spareEdges.push(edge);
      }
    }
    if (spareEdges.length > 0) {
      roadEdges.push(spareEdges[0]); // one loop for route variety
    }

    for (const edge of roadEdges) {
      for (const pt of edge.path) {
        const tile = map.tiles[overworldTileKey(pt.q, pt.r)];
        tile.roadThrough = true;
      }
    }
  }

  // 7. Wilderness POIs: dungeon entrances, ancient shrines, monster lairs.
  const usedNames = new Set<string>();
  function uniqueName(base: string): string {
    let name = base;
    let suffix = 2;
    while (usedNames.has(name)) {
      name = `${base} ${suffix === 2 ? 'II' : suffix === 3 ? 'III' : suffix}`;
      suffix++;
    }
    usedNames.add(name);
    return name;
  }

  const poiTerrainPreferences: Record<string, OverworldTerrainType[]> = {
    dungeon_entrance: ['mountains', 'hills', 'forest'],
    ancient_shrine: ['forest', 'plains', 'hills', 'coast', 'tundra', 'desert', 'swamp', 'mountains'],
    monster_lair: ['forest', 'swamp', 'mountains', 'hills', 'tundra', 'desert'],
  };

  const poiPlan: Array<{ kind: OverworldPOIKind; count: number }> = [
    { kind: 'dungeon_entrance', count: config.dungeonEntranceCount },
    { kind: 'ancient_shrine', count: config.ancientShrineCount },
    { kind: 'monster_lair', count: config.monsterLairCount },
  ];

  const placedPoiKeys = new Set<string>();
  let poiCounter = 0;

  function isFarEnoughFromPoisAndSites(q: number, r: number): boolean {
    for (const site of settlementSites) {
      if (Math.abs(site.q - q) + Math.abs(site.r - r) < 3) return false;
    }
    for (const key of placedPoiKeys) {
      const [pq, pr] = key.split(',').map(Number);
      if (Math.abs(pq - q) + Math.abs(pr - r) < 4) return false;
    }
    return true;
  }

  for (const { kind, count } of poiPlan) {
    const preferred = poiTerrainPreferences[kind];
    for (let n = 0; n < count; n++) {
      let chosen: OverworldTile | undefined;
      // First pass: preferred terrain; second pass: any land tile.
      for (let pass = 0; pass < 2 && !chosen; pass++) {
        for (let attempt = 0; attempt < 40; attempt++) {
          if (largestComponent.length === 0) break;
          const idx = largestComponent[Math.floor(nextFloat() * largestComponent.length)];
          const tile = tiles[idx];
          const key = overworldTileKey(tile.q, tile.r);
          if (placedPoiKeys.has(key)) continue;
          if (pass === 0 && !preferred.includes(tile.terrain)) continue;
          if (!isFarEnoughFromPoisAndSites(tile.q, tile.r)) continue;
          chosen = tile;
          break;
        }
      }
      if (!chosen) continue;

      poiCounter++;
      const poiId = `poi_${kind}_${poiCounter}`;
      let name: string;
      if (kind === 'dungeon_entrance') {
        name = uniqueName(
          `${DUNGEON_NAME_PREFIXES[Math.floor(nextFloat() * DUNGEON_NAME_PREFIXES.length)]} ${
            DUNGEON_NAME_NOUNS[Math.floor(nextFloat() * DUNGEON_NAME_NOUNS.length)]
          }`,
        );
      } else if (kind === 'ancient_shrine') {
        name = uniqueName(
          `Shrine of ${SHRINE_ASPECTS[Math.floor(nextFloat() * SHRINE_ASPECTS.length)]}`,
        );
      } else {
        name = uniqueName(`${LAIR_NAMES[Math.floor(nextFloat() * LAIR_NAMES.length)]} Lair`);
      }

      const poi: OverworldPOI = {
        id: poiId,
        name,
        kind,
        q: chosen.q,
        r: chosen.r,
        ...(kind === 'dungeon_entrance'
          ? { dungeonSeed: nextUint32(), depthTier: 1 + Math.floor(nextFloat() * 4) }
          : {}),
      };
      map.pois[poiId] = poi;
      chosen.poiId = poiId;
      placedPoiKeys.add(overworldTileKey(chosen.q, chosen.r));
    }
  }

  // 8. Validation: schema, referential integrity, river symmetry, connectivity.
  OverworldMapSchema.parse(map);

  for (const tile of tiles) {
    if (tile.poiId !== undefined) {
      const poi = map.pois[tile.poiId];
      if (!poi || poi.q !== tile.q || poi.r !== tile.r) {
        throw new Error(
          `Overworld referential integrity failure: tile (${tile.q},${tile.r}) references missing or misaligned POI ${tile.poiId}`,
        );
      }
    }
    if (tile.riverEdges) {
      for (const e of tile.riverEdges) {
        const dir = OVERWORLD_EDGE_DIRECTIONS[e];
        const neighbor = getOverworldTile(map, tile.q + dir.q, tile.r + dir.r);
        if (!neighbor?.riverEdges?.includes((e + 2) % 4)) {
          throw new Error(
            `Overworld river edge asymmetry at (${tile.q},${tile.r}) edge ${e}`,
          );
        }
      }
    }
  }
  for (const poi of Object.values(map.pois)) {
    const tile = getOverworldTile(map, poi.q, poi.r);
    if (!tile || tile.terrain === 'ocean' || tile.poiId !== poi.id) {
      throw new Error(
        `Overworld referential integrity failure: POI ${poi.id} has no valid land tile`,
      );
    }
  }

  const connectivity = verifyOverworldConnectivity(map, settlementSites);
  if (!connectivity.isFullyConnected) {
    throw new Error(
      `Overworld generation failed connectivity verification for seed ${config.seed}: ` +
        `${connectivity.unreachableSites.length} unreachable sites, roadsConnected=${connectivity.roadsConnected}`,
    );
  }

  return {
    map,
    seed: config.seed,
    nextRngState: rngState,
    settlementSites,
    riverPaths,
  };
}
