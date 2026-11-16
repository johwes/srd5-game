import { describe, expect, it } from 'vitest';
import { InventoryItemInstanceSchema, defaultCompendium } from '@srd5/data';
import {
  type OverworldTravelState,
  OverworldQuestSchema,
  OverworldTravelStateSchema,
  QuestLogSchema,
  RealmError,
  SHOP_CATALOG,
  acceptQuest,
  buildFactionDispositionMatrix,
  completeQuest,
  completeQuestForParty,
  createOverworldTravelState,
  createQuestLog,
  failQuest,
  generateOverworldMap,
  generateQuestBoard,
  generateShopInventory,
  getActiveQuests,
  getAvailableQuests,
  getCompletedQuests,
  getFactionReputation,
  getQuestById,
  getShopCatalogEntry,
  getShopItemPrice,
  isServiceAvailableToParty,
  populateSettlements,
  purchaseItem,
  sellItem,
  setFactionReputation,
} from '../index.js';

function realm(seed = 808) {
  const generated = generateOverworldMap({ seed, width: 64, height: 64 });
  const settlements = populateSettlements(generated.map, generated.settlementSites);
  const capital = settlements.settlements[0]!;
  const state = createOverworldTravelState(settlements.map);
  return { generated, ...settlements, capital, state };
}

function isSrdItem(itemId: string): boolean {
  return Boolean(defaultCompendium.getEquipment(itemId) ?? defaultCompendium.getMagicItem(itemId));
}

describe('SRD-803: Settlement shops (Spec 06 §4.1 / §4.3)', () => {
  it('uses only canonical SRD item IDs in its catalog', () => {
    for (const entries of Object.values(SHOP_CATALOG)) {
      for (const entry of entries) expect(isSrdItem(entry.itemId)).toBe(true);
    }
    expect(getShopCatalogEntry('longsword')?.basePriceGp).toBe(15);
    expect(getShopCatalogEntry('not-a-real-item')).toBeUndefined();
  });

  it('generates deterministic inventory that respects the settlement services', () => {
    const { capital, generated } = realm();
    const first = generateShopInventory(capital, 12345);
    const second = generateShopInventory(capital, 12345);

    expect(JSON.stringify(first.inventory)).toBe(JSON.stringify(second.inventory));
    expect(first.nextRngState).toBe(second.nextRngState);
    expect(first.inventory.items.length).toBeGreaterThan(0);
    expect(first.inventory.shopName.length).toBeGreaterThan(0);
    for (const item of first.inventory.items) {
      expect(isSrdItem(item.itemId)).toBe(true);
      expect(item.quantity).toBeGreaterThan(0);
      expect(item.basePriceGp).toBeGreaterThan(0);
    }

    const lair = Object.values(generated.map.pois).find((poi) => poi.kind === 'monster_lair')!;
    const empty = generateShopInventory(lair, 7);
    expect(empty.inventory.items).toHaveLength(0);
    expect(empty.inventory.shopName).toContain('Notice Board');
  });

  it('applies reputation pricing to whole-gold list prices', () => {
    const { capital } = realm();
    const inventory = generateShopInventory(capital, 99).inventory;
    const potion = inventory.items.find((item) => item.itemId === 'potion-of-healing')!;
    expect(potion).toBeDefined();

    expect(getShopItemPrice(potion, 0)).toBe(50);
    expect(getShopItemPrice(potion, -100)).toBeGreaterThan(getShopItemPrice(potion, 0));
    expect(getShopItemPrice(potion, 100)).toBeLessThan(getShopItemPrice(potion, 0));
    expect(Number.isInteger(getShopItemPrice(potion, -100))).toBe(true);
    expect(getShopItemPrice(potion, -100)).toBeGreaterThanOrEqual(1);
  });

  it('buys items with overworld gold, reduces stock, and returns inventory instances', () => {
    const { capital, state } = realm();
    const inventory = generateShopInventory(capital, 5).inventory;
    const potion = inventory.items.find((item) => item.itemId === 'potion-of-healing')!;
    const rich: OverworldTravelState = { ...state, gold: 10000 };

    const result = purchaseItem(rich, inventory, 'potion-of-healing', 2, 0);
    expect(result.costGp).toBe(100);
    expect(result.state.gold).toBe(9900);
    expect(result.items).toHaveLength(2);
    for (const instance of result.items) {
      expect(InventoryItemInstanceSchema.safeParse(instance).success).toBe(true);
      expect(instance.itemId).toBe('potion-of-healing');
    }
    expect(result.inventory.items.find((item) => item.itemId === 'potion-of-healing')!.quantity).toBe(
      potion.quantity - 2,
    );
    expect(result.events).toMatchObject([
      { type: 'SHOP_PURCHASE', itemId: 'potion-of-healing', quantity: 2, costGp: 100 },
    ]);
    expect(rich.gold).toBe(10000); // non-mutating
    expect(OverworldTravelStateSchema.safeParse(result.state).success).toBe(true);
  });

  it('rejects unstocked items, oversized orders, bad quantities, and insufficient gold', () => {
    const { capital, state } = realm();
    const inventory = generateShopInventory(capital, 5).inventory;
    const rich: OverworldTravelState = { ...state, gold: 10000 };

    expect(() => purchaseItem(rich, inventory, 'not-a-real-item', 1)).toThrow(RealmError);
    expect(() => purchaseItem(rich, inventory, 'potion-of-healing', 0)).toThrow(RealmError);
    expect(() => purchaseItem(rich, inventory, 'potion-of-healing', 9999)).toThrow(RealmError);
    expect(() =>
      purchaseItem({ ...rich, gold: 0 }, inventory, 'potion-of-healing', 1),
    ).toThrow(RealmError);
  });

  it('sells items back for half their reputation-adjusted value', () => {
    const { capital, state } = realm();
    const inventory = generateShopInventory(capital, 5).inventory;
    const instance = {
      instanceId: 'hero-potion-1',
      itemId: 'potion-of-healing',
      quantity: 1,
      isMagicItem: false,
      identified: true,
    };
    const poor: OverworldTravelState = { ...state, gold: 0 };
    const sale = sellItem(poor, inventory, instance, 0);

    expect(sale.goldEarned).toBe(25);
    expect(sale.state.gold).toBe(25);
    expect(poor.gold).toBe(0);
    expect(sale.events).toMatchObject([{ type: 'SHOP_SALE', goldEarned: 25 }]);
    expect(() => sellItem(poor, inventory, { ...instance, itemId: 'bogus' })).toThrow(RealmError);
  });
});

