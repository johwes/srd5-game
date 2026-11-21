/**
 * SRD-1404: Special Rooms & Delve Events (Spec 13 §6).
 *
 * Lairs and goody huts, not Diablo affix bingo: at most one special room per
 * floor (seeded pick, never on depth 1).
 *
 * - Treasure vault — locked room (DC 15–20 by depth) holding a hoard chest
 *   with a magic-item bias; trapped 50% (reuses the trap + chest pipelines).
 * - Cursed shrine — 4th `shrineType` (`shrine_cursed`): pay 10 HP or 50 gp
 *   for a seeded boon drawn from the blood/arcane tables (cost shown before
 *   commit, decline free).
 * - Nest — high-density pack room (3–5 of one band monster, bonus XP via the
 *   existing award path); telegraphed by sound text on Listen (SRD-511 nests
 *   are listenable because their encounters sit in neighboring rooms).
 *
 * Presentation reuses the prop pipeline (canvas glyphs, interaction card,
 * fog-of-war identical to existing props). No new art, no new mechanics —
 * only recombined existing ones.
 *
 * Determinism: every roll threads `rngState` (Mulberry32 via
 * `nextRandomFloat` / `rollDie` / `rollMultipleDice`); no `Math.random()`.
 */

import type { LootBundleSpec, SpecialRoomKind } from '@srd5/data';
import { nextRandomFloat, rollDie, rollMultipleDice } from '../dice/prng.js';
import { pickFromBand } from './encounter-tables.js';
import {
  MAGIC_ITEM_TABLE_A,
  MAGIC_ITEM_TABLE_B,
  MAGIC_ITEM_TABLE_C,
  MAGIC_ITEM_TABLE_F,
  MAGIC_ITEM_TABLE_G,
  MAGIC_ITEM_TABLE_H,
} from './loot.js';

/** Chance that a depth ≥ 2 floor carries a special room (0 = none this floor). */
export const SPECIAL_ROOM_FLOOR_CHANCE = 0.4;

/** Vault door/chest lock DC bounds (Spec 13 §6: DC 15–20 by depth). */
export const VAULT_LOCK_DC_MIN = 15;
export const VAULT_LOCK_DC_MAX = 20;

/** Chance the vault hoard chest is trapped (reuses the chest trap pipeline). */
export const VAULT_TRAP_CHANCE = 0.5;

/** Nest pack size bounds (3–5 of one band monster). */
export const NEST_PACK_MIN = 3;
export const NEST_PACK_MAX = 5;

/**
 * Nest bonus XP multiplier, applied to the nest encounter's XP share via the
 * existing award path in `transitionCombatToExploration`.
 */
export const NEST_XP_MULTIPLIER = 1.5;

/** Cursed shrine offering costs (Spec 13 §6). Declining is always free. */
export const CURSED_SHRINE_HP_COST = 10;
export const CURSED_SHRINE_GP_COST = 50;

/** 4th shrineType for the cursed shrine (stored on the prop's `shrineType`). */
export const CURSED_SHRINE_TYPE = 'shrine_cursed';

/** Cursed shrine offering choices. */
export const CURSED_SHRINE_OFFERINGS = ['hp', 'gp', 'decline'] as const;
export type CursedShrineOffering = (typeof CURSED_SHRINE_OFFERINGS)[number];

/** Seeded cursed-shrine boons, drawn from the blood/arcane tables. */
export const CURSED_SHRINE_BOONS = ['blood', 'arcane'] as const;
export type CursedShrineBoon = (typeof CURSED_SHRINE_BOONS)[number];

/**
 * Vault lock DC scaled by depth, clamped to 15–20.
 * Depth 2–3 → 15, rising ~1 per 2 depths to 20 at depth 13+.
 */
export function vaultLockDcForDepth(depth: number): number {
  const d = Math.max(1, Math.floor(depth));
  const dc = 13 + Math.ceil(d / 2);
  return Math.min(VAULT_LOCK_DC_MAX, Math.max(VAULT_LOCK_DC_MIN, dc));
}

export interface SpecialRoomRoll {
  /** Special room kind, or `undefined` when this floor has none. */
  kind?: SpecialRoomKind;
  /**
   * Index into the caller's eligible-room list (meaningful only when `kind`
   * is defined). Callers mod by their eligible count.
   */
  eligibleIndex: number;
  nextState: number;
}

/**
 * Seeded special-room pick for one floor. Never returns a kind on depth 1
 * (fair onboarding floor) and consumes no RNG there, preserving the
 * SRD-1403 bit-exact baseline for depth-1 generation. On deeper floors it
 * consumes one chance float, then (on success) one kind float and one room
 * index float.
 */
