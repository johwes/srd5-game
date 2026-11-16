import { describe, expect, it } from 'vitest';
import {
  type OverworldMap,
  OverworldMapSchema,
  REPUTATION_TIERS,
  REPUTATION_TIER_PROFILES,
  RealmError,
  adjustFactionReputation,
  buildFactionDispositionMatrix,
  clampReputation,
  compareReputationTiers,
  generateOverworldMap,
  getDisposition,
  getFaction,
  getFactionByPoi,
  getFactionControllingTile,
  getFactionReputation,
  getOverworldTile,
  getReputationDisposition,
  getReputationPriceMultiplier,
  getReputationTier,
  getServicesAt,
  getSettlements,
  isServiceAvailableToParty,
  isServiceOffered,
  populateSettlements,
  setFactionReputation,
} from '../index.js';

function realm(seed = 555) {
  const generated = generateOverworldMap({ seed, width: 64, height: 64 });
  const settlements = populateSettlements(generated.map, generated.settlementSites);
  return { generated, ...settlements };
}

describe('SRD-803: Faction reputation engine (Spec 06 §4.1 / §2.3)', () => {
  describe('Reputation bounds and standing tiers', () => {
    it('clamps arbitrary values into the canonical -100..+100 integer range', () => {
      expect(clampReputation(-500)).toBe(-100);
      expect(clampReputation(500)).toBe(100);
      expect(clampReputation(12.6)).toBe(13);
      expect(clampReputation(-12.6)).toBe(-13);
      expect(clampReputation(Number.NaN)).toBe(0);
    });

    it('maps every value to exactly one of the seven contiguous standing tiers', () => {
      expect(REPUTATION_TIERS).toHaveLength(7);
      for (const tier of REPUTATION_TIERS) {
        const profile = REPUTATION_TIER_PROFILES[tier];
        expect(getReputationTier(profile.min)).toBe(tier);
        expect(getReputationTier(profile.max)).toBe(tier);
        expect(getReputationTier(Math.round((profile.min + profile.max) / 2))).toBe(tier);
      }
      expect(getReputationTier(-100)).toBe('hated');
      expect(getReputationTier(-60)).toBe('hostile');
      expect(getReputationTier(-20)).toBe('unfriendly');
      expect(getReputationTier(0)).toBe('neutral');
      expect(getReputationTier(25)).toBe('friendly');
      expect(getReputationTier(60)).toBe('trusted');
      expect(getReputationTier(100)).toBe('exalted');
    });

    it('makes prices decrease and friendliness increase with reputation', () => {
      expect(getReputationPriceMultiplier(-100)).toBeGreaterThan(
        getReputationPriceMultiplier(0),
      );
      expect(getReputationPriceMultiplier(100)).toBeLessThan(getReputationPriceMultiplier(0));
      expect(getReputationDisposition(-100)).toBe('hostile');
      expect(getReputationDisposition(0)).toBe('neutral');
      expect(getReputationDisposition(100)).toBe('allied');
      expect(compareReputationTiers(50, -50)).toBeGreaterThan(0);
      expect(compareReputationTiers(-80, -20)).toBeLessThan(0);
    });
  });

  describe('Reputation mutation', () => {
    it('adjusts reputation without mutating the source map and clamps at both ends', () => {
      const { map } = realm();
      const factionId = 'iron-covenant';
      expect(getFactionReputation(map, factionId)).toBe(0);

      const raised = adjustFactionReputation(map, factionId, 35);
      expect(raised.reputation).toBe(35);
      expect(raised.tier).toBe('friendly');
      expect(raised.previous).toBe(0);
      expect(getFactionReputation(map, factionId)).toBe(0); // original untouched

      const maxed = adjustFactionReputation(raised.map, factionId, 999);
      expect(maxed.reputation).toBe(100);
      expect(maxed.tier).toBe('exalted');

      const bottomed = setFactionReputation(maxed.map, factionId, -500);
      expect(bottomed.reputation).toBe(-100);
      expect(bottomed.tier).toBe('hated');
      expect(OverworldMapSchema.safeParse(bottomed.map).success).toBe(true);
    });

    it('rejects unknown factions with a domain error', () => {
      const { map } = realm();
      expect(() => adjustFactionReputation(map, 'not-a-faction', 10)).toThrow(RealmError);
      expect(() => setFactionReputation(map, 'not-a-faction', 10)).toThrow(RealmError);
      expect(() => getFaction(map, 'not-a-faction')).toThrow(RealmError);
    });
  });

  describe('Disposition matrix integration', () => {
    it('builds a symmetric party/faction matrix usable by tactical allegiance', () => {
      const { map } = realm();
      const withFactions = setFactionReputation(
        setFactionReputation(map, 'iron-covenant', 90).map,
        'emerald-circle',
        -100,
      ).map;
      const matrix = buildFactionDispositionMatrix(withFactions);

      expect(matrix['player_guild']!['iron-covenant']).toBe('allied');
      expect(matrix['player_guild']!['emerald-circle']).toBe('hostile');
      expect(matrix['iron-covenant']!['player_guild']).toBe('allied');
      expect(matrix['emerald-circle']!['player_guild']).toBe('hostile');

      const party = { factionId: 'player_guild', teamId: 'party', id: 'hero-1' };
      expect(
        getDisposition(party, { factionId: 'iron-covenant', teamId: 'covenant' }, matrix),
      ).toBe('allied');
      expect(
        getDisposition(party, { factionId: 'emerald-circle', teamId: 'circle' }, matrix),
      ).toBe('hostile');
    });
  });
});

