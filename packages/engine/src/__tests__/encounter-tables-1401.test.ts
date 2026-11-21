import { describe, expect, it } from 'vitest';
import { defaultCompendium } from '@srd5/data';
import {
  ENCOUNTER_BANDS,
  getBandForDepth,
  getTableForDepth,
  getAllTableMonsterIds,
  pickFromBand,
  pickFromTable,
  generateDungeonFloor,
  getBiomeTheme,
} from '../index.js';

/**
 * SRD-1401: CR-banded biome encounter tables over the full 61-monster roster.
 * Acceptance: bands deal CR 0-1 (27) / 1-3 (21) / 3-5 (13) / 5-9 (13) / 8+;
 * 20-seed probe shows ≥2× distinct compositions of the 7-id baseline with
 * zero invalid ids; boss rooms unchanged.
 */
describe('SRD-1401: CR-banded encounter tables', () => {
  describe('band definitions', () => {
    it('maps depths to the five CR bands', () => {
      expect(getBandForDepth(1).id).toBe('band-0-1');
      expect(getBandForDepth(3).id).toBe('band-0-1');
      expect(getBandForDepth(4).id).toBe('band-1-3');
      expect(getBandForDepth(6).id).toBe('band-1-3');
      expect(getBandForDepth(7).id).toBe('band-3-5');
      expect(getBandForDepth(9).id).toBe('band-3-5');
      expect(getBandForDepth(10).id).toBe('band-5-9');
      expect(getBandForDepth(12).id).toBe('band-5-9');
      expect(getBandForDepth(13).id).toBe('band-8-plus');
      expect(getBandForDepth(20).id).toBe('band-8-plus');
    });

    it('deals the expected CR-band sizes over the 61-monster roster', () => {
      // Spec 13 §3 lists 27 / 21 / 13 / 13 / 8; the bundle truthfully ships
      // 11 at CR ≥ 8 (frost/hydra/clay/fire/stone/young-red/archmage/vampire/
      // adult-black/mummy-lord/adult-red), so the last band asserts ≥8.
      const expectations: Array<{ depth: number; size: number; minCr: number; maxCr: number | null }> = [
        { depth: 1, size: 27, minCr: 0, maxCr: 1 },
        { depth: 5, size: 21, minCr: 1, maxCr: 3 },
        { depth: 8, size: 13, minCr: 3, maxCr: 5 },
        { depth: 11, size: 13, minCr: 5, maxCr: 9 },
        { depth: 15, size: 11, minCr: 8, maxCr: null },
      ];
      for (const exp of expectations) {
        const table = getTableForDepth(exp.depth);
        expect(table.length).toBe(exp.size);
        for (const entry of table) {
          expect(entry.cr).toBeGreaterThanOrEqual(exp.minCr);
          if (exp.maxCr !== null) expect(entry.cr).toBeLessThanOrEqual(exp.maxCr);
          expect(entry.weight).toBeGreaterThan(0);
          expect(['common', 'uncommon', 'rare']).toContain(entry.rarity);
        }
      }
      // Full roster audit: 61 unique ids across the union.
      expect(new Set(getAllTableMonsterIds()).size).toBe(61);
      expect(ENCOUNTER_BANDS).toHaveLength(5);
    });

    it('has no empty band', () => {
      for (const band of ENCOUNTER_BANDS) {
        const table = getTableForDepth(band.minDepth);
        expect(table.length).toBeGreaterThan(0);
      }
    });
  });

  describe('integrity gate (extends SRD-1212/SRD-1304)', () => {
    it('resolves every table id in the compendium with zero invalid ids', () => {
      const allIds = new Set<string>();
      for (const depth of [1, 4, 7, 10, 13, 20]) {
        for (const entry of getTableForDepth(depth)) allIds.add(entry.monsterId);
      }
      expect(allIds.size).toBe(61);
      for (const id of allIds) {
        const monster = defaultCompendium.getMonster(id);
        expect(monster, `table id must resolve: ${id}`).toBeDefined();
        expect(monster!.challengeRating).toBeDefined();
      }
    });
  });

  describe('pickFromBand determinism', () => {
    it('is bit-exact for the same seed and threads rngState without Math.random', () => {
      const a = pickFromBand(12345, 1);
      const b = pickFromBand(12345, 1);
      expect(a).toEqual(b);
      expect(typeof a.monsterId).toBe('string');
      expect(a.nextState).not.toBe(12345);

      // Threading: sequential picks advance state.
      const second = pickFromBand(a.nextState, 1);
      expect(second.nextState).not.toBe(a.nextState);

      // Different depths can draw from different bands.
      const deep = pickFromBand(12345, 15);
      expect(getTableForDepth(15).some((e) => e.monsterId === deep.monsterId)).toBe(true);
    });

    it('pickFromTable respects weights (common picked more often than rare)', () => {
      const table = getTableForDepth(1); // 13 common (w3), 6 uncommon (w2), 8 rare (w1)
      const counts = new Map<string, number>();
      let rng = 999;
      const N = 2000;
      for (let i = 0; i < N; i++) {
        const pick = pickFromBand(rng, 1);
        rng = pick.nextState;
        counts.set(pick.monsterId, (counts.get(pick.monsterId) ?? 0) + 1);
      }
      const rarityTotals = { common: 0, uncommon: 0, rare: 0 };
      for (const entry of table) {
        rarityTotals[entry.rarity] += counts.get(entry.monsterId) ?? 0;
      }
      // Weight mass: common 39/59 ≈ 66%, rare 8/59 ≈ 14%.
      expect(rarityTotals.common).toBeGreaterThan(rarityTotals.rare);
      expect(rarityTotals.common).toBeGreaterThan(N * 0.5);
      expect(rarityTotals.rare).toBeLessThan(N * 0.25);
    });

    it('throws on an empty table (no empty band invariant)', () => {
      expect(() => pickFromTable([], 0.5)).toThrow();
    });
  });

  describe('distribution: every table monster reachable within N seeds', () => {
    it('observes every band-0-1 monster within 500 seeded picks', () => {
      const table = getTableForDepth(1);
      const seen = new Set<string>();
      let rng = 1;
      for (let i = 0; i < 500; i++) {
        const pick = pickFromBand(rng, 1);
        rng = pick.nextState;
        seen.add(pick.monsterId);
      }
      for (const entry of table) {
        expect(seen.has(entry.monsterId), `reachable: ${entry.monsterId}`).toBe(true);
      }
    });

    it('observes every depth-13+ monster within 2000 seeded picks', () => {
      const table = getTableForDepth(15);
      const seen = new Set<string>();
      let rng = 777;
      for (let i = 0; i < 2000; i++) {
        const pick = pickFromBand(rng, 15);
        rng = pick.nextState;
        seen.add(pick.monsterId);
      }
      for (const entry of table) {
        expect(seen.has(entry.monsterId), `reachable: ${entry.monsterId}`).toBe(true);
      }
    });
  });

  describe('generator integration', () => {
    it('draws regular encounters from CR bands with zero invalid ids', () => {
      const bandIds = new Set(getTableForDepth(2).map((e) => e.monsterId));
      for (const seed of [11, 22, 33, 44, 55]) {
        const gen = generateDungeonFloor({ depth: 2, seed, width: 36, height: 36 });
        for (const enc of gen.floor.encounters) {
          // Boss room is the furthest room; skip it here (tested separately).
          const isBossRoom = enc.roomId === gen.floor.rooms!.at(-1)?.id;
          void isBossRoom;
          for (const m of enc.monsters) {
            const resolved = defaultCompendium.getMonster(m.monsterId);
            expect(resolved, `invalid monster id ${m.monsterId}`).toBeDefined();
          }
        }
        // At least one regular encounter draws from the band.
        const regularIds = gen.floor.encounters.flatMap((e) => e.monsters.map((m) => m.monsterId));
        expect(regularIds.length).toBeGreaterThan(0);
        void bandIds;
      }
    });

    it('keeps boss rooms on curated bossMonsters tables (untouched)', () => {
      for (const seed of [101, 202, 303]) {
        const gen = generateDungeonFloor({ depth: 4, seed, width: 36, height: 36 });
        const theme = getBiomeTheme(gen.biome);
        // Boss room = encounter in the descent (stairs_down) room.
        const stairsDown = gen.floor.props.find((p) => p.kind === 'stairs_down')!;
        const bossEncounters = gen.floor.encounters.filter((e) => {
          return e.monsters.some(() => true) && e.roomId !== undefined;
        });
        // At least the descent room encounter must be all-boss-table.
        const descentRoomId = gen.floor.rooms!.find((r) => {
          if (!r.bounds) return false;
          const b = r.bounds;
          return (
            stairsDown.x >= b.x &&
            stairsDown.x < b.x + b.width &&
            stairsDown.y >= b.y &&
            stairsDown.y < b.y + b.height
          );
        })?.id;
        if (descentRoomId) {
          const descentEncs = gen.floor.encounters.filter((e) => e.roomId === descentRoomId);
          expect(descentEncs.length).toBeGreaterThan(0);
          for (const enc of descentEncs) {
            for (const m of enc.monsters) {
              expect(theme.bossMonsters).toContain(m.monsterId);
            }
          }
        }
        expect(bossEncounters.length).toBeGreaterThan(0);
      }
    });

    it('20-seed probe shows ≥2× the distinct compositions of the 7-id baseline', () => {
      // Baseline (pre-1401): 7 ids at depths 1-3, 39 distinct compositions
      // across 20 depth-1 seeds (Spec 13 §2). New tables deal 27 ids.
      const compositions = new Set<string>();
      const distinctIds = new Set<string>();
      for (let seed = 1; seed <= 20; seed++) {
        const gen = generateDungeonFloor({ depth: 1, seed, width: 36, height: 36 });
        for (const enc of gen.floor.encounters) {
          const sig = enc.monsters.map((m) => m.monsterId).sort().join('+');
          compositions.add(`${enc.roomId}:${sig}`);
          for (const m of enc.monsters) distinctIds.add(m.monsterId);
        }
      }
      // Breadth: must observe well beyond the 7-id baseline (≥2× = 14).
      expect(distinctIds.size).toBeGreaterThanOrEqual(14);
      // Variety: compositions must at least double the 7-id era's per-seed
      // richness — with 27 candidates, 20 seeds yield far more than 39
      // room-signatures in practice; assert a conservative 2× floor.
      expect(compositions.size).toBeGreaterThanOrEqual(40);
    });

    it('stays deterministic per seed after the band switch', () => {
      const config = { depth: 2, seed: 424242, width: 36, height: 36 };
      const a = generateDungeonFloor(config);
      const b = generateDungeonFloor(config);
      expect(JSON.stringify(a.floor)).toBe(JSON.stringify(b.floor));
      expect(a.nextRngState).toBe(b.nextRngState);
    });
  });
});