describe('SRD-803: Quest boards (Spec 06 §4.1)', () => {
  it('generates deterministic bounty and dungeon postings referencing real POIs', () => {
    const { map, capital } = realm();
    const first = generateQuestBoard(map, capital, 777, { currentDay: 3 });
    const second = generateQuestBoard(map, capital, 777, { currentDay: 3 });

    expect(JSON.stringify(first.quests)).toBe(JSON.stringify(second.quests));
    expect(first.nextRngState).toBe(second.nextRngState);
    expect(first.quests).toHaveLength(3);
    expect(first.quests.map((quest) => quest.kind)).toContain('bounty');
    expect(first.quests.map((quest) => quest.kind)).toContain('dungeon');

    for (const quest of first.quests) {
      expect(OverworldQuestSchema.safeParse(quest).success).toBe(true);
      expect(quest.status).toBe('available');
      expect(quest.createdDay).toBe(3);
      expect(quest.expiresDay!).toBeGreaterThan(3);
      expect(quest.rewardGold).toBeGreaterThan(0);
      expect(quest.reputationReward).toBeGreaterThan(0);
      expect(quest.boardPoiId).toBe(capital.id);
      expect(quest.factionId).toBe(capital.factionId);
      if (quest.targetPoiId) expect(map.pois[quest.targetPoiId]).toBeDefined();
      if (quest.targetMonsterId) expect(defaultCompendium.getMonster(quest.targetMonsterId)).toBeDefined();
    }
  });

  it('posts fetch/escort commissions when no wilderness targets exist', () => {
    const { map, capital } = realm();
    const stripped = structuredClone(map);
    for (const poi of Object.values(stripped.pois)) {
      if (poi.kind === 'dungeon_entrance' || poi.kind === 'monster_lair') {
        delete stripped.pois[poi.id];
      }
    }
    const board = generateQuestBoard(stripped, capital, 1, { questsPerBoard: 2 }).quests;
    expect(board.map((quest) => quest.kind)).toEqual(['fetch', 'escort']);
    expect(board.every((quest) => quest.targetPoiId === undefined)).toBe(true);
  });

  it('accepts only available unexpired quests and tracks status transitions', () => {
    const { map, capital } = realm();
    const board = generateQuestBoard(map, capital, 777, { currentDay: 3 }).quests;
    const log = createQuestLog(board);
    expect(QuestLogSchema.safeParse(log).success).toBe(true);
    expect(getAvailableQuests(log)).toHaveLength(3);

    const questId = board[0]!.id;
    expect(() => acceptQuest(log, 'no-such-quest', 4)).toThrow(RealmError);

    const accepted = acceptQuest(log, questId, 4);
    expect(getActiveQuests(accepted)).toHaveLength(1);
    expect(getQuestById(accepted, questId).acceptedDay).toBe(4);
    expect(getAvailableQuests(accepted)).toHaveLength(2);
    expect(() => acceptQuest(accepted, questId, 4)).toThrow(RealmError);

    const expiredLog = createQuestLog([{ ...board[0]!, expiresDay: 2 }]);
    expect(() => acceptQuest(expiredLog, questId, 5)).toThrow(RealmError);

    expect(() => completeQuest(log, questId, 5)).toThrow(RealmError);
    const done = completeQuest(accepted, questId, 5);
    expect(done.quest.status).toBe('completed');
    expect(done.quest.completedDay).toBe(5);
    expect(getCompletedQuests(done.log)).toHaveLength(1);
    expect(() => completeQuest(done.log, questId, 5)).toThrow(RealmError);

    const failed = failQuest(accepted, questId, 5);
    expect(getQuestById(failed, questId).status).toBe('failed');
    expect(getQuestById(failed, questId).failedDay).toBe(5);
    expect(() => failQuest(failed, questId, 6)).toThrow(RealmError);
  });

  it('resolves completion into gold, reputation, and realm events without mutation', () => {
    const { map, capital, state } = realm();
    const board = generateQuestBoard(map, capital, 777, { currentDay: 1 }).quests;
    const accepted = acceptQuest(createQuestLog(board), board[0]!.id, 2);
    const factionId = board[0]!.factionId!;
    const beforeRep = getFactionReputation(map, factionId);

    const resolved = completeQuestForParty(accepted, state, map, board[0]!.id, 3);
    expect(resolved.rewardGold).toBe(board[0]!.rewardGold);
    expect(resolved.state.gold).toBe(state.gold + board[0]!.rewardGold);
    expect(getFactionReputation(resolved.map, factionId)).toBe(
      beforeRep + board[0]!.reputationReward,
    );
    expect(resolved.events.map((event) => event.type)).toEqual([
      'QUEST_COMPLETED',
      'REPUTATION_CHANGED',
    ]);

    expect(state.gold).toBe(0);
    expect(getFactionReputation(map, factionId)).toBe(beforeRep);
    expect(OverworldTravelStateSchema.safeParse(resolved.state).success).toBe(true);
  });
});

