import type { Combatant } from '../combat/types.js';

/**
 * SRD-1304: shared helpers for revived magic-item mechanics.
 *
 * - `flame-tongue`: bonus-action ignite applies the `flame-tongue-ablaze`
 *   active effect; melee hits while ablaze deal an extra 2d6 fire (see
 *   `combat/attack.ts`).
 * - `periapt-of-wound-closure`: auto-stabilize when dying at turn start
 *   (see `combat/state-machine.ts`) and double Hit Die healing (see
 *   `dungeon/rest.ts`).
 */

export const FLAME_TONGUE_ITEM_ID = 'flame-tongue' as const;
export const FLAME_TONGUE_ABLAZE_EFFECT_ID = 'flame-tongue-ablaze' as const;
export const PERIAPT_ITEM_ID = 'periapt-of-wound-closure' as const;

/** Attuned + carried (periapt is worn; attunement implies wearing for v1). */
export function hasAttunedMagicItem(
  combatant: Pick<Combatant, 'buildState'>,
  itemId: string,
): boolean {
  const inv = combatant.buildState?.inventory ?? [];
  const attuned = new Set(combatant.buildState?.attunedItemInstanceIds ?? []);
  return inv.some((i) => i.itemId === itemId && attuned.has(i.instanceId));
}

/** True when the attacker ignited an attuned Flame Tongue (ablaze buff present). */
export function isFlameTongueAblaze(attacker: Pick<Combatant, 'buildState' | 'activeEffects'>): boolean {
  const ablaze = attacker.activeEffects?.some(
    (e) => e.effectId === FLAME_TONGUE_ABLAZE_EFFECT_ID,
  );
  if (!ablaze) return false;
  return hasAttunedMagicItem(attacker, FLAME_TONGUE_ITEM_ID);
}
