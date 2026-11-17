import { describe, expect, it } from 'vitest';
import {
  BUNDLED_SRD_DATASET,
  DEFAULT_SRD_OVERLAY_BUNDLE,
  EffectStepSpecSchema,
  validateSrdDataset,
  type EffectStepSpec,
} from '../index.js';

type SummonStep = Extract<EffectStepSpec, { step: 'summon_creature' }>;

function overlaySummonStep(spellId: string): SummonStep {
  const overlay = DEFAULT_SRD_OVERLAY_BUNDLE.spells?.[spellId];
  const step = overlay?.effects?.find(
    (e): e is SummonStep => e.step === 'summon_creature',
  );
  if (!step) throw new Error(`Spell overlay "${spellId}" has no summon_creature step`);
  return step;
}

describe('SRD-905: executable summon overlays (data authoring)', () => {
  it.each(['faithful-hound', 'guardian-of-faith', 'arcane-hand', 'arcane-sword'])(
    '%s overlay is a single Zod-valid summon_creature step',
    (spellId) => {
      const overlay = DEFAULT_SRD_OVERLAY_BUNDLE.spells?.[spellId];
      expect(overlay?.effects).toHaveLength(1);
      expect(overlay?.effects?.some((e) => e.step === 'manual_adjudication')).toBe(false);
      expect(EffectStepSpecSchema.parse(overlay?.effects?.[0])).toEqual(overlay?.effects?.[0]);
    },
  );

  it('authors the four rules-accurate statblocks (including the Arcane Sword 3d10 correction)', () => {
    const hound = overlaySummonStep('faithful-hound');
    expect(hound.control).toBe('autonomous');
    expect(hound.statblock.untargetable).toBe(true);
    expect(hound.statblock.triggers).toEqual([
      { kind: 'start_of_caster_turn_attack', rangeFeet: 5 },
      { kind: 'leash', maxDistanceFeet: 100 },
    ]);
    expect(JSON.stringify(hound.statblock.actions)).toContain('4d8');

    const guardian = overlaySummonStep('guardian-of-faith');
    expect(guardian.control).toBe('autonomous');
    expect(guardian.statblock.damageCap).toBe(60);
    expect(guardian.statblock.triggers).toEqual([
      { kind: 'hostile_enter_radius', radiusFeet: 10, perTurnLimit: 1 },
    ]);

    const hand = overlaySummonStep('arcane-hand');
    expect(hand.control).toBe('commanded');
    expect(hand.requiresConcentration).toBe(true);
    expect(hand.statblock).toMatchObject({ armorClass: 20, hitPointsFormula: '@casterMaxHp' });
    expect(hand.statblock.abilities).toMatchObject({ str: 26 });
    expect(hand.statblock.actions?.map((a) => a.id)).toEqual([
      'clenched-fist',
      'forceful-hand',
      'grasping-hand',
      'interposing-hand',
    ]);

    const sword = overlaySummonStep('arcane-sword');
    expect(sword.control).toBe('commanded');
    expect(sword.statblock.untargetable).toBe(true);
    expect(sword.statblock.speedFeet).toBe(20);
    expect(JSON.stringify(sword.statblock)).toContain('3d10');
    expect(JSON.stringify(sword.statblock)).not.toContain('4d8');
  });

  it('keeps the bundled dataset valid with the new summon overlays applied', () => {
    const report = validateSrdDataset(BUNDLED_SRD_DATASET);
    expect(report.errors).toEqual([]);
    expect(report.valid).toBe(true);
  });
});
