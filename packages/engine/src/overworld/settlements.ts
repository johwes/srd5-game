import {
  type FactionData,
  type OverworldCoord,
  type OverworldMap,
  type OverworldPOI,
  type OverworldPOIKind,
  type OverworldPOIService,
  OverworldMapSchema,
  getOverworldTile,
  overworldTileKey,
} from './schemas.js';
import {
  FACTION_ARCHETYPES,
  SettlementGenerationConfigSchema,
  type SettlementGenerationConfigInput,
  type SettlementGenerationConfig,
} from './realm-schemas.js';
import { clampReputation } from './factions.js';
import { RealmError } from './realm-error.js';
import { normalizeSeed, nextRandomFloat } from '../dice/prng.js';

/**
 * Procedural settlement promotion (SRD-803, Spec 06 Section 4.1).
 *
 * SRD-801 emits spaced settlement *sites* but no settlement POIs or factions.
 * This module promotes those sites into capital/town/village POIs, assigns each
 * to one of the build-time faction archetypes, grants services, and claims the
 * surrounding tiles. The result passes the same schema/referential-integrity
 * checks as the world generator and is fully deterministic from its seed.
 */

const SETTLEMENT_NAME_PREFIXES = [
  'Ash', 'Briar', 'Dawn', 'Elder', 'Frost', 'Grey', 'Hollow', 'Iron',
  'Moon', 'Oak', 'Raven', 'Stone', 'Sun', 'Thorn', 'White', 'Wind',
] as const;
const SETTLEMENT_NAME_SUFFIXES = [
  'fall', 'ford', 'haven', 'hold', 'mere', 'reach', 'ridge', 'spire',
  'stead', 'vale', 'watch', 'well', 'wick', 'wood',
] as const;
const ALL_SERVICES: readonly OverworldPOIService[] = [
  'inn',
  'blacksmith',
  'magic_shop',
  'temple',
  'quest_board',
];

export interface SettlementGenerationResult {
  map: OverworldMap;
  settlements: OverworldPOI[];
  factions: FactionData[];
  nextRngState: number;
}

/** Returns all settlement-kind POIs on a map (capitals, towns, and villages). */
export function getSettlements(map: OverworldMap): OverworldPOI[] {
  return Object.values(map.pois).filter((poi) =>
    ['capital', 'town', 'village'].includes(poi.kind),
  );
}

/** True when a POI offers a given service. */
export function isServiceOffered(poi: OverworldPOI, service: OverworldPOIService): boolean {
  return poi.services?.includes(service) === true;
}

/** Returns the services offered at a POI, or an empty list. */
export function getServicesAt(map: OverworldMap, poiId: string): OverworldPOIService[] {
  return map.pois[poiId]?.services ?? [];
}

/**
 * Promotes settlement sites into fully-authored settlement POIs and factions.
 * Does not mutate the supplied map.
 */
