import type { DerivedCharacterSheet } from '../character/schemas.js';
import {
  RealmError,
} from './realm-error.js';

/**
 * SRD-1104 shared 5e sheet readers for war negotiation resolvers.
 *
 * Pure helpers used by the SRD-1103 approach resolver and the SRD-1104
 * truce / hire / patrol resolvers: best-party skill bonus lookup, prepared
 * spell-slot search, and deterministic slot deduction. No RNG here.
 */

// ---------------------------------------------------------------------------
// Shared 5e sheet readers (mirrors the SRD-1103 approach resolver)
// ---------------------------------------------------------------------------

export function skillBonusOf(sheet: DerivedCharacterSheet, skillId: string): number {
  const skills = sheet.skills as unknown as Record<string, { totalBonus?: number } | undefined>;
  const entry = skills[skillId];
  if (entry && typeof entry.totalBonus === 'number') return entry.totalBonus;
  return 0;
}

export function bestBonusOf(party: DerivedCharacterSheet[], ...skillIds: string[]): { bonus: number; sheet: DerivedCharacterSheet } {
  let best = { bonus: Number.NEGATIVE_INFINITY, sheet: party[0]! };
  for (const sheet of party) {
    const bonus = Math.max(...skillIds.map((id) => skillBonusOf(sheet, id)));
    if (bonus > best.bonus) best = { bonus, sheet };
  }
  return best;
}

export function availableSlotsAt(sheet: DerivedCharacterSheet, level: number): number {
  const pool = (sheet.spellcasting?.spellSlots as unknown as Record<number, { available?: number } | undefined>)?.[level];
  return pool?.available ?? 0;
}

export function findSpellCaster(
  party: DerivedCharacterSheet[],
  spellId: string,
  slotLevel: number,
): DerivedCharacterSheet | null {
  for (const sheet of party) {
    const prepared = new Set([
      ...(sheet.spellcasting?.preparedOrKnownSpellIds ?? []),
      ...(sheet.spellcasting?.spellbookSpellIds ?? []),
      ...(sheet.spellcasting?.cantripIds ?? []),
    ]);
    if (!prepared.has(spellId)) continue;
    for (let level = slotLevel; level <= 9; level++) {
      if (availableSlotsAt(sheet, level) > 0) return sheet;
    }
  }
  return null;
}

export function deductSlot(sheet: DerivedCharacterSheet, requestedLevel: number): { updated: DerivedCharacterSheet; slotLevel: number } {
  const next = structuredClone(sheet);
  const slots = next.spellcasting.spellSlots as unknown as Record<
    number,
    { max: number; expended: number; available: number }
  >;
  for (let level = requestedLevel; level <= 9; level++) {
    const pool = slots[level];
    if (pool && pool.available > 0) {
      pool.expended += 1;
      pool.available = Math.max(0, pool.available - 1);
      return { updated: next, slotLevel: level };
    }
  }
  throw new RealmError(`Caster ${sheet.name} has no available spell slot at level ${requestedLevel}+`);
}
