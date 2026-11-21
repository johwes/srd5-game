/**
 * SRD-1401: CR-Banded Biome Encounter Tables (Spec 13 §3).
 *
 * Replaces hand-picked per-biome `monsters` id lists with CR-band tables over
 * the full 61-monster roster. Curated boss tables (`bossMonsters`) are
 * untouched — only regular encounters draw from these bands.
 *
 * Design identity: variety levers speak Civ/MoM (setup options, lairs,
 * guardians), never Hades (no mutators, no unlock trees) — see Spec 13 §0.
 *
 * Non-negotiables: seeded determinism (bit-exact replay per seed), no
 * `Math.random()` in `@srd5/engine`, SRD 5.1-only content, offline green.
 *
 * Bands (measured bundle spread, overlapping at edges so depth transitions
 * never cliff):
 * - depths 1–3  → CR 0–1  (27 candidates)
 * - depths 4–6  → CR 1–3  (21 candidates)
 * - depths 7–9  → CR 3–5  (13 candidates)
 * - depths 10–12 → CR 5–9 (13 candidates)
 * - depths 13+  → CR 8+   (11 candidates; Spec 13 §3 lists 8, but the
 *   bundled `monsters.json` ships 11 at CR ≥ 8 — audit below is truthful to
 *   the bundle rather than the stale count)
 *
 * Weights: within each band, lower-CR entries are common (weight 3),
 * mid-band uncommon (weight 2), top-band rare (weight 1). Selection stays
 * dice-driven via `pickFromBand(rngState, depth)`.
 *
 * Audit (id → CR, generated from `packages/data/src/srd/monsters.json`,
 * 61 total: 6×0.125, 7×0.25, 6×0.5, 8×CR1, 5×CR2, 8×CR3, 1×CR4, 4×CR5,
 * 3×CR6, 2×CR7, 2×CR8, 2×CR9, 2×CR10, 1×CR12, 1×CR13, 1×CR14, 1×CR15,
 * 1×CR17):
 * - CR 0.125: bandit, cultist, giant-rat, guard, kobold, noble
 * - CR 0.25: acolyte, giant-bat, giant-wolf-spider, goblin, skeleton, wolf, zombie
 * - CR 0.5: hobgoblin, orc, scout, shadow, thug, warhorse-skeleton
 * - CR 1: bugbear, dire-wolf, ghoul, giant-spider, goblin-boss, harpy, specter, spy
 * - CR 2: berserker, cult-fanatic, gelatinous-cube, ogre, priest
 * - CR 3: hell-hound, knight, manticore, minotaur, mummy, owlbear, veteran, wight
 * - CR 4: ghost
 * - CR 5: gladiator, hill-giant, troll, wraith
 * - CR 6: mage, medusa, wyvern
 * - CR 7: oni, young-black-dragon
 * - CR 8: frost-giant, hydra
 * - CR 9: clay-golem, fire-giant
 * - CR 10: stone-golem, young-red-dragon
 * - CR 12: archmage
 * - CR 13: vampire
 * - CR 14: adult-black-dragon
 * - CR 15: mummy-lord
 * - CR 17: adult-red-dragon
 *
 * Exclusion tags: audited the full roster for misfits (aquatic-only,
 * legendary-lair-dependent). The 61-monster bundle contains no aquatic-only
 * statblocks and no lair-gated mechanics — legendary actions present
 * (adult-black-dragon) function without a lair — so no entries are excluded.
 * The `exclusionTags` field and `excludeTags` filter exist so future waves
 * can tag misfits honestly without reflavoring.
 *
 * Arena PvE waves / Realm delve spawns may draw from the same bands via
 * `getTableForDepth` / `pickFromBand` where their current pools overlap
 * (free variety, no behavior change) — no mandatory wiring in this ticket.
 */

import { nextRandomFloat } from '../dice/prng.js';

/** CR value type matching `ChallengeRating` in `@srd5/data`. */
export type EncounterCr = number;

/** Rarity tier within a band (drives weight). */
export type EncounterRarity = 'common' | 'uncommon' | 'rare';