export function populateSettlements(
  map: OverworldMap,
  settlementSites: readonly OverworldCoord[],
  rawConfig: SettlementGenerationConfigInput = {},
): SettlementGenerationResult {
  const config: SettlementGenerationConfig = SettlementGenerationConfigSchema.parse(rawConfig);
  let rngState = normalizeSeed(config.seed ?? map.worldSeed);

  function nextFloat(): number {
    const res = nextRandomFloat(rngState);
    rngState = res.nextState;
    return res.value;
  }

  function pick<T>(items: readonly T[]): T {
    return items[Math.floor(nextFloat() * items.length)]!;
  }

  const nextMap = structuredClone(map);
  const settlements: OverworldPOI[] = [];

  if (settlementSites.length === 0) {
    return { map: nextMap, settlements, factions: [], nextRngState: rngState };
  }

  const factionCount = Math.min(
    config.factionCount ?? Math.min(4, settlementSites.length),
    settlementSites.length,
    FACTION_ARCHETYPES.length,
  );
  const factions: FactionData[] = FACTION_ARCHETYPES.slice(0, factionCount).map((archetype) => ({
    id: archetype.id,
    name: archetype.name,
    bannerColor: archetype.bannerColor,
    alignment: archetype.alignment,
    relationshipWithParty: clampReputation(config.startingReputations?.[archetype.id] ?? 0),
    capitalPoiId: '',
    townPoiIds: [],
  }));

  const usedNames = new Set<string>(Object.values(nextMap.pois).map((poi) => poi.name));
  function uniqueName(base: string): string {
    let name = base;
    let suffix = 2;
    while (usedNames.has(name)) {
      name = `${base} ${suffix}`;
      suffix += 1;
    }
    usedNames.add(name);
    return name;
  }

  settlementSites.forEach((site, index) => {
    const faction = factions[index % factions.length]!;
    const tile = getOverworldTile(nextMap, site.q, site.r);
    if (!tile || tile.terrain === 'ocean') {
      throw new RealmError(
        `Settlement site (${site.q},${site.r}) is not a walkable tile`,
      );
    }
    if (tile.poiId) {
      throw new RealmError(
        `Settlement site (${site.q},${site.r}) is already occupied by POI '${tile.poiId}'`,
      );
    }

    const kind: OverworldPOIKind =
      index === 0 ? 'capital' : index % 3 === 0 ? 'village' : 'town';

    let poiId = `settlement_${index + 1}`;
    while (nextMap.pois[poiId]) poiId = `${poiId}_${index + 2}`;

    const services: OverworldPOIService[] = [];
    if (kind === 'capital') {
      services.push(...ALL_SERVICES);
    } else if (kind === 'town') {
      services.push('inn', 'blacksmith', 'quest_board');
      if (nextFloat() < 0.45) services.push('magic_shop');
      if (nextFloat() < 0.45) services.push('temple');
    } else {
      services.push('inn', 'quest_board');
      if (nextFloat() < 0.35) services.push('blacksmith');
    }

    const poi: OverworldPOI = {
      id: poiId,
      name: uniqueName(`${pick(SETTLEMENT_NAME_PREFIXES)} ${pick(SETTLEMENT_NAME_SUFFIXES)}`),
      kind,
      q: tile.q,
      r: tile.r,
      factionId: faction.id,
      services,
    };

    nextMap.pois[poiId] = poi;
    settlements.push(poi);
    tile.poiId = poiId;
    tile.factionControlId = faction.id;

    if (faction.capitalPoiId === '') faction.capitalPoiId = poiId;
    else faction.townPoiIds.push(poiId);
  });

  // Guard against a faction that somehow ended up without a seat.
  for (const faction of factions) {
    if (faction.capitalPoiId === '') {
      throw new RealmError(`Faction '${faction.id}' was assigned no settlement`);
    }
  }

  nextMap.factions = Object.fromEntries(factions.map((faction) => [faction.id, faction]));

  // Referential integrity + schema validation, mirroring SRD-801.
  OverworldMapSchema.parse(nextMap);
  const claimed = new Set<string>();
  for (const poi of settlements) {
    const key = overworldTileKey(poi.q, poi.r);
    if (claimed.has(key)) throw new RealmError(`Duplicate settlement at ${key}`);
    claimed.add(key);
    const tile = getOverworldTile(nextMap, poi.q, poi.r);
    if (!tile || tile.terrain === 'ocean' || tile.poiId !== poi.id) {
      throw new RealmError(`Settlement '${poi.id}' has no valid land tile`);
    }
    if (nextMap.pois[poi.id] !== poi) {
      throw new RealmError(`Settlement '${poi.id}' is not registered on the map`);
    }
  }
  for (const faction of Object.values(nextMap.factions)) {
    const seats = [faction.capitalPoiId, ...faction.townPoiIds];
    for (const poiId of seats) {
      if (nextMap.pois[poiId]?.factionId !== faction.id) {
        throw new RealmError(
          `Faction '${faction.id}' references unowned settlement '${poiId}'`,
        );
      }
    }
  }

  return {
    map: nextMap,
    settlements,
    factions: factions.map((faction) => structuredClone(faction)),
    nextRngState: rngState,
  };
}
