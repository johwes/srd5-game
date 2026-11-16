import {
  type FactionData,
  type OverworldCoord,
  type OverworldMap,
  type OverworldPOI,
  type OverworldPOIService,
  getOverworldTile,
} from './schemas.js';
import {
  PLAYER_FACTION_ID,
  REPUTATION_MAX,
  REPUTATION_MIN,
  REPUTATION_TIER_ORDER,
  REPUTATION_TIER_PROFILES,
  type ReputationTier,
  type ReputationValue,
} from './realm-schemas.js';
import type { Disposition, DispositionMatrix } from '../combat/allegiance.js';
import { RealmError } from './realm-error.js';

/**
 * Faction reputation engine (SRD-803, Spec 06 Section 4.1 / 2.3).
 *
 * Reputation is an integer in [-100, +100] stored on each `FactionData`. It
 * drives shop pricing, service availability, and the tactical disposition
 * matrix used by the Realm-to-combat transition. All functions are pure and
 * non-mutating; the engine never calls `Math.random()`.
 */

/** Coerces an arbitrary number into the canonical integer reputation range. */
export function clampReputation(value: number): ReputationValue {
  if (!Number.isFinite(value)) return 0;
  return Math.max(REPUTATION_MIN, Math.min(REPUTATION_MAX, Math.round(value)));
}

/** Resolves the seven-band standing tier for a reputation value. */
export function getReputationTier(value: number): ReputationTier {
  const clamped = clampReputation(value);
  for (const tier of REPUTATION_TIER_ORDER) {
    const profile = REPUTATION_TIER_PROFILES[tier];
    if (clamped >= profile.min && clamped <= profile.max) return tier;
  }
  // Unreachable: the profiles span [-100, 100] contiguously.
  return 'neutral';
}

export function getReputationTierProfile(value: number) {
  return REPUTATION_TIER_PROFILES[getReputationTier(value)];
}

/** Shop price multiplier: hostile factions charge more, exalted allies less. */
export function getReputationPriceMultiplier(value: number): number {
  return getReputationTierProfile(value).priceMultiplier;
}

/** Maps a standing to the tactical disposition vocabulary (Spec 06 §2.3). */
export function getReputationDisposition(value: number): Disposition {
  return getReputationTierProfile(value).disposition;
}

/** Compares two reputation values by their standing tier. */
export function compareReputationTiers(a: number, b: number): number {
  return (
    REPUTATION_TIER_ORDER.indexOf(getReputationTier(a)) -
    REPUTATION_TIER_ORDER.indexOf(getReputationTier(b))
  );
}

/** Looks up a faction by ID, throwing a domain error when it is absent. */
export function getFaction(map: OverworldMap, factionId: string): FactionData {
  const faction = map.factions[factionId];
  if (!faction) throw new RealmError(`Unknown faction '${factionId}'`);
  return faction;
}

export function getFactionReputation(map: OverworldMap, factionId: string): number {
  return getFaction(map, factionId).relationshipWithParty;
}

export interface ReputationChangeResult {
  map: OverworldMap;
  factionId: string;
  previous: number;
  reputation: number;
  tier: ReputationTier;
}

/** Applies a relative reputation delta, clamping to [-100, 100]. */
export function adjustFactionReputation(
  map: OverworldMap,
  factionId: string,
  delta: number,
): ReputationChangeResult {
  return setFactionReputation(map, factionId, getFactionReputation(map, factionId) + delta);
}

/** Sets an absolute reputation value, clamping to [-100, 100]. */
export function setFactionReputation(
  map: OverworldMap,
  factionId: string,
  value: number,
): ReputationChangeResult {
  const faction = getFaction(map, factionId);
  const previous = faction.relationshipWithParty;
  const reputation = clampReputation(value);
  return {
    map: {
      ...map,
      factions: {
        ...map.factions,
        [factionId]: { ...faction, relationshipWithParty: reputation },
      },
    },
    factionId,
    previous,
    reputation,
    tier: getReputationTier(reputation),
  };
}

/** Finds the faction that owns a settlement POI (capital or town). */
export function getFactionByPoi(map: OverworldMap, poiId: string): FactionData | undefined {
  return Object.values(map.factions).find(
    (faction) => faction.capitalPoiId === poiId || faction.townPoiIds.includes(poiId),
  );
}

/** Finds the faction controlling the tile at a coordinate. */
export function getFactionControllingTile(
  map: OverworldMap,
  coord: OverworldCoord,
): FactionData | undefined {
  const tile = getOverworldTile(map, coord.q, coord.r);
  return tile?.factionControlId ? map.factions[tile.factionControlId] : undefined;
}

/**
 * Builds a symmetric disposition matrix between the party faction and every
 * macro-faction, derived from current reputations. Pass it to the tactical
 * `getDisposition()`/`areHostile()` helpers during Overworld battles.
 */
export function buildFactionDispositionMatrix(
  map: OverworldMap,
  playerFactionId: string = PLAYER_FACTION_ID,
): DispositionMatrix {
  const matrix: DispositionMatrix = { [playerFactionId]: {} };
  for (const faction of Object.values(map.factions)) {
    const disposition = getReputationDisposition(faction.relationshipWithParty);
    matrix[playerFactionId]![faction.id] = disposition;
    if (!matrix[faction.id]) matrix[faction.id] = {};
    matrix[faction.id]![playerFactionId] = disposition;
  }
  return matrix;
}

/**
 * A faction only sells services to the party when its standing is not hostile.
 * Inns remain open to everyone (a traveller can always buy a bed and a meal).
 */
export function isServiceAvailableToParty(
  map: OverworldMap,
  poi: OverworldPOI,
  service: OverworldPOIService,
): boolean {
  if (poi.services?.includes(service) !== true) return false;
  if (service === 'inn') return true;
  const factionId = poi.factionId ?? getFactionByPoi(map, poi.id)?.id;
  if (!factionId) return true; // Unaligned free settlements are always open.
  return getReputationDisposition(getFactionReputation(map, factionId)) !== 'hostile';
}
