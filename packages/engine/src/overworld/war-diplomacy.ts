import { z } from 'zod';
import { normalizeSeed, nextRandomFloat, rollDie } from '../dice/prng.js';
import { rollD20 } from '../dice/evaluator.js';
import type { DerivedCharacterSheet } from '../character/schemas.js';
import {
  type OverworldMap,
  OverworldMapSchema,
} from './schemas.js';
import {
  type WarState,
  WarStateSchema,
  getPlayerWarNation,
  getWarNation,
  isTruceActive,
} from './war.js';
import { buildWarSquad, type BuiltWarSquad } from './war-squads.js';
import { RealmError } from './realm-error.js';

/**
 * SRD-1104 — Diplomacy, sub-faction patronage & enemy-territory patrols
 * (Spec 10 Sections 6–7).
 *
 * - **Temporary Truces**: a Persuasion challenge (+ optional gold tribute)
 *   pauses a rival nation's attacks and patrol hostility for 12–18 days.
 * - **Mercenary Companies / Thieves' Guild cells**: gold + CHA checks with
 *   strategic effects (Military Power vs remote sabotage of an enemy mine or
 *   supply depot).
 * - **Sub-faction patronage chains**: Local Orc Tribe (3 quests → ongoing
 *   guerrilla warfare drain) and Local Druid Circle (2 quests → Arcana/Morale
 *   Power + a permanent party blessing hook).
 * - **Enemy territory patrols**: road vs off-road encounter rates mitigated
 *   by Survival/Stealth, Bluff/Evade/Bribe/Fight options, per-nation Threat
 *   (`0..100`, pursuit at `>= 55`) and natural decay (`-6`/day outside the
 *   nation's territory, `-2`/day undetected inside).
 *
 * All functions are pure and deterministic. Every random choice threads the
 * seeded Mulberry32 PRNG (`rngState`); `Math.random()` is never called.
 * Inputs are never mutated — updated copies are returned.
 */

// ---------------------------------------------------------------------------
// Shared 5e sheet readers (mirrors the SRD-1103 approach resolver)
// ---------------------------------------------------------------------------

function skillBonusOf(sheet: DerivedCharacterSheet, skillId: string): number {
  const skills = sheet.skills as unknown as Record<string, { totalBonus?: number } | undefined>;
  const entry = skills[skillId];
  if (entry && typeof entry.totalBonus === 'number') return entry.totalBonus;
  return 0;
}

function bestBonusOf(party: DerivedCharacterSheet[], ...skillIds: string[]): { bonus: number; sheet: DerivedCharacterSheet } {
  let best = { bonus: Number.NEGATIVE_INFINITY, sheet: party[0]! };
  for (const sheet of party) {
    const bonus = Math.max(...skillIds.map((id) => skillBonusOf(sheet, id)));
    if (bonus > best.bonus) best = { bonus, sheet };
  }
  return best;
}

function availableSlotsAt(sheet: DerivedCharacterSheet, level: number): number {
  const pool = (sheet.spellcasting?.spellSlots as unknown as Record<number, { available?: number } | undefined>)?.[level];
  return pool?.available ?? 0;
}

function findSpellCaster(
  party: DerivedCharacterSheet[],
  spellId: string,
  slotLevel: number,
): DerivedCharacterSheet | null {
  for (const sheet of party) {
    const prepared = new Set([
      ...(sheet.spellcasting?.preparedOrKnownSpellIds ?? []),
      ...(sheet.spellcasting?.spellbookSpellIds ?? []),
      ...(sheet.spellcasting?.cantripIds ?? []),
    ]);
    if (!prepared.has(spellId)) continue;
    for (let level = slotLevel; level <= 9; level++) {
      if (availableSlotsAt(sheet, level) > 0) return sheet;
    }
  }
  return null;
}

function deductSlot(sheet: DerivedCharacterSheet, requestedLevel: number): { updated: DerivedCharacterSheet; slotLevel: number } {
  const next = structuredClone(sheet);
  const slots = next.spellcasting.spellSlots as unknown as Record<
    number,
    { max: number; expended: number; available: number }
  >;
  for (let level = requestedLevel; level <= 9; level++) {
    const pool = slots[level];
    if (pool && pool.available > 0) {
      pool.expended += 1;
      pool.available = Math.max(0, pool.available - 1);
      return { updated: next, slotLevel: level };
    }
  }
  throw new RealmError(`Caster ${sheet.name} has no available spell slot at level ${requestedLevel}+`);
}

// ---------------------------------------------------------------------------
// Threat / Heat (Spec 10 Section 7)
// ---------------------------------------------------------------------------

export const WAR_THREAT_TIERS = ['unnoticed', 'suspicious', 'hunted', 'most_wanted'] as const;
export const WarThreatTierSchema = z.enum(WAR_THREAT_TIERS);
export type WarThreatTier = z.infer<typeof WarThreatTierSchema>;

/** Threat tier bands (Spec 10 §7). */
export function getWarThreatTier(level: number): WarThreatTier {
  if (level >= 80) return 'most_wanted';
  if (level >= 55) return 'hunted';
  if (level >= 25) return 'suspicious';
  return 'unnoticed';
}

/** Threat at or above this level marks the party as hunted (pursuit squads). */
export const WAR_THREAT_PURSUIT_THRESHOLD = 55;
/** Threat gained for killing an enemy patrol (Spec 10 §7). */
export const WAR_THREAT_KILL_PATROL_GAIN = 20;
/** Threat gained for bribing a patrol captain (Spec 10 §7). */
export const WAR_THREAT_BRIBE_GAIN = 5;
/** Daily decay outside the nation's territory (Spec 10 §7). */
export const WAR_THREAT_DECAY_OUTSIDE_PER_DAY = 6;
/** Daily decay inside the nation's territory while undetected (Spec 10 §7). */
export const WAR_THREAT_DECAY_INSIDE_PER_DAY = 2;

