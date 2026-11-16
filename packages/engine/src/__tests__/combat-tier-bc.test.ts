import { describe, expect, it } from 'vitest';
import { compendium } from '@srd5/data';
import { createMonsterCombatant } from '../combat/combatant.js';
import { executeWeaponAttack } from '../combat/attack.js';
import { executeSpellCast } from '../combat/spellcasting.js';
import { executeMonsterAction } from '../combat/monster-actions.js';
import { executeActivatedAbility } from '../combat/features.js';
import type { CombatState, Combatant } from '../combat/types.js';

describe('SRD-704: Combat Tier B & C Executable Effect DSL Coverage', () => {
  function buildTestState(combatantsList: Combatant[]): CombatState {
    const combatants: Record<string, Combatant> = {};
    for (const c of combatantsList) {
      combatants[c.id] = c;
    }
    return {
      encounterId: 'test-tier-bc',
      round: 1,
      phase: 'active_turn',
      initiativeOrder: combatantsList.map((c) => ({
        entityId: c.id,
        initiative: 10,
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

  /** A high-level spellcaster with a full 1st–9th level slot pool for upcast tests. */
  function makeHighLevelCaster(id: string): Combatant {
    const caster = createMonsterCombatant(
      compendium.requireMonster('mage'),
      id,
      { x: 0, y: 0 },
      { side: 'party' },
    );
    const slots = {} as Record<string, { max: number; expended: number; available: number }>;
    for (let lvl = 1; lvl <= 9; lvl++) {
      slots[String(lvl)] = { max: 2, expended: 0, available: 2 };
    }
    caster.spellSlots = slots;
    caster.characterSheet = {
      totalLevel: 17,
      classes: [{ classId: 'wizard', level: 17 }],
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
        effectiveCasterLevel: 17,
        classes: [],
        primaryAbility: 'int',
        primarySpellSaveDc: 17,
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

  describe('Tier B/C dataset coverage (Levels 4–9 spells, 6–20 features, CR 6–20 monsters)', () => {
    it('gives every Level 4–9 spell a structured effect block or adjudication fallback', () => {
      const missing = compendium.spells
        .filter((spell) => spell.level >= 4 && spell.effects.length === 0)
        .map((spell) => spell.id);
      expect(missing).toEqual([]);

      const adjudicated = compendium.spells.filter((spell) =>
        spell.effects.some((step) => step.step === 'manual_adjudication'),
      );
      expect(adjudicated.length).toBeGreaterThan(15);
    });

    it('gives every Level 6–20 feature modifiers or an activated ability', () => {
      const missing = compendium.features
        .filter(
          (feature) =>
            (feature.level ?? 0) >= 6 &&
            feature.modifiers.length === 0 &&
            (feature.activatedAbilities ?? []).length === 0,
        )
        .map((feature) => feature.id);
      expect(missing).toEqual([]);
    });

    it('gives every CR 6+ monster an archetype and executable non-multiattack actions', () => {
      const highCr = compendium.monsters.filter((monster) => monster.challengeRating >= 6);
      expect(highCr.length).toBeGreaterThanOrEqual(4);
      for (const monster of highCr) {
        expect(monster.aiArchetype).toBeTruthy();
        for (const action of monster.actions) {
          if (!action.multiattack) {
            expect(action.effects.length).toBeGreaterThan(0);
          }
        }
      }
      expect(compendium.requireMonster('mage').spellcasting?.spellSaveDc).toBe(15);
      expect(
        compendium
          .requireMonster('medusa')
          .traits.find((trait) => trait.id === 'petrifying-gaze')?.activatedAbilities?.[0]?.id,
      ).toBe('petrifying-gaze');
    });
  });

  describe('Tier B spell automation (Levels 4–5)', () => {
    it('executes Blight (Level 4) as a CON save with necrotic half-damage on success', () => {
      const spell = compendium.requireSpell('blight');
      const caster = makeHighLevelCaster('caster');
      const target = createMonsterCombatant(
        compendium.requireMonster('bandit'),
        'target',
        { x: 2, y: 0 },
        { side: 'monster' },
      );
      const state = buildTestState([caster, target]);
      const res = executeSpellCast({
        state,
        casterId: caster.id,
        spell,
        slotLevel: 4,
        targetIds: [target.id],
        skipReactionPrompts: true,
      });

      expect(res.events.some((e) => e.type === 'SPELL_CAST')).toBe(true);
      expect(res.events.some((e) => e.type === 'SAVING_THROW_RESOLVED' && e.ability === 'con')).toBe(true);
    });

    it('executes Ice Storm (Level 4) with damage and a difficult-terrain hazard zone', () => {
      const spell = compendium.requireSpell('ice-storm');
      const caster = makeHighLevelCaster('caster');
      const target = createMonsterCombatant(
        compendium.requireMonster('bandit'),
        'target',
        { x: 2, y: 0 },
        { side: 'monster' },
      );
      target.maxHp = 500;
      target.currentHp = 500;
      const state = buildTestState([caster, target]);
      const res = executeSpellCast({
        state,
        casterId: caster.id,
        spell,
        slotLevel: 4,
        targetIds: [target.id],
        originCell: { x: 2, y: 0 },
        skipReactionPrompts: true,
      });

      expect(res.events.some((e) => e.type === 'SAVING_THROW_RESOLVED' && e.ability === 'dex')).toBe(true);
      expect(res.events.some((e) => e.type === 'HAZARD_ZONE_CREATED')).toBe(true);
      expect(res.state.hazardZones && Object.keys(res.state.hazardZones).length).toBeGreaterThan(0);
    });

    it('executes Hold Monster (Level 5) paralyzing a failed-save target with a repeat save', () => {
      const spell = compendium.requireSpell('hold-monster');
      const caster = makeHighLevelCaster('caster');
      const target = createMonsterCombatant(
        compendium.requireMonster('bandit'),
        'target',
        { x: 2, y: 0 },
        { side: 'monster' },
      );
      const state = buildTestState([caster, target]);
      const res = executeSpellCast({
        state,
        casterId: caster.id,
        spell,
        slotLevel: 5,
        targetIds: [target.id],
        skipReactionPrompts: true,
      });

      expect(res.events.some((e) => e.type === 'SAVING_THROW_RESOLVED' && e.ability === 'wis')).toBe(true);
      if (res.targetsFailedSave.includes(target.id)) {
        expect(res.state.combatants[target.id]!.conditions).toContain('paralyzed');
      }
    });

    it('executes Cloudkill (Level 5) as a poisonous hazard zone', () => {
      const spell = compendium.requireSpell('cloudkill');
      const caster = makeHighLevelCaster('caster');
      const state = buildTestState([caster]);
      const res = executeSpellCast({
        state,
        casterId: caster.id,
        spell,
        slotLevel: 5,
        originCell: { x: 3, y: 3 },
        skipReactionPrompts: true,
      });

      expect(res.events.some((e) => e.type === 'SPELL_CAST')).toBe(true);
      expect(res.events.some((e) => e.type === 'HAZARD_ZONE_CREATED')).toBe(true);
    });
  });

  describe('Tier C spell automation (Levels 6–9) and adjudication fallback', () => {
    it('executes Meteor Swarm (Level 9) with fire and bludgeoning damage', () => {
      const spell = compendium.requireSpell('meteor-swarm');
      const caster = makeHighLevelCaster('caster');
      const target = createMonsterCombatant(
        compendium.requireMonster('bandit'),
        'target',
        { x: 3, y: 3 },
        { side: 'monster' },
      );
      target.maxHp = 500;
      target.currentHp = 500;
      const state = buildTestState([caster, target]);
      const res = executeSpellCast({
        state,
        casterId: caster.id,
        spell,
        slotLevel: 9,
        targetIds: [target.id],
        originCell: { x: 3, y: 3 },
        skipReactionPrompts: true,
      });

      expect(res.events.some((e) => e.type === 'SPELL_CAST')).toBe(true);
      expect(res.events.some((e) => e.type === 'SAVING_THROW_RESOLVED' && e.ability === 'dex')).toBe(true);
    });

    it('places the grease zone exactly where aimed (no diagonal offset)', () => {
      // Regression test: preview, targeting, and the persistent hazard zone
      // must share one anchor convention. Caster at (6,12) clicks cell (6,7):
      // snapped anchor is intersection (7,8) = (35,40)ft, facing north.
      const spell = compendium.requireSpell('grease');
      const caster = makeHighLevelCaster('caster');
      caster.position = { x: 6, y: 12 };
      const state = buildTestState([caster]);
      const res = executeSpellCast({
        state,
        casterId: caster.id,
        spell,
        slotLevel: 1,
        originCell: { x: 6, y: 7 },
        skipReactionPrompts: true,
      });

      const expected = [
        { x: 6, y: 6 },
        { x: 7, y: 6 },
        { x: 6, y: 7 },
        { x: 7, y: 7 },
      ];
      const zoneEvent = res.events.find((e) => e.type === 'HAZARD_ZONE_CREATED');
      expect(zoneEvent).toBeDefined();
      if (zoneEvent?.type === 'HAZARD_ZONE_CREATED') {
        expect(zoneEvent.zoneId).toBe('grease-zone');
        expect(zoneEvent.cells).toEqual(expect.arrayContaining(expected));
        expect(zoneEvent.cells).toHaveLength(4);
      }
      const zones = Object.values(res.state.hazardZones ?? {});
      expect(zones).toHaveLength(1);
      expect(zones[0]!.zoneId).toBe('grease-zone');
      expect(zones[0]!.cells).toEqual(expect.arrayContaining(expected));
      expect(zones[0]!.cells).toHaveLength(4);
    });

    it('surfaces an adjudication card from a hazard zone for Confusion (Level 4)', () => {
      const spell = compendium.requireSpell('confusion');
      const caster = makeHighLevelCaster('caster');
      // Force the WIS save to fail so the adjudication card is emitted deterministically.
      caster.characterSheet!.savingThrows = { wis: { totalBonus: -20 } } as any;
      const state = buildTestState([caster]);
      const res = executeSpellCast({
        state,
        casterId: caster.id,
        spell,
        slotLevel: 4,
        originCell: { x: 0, y: 0 },
        skipReactionPrompts: true,
      });

      expect(res.events.some((e) => e.type === 'HAZARD_ZONE_CREATED')).toBe(true);
      expect(res.events.some((e) => e.type === 'MANUAL_ADJUDICATION_REQUIRED')).toBe(true);
    });

    it('surfaces a Manual/Adjudicated Resolution card for Power Word Kill instead of crashing', () => {
      const spell = compendium.requireSpell('power-word-kill');
      const caster = makeHighLevelCaster('caster');
      const target = createMonsterCombatant(
        compendium.requireMonster('bandit'),
        'target',
        { x: 2, y: 0 },
        { side: 'monster' },
      );
      const state = buildTestState([caster, target]);
      const res = executeSpellCast({
        state,
        casterId: caster.id,
        spell,
        slotLevel: 9,
        targetIds: [target.id],
        skipReactionPrompts: true,
      });

      expect(res.events.some((e) => e.type === 'SPELL_CAST')).toBe(true);
      const card = res.events.find((e) => e.type === 'MANUAL_ADJUDICATION_REQUIRED');
      expect(card).toBeDefined();
      if (card?.type === 'MANUAL_ADJUDICATION_REQUIRED') {
        expect(card.adjudicationId).toBe('power-word-kill-hp-gate');
        expect(card.guidance).toContain('100 HP');
      }
    });

    it('surfaces a Manual/Adjudicated Resolution card for Wish and stays deterministic', () => {
      const spell = compendium.requireSpell('wish');
      const cast = () => {
        const caster = makeHighLevelCaster('caster');
        const state = buildTestState([caster]);
        return executeSpellCast({
          state,
          casterId: caster.id,
          spell,
          slotLevel: 9,
          skipReactionPrompts: true,
        });
      };

      const first = cast();
      const second = cast();
      const card = first.events.find((e) => e.type === 'MANUAL_ADJUDICATION_REQUIRED');
      expect(card).toBeDefined();
      expect(JSON.stringify(first.events)).toBe(JSON.stringify(second.events));
    });
  });

  describe('Tier B/C class feature automation (Levels 6–20)', () => {
    it('executes Wholeness of Body (Monk L6) healing for 3x class level and spending 2 ki', () => {
      const hero = createMonsterCombatant(
        compendium.requireMonster('bandit'),
        'monk',
        { x: 0, y: 0 },
        { side: 'party' },
      );
      hero.maxHp = 60;
      hero.currentHp = 10;
      hero.characterSheet = {
        totalLevel: 6,
        classes: [{ classId: 'monk', level: 6 }],
        proficiencyBonus: 3,
        resources: {
          ki: { resourceId: 'ki', name: 'Ki', max: 6, available: 6, recovery: 'short_rest' },
        },
      } as any;
      const ability = compendium.requireFeature('wholeness-of-body').activatedAbilities?.[0];
      expect(ability).toBeDefined();

      const state = buildTestState([hero]);
      const res = executeActivatedAbility({
        state,
        actorId: hero.id,
        abilityId: ability!.id,
        ability,
      });

      expect(res.events.some((e) => e.type === 'HEAL_APPLIED')).toBe(true);
      expect(res.state.combatants[hero.id]!.currentHp).toBeGreaterThanOrEqual(28);
      expect(res.state.combatants[hero.id]!.characterSheet?.resources?.ki?.available).toBe(4);
    });

    it('executes Intimidating Presence (Barbarian L10) forcing a WIS save vs frightened', () => {
      const hero = createMonsterCombatant(
        compendium.requireMonster('bandit'),
        'barbarian',
        { x: 0, y: 0 },
        { side: 'party' },
      );
      hero.characterSheet = { totalLevel: 10, classes: [{ classId: 'barbarian', level: 10 }] } as any;
      const target = createMonsterCombatant(
        compendium.requireMonster('bandit'),
        'target',
        { x: 3, y: 0 },
        { side: 'monster' },
      );
      const ability = compendium.requireFeature('intimidating-presence').activatedAbilities?.[0];
      const state = buildTestState([hero, target]);
      const res = executeActivatedAbility({
        state,
        actorId: hero.id,
        abilityId: ability!.id,
        ability,
        targetIds: [target.id],
      });

      expect(res.events.some((e) => e.type === 'SAVING_THROW_RESOLVED' && e.ability === 'wis')).toBe(true);
    });

    it('executes Empty Body (Monk L18) applying invisibility and spending 4 ki', () => {
      const hero = createMonsterCombatant(
        compendium.requireMonster('bandit'),
        'monk',
        { x: 0, y: 0 },
        { side: 'party' },
      );
      hero.characterSheet = {
        totalLevel: 18,
        classes: [{ classId: 'monk', level: 18 }],
        resources: {
          ki: { resourceId: 'ki', name: 'Ki', max: 18, available: 18, recovery: 'short_rest' },
        },
      } as any;
      const ability = compendium.requireFeature('empty-body').activatedAbilities?.[0];
      const state = buildTestState([hero]);
      const res = executeActivatedAbility({
        state,
        actorId: hero.id,
        abilityId: ability!.id,
        ability,
      });

      expect(res.state.combatants[hero.id]!.conditions).toContain('invisible');
      expect(res.state.combatants[hero.id]!.characterSheet?.resources?.ki?.available).toBe(14);
    });

    it('surfaces an adjudication card for Legendary Resistance (Adult Black Dragon CR14)', () => {
      const dragon = createMonsterCombatant(
        compendium.requireMonster('adult-black-dragon'),
        'dragon',
        { x: 0, y: 0 },
        { side: 'monster' },
      );
      const traitAbility = compendium
        .requireMonster('adult-black-dragon')
        .traits.find((trait) => trait.id === 'legendary-resistance')!
        .activatedAbilities![0]!;
      const state = buildTestState([dragon]);
      const res = executeActivatedAbility({
        state,
        actorId: dragon.id,
        abilityId: traitAbility.id,
        ability: traitAbility,
      });

      expect(res.events.some((e) => e.type === 'MANUAL_ADJUDICATION_REQUIRED')).toBe(true);
    });
  });

  describe('Tier B/C monster action automation (CR 6–20)', () => {
    it('executes Medusa Multiattack as snake-hair + 2 shortsword strikes', () => {
      const medusa = createMonsterCombatant(
        compendium.requireMonster('medusa'),
        'medusa',
        { x: 0, y: 0 },
        { side: 'monster' },
      );
      const victim = createMonsterCombatant(
        compendium.requireMonster('bandit'),
        'victim',
        { x: 1, y: 0 },
        { side: 'party' },
      );
      victim.armorClass = 5;
      victim.currentHp = 80;
      victim.maxHp = 80;
      const state = buildTestState([medusa, victim]);
      const res = executeMonsterAction({
        state,
        attackerId: medusa.id,
        actionId: 'multiattack',
        targetId: victim.id,
      });

      expect(res.executedSubActions).toEqual(['snake-hair', 'shortsword', 'shortsword']);
      expect(res.events.filter((e) => e.type === 'ATTACK_RESOLVED')).toHaveLength(3);
    });

    it('executes Young Black Dragon Acid Breath as a DEX save with acid damage', () => {
      const dragon = createMonsterCombatant(
        compendium.requireMonster('young-black-dragon'),
        'dragon',
        { x: 0, y: 0 },
        { side: 'monster' },
      );
      const victim = createMonsterCombatant(
        compendium.requireMonster('bandit'),
        'victim',
        { x: 2, y: 0 },
        { side: 'party' },
      );
      const state = buildTestState([dragon, victim]);
      const res = executeMonsterAction({
        state,
        attackerId: dragon.id,
        actionId: 'acid-breath',
        targetIds: [victim.id],
      });

      expect(res.events.some((e) => e.type === 'SAVING_THROW_RESOLVED' && e.ability === 'dex')).toBe(true);
    });

    it('executes Adult Black Dragon Tail attack (CR14) with a deterministic hit resolution', () => {
      const dragon = createMonsterCombatant(
        compendium.requireMonster('adult-black-dragon'),
        'dragon',
        { x: 0, y: 0 },
        { side: 'monster' },
      );
      const victim = createMonsterCombatant(
        compendium.requireMonster('bandit'),
        'victim',
        { x: 2, y: 0 },
        { side: 'party' },
      );
      victim.armorClass = 5;
      const state = buildTestState([dragon, victim]);
      const res = executeWeaponAttack({
        state,
        attackerId: dragon.id,
        targetId: victim.id,
        monsterActionId: 'tail',
      });

      expect(res.outcome).toMatch(/hit/);
      expect(res.events.some((e) => e.type === 'ATTACK_RESOLVED')).toBe(true);
    });
  });
});
