import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultCompendium } from '@srd5/data';
import {
  type GameState,
  type OverworldPOI,
  OverworldMapSchema,
  OverworldTravelStateSchema,
  RealmError,
  getOverworldTile,
  getSettlements,
} from '@srd5/engine';
import type { DungeonStorageAdapter } from '../persistence/index.js';
import {
  DEFAULT_REALM_STARTING_GOLD,
  type RealmSessionState,
  createRealmSession,
  describeRealmEvent,
  getCurrentPoi,
  getPartyList,
  isSettlementPoi,
  loadRealmSession,
  quickSaveRealmSession,
  reduceRealm,
  resolveRealmBattle,
} from '../components/realm/realmEngine.js';

/**
 * SRD-805: Realm session controller tests — deterministic bootstrap, travel /
 * camp / forage loop, settlement economy, quest journal, and the seamless
 * overworld-to-tactical battle round trip with commit-back.
 */

const SEED = 805;

function bootstrap(seed = SEED): RealmSessionState {
  return createRealmSession({ seed, width: 48, height: 48 });
}

/** Moves the party onto a chosen tile (test setup shortcut). */
function atPoi(session: RealmSessionState, poi: { q: number; r: number }): RealmSessionState {
  return {
    ...session,
    travel: { ...session.travel, partyPosition: { q: poi.q, r: poi.r } },
  };
}

function findPoi(session: RealmSessionState, kind: OverworldPOI['kind']): OverworldPOI {
  const poi = Object.values(session.map.pois).find((p) => p.kind === kind);
  if (!poi) throw new Error(`No ${kind} POI on map`);
  return poi;
}

function findShopSettlement(session: RealmSessionState): OverworldPOI {
  const poi = getSettlements(session.map).find((p) => session.shops[p.id]);
  if (!poi) throw new Error('No settlement with a shop');
  return poi;
}

/** Finds a walkable orthogonal neighbor of the party position. */
function findLandNeighbor(session: RealmSessionState): { q: number; r: number } {
  const { q, r } = session.travel.partyPosition;
  for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const tile = getOverworldTile(session.map, q + dq, r + dr);
    if (tile && tile.terrain !== 'ocean') return { q: q + dq, r: r + dr };
  }
  throw new Error('No land neighbor');
}

function forceVictory(battleGameState: GameState): GameState {
  const ended = structuredClone(battleGameState);
  for (const monster of Object.values(ended.monsters)) {
    monster.currentHp = 0;
    monster.isDead = true;
  }
  ended.combat = { ...ended.combat!, phase: 'combat_ended', outcome: 'party_victory' };
  return ended;
}

