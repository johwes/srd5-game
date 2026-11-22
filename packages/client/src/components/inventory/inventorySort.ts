import type { InventoryItemInstance, SrdCompendium } from '@srd5/data';
import {
  getInventoryFilterCategory,
  getInventoryItemName,
  getInventoryItemWeightLb,
} from './inventoryCategories.js';

/**
 * SRD-1504: Backpack sort control (Spec 14 §4: sort by Newest / Name / Type /
 * Value / Weight; Deck parity via a native `<select>`).
 *
 * - `newest` preserves acquisition order (backpack array order, stable).
 * - `name` sorts by display name (case-insensitive, instance-stable).
 * - `type` sorts by filter bucket, then name.
 * - `value` sorts by sale value (equipment `costCopper`, magic items ride
 *   their base item, unpriced magic counts as 0), descending, then name.
 * - `weight` sorts by per-unit weight descending, then name.
 */

export type InventorySortKey = 'newest' | 'name' | 'type' | 'value' | 'weight';

export const INVENTORY_SORTS: readonly InventorySortKey[] = [
  'newest',
  'name',
  'type',
  'value',
  'weight',
] as const;

export const INVENTORY_SORT_LABELS: Record<InventorySortKey, string> = {
  newest: 'Newest',
  name: 'Name',
  type: 'Type',
  value: 'Value',
  weight: 'Weight',
};

/** Sale value in copper for one unit (unpriced magic items count as 0). */
export function getInventoryItemValueCopper(itemId: string, compendium: SrdCompendium): number {
  const equip = compendium.getEquipment(itemId);
  if (equip) return equip.costCopper ?? 0;
  const magic = compendium.getMagicItem(itemId);
  if (magic?.baseEquipmentId) {
    return compendium.getEquipment(magic.baseEquipmentId)?.costCopper ?? 0;
  }
  return 0;
}

export function sortInventoryInstances<T extends InventoryItemInstance>(
  instances: readonly T[],
  sort: InventorySortKey,
  compendium: SrdCompendium,
): T[] {
  if (sort === 'newest') return [...instances];
  const decorated = instances.map((inst, index) => ({ inst, index }));
  const byName = (a: T, b: T) =>
    getInventoryItemName(a.itemId, compendium).localeCompare(
      getInventoryItemName(b.itemId, compendium),
      undefined,
      { sensitivity: 'base' },
    );
  switch (sort) {
    case 'name':
      decorated.sort((a, b) => byName(a.inst, b.inst) || a.index - b.index);
      break;
    case 'type':
      decorated.sort(
        (a, b) =>
          getInventoryFilterCategory(a.inst.itemId, compendium).localeCompare(
            getInventoryFilterCategory(b.inst.itemId, compendium),
          ) ||
          byName(a.inst, b.inst) ||
          a.index - b.index,
      );
      break;
    case 'value':
      decorated.sort(
        (a, b) =>
          getInventoryItemValueCopper(b.inst.itemId, compendium) -
            getInventoryItemValueCopper(a.inst.itemId, compendium) ||
          byName(a.inst, b.inst) ||
          a.index - b.index,
      );
      break;
    case 'weight':
      decorated.sort(
        (a, b) =>
          getInventoryItemWeightLb(b.inst.itemId, compendium) -
            getInventoryItemWeightLb(a.inst.itemId, compendium) ||
          byName(a.inst, b.inst) ||
          a.index - b.index,
      );
      break;
  }
  return decorated.map((d) => d.inst);
}
