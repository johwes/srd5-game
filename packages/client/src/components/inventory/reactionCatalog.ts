import type { CharacterBuildState } from '@srd5/data';
import type { DerivedCharacterSheet } from '@srd5/engine';

// ============================================================================
// SRD-1509: Owned-reaction catalog (Spec 14 §12) — pure, engine-free.
//
// Lists every reaction a hero can take so the Reactions policy tab can flip
// Ask/Auto/Off per reaction. Detection mirrors the engine detectors
// (`packages/engine/src/combat/reactions.ts`) but over derived-sheet data
// only: no combat state, no engine imports.
// ============================================================================

export interface OwnedReactionEntry {
  /** Canonical policy key (`opportunity_attack`, `shield`, ...). */
  key: string;
  /** Display name. */
  label: string;
  /** One-line rules summary. */
  description: string;
  /** Slot tag shown beside the name (`I+`, `III+`, `—`). */
  slotTag: string;
  /** Emoji/icon glyph (licensed-emoji palette, no new art). */
  icon: string;
}

function hasSpellId(derived: DerivedCharacterSheet, spellId: string): boolean {
  const norm = spellId.toLowerCase();
  const sc = derived.spellcasting;
  return (
    sc.preparedOrKnownSpellIds.some((s) => s.toLowerCase() === norm) ||
    sc.alwaysPreparedSpellIds.some((s) => s.toLowerCase() === norm) ||
    sc.cantripIds.some((s) => s.toLowerCase() === norm) ||
    sc.spellbookSpellIds.some((s) => s.toLowerCase() === norm)
  );
}

function hasFeatureFragment(derived: DerivedCharacterSheet, fragment: string): boolean {
  const needle = fragment.toLowerCase();
  const inFeatures = derived.featureIds.some((f) => f.toLowerCase().includes(needle));
  if (inFeatures) return true;
  return derived.featIds.some((f) => f.toLowerCase().includes(needle));
}

/**
 * Lists the reactions owned by a hero (Opportunity Attack is universal;
 * Shield/Counterspell gate on spell access; Protection on the fighting
 * style; Uncanny Dodge on rogue 5+ or the feature id).
 */
export function listOwnedReactions(
  hero: CharacterBuildState,
  derived: DerivedCharacterSheet,
): OwnedReactionEntry[] {
  void hero;
  const entries: OwnedReactionEntry[] = [
    {
      key: 'opportunity_attack',
      label: 'Opportunity Attack',
      description: 'Make 1 melee weapon attack when a hostile leaves your reach.',
      slotTag: '—',
      icon: '⚔️',
    },
  ];

  if (hasSpellId(derived, 'shield')) {
    entries.push({
      key: 'shield',
      label: 'Shield',
      description: 'Cast Shield (+5 AC) as a reaction when an attack hits you.',
      slotTag: 'I+',
      icon: '🛡️',
    });
  }

  if (hasSpellId(derived, 'counterspell')) {
    entries.push({
      key: 'counterspell',
      label: 'Counterspell',
      description: 'Interrupt a hostile spell within 60 ft (3rd-level slot or higher).',
      slotTag: 'III+',
      icon: '🌀',
    });
  }

  if (
    hasFeatureFragment(derived, 'protection') ||
    hasFeatureFragment(derived, 'fighting_style_protection')
  ) {
    entries.push({
      key: 'protection',
      label: 'Protection Fighting Style',
      description: 'Impose Disadvantage on an attack vs an ally within 5 ft (shield required).',
      slotTag: '—',
      icon: '🛡️',
    });
  }

  const rogueLevel = derived.classes.find((c) => c.classId === 'rogue')?.level ?? 0;
  if (rogueLevel >= 5 || hasFeatureFragment(derived, 'uncanny_dodge')) {
    entries.push({
      key: 'uncanny_dodge',
      label: 'Uncanny Dodge',
      description: 'Halve the damage of an attack that hits you (must see the attacker).',
      slotTag: '—',
      icon: '💨',
    });
  }

  return entries;
}
