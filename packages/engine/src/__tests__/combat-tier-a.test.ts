import { describe, expect, it } from 'vitest';
import { compendium } from '@srd5/data';
import { createMonsterCombatant, createCharacterCombatant } from '../combat/combatant.js';
import { executeWeaponAttack } from '../combat/attack.js';
import { executeSpellCast } from '../combat/spellcasting.js';
import { executeMonsterAction } from '../combat/monster-actions.js';
import { executeActivatedAbility } from '../combat/features.js';
import { createTacticalGrid } from '../grid/model.js';
import type { CombatState, Combatant } from '../combat/types.js';

describe('SRD-310: Combat Tier A Executable Effect DSL Definitions Suite', () => {
  function buildTestState(combatantsList: Combatant[]): CombatState {
    const combatants: Record<string, Combatant> = {};
    for (const c of combatantsList) {
      combatants[c.id] = c;
    }
    return {
      encounterId: 'test-tier-a',
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

  describe('Tier A Spells Automation (Levels 0–3)', () => {
    it('executes Aid (Level 2) granting +5 HP and healing to 3 allies', () => {
      const aidSpell = compendium.requireSpell('aid');
      expect(aidSpell.effects).toHaveLength(2);

      const goblinA = createMonsterCombatant(compendium.requireMonster('goblin'), 'ally-1', { x: 0, y: 0 }, { side: 'party' });
      const goblinB = createMonsterCombatant(compendium.requireMonster('goblin'), 'ally-2', { x: 1, y: 0 }, { side: 'party' });
      goblinA.currentHp = 3; // damaged

      const state = buildTestState([goblinA, goblinB]);
      const res = executeSpellCast({
        state,
        casterId: goblinA.id,
        spell: aidSpell,
        slotLevel: 2,
        targetIds: [goblinA.id, goblinB.id],
      });

      expect(res.events.some((e) => e.type === 'SPELL_CAST')).toBe(true);
      expect(res.state.combatants[goblinA.id]!.activeEffects?.some((e) => e.effectId === 'aid-buff')).toBe(true);
      expect(res.state.combatants[goblinA.id]!.currentHp).toBe(7); // 3 + 5 capped at maxHp (7)
    });

    it('executes Faerie Fire (Level 1) causing advantage against failed save targets', () => {
      const faerieFire = compendium.requireSpell('faerie-fire');
      const caster = createMonsterCombatant(compendium.requireMonster('acolyte'), 'caster', { x: 0, y: 0 }, { side: 'party' });
      const target = createMonsterCombatant(compendium.requireMonster('goblin'), 'target', { x: 3, y: 3 }, { side: 'monster' });

      const state = buildTestState([caster, target]);
      const res = executeSpellCast({
        state,
        casterId: caster.id,
        spell: faerieFire,
        slotLevel: 1,
        targetIds: [target.id],
      });

      expect(res.events.some((e) => e.type === 'SAVING_THROW_RESOLVED')).toBe(true);
      if (res.targetsFailedSave.includes(target.id)) {
        const buffed = res.state.combatants[target.id]!;
        expect(buffed.activeEffects?.some((e) => e.effectId === 'faerie-fire-glowing')).toBe(true);
      }
    });

    it('executes Blindness/Deafness (Level 2) applying blinded condition on failed CON save', () => {
      const spell = compendium.requireSpell('blindness-deafness');
      const caster = createMonsterCombatant(compendium.requireMonster('priest'), 'caster', { x: 0, y: 0 }, { side: 'party' });
      const target = createMonsterCombatant(compendium.requireMonster('zombie'), 'target', { x: 2, y: 2 }, { side: 'monster' });

      const state = buildTestState([caster, target]);
      const res = executeSpellCast({
        state,
        casterId: caster.id,
        spell,
        slotLevel: 2,
        targetIds: [target.id],
      });

      expect(res.events.some((e) => e.type === 'SAVING_THROW_RESOLVED')).toBe(true);
    });

    it('executes Misty Step (Level 2) teleporting caster to destination cell', () => {
      const spell = compendium.requireSpell('misty-step');
      const caster = createMonsterCombatant(compendium.requireMonster('cult-fanatic'), 'caster', { x: 0, y: 0 }, { side: 'party' });

      const state = buildTestState([caster]);
      const dest = { x: 4, y: 4 };
      const res = executeSpellCast({
        state,
        casterId: caster.id,
        spell,
        slotLevel: 2,
        originCell: dest,
      });

      expect(res.state.combatants[caster.id]!.position).toEqual(dest);
      expect(res.events.some((e) => e.type === 'ENTITY_MOVED' && e.mode === 'teleport')).toBe(true);
    });

    it('executes Thunderwave (Level 1) applying forced movement push to targets in range', () => {
      const spell = compendium.requireSpell('thunderwave');
      const caster = createMonsterCombatant(compendium.requireMonster('cult-fanatic'), 'caster', { x: 2, y: 2 }, { side: 'party' });
      const enemy = createMonsterCombatant(compendium.requireMonster('goblin'), 'enemy', { x: 3, y: 2 }, { side: 'monster' });

      const state = buildTestState([caster, enemy]);
      const res = executeSpellCast({
        state,
        casterId: caster.id,
        spell,
        slotLevel: 1,
        targetIds: [enemy.id],
      });

      expect(res.events.some((e) => e.type === 'SAVING_THROW_RESOLVED')).toBe(true);
      expect(res.events.some((e) => e.type === 'DAMAGE_APPLIED')).toBe(true);
    });
  });

  describe('Tier A Monster Actions & Multiattack (CR 0–5)', () => {
    it('executes Wolf Bite and automatically resolves knockdown STR saving throw', () => {
      const wolf = createMonsterCombatant(compendium.requireMonster('wolf'), 'wolf', { x: 0, y: 0 }, { side: 'monster' });
      const target = createMonsterCombatant(compendium.requireMonster('bandit'), 'target', { x: 1, y: 0 }, { side: 'party' });

      // Target with low AC so bite easily hits
      target.armorClass = 5;
      const state = buildTestState([wolf, target]);
      const res = executeWeaponAttack({
        state,
        attackerId: wolf.id,
        targetId: target.id,
        monsterActionId: 'bite',
      });

      expect(res.outcome).toMatch(/hit/);
      expect(res.events.some((e) => e.type === 'ATTACK_RESOLVED')).toBe(true);
      expect(res.events.some((e) => e.type === 'SAVING_THROW_RESOLVED' && e.ability === 'str')).toBe(true);
    });

    it('executes Ghoul Claws and resolves DC 10 CON saving throw vs Paralysis', () => {
      const ghoul = createMonsterCombatant(compendium.requireMonster('ghoul'), 'ghoul', { x: 0, y: 0 }, { side: 'monster' });
      const victim = createMonsterCombatant(compendium.requireMonster('bandit'), 'victim', { x: 1, y: 0 }, { side: 'party' });
      victim.armorClass = 5;

      const state = buildTestState([ghoul, victim]);
      const res = executeWeaponAttack({
        state,
        attackerId: ghoul.id,
        targetId: victim.id,
        monsterActionId: 'claws',
      });

      expect(res.outcome).toMatch(/hit/);
      expect(res.events.some((e) => e.type === 'SAVING_THROW_RESOLVED' && e.ability === 'con')).toBe(true);
    });

    it('executes Owlbear Multiattack (Beak + Claws in sequence)', () => {
      const owlbear = createMonsterCombatant(compendium.requireMonster('owlbear'), 'owlbear', { x: 0, y: 0 }, { side: 'monster' });
      const victim = createMonsterCombatant(compendium.requireMonster('ogre'), 'victim', { x: 1, y: 0 }, { side: 'party' });
      victim.armorClass = 8;
      victim.currentHp = 50;

      const state = buildTestState([owlbear, victim]);
      const res = executeMonsterAction({
        state,
        attackerId: owlbear.id,
        actionId: 'multiattack',
        targetId: victim.id,
      });

      expect(res.executedSubActions).toEqual(['beak', 'claws']);
      const attacksResolved = res.events.filter((e) => e.type === 'ATTACK_RESOLVED');
      expect(attacksResolved.length).toBe(2);
    });

    it('executes Goblin Boss Multiattack (2 Scimitar attacks)', () => {
      const boss = createMonsterCombatant(compendium.requireMonster('goblin-boss'), 'boss', { x: 0, y: 0 }, { side: 'monster' });
      const victim = createMonsterCombatant(compendium.requireMonster('bandit'), 'victim', { x: 1, y: 0 }, { side: 'party' });
      victim.armorClass = 8;
      victim.currentHp = 30;

      const state = buildTestState([boss, victim]);
      const res = executeMonsterAction({
        state,
        attackerId: boss.id,
        actionId: 'multiattack',
        targetId: victim.id,
      });

      expect(res.executedSubActions).toEqual(['scimitar', 'scimitar']);
      const attacksResolved = res.events.filter((e) => e.type === 'ATTACK_RESOLVED');
      expect(attacksResolved.length).toBe(2);
    });

    it('executes Harpy Luring Song (WIS saving throw vs charm)', () => {
      const harpy = createMonsterCombatant(compendium.requireMonster('harpy'), 'harpy', { x: 0, y: 0 }, { side: 'monster' });
      const target = createMonsterCombatant(compendium.requireMonster('bandit'), 'target', { x: 4, y: 4 }, { side: 'party' });

      const state = buildTestState([harpy, target]);
      const res = executeMonsterAction({
        state,
        attackerId: harpy.id,
        actionId: 'luring-song',
        targetIds: [target.id],
      });

      expect(res.events.some((e) => e.type === 'SAVING_THROW_RESOLVED' && e.ability === 'wis')).toBe(true);
    });
  });

  describe('Tier A Class Features Automation (Levels 1–5)', () => {
    it('executes Enter Rage feature applying damage bonus and physical resistance', () => {
      const hero = createMonsterCombatant(compendium.requireMonster('bandit'), 'barbarian', { x: 0, y: 0 }, { side: 'party' });
      hero.characterSheet = {
        totalLevel: 3,
        classes: [{ classId: 'barbarian', level: 3 }],
        resources: {
          rage: { resourceId: 'rage', name: 'Rage', max: 3, available: 3, recovery: 'long_rest' },
        },
      } as any;

      const rageFeature = compendium.requireFeature('rage');
      const enterRageAbility = rageFeature.activatedAbilities?.[0];
      expect(enterRageAbility).toBeDefined();

      const state = buildTestState([hero]);
      const res = executeActivatedAbility({
        state,
        actorId: hero.id,
        abilityId: enterRageAbility!.id,
        ability: enterRageAbility,
      });

      expect(res.state.combatants[hero.id]!.activeEffects?.some((e) => e.effectId === 'barbarian-rage')).toBe(true);
      expect(res.state.combatants[hero.id]!.characterSheet?.resources?.rage?.available).toBe(2);
      expect(res.state.turnBudget?.bonusAction).toBe(0); // bonus action consumed
    });

    it('executes Second Wind feature healing 1d10 + class level', () => {
      const hero = createMonsterCombatant(compendium.requireMonster('bandit'), 'fighter', { x: 0, y: 0 }, { side: 'party' });
      hero.maxHp = 30;
      hero.currentHp = 10;
      hero.characterSheet = {
        totalLevel: 3,
        classes: [{ classId: 'fighter', level: 3 }],
        resources: {
          second_wind: { resourceId: 'second_wind', name: 'Second Wind', max: 1, available: 1, recovery: 'short_rest' },
        },
      } as any;

      const secondWindFeature = compendium.requireFeature('second-wind');
      const ability = secondWindFeature.activatedAbilities?.[0];
      expect(ability).toBeDefined();

      const state = buildTestState([hero]);
      const res = executeActivatedAbility({
        state,
        actorId: hero.id,
        abilityId: ability!.id,
        ability,
      });

      expect(res.events.some((e) => e.type === 'HEAL_APPLIED')).toBe(true);
      expect(res.state.combatants[hero.id]!.currentHp).toBeGreaterThan(10);
      expect(res.state.combatants[hero.id]!.characterSheet?.resources?.second_wind?.available).toBe(0);
    });

    it('resolves player class features from the character sheet without an explicit spec (USE_CLASS_FEATURE path)', () => {
      // Regression test: the reducer only passes abilityId, so Second Wind
      // must resolve from characterSheet.activatedAbilities instead of
      // throwing `not found on "<name>"`.
      const hero = createMonsterCombatant(compendium.requireMonster('bandit'), 'fighter', { x: 0, y: 0 }, { side: 'party' });
      hero.maxHp = 30;
      hero.currentHp = 10;
      const secondWindAbility = compendium.requireFeature('second-wind').activatedAbilities?.[0];
      expect(secondWindAbility).toBeDefined();
      hero.characterSheet = {
        totalLevel: 3,
        classes: [{ classId: 'fighter', level: 3 }],
        resources: {
          second_wind: { resourceId: 'second_wind', name: 'Second Wind', max: 1, available: 1, recovery: 'short_rest' },
        },
        activatedAbilities: [secondWindAbility],
      } as any;

      const state = buildTestState([hero]);
      const res = executeActivatedAbility({
        state,
        actorId: hero.id,
        abilityId: secondWindAbility!.id,
      });

      expect(res.events.some((e) => e.type === 'HEAL_APPLIED')).toBe(true);
      expect(res.state.combatants[hero.id]!.currentHp).toBeGreaterThan(10);
      expect(res.state.combatants[hero.id]!.characterSheet?.resources?.second_wind?.available).toBe(0);
    });

    it('executes Turn Undead Channel Divinity forcing WIS save on undead', () => {      const cleric = createMonsterCombatant(compendium.requireMonster('acolyte'), 'cleric', { x: 0, y: 0 }, { side: 'party' });
      cleric.characterSheet = {
        totalLevel: 3,
        classes: [{ classId: 'cleric', level: 3 }],
        resources: {
          channel_divinity: { resourceId: 'channel_divinity', name: 'Channel Divinity', max: 1, available: 1, recovery: 'short_rest' },
        },
        spellcasting: {
          classes: [{ classId: 'cleric', spellSaveDc: 14 }],
        },
      } as any;

      const zombie = createMonsterCombatant(compendium.requireMonster('zombie'), 'zombie', { x: 2, y: 2 }, { side: 'monster' });

      const turnUndeadFeature = compendium.requireFeature('channel-divinity-cleric');
      const ability = turnUndeadFeature.activatedAbilities?.[0];
      expect(ability).toBeDefined();

      const state = buildTestState([cleric, zombie]);
      const res = executeActivatedAbility({
        state,
        actorId: cleric.id,
        abilityId: ability!.id,
        ability,
        targetIds: [zombie.id],
      });

      expect(res.events.some((e) => e.type === 'SAVING_THROW_RESOLVED' && e.ability === 'wis')).toBe(true);
      expect(res.state.turnBudget?.action).toBe(0);
    });
  });
});
