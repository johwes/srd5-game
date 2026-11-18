import { describe, expect, it } from 'vitest';
import {
  type OverworldTravelState,
  OverworldQuestSchema,
  RealmError,
  acceptSettlementRumor,
  blessPartyWithTemple,
  cleansePartyAffliction,
  filterMarketStockForParty,
  generateOverworldMap,
  generateQuestBoard,
  generateSettlementRumors,
  generateShopInventory,
  getIdentifyCost,
  getSettlementHubAccess,
  getTempleBlessingCost,
  getTempleCleanseCost,
  identifyMagicItem,
  populateSettlements,
  setFactionReputation,
  TEMPLE_BLESSING_ID,
} from '../index.js';

function realm(seed = 808) {
  const generated = generateOverworldMap({ seed, width: 48, height: 48 });
  const settled = populateSettlements(generated.map, generated.settlementSites);
  const capital = settled.settlements[0]!;
  return { ...settled, capital };
}

describe('SRD-808: Settlement hub access (rep-gated, no walkable city maps)', () => {
  it('keeps the inn open and gates market/temple by reputation tier', () => {
    const { map, capital } = realm();
    const open = getSettlementHubAccess(map, capital);
    expect(open.innOpen).toBe(true);

    const hostile = setFactionReputation(map, capital.factionId!, -100).map;
    const gated = getSettlementHubAccess(hostile, hostile.pois[capital.id]!);
    expect(gated.gateClosed).toBe(true);
    expect(gated.marketOpen).toBe(false);
    expect(gated.templeOpen).toBe(false);
    expect(gated.boardOpen).toBe(false);
    expect(gated.magicStockVisible).toBe(false);

    const unfriendly = setFactionReputation(map, capital.factionId!, -20).map;
    const restricted = getSettlementHubAccess(unfriendly, unfriendly.pois[capital.id]!);
    expect(restricted.marketOpen).toBe(true);
    expect(restricted.magicStockVisible).toBe(false);

    const exalted = setFactionReputation(map, capital.factionId!, 100).map;
    const perked = getSettlementHubAccess(exalted, exalted.pois[capital.id]!);
    expect(perked.marketOpen).toBe(true);
    expect(perked.magicStockVisible).toBe(true);
    expect(perked.blessingFree).toBe(true);
    expect(perked.priceMultiplier).toBeLessThan(1);
  });

  it('rejects non-settlement POIs', () => {
    const { map } = realm();
    const lair = Object.values(map.pois).find((poi) => poi.kind === 'monster_lair')!;
    expect(() => getSettlementHubAccess(map, lair)).toThrow(RealmError);
  });

  it('hides magic stock from unfriendly parties and closes it for hostile ones', () => {
    const { capital } = realm();
    const inventory = generateShopInventory(capital, 42).inventory;
    expect(inventory.items.some((item) => item.isMagicItem)).toBe(true);
    expect(filterMarketStockForParty(inventory.items, -100)).toHaveLength(0);
    const unfriendly = filterMarketStockForParty(inventory.items, -20);
    expect(unfriendly.length).toBeGreaterThan(0);
    expect(unfriendly.every((item) => !item.isMagicItem)).toBe(true);
    const friendly = filterMarketStockForParty(inventory.items, 50);
    expect(friendly).toHaveLength(inventory.items.length);
  });
});

describe('SRD-808: Inn rumors reveal nearby POIs', () => {
  it('generates deterministic rumors for nearby wilderness POIs', () => {
    const { map, capital } = realm();
    const first = generateSettlementRumors(map, capital, 99);
    const second = generateSettlementRumors(map, capital, 99);
    expect(JSON.stringify(first.rumors)).toBe(JSON.stringify(second.rumors));
    expect(first.nextRngState).toBe(second.nextRngState);
    expect(first.rumors.length).toBeGreaterThan(0);
    expect(first.rumors.length).toBeLessThanOrEqual(3);
    for (const rumor of first.rumors) {
      expect(rumor.poiId).toBe(capital.id);
      expect(map.pois[rumor.targetPoiId]).toBeDefined();
      expect(rumor.costGp).toBe(1);
      expect(rumor.rumorText.length).toBeGreaterThan(0);
      expect(rumor.informant.length).toBeGreaterThan(0);
    }
  });

  it('accepting a rumor reveals its POI exactly once', () => {
    const { map, capital } = realm();
    const { rumors } = generateSettlementRumors(map, capital, 7);
    const revealed = acceptSettlementRumor([], rumors[0]!);
    expect(revealed).toEqual([rumors[0]!.targetPoiId]);
    expect(acceptSettlementRumor(revealed, rumors[0]!)).toEqual(revealed);
  });
});