describe('SRD-805: Realm session controller (Spec 06 Section 4)', () => {
  let mathRandomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mathRandomSpy = vi.spyOn(Math, 'random');
  });

  afterEach(() => {
    mathRandomSpy.mockRestore();
  });

  describe('Bootstrap', () => {
    it('generates a schema-valid world with settlements, shops, quest boards and a persistent party', () => {
      const session = bootstrap();
      expect(OverworldMapSchema.safeParse(session.map).success).toBe(true);
      expect(OverworldTravelStateSchema.safeParse(session.travel).success).toBe(true);
      expect(getSettlements(session.map).length).toBeGreaterThanOrEqual(2);
      expect(Object.keys(session.shops).length).toBeGreaterThan(0);
      expect(session.questLog.quests.length).toBeGreaterThan(0);
      expect(session.questLog.quests.every((q) => q.status === 'available')).toBe(true);
      expect(getPartyList(session)).toHaveLength(4);
      for (const hero of getPartyList(session)) {
        expect(hero.buildState).toBeDefined();
        expect(hero.characterSheet).toBeDefined();
        expect(hero.teamId).toBe('party');
      }
      expect(session.travel.gold).toBe(DEFAULT_REALM_STARTING_GOLD);
      expect(session.travel.rations).toBe(10);
      // Party starts at a settlement.
      const startPoi = getCurrentPoi(session);
      expect(startPoi).not.toBeNull();
      expect(isSettlementPoi(startPoi!)).toBe(true);
      expect(mathRandomSpy).not.toHaveBeenCalled();
    });

    it('is bit-exact deterministic for identical seeds', () => {
      const a = bootstrap(4242);
      const b = bootstrap(4242);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(mathRandomSpy).not.toHaveBeenCalled();
    });
  });

  describe('Travel loop', () => {
    it('REALM_TRAVEL_TO moves the party, spends movement points and emits travel events', () => {
      const session = bootstrap();
      const destination = findLandNeighbor(session);
      const before = JSON.stringify(session);
      const result = reduceRealm(session, { type: 'REALM_TRAVEL_TO', destination });
      expect(result.session.travel.partyPosition).toEqual(destination);
      expect(result.session.travel.travelPointsRemaining).toBeLessThan(
        session.travel.travelPointsRemaining,
      );
      expect(result.events.some((e) => e.type === 'TRAVEL_COMPLETED')).toBe(true);
      expect(JSON.stringify(session)).toBe(before); // non-mutating
      expect(mathRandomSpy).not.toHaveBeenCalled();
    });

    it('rejects travel into the ocean with a travel error', () => {
      const session = bootstrap();
      const ocean = Object.values(session.map.tiles).find((t) => t.terrain === 'ocean');
      expect(ocean).toBeDefined();
      expect(() =>
        reduceRealm(session, {
          type: 'REALM_TRAVEL_TO',
          destination: { q: ocean!.q, r: ocean!.r },
        }),
      ).toThrow();
    });

    it('REALM_SET_PACE switches the pace profile', () => {
      const session = bootstrap();
      const result = reduceRealm(session, { type: 'REALM_SET_PACE', pace: 'fast' });
      expect(result.session.travel.travelPace).toBe('fast');
      expect(result.events.some((e) => e.type === 'REALM_LOG')).toBe(true);
    });

    it('REALM_FORAGE spends one movement point and resolves a Survival check', () => {
      const session = bootstrap();
      const result = reduceRealm(session, { type: 'REALM_FORAGE' });
      expect(result.session.travel.travelPointsRemaining).toBe(
        session.travel.travelPointsRemaining - 1,
      );
      const forage = result.events.find((e) => e.type === 'FORAGE_RESULT');
      expect(forage).toBeDefined();
      expect(result.session.travel.rngState).not.toBe(session.travel.rngState);
    });

    it('wilderness travel encounters are deterministic for a fixed seed', () => {
      const run = () => {
        let session = bootstrap(99);
        // Walk several tiles to exercise the encounter roll.
        for (let i = 0; i < 4; i++) {
          const destination = findLandNeighbor(session);
          const result = reduceRealm(session, { type: 'REALM_TRAVEL_TO', destination });
          session = result.session;
          if (result.battle) break;
        }
        return JSON.stringify(session);
      };
      expect(run()).toBe(run());
    });
  });

  describe('Camping', () => {
    it('Long Rest at a safe inn advances the day for free and refills the travel budget', () => {
      const session = bootstrap();
      const innPoi = getSettlements(session.map).find((p) => p.services?.includes('inn'))!;
      const atInn = atPoi(session, innPoi);
      const result = reduceRealm(atInn, { type: 'REALM_CAMP', restType: 'long' });
      expect(result.session.travel.currentDay).toBe(atInn.travel.currentDay + 1);
      expect(result.session.travel.timeOfDay).toBe('dawn');
      expect(result.session.travel.rations).toBe(atInn.travel.rations); // free at inn
      expect(result.session.travel.travelPointsRemaining).toBeGreaterThan(0);
      const camp = result.events.find((e) => e.type === 'CAMP_REST');
      expect(camp && camp.type === 'CAMP_REST' && camp.safe).toBe(true);
    });

    it('wilderness Long Rest consumes one ration per living member', () => {
      const session = bootstrap();
      // Camp on a wilderness land tile (no settlement POI).
      const wildTile = Object.values(session.map.tiles).find(
        (t) => t.terrain !== 'ocean' && !t.poiId,
      )!;
      const wild = atPoi(session, wildTile);
      const result = reduceRealm(wild, { type: 'REALM_CAMP', restType: 'long' });
      const camp = result.events.find((e) => e.type === 'CAMP_REST');
      expect(camp).toBeDefined();
      if (camp && camp.type === 'CAMP_REST' && !camp.starved) {
        expect(result.session.travel.rations).toBe(
          wild.travel.rations - getPartyList(wild).filter((h) => !h.isDead && h.currentHp > 0).length,
        );
      }
      expect(result.session.travel.currentDay).toBe(wild.travel.currentDay + 1);
    });

    it('Short Rest spends requested hit dice and heals', () => {
      const session = bootstrap();
      const hero = getPartyList(session)[0]!;
      const wounded: RealmSessionState = {
        ...session,
        party: {
          ...session.party,
          [hero.id]: { ...hero, currentHp: Math.max(1, hero.maxHp - 10) },
        },
      };
      const result = reduceRealm(wounded, {
        type: 'REALM_CAMP',
        restType: 'short',
        hitDiceToSpend: { [hero.id]: 1 },
      });
      expect(result.session.party[hero.id]!.currentHp).toBeGreaterThan(
        wounded.party[hero.id]!.currentHp,
      );
      // Camping always rolls the calendar to the next dawn (SRD-802 contract).
      expect(result.session.travel.currentDay).toBe(session.travel.currentDay + 1);
    });
  });

  describe('Settlement economy', () => {
    it('REALM_BUY_ITEM deducts gold, decrements stock and delivers items to the chosen hero', () => {
      const session = bootstrap();
      const shopPoi = findShopSettlement(session);
      const atShop = atPoi(session, shopPoi);
      const inventory = atShop.shops[shopPoi.id]!;
      const item = inventory.items.find((i) => i.quantity > 0 && i.basePriceGp <= 50)!;
      expect(item).toBeDefined();
      const heroId = atShop.partyOrder[1] ?? atShop.partyOrder[0]!;
      const beforeCount = atShop.party[heroId]!.buildState!.inventory.length;

      const result = reduceRealm(atShop, {
        type: 'REALM_BUY_ITEM',
        poiId: shopPoi.id,
        itemId: item.itemId,
        quantity: 1,
        characterId: heroId,
      });
      expect(result.session.travel.gold).toBeLessThan(atShop.travel.gold);
      expect(result.session.shops[shopPoi.id]!.items.find((i) => i.itemId === item.itemId)!.quantity).toBe(
        item.quantity - 1,
      );
      expect(result.session.party[heroId]!.buildState!.inventory.length).toBe(beforeCount + 1);
      expect(result.events.some((e) => e.type === 'SHOP_PURCHASE')).toBe(true);
    });

    it('REALM_SELL_ITEM returns half value gold and removes the instance', () => {
      const session = bootstrap();
      const shopPoi = findShopSettlement(session);
      const atShop = atPoi(session, shopPoi);
      const inventory = atShop.shops[shopPoi.id]!;
      const item = inventory.items.find((i) => i.quantity > 0 && i.basePriceGp <= 50)!;
      const heroId = atShop.partyOrder[0]!;
      const bought = reduceRealm(atShop, {
        type: 'REALM_BUY_ITEM',
        poiId: shopPoi.id,
        itemId: item.itemId,
        quantity: 1,
        characterId: heroId,
      });
      const instance = bought.session.party[heroId]!.buildState!.inventory.at(-1)!;
      const sold = reduceRealm(bought.session, {
        type: 'REALM_SELL_ITEM',
        poiId: shopPoi.id,
        characterId: heroId,
        instanceId: instance.instanceId,
      });
      expect(sold.session.travel.gold).toBeGreaterThan(bought.session.travel.gold);
      expect(
        sold.session.party[heroId]!.buildState!.inventory.some(
          (i) => i.instanceId === instance.instanceId,
        ),
      ).toBe(false);
      expect(sold.events.some((e) => e.type === 'SHOP_SALE')).toBe(true);
    });

    it('rejects purchases when the party is not at the settlement', () => {
      const session = bootstrap();
      const shopPoi = findShopSettlement(session);
      const elsewhere = atPoi(session, findPoi(session, 'dungeon_entrance'));
      expect(() =>
        reduceRealm(elsewhere, {
          type: 'REALM_BUY_ITEM',
          poiId: shopPoi.id,
          itemId: 'potion-of-healing',
          quantity: 1,
        }),
      ).toThrow(RealmError);
    });
  });

  describe('Quest journal', () => {
    it('accepts and abandons quests with status transitions and events', () => {
      const session = bootstrap();
      const quest = session.questLog.quests[0]!;
      const accepted = reduceRealm(session, { type: 'REALM_ACCEPT_QUEST', questId: quest.id });
      expect(accepted.session.questLog.quests.find((q) => q.id === quest.id)!.status).toBe('active');
      expect(accepted.events.some((e) => e.type === 'QUEST_ACCEPTED')).toBe(true);

      const abandoned = reduceRealm(accepted.session, {
        type: 'REALM_ABANDON_QUEST',
        questId: quest.id,
      });
      expect(abandoned.session.questLog.quests.find((q) => q.id === quest.id)!.status).toBe('failed');
      expect(abandoned.events.some((e) => e.type === 'QUEST_FAILED')).toBe(true);
    });
  });

  describe('Overworld-to-tactical battle round trip', () => {
    it('REALM_ENTER_POI generates a tactical battle preserving party HP and resources', () => {
      const session = bootstrap();
      const dungeon = findPoi(session, 'dungeon_entrance');
      const hero = getPartyList(session)[0]!;
      const wounded = {
        ...atPoi(session, dungeon),
        party: {
          ...atPoi(session, dungeon).party,
          [hero.id]: { ...hero, currentHp: Math.max(1, hero.maxHp - 7) },
        },
      };
      const result = reduceRealm(wounded, { type: 'REALM_ENTER_POI', poiId: dungeon.id });
      expect(result.battle).toBeDefined();
      expect(result.battle!.poiId).toBe(dungeon.id);
      expect(result.battleGameState).toBeDefined();
      expect(result.battleGameState!.mode).toBe('combat');
      expect(Object.keys(result.battleGameState!.monsters).length).toBeGreaterThan(0);
      expect(result.battleGameState!.party[hero.id]!.currentHp).toBe(
        wounded.party[hero.id]!.currentHp,
      );
      expect(result.events.some((e) => e.type === 'REALM_ENCOUNTER_STARTED')).toBe(true);
    });

    it('rejects entering an already-cleared POI', () => {
      const session = bootstrap();
      const lair = findPoi(session, 'monster_lair');
      const cleared: RealmSessionState = {
        ...atPoi(session, lair),
        clearedPoiIds: [lair.id],
      };
      expect(() => reduceRealm(cleared, { type: 'REALM_ENTER_POI', poiId: lair.id })).toThrow(
        RealmError,
      );
    });

    it('victory commits XP, gold, POI clearance and linked quest completion back to the realm', () => {
      const session = bootstrap();
      const dungeon = findPoi(session, 'dungeon_entrance');
      // Accept a quest targeting this dungeon if one exists.
      const linkedQuest = session.questLog.quests.find((q) => q.targetPoiId === dungeon.id);
      let prepared = atPoi(session, dungeon);
      if (linkedQuest) {
        prepared = reduceRealm(prepared, {
          type: 'REALM_ACCEPT_QUEST',
          questId: linkedQuest.id,
        }).session;
      }
      const goldBefore = prepared.travel.gold;

      const entered = reduceRealm(prepared, { type: 'REALM_ENTER_POI', poiId: dungeon.id });
      const ended = forceVictory(entered.battleGameState!);
      const resolved = resolveRealmBattle(prepared, ended, entered.battle!, defaultCompendium);

      expect(resolved.session.clearedPoiIds).toContain(dungeon.id);
      expect(resolved.totalXp).toBeGreaterThan(0);
      expect(resolved.session.travel.gold).toBeGreaterThanOrEqual(goldBefore);
      expect(resolved.events.some((e) => e.type === 'REALM_POI_CLEARED')).toBe(true);
      expect(resolved.events.some((e) => e.type === 'REALM_BATTLE_RESOLVED')).toBe(true);
      // Party persists with buildState for future progression.
      for (const hero of getPartyList(resolved.session)) {
        expect(hero.buildState).toBeDefined();
      }
      if (linkedQuest) {
        expect(resolved.completedQuestIds).toContain(linkedQuest.id);
        expect(
          resolved.session.questLog.quests.find((q) => q.id === linkedQuest.id)!.status,
        ).toBe('completed');
      }
      // Input session untouched.
      expect(session.clearedPoiIds).toHaveLength(0);
    });
  });

  describe('Event formatting & persistence', () => {
    it('formats realm events into travel-log lines', () => {
      expect(describeRealmEvent({ type: 'REALM_LOG', message: 'hello' })).toBe('hello');
      expect(
        describeRealmEvent({
          type: 'QUEST_ACCEPTED',
          questId: 'q1',
          title: 'Wolf Pelts',
          day: 2,
        }),
      ).toContain('Wolf Pelts');
    });

    it('quick-saves and loads the session through the storage adapter', async () => {
      const store: Record<string, unknown> = {};
      const adapter: DungeonStorageAdapter = {
        async getItem(k) {
          return store[k];
        },
        async setItem(k, v) {
          store[k] = structuredClone(v);
        },
        async removeItem(k) {
          delete store[k];
        },
      };
      const session = bootstrap();
      const moved = reduceRealm(session, {
        type: 'REALM_TRAVEL_TO',
        destination: findLandNeighbor(session),
      }).session;
      await quickSaveRealmSession(moved, adapter);
      const loaded = await loadRealmSession(adapter);
      expect(loaded).not.toBeNull();
      expect(JSON.stringify(loaded!.session)).toBe(JSON.stringify(moved));
      expect(loaded!.worldName).toBe(moved.map.worldName);
    });
  });
});
