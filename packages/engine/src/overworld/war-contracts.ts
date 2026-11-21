import {
  z,
} from 'zod';
import {
  normalizeSeed,
  rollDie,
} from '../dice/prng.js';
import {
  rollD20,
} from '../dice/evaluator.js';
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
import {
  bestBonusOf,
} from './war-negotiation-utils.js';
import {
  hasPartyLanguageInfo,
  resolveWarLanguageDealTier,
} from './war-languages.js';
import {
  RealmError,
} from './realm-error.js';

/**
 * SRD-1104 — Wartime contracts: Temporary Truces, Mercenary Companies and
 * Thieves' Guild cells (Spec 10 Section 6).
 *
 * All functions are pure and deterministic. Every random choice threads the
 * seeded Mulberry32 PRNG (`rngState`); `Math.random()` is never called.
 * Inputs are never mutated — updated copies are returned.
 */

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
/** SRD-1214: gesture parleys (no shared tongue/magic/interpreter) cap the truce at the floor. */
export const TRUCE_GESTURE_MAX_DURATION_DAYS = 12;

export const NegotiateTruceOptionsSchema = z.object({
  war: WarStateSchema,
  party: z.array(z.any()).min(1).max(6),
  targetNationId: z.string().min(1),
  rngState: z.number().int().default(0),
  day: z.number().int().min(1).optional(),
  /** Gold tribute offered alongside the parley (spent only on success). */
  tributeGold: z.number().int().min(0).default(0),
  /** SRD-1214: retained interpreter carries the parley at baseline + fee. */
  hasInterpreter: z.boolean().default(false),
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
  /** SRD-1214: war-tongue tier that graded the parley (`baseline` for legacy sheets). */
  languageTier: 'native' | 'magic' | 'interpreter' | 'gesture' | 'baseline';
  /** SRD-1214: check modifier from the tongue tier (+2 native, −2 gesture). */
  languageBonus: number;
  /** SRD-1214: gesture path locks the longest-truce tier (capped at 12 days). */
  topTierLocked: boolean;
  /** SRD-1214: interpreter per-parley fee included in `goldSpent` (0 unless carried). */
  interpreterFee: number;
}

/**
 * Parleys a Temporary Truce with a rival nation: the best live party
 * Persuasion bonus is tested against DC 14 (12 with ≥100gp tribute, 10 with
 * ≥250gp; SRD-1214 tongue tiers shift the DC by +2 native / −2 gesture).
 * Success halts that nation's attacks and patrol hostility until `untilDay`
 * (12–18 days, gesture parleys capped at 12); the tribute (plus any
 * interpreter fee) is spent only when accepted.
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

  // SRD-1214: war-tongue tier. Legacy sheets without language data (or
  // unknown profiles) fall back to baseline so pre-1214 behavior is preserved.
  let languageTier: NegotiatedTruce['languageTier'] = 'baseline';
  let languageBonus = 0;
  let topTierLocked = false;
  let interpreterFee = 0;
  try {
    if (hasPartyLanguageInfo(party)) {
      const resolved = resolveWarLanguageDealTier({
        nationId: options.targetNationId,
        party,
        hasInterpreter: options.hasInterpreter,
      });
      languageTier = resolved.tier;
      languageBonus = resolved.bonus;
      topTierLocked = resolved.topTierLocked;
      interpreterFee = resolved.perParleyFee;
    }
  } catch {
    languageTier = 'baseline';
    languageBonus = 0;
    topTierLocked = false;
    interpreterFee = 0;
  }

  let dc = TRUCE_BASE_DC;
  if (options.tributeGold >= TRUCE_TRIBUTE_DEEP_THRESHOLD) dc -= TRUCE_TRIBUTE_DC_DEEP_RELIEF;
  else if (options.tributeGold >= TRUCE_TRIBUTE_RELIEF_THRESHOLD) dc -= TRUCE_TRIBUTE_DC_RELIEF;
  dc = Math.max(5, dc - languageBonus);

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
      languageTier,
      languageBonus,
      topTierLocked,
      interpreterFee: 0,
    };
  }

  const durationRoll = rollDie(roll.nextState, TRUCE_DURATION_SPREAD);
  let durationDays = durationRoll.roll + (TRUCE_MIN_DURATION_DAYS - 1);
  if (topTierLocked) durationDays = Math.min(durationDays, TRUCE_GESTURE_MAX_DURATION_DAYS);
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
    goldSpent: options.tributeGold + interpreterFee,
    headline: `${sheet.name} seals a ${durationDays}-day truce with ${target.name} (${roll.total} vs DC ${dc}).`,
    nextRngState: durationRoll.nextState,
    languageTier,
    languageBonus,
    topTierLocked,
    interpreterFee,
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
