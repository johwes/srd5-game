/**
 * SRD-1402: Champion Packs — MoM Guardian Stacks (Spec 13 §4).
 *
 * A deterministic champion template applied post-spawn, before initiative.
 * MoM guardian stacks, not Diablo affix bingo: one template, three traits,
 * existing mechanics recombined — never new rules.
 *
 * Template (applied to the spawned combatant):
 * - max HP ×1.5 (rounded, `Math.round`)
 * - +2 to hit (wired into `resolveCombatantAttackProfile` + spell attack paths)
 * - +25% damage (rounded down, `Math.floor`); brutal champions +50% instead
 * - one trait rolled on the run/floor seed:
 *   - `brutal` — +50% damage instead of +25%
 *   - `swift` — +10 ft speed, advantage on initiative
 *   - `warded` — +2 AC
 *
 * Spawn rules:
 * - chance = 8% + 2% per depth, capped at 25%, never on depth 1
 *   (first floor stays a fair onboarding fight).
 * - max 1 champion per encounter.
 *
 * Rewards hook into the SRD-1307 elite hoard path: champion kills always
 * roll the hoard table regardless of CR (`isChampion` counts as elite in
 * `rollCorpseLoot`), keeping the `monster_drop` origin tag so war-battle
 * awards never stack on the same kill.
 *
 * Determinism: every roll threads `rngState` (Mulberry32 via
 * `nextRandomFloat`); no `Math.random()`.
 */

import { nextRandomFloat } from '../dice/prng.js';
import type { Combatant } from '../combat/types.js';

/** Champion trait ids (Spec 13 §4). */
export const CHAMPION_TRAITS = ['brutal', 'swift', 'warded'] as const;
export type ChampionTrait = (typeof CHAMPION_TRAITS)[number];

/** Base spawn chance and per-depth increment (capped). */
export const CHAMPION_SPAWN_BASE_CHANCE = 0.08;
export const CHAMPION_SPAWN_PER_DEPTH = 0.02;
export const CHAMPION_SPAWN_CAP = 0.25;

/** Flat to-hit bonus applied to every champion attack roll. */
export const CHAMPION_TO_HIT_BONUS = 2;
/** AC bonus for the `warded` trait (existing mechanic). */
export const CHAMPION_WARDED_AC_BONUS = 2;
/** Speed bonus for the `swift` trait (existing mechanic, feet). */
export const CHAMPION_SWIFT_SPEED_BONUS_FEET = 10;

/**
 * Spawn chance for a dungeon depth. Depth < 1 clamps to 1.
 * Never spawns on depth 1 (fair onboarding fight).
 */
export function championSpawnChanceForDepth(depth: number): number {
  const d = Math.max(1, Math.floor(depth));
  if (d <= 1) return 0;
  return Math.min(CHAMPION_SPAWN_CAP, CHAMPION_SPAWN_BASE_CHANCE + CHAMPION_SPAWN_PER_DEPTH * d);
}

export interface ChampionRollResult {
  /** True when this encounter promotes one monster to champion. */
  isChampion: boolean;
  /** Rolled trait (present exactly when `isChampion` is true). */
  trait?: ChampionTrait;
  nextState: number;
}

/**
 * Deterministic per-encounter champion roll: one Mulberry32 float for the
 * spawn chance, then (on success) a second float for the trait index.
 */
export function rollChampionForEncounter(rngState: number, depth: number): ChampionRollResult {
  const chance = championSpawnChanceForDepth(depth);
  const chanceRoll = nextRandomFloat(rngState >>> 0);
  if (chance <= 0 || chanceRoll.value >= chance) {
    return { isChampion: false, nextState: chanceRoll.nextState };
  }
  const traitRoll = nextRandomFloat(chanceRoll.nextState);
  const trait = CHAMPION_TRAITS[Math.floor(traitRoll.value * CHAMPION_TRAITS.length) % CHAMPION_TRAITS.length]!;
  return { isChampion: true, trait, nextState: traitRoll.nextState };
}

/** Damage multiplier for a champion trait (brutal = +50%, else +25%). */
export function championDamageMultiplier(trait: ChampionTrait): number {
  return trait === 'brutal' ? 1.5 : 1.25;
}

/** Damage multiplier for a combatant (1 when not a champion). */
export function getChampionDamageMultiplier(combatant: Pick<Combatant, 'isChampion' | 'championTrait'>): number {
  if (!combatant.isChampion) return 1;
  if (combatant.championTrait === 'brutal') return 1.5;
  return 1.25;
}

/** To-hit bonus for a combatant (+2 when champion, else 0). */
export function getChampionAttackBonus(combatant: Pick<Combatant, 'isChampion'>): number {
  return combatant.isChampion === true ? CHAMPION_TO_HIT_BONUS : 0;
}

/**
 * Applies the champion template to an already-spawned combatant.
 * Pure (returns a new object): HP ×1.5 rounded, trait effects, flags.
 * To-hit (+2) and damage scaling are read at attack resolution time via
 * `getChampionAttackBonus` / `getChampionDamageMultiplier`.
 */
export function applyChampionTemplate<T extends Combatant>(combatant: T, trait: ChampionTrait): T {
  const maxHp = Math.max(1, Math.round(combatant.maxHp * 1.5));
  return {
    ...combatant,
    name: combatant.name.startsWith('Champion ') ? combatant.name : `Champion ${combatant.name}`,
    maxHp,
    currentHp: maxHp,
    armorClass: trait === 'warded' ? combatant.armorClass + CHAMPION_WARDED_AC_BONUS : combatant.armorClass,
    speedFeet: trait === 'swift' ? combatant.speedFeet + CHAMPION_SWIFT_SPEED_BONUS_FEET : combatant.speedFeet,
    initiativeRollMode: trait === 'swift' ? 'advantage' : combatant.initiativeRollMode,
    isChampion: true,
    championTrait: trait,
  };
}

/**
 * Scales a rolled damage total by the attacker's champion multiplier,
 * rounding down per Spec 13 §4. Returns the input unchanged for
 * non-champions.
 */
export function scaleChampionDamage(
  rawDamage: number,
  attacker: Pick<Combatant, 'isChampion' | 'championTrait'>,
): number {
  const mult = getChampionDamageMultiplier(attacker);
  if (mult === 1) return rawDamage;
  return Math.floor(rawDamage * mult);
}

/** Tooltip line for badges: `Champion · brutal — +50% damage`. */
export function championTooltipLine(trait: ChampionTrait): string {
  switch (trait) {
    case 'brutal':
      return 'Champion · brutal — +50% damage';
    case 'swift':
      return 'Champion · swift — +10 ft, advantage on initiative';
    case 'warded':
      return 'Champion · warded — +2 AC';
  }
}

/** Combat-log headline emitted alongside `ELITE_SPAWNED`. */
export function championSpawnHeadline(name: string, trait: ChampionTrait): string {
  return `${name} — Champion (${trait}) bars the way! ${championTooltipLine(trait)}`;
}
