import { describe, expect, it } from 'vitest';
import {
  BUNDLED_SRD_DATASET,
  EffectStepSpecSchema,
  FORMULA_VARIABLES,
  SpellEffectStepOverrideSchema,
  SummonControlModeSchema,
  SummonStatblockSpecSchema,
  SummonTriggerSchema,
  validateFormulaSyntax,
  validateSrdDataset,
  type EffectStepSpec,
  type SrdIngestionInput,
  type SummonStatblockSpec,
} from '../index.js';

/** Arcane Hand-style harmable statblock: AC 20, HP = caster max HP, STR 26. */
const harmableStatblock: SummonStatblockSpec = {
  size: 'large',
  armorClass: 20,
  hitPointsFormula: '@casterMaxHp',
  speedFeet: 60,
  abilities: { str: 26, dex: 10 },
  actions: [
    {
      id: 'clenched-fist',
      name: 'Clenched Fist',
      description: 'The hand strikes one creature within 5 ft.',
      actionCost: 'action',
      targeting: { type: 'single', rangeFeet: 5 },
      effects: [
        {
          step: 'attack_roll',
          attackType: 'melee_spell',
          onHit: [{ step: 'deal_damage', diceFormula: '4d6', damageType: 'force' }],
        },
      ],
    },
  ],
};

/** Guardian of Faith-style untargetable statblock with an aura trigger and damage cap. */
const untargetableStatblock: SummonStatblockSpec = {
  size: 'large',
  untargetable: true,
  speedFeet: 0,
  triggers: [
    { kind: 'hostile_enter_radius', radiusFeet: 10, perTurnLimit: 1 },
  ],
  damageCap: 60,
};

function summonStep(overrides: Partial<Extract<EffectStepSpec, { step: 'summon_creature' }>> = {}): Extract<EffectStepSpec, { step: 'summon_creature' }> {
  return {
    step: 'summon_creature',
    summonId: 'arcane-hand-token',
    name: 'Arcane Hand',
    durationRounds: 10,
    requiresConcentration: true,
    placement: 'unoccupied_within_range',
    statblock: harmableStatblock,
    control: 'commanded',
    ...overrides,
  };
}

