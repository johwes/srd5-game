import type { InventorySlotName } from './InventoryView.js';

export type WeaponSetId = 'primary' | 'secondary';

export const WEAPON_SET_IDS: readonly WeaponSetId[] = ['primary', 'secondary'] as const;

export const WEAPON_SET_LABELS: Record<WeaponSetId, string> = {
  primary: 'Set I · Melee',
  secondary: 'Set II · Ranged',
};

export const WEAPON_SET_SHORT_LABELS: Record<WeaponSetId, string> = {
  primary: 'Set I',
  secondary: 'Set II',
};

/** Weapon-bearing short slots; armor/shield stay shared across sets. */
export const WEAPON_SLOTS: readonly InventorySlotName[] = ['mainHand', 'offHand', 'ranged'] as const;

const ENGINE_KEY_BY_SLOT: Record<InventorySlotName, string> = {
  armor: 'armorInstanceId',
  shield: 'shieldInstanceId',
  mainHand: 'mainHandInstanceId',
  offHand: 'offHandInstanceId',
  ranged: 'rangedInstanceId',
};

const SECONDARY_ENGINE_KEY_BY_SLOT: Partial<Record<InventorySlotName, string>> = {
  mainHand: 'secondaryMainHandInstanceId',
  offHand: 'secondaryOffHandInstanceId',
  ranged: 'secondaryRangedInstanceId',
};

/** All 8 engine slot keys (shared armor/shield + both weapon sets). */
export const ALL_ENGINE_SLOT_KEYS: readonly string[] = [
  'armorInstanceId',
  'shieldInstanceId',
  'mainHandInstanceId',
  'offHandInstanceId',
  'rangedInstanceId',
  'secondaryMainHandInstanceId',
  'secondaryOffHandInstanceId',
  'secondaryRangedInstanceId',
] as const;

/**
 * Resolves the active weapon set from any equipped-slots shape (short or
 * long engine form). Legacy saves without a discriminator default to
 * `'primary'` (mirrors `@srd5/data` `normalizeEquippedSlots`).
 */
export function resolveActiveWeaponSet(
  equippedSlots: Record<string, string | undefined> | undefined | null,
): WeaponSetId {
  const raw = (equippedSlots as Record<string, unknown> | undefined | null)?.activeWeaponSet;
  return raw === 'secondary' ? 'secondary' : 'primary';
}

/**
 * Maps a short UI slot to its engine key for the given active set.
 * Armor/shield stay shared; weapon slots address the secondary keys when
 * the secondary set is visible.
 */
export function engineKeyForSlot(slot: InventorySlotName, activeSet: WeaponSetId): string {
  if (activeSet === 'secondary') {
    const secondary = SECONDARY_ENGINE_KEY_BY_SLOT[slot];
    if (secondary) return secondary;
  }
  return ENGINE_KEY_BY_SLOT[slot];
}

/**
 * Reads one equipped instance id for a short slot under the active set.
 * Accepts both the short UI form (`{ mainHand: '<inst>' }`, primary only)
 * and the long engine form (both sets + discriminator).
 */
export function resolveSetAwareEquippedInstanceId(
  slots: Record<string, string | undefined> | undefined | null,
  slot: InventorySlotName,
  activeSet: WeaponSetId,
): string | undefined {
  if (!slots) return undefined;
  if (activeSet === 'secondary') {
    const secondaryKey = SECONDARY_ENGINE_KEY_BY_SLOT[slot];
    if (secondaryKey) return slots[secondaryKey];
  }
  return slots[slot] ?? slots[ENGINE_KEY_BY_SLOT[slot]];
}

/** Capitalizes a short slot suffix for secondary engine keys (`mainHand` → `MainHand`). */
export function capitalizeSlot(slot: InventorySlotName): string {
  return slot.charAt(0).toUpperCase() + slot.slice(1);
}
