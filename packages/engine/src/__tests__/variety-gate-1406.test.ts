import { describe, expect, it } from 'vitest';
import { defaultCompendium } from '@srd5/data';
import {
  advanceRogueliteFloor,
  createDailyWorldOptions,
  DungeonFloorSpecSchema,
  formatWorldOptionsBanner,
  generateDungeonFloor,
  getAllTableMonsterIds,
  getDefaultRogueliteParty,
  getTableForDepth,
  MAGIC_ITEM_TABLE_A,
  MAGIC_ITEM_TABLE_B,
  MAGIC_ITEM_TABLE_C,
  MAGIC_ITEM_TABLE_F,
  MAGIC_ITEM_TABLE_G,
  MAGIC_ITEM_TABLE_H,
  MAGIC_ITEM_TABLE_I,
  pickFromBand,
  resolveRogueliteLongRest,
  resolveWorldOptions,
  startRogueliteRun,
  verifyDungeonConnectivity,
  type DungeonFloorSpec,
  type EncounterSpawnGroup,
  type WorldOptions,
} from '../index.js';

/**
 * SRD-1406: Variety verification gate (Spec 13 Phase 4 — proof).
 *
 * This gate asserts measured variety (not vibes) plus 0 invariant violations
 * on world-option seeds:
 *
 * 1. Distributional breadth — 20 depth-1 seeds yield ≥40 distinct encounter
 *    compositions and ≥14 distinct monster ids (2× the 7-id pre-1401 baseline).
 * 2. Full-roster reachability — every table monster in every CR band is
 *    observed within a bounded seeded sweep (no dead table entries).
 * 3. Champion observation rate in band — depth-5 generator encounters promote
 *    champions within the stated-rate statistical band, never on depth 1.
 * 4. Special-room observation rate in band — depth-3 floors carry ≤1 special
 *    room at the stated floor chance with all three kinds observed.
 * 5. Soak — every world-option combination × seed × depth produces fully
 *    connected, schema-valid, compendium-clean, bit-exact-replayable floors,
 *    and roguelite sessions carry their options across floors into rests.
 *    All violations are collected (soak-bot convention) and the gate fails
 *    with the full list when any invariant breaks.
 *
 * Browser E2E smoke (champion skull visible, vault opens, options banner
 * shown at 1280×800) rides `packages/client/e2e/variety-gate.spec.ts` plus
 * the jsdom gate in `packages/client/src/__tests__/variety-gate-1406.test.tsx`.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Room-scoped encounter signature (matches the SRD-1401 20-seed probe). */
function encounterSignature(roomId: string | undefined, monsters: { monsterId: string }[]): string {
  return `${roomId ?? '?'}:${monsters.map((m) => m.monsterId).sort().join('+')}`;
}

/**
 * Boss-room encounter detector: the boss room is the room containing the
 * `stairs_down` prop (matches the SRD-1401 boss-table test convention).
 * Boss encounters draw from curated `bossMonsters`, not CR bands.
 */
function bossRoomIdForFloor(floor: DungeonFloorSpec): string | undefined {
  const stairsDown = floor.props.find((p) => p.kind === 'stairs_down');
  if (!stairsDown || !floor.rooms) return undefined;
  return floor.rooms.find((r) => {
    if (!r.bounds) return false;
    const b = r.bounds;
    return (
      stairsDown.x >= b.x &&
      stairsDown.x < b.x + b.width &&
      stairsDown.y >= b.y &&
      stairsDown.y < b.y + b.height
    );
  })?.id;
}

function isBossEncounter(floor: DungeonFloorSpec, enc: EncounterSpawnGroup): boolean {
  const bossRoomId = bossRoomIdForFloor(floor);
  return bossRoomId !== undefined && enc.roomId === bossRoomId;
}

function monsterResolves(monsterId: string): boolean {
  return defaultCompendium.getMonster(monsterId) !== undefined;
}

function lootItemResolves(itemId: string): boolean {
  // `iron_dungeon_key` is a procedural dungeon-mechanic key (locked stairs
  // pipeline), not a compendium item — explicitly allowlisted.
  if (itemId === 'iron_dungeon_key') return true;
  return (
    defaultCompendium.getEquipment(itemId) !== undefined ||
    defaultCompendium.getMagicItem(itemId) !== undefined
  );
}

interface GateViolation {
  suite: string;
  seed: string;
  detail: string;
}

// ---------------------------------------------------------------------------
// 1. Distributional breadth (20 seeds, depth 1)
// ---------------------------------------------------------------------------

