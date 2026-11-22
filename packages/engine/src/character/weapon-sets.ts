import {
  getActiveWeaponSlotIds,
  getWeaponSetSlotIds,
  normalizeEquippedSlots,
  type EquippedSlots,
  type WeaponSetId,
} from '@srd5/data';

export type { WeaponSetId };
export { getActiveWeaponSlotIds, getWeaponSetSlotIds, normalizeEquippedSlots };

export const WEAPON_SET_IDS: readonly WeaponSetId[] = ['primary', 'secondary'];

/** The alternate set — used when `SWAP_WEAPON_SET` omits an explicit target. */
export function otherWeaponSet(set: WeaponSetId): WeaponSetId {
  return set === 'primary' ? 'secondary' : 'primary';
}

/** Resolves the effective active set, defaulting legacy saves to `'primary'`. */
export function resolveActiveWeaponSet(slots: Partial<EquippedSlots>): WeaponSetId {
  return normalizeEquippedSlots(slots).activeWeaponSet;
}

/**
 * Overlays one weapon set's instance ids onto a base slot map.
 * Used by tests and the builder to author per-set loadouts.
 */
export function withWeaponSetSlots(
  base: EquippedSlots,
  set: WeaponSetId,
  partial: { mainHandInstanceId?: string; offHandInstanceId?: string; rangedInstanceId?: string },
): EquippedSlots {
  if (set === 'secondary') {
    return {
      ...base,
      ...(partial.mainHandInstanceId !== undefined
        ? { secondaryMainHandInstanceId: partial.mainHandInstanceId }
        : {}),
      ...(partial.offHandInstanceId !== undefined
        ? { secondaryOffHandInstanceId: partial.offHandInstanceId }
        : {}),
      ...(partial.rangedInstanceId !== undefined
        ? { secondaryRangedInstanceId: partial.rangedInstanceId }
        : {}),
    };
  }
  return {
    ...base,
    ...(partial.mainHandInstanceId !== undefined
      ? { mainHandInstanceId: partial.mainHandInstanceId }
      : {}),
    ...(partial.offHandInstanceId !== undefined
      ? { offHandInstanceId: partial.offHandInstanceId }
      : {}),
    ...(partial.rangedInstanceId !== undefined
      ? { rangedInstanceId: partial.rangedInstanceId }
      : {}),
  };
}
