import type { SrdCompendium } from '@srd5/data';
import type { InventorySlotName } from './InventoryView.js';

/**
 * SRD-1305: Equip-slot suggestion + stat-compare helpers (Spec 12 §8).
 *
 * Pure, UI-side presentation logic: which paperdoll slot(s) an item can
 * occupy, and the `+1 AC` / `-1 to-hit` deltas shown when hovering or
 * selecting a candidate versus the currently equipped item. Deterministic
 * (no randomness); engine remains authoritative for the actual equip.
 */

const WEAPON_SLOTS: readonly InventorySlotName[] = ['mainHand', 'offHand'];

/** All paperdoll slots an item id could occupy (empty = not equippable). */
export function candidateSlotsForItem(
  itemId: string,
  compendium: SrdCompendium,
): InventorySlotName[] {
  const magic = compendium.getMagicItem(itemId);
  if (magic) {
    switch (magic.category) {
      case 'weapon':
        return [...WEAPON_SLOTS];
      case 'armor':
        return magic.baseEquipmentId
          ? candidateSlotsForItem(magic.baseEquipmentId, compendium)
          : ['armor'];
      case 'staff':
      case 'wand':
      case 'rod':
        return [...WEAPON_SLOTS];
      default:
        break;
    }
    if (magic.baseEquipmentId) return candidateSlotsForItem(magic.baseEquipmentId, compendium);
    return [];
  }
  const equip = compendium.getEquipment(itemId);
  if (!equip) return [];
  if (equip.kind === 'armor') {
    return equip.category === 'shield' ? ['shield'] : ['armor'];
  }
  if (equip.kind === 'weapon') {
    if (equip.rangeType === 'ranged') return ['ranged', 'mainHand'];
    return [...WEAPON_SLOTS];
  }
  return [];
}

/** Preferred single slot for the one-click Equip action. */
export function suggestEquipSlot(
  itemId: string,
  compendium: SrdCompendium,
): InventorySlotName | null {
  const slots = candidateSlotsForItem(itemId, compendium);
  if (slots.length === 0) return null;
  const equip = compendium.getEquipment(itemId);
  if (equip?.kind === 'weapon' && equip.rangeType === 'ranged') return 'ranged';
  return slots[0] ?? null;
}

/** Flat AC contribution of an item: armor `baseAc` + `flat_bonus → ac`. */
export function getItemAcValue(itemId: string, compendium: SrdCompendium): number {
  let ac = 0;
  const equip = compendium.getEquipment(itemId);
  if (equip?.kind === 'armor') ac += equip.baseAc;
  const magicRec = compendium.getMagicItem(itemId);
  const baseId = magicRec?.baseEquipmentId;
  if (baseId) {
    const base = compendium.getEquipment(baseId);
    if (base?.kind === 'armor') ac += base.baseAc;
  }
  const mods = magicRec?.modifiers ?? [];
  for (const mod of mods) {
    if (mod.type === 'flat_bonus' && mod.target === 'ac') {
      const v = typeof mod.value === 'number' ? mod.value : Number(mod.value);
      if (Number.isFinite(v)) ac += v;
    }
  }
  return ac;
}

/** Flat to-hit contribution: `flat_bonus` → melee/ranged/spell/attack rolls. */
export function getItemAttackBonus(itemId: string, compendium: SrdCompendium): number {
  const magic = compendium.getMagicItem(itemId);
  if (!magic) return 0;
  let bonus = 0;
  for (const mod of magic.modifiers ?? []) {
    if (mod.type !== 'flat_bonus') continue;
    const target = String(mod.target);
    if (
      target === 'melee_attack' ||
      target === 'ranged_attack' ||
      target === 'attack_rolls' ||
      target === 'spell_attack'
    ) {
      const v = typeof mod.value === 'number' ? mod.value : Number(mod.value);
      if (Number.isFinite(v)) bonus += v;
    }
  }
  return bonus;
}

function formatDelta(value: number, unit: string, emptySlot: boolean, equippedName: string): string {
  const signed = value >= 0 ? `+${value}` : `${value}`;
  return emptySlot
    ? `Equips ${signed} ${unit} (slot empty)`
    : `${signed} ${unit} vs equipped ${equippedName}`;
}

/**
 * Human compare lines for a candidate item versus the equipped occupant of
 * its suggested slot. Empty array = no numeric difference (caller renders
 * the "no stat change" fallback).
 */
export function compareItemToEquipped(
  candidateItemId: string,
  equippedItemId: string | null | undefined,
  compendium: SrdCompendium,
): string[] {
  const lines: string[] = [];
  const acDelta = getItemAcValue(candidateItemId, compendium) - (equippedItemId ? getItemAcValue(equippedItemId, compendium) : 0);
  if (acDelta !== 0) {
    lines.push(
      formatDelta(
        acDelta,
        'AC',
        !equippedItemId,
        equippedItemId ? getCandidateName(equippedItemId, compendium) : '',
      ),
    );
  }
  const atkDelta =
    getItemAttackBonus(candidateItemId, compendium) -
    (equippedItemId ? getItemAttackBonus(equippedItemId, compendium) : 0);
  if (atkDelta !== 0) {
    lines.push(
      formatDelta(
        atkDelta,
        'to-hit',
        !equippedItemId,
        equippedItemId ? getCandidateName(equippedItemId, compendium) : '',
      ),
    );
  }
  return lines;
}

function getCandidateName(itemId: string, compendium: SrdCompendium): string {
  return (
    compendium.getMagicItem(itemId)?.name ??
    compendium.getEquipment(itemId)?.name ??
    itemId.replace(/[-_]+/g, ' ')
  );
}