describe('SRD-1406 gate: distributional breadth', () => {
  it('20 depth-1 seeds yield ≥40 distinct compositions and ≥14 distinct ids', () => {
    const compositions = new Set<string>();
    const distinctIds = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const gen = generateDungeonFloor({ depth: 1, seed, width: 36, height: 36 });
      for (const enc of gen.floor.encounters) {
        compositions.add(encounterSignature(enc.roomId, enc.monsters));
        for (const m of enc.monsters) distinctIds.add(m.monsterId);
      }
    }
    // Thresholds: the pre-1401 baseline measured 39 compositions from 7 ids
    // (Spec 13 §2). With 27 candidates the gate demands at least as many
    // compositions as the baseline's full 20-seed yield, and 2× the ids.
    expect(compositions.size).toBeGreaterThanOrEqual(40);
    expect(distinctIds.size).toBeGreaterThanOrEqual(14);
  });
});

// ---------------------------------------------------------------------------
// 2. Full-roster reachability (every table monster observed)
// ---------------------------------------------------------------------------

describe('SRD-1406 gate: every table monster is reachable', () => {
  it('observes every band monster within a bounded seeded sweep', () => {
    const missing: string[] = [];
    for (const depth of [1, 5, 8, 11, 15]) {
      const table = getTableForDepth(depth);
      const seen = new Set<string>();
      let rng = (depth * 1000033) >>> 0;
      const BUDGET = 20000;
      for (let i = 0; i < BUDGET && seen.size < table.length; i++) {
        const pick = pickFromBand(rng, depth);
        rng = pick.nextState;
        seen.add(pick.monsterId);
      }
      for (const entry of table) {
        if (!seen.has(entry.monsterId)) missing.push(`depth ${depth}: ${entry.monsterId}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('covers the full 61-monster roster across depths 1–15 in 40 seeds', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      for (const depth of [1, 2, 4, 6, 8, 10, 12, 15]) {
        const gen = generateDungeonFloor({ depth, seed, width: 36, height: 36 });
        for (const enc of gen.floor.encounters) {
          for (const m of enc.monsters) seen.add(m.monsterId);
        }
      }
    }
    const roster = new Set(getAllTableMonsterIds());
    const unobserved = [...roster].filter((id) => !seen.has(id));
    // Generator floors sample sparsely (1–2 regulars per encounter), so the
    // gate demands a strong majority coupled with the exhaustive per-band
    // sweep above (which proves no dead table entries).
    expect(seen.size).toBeGreaterThanOrEqual(55);
    expect(unobserved.length).toBeLessThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------
// 3. Champion observation rate in band
// ---------------------------------------------------------------------------

describe('SRD-1406 gate: champion observation rate', () => {
  it('depth-5 encounters promote champions within the stated-rate band (never depth 1)', () => {
    let championEncounters = 0;
    let totalEncounters = 0;
    const traits = new Set<string>();
    let depth1Champions = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const deep = generateDungeonFloor({ depth: 5, seed, width: 36, height: 36 });
      for (const enc of deep.floor.encounters) {
        totalEncounters++;
        const champs = enc.monsters.filter(
          (m) => (m as { championTrait?: string }).championTrait !== undefined,
        );
        // Max 1 champion per encounter (SRD-1402 wiring invariant).
        expect(champs.length).toBeLessThanOrEqual(1);
        if (champs.length === 1) {
          championEncounters++;
          traits.add((champs[0] as { championTrait: string }).championTrait);
        }
      }
      const shallow = generateDungeonFloor({ depth: 1, seed, width: 36, height: 36 });
      for (const enc of shallow.floor.encounters) {
        if (
          enc.monsters.some((m) => (m as { championTrait?: string }).championTrait !== undefined)
        ) {
          depth1Champions++;
        }
      }
    }
    expect(depth1Champions).toBe(0);
    const rate = championEncounters / Math.max(1, totalEncounters);
    // Stated rate at depth 5 is 18%/encounter (8% + 2%/depth); the gate
    // asserts a generous statistical band around it at the generator level.
    expect(rate).toBeGreaterThan(0.08);
    expect(rate).toBeLessThan(0.3);
    expect([...traits].sort()).toEqual(['brutal', 'swift', 'warded']);
  });
});

// ---------------------------------------------------------------------------
// 4. Special-room observation rate in band
// ---------------------------------------------------------------------------

describe('SRD-1406 gate: special-room observation rate', () => {
  it('depth-3 floors carry ≤1 special room at the stated floor chance', () => {
    let specialFloors = 0;
    const kinds = new Set<string>();
    const N = 300;
    for (let seed = 1; seed <= N; seed++) {
      const gen = generateDungeonFloor({ depth: 3, seed, width: 36, height: 36, targetRoomCount: 5 });
      const marked = (gen.floor.rooms ?? []).filter((r) => r.specialRoom !== undefined);
      expect(marked.length).toBeLessThanOrEqual(1);
      if (marked.length === 1) {
        specialFloors++;
        kinds.add(marked[0]!.specialRoom!);
      }
      expect(verifyDungeonConnectivity(gen.floor).isFullyConnected).toBe(true);
    }
    const rate = specialFloors / N;
    // Stated floor chance is 40% (SPECIAL_ROOM_FLOOR_CHANCE).
    expect(rate).toBeGreaterThan(0.3);
    expect(rate).toBeLessThan(0.5);
    expect([...kinds].sort()).toEqual(['cursed_shrine', 'nest', 'vault']);
  });
});

describe('SRD-1406 gate: drop-pool integrity (no dangling loot ids)', () => {
  it('every curated magic-item pool id resolves in the compendium', () => {
    // Regression guard for the SRD-1406 find: MAGIC_ITEM_TABLE_A referenced
    // `potion-of-climbing`, which ships in no bundle file. Drop pools may
    // only reference executable bundled ids (SRD-1304 rule).
    const pools = {
      A: MAGIC_ITEM_TABLE_A,
      B: MAGIC_ITEM_TABLE_B,
      C: MAGIC_ITEM_TABLE_C,
      F: MAGIC_ITEM_TABLE_F,
      G: MAGIC_ITEM_TABLE_G,
      H: MAGIC_ITEM_TABLE_H,
      I: MAGIC_ITEM_TABLE_I,
    };
    const dangling: string[] = [];
    for (const [table, ids] of Object.entries(pools)) {
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) {
        const resolves =
          defaultCompendium.getMagicItem(id) !== undefined ||
          defaultCompendium.getEquipment(id) !== undefined;
        if (!resolves) dangling.push(`table ${table}: ${id}`);
      }
    }
    expect(dangling).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. Soak: world-option seeds, 0 invariant violations
// ---------------------------------------------------------------------------

describe('SRD-1406 gate: world-option soak (0 invariant violations)', () => {
  const optionSets: Array<{ name: string; options?: Partial<WorldOptions> }> = [
    { name: 'default' },
    { name: 'grand', options: { scope: 'grand', seed: 4242 } },
    { name: 'calm', options: { wildness: 'calm', seed: 4242 } },
    { name: 'wild', options: { wildness: 'wild', seed: 4242 } },
    { name: 'abundant', options: { scarcity: 'abundant', seed: 4242 } },
    { name: 'scarce', options: { scarcity: 'scarce', seed: 4242 } },
    {
      name: 'grand+wild+scarce+manual-seed',
      options: { scope: 'grand', wildness: 'wild', scarcity: 'scarce', seed: 987654, seedSource: 'manual' },
    },
    { name: 'daily', options: { ...createDailyWorldOptions('2026-11-21') } },
  ];
  const seeds = [101, 202, 303];
  const depths = [1, 2, 3, 4, 5, 6];

  it('every option set × seed × depth floor is connected, valid, clean, and replayable', () => {
    const violations: GateViolation[] = [];
    const check = (suite: string, seed: string, condition: boolean, detail: string) => {
      if (!condition) violations.push({ suite, seed, detail });
    };

    for (const set of optionSets) {
      for (const seed of seeds) {
        for (const depth of depths) {
          const tag = `${set.name}/seed-${seed}/depth-${depth}`;
          const worldOptions = set.options
            ? resolveWorldOptions({ ...set.options, seed: set.options.seed ?? seed })
            : undefined;
          let gen: ReturnType<typeof generateDungeonFloor>;
          try {
            gen = generateDungeonFloor({
              depth,
              seed,
              width: 36,
              height: 36,
              targetRoomCount: 5,
              ...(worldOptions ? { worldOptions } : {}),
            });
          } catch (err) {
            violations.push({ suite: 'soak-floor-gen', seed: tag, detail: `threw: ${(err as Error).message}` });
            continue;
          }
          const { floor } = gen;

          // (a) Connectivity: every room reachable, stairs-down reachable.
          const connectivity = verifyDungeonConnectivity(floor);
          check('soak-connectivity', tag, connectivity.isFullyConnected, `rooms unreachable: ${connectivity.unreachableRooms.join(',')}`);
          check('soak-connectivity', tag, connectivity.stairsDownReachable, 'stairs down unreachable');

          // (b) Stairs props exist exactly once each.
          check('soak-stairs', tag, floor.props.filter((p) => p.kind === 'stairs_up').length === 1, 'stairs_up count != 1');
          check('soak-stairs', tag, floor.props.filter((p) => p.kind === 'stairs_down').length === 1, 'stairs_down count != 1');

          // (c) Every encounter monster id resolves in the compendium.
          for (const enc of floor.encounters) {
            for (const m of enc.monsters) {
              check('soak-compendium', tag, monsterResolves(m.monsterId), `monster id does not resolve: ${m.monsterId}`);
            }
          }

          // (d) Regular (non-boss) encounters stay inside the depth CR band.
          const band = new Set(getTableForDepth(depth).map((e) => e.monsterId));
          for (const enc of floor.encounters) {
            if (isBossEncounter(floor, enc)) continue;
            for (const m of enc.monsters) {
              check('soak-band', tag, band.has(m.monsterId), `regular ${m.monsterId} outside CR band at depth ${depth}`);
            }
          }

          // (e) Champion wiring: ≤1 per encounter, never depth 1.
          for (const enc of floor.encounters) {
            const champs = enc.monsters.filter(
              (m) => (m as { championTrait?: string }).championTrait !== undefined,
            );
            check('soak-champion', tag, champs.length <= 1, `>1 champion in ${enc.id}`);
            if (depth === 1) {
              check('soak-champion', tag, champs.length === 0, `depth-1 champion in ${enc.id}`);
            }
          }

          // (f) Special rooms: ≤1 per floor, never depth 1.
          const marked = (floor.rooms ?? []).filter((r) => r.specialRoom !== undefined);
          check('soak-special-room', tag, marked.length <= 1, `>1 special room: ${marked.map((r) => r.id).join(',')}`);
          if (depth === 1) {
            check('soak-special-room', tag, marked.length === 0, 'depth-1 special room');
          }

          // (g) Chest/shrine loot items resolve in the compendium.
          for (const prop of floor.props) {
            const items = (prop.lootTable as { items?: string[] } | undefined)?.items ?? [];
            for (const itemId of items) {
              check('soak-loot', tag, lootItemResolves(itemId), `loot item does not resolve: ${itemId} (${prop.id})`);
            }
          }

          // (h) Schema validity (Zod).
          const parsed = DungeonFloorSpecSchema.safeParse(floor);
          check('soak-schema', tag, parsed.success, `schema errors: ${parsed.success ? '' : JSON.stringify(parsed.error.issues).slice(0, 300)}`);

          // (i) Deterministic replay: identical config → identical floor + rng.
          const again = generateDungeonFloor({
            depth,
            seed,
            width: 36,
            height: 36,
            targetRoomCount: 5,
            ...(worldOptions ? { worldOptions } : {}),
          });
          check('soak-replay', tag, JSON.stringify(again.floor) === JSON.stringify(floor), 'floor not bit-exact on replay');
          check('soak-replay', tag, again.nextRngState === gen.nextRngState, 'nextRngState diverged on replay');
        }
      }
    }

    expect(violations, JSON.stringify(violations.slice(0, 10), null, 2)).toEqual([]);
  });

  it('roguelite sessions carry world options across floors into rests', () => {
    const violations: GateViolation[] = [];
    const party = getDefaultRogueliteParty();
    for (const set of optionSets.filter((s) => s.name !== 'default')) {
      const tag = `session-${set.name}`;
      try {
        const sess = startRogueliteRun({
          seed: set.options?.seed ?? 555,
          partyCharacters: party,
          worldOptions: set.options,
        });
        const banner = formatWorldOptionsBanner(sess.runState.worldOptions);
        if (!banner || banner.length < 8) {
          violations.push({ suite: 'soak-session', seed: tag, detail: 'empty world-options banner on run start' });
        }
        const floor2 = advanceRogueliteFloor(sess.runState, sess.gameState);
        if (JSON.stringify(floor2.runState.worldOptions) !== JSON.stringify(sess.runState.worldOptions)) {
          violations.push({ suite: 'soak-session', seed: tag, detail: 'worldOptions mutated across advanceRogueliteFloor' });
        }
        const rested = resolveRogueliteLongRest(floor2.runState, floor2.gameState);
        if (JSON.stringify(rested.nextRunState.worldOptions) !== JSON.stringify(sess.runState.worldOptions)) {
          violations.push({ suite: 'soak-session', seed: tag, detail: 'worldOptions mutated across long rest' });
        }
        const connectivity = verifyDungeonConnectivity(floor2.generatedFloor.floor);
        if (!connectivity.isFullyConnected) {
          violations.push({ suite: 'soak-session', seed: tag, detail: 'advanced floor not fully connected' });
        }
      } catch (err) {
        violations.push({ suite: 'soak-session', seed: tag, detail: `threw: ${(err as Error).message}` });
      }
    }
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});