/** Exclusion reason tags for misfit monsters (currently unused — see audit). */
export type EncounterExclusionTag = 'aquatic-only' | 'legendary-lair' | 'too-large';

/** Single weighted entry in a CR-band encounter table. */
export interface EncounterTableEntry {
  monsterId: string;
  cr: EncounterCr;
  weight: number;
  rarity: EncounterRarity;
  exclusionTags: EncounterExclusionTag[];
}

/** Depth band definition. */
export interface EncounterBand {
  id: string;
  minDepth: number;
  maxDepth: number | null;
  minCr: number;
  maxCr: number | null;
}

export const ENCOUNTER_BANDS: readonly EncounterBand[] = [
  { id: 'band-0-1', minDepth: 1, maxDepth: 3, minCr: 0, maxCr: 1 },
  { id: 'band-1-3', minDepth: 4, maxDepth: 6, minCr: 1, maxCr: 3 },
  { id: 'band-3-5', minDepth: 7, maxDepth: 9, minCr: 3, maxCr: 5 },
  { id: 'band-5-9', minDepth: 10, maxDepth: 12, minCr: 5, maxCr: 9 },
  { id: 'band-8-plus', minDepth: 13, maxDepth: null, minCr: 8, maxCr: null },
];

/**
 * Canonical monster → CR map (mirrors `packages/data/src/srd/monsters.json`).
 * Kept as a static map so `@srd5/engine` stays free of runtime JSON imports
 * while the integrity test verifies every id resolves in the compendium.
 */
const MONSTER_CR: Readonly<Record<string, EncounterCr>> = {
  'bandit': 0.125,
  'cultist': 0.125,
  'giant-rat': 0.125,
  'guard': 0.125,
  'kobold': 0.125,
  'noble': 0.125,
  'acolyte': 0.25,
  'giant-bat': 0.25,
  'giant-wolf-spider': 0.25,
  'goblin': 0.25,
  'skeleton': 0.25,
  'wolf': 0.25,
  'zombie': 0.25,
  'hobgoblin': 0.5,
  'orc': 0.5,
  'scout': 0.5,
  'shadow': 0.5,
  'thug': 0.5,
  'warhorse-skeleton': 0.5,
  'bugbear': 1,
  'dire-wolf': 1,
  'ghoul': 1,
  'giant-spider': 1,
  'goblin-boss': 1,
  'harpy': 1,
  'specter': 1,
  'spy': 1,
  'berserker': 2,
  'cult-fanatic': 2,
  'gelatinous-cube': 2,
  'ogre': 2,
  'priest': 2,
  'hell-hound': 3,
  'knight': 3,
  'manticore': 3,
  'minotaur': 3,
  'mummy': 3,
  'owlbear': 3,
  'veteran': 3,
  'wight': 3,
  'ghost': 4,
  'gladiator': 5,
  'hill-giant': 5,
  'troll': 5,
  'wraith': 5,
  'mage': 6,
  'medusa': 6,
  'wyvern': 6,
  'oni': 7,
  'young-black-dragon': 7,
  'frost-giant': 8,
  'hydra': 8,
  'clay-golem': 9,
  'fire-giant': 9,
  'stone-golem': 10,
  'young-red-dragon': 10,
  'archmage': 12,
  'vampire': 13,
  'adult-black-dragon': 14,
  'mummy-lord': 15,
  'adult-red-dragon': 17,
};

/**
 * Weight + rarity assignment per band. Lower CR in-band is common (3),
 * mid-band uncommon (2), top-band rare (1).
 */
