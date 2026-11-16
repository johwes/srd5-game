import { describe, expect, it } from 'vitest';
import {
  type OverworldMap,
  type OverworldTerrainType,
  OVERWORLD_MOVEMENT_COSTS,
  OVERWORLD_TERRAIN_TYPES,
  OverworldMapSchema,
  classifyOverworldTerrain,
  findOverworldPath,
  generateOverworldMap,
  getOverworldTile,
  overworldTileKey,
  verifyOverworldConnectivity,
} from '../index.js';

function allTiles(map: OverworldMap) {
  return Object.values(map.tiles);
}

describe('SRD-801: Procedural OverworldMap Generator (Spec 06 Section 4.1)', () => {
  describe('Deterministic Seeded PRNG Replay', () => {
    it('produces 100% bit-exact identical worlds for identical seed and config', () => {
      const config = { seed: 987654321, width: 48, height: 48 };
      const run1 = generateOverworldMap(config);
      const run2 = generateOverworldMap(config);

      expect(JSON.stringify(run1.map)).toBe(JSON.stringify(run2.map));
      expect(run1.settlementSites).toEqual(run2.settlementSites);
      expect(run1.riverPaths).toEqual(run2.riverPaths);
      expect(run1.nextRngState).toBe(run2.nextRngState);
    });

    it('produces different worlds when seeds differ', () => {
      const run1 = generateOverworldMap({ seed: 11111, width: 48, height: 48 });
      const run2 = generateOverworldMap({ seed: 22222, width: 48, height: 48 });
      expect(JSON.stringify(run1.map)).not.toBe(JSON.stringify(run2.map));
    });
  });

  describe('Macro Grid, Schema & Movement Costs', () => {
    it('emits a dense width x height tile grid that passes Zod validation', () => {
      const { map } = generateOverworldMap({ seed: 42, width: 48, height: 40 });
      expect(OverworldMapSchema.safeParse(map).success).toBe(true);
      expect(Object.keys(map.tiles)).toHaveLength(48 * 40);
      expect(map.width).toBe(48);
      expect(map.height).toBe(40);
      expect(map.worldSeed).toBe(42);
      expect(map.worldName.length).toBeGreaterThan(0);

      for (let r = 0; r < map.height; r++) {
        for (let q = 0; q < map.width; q++) {
          const tile = getOverworldTile(map, q, r);
          expect(tile).toBeDefined();
          expect(tile!.q).toBe(q);
          expect(tile!.r).toBe(r);
          expect(tile!.elevation).toBeGreaterThanOrEqual(0);
          expect(tile!.elevation).toBeLessThanOrEqual(1);
        }
      }
    });

    it('assigns canonical movement costs per terrain (Plains 1, Forest 1.5, Hills 2, Swamp 2, Mountains 3)', () => {
      const { map } = generateOverworldMap({ seed: 777, width: 64, height: 64 });
      for (const tile of allTiles(map)) {
        expect(tile.movementCost).toBe(OVERWORLD_MOVEMENT_COSTS[tile.terrain]);
      }
      expect(OVERWORLD_MOVEMENT_COSTS.plains).toBe(1);
      expect(OVERWORLD_MOVEMENT_COSTS.forest).toBe(1.5);
      expect(OVERWORLD_MOVEMENT_COSTS.hills).toBe(2);
      expect(OVERWORLD_MOVEMENT_COSTS.swamp).toBe(2);
      expect(OVERWORLD_MOVEMENT_COSTS.mountains).toBe(3);
    });

    it('honors an explicit worldName override', () => {
      const { map } = generateOverworldMap({ seed: 5, worldName: 'Testrealm' });
      expect(map.worldName).toBe('Testrealm');
    });

    it('rejects invalid generation configs', () => {
      expect(() => generateOverworldMap({ seed: 1, width: 10 })).toThrow();
      expect(() => generateOverworldMap({ seed: 1, seaLevel: 0.9 })).toThrow();
      expect(() => generateOverworldMap({ seed: 1, settlementSiteCount: 99 })).toThrow();
    });
  });

  describe('Biome Classification', () => {
    it('classifies each canonical terrain from elevation/temperature/moisture', () => {
      const base = { seaLevel: 0.35, adjacentToOcean: false };
      expect(classifyOverworldTerrain({ ...base, elevation: 0.2, temperature: 0.5, moisture: 0.5 })).toBe('ocean');
      expect(classifyOverworldTerrain({ ...base, elevation: 0.38, temperature: 0.5, moisture: 0.5, adjacentToOcean: true })).toBe('coast');
      expect(classifyOverworldTerrain({ ...base, elevation: 0.9, temperature: 0.5, moisture: 0.5 })).toBe('mountains');
      expect(classifyOverworldTerrain({ ...base, elevation: 0.72, temperature: 0.5, moisture: 0.5 })).toBe('hills');
      expect(classifyOverworldTerrain({ ...base, elevation: 0.5, temperature: 0.1, moisture: 0.5 })).toBe('tundra');
      expect(classifyOverworldTerrain({ ...base, elevation: 0.5, temperature: 0.8, moisture: 0.2 })).toBe('desert');
      expect(classifyOverworldTerrain({ ...base, elevation: 0.4, temperature: 0.5, moisture: 0.8 })).toBe('swamp');
      expect(classifyOverworldTerrain({ ...base, elevation: 0.5, temperature: 0.5, moisture: 0.6 })).toBe('forest');
      expect(classifyOverworldTerrain({ ...base, elevation: 0.5, temperature: 0.5, moisture: 0.3 })).toBe('plains');
    });

    it('generates ocean-fringed maps with diverse land biomes', () => {
      const seenTerrains = new Set<OverworldTerrainType>();
      for (const seed of [1, 7, 42, 1337, 99999, 2026]) {
        const { map } = generateOverworldMap({ seed, width: 64, height: 64 });
        const terrains = new Set(allTiles(map).map((t) => t.terrain));
        for (const t of terrains) seenTerrains.add(t);

        // Every world has sea and a meaningful mix of land biomes.
        expect(terrains.has('ocean')).toBe(true);
        const landBiomes = [...terrains].filter((t) => t !== 'ocean');
        expect(landBiomes.length).toBeGreaterThanOrEqual(4);
      }
      // Across seeds the generator exercises all 9 canonical terrains.
      for (const terrain of OVERWORLD_TERRAIN_TYPES) {
        expect(seenTerrains.has(terrain)).toBe(true);
      }
    });

    it('places mountains at high elevation and ocean below sea level', () => {
      const { map } = generateOverworldMap({ seed: 31337, width: 64, height: 64 });
      for (const tile of allTiles(map)) {
        if (tile.terrain === 'ocean') expect(tile.elevation).toBeLessThan(0.35);
        if (tile.terrain === 'mountains') expect(tile.elevation).toBeGreaterThanOrEqual(0.82);
        if (tile.terrain === 'hills') expect(tile.elevation).toBeGreaterThanOrEqual(0.68);
      }
    });
  });

  describe('Rivers', () => {
    it('carves downhill rivers with symmetric river edges on both banks', () => {
      const { map, riverPaths } = generateOverworldMap({ seed: 4242, width: 64, height: 64 });
      expect(riverPaths.length).toBeGreaterThan(0);

      const directions = [
        { q: 0, r: -1 },
        { q: 1, r: 0 },
        { q: 0, r: 1 },
        { q: -1, r: 0 },
      ];

      for (const path of riverPaths) {
        expect(path.length).toBeGreaterThan(1);
        // Sources start in the highlands.
        const source = getOverworldTile(map, path[0].q, path[0].r)!;
        expect(source.elevation).toBeGreaterThanOrEqual(0.5);

        for (let i = 0; i < path.length; i++) {
          const tile = getOverworldTile(map, path[i].q, path[i].r)!;
          if (i > 0) {
            const prev = getOverworldTile(map, path[i - 1].q, path[i - 1].r)!;
            // Water only flows downhill.
            expect(tile.elevation).toBeLessThan(prev.elevation);
            // Consecutive path tiles are orthogonal neighbors.
            expect(Math.abs(tile.q - prev.q) + Math.abs(tile.r - prev.r)).toBe(1);
          }
        }
        // Terminus is the sea or a local minimum (no strictly-lower neighbor).
        const last = path[path.length - 1];
        const lastTile = getOverworldTile(map, last.q, last.r)!;
        if (lastTile.elevation >= 0.35) {
          const hasLowerNeighbor = directions.some((d) => {
            const n = getOverworldTile(map, last.q + d.q, last.r + d.r);
            return n !== undefined && n.elevation < lastTile.elevation;
          });
          expect(hasLowerNeighbor).toBe(false);
        }
      }

      // Every river edge is mirrored on the neighboring tile.
      let edgeCount = 0;
      for (const tile of allTiles(map)) {
        for (const e of tile.riverEdges ?? []) {
          edgeCount++;
          const d = directions[e];
          const neighbor = getOverworldTile(map, tile.q + d.q, tile.r + d.r);
          expect(neighbor).toBeDefined();
          expect(neighbor!.riverEdges).toContain((e + 2) % 4);
        }
      }
      expect(edgeCount).toBeGreaterThan(0);
    });

    it('can disable rivers entirely', () => {
      const { map, riverPaths } = generateOverworldMap({ seed: 99, riverCount: 0 });
      expect(riverPaths).toHaveLength(0);
      for (const tile of allTiles(map)) {
        expect(tile.riverEdges).toBeUndefined();
      }
    });
  });

  describe('Settlement Sites & Road Network', () => {
    it('selects spaced settlement sites on passable land of one connected landmass', () => {
      const { map, settlementSites } = generateOverworldMap({ seed: 555, width: 64, height: 64 });
      expect(settlementSites.length).toBe(5);

      const unique = new Set(settlementSites.map((s) => overworldTileKey(s.q, s.r)));
      expect(unique.size).toBe(settlementSites.length);

      for (const site of settlementSites) {
        const tile = getOverworldTile(map, site.q, site.r)!;
        expect(tile.terrain).not.toBe('ocean');
        expect(['plains', 'coast', 'forest', 'hills']).toContain(tile.terrain);
      }

      const report = verifyOverworldConnectivity(map, settlementSites);
      expect(report.isFullyConnected).toBe(true);
      expect(report.unreachableSites).toHaveLength(0);
      expect(report.roadsConnected).toBe(true);
    });

    it('builds a road network linking every settlement site without crossing ocean', () => {
      const { map, settlementSites } = generateOverworldMap({ seed: 808, width: 64, height: 64 });
      const roadTiles = allTiles(map).filter((t) => t.roadThrough === true);
      expect(roadTiles.length).toBeGreaterThan(0);
      for (const tile of roadTiles) {
        expect(tile.terrain).not.toBe('ocean');
      }
      for (const site of settlementSites) {
        expect(getOverworldTile(map, site.q, site.r)!.roadThrough).toBe(true);
      }
      expect(verifyOverworldConnectivity(map, settlementSites).roadsConnected).toBe(true);
    });

    it('can disable roads while keeping the landmass connected', () => {
      const { map, settlementSites } = generateOverworldMap({ seed: 808, roadsEnabled: false });
      for (const tile of allTiles(map)) {
        expect(tile.roadThrough).toBeUndefined();
      }
      const report = verifyOverworldConnectivity(map, settlementSites);
      expect(report.unreachableSites).toHaveLength(0);
    });

    it('routes cheapest overland paths that never enter ocean', () => {
      const { map, settlementSites } = generateOverworldMap({ seed: 1234, width: 48, height: 48 });
      const result = findOverworldPath(map, settlementSites[0], settlementSites[1]);
      expect(result).not.toBeNull();
      expect(result!.path[0]).toEqual(settlementSites[0]);
      expect(result!.path[result!.path.length - 1]).toEqual(settlementSites[1]);
      expect(result!.cost).toBeGreaterThan(0);
      for (const pt of result!.path) {
        expect(getOverworldTile(map, pt.q, pt.r)!.terrain).not.toBe('ocean');
      }

      // Ocean destinations are unreachable overland.
      const oceanTile = allTiles(map).find((t) => t.terrain === 'ocean')!;
      expect(findOverworldPath(map, settlementSites[0], { q: oceanTile.q, r: oceanTile.r })).toBeNull();
      // Out-of-bounds endpoints return null.
      expect(findOverworldPath(map, settlementSites[0], { q: -1, r: 0 })).toBeNull();
      // Same-tile path is trivial.
      const trivial = findOverworldPath(map, settlementSites[0], settlementSites[0]);
      expect(trivial!.cost).toBe(0);
      expect(trivial!.path).toHaveLength(1);
    });
  });

  describe('Wilderness Points of Interest', () => {
    it('places dungeon entrances with delve seeds, shrines, and lairs on valid land tiles', () => {
      const { map } = generateOverworldMap({ seed: 6060, width: 64, height: 64 });
      const pois = Object.values(map.pois);
      const entrances = pois.filter((p) => p.kind === 'dungeon_entrance');
      const shrines = pois.filter((p) => p.kind === 'ancient_shrine');
      const lairs = pois.filter((p) => p.kind === 'monster_lair');
      expect(entrances).toHaveLength(3);
      expect(shrines).toHaveLength(2);
      expect(lairs).toHaveLength(3);

      const occupied = new Set<string>();
      for (const poi of pois) {
        const tile = getOverworldTile(map, poi.q, poi.r)!;
        expect(tile.terrain).not.toBe('ocean');
        expect(tile.poiId).toBe(poi.id);
        expect(map.pois[poi.id]).toEqual(poi);
        expect(occupied.has(overworldTileKey(poi.q, poi.r))).toBe(false);
        occupied.add(overworldTileKey(poi.q, poi.r));
        expect(poi.name.length).toBeGreaterThan(0);

        if (poi.kind === 'dungeon_entrance') {
          expect(poi.dungeonSeed).toBeDefined();
          expect(Number.isInteger(poi.dungeonSeed)).toBe(true);
          expect(poi.depthTier).toBeGreaterThanOrEqual(1);
          expect(poi.depthTier).toBeLessThanOrEqual(4);
        }
      }
    });

    it('honors POI count overrides including zero', () => {
      const { map } = generateOverworldMap({
        seed: 77,
        dungeonEntranceCount: 0,
        ancientShrineCount: 0,
        monsterLairCount: 0,
      });
      expect(Object.keys(map.pois)).toHaveLength(0);
      for (const tile of allTiles(map)) {
        expect(tile.poiId).toBeUndefined();
      }
    });
  });

  describe('Multi-Seed Connectivity Sweep', () => {
    it('guarantees schema validity and full site connectivity across many seeds and sizes', () => {
      const cases: Array<{ seed: number; width: number; height: number }> = [
        { seed: 123, width: 48, height: 48 },
        { seed: 456, width: 48, height: 48 },
        { seed: 789, width: 64, height: 64 },
        { seed: 99999, width: 64, height: 64 },
        { seed: 1337, width: 64, height: 48 },
        { seed: 24601, width: 48, height: 64 },
        { seed: 8675309, width: 80, height: 80 },
        { seed: 2026, width: 32, height: 32 },
      ];

      for (const { seed, width, height } of cases) {
        const generated = generateOverworldMap({ seed, width, height });
        const { map, settlementSites } = generated;
        expect(OverworldMapSchema.safeParse(map).success).toBe(true);
        expect(settlementSites.length).toBeGreaterThanOrEqual(2);

        const report = verifyOverworldConnectivity(map, settlementSites);
        expect(report.isFullyConnected).toBe(true);
        expect(report.unreachableSites).toHaveLength(0);
        expect(report.roadsConnected).toBe(true);
      }
    });
  });
});