export function rollSpecialRoomForFloor(
  rngState: number,
  depth: number,
  eligibleCount: number,
): SpecialRoomRoll {
  if (Math.floor(depth) < 2 || eligibleCount <= 0) {
    return { eligibleIndex: -1, nextState: rngState };
  }
  const chanceRoll = nextRandomFloat(rngState >>> 0);
  if (chanceRoll.value >= SPECIAL_ROOM_FLOOR_CHANCE) {
    return { eligibleIndex: -1, nextState: chanceRoll.nextState };
  }
  const kinds: SpecialRoomKind[] = ['vault', 'cursed_shrine', 'nest'];
  const kindRoll = nextRandomFloat(chanceRoll.nextState);
  const kind = kinds[Math.floor(kindRoll.value * kinds.length) % kinds.length]!;
  const indexRoll = nextRandomFloat(kindRoll.nextState);
  return {
    kind,
    eligibleIndex: Math.floor(indexRoll.value * eligibleCount) % eligibleCount,
    nextState: indexRoll.nextState,
  };
}

/**
 * Rolls the vault hoard: depth-scaled gold plus one guaranteed magic item
 * from a depth-tier table (the magic bias — regular chests carry only a
 * healing potion). All ids resolve in the compendium magic-item tables.
 */
export function rollVaultHoard(
  rngState: number,
  depth: number,
): { loot: LootBundleSpec; nextRng: number } {
  let currentRng = rngState >>> 0;
  const d = Math.max(1, Math.floor(depth));

  const goldRes = rollMultipleDice(currentRng, 4, 6);
  currentRng = goldRes.nextState;
  const gold = goldRes.rolls.reduce((sum, r) => sum + r, 0) * d * 5;

  const table =
    d <= 3
      ? [...MAGIC_ITEM_TABLE_A, ...MAGIC_ITEM_TABLE_B]
      : d <= 6
        ? [...MAGIC_ITEM_TABLE_B, ...MAGIC_ITEM_TABLE_C]
        : d <= 9
          ? [...MAGIC_ITEM_TABLE_F, ...MAGIC_ITEM_TABLE_C]
          : [...MAGIC_ITEM_TABLE_G, ...MAGIC_ITEM_TABLE_H];
  const pickRes = rollDie(currentRng, table.length);
  currentRng = pickRes.nextState;
  const magicItem = table[pickRes.roll - 1]!;

  return {
    loot: {
      gp: gold,
      items: [magicItem, 'potion-of-healing'],
      origin: 'cache',
      sourceName: 'Sealed Vault',
    },
    nextRng: currentRng,
  };
}

/**
 * Seeded cursed-shrine boon roll: `blood` (+2 attack rolls for 3 floors, the
 * blood-table pact without the max-HP cut — the 10 HP / 50 gp offering is
 * the price) or `arcane` (restore all party spell slots, the arcane-table
 * bargain without the specter ambush).
 */
export function rollCursedBoon(rngState: number): { boon: CursedShrineBoon; nextState: number } {
  const roll = nextRandomFloat(rngState >>> 0);
  return {
    boon: roll.value < 0.5 ? 'blood' : 'arcane',
    nextState: roll.nextState,
  };
}

/** Rolls a nest pack size in [3, 5] from one seeded float. */
export function rollNestPackSize(rngState: number): { packSize: number; nextState: number } {
  const roll = nextRandomFloat(rngState >>> 0);
  const span = NEST_PACK_MAX - NEST_PACK_MIN + 1;
  return {
    packSize: NEST_PACK_MIN + (Math.floor(roll.value * span) % span),
    nextState: roll.nextState,
  };
}

/**
 * Picks the nest's single pack monster from the depth's CR band (dice-driven
 * via the shared seeded RNG) plus its pack size. The pack stays in-band, so
 * CR-band integrity gates keep passing.
 */
export function rollNestPack(
  rngState: number,
  depth: number,
): { monsterId: string; packSize: number; nextState: number } {
  const bandPick = pickFromBand(rngState, depth);
  const sizeRoll = rollNestPackSize(bandPick.nextState);
  return { monsterId: bandPick.monsterId, packSize: sizeRoll.packSize, nextState: sizeRoll.nextState };
}

/** Human-readable cost preview for the cursed-shrine card/modal (shown before commit). */
export function cursedShrineCostPreview(): string {
  return `Offer ${CURSED_SHRINE_HP_COST} HP or ${CURSED_SHRINE_GP_COST} gp for a blood/arcane boon — or decline free.`;
}

/** Display name for a special room kind (room rename + Listen telegraphs). */
export function specialRoomDisplayName(kind: SpecialRoomKind): string {
  switch (kind) {
    case 'vault':
      return 'Sealed Vault';
    case 'cursed_shrine':
      return 'Cursed Shrine';
    case 'nest':
      return 'Gnawed Nest';
  }
}
