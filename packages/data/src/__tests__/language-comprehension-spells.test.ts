import { describe, expect, it } from 'vitest';
import {
  BUNDLED_SRD_DATASET,
  DEFAULT_SRD_OVERLAY_BUNDLE,
  type SpellData,
} from '../index.js';

function bundledSpell(id: string): SpellData {
  const spell = BUNDLED_SRD_DATASET.spells.find((s) => s.id === id);
  if (!spell) throw new Error(`Bundled spell "${id}" not found`);
  return spell;
}

describe('SRD-1201: comprehend-languages + tongues executable overlays (data authoring)', () => {
  it('resolves both spells in the compendium bundle', () => {
    expect(() => bundledSpell('comprehend-languages')).not.toThrow();
    expect(() => bundledSpell('tongues')).not.toThrow();
    expect(bundledSpell('comprehend-languages').name).toBe('Comprehend Languages');
    expect(bundledSpell('tongues').name).toBe('Tongues');
  });

  it('registers executable overlays for both spells', () => {
    const overlays = DEFAULT_SRD_OVERLAY_BUNDLE.spells ?? {};
    expect(overlays['comprehend-languages']).toBeDefined();
    expect(overlays['tongues']).toBeDefined();
    for (const id of ['comprehend-languages', 'tongues'] as const) {
      const spell = bundledSpell(id);
      expect(spell.effects.length).toBeGreaterThan(0);
      expect(spell.effects.some((e) => e.step === 'manual_adjudication')).toBe(false);
    }
  });

  it('authors SRD-faithful comprehend-languages metadata (L1 divination ritual, self, 1 hour)', () => {
    const spell = bundledSpell('comprehend-languages');
    expect(spell.level).toBe(1);
    expect(spell.school).toBe('divination');
    expect(spell.castingTime).toBe('action');
    expect(spell.ritual).toBe(true);
    expect(spell.concentration).toBe(false);
    expect(spell.duration).toEqual({ type: 'hours', amount: 1 });
    expect(spell.components).toMatchObject({
      verbal: true,
      somatic: true,
      material: true,
      materialDescription: 'a pinch of soot and salt',
    });
    expect(spell.classes).toEqual(expect.arrayContaining(['bard', 'sorcerer', 'warlock', 'wizard']));
    expect(spell.targeting).toMatchObject({ type: 'self', rangeFeet: 0 });
    expect(spell.effects).toHaveLength(1);
    expect(spell.effects[0]).toMatchObject({
      step: 'apply_active_effect',
      effectId: 'comprehend-languages-understanding',
      name: 'Comprehend Languages',
      durationRounds: 600,
      requiresConcentration: false,
      modifiers: [],
    });
  });

  it('authors SRD-faithful tongues metadata (L3 divination, touch willing, 1 hour)', () => {
    const spell = bundledSpell('tongues');
    expect(spell.level).toBe(3);
    expect(spell.school).toBe('divination');
    expect(spell.castingTime).toBe('action');
    expect(spell.ritual).toBe(false);
    expect(spell.concentration).toBe(false);
    expect(spell.duration).toEqual({ type: 'hours', amount: 1 });
    expect(spell.components).toMatchObject({
      verbal: true,
      somatic: false,
      material: true,
      materialDescription: 'a small clay model of a ziggurat',
    });
    expect(spell.classes).toEqual(
      expect.arrayContaining(['bard', 'cleric', 'sorcerer', 'warlock', 'wizard']),
    );
    expect(spell.targeting).toMatchObject({ type: 'touch', rangeFeet: 5, targetFilter: 'willing' });
    expect(spell.effects).toHaveLength(1);
    expect(spell.effects[0]).toMatchObject({
      step: 'apply_active_effect',
      effectId: 'tongues-understanding',
      name: 'Tongues',
      durationRounds: 600,
      requiresConcentration: false,
      modifiers: [],
    });
  });

  it('keeps the bundled spell list alphabetically sorted with no duplicate ids', () => {
    const ids = BUNDLED_SRD_DATASET.spells.map((s) => s.id);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
