import { describe, expect, it } from 'vitest';
import {
  compendium,
  DEFAULT_SRD_OVERLAY_BUNDLE,
  containsProductIdentityProperName,
  isSrd52OnlyIdentifier,
} from '@srd5/data';
import {
  createMonsterCombatant,
  executeSpellCast,
  scaleDiceFormula,
  canCombatantCastSpell,
  breakConcentration,
  type Combatant,
  type CombatState,
} from '../combat/index.js';

describe('SRD-1004: SRD 5.1 Spell Coverage Expansion & Verification', () => {
  function buildCombatState(combatantsList: Combatant[]): CombatState {
    const combatants: Record<string, Combatant> = {};
    for (const c of combatantsList) {
      combatants[c.id] = c;
    }
    return {
      encounterId: 'test-spell-coverage',
      round: 1,
      phase: 'active_turn',
      initiativeOrder: combatantsList.map((c) => ({
        entityId: c.id,
        initiative: 15,
        naturalRoll: 10,
        dexterityScore: c.dexterityScore,
        tieBreaker: c.dexterityScore,
      })),
      activeCombatantIndex: 0,
      activeCombatantId: combatantsList[0]?.id ?? null,
      turnBudget: {
        action: 1,
        bonusAction: 1,
        reactionAvailable: true,
        movementRemainingFeet: 30,
        freeObjectInteraction: 1,
        bonusActionSpellCast: false,
        leveledActionSpellCast: false,
        attackActionTaken: false,
        extraAttacksRemaining: 0,
        disengaged: false,
        dodging: false,
      },
      combatants,
      surprisedCombatantIds: [],
      outcome: 'in_progress',
      rngState: 42,
    };
  }

  function makeHighLevelCaster(id: string): Combatant {
    const caster = createMonsterCombatant(
      compendium.requireMonster('archmage'),
      id,
      { x: 0, y: 0 },
      { side: 'party' },
    );
    const slots: Record<string, { max: number; expended: number; available: number }> = {};
    for (let lvl = 1; lvl <= 9; lvl++) {
      slots[String(lvl)] = { max: 4, expended: 0, available: 4 };
    }
    caster.spellSlots = slots;
    caster.characterSheet = {
      totalLevel: 20,
      classes: [{ classId: 'wizard', level: 20 }],
      proficiencyBonus: 6,
      savingThrows: {},
      abilities: {
        str: { modifier: 0 },
        dex: { modifier: 2 },
        con: { modifier: 2 },
        int: { modifier: 5 },
        wis: { modifier: 3 },
        cha: { modifier: 1 },
      },
      spellcasting: {
        isSpellcaster: true,
        effectiveCasterLevel: 20,
        classes: [],
        primaryAbility: 'int',
        primarySpellSaveDc: 19,
        primarySpellAttackBonus: 11,
        spellSlots: slots,
        cantripIds: [],
        preparedOrKnownSpellIds: [],
        alwaysPreparedSpellIds: [],
        spellbookSpellIds: [],
      },
      resources: {},
    } as any;
    return caster;
  }

  function makeTarget(id: string, overrides: Partial<Combatant> = {}): Combatant {
    const target = createMonsterCombatant(
      compendium.requireMonster('gladiator'),
      id,
      { x: 1, y: 0 }, // 5 ft adjacent by default
      { side: 'monster' },
    );
    target.currentHp = 100;
    target.maxHp = 100;
    return { ...target, ...overrides };
  }

  describe('1. Dataset Audit & Legal Invariants', () => {
    it('meets or exceeds the expanded spell count across all levels (L0–L9)', () => {
      const spells = compendium.spells;
      expect(spells.length).toBeGreaterThanOrEqual(171);

      const byLevel: Record<number, number> = {};
      for (const s of spells) {
        byLevel[s.level] = (byLevel[s.level] ?? 0) + 1;
      }

      // Verify healthy coverage across every level from 0 to 9
      expect(byLevel[0]).toBeGreaterThanOrEqual(23);
      expect(byLevel[1]).toBeGreaterThanOrEqual(30);
      expect(byLevel[2]).toBeGreaterThanOrEqual(22);
      expect(byLevel[3]).toBeGreaterThanOrEqual(18);
      expect(byLevel[4]).toBeGreaterThanOrEqual(18);
      expect(byLevel[5]).toBeGreaterThanOrEqual(16);
      expect(byLevel[6]).toBeGreaterThanOrEqual(13);
      expect(byLevel[7]).toBeGreaterThanOrEqual(12);
      expect(byLevel[8]).toBeGreaterThanOrEqual(9);
      expect(byLevel[9]).toBeGreaterThanOrEqual(10);
    });

    it('ensures every single spell in the compendium has executable effects and an overlay', () => {
      const overlayMap = DEFAULT_SRD_OVERLAY_BUNDLE.spells ?? {};
      for (const spell of compendium.spells) {
        expect(spell.effects.length).toBeGreaterThan(0);
        expect(overlayMap[spell.id]).toBeDefined();
      }
    });

    it('asserts zero Product Identity proper names or SRD 5.2-only identifiers in spells', () => {
      for (const spell of compendium.spells) {
        expect(containsProductIdentityProperName(spell.id)).toBe(false);
        expect(containsProductIdentityProperName(spell.name)).toBe(false);
        expect(isSrd52OnlyIdentifier(spell.id)).toBe(false);
        expect(isSrd52OnlyIdentifier(spell.name)).toBe(false);
      }
    });

    it('verifies all 8 schools of magic have robust coverage', () => {
      const schools = new Set(compendium.spells.map((s) => s.school));
      expect(schools).toEqual(
        new Set([
          'abjuration',
          'conjuration',
          'divination',
          'enchantment',
          'evocation',
          'illusion',
          'necromancy',
          'transmutation',
        ]),
      );
    });
  });

  describe('2. Spell Slot Spending & Bonus Action Rule', () => {
    it('expends the correct spell slot when cast', () => {
      const caster = makeHighLevelCaster('caster-1');
      const target = makeTarget('target-1');
      const state = buildCombatState([caster, target]);

      const spell = compendium.requireSpell('sunburst');
      const res = executeSpellCast({
        state,
        casterId: caster.id,
        spell,
        targetIds: [target.id],
      });

      const updatedCaster = res.state.combatants[caster.id]!;
      expect(updatedCaster.spellSlots?.['8']?.expended).toBe(1);
      expect(updatedCaster.spellSlots?.['8']?.available).toBe(3);
    });

    it('enforces the bonus-action spellcasting rule for divine-word', () => {
      const caster = makeHighLevelCaster('caster-1');
      const target = makeTarget('target-1');
      const state = buildCombatState([caster, target]);

      const divineWord = compendium.requireSpell('divine-word');
      expect(divineWord.castingTime).toBe('bonus_action');

      const res = executeSpellCast({
        state,
        casterId: caster.id,
        spell: divineWord,
        targetIds: [target.id],
      });

      expect(res.state.turnBudget?.bonusActionSpellCast).toBe(true);

      // Subsequent 1-action leveled spell must be disallowed on the same turn
      const harm = compendium.requireSpell('harm');
      const check = canCombatantCastSpell({
        state: res.state,
        casterId: caster.id,
        spell: harm,
      });
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('cantrip');
    });
  });

  describe('3. Upcast Scaling (bonusDicePerSlotAboveBase)', () => {
    it('scales wall-of-ice by +2d6 per slot above 6th level', () => {
      const spell = compendium.requireSpell('wall-of-ice');
      const step = spell.effects[0];
      const baseFormula = step && step.step === 'saving_throw' ? (step.onFail?.[0] as any)?.diceFormula ?? '' : '';
      expect(baseFormula).toBe('10d6');

      const scaled8th = scaleDiceFormula(baseFormula, '2d6', 2);
      expect(scaled8th).toBe('14d6');
    });

    it('scales delayed-blast-fireball by +1d6 per slot above 7th level', () => {
      const spell = compendium.requireSpell('delayed-blast-fireball');
      const step = spell.effects[0];
      const baseFormula = step && step.step === 'saving_throw' ? (step.onFail?.[0] as any)?.diceFormula ?? '' : '';
      expect(baseFormula).toBe('12d6');

      const scaled9th = scaleDiceFormula(baseFormula, '1d6', 2);
      expect(scaled9th).toBe('14d6');
    });

    it('scales insect-plague by +1d10 per slot above 5th level', () => {
      const spell = compendium.requireSpell('insect-plague');
      const step = spell.effects[0];
      const baseFormula = step && step.step === 'saving_throw' ? (step.onFail?.[0] as any)?.diceFormula ?? '' : '';
      expect(baseFormula).toBe('4d10');

      const scaled7th = scaleDiceFormula(baseFormula, '1d10', 2);
      expect(scaled7th).toBe('6d10');
    });
  });

  describe('4. Saving Throws, Conditions, and Damage Execution', () => {
    it('executes sunburst dealing radiant damage and applying blinded condition on failed save', () => {
      const caster = makeHighLevelCaster('caster-1');
      const target = makeTarget('target-1');
      caster.characterSheet!.spellcasting.primarySpellSaveDc = 30;
      const state = buildCombatState([caster, target]);

      const sunburst = compendium.requireSpell('sunburst');
      const res = executeSpellCast({
        state,
        casterId: caster.id,
        spell: sunburst,
        targetIds: [target.id],
      });

      expect(res.targetsFailedSave).toContain(target.id);
      expect(res.totalDamageByTarget[target.id]).toBeGreaterThan(0);
      const updatedTarget = res.state.combatants[target.id]!;
      expect(updatedTarget.conditions.includes('blinded')).toBe(true);
    });

    it('executes harm dealing necrotic damage with half damage on successful save', () => {
      const caster = makeHighLevelCaster('caster-1');
      const target = makeTarget('target-1');
      caster.characterSheet!.spellcasting.primarySpellSaveDc = 1;
      const state = buildCombatState([caster, target]);

      const harm = compendium.requireSpell('harm');
      const res = executeSpellCast({
        state,
        casterId: caster.id,
        spell: harm,
        targetIds: [target.id],
      });

      expect(res.targetsSaved).toContain(target.id);
      expect(res.totalDamageByTarget[target.id]).toBeGreaterThan(0);
    });

    it('executes earthquake dealing bludgeoning damage and applying prone condition', () => {
      const caster = makeHighLevelCaster('caster-1');
      const target = makeTarget('target-1');
      caster.characterSheet!.spellcasting.primarySpellSaveDc = 30;
      const state = buildCombatState([caster, target]);

      const earthquake = compendium.requireSpell('earthquake');
      const res = executeSpellCast({
        state,
        casterId: caster.id,
        spell: earthquake,
        targetIds: [target.id],
      });

      expect(res.targetsFailedSave).toContain(target.id);
      expect(res.totalDamageByTarget[target.id]).toBe(50);
      const updatedTarget = res.state.combatants[target.id]!;
      expect(updatedTarget.conditions.includes('prone')).toBe(true);
    });

    it('executes flesh-to-stone applying restrained and petrified conditions on failed save', () => {
      const caster = makeHighLevelCaster('caster-1');
      const target = makeTarget('target-1');
      caster.characterSheet!.spellcasting.primarySpellSaveDc = 30;
      const state = buildCombatState([caster, target]);

      const spell = compendium.requireSpell('flesh-to-stone');
      const res = executeSpellCast({
        state,
        casterId: caster.id,
        spell,
        targetIds: [target.id],
      });

      expect(res.targetsFailedSave).toContain(target.id);
      const updatedTarget = res.state.combatants[target.id]!;
      expect(updatedTarget.conditions.includes('restrained')).toBe(true);
      expect(updatedTarget.conditions.includes('petrified')).toBe(true);
    });
  });

  describe('5. Concentration Tracking & Break Resolution', () => {
    it('initiates concentration on holy-aura and breaks on concentration break', () => {
      const caster = makeHighLevelCaster('caster-1');
      const state = buildCombatState([caster]);

      const holyAura = compendium.requireSpell('holy-aura');
      const res = executeSpellCast({
        state,
        casterId: caster.id,
        spell: holyAura,
      });

      const updatedCaster = res.state.combatants[caster.id]!;
      expect(updatedCaster.concentratingOn?.sourceId).toBe('holy-aura');
      expect(updatedCaster.activeEffects?.some((e) => e.effectId === 'holy-aura-ward')).toBe(true);

      // Break concentration via breakConcentration
      const breakRes = breakConcentration(res.state, caster.id, 'damaged');
      const afterBreakCaster = breakRes.state.combatants[caster.id]!;
      expect(afterBreakCaster.concentratingOn).toBeUndefined();
    });

    it('initiates concentration on sunbeam', () => {
      const caster = makeHighLevelCaster('caster-1');
      const target = makeTarget('target-1');
      const state = buildCombatState([caster, target]);

      const sunbeam = compendium.requireSpell('sunbeam');
      const res = executeSpellCast({
        state,
        casterId: caster.id,
        spell: sunbeam,
        targetIds: [target.id],
      });

      const updatedCaster = res.state.combatants[caster.id]!;
      expect(updatedCaster.concentratingOn?.sourceId).toBe('sunbeam');
    });
  });

  describe('6. Hazard Zones, Healing, and Active Buffs', () => {
    it('creates a heavy obscurement hazard zone for fog-cloud', () => {
      const caster = makeHighLevelCaster('caster-1');
      const state = buildCombatState([caster]);

      const fogCloud = compendium.requireSpell('fog-cloud');
      const res = executeSpellCast({
        state,
        casterId: caster.id,
        spell: fogCloud,
      });

      const hazardEvent = res.events.find((e) => e.type === 'HAZARD_ZONE_CREATED');
      expect(hazardEvent).toBeDefined();
      expect(Object.values(res.state.hazardZones ?? {}).some((z) => z.zoneId === 'fog-cloud-zone')).toBe(true);
    });

    it('heals 700 hit points with mass-heal', () => {
      const caster = makeHighLevelCaster('caster-1');
      const injuredAlly = makeTarget('ally-1', {
        side: 'party',
        currentHp: 10,
        maxHp: 1000,
      });
      const state = buildCombatState([caster, injuredAlly]);

      const massHeal = compendium.requireSpell('mass-heal');
      const res = executeSpellCast({
        state,
        casterId: caster.id,
        spell: massHeal,
        targetIds: [injuredAlly.id],
      });

      expect(res.totalHealingByTarget[injuredAlly.id]).toBe(700);
      const healedAlly = res.state.combatants[injuredAlly.id]!;
      expect(healedAlly.currentHp).toBe(710);
    });

    it('applies heroes-feast granting temp HP and immunity modifiers', () => {
      const caster = makeHighLevelCaster('caster-1');
      const ally = makeTarget('ally-1', { side: 'party' });
      const state = buildCombatState([caster, ally]);

      const heroesFeast = compendium.requireSpell('heroes-feast');
      const res = executeSpellCast({
        state,
        casterId: caster.id,
        spell: heroesFeast,
        targetIds: [ally.id],
      });

      const buffedAlly = res.state.combatants[ally.id]!;
      expect(buffedAlly.tempHp).toBeGreaterThan(0);
      const buff = buffedAlly.activeEffects?.find((e) => e.effectId === 'heroes-feast-buff');
      expect(buff).toBeDefined();
      expect(buff?.modifiers.some((m) => m.type === 'condition_immunity')).toBe(true);
    });

    it('applies protection-from-energy granting damage resistance', () => {
      const caster = makeHighLevelCaster('caster-1');
      const ally = makeTarget('ally-1', { side: 'party' });
      const state = buildCombatState([caster, ally]);

      const spell = compendium.requireSpell('protection-from-energy');
      const res = executeSpellCast({
        state,
        casterId: caster.id,
        spell,
        targetIds: [ally.id],
      });

      const buffedAlly = res.state.combatants[ally.id]!;
      const buff = buffedAlly.activeEffects?.find((e) => e.effectId === 'protection-from-energy-buff');
      expect(buff).toBeDefined();
      expect(buff?.modifiers[0]?.type).toBe('damage_mitigation');
    });

    it('resolves manual adjudication spells gracefully without errors', () => {
      const caster = makeHighLevelCaster('caster-1');
      const target = makeTarget('target-1', { side: 'party' });
      const state = buildCombatState([caster, target]);

      for (const spellId of ['gate', 'blink', 'resurrection', 'teleport']) {
        const spell = compendium.requireSpell(spellId);
        const res = executeSpellCast({
          state,
          casterId: caster.id,
          spell,
          targetIds: [target.id],
        });
        expect(res.state).toBeDefined();
        expect(res.events.some((e) => e.type === 'SPELL_CAST')).toBe(true);
      }
    });
  });
});
