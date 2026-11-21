import type { InventoryItemInstance, SrdCompendium } from '@srd5/data';

/**
 * SRD-1305: Backpack filter categories + item metadata helpers (Spec 12 §8).
 *
 * Single seam mapping every canonical equipment / magic-item id to one of
 * the six backpack filter buckets. Unknown ids land in `other` (never
 * dropped from the grid).
 */

export type InventoryFilterKey =
  | 'all'
  | 'weapons'
  | 'armor'
  | 'potions'
  | 'scrolls'
  | 'tools'
  | 'other';

export const INVENTORY_FILTERS: readonly InventoryFilterKey[] = [
  'all',
  'weapons',
  'armor',
  'potions',
  'scrolls',
  'tools',
  'other',
] as const;

export const INVENTORY_FILTER_LABELS: Record<InventoryFilterKey, string> = {
  all: 'All',
  weapons: 'Weapons',
  armor: 'Armor',
  potions: 'Potions',
  scrolls: 'Scrolls',
  tools: 'Tools',
  other: 'Other',
};

/** Full display name for an item id (magic name, else equipment name, else slug). */
export function getInventoryItemName(itemId: string, compendium: SrdCompendium): string {
  const magic = compendium.getMagicItem(itemId);
  if (magic) return magic.name;
  const equip = compendium.getEquipment(itemId);
  if (equip) return equip.name;
  return itemId.replace(/[-_]+/g, ' ');
}

/**
 * Filter bucket for an item id.
 *
 * - Mundane weapons (`kind: 'weapon'`) → `weapons`.
 * - Mundane armor incl. shields (`kind: 'armor'`) → `armor`.
 * - Gear consumables (potions, antitoxin, acid, holy water, healer's kit…)
 *   → `potions`; other gear/packs → `other`.
 * - Tools → `tools`.
 * - Magic potions/scrolls → their own buckets; magic weapons/armor follow
 *   their category (or `baseEquipmentId` when present); wands/staffs/rods,
 *   rings and wondrous items → `other` (they work passively / via Use).
 */
export function getInventoryFilterCategory(
  itemId: string,
  compendium: SrdCompendium,
): Exclude<InventoryFilterKey, 'all'> {
  const magic = compendium.getMagicItem(itemId);
  if (magic) {
    switch (magic.category) {
      case 'potion':
        return 'potions';
      case 'scroll':
        return 'scrolls';
      case 'weapon':
        return 'weapons';
      case 'armor':
        return 'armor';
      default:
        break;
    }
    if (magic.baseEquipmentId) {
      const base = compendium.getEquipment(magic.baseEquipmentId);
      if (base?.kind === 'weapon') return 'weapons';
      if (base?.kind === 'armor') return 'armor';
    }
    return 'other';
  }
  const equip = compendium.getEquipment(itemId);
  if (!equip) return 'other';
  switch (equip.kind) {
    case 'weapon':
      return 'weapons';
    case 'armor':
      return 'armor';
    case 'tool':
      return 'tools';
    case 'gear': {
      const id = itemId.toLowerCase();
      if (
        equip.category === 'consumable' ||
        id.includes('potion') ||
        id === 'antitoxin' ||
        id === 'acid-vial' ||
        id === 'alchemists-fire' ||
        id === 'holy-water' ||
        id === 'healers-kit'
      ) {
        return 'potions';
      }
      if (id.includes('scroll') || id.includes('spellbook')) return 'scrolls';
      return 'other';
    }
    default:
      return 'other';
  }
}

/** Weight in lb for one unit of an item (magic items ride their base item). */
export function getInventoryItemWeightLb(itemId: string, compendium: SrdCompendium): number {
  const equip = compendium.getEquipment(itemId);
  if (equip) return equip.weightLb;
  const magic = compendium.getMagicItem(itemId);
  if (magic?.baseEquipmentId) {
    return compendium.getEquipment(magic.baseEquipmentId)?.weightLb ?? 0;
  }
  return 0;
}

/** Total carried weight across an inventory list (quantity-aware). */
export function getInventoryTotalWeightLb(
  inventory: readonly InventoryItemInstance[],
  compendium: SrdCompendium,
): number {
  let total = 0;
  for (const inst of inventory) {
    total += getInventoryItemWeightLb(inst.itemId, compendium) * inst.quantity;
  }
  // Round to 2dp to avoid float dust (e.g. 0.05 lb bullets).
  return Math.round(total * 100) / 100;
}

/** True when the item requires attunement per the dataset. */
export function isInventoryItemAttunable(itemId: string, compendium: SrdCompendium): boolean {
  return Boolean(compendium.getMagicItem(itemId)?.requiresAttunement);
}

/**
 * True when an instance exposes a Use action: consumable gear (potions,
 * antitoxin, acid, alchemist's fire, holy water, healer's kit), any magic
 * potion/scroll, or a charged item / item with activated abilities.
 */
export function isInventoryItemUsable(itemId: string, compendium: SrdCompendium): boolean {
  const lowered = itemId.toLowerCase();
  if (
    lowered.includes('potion') ||
    lowered === 'antitoxin' ||
    lowered === 'acid-vial' ||
    lowered === 'alchemists-fire' ||
    lowered === 'holy-water' ||
    lowered === 'healers-kit'
  ) {
    return true;
  }
  const magic = compendium.getMagicItem(itemId);
  if (!magic) {
    const equip = compendium.getEquipment(itemId);
    if (equip?.kind === 'gear' && (equip.activatedAbilities?.length ?? 0) > 0) return true;
    return false;
  }
  if (magic.category === 'potion' || magic.category === 'scroll') return true;
  if (magic.charges) return true;
  return (magic.activatedAbilities?.length ?? 0) > 0;
}