describe('SRD-803: Procedural settlements (Spec 06 §4.1)', () => {
  it('replays bit-exact settlements and factions for the same seed', () => {
    const { generated } = realm(987654321);
    const a = populateSettlements(generated.map, generated.settlementSites);
    const b = populateSettlements(generated.map, generated.settlementSites);
    expect(JSON.stringify(a.map)).toBe(JSON.stringify(b.map));
    expect(a.settlements).toEqual(b.settlements);
    expect(a.nextRngState).toBe(b.nextRngState);
  });

  it('promotes every settlement site into a valid owned POI with the right services', () => {
    const { generated, map, settlements } = realm();
    expect(settlements).toHaveLength(generated.settlementSites.length);
    expect(getSettlements(map)).toHaveLength(settlements.length);
    expect(OverworldMapSchema.safeParse(map).success).toBe(true);

    const capital = settlements[0]!;
    expect(capital.kind).toBe('capital');
    for (const service of ['inn', 'blacksmith', 'magic_shop', 'temple', 'quest_board'] as const) {
      expect(isServiceOffered(capital, service)).toBe(true);
    }
    expect(getServicesAt(map, capital.id)).toEqual([
      'inn',
      'blacksmith',
      'magic_shop',
      'temple',
      'quest_board',
    ]);

    for (const site of generated.settlementSites) {
      const tile = getOverworldTile(map, site.q, site.r)!;
      expect(tile.terrain).not.toBe('ocean');
      expect(tile.poiId).toBeDefined();
      expect(tile.factionControlId).toBeDefined();
      const poi = map.pois[tile.poiId!]!;
      expect(poi.q).toBe(site.q);
      expect(poi.r).toBe(site.r);
      expect(poi.factionId).toBe(tile.factionControlId);
      expect(['capital', 'town', 'village']).toContain(poi.kind);
      expect(getFactionByPoi(map, poi.id)?.id).toBe(poi.factionId);
      expect(getFactionControllingTile(map, site)?.id).toBe(poi.factionId);
    }

    const ids = settlements.map((poi) => poi.id);
    const names = settlements.map((poi) => poi.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it('assigns every settlement as a faction capital or town with referential integrity', () => {
    const { map, settlements } = realm();
    const factionIds = Object.keys(map.factions);
    expect(factionIds.length).toBeGreaterThan(1);

    for (const faction of Object.values(map.factions)) {
      expect(map.pois[faction.capitalPoiId]?.factionId).toBe(faction.id);
      expect(faction.townPoiIds.every((poiId) => map.pois[poiId]?.factionId === faction.id)).toBe(
        true,
      );
      expect(getFaction(map, faction.id)).toBe(faction);
    }
    const owned = factionIds.flatMap((id) => [
      map.factions[id]!.capitalPoiId,
      ...map.factions[id]!.townPoiIds,
    ]);
    expect(new Set(owned).size).toBe(settlements.length);
    expect(owned.sort()).toEqual(settlements.map((poi) => poi.id).sort());
  });

  it('honors factionCount and clamped starting reputations', () => {
    const { generated } = realm();
    const result = populateSettlements(generated.map, generated.settlementSites, {
      factionCount: 2,
      startingReputations: { 'iron-covenant': 50, 'emerald-circle': -999 },
    });
    expect(Object.keys(result.map.factions)).toHaveLength(2);
    expect(getFactionReputation(result.map, 'iron-covenant')).toBe(50);
    expect(getFactionReputation(result.map, 'emerald-circle')).toBe(-100);
    expect(() =>
      populateSettlements(generated.map, generated.settlementSites, { factionCount: 0 }),
    ).toThrow();
  });

  it('denies non-inn services to hostile factions but keeps inns open', () => {
    const { map, settlements } = realm();
    const capital = settlements[0]!;
    const hostileMap = setFactionReputation(map, 'iron-covenant', -100).map;

    expect(isServiceAvailableToParty(hostileMap, capital, 'inn')).toBe(true);
    expect(isServiceAvailableToParty(hostileMap, capital, 'blacksmith')).toBe(false);
    expect(isServiceAvailableToParty(hostileMap, capital, 'quest_board')).toBe(false);
    expect(isServiceAvailableToParty(hostileMap, capital, 'temple')).toBe(false);

    const friendlyMap = setFactionReputation(map, 'iron-covenant', 50).map;
    expect(isServiceAvailableToParty(friendlyMap, capital, 'magic_shop')).toBe(true);
    expect(isServiceAvailableToParty(friendlyMap, capital, 'quest_board')).toBe(true);
    expect(isServiceAvailableToParty(friendlyMap, capital, 'inn')).toBe(true);
  });

  it('handles empty site lists and refuses to overwrite an occupied tile', () => {
    const { generated } = realm();
    const empty = populateSettlements(generated.map, []);
    expect(empty.settlements).toHaveLength(0);
    expect(empty.factions).toHaveLength(0);
    expect(Object.keys(empty.map.pois)).toHaveLength(Object.keys(generated.map.pois).length);

    const occupiedMap: OverworldMap = structuredClone(generated.map);
    const site = generated.settlementSites[0]!;
    occupiedMap.tiles[`${site.q},${site.r}`]!.poiId = 'preexisting_poi';
    expect(() => populateSettlements(occupiedMap, generated.settlementSites)).toThrow(RealmError);
  });
});