describe('SRD-901: summon_creature Effect DSL step', () => {
  describe('@casterMaxHp formula variable', () => {
    it('is a canonical formula variable accepted by the syntax checker', () => {
      expect(FORMULA_VARIABLES).toContain('@casterMaxHp');
      expect(validateFormulaSyntax('@casterMaxHp')).toEqual({ valid: true });
      expect(validateFormulaSyntax('@casterMaxHp + 1d4')).toEqual({ valid: true });
      expect(validateFormulaSyntax('max(@casterMaxHp, 10)')).toEqual({ valid: true });
    });

    it('still rejects unknown variables', () => {
      expect(validateFormulaSyntax('@casterHp').valid).toBe(false);
    });
  });

  describe('SummonControlModeSchema', () => {
    it('accepts commanded and autonomous modes only', () => {
      expect(SummonControlModeSchema.parse('commanded')).toBe('commanded');
      expect(SummonControlModeSchema.parse('autonomous')).toBe('autonomous');
      expect(SummonControlModeSchema.safeParse('scripted').success).toBe(false);
    });
  });

  describe('SummonTriggerSchema', () => {
    it('parses all three SRD 5.1 trigger kinds', () => {
      expect(
        SummonTriggerSchema.parse({
          kind: 'start_of_caster_turn_attack',
          rangeFeet: 5,
        }),
      ).toEqual({ kind: 'start_of_caster_turn_attack', rangeFeet: 5 });
      expect(
        SummonTriggerSchema.parse({
          kind: 'hostile_enter_radius',
          radiusFeet: 10,
          perTurnLimit: 1,
        }),
      ).toEqual({ kind: 'hostile_enter_radius', radiusFeet: 10, perTurnLimit: 1 });
      expect(
        SummonTriggerSchema.parse({ kind: 'leash', maxDistanceFeet: 100 }),
      ).toEqual({ kind: 'leash', maxDistanceFeet: 100 });
    });

    it('rejects non-positive radii/distances and invalid per-turn limits', () => {
      expect(
        SummonTriggerSchema.safeParse({
          kind: 'hostile_enter_radius',
          radiusFeet: 0,
          perTurnLimit: 1,
        }).success,
      ).toBe(false);
      expect(
        SummonTriggerSchema.safeParse({
          kind: 'start_of_caster_turn_attack',
          rangeFeet: -5,
        }).success,
      ).toBe(false);
      expect(
        SummonTriggerSchema.safeParse({
          kind: 'leash',
          maxDistanceFeet: 100.5,
        }).success,
      ).toBe(false);
      expect(
        SummonTriggerSchema.safeParse({
          kind: 'hostile_enter_radius',
          radiusFeet: 10,
          perTurnLimit: 2,
        }).success,
      ).toBe(false);
    });
  });

  describe('SummonStatblockSpecSchema', () => {
    it('parses a harmable statblock with AC, @casterMaxHp HP, abilities, and actions', () => {
      const parsed = SummonStatblockSpecSchema.parse(harmableStatblock);
      expect(parsed.size).toBe('large');
      expect(parsed.armorClass).toBe(20);
      expect(parsed.hitPointsFormula).toBe('@casterMaxHp');
      expect(parsed.abilities).toEqual({ str: 26, dex: 10 });
      expect(parsed.actions).toHaveLength(1);
      expect(parsed.actions?.[0]?.effects[0]).toMatchObject({
        step: 'attack_roll',
        attackType: 'melee_spell',
      });
    });

    it('parses an untargetable statblock with a damage cap and no AC/HP', () => {
      const parsed = SummonStatblockSpecSchema.parse(untargetableStatblock);
      expect(parsed.untargetable).toBe(true);
      expect(parsed.armorClass).toBeUndefined();
      expect(parsed.hitPointsFormula).toBeUndefined();
      expect(parsed.damageCap).toBe(60);
      expect(parsed.triggers).toEqual([
        { kind: 'hostile_enter_radius', radiusFeet: 10, perTurnLimit: 1 },
      ]);
    });

    it('rejects malformed statblocks', () => {
      expect(
        SummonStatblockSpecSchema.safeParse({ speedFeet: 30 }).success,
      ).toBe(false); // missing size
      expect(
        SummonStatblockSpecSchema.safeParse({ size: 'medium' }).success,
      ).toBe(false); // missing speedFeet
      expect(
        SummonStatblockSpecSchema.safeParse({
          size: 'medium',
          speedFeet: 30,
          armorClass: 0,
        }).success,
      ).toBe(false);
      expect(
        SummonStatblockSpecSchema.safeParse({
          size: 'medium',
          speedFeet: 30,
          damageCap: 0,
        }).success,
      ).toBe(false);
      expect(
        SummonStatblockSpecSchema.safeParse({
          size: 'medium',
          speedFeet: 30,
          abilities: { luck: 26 },
        }).success,
      ).toBe(false);
    });
  });

  describe('EffectStepSpecSchema summmon_creature variant', () => {
    it('parses a complete summon_creature step', () => {
      const step = summonStep();
      const parsed = EffectStepSpecSchema.parse(step);
      expect(parsed).toEqual(step);
      expect(EffectStepSpecSchema.safeParse(step).success).toBe(true);
    });

    it('rejects invalid placement, control mode, and missing required fields', () => {
      expect(
        EffectStepSpecSchema.safeParse(
          summonStep({ placement: 'adjacent' as never }),
        ).success,
      ).toBe(false);
      expect(
        EffectStepSpecSchema.safeParse(summonStep({ control: 'scripted' as never })).success,
      ).toBe(false);
      expect(
        EffectStepSpecSchema.safeParse(summonStep({ durationRounds: 0 })).success,
      ).toBe(false);
      const { name: _name, ...withoutName } = summonStep();
      expect(EffectStepSpecSchema.safeParse(withoutName).success).toBe(false);
    });

    it('is allowed in a SpellEffectStepOverride step enum', () => {
      expect(
        SpellEffectStepOverrideSchema.safeParse({ step: 'summon_creature' }).success,
      ).toBe(true);
    });
  });

  describe('Dataset validation integration', () => {
    function withSummonSpell(hitPointsFormula: string): SrdIngestionInput {
      const dataset = structuredClone(BUNDLED_SRD_DATASET);
      dataset.spells.push({
        id: 'srd901-test-summon',
        name: 'Test Summon',
        level: 4,
        school: 'conjuration',
        castingTime: 'action',
        ritual: false,
        concentration: true,
        duration: { type: 'rounds', rounds: 10 },
        components: { verbal: true, somatic: true, material: false },
        classes: ['wizard'],
        targeting: { type: 'self', rangeFeet: 0 },
        effects: [
          summonStep({
            summonId: 'srd901-test-token',
            statblock: { ...harmableStatblock, hitPointsFormula },
          }),
        ],
        description: 'A test summon spell used to verify SRD-901 schema wiring.',
      });
      return dataset;
    }

    it('accepts a summon spell whose HP formula uses @casterMaxHp', () => {
      const report = validateSrdDataset(withSummonSpell('@casterMaxHp'));
      expect(report.errors).toEqual([]);
      expect(report.valid).toBe(true);
    });

    it('reports a formula_syntax error for an unknown variable in a summon HP formula', () => {
      const report = validateSrdDataset(withSummonSpell('@casterHp'));
      const formulaErrors = report.errors.filter((e) => e.category === 'formula_syntax');
      expect(formulaErrors).toHaveLength(1);
      expect(formulaErrors[0]?.message).toContain('@casterHp');
    });
  });
});