export function isPursuitActiveForThreat(level: number): boolean {
  return level >= WAR_THREAT_PURSUIT_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Diplomacy state (threats + sub-faction progress live beside `WarState`)
// ---------------------------------------------------------------------------

export const WAR_SUBFACTION_IDS = ['local_orc_tribe', 'local_druid_circle'] as const;
export const WarSubfactionIdSchema = z.enum(WAR_SUBFACTION_IDS);
export type WarSubfactionId = z.infer<typeof WarSubfactionIdSchema>;

/** Ordered quest chains: the Orc tribe needs 3 quests, the Druid Circle 2. */
export const WAR_SUBFACTION_QUESTS: Record<WarSubfactionId, readonly string[]> = {
  local_orc_tribe: ['orc-raid-relief', 'orc-warchief-parley', 'orc-war-path'],
  local_druid_circle: ['druid-blighted-grove', 'druid-circle-rite'],
};

export const SubFactionProgressSchema = z.object({
  id: WarSubfactionIdSchema,
  completedQuestIds: z.array(z.string().min(1)).default([]),
  allied: z.boolean().default(false),
});
export type SubFactionProgress = z.infer<typeof SubFactionProgressSchema>;

export const WarDiplomacyStateSchema = z.object({
  /** Per-nation Threat level (`0..100`); absent nations are `unnoticed` (0). */
  threats: z.record(z.string().min(1), z.number().int().min(0).max(100)).default({}),
  subfactions: z.record(z.string().min(1), SubFactionProgressSchema).default({}),
  /** Set when the Druid Circle chain completes (forest-stealth/healing hook). */
  druidBlessingActive: z.boolean().default(false),
});
export type WarDiplomacyState = z.infer<typeof WarDiplomacyStateSchema>;

export function createWarDiplomacyState(): WarDiplomacyState {
  return WarDiplomacyStateSchema.parse({});
}

export function getNationThreat(diplomacy: WarDiplomacyState, nationId: string): number {
  return diplomacy.threats[nationId] ?? 0;
}

/** Adds (or removes) Threat for a nation, clamped to `0..100`. */
export function addNationThreat(
  diplomacy: WarDiplomacyState,
  nationId: string,
  delta: number,
): WarDiplomacyState {
  const next = structuredClone(diplomacy);
  const updated = Math.max(0, Math.min(100, getNationThreat(next, nationId) + delta));
  if (updated === 0) delete next.threats[nationId];
  else next.threats[nationId] = updated;
  return next;
}

export const DecayWarThreatsOptionsSchema = z.object({
  /** Full in-game days elapsed since the last decay. */
  days: z.number().int().min(1).default(1),
  /** Nations whose territory the party occupied *detected* (no decay there). */
  detectedNationIds: z.array(z.string().min(1)).default([]),
  /** Nations whose territory the party crossed *undetected* (slow decay). */
  undetectedNationIds: z.array(z.string().min(1)).default([]),
});
export type DecayWarThreatsOptions = z.input<typeof DecayWarThreatsOptionsSchema>;

export interface DecayWarThreatsResult {
  diplomacy: WarDiplomacyState;
  /** Nations whose pursuit stood down by dropping below the hunted threshold. */
  stoodDown: string[];
  headlines: string[];
}

/**
 * Applies natural Threat decay (Spec 10 §7): `-6`/day outside a nation's
 * territory, `-2`/day undetected inside it, no decay while detected inside.
 * Pursuit automatically clears below `55` (reported via `stoodDown`).
 */
export function decayWarThreats(
  diplomacy: WarDiplomacyState,
  rawOptions: Partial<DecayWarThreatsOptions> = {},
): DecayWarThreatsResult {
  const options = DecayWarThreatsOptionsSchema.parse(rawOptions);
  const detected = new Set(options.detectedNationIds);
  const undetected = new Set(options.undetectedNationIds);
  let next = structuredClone(diplomacy);
  const stoodDown: string[] = [];
  const headlines: string[] = [];
  for (const nationId of Object.keys(next.threats)) {
    const before = next.threats[nationId]!;
    if (detected.has(nationId)) continue;
    const perDay = undetected.has(nationId)
      ? WAR_THREAT_DECAY_INSIDE_PER_DAY
      : WAR_THREAT_DECAY_OUTSIDE_PER_DAY;
    const after = Math.max(0, before - perDay * options.days);
    if (after === 0) delete next.threats[nationId];
    else next.threats[nationId] = after;
    if (isPursuitActiveForThreat(before) && !isPursuitActiveForThreat(after)) {
      stoodDown.push(nationId);
      headlines.push(`Hunter-killer pursuit from ${nationId} has stood down — the heat has cooled.`);
    }
  }
  return { diplomacy: next, stoodDown, headlines };
}

// ---------------------------------------------------------------------------
// Temporary Truces (Spec 10 Section 6)
// ---------------------------------------------------------------------------

export const TRUCE_BASE_DC = 14;
export const TRUCE_TRIBUTE_DC_RELIEF = 2;
export const TRUCE_TRIBUTE_RELIEF_THRESHOLD = 100;
export const TRUCE_TRIBUTE_DC_DEEP_RELIEF = 4;
export const TRUCE_TRIBUTE_DEEP_THRESHOLD = 250;
export const TRUCE_MIN_DURATION_DAYS = 12;
export const TRUCE_DURATION_SPREAD = 7; // 1d7 + 11 → 12..18 days

export const NegotiateTruceOptionsSchema = z.object({
  war: WarStateSchema,
  party: z.array(z.any()).min(1).max(6),
  targetNationId: z.string().min(1),
  rngState: z.number().int().default(0),
  day: z.number().int().min(1).optional(),
  /** Gold tribute offered alongside the parley (spent only on success). */
  tributeGold: z.number().int().min(0).default(0),
});
export type NegotiateTruceOptions = z.input<typeof NegotiateTruceOptionsSchema>;

export interface NegotiatedTruce {
  war: WarState;
  success: boolean;
  actorId: string;
  actorName: string;
  bonus: number;
  dc: number;
  naturalRoll: number;
  total: number;
  /** Truce length in days (`12–18` on success, `0` on failure). */
  durationDays: number;
  untilDay: number | null;
  goldSpent: number;
  headline: string;
  nextRngState: number;
}

/**
 * Parleys a Temporary Truce with a rival nation: the best live party
 * Persuasion bonus is tested against DC 14 (12 with ≥100gp tribute, 10 with
 * ≥250gp). Success halts that nation's attacks and patrol hostility until
 * `untilDay` (12–18 days); the tribute is spent only when accepted.
 */
export function negotiateTruce(rawOptions: NegotiateTruceOptions): NegotiatedTruce {
  const options = NegotiateTruceOptionsSchema.parse(rawOptions);
  const war = WarStateSchema.parse(options.war);
  const party = options.party as DerivedCharacterSheet[];
  const day = options.day ?? war.currentDay;
  const target = getWarNation(war, options.targetNationId);
  if (target.isPlayerNation) {
    throw new RealmError('Cannot negotiate a truce with your own nation');
  }
  if (isTruceActive(war, war.playerNationId, target.id, day)) {
    throw new RealmError(`A truce with ${target.name} is already active`);
  }

  let dc = TRUCE_BASE_DC;
  if (options.tributeGold >= TRUCE_TRIBUTE_DEEP_THRESHOLD) dc -= TRUCE_TRIBUTE_DC_DEEP_RELIEF;
  else if (options.tributeGold >= TRUCE_TRIBUTE_RELIEF_THRESHOLD) dc -= TRUCE_TRIBUTE_DC_RELIEF;

  const { bonus, sheet } = bestBonusOf(party, 'persuasion');
  const rngState = normalizeSeed(options.rngState);
  const roll = rollD20(rngState, { modifier: bonus });
  const success = roll.total >= dc;

  if (!success) {
    return {
      war,
      success: false,
      actorId: sheet.id,
      actorName: sheet.name,
      bonus,
      dc,
      naturalRoll: roll.naturalRoll,
      total: roll.total,
      durationDays: 0,
      untilDay: null,
      goldSpent: 0,
      headline: `${sheet.name} fails to move ${target.name} (${roll.total} vs DC ${dc}) — the war grinds on, no tribute paid.`,
      nextRngState: roll.nextState,
    };
  }

  const durationRoll = rollDie(roll.nextState, TRUCE_DURATION_SPREAD);
  const durationDays = durationRoll.roll + (TRUCE_MIN_DURATION_DAYS - 1);
  const untilDay = day + durationDays;
  const nextWar: WarState = structuredClone(war);
  nextWar.truces = [...nextWar.truces, { nationIdA: war.playerNationId, nationIdB: target.id, untilDay }];
  nextWar.chronicle = [
    ...nextWar.chronicle,
    {
      day,
      kind: 'truce_signed',
      headline: `${getPlayerWarNation(war).name} signs a ${durationDays}-day truce with ${target.name}.`,
    },
  ];
  return {
    war: WarStateSchema.parse(nextWar),
    success: true,
    actorId: sheet.id,
    actorName: sheet.name,
    bonus,
    dc,
    naturalRoll: roll.naturalRoll,
    total: roll.total,
    durationDays,
    untilDay,
    goldSpent: options.tributeGold,
    headline: `${sheet.name} seals a ${durationDays}-day truce with ${target.name} (${roll.total} vs DC ${dc}).`,
    nextRngState: durationRoll.nextState,
  };
}

// ---------------------------------------------------------------------------
// Mercenary Companies & Thieves' Guild cells (Spec 10 Section 6)
// ---------------------------------------------------------------------------

export const MERCENARY_BASE_COST_GOLD = 200;
export const MERCENARY_GILDED_DISCOUNT = 0.15;
export const MERCENARY_CHA_DISCOUNT = 0.2;
export const MERCENARY_NEGOTIATION_DC = 13;
export const MERCENARY_POWER_RELIABLE = 5;
export const MERCENARY_POWER_STANDARD = 3;

export const HireMercenariesOptionsSchema = z.object({
  war: WarStateSchema,
  /** Optional party: a Persuasion test earns a discount + reliable troops. */
  party: z.array(z.any()).min(1).max(6).optional(),
  rngState: z.number().int().default(0),
  goldAvailable: z.number().int().min(0),
  day: z.number().int().min(1).optional(),
});
export type HireMercenariesOptions = z.input<typeof HireMercenariesOptionsSchema>;

export interface HiredMercenaries {
  war: WarState;
  success: boolean;
  reliable: boolean;
  cost: number;
  goldSpent: number;
  remainingGold: number;
  powerGained: number;
  headline: string;
  nextRngState: number;
}

/**
 * Hires a Mercenary Company: gold buys `+Military` War Power for the player's
 * nation (`+5` reliable / `+3` standard). The Gilded League's Mercenary
 * Coffers cut 15% off; a DC-13 Persuasion test cuts a further 20% and secures
 * reliable troops. Parties without gold for the listed price are turned away.
 */
export function hireMercenaryCompany(rawOptions: HireMercenariesOptions): HiredMercenaries {
  const options = HireMercenariesOptionsSchema.parse(rawOptions);
  const war = WarStateSchema.parse(options.war);
  const day = options.day ?? war.currentDay;
  const player = getPlayerWarNation(war);
  let cost = MERCENARY_BASE_COST_GOLD;
  if (war.playerNationId === 'gilded-league') {
    cost = Math.ceil(cost * (1 - MERCENARY_GILDED_DISCOUNT));
  }

  let rngState = normalizeSeed(options.rngState);
  let reliable = false;
  let headlineBonus = '';
  const party = (options.party ?? []) as DerivedCharacterSheet[];
  if (party.length > 0) {
    const { bonus, sheet } = bestBonusOf(party, 'persuasion');
    const roll = rollD20(rngState, { modifier: bonus });
    rngState = roll.nextState;
    if (roll.total >= MERCENARY_NEGOTIATION_DC) {
      reliable = true;
      cost = Math.ceil(cost * (1 - MERCENARY_CHA_DISCOUNT));
      headlineBonus = ` ${sheet.name} haggles the condottieri down (${roll.total} vs DC ${MERCENARY_NEGOTIATION_DC}).`;
    } else {
      headlineBonus = ` ${sheet.name} fails to impress the captains (${roll.total} vs DC ${MERCENARY_NEGOTIATION_DC}) — standard sellswords only.`;
    }
  }

  if (options.goldAvailable < cost) {
    return {
      war,
      success: false,
      reliable: false,
      cost,
      goldSpent: 0,
      remainingGold: options.goldAvailable,
      powerGained: 0,
      headline: `The company demands ${cost}gp — the war chest holds ${options.goldAvailable}gp. No deal.${headlineBonus}`,
      nextRngState: rngState,
    };
  }

  const powerGained = reliable ? MERCENARY_POWER_RELIABLE : MERCENARY_POWER_STANDARD;
  const nextWar: WarState = structuredClone(war);
  nextWar.nations[war.playerNationId]!.power.military += powerGained;
  nextWar.chronicle = [
    ...nextWar.chronicle,
    {
      day,
      kind: 'mercenaries_hired',
      headline: `${player.name} hires a mercenary company (+${powerGained} Military).${headlineBonus}`.trim(),
    },
  ];
  return {
    war: WarStateSchema.parse(nextWar),
    success: true,
    reliable,
    cost,
    goldSpent: cost,
    remainingGold: options.goldAvailable - cost,
    powerGained,
    headline: `${player.name} musters a mercenary company for ${cost}gp (+${powerGained} Military).${headlineBonus}`.trim(),
    nextRngState: rngState,
  };
}

export const THIEVES_GUILD_BASE_COST_GOLD = 150;
export const THIEVES_GUILD_NEGOTIATION_DC = 13;

export const HireThievesGuildOptionsSchema = z.object({
  war: WarStateSchema,
  map: z.any(),
  party: z.array(z.any()).min(1).max(6),
  targetPoiId: z.string().min(1),
  rngState: z.number().int().default(0),
  goldAvailable: z.number().int().min(0),
  day: z.number().int().min(1).optional(),
});
export type HireThievesGuildOptions = z.input<typeof HireThievesGuildOptionsSchema>;

export interface HiredThievesGuild {
  war: WarState;
  map: OverworldMap;
  success: boolean;
  goldSpent: number;
  remainingGold: number;
  headline: string;
  nextRngState: number;
}

/**
 * Retains a Thieves' Guild Cell for remote sabotage against an intact
 * enemy-owned `mine` or `supply_depot` (DC-13 Deception/Persuasion for a clean
 * job; exposure on failure means no effect). The cell keeps its fee either
 * way; without the asking price there is no job at all.
 */
export function hireThievesGuild(rawOptions: HireThievesGuildOptions): HiredThievesGuild {
  const options = HireThievesGuildOptionsSchema.parse(rawOptions);
  const war = WarStateSchema.parse(options.war);
  const map = OverworldMapSchema.parse(options.map) as OverworldMap;
  const party = options.party as DerivedCharacterSheet[];
  const day = options.day ?? war.currentDay;
  const cost = THIEVES_GUILD_BASE_COST_GOLD;

  const poi = map.pois[options.targetPoiId];
  if (!poi) throw new RealmError(`Unknown POI '${options.targetPoiId}'`);
  if (poi.kind !== 'mine' && poi.kind !== 'supply_depot') {
    throw new RealmError(`The guild only strikes mines and supply depots (target is '${poi.kind}')`);
  }
  const ownerId = poi.ownerNationId ?? poi.factionId;
  if (!ownerId || ownerId === war.playerNationId) {
    throw new RealmError(`The guild only strikes rival holdings (${poi.name} is not a rival asset)`);
  }
  if (!war.nations[ownerId]) throw new RealmError(`Unknown war nation '${ownerId}'`);
  if (poi.strategicStatus !== 'intact') {
    throw new RealmError(`The guild only strikes intact holdings (${poi.name} is '${poi.strategicStatus}')`);
  }

  let rngState = normalizeSeed(options.rngState);
  if (options.goldAvailable < cost) {
    return {
      war,
      map,
      success: false,
      goldSpent: 0,
      remainingGold: options.goldAvailable,
      headline: `The cell demands ${cost}gp — the war chest holds ${options.goldAvailable}gp. No job.`,
      nextRngState: rngState,
    };
  }

  const { bonus, sheet } = bestBonusOf(party, 'deception', 'persuasion');
  const roll = rollD20(rngState, { modifier: bonus });
  rngState = roll.nextState;
  if (roll.total < THIEVES_GUILD_NEGOTIATION_DC) {
    return {
      war,
      map,
      success: false,
      goldSpent: cost,
      remainingGold: options.goldAvailable - cost,
      headline: `${sheet.name}'s cut-outs are recognized (${roll.total} vs DC ${THIEVES_GUILD_NEGOTIATION_DC}) — the ${poi.kind} job is blown, fee kept.`,
      nextRngState: rngState,
    };
  }

  const nextMap: OverworldMap = structuredClone(map);
  nextMap.pois[options.targetPoiId] = {
    ...poi,
    strategicStatus: 'sabotaged',
    statusChangedDay: day,
  };
  OverworldMapSchema.parse(nextMap);
  const ownerName = war.nations[ownerId]!.name;
  const nextWar: WarState = structuredClone(war);
  nextWar.chronicle = [
    ...nextWar.chronicle,
    {
      day,
      kind: 'covert_strike',
      headline: `Guild cellars flood ${poi.name} — ${ownerName} logistics falter.`,
    },
  ];
  return {
    war: WarStateSchema.parse(nextWar),
    map: nextMap,
    success: true,
    goldSpent: cost,
    remainingGold: options.goldAvailable - cost,
    headline: `${sheet.name} runs a clean cut-out job (${roll.total} vs DC ${THIEVES_GUILD_NEGOTIATION_DC}) — ${poi.name} sabotaged for ${cost}gp.`,
    nextRngState: rngState,
  };
}

// ---------------------------------------------------------------------------
// Sub-faction patronage chains (Spec 10 Section 6)
// ---------------------------------------------------------------------------

export const ORC_GUERRILLA_DRAIN_ID = 'orc-guerrilla';
export const ORC_GUERRILLA_MILITARY_DRAIN = 3;
export const ORC_GUERRILLA_ECONOMY_DRAIN = 3;
export const DRUID_BLESSING_ARCANA = 5;
export const DRUID_BLESSING_MORALE = 5;
/** Off-road forest Survival/Stealth bonus while the Druid blessing holds. */
export const DRUID_BLESSING_TRAIL_BONUS = 2;

export const CompleteSubFactionQuestOptionsSchema = z.object({
  diplomacy: WarDiplomacyStateSchema,
  war: WarStateSchema,
  subfactionId: WarSubfactionIdSchema,
  questId: z.string().min(1),
  /** Rival nation the Orc guerrillas bleed (required to seal the alliance). */
  targetNationId: z.string().min(1).optional(),
  day: z.number().int().min(1).optional(),
});
export type CompleteSubFactionQuestOptions = z.input<typeof CompleteSubFactionQuestOptionsSchema>;

export interface CompletedSubFactionQuest {
  diplomacy: WarDiplomacyState;
  war: WarState;
  allied: boolean;
  headline: string;
}

/** Off-road Survival/Stealth bonus from the Druid blessing (`0` or `+2`). */
export function getDruidBlessingTrailBonus(diplomacy: WarDiplomacyState): number {
  return diplomacy.druidBlessingActive ? DRUID_BLESSING_TRAIL_BONUS : 0;
}

/**
 * Advances a sub-faction patronage chain. Quests must complete in order and
 * exactly once; sealing the final quest forges the alliance:
 * - Orc Tribe → ongoing `-3` Military/Economy drain on the target rival.
 * - Druid Circle → `+5` Arcana / `+5` Morale for the player's nation plus the
 *   permanent trail blessing flag.
 */
export function completeSubFactionQuest(rawOptions: CompleteSubFactionQuestOptions): CompletedSubFactionQuest {
  const options = CompleteSubFactionQuestOptionsSchema.parse(rawOptions);
  const diplomacy = WarDiplomacyStateSchema.parse(options.diplomacy);
  const war = WarStateSchema.parse(options.war);
  const day = options.day ?? war.currentDay;
  const chain = WAR_SUBFACTION_QUESTS[options.subfactionId];
  const questIndex = chain.indexOf(options.questId);
  if (questIndex === -1) {
    throw new RealmError(`Quest '${options.questId}' is not part of the ${options.subfactionId} chain`);
  }

  const nextDiplomacy = structuredClone(diplomacy);
  const progress: SubFactionProgress = nextDiplomacy.subfactions[options.subfactionId] ?? {
    id: options.subfactionId,
    completedQuestIds: [],
    allied: false,
  };
  if (progress.allied) throw new RealmError(`The ${options.subfactionId} alliance is already sealed`);
  const expected = chain[progress.completedQuestIds.length]!;
  if (options.questId !== expected) {
    throw new RealmError(`Expected ${options.subfactionId} quest '${expected}' next, not '${options.questId}'`);
  }
  progress.completedQuestIds = [...progress.completedQuestIds, options.questId];

  const nextWar: WarState = structuredClone(war);
  const isFinal = progress.completedQuestIds.length === chain.length;
  if (!isFinal) {
    nextDiplomacy.subfactions[options.subfactionId] = progress;
    return {
      diplomacy: nextDiplomacy,
      war: WarStateSchema.parse(nextWar),
      allied: false,
      headline: `${labelForSubfaction(options.subfactionId)} marks '${options.questId}' done (${progress.completedQuestIds.length}/${chain.length}).`,
    };
  }

  progress.allied = true;
  nextDiplomacy.subfactions[options.subfactionId] = progress;
  if (options.subfactionId === 'local_orc_tribe') {
    const targetId = options.targetNationId;
    if (!targetId) throw new RealmError('Sealing the Orc alliance requires a targetNationId');
    const target = getWarNation(nextWar, targetId);
    if (target.isPlayerNation) throw new RealmError('Orc guerrillas cannot target your own nation');
    nextWar.guerrillaDrains = [
      ...nextWar.guerrillaDrains,
      {
        id: ORC_GUERRILLA_DRAIN_ID,
        label: 'Orc guerrilla warfare',
        targetNationId: targetId,
        militaryDrain: ORC_GUERRILLA_MILITARY_DRAIN,
        economyDrain: ORC_GUERRILLA_ECONOMY_DRAIN,
      },
    ];
    nextWar.chronicle = [
      ...nextWar.chronicle,
      {
        day,
        kind: 'guerrilla_started',
        headline: `The Local Orc Tribe rides against ${target.name} — guerrilla warfare drains its war machine.`,
      },
    ];
    return {
      diplomacy: nextDiplomacy,
      war: WarStateSchema.parse(nextWar),
      allied: true,
      headline: `The Local Orc Tribe seals its blood-oath: ${target.name} bleeds -${ORC_GUERRILLA_MILITARY_DRAIN} Military / -${ORC_GUERRILLA_ECONOMY_DRAIN} Economy every war tick.`,
    };
  }

  const player = nextWar.nations[nextWar.playerNationId]!;
  player.power.arcana += DRUID_BLESSING_ARCANA;
  player.power.morale += DRUID_BLESSING_MORALE;
  nextDiplomacy.druidBlessingActive = true;
  nextWar.chronicle = [
    ...nextWar.chronicle,
    {
      day,
      kind: 'druid_blessing',
      headline: `The Local Druid Circle blesses ${player.name} (+${DRUID_BLESSING_ARCANA} Arcana, +${DRUID_BLESSING_MORALE} Morale, trail blessing).`,
    },
  ];
  return {
    diplomacy: nextDiplomacy,
    war: WarStateSchema.parse(nextWar),
    allied: true,
    headline: `The Local Druid Circle seals its covenant: +${DRUID_BLESSING_ARCANA} Arcana / +${DRUID_BLESSING_MORALE} Morale and a permanent trail blessing.`,
  };
}

function labelForSubfaction(id: WarSubfactionId): string {
  return id === 'local_orc_tribe' ? 'The Local Orc Tribe' : 'The Local Druid Circle';
}

// ---------------------------------------------------------------------------
// Enemy territory patrols (Spec 10 Section 7)
// ---------------------------------------------------------------------------

export const PATROL_ENCOUNTER_ROAD_CHANCE = 0.35;
export const PATROL_ENCOUNTER_OFFROAD_CHANCE = 0.12;
export const PATROL_MITIGATION_PER_BONUS = 0.015;
export const PATROL_MIN_CHANCE = 0.02;
export const PATROL_BLUFF_DC = 13;
export const PATROL_EVADE_DC = 13;
export const PATROL_BRIBE_COST_GOLD = 50;

export const RollPatrolEncounterOptionsSchema = z.object({
  rngState: z.number().int().default(0),
  /** True on enemy roads (fast but watched); false off-road (slow but quiet). */
  onRoad: z.boolean(),
  nationId: z.string().min(1),
  party: z.array(z.any()).min(1).max(6),
  /** When given, an active truce suppresses the patrol entirely. */
  war: WarStateSchema.optional(),
  day: z.number().int().min(1).optional(),
  /** Blessing / guide bonuses applied to the Survival/Stealth mitigation. */
  trailBonus: z.number().int().default(0),
});
export type RollPatrolEncounterOptions = z.input<typeof RollPatrolEncounterOptionsSchema>;

export interface RolledPatrolEncounter {
  encountered: boolean;
  reason: 'truce' | 'clear' | 'patrol';
  chance: number;
  mitigationBonus: number;
  nextRngState: number;
}

/**
 * Rolls one enemy-territory patrol check. Roads carry a substantially higher
 * encounter rate; the party's best Survival/Stealth bonus (plus trail bonuses)
 * mitigates off-road and on-road checks alike. Truced nations never patrol.
 */
export function rollPatrolEncounter(rawOptions: RollPatrolEncounterOptions): RolledPatrolEncounter {
  const options = RollPatrolEncounterOptionsSchema.parse(rawOptions);
  const party = options.party as DerivedCharacterSheet[];
  let rngState = normalizeSeed(options.rngState);

  if (options.war) {
    const war = WarStateSchema.parse(options.war);
    if (isTruceActive(war, war.playerNationId, options.nationId, options.day ?? war.currentDay)) {
      return { encountered: false, reason: 'truce', chance: 0, mitigationBonus: 0, nextRngState: rngState };
    }
  }

  const { bonus } = bestBonusOf(party, 'survival', 'stealth');
  const mitigationBonus = Math.max(0, bonus) + Math.max(0, options.trailBonus);
  const base = options.onRoad ? PATROL_ENCOUNTER_ROAD_CHANCE : PATROL_ENCOUNTER_OFFROAD_CHANCE;
  const chance = Math.max(PATROL_MIN_CHANCE, base - PATROL_MITIGATION_PER_BONUS * mitigationBonus);
  const draw = nextRandomFloat(rngState);
  rngState = draw.nextState;
  const encountered = draw.value < chance;
  return {
    encountered,
    reason: encountered ? 'patrol' : 'clear',
    chance,
    mitigationBonus,
    nextRngState: rngState,
  };
}

export const WAR_PATROL_APPROACHES = ['bluff', 'evade', 'bribe', 'fight'] as const;
export const WarPatrolApproachSchema = z.enum(WAR_PATROL_APPROACHES);
export type WarPatrolApproach = z.infer<typeof WarPatrolApproachSchema>;

export const ResolvePatrolEncounterOptionsSchema = z.object({
  diplomacy: WarDiplomacyStateSchema,
  war: WarStateSchema.optional(),
  party: z.array(z.any()).min(1).max(6),
  nationId: z.string().min(1),
  approach: WarPatrolApproachSchema,
  rngState: z.number().int().default(0),
  goldAvailable: z.number().int().min(0).default(0),
  day: z.number().int().min(1).optional(),
});
export type ResolvePatrolEncounterOptions = z.input<typeof ResolvePatrolEncounterOptionsSchema>;

export const PatrolEncounterOutcomeSchema = z.enum(['passed', 'tactical_battle']);
export type PatrolEncounterOutcome = z.infer<typeof PatrolEncounterOutcomeSchema>;

export interface ResolvedPatrolEncounter {
  diplomacy: WarDiplomacyState;
  /** Party sheets with any expended *Disguise Self* slot deducted. */
  updatedParty: DerivedCharacterSheet[];
  outcome: PatrolEncounterOutcome;
  success: boolean;
  actorId: string;
  actorName: string;
  bonus: number;
  dc: number | null;
  naturalRoll: number | null;
  total: number | null;
  threatDelta: number;
  goldSpent: number;
  remainingGold: number;
  headline: string;
  nextRngState: number;
}

/**
 * Resolves the patrol encounter dialogue (Spec 10 §7):
 * - **Bluff** (Persuasion/Deception, or *Disguise Self* for an automatic
 *   pass that expends a 1st-level+ slot): pass with `+0` Threat.
 * - **Evade** (Stealth/Survival): slip off the road with `+0` Threat.
 * - **Bribe** (50gp): pass with `+5` Threat.
 * - **Fight**: a tactical battle — Threat only rises once the patrol is
 *   reported killed via `reportPatrolKill()` (`+20`, pursuit at `>= 55`).
 */
export function resolvePatrolEncounter(rawOptions: ResolvePatrolEncounterOptions): ResolvedPatrolEncounter {
  const options = ResolvePatrolEncounterOptionsSchema.parse(rawOptions);
  const diplomacy = WarDiplomacyStateSchema.parse(options.diplomacy);
  const party = options.party as DerivedCharacterSheet[];
  let rngState = normalizeSeed(options.rngState);
  const failThrough = (headline: string): ResolvedPatrolEncounter => ({
    diplomacy,
    updatedParty: structuredClone(party),
    outcome: 'tactical_battle',
    success: false,
    actorId: party[0]!.id,
    actorName: party[0]!.name,
    bonus: 0,
    dc: null,
    naturalRoll: null,
    total: null,
    threatDelta: 0,
    goldSpent: 0,
    remainingGold: options.goldAvailable,
    headline,
    nextRngState: rngState,
  });

  if (options.approach === 'bribe') {
    if (options.goldAvailable < PATROL_BRIBE_COST_GOLD) {
      return failThrough(
        `The patrol captain names ${PATROL_BRIBE_COST_GOLD}gp — the party cannot pay, and steel is drawn.`,
      );
    }
    return {
      diplomacy: addNationThreat(diplomacy, options.nationId, WAR_THREAT_BRIBE_GAIN),
      updatedParty: structuredClone(party),
      outcome: 'passed',
      success: true,
      actorId: party[0]!.id,
      actorName: party[0]!.name,
      bonus: 0,
      dc: null,
      naturalRoll: null,
      total: null,
      threatDelta: WAR_THREAT_BRIBE_GAIN,
      goldSpent: PATROL_BRIBE_COST_GOLD,
      remainingGold: options.goldAvailable - PATROL_BRIBE_COST_GOLD,
      headline: `The captain pockets ${PATROL_BRIBE_COST_GOLD}gp and waves the party through (+${WAR_THREAT_BRIBE_GAIN} Threat).`,
      nextRngState: rngState,
    };
  }

  if (options.approach === 'fight') {
    return {
      ...failThrough(`The party sets for battle — kill the patrol and the territory will remember it.`),
      actorId: party[0]!.id,
      actorName: party[0]!.name,
    };
  }

  if (options.approach === 'bluff') {
    // *Disguise Self* veils the whole band: automatic pass, slot expended.
    const veiled = findSpellCaster(party, 'disguise-self', 1);
    if (veiled) {
      const index = party.findIndex((sheet) => sheet.id === veiled.id);
      const deducted = deductSlot(party[index]!, 1);
      const updatedParty = structuredClone(party);
      updatedParty[index] = deducted.updated;
      return {
        diplomacy,
        updatedParty,
        outcome: 'passed',
        success: true,
        actorId: veiled.id,
        actorName: veiled.name,
        bonus: 0,
        dc: PATROL_BLUFF_DC,
        naturalRoll: null,
        total: null,
        threatDelta: 0,
        goldSpent: 0,
        remainingGold: options.goldAvailable,
        headline: `${veiled.name}'s Disguise Self veil fools the patrol — the band passes as traveling merchants (+0 Threat).`,
        nextRngState: rngState,
      };
    }
    const { bonus, sheet } = bestBonusOf(party, 'persuasion', 'deception');
    const roll = rollD20(rngState, { modifier: bonus });
    rngState = roll.nextState;
    if (roll.total >= PATROL_BLUFF_DC) {
      return {
        diplomacy,
        updatedParty: structuredClone(party),
        outcome: 'passed',
        success: true,
        actorId: sheet.id,
        actorName: sheet.name,
        bonus,
        dc: PATROL_BLUFF_DC,
        naturalRoll: roll.naturalRoll,
        total: roll.total,
        threatDelta: 0,
        goldSpent: 0,
        remainingGold: options.goldAvailable,
        headline: `${sheet.name} talks the patrol down (${roll.total} vs DC ${PATROL_BLUFF_DC}) — waved through (+0 Threat).`,
        nextRngState: rngState,
      };
    }
    return {
      diplomacy,
      updatedParty: structuredClone(party),
      outcome: 'tactical_battle',
      success: false,
      actorId: sheet.id,
      actorName: sheet.name,
      bonus,
      dc: PATROL_BLUFF_DC,
      naturalRoll: roll.naturalRoll,
      total: roll.total,
      threatDelta: 0,
      goldSpent: 0,
      remainingGold: options.goldAvailable,
      headline: `${sheet.name}'s cover story collapses (${roll.total} vs DC ${PATROL_BLUFF_DC}) — the patrol attacks.`,
      nextRngState: rngState,
    };
  }

  // 'evade': slip off the road under Survival/Stealth.
  const { bonus, sheet } = bestBonusOf(party, 'stealth', 'survival');
  const roll = rollD20(rngState, { modifier: bonus });
  rngState = roll.nextState;
  if (roll.total >= PATROL_EVADE_DC) {
    return {
      diplomacy,
      updatedParty: structuredClone(party),
      outcome: 'passed',
      success: true,
      actorId: sheet.id,
      actorName: sheet.name,
      bonus,
      dc: PATROL_EVADE_DC,
      naturalRoll: roll.naturalRoll,
      total: roll.total,
      threatDelta: 0,
      goldSpent: 0,
      remainingGold: options.goldAvailable,
      headline: `${sheet.name} ghosts the patrol into the treeline (${roll.total} vs DC ${PATROL_EVADE_DC}) — unseen (+0 Threat).`,
      nextRngState: rngState,
    };
  }
  return {
    diplomacy,
    updatedParty: structuredClone(party),
    outcome: 'tactical_battle',
    success: false,
    actorId: sheet.id,
    actorName: sheet.name,
    bonus,
    dc: PATROL_EVADE_DC,
    naturalRoll: roll.naturalRoll,
    total: roll.total,
    threatDelta: 0,
    goldSpent: 0,
    remainingGold: options.goldAvailable,
    headline: `${sheet.name} snaps a branch at the wrong moment (${roll.total} vs DC ${PATROL_EVADE_DC}) — the patrol gives chase.`,
    nextRngState: rngState,
  };
}

export const ReportPatrolKillOptionsSchema = z.object({
  diplomacy: WarDiplomacyStateSchema,
  war: WarStateSchema.optional(),
  nationId: z.string().min(1),
  day: z.number().int().min(1).optional(),
});
export type ReportPatrolKillOptions = z.input<typeof ReportPatrolKillOptionsSchema>;

export interface ReportedPatrolKill {
  diplomacy: WarDiplomacyState;
  war?: WarState;
  threat: number;
  tier: WarThreatTier;
  pursuitActive: boolean;
  pursuitStarted: boolean;
  headline: string;
}

/**
 * Records a killed patrol: `+20` Threat in that nation; crossing `>= 55`
 * activates Hunter-Killer pursuit (logged to the War Chronicle when `war` is
 * supplied).
 */
export function reportPatrolKill(rawOptions: ReportPatrolKillOptions): ReportedPatrolKill {
  const options = ReportPatrolKillOptionsSchema.parse(rawOptions);
  const before = getNationThreat(options.diplomacy, options.nationId);
  const diplomacy = addNationThreat(options.diplomacy, options.nationId, WAR_THREAT_KILL_PATROL_GAIN);
  const threat = getNationThreat(diplomacy, options.nationId);
  const pursuitStarted = !isPursuitActiveForThreat(before) && isPursuitActiveForThreat(threat);

  let war = options.war ? WarStateSchema.parse(options.war) : undefined;
  if (war) {
    const day = options.day ?? war.currentDay;
    const nextWar: WarState = structuredClone(war);
    nextWar.chronicle = [
      ...nextWar.chronicle,
      {
        day,
        kind: 'patrol_skirmish',
        headline: `A ${nextWar.nations[options.nationId]?.name ?? options.nationId} patrol vanishes in the wilds (Threat ${threat}).`,
      },
    ];
    if (pursuitStarted) {
      nextWar.chronicle.push({
        day,
        kind: 'pursuit_started',
        headline: `Hunter-killer squads of ${nextWar.nations[options.nationId]?.name ?? options.nationId} hunt the party.`,
      });
    }
    war = WarStateSchema.parse(nextWar);
  }

  return {
    diplomacy,
    war,
    threat,
    tier: getWarThreatTier(threat),
    pursuitActive: isPursuitActiveForThreat(threat),
    pursuitStarted,
    headline: pursuitStarted
      ? `The patrol dies to a soul — Threat ${threat}. Hunter-killer pursuit is active.`
      : `The patrol dies quietly — Threat ${threat} (${getWarThreatTier(threat)}).`,
  };
}

/**
 * Builds the Hunter-Killer pursuit squad that intercepts the party at high
 * Threat: a dynamic-CR Warrior/Mage/Cleric/Thief cell fielded by the hunting
 * nation (Spec 10 §7, SRD-1102 squad machinery).
 */
export function buildHunterKillerSquad(
  partyLevel: number,
  nationId: string,
  seed = 0,
): BuiltWarSquad {
  return buildWarSquad({
    partyLevel,
    nationId,
    seed,
    composition: ['fighter', 'wizard', 'cleric', 'rogue'],
    teamId: 'war_enemies',
    idPrefix: `hunter_killer_${nationId}`,
  });
}
