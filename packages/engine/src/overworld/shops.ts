import {
  type OverworldPOI,
  type OverworldPOIService,
  type OverworldTravelState,
} from './schemas.js';
import {
  SELL_PRICE_RATIO,
  type ShopInventory,
  type ShopItem,
  type RealmEvent,
} from './realm-schemas.js';
import { getReputationPriceMultiplier } from './factions.js';
import { RealmError } from './realm-error.js';
import { normalizeSeed, nextRandomFloat } from '../dice/prng.js';
import { type InventoryItemInstance } from '@srd5/data';

/**
 * Settlement shops (SRD-803, Spec 06 §4.1 / §4.3).
 *
 * Shop stock is generated deterministically from the services a settlement
 * offers. Prices scale with the owning faction's reputation, and purchases
 * spend the party's overworld gold while producing serializable inventory
 * instances that can be handed to the character sheet/roster layer.
 */

export interface ShopCatalogEntry {
  readonly itemId: string;
  readonly name: string;
  /** Undiscounted list price in gold pieces (SRD 5.1 equipment / DMG magic item guidelines). */
  readonly basePriceGp: number;
  /** Inclusive stock range [min, max] rolled at generation time. */
  readonly stock: readonly [number, number];
  readonly isMagicItem: boolean;
  readonly rarity?: string;
}

/**
 * Curated catalog of canonical SRD 5.1 item IDs, grouped by the settlement
 * service that sells them. No non-SRD Product Identity items are included.
 */
export const SHOP_CATALOG: Readonly<Record<OverworldPOIService, readonly ShopCatalogEntry[]>> = {
  inn: [
    { itemId: 'rations-1-day', name: 'Rations (1 day)', basePriceGp: 0.5, stock: [3, 8], isMagicItem: false },
    { itemId: 'bedroll', name: 'Bedroll', basePriceGp: 0.1, stock: [1, 3], isMagicItem: false },
  ],
  blacksmith: [
    { itemId: 'dagger', name: 'Dagger', basePriceGp: 1, stock: [1, 4], isMagicItem: false },
    { itemId: 'shield', name: 'Shield', basePriceGp: 10, stock: [1, 3], isMagicItem: false },
    { itemId: 'longsword', name: 'Longsword', basePriceGp: 15, stock: [1, 3], isMagicItem: false },
    { itemId: 'chain-mail', name: 'Chain Mail', basePriceGp: 75, stock: [0, 2], isMagicItem: false },
    { itemId: 'weapon-plus-1', name: 'Weapon, +1', basePriceGp: 800, stock: [0, 1], isMagicItem: true, rarity: 'uncommon' },
  ],
  magic_shop: [
    { itemId: 'potion-of-healing', name: 'Potion of Healing', basePriceGp: 50, stock: [1, 4], isMagicItem: false },
    { itemId: 'antitoxin', name: 'Antitoxin', basePriceGp: 50, stock: [1, 3], isMagicItem: false },
    { itemId: 'potion-of-greater-healing', name: 'Potion of Greater Healing', basePriceGp: 120, stock: [0, 2], isMagicItem: true, rarity: 'uncommon' },
    { itemId: 'scroll-of-fireball', name: 'Scroll of Fireball', basePriceGp: 150, stock: [0, 2], isMagicItem: true, rarity: 'uncommon' },
    { itemId: 'bag-of-holding', name: 'Bag of Holding', basePriceGp: 300, stock: [0, 1], isMagicItem: true, rarity: 'uncommon' },
    { itemId: 'cloak-of-protection', name: 'Cloak of Protection', basePriceGp: 500, stock: [0, 1], isMagicItem: true, rarity: 'uncommon' },
  ],
  temple: [
    { itemId: 'potion-of-healing', name: 'Potion of Healing', basePriceGp: 50, stock: [1, 3], isMagicItem: false },
    { itemId: 'antitoxin', name: 'Antitoxin', basePriceGp: 50, stock: [1, 2], isMagicItem: false },
    { itemId: 'potion-of-greater-healing', name: 'Potion of Greater Healing', basePriceGp: 120, stock: [0, 1], isMagicItem: true, rarity: 'uncommon' },
  ],
  quest_board: [],
};

const SHOP_NAME_PREFIXES = ['Gilded', 'Silver', 'Crooked', 'Copper', 'Laughing', 'Sable'] as const;
const SHOP_NAME_SUFFIXES = ['Anvil', 'Lantern', 'Goblet', 'Forge', 'Emporium', 'Apothecary'] as const;

/** Finds a catalog entry by item ID across all services. */
export function getShopCatalogEntry(itemId: string): ShopCatalogEntry | undefined {
  for (const entries of Object.values(SHOP_CATALOG)) {
    const found = entries.find((entry) => entry.itemId === itemId);
    if (found) return found;
  }
  return undefined;
}

