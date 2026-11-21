import { describe, expect, it } from 'vitest';
import {
  BUNDLED_SRD_DATASET,
  defaultCompendium,
  validateRelevanceCoverage,
  validateSrdDataset,
  type SrdIngestionInput,
} from '../index.js';

describe('SRD-1304: revived + new magic items (data)', () => {
  it('bundled dataset passes the extended magic-item relevance gate', () => {
    expect(validateRelevanceCoverage(BUNDLED_SRD_DATASET)).toEqual([]);
    const report = validateSrdDataset(BUNDLED_SRD_DATASET);
    expect(report.errors.filter((e) => e.category === 'relevance')).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it('all four revived entries carry executable mechanics', () => {
    // Flame Tongue: bonus-action ignite -> ablaze buff (engine adds 2d6 fire).
    const flame = defaultCompendium.requireMagicItem('flame-tongue');
    const ignite = flame.activatedAbilities?.find((a) => a.id === 'ignite-flame-tongue');
    expect(ignite).toBeDefined();
    expect(ignite!.actionCost).toBe('bonus_action');
    expect(
      ignite!.effects.some(
        (e) => e.step === 'apply_active_effect' && e.effectId === 'flame-tongue-ablaze',
      ),
    ).toBe(true);

    // Periapt: passive wound-closure ability (engine auto-stabilizes + doubles HD).
    const periapt = defaultCompendium.requireMagicItem('periapt-of-wound-closure');
    expect((periapt.activatedAbilities?.length ?? 0)).toBeGreaterThan(0);

    // Bag of Holding: container capacity note + capacity resource pool.
    const bag = defaultCompendium.requireMagicItem('bag-of-holding');
    expect(bag.modifiers.length).toBeGreaterThan(0);
    expect(bag.modifiers.some((m) => m.type === 'grant_resource')).toBe(true);
    expect(bag.description).toMatch(/500 pounds/);

    // Scroll of Fireball: consumable cast with fixed Save DC 15.
    const scroll = defaultCompendium.requireMagicItem('scroll-of-fireball');
    const cast = scroll.activatedAbilities?.find((a) => a.id === 'cast-fireball-from-scroll');
    expect(cast).toBeDefined();
    const save = cast!.effects.find((e) => e.step === 'saving_throw');
    expect(save?.step).toBe('saving_throw');
    if (save?.step === 'saving_throw') {
      expect(save.dcFormula).toBe('15');
    } else {
      expect.unreachable('scroll saving_throw step missing');
    }
  });

  it('new SRD-only items exercise previously-unused DSL targets', () => {
    // Casting focus: spell_attack + spell_save_dc.
    const rod = defaultCompendium.requireMagicItem('rod-of-the-pact-keeper-plus-1');
    expect(
      rod.modifiers.some((m) => m.type === 'flat_bonus' && m.target === 'spell_attack' && m.value === 1),
    ).toBe(true);
    expect(
      rod.modifiers.some(
        (m) => m.type === 'flat_bonus' && m.target === 'spell_save_dc' && m.value === 1,
      ),
    ).toBe(true);

    // Resistance-granting item: damage_mitigation.
    const ring = defaultCompendium.requireMagicItem('ring-of-fire-resistance');
    expect(
      ring.modifiers.some(
        (m) =>
          m.type === 'damage_mitigation' &&
          m.mitigation === 'resistance' &&
          m.damageTypes.includes('fire'),
      ),
    ).toBe(true);

    // Extra-slot item: grant_resource.
    const pearl = defaultCompendium.requireMagicItem('pearl-of-power');
    expect(
      pearl.modifiers.some((m) => m.type === 'grant_resource' && m.resourceId === 'pearl-of-power'),
    ).toBe(true);
  });

  it('gate rejects a dead entry (empty modifiers + no activated abilities)', () => {
    const broken = structuredClone(BUNDLED_SRD_DATASET) as unknown as SrdIngestionInput;
    broken.magicItems = [
      ...broken.magicItems,
      {
        id: 'dead-item-xyz',
        name: 'Dead Item',
        category: 'wondrous' as const,
        rarity: 'common' as const,
        requiresAttunement: false,
        modifiers: [],
        description: 'An inert trinket with no mechanics.',
      },
    ];
    const errors = validateRelevanceCoverage(broken);
    expect(
      errors.some((e) => e.collection === 'magic-items' && e.message.includes('dead-item-xyz')),
    ).toBe(true);
    expect(validateSrdDataset(broken).valid).toBe(false);
  });
});