describe('SRD-803: Realm loop integration', () => {
  it('ties settlement reputation into shop pricing, service access, and combat disposition', () => {
    const { map, capital, state } = realm();
    const inventory = generateShopInventory(capital, 5).inventory;
    const potion = inventory.items.find((item) => item.itemId === 'potion-of-healing')!;

    const hostile = setFactionReputation(map, 'iron-covenant', -100).map;
    const friendly = setFactionReputation(map, 'iron-covenant', 100).map;
    expect(getShopItemPrice(potion, getFactionReputation(hostile, 'iron-covenant'))).toBeGreaterThan(
      getShopItemPrice(potion, getFactionReputation(friendly, 'iron-covenant')),
    );
    expect(isServiceAvailableToParty(hostile, capital, 'blacksmith')).toBe(false);
    expect(isServiceAvailableToParty(friendly, capital, 'blacksmith')).toBe(true);
    expect(buildFactionDispositionMatrix(hostile)['player_guild']!['iron-covenant']).toBe('hostile');
    expect(buildFactionDispositionMatrix(friendly)['player_guild']!['iron-covenant']).toBe('allied');

    const purchase = purchaseItem({ ...state, gold: 1000 }, inventory, 'potion-of-healing', 1, 100);
    expect(purchase.state.gold).toBe(1000 - getShopItemPrice(potion, 100));
  });
});