/** Rounds a gold amount to two decimal places (coalition of copper pieces). */
function roundGp(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Price of a single unit after applying the faction reputation modifier.
 * The macro economy tracks gold as whole coins, so fractional copper-based
 * SRD prices are rounded up to the nearest gold piece (minimum 1 gp).
 */
export function getShopItemPrice(item: ShopItem, reputation: number): number {
  return Math.max(1, Math.ceil(item.basePriceGp * getReputationPriceMultiplier(reputation)));
}

export interface ShopGenerationResult {
  inventory: ShopInventory;
  nextRngState: number;
}

/** Generates a settlement's shop inventory deterministically from its services. */
export function generateShopInventory(
  poi: OverworldPOI,
  rngState: number,
): ShopGenerationResult {
  let state = normalizeSeed(rngState);
  function nextFloat(): number {
    const res = nextRandomFloat(state);
    state = res.nextState;
    return res.value;
  }
  function pick<T>(items: readonly T[]): T {
    return items[Math.floor(nextFloat() * items.length)]!;
  }

  const services = (poi.services ?? []).filter((service) => SHOP_CATALOG[service].length > 0);
  const items: ShopItem[] = [];
  for (const service of services) {
    for (const entry of SHOP_CATALOG[service]) {
      const [min, max] = entry.stock;
      const quantity = min + Math.floor(nextFloat() * (max - min + 1));
      if (quantity <= 0) continue;
      const existing = items.find((item) => item.itemId === entry.itemId);
      if (existing) {
        // Consolidate the same SRD item offered by two services (e.g. potions).
        existing.quantity += quantity;
      } else {
        items.push({
          itemId: entry.itemId,
          name: entry.name,
          basePriceGp: entry.basePriceGp,
          quantity,
          isMagicItem: entry.isMagicItem,
          ...(entry.rarity ? { rarity: entry.rarity } : {}),
        });
      }
    }
  }

  const shopName = services.length > 0
    ? `${pick(SHOP_NAME_PREFIXES)} ${pick(SHOP_NAME_SUFFIXES)}`
    : `${poi.name} Notice Board`;

  return {
    inventory: {
      poiId: poi.id,
      shopName,
      ...(poi.factionId ? { factionId: poi.factionId } : {}),
      items,
    },
    nextRngState: state,
  };
}

export interface PurchaseResult {
  state: OverworldTravelState;
  inventory: ShopInventory;
  items: InventoryItemInstance[];
  costGp: number;
  events: RealmEvent[];
}

/**
 * Buys `quantity` units of an item from a shop. Spends overworld gold, reduces
 * stock, and returns inventory instances ready to be added to a character.
 */
export function purchaseItem(
  state: OverworldTravelState,
  inventory: ShopInventory,
  itemId: string,
  quantity: number,
  reputation = 0,
): PurchaseResult {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new RealmError(`Purchase quantity must be a positive integer (got ${quantity})`);
  }
  const stock = inventory.items.find((item) => item.itemId === itemId);
  if (!stock) throw new RealmError(`Shop '${inventory.poiId}' does not stock '${itemId}'`);
  if (stock.quantity < quantity) {
    throw new RealmError(`Shop '${inventory.poiId}' has only ${stock.quantity} of '${itemId}'`);
  }
  const costGp = getShopItemPrice(stock, reputation) * quantity;
  if (costGp > state.gold + 1e-9) {
    throw new RealmError(`Not enough gold (need ${costGp} gp, have ${state.gold} gp)`);
  }

  const goldRemaining = roundGp(state.gold - costGp);
  const items: InventoryItemInstance[] = Array.from({ length: quantity }, (_, index) => ({
    instanceId: `shop-${inventory.poiId}-${itemId}-${index + 1}-${state.gold}`,
    itemId,
    quantity: 1,
    isMagicItem: stock.isMagicItem,
    identified: true,
  }));

  return {
    state: { ...state, gold: goldRemaining },
    inventory: {
      ...inventory,
      items: inventory.items.map((item) =>
        item.itemId === itemId ? { ...item, quantity: item.quantity - quantity } : item,
      ),
    },
    items,
    costGp,
    events: [
      {
        type: 'SHOP_PURCHASE',
        poiId: inventory.poiId,
        itemId,
        quantity,
        costGp,
        goldRemaining,
      },
    ],
  };
}

export interface SaleResult {
  state: OverworldTravelState;
  goldEarned: number;
  events: RealmEvent[];
}

/** Sells an inventory instance back to a shop for half its reputation-adjusted value. */
export function sellItem(
  state: OverworldTravelState,
  inventory: ShopInventory,
  item: InventoryItemInstance,
  reputation = 0,
): SaleResult {
  const entry = getShopCatalogEntry(item.itemId);
  if (!entry) throw new RealmError(`'${item.itemId}' is not traded by any settlement shop`);
  const unitPrice = Math.max(1, Math.ceil(entry.basePriceGp * getReputationPriceMultiplier(reputation)));
  const goldEarned = Math.max(1, Math.floor(unitPrice * SELL_PRICE_RATIO)) * item.quantity;
  const goldTotal = roundGp(state.gold + goldEarned);
  return {
    state: { ...state, gold: goldTotal },
    goldEarned,
    events: [
      {
        type: 'SHOP_SALE',
        poiId: inventory.poiId,
        itemId: item.itemId,
        quantity: item.quantity,
        goldEarned,
        goldTotal,
      },
    ],
  };
}