function weightForCr(band: EncounterBand, cr: number): { weight: number; rarity: EncounterRarity } {
  switch (band.id) {
    case 'band-0-1':
      if (cr <= 0.25) return { weight: 3, rarity: 'common' };
      if (cr <= 0.5) return { weight: 2, rarity: 'uncommon' };
      return { weight: 1, rarity: 'rare' };
    case 'band-1-3':
      if (cr <= 1) return { weight: 3, rarity: 'common' };
      if (cr <= 2) return { weight: 2, rarity: 'uncommon' };
      return { weight: 1, rarity: 'rare' };
    case 'band-3-5':
      if (cr <= 3) return { weight: 3, rarity: 'common' };
      if (cr <= 4) return { weight: 2, rarity: 'uncommon' };
      return { weight: 1, rarity: 'rare' };
    case 'band-5-9':
      if (cr <= 5) return { weight: 3, rarity: 'common' };
      if (cr <= 7) return { weight: 2, rarity: 'uncommon' };
      return { weight: 1, rarity: 'rare' };
    case 'band-8-plus':
      if (cr <= 9) return { weight: 3, rarity: 'common' };
      if (cr <= 12) return { weight: 2, rarity: 'uncommon' };
      return { weight: 1, rarity: 'rare' };
    default:
      return { weight: 1, rarity: 'rare' };
  }
}

function crInBand(cr: number, band: EncounterBand): boolean {
  if (cr < band.minCr) return false;
  if (band.maxCr !== null && cr > band.maxCr) return false;
  return true;
}

/** Returns the band definition for a dungeon depth (depth < 1 clamps to 1). */
export function getBandForDepth(depth: number): EncounterBand {
  const d = Math.max(1, Math.floor(depth));
  for (const band of ENCOUNTER_BANDS) {
    if (d >= band.minDepth && (band.maxDepth === null || d <= band.maxDepth)) {
      return band;
    }
  }
  return ENCOUNTER_BANDS[ENCOUNTER_BANDS.length - 1]!;
}

/** All 61 audited monster ids. */
export function getAllTableMonsterIds(): string[] {
  return Object.keys(MONSTER_CR);
}

/** CR lookup for an audited monster id (undefined for unknown ids). */
export function getMonsterCr(monsterId: string): EncounterCr | undefined {
  return MONSTER_CR[monsterId];
}

export interface GetTableOptions {
  excludeTags?: readonly EncounterExclusionTag[];
}

/**
 * Returns the weighted encounter table for a depth, sorted by monsterId for
 * stable iteration. Boss tables are intentionally not included — callers use
 * curated `bossMonsters` for boss rooms.
 */
export function getTableForDepth(depth: number, options?: GetTableOptions): EncounterTableEntry[] {
  const band = getBandForDepth(depth);
  const excluded = new Set(options?.excludeTags ?? []);
  const entries: EncounterTableEntry[] = [];
  for (const [monsterId, cr] of Object.entries(MONSTER_CR)) {
    if (!crInBand(cr, band)) continue;
    const { weight, rarity } = weightForCr(band, cr);
    const exclusionTags: EncounterExclusionTag[] = [];
    if (exclusionTags.some((t) => excluded.has(t))) continue;
    entries.push({ monsterId, cr, weight, rarity, exclusionTags });
  }
  entries.sort((a, b) => a.monsterId.localeCompare(b.monsterId));
  return entries;
}

/**
 * Pure weighted pick from a table given a roll in `[0, 1)`.
 * Throws when the table is empty (integrity invariant: no empty band).
 */
export function pickFromTable(table: readonly EncounterTableEntry[], roll: number): string {
  if (table.length === 0) {
    throw new Error('Encounter table is empty — no band may be empty (SRD-1401)');
  }
  const clamped = roll >= 1 ? 0.999999999 : roll < 0 ? 0 : roll;
  const total = table.reduce((sum, e) => sum + e.weight, 0);
  let cursor = clamped * total;
  for (const entry of table) {
    cursor -= entry.weight;
    if (cursor < 0) return entry.monsterId;
  }
  return table[table.length - 1]!.monsterId;
}

/**
 * Deterministic dice-driven weighted pick for a depth.
 * Single Mulberry32 step — no `Math.random()`.
 */
export function pickFromBand(
  rngState: number,
  depth: number,
  options?: GetTableOptions,
): { monsterId: string; nextState: number } {
  const table = getTableForDepth(depth, options);
  const { value, nextState } = nextRandomFloat(rngState >>> 0);
  return { monsterId: pickFromTable(table, value), nextState };
}