describe('SRD-808: Market identify service', () => {
  it('prices identification by reputation and spends overworld gold', () => {
    expect(getIdentifyCost(0)).toBe(25);
    expect(getIdentifyCost(-100)).toBeGreaterThan(25);
    expect(getIdentifyCost(100)).toBeLessThan(25);

    const state = {
      worldSeed: 1, worldName: 'Test', currentDay: 1, timeOfDay: 'dawn',
      weather: 'clear', partyPosition: { q: 0, r: 0 }, travelPace: 'normal',
      travelPointsRemaining: 6, rations: 10, gold: 100, milesTraveled: 0,
      foragedRations: 0, weatherEnabled: false, rngState: 1,
    } as OverworldTravelState;
    const instance = { instanceId: 'i1', itemId: 'cloak-of-protection', quantity: 1, isMagicItem: true, identified: false };
    const result = identifyMagicItem(state, instance, 0);
    expect(result.costGp).toBe(25);
    expect(result.state.gold).toBe(75);
    expect(result.instance.identified).toBe(true);
    expect(state.gold).toBe(100);
    expect(() => identifyMagicItem(result.state, result.instance, 0)).toThrow(RealmError);
    expect(() => identifyMagicItem({ ...state, gold: 0 }, instance, 0)).toThrow(RealmError);
  });
});

describe('SRD-808: Temple cleansing and blessings', () => {
  it('prices temple services by reputation with free exalted blessings', () => {
    expect(getTempleCleanseCost(0)).toBe(50);
    expect(getTempleCleanseCost(-100)).toBeGreaterThan(50);
    expect(getTempleBlessingCost(0)).toBe(30);
    expect(getTempleBlessingCost(100)).toBe(0);
  });

  it('lifts poisoned and exhaustion from one hero', () => {
    const hero = {
      id: 'hero-1',
      name: 'Val',
      conditions: ['poisoned'],
      isDead: false,
      currentHp: 10,
      exhaustionLevel: 1,
    } as unknown as import('../index.js').Combatant;
    const party = { 'hero-1': hero } as unknown as Record<import('../index.js').Combatant['id'], import('../index.js').Combatant>;
    const result = cleansePartyAffliction(party, 'hero-1');
    expect(result.removed).toContain('poisoned');
    expect(result.removed).toContain('exhaustion:-1');
    expect(result.party['hero-1']!.conditions).not.toContain('poisoned');
    expect(() => cleansePartyAffliction(result.party, 'hero-1')).toThrow(RealmError);
    expect(() => cleansePartyAffliction(party, 'no-such-hero')).toThrow(RealmError);
  });

  it('blesses the living party exactly once', () => {
    const mk = (id: string, dead: boolean) =>
      ({
        id,
        name: id,
        conditions: [],
        isDead: dead,
        currentHp: dead ? 0 : 8,
      }) as unknown as import('../index.js').Combatant;
    const party = { a: mk('a', false), b: mk('b', true) } as unknown as Record<
      string,
      import('../index.js').Combatant
    >;
    const result = blessPartyWithTemple(party);
    expect(result.blessedCount).toBe(1);
    expect(result.party.a!.blessings).toContain(TEMPLE_BLESSING_ID);
    expect(() => blessPartyWithTemple(result.party)).toThrow(RealmError);
  });
});

describe('SRD-808: Tavern board giver blurbs', () => {
  it('attaches a deterministic giver name and blurb to every posting', () => {
    const { map, capital } = realm();
    const first = generateQuestBoard(map, capital, 777, { currentDay: 3 });
    const second = generateQuestBoard(map, capital, 777, { currentDay: 3 });
    expect(JSON.stringify(first.quests)).toBe(JSON.stringify(second.quests));
    for (const quest of first.quests) {
      expect(OverworldQuestSchema.safeParse(quest).success).toBe(true);
      expect(quest.giverName && quest.giverName.length).toBeGreaterThan(0);
      expect(quest.giverBlurb && quest.giverBlurb.length).toBeGreaterThan(0);
    }
  });
});
