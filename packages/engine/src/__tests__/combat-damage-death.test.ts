import { describe, expect, it } from 'vitest';
import {
  type Combatant,
  type CombatState,
  applyDamage,
  applyHealing,
  applyTemporaryHp,
  calculateMitigatedDamage,
  executeDeathSave,
  stabilizeCreature,
  executeWeaponAttack,
} from '../combat/index.js';

function createMockCombatant(overrides: Partial<Combatant> = {}): Combatant {
  return {
    id: 'hero-1',
    name: 'Valeros the Fighter',
    side: 'party',
    size: 'medium',
    position: { x: 5, y: 5 },
    speedFeet: 30,
    currentHp: 20,
    maxHp: 20,
    tempHp: 0,
    armorClass: 16,
    dexterityScore: 14,
    dexterityModifier: 2,
    strengthScore: 16,
    strengthModifier: 3,
    initiativeBonus: 2,
    initiativeRollMode: 'normal',
    passivePerception: 12,
    stealthModifier: 2,
    isSurprised: false,
    isDodging: false,
    conditions: [],
    deathSaves: { successes: 0, failures: 0 },
    isDead: false,
    isStable: false,
    attacksPerAction: 1,
    damageResistances: [],
    damageImmunities: [],
    damageVulnerabilities: [],
    conditionImmunities: [],
    ...overrides,
  };
}

function createMockCombatState(combatantsList: Combatant[] = []): CombatState {
  const combatants: Record<string, Combatant> = {};
  for (const c of combatantsList) {
    combatants[c.id] = c;
  }
  return {
    encounterId: 'enc-test',
    round: 1,
    phase: 'active_turn',
    initiativeOrder: combatantsList.map((c, i) => ({
      entityId: c.id,
      initiative: 20 - i,
      naturalRoll: 15,
      dexterityScore: c.dexterityScore,
      tieBreaker: 0,
    })),
    activeCombatantIndex: 0,
    activeCombatantId: combatantsList[0]?.id ?? null,
    turnBudget: null,
    combatants,
    surprisedCombatantIds: [],
    outcome: 'in_progress',
    rngState: 12345,
  };
}

describe('SRD-307: Damage Pipeline, Health, Temp HP & Death Saves', () => {
  describe('Damage Mitigations (Immunity, Resistance, Vulnerability)', () => {
    it('applies damage immunity, reducing damage to 0', () => {
      const target = createMockCombatant({
        damageImmunities: ['fire', 'poison'],
      });

      const resFire = calculateMitigatedDamage(target, 25, 'fire');
      expect(resFire.finalAmount).toBe(0);
      expect(resFire.immunityApplied).toBe(true);
      expect(resFire.resistanceApplied).toBe(false);

      const resCold = calculateMitigatedDamage(target, 25, 'cold');
      expect(resCold.finalAmount).toBe(25);
      expect(resCold.immunityApplied).toBe(false);
    });

    it('applies damage resistance, halving damage rounding down', () => {
      const target = createMockCombatant({
        damageResistances: ['slashing', 'lightning'],
      });

      const resOdd = calculateMitigatedDamage(target, 15, 'slashing');
      expect(resOdd.finalAmount).toBe(7); // floor(15 / 2)
      expect(resOdd.resistanceApplied).toBe(true);

      const resEven = calculateMitigatedDamage(target, 16, 'lightning');
      expect(resEven.finalAmount).toBe(8);
      expect(resEven.resistanceApplied).toBe(true);
    });

    it('applies damage vulnerability, doubling damage', () => {
      const target = createMockCombatant({
        damageVulnerabilities: ['bludgeoning', 'radiant'],
      });

      const res = calculateMitigatedDamage(target, 11, 'bludgeoning');
      expect(res.finalAmount).toBe(22);
      expect(res.vulnerabilityApplied).toBe(true);
    });

    it('applies resistance and then vulnerability if both present', () => {
      const target = createMockCombatant({
        damageResistances: ['acid'],
        damageVulnerabilities: ['acid'],
      });

      // floor(15 / 2) = 7, then 7 * 2 = 14
      const res = calculateMitigatedDamage(target, 15, 'acid');
      expect(res.finalAmount).toBe(14);
      expect(res.resistanceApplied).toBe(true);
      expect(res.vulnerabilityApplied).toBe(true);
    });

    it('enforces the Petrified condition (Resistant to all damage, Immune to poison)', () => {
      const target = createMockCombatant({
        conditions: ['petrified'],
      });

      // Poison -> immune
      const resPoison = calculateMitigatedDamage(target, 20, 'poison');
      expect(resPoison.finalAmount).toBe(0);
      expect(resPoison.immunityApplied).toBe(true);

      // Fire -> resistant
      const resFire = calculateMitigatedDamage(target, 21, 'fire');
      expect(resFire.finalAmount).toBe(10);
      expect(resFire.resistanceApplied).toBe(true);

      // Slashing -> resistant
      const resSlash = calculateMitigatedDamage(target, 14, 'slashing');
      expect(resSlash.finalAmount).toBe(7);
      expect(resSlash.resistanceApplied).toBe(true);
    });

    it('respects bypass and ignore options for resistances and immunities', () => {
      const target = createMockCombatant({
        damageResistances: ['piercing'],
        damageImmunities: ['fire'],
      });

      const resBypassed = calculateMitigatedDamage(target, 10, 'piercing', {
        bypassResistances: ['piercing'],
      });
      expect(resBypassed.finalAmount).toBe(10);
      expect(resBypassed.resistanceApplied).toBe(false);

      const resIgnored = calculateMitigatedDamage(target, 10, 'fire', {
        ignoreImmunities: true,
      });
      expect(resIgnored.finalAmount).toBe(10);
      expect(resIgnored.immunityApplied).toBe(false);
    });
  });

  describe('Temporary Hit Points Absorption', () => {
    it('absorbs damage entirely when damage <= tempHp', () => {
      const target = createMockCombatant({
        currentHp: 20,
        tempHp: 10,
      });
      const state = createMockCombatState([target]);

      const result = applyDamage({
        state,
        targetId: target.id,
        rawAmount: 6,
        damageType: 'slashing',
      });

      expect(result.tempHpAbsorbed).toBe(6);
      expect(result.hpLost).toBe(0);
      expect(result.hpRemaining).toBe(20);

      const updated = result.state.combatants[target.id]!;
      expect(updated.tempHp).toBe(4);
      expect(updated.currentHp).toBe(20);
    });

    it('absorbs partial damage when damage > tempHp, applying remainder to currentHp', () => {
      const target = createMockCombatant({
        currentHp: 20,
        tempHp: 5,
      });
      const state = createMockCombatState([target]);

      const result = applyDamage({
        state,
        targetId: target.id,
        rawAmount: 12,
        damageType: 'slashing',
      });

      expect(result.tempHpAbsorbed).toBe(5);
      expect(result.hpLost).toBe(7);
      expect(result.hpRemaining).toBe(13);

      const updated = result.state.combatants[target.id]!;
      expect(updated.tempHp).toBe(0);
      expect(updated.currentHp).toBe(13);
    });

    it('temporary HP does not stack; gaining new temp HP takes the maximum', () => {
      const target = createMockCombatant({
        tempHp: 8,
      });
      const state = createMockCombatState([target]);

      // Gaining 5 does not overwrite 8
      const res1 = applyTemporaryHp({
        state,
        targetId: target.id,
        amount: 5,
      });
      expect(res1.tempHpAfter).toBe(8);
      expect(res1.amountGained).toBe(0);

      // Gaining 12 overwrites 8
      const res2 = applyTemporaryHp({
        state: res1.state,
        targetId: target.id,
        amount: 12,
      });
      expect(res2.tempHpAfter).toBe(12);
      expect(res2.amountGained).toBe(4);
    });

    it('receiving temp HP at 0 HP does not restore consciousness or stabilize', () => {
      const target = createMockCombatant({
        currentHp: 0,
        conditions: ['unconscious', 'prone'],
        isStable: false,
      });
      const state = createMockCombatState([target]);

      const res = applyTemporaryHp({
        state,
        targetId: target.id,
        amount: 10,
      });

      const updated = res.state.combatants[target.id]!;
      expect(updated.currentHp).toBe(0);
      expect(updated.tempHp).toBe(10);
      expect(updated.conditions).toContain('unconscious');
      expect(updated.isStable).toBe(false);
    });
  });

  describe('Zero Hit Points & Instant Death', () => {
    it('kills a monster immediately when reduced to 0 HP', () => {
      const monster = createMockCombatant({
        id: 'goblin-1',
        name: 'Goblin',
        side: 'monster',
        currentHp: 7,
        maxHp: 7,
      });
      const state = createMockCombatState([monster]);

      const result = applyDamage({
        state,
        targetId: monster.id,
        rawAmount: 7,
        damageType: 'piercing',
      });

      expect(result.hpRemaining).toBe(0);
      expect(result.isDead).toBe(true);
      expect(result.state.combatants['goblin-1']!.isDead).toBe(true);
      expect(result.events.some((e) => e.type === 'CREATURE_DIED' && e.reason === 'zero_hp')).toBe(true);
    });

    it('drops player character to 0 HP, giving unconscious and prone without instant death', () => {
      const hero = createMockCombatant({
        currentHp: 10,
        maxHp: 20,
      });
      const state = createMockCombatState([hero]);

      // 15 damage -> reduces from 10 to 0 HP. Excess damage is 5 (5 < maxHp 20) -> not instant death
      const result = applyDamage({
        state,
        targetId: hero.id,
        rawAmount: 15,
        damageType: 'bludgeoning',
      });

      expect(result.hpRemaining).toBe(0);
      expect(result.isDead).toBe(false);
      expect(result.isInstantDeath).toBe(false);
      expect(result.isUnconscious).toBe(true);

      const updated = result.state.combatants[hero.id]!;
      expect(updated.currentHp).toBe(0);
      expect(updated.conditions).toContain('unconscious');
      expect(updated.conditions).toContain('prone');
      expect(updated.deathSaves).toEqual({ successes: 0, failures: 0 });
      expect(updated.isStable).toBe(false);
    });

    it('triggers Instant Death on player character when excess damage >= maxHp', () => {
      const cleric = createMockCombatant({
        name: 'Cleric of Light',
        currentHp: 6,
        maxHp: 12,
      });
      const state = createMockCombatState([cleric]);

      // 18 damage -> 6 HP lost to reach 0. Remaining damage is 12 (12 >= maxHp 12) -> Instant Death!
      const result = applyDamage({
        state,
        targetId: cleric.id,
        rawAmount: 18,
        damageType: 'slashing',
      });

      expect(result.hpRemaining).toBe(0);
      expect(result.isInstantDeath).toBe(true);
      expect(result.isDead).toBe(true);

      const updated = result.state.combatants[cleric.id]!;
      expect(updated.isDead).toBe(true);
      expect(result.events.some((e) => e.type === 'CREATURE_DIED' && e.reason === 'instant_death')).toBe(true);
    });
  });

  describe('Taking Damage at 0 Hit Points', () => {
    it('inflicts 1 death saving throw failure on normal damage at 0 HP', () => {
      const hero = createMockCombatant({
        currentHp: 0,
        conditions: ['unconscious', 'prone'],
        deathSaves: { successes: 0, failures: 0 },
      });
      const state = createMockCombatState([hero]);

      const result = applyDamage({
        state,
        targetId: hero.id,
        rawAmount: 5,
        damageType: 'acid',
        isCritical: false,
      });

      expect(result.deathSaveFailuresAdded).toBe(1);
      const updated = result.state.combatants[hero.id]!;
      expect(updated.deathSaves.failures).toBe(1);
      expect(updated.isDead).toBe(false);
    });

    it('inflicts 2 death saving throw failures on Critical Hit damage at 0 HP', () => {
      const hero = createMockCombatant({
        currentHp: 0,
        conditions: ['unconscious', 'prone'],
        deathSaves: { successes: 0, failures: 0 },
      });
      const state = createMockCombatState([hero]);

      const result = applyDamage({
        state,
        targetId: hero.id,
        rawAmount: 8,
        damageType: 'slashing',
        isCritical: true,
      });

      expect(result.deathSaveFailuresAdded).toBe(2);
      const updated = result.state.combatants[hero.id]!;
      expect(updated.deathSaves.failures).toBe(2);
      expect(updated.isDead).toBe(false);
    });

    it('kills the character when death saving throw failures reach 3', () => {
      const hero = createMockCombatant({
        currentHp: 0,
        conditions: ['unconscious', 'prone'],
        deathSaves: { successes: 1, failures: 2 },
      });
      const state = createMockCombatState([hero]);

      const result = applyDamage({
        state,
        targetId: hero.id,
        rawAmount: 4,
        damageType: 'fire',
      });

      expect(result.deathSaveFailuresAdded).toBe(1);
      const updated = result.state.combatants[hero.id]!;
      expect(updated.deathSaves.failures).toBe(3);
      expect(updated.isDead).toBe(true);
      expect(result.events.some((e) => e.type === 'CREATURE_DIED' && e.reason === 'death_save_failures')).toBe(true);
    });

    it('inflicts Instant Death at 0 HP if damage >= maxHp', () => {
      const hero = createMockCombatant({
        currentHp: 0,
        maxHp: 15,
        conditions: ['unconscious'],
        deathSaves: { successes: 0, failures: 0 },
      });
      const state = createMockCombatState([hero]);

      const result = applyDamage({
        state,
        targetId: hero.id,
        rawAmount: 15,
        damageType: 'necrotic',
      });

      expect(result.isInstantDeath).toBe(true);
      expect(result.isDead).toBe(true);
      expect(result.state.combatants[hero.id]!.isDead).toBe(true);
    });

    it('removes stability when a stable 0 HP character takes damage', () => {
      const hero = createMockCombatant({
        currentHp: 0,
        conditions: ['unconscious'],
        isStable: true,
        deathSaves: { successes: 3, failures: 0 },
      });
      const state = createMockCombatState([hero]);

      const result = applyDamage({
        state,
        targetId: hero.id,
        rawAmount: 2,
        damageType: 'piercing',
      });

      const updated = result.state.combatants[hero.id]!;
      expect(updated.isStable).toBe(false);
      expect(updated.deathSaves.failures).toBe(1);
    });
  });

  describe('Death Saving Throws (SRD 5.1 Mechanics)', () => {
    it('rolls Natural 1: suffers 2 death save failures', () => {
      const hero = createMockCombatant({
        currentHp: 0,
        conditions: ['unconscious'],
        deathSaves: { successes: 0, failures: 0 },
      });
      // Find seed that yields natural roll 1
      let targetSeed = 1;
      for (let s = 1; s < 1000; s++) {
        const state = createMockCombatState([hero]);
        state.rngState = s;
        try {
          const res = executeDeathSave({ state, combatantId: hero.id });
          if (res.roll === 1) {
            targetSeed = s;
            break;
          }
        } catch {}
      }

      const state = createMockCombatState([hero]);
      state.rngState = targetSeed;
      const res = executeDeathSave({ state, combatantId: hero.id });

      expect(res.roll).toBe(1);
      expect(res.outcome).toBe('failure');
      expect(res.deathSaves.failures).toBe(2);
      expect(res.isDead).toBe(false);
    });

    it('rolls Natural 20: regains 1 HP immediately and wakes up (clearing unconscious)', () => {
      const hero = createMockCombatant({
        currentHp: 0,
        conditions: ['unconscious', 'prone'],
        deathSaves: { successes: 1, failures: 2 },
      });

      // Find seed that yields natural roll 20
      let targetSeed = 1;
      for (let s = 1; s < 1000; s++) {
        const state = createMockCombatState([hero]);
        state.rngState = s;
        try {
          const res = executeDeathSave({ state, combatantId: hero.id });
          if (res.roll === 20) {
            targetSeed = s;
            break;
          }
        } catch {}
      }

      const state = createMockCombatState([hero]);
      state.rngState = targetSeed;
      const res = executeDeathSave({ state, combatantId: hero.id });

      expect(res.roll).toBe(20);
      expect(res.outcome).toBe('revived');
      expect(res.currentHp).toBe(1);
      expect(res.deathSaves).toEqual({ successes: 0, failures: 0 });
      expect(res.isDead).toBe(false);
      expect(res.isStable).toBe(false);

      const updated = res.state.combatants[hero.id]!;
      expect(updated.currentHp).toBe(1);
      expect(updated.conditions).not.toContain('unconscious');
      expect(updated.conditions).toContain('prone'); // Still prone until standing up
      expect(res.events.some((e) => e.type === 'CONDITION_REMOVED' && e.conditionId === 'unconscious')).toBe(true);
    });

    it('stabilizes character upon reaching 3 successes', () => {
      const hero = createMockCombatant({
        currentHp: 0,
        conditions: ['unconscious'],
        deathSaves: { successes: 2, failures: 0 },
      });

      // Find seed that yields roll >= 10 and < 20
      let targetSeed = 1;
      for (let s = 1; s < 1000; s++) {
        const state = createMockCombatState([hero]);
        state.rngState = s;
        try {
          const res = executeDeathSave({ state, combatantId: hero.id });
          if (res.roll >= 10 && res.roll < 20) {
            targetSeed = s;
            break;
          }
        } catch {}
      }

      const state = createMockCombatState([hero]);
      state.rngState = targetSeed;
      const res = executeDeathSave({ state, combatantId: hero.id });

      expect(res.outcome).toBe('success');
      expect(res.deathSaves.successes).toBe(3);
      expect(res.isStable).toBe(true);
      expect(res.isDead).toBe(false);
      expect(res.currentHp).toBe(0);
    });

    it('medicine check / stabilization stabilizes creature and resets death saves', () => {
      const hero = createMockCombatant({
        currentHp: 0,
        conditions: ['unconscious'],
        isStable: false,
        deathSaves: { successes: 1, failures: 2 },
      });
      const state = createMockCombatState([hero]);

      const res = stabilizeCreature({ state, targetId: hero.id });
      const updated = res.state.combatants[hero.id]!;
      expect(updated.isStable).toBe(true);
      expect(updated.deathSaves).toEqual({ successes: 0, failures: 0 });
      expect(updated.currentHp).toBe(0);
      expect(updated.conditions).toContain('unconscious');
    });
  });

  describe('Healing Pipeline', () => {
    it('heals a wounded character up to maxHp', () => {
      const hero = createMockCombatant({
        currentHp: 12,
        maxHp: 20,
      });
      const state = createMockCombatState([hero]);

      const res = applyHealing({
        state,
        targetId: hero.id,
        amount: 15,
        sourceName: 'Cure Wounds',
      });

      expect(res.amount).toBe(8); // Only healed 8 up to max 20
      expect(res.hpAfter).toBe(20);
      expect(res.revivedFromZero).toBe(false);
    });

    it('revives a character from 0 HP, clearing unconscious and resetting death saves', () => {
      const hero = createMockCombatant({
        currentHp: 0,
        conditions: ['unconscious', 'prone'],
        deathSaves: { successes: 2, failures: 2 },
        isStable: false,
      });
      const state = createMockCombatState([hero]);

      const res = applyHealing({
        state,
        targetId: hero.id,
        amount: 7,
        sourceName: 'Healing Word',
      });

      expect(res.revivedFromZero).toBe(true);
      expect(res.hpAfter).toBe(7);

      const updated = res.state.combatants[hero.id]!;
      expect(updated.currentHp).toBe(7);
      expect(updated.conditions).not.toContain('unconscious');
      expect(updated.conditions).toContain('prone');
      expect(updated.deathSaves).toEqual({ successes: 0, failures: 0 });
      expect(updated.isStable).toBe(false);

      expect(res.events.some((e) => e.type === 'CONDITION_REMOVED' && e.conditionId === 'unconscious')).toBe(true);
      expect(res.events.some((e) => e.type === 'HEAL_APPLIED' && e.revivedFromZero === true)).toBe(true);
    });

    it('refuses to heal a dead creature', () => {
      const hero = createMockCombatant({
        currentHp: 0,
        isDead: true,
      });
      const state = createMockCombatState([hero]);

      expect(() =>
        applyHealing({
          state,
          targetId: hero.id,
          amount: 10,
        }),
      ).toThrow(/dead/);
    });
  });

  describe('Concentration Saves on Taking Damage (DC = max(10, floor(D / 2)))', () => {
    it('triggers CON save when conscious concentrating character takes damage', () => {
      const caster = createMockCombatant({
        id: 'wizard-1',
        name: 'Mage',
        currentHp: 25,
        maxHp: 25,
        concentratingOn: {
          sourceId: 'hold-person',
          targetEntityIds: ['orc-1'],
          remainingRounds: 10,
        },
      });
      const state = createMockCombatState([caster]);

      // Taking 8 damage -> DC = max(10, floor(8/2)) = 10
      const result = applyDamage({
        state,
        targetId: caster.id,
        rawAmount: 8,
        damageType: 'fire',
      });

      expect(result.concentrationCheck).toBeDefined();
      expect(result.concentrationCheck!.dc).toBe(10);
      expect(result.events.some((e) => e.type === 'SAVING_THROW_RESOLVED' && e.ability === 'con')).toBe(true);
    });

    it('calculates DC based on higher damage: 28 damage -> DC 14', () => {
      const caster = createMockCombatant({
        id: 'wizard-1',
        name: 'Mage',
        currentHp: 40,
        maxHp: 40,
        concentratingOn: {
          sourceId: 'fly',
          targetEntityIds: ['hero-1'],
          remainingRounds: 10,
        },
      });
      const state = createMockCombatState([caster]);

      // 28 damage -> DC = max(10, floor(28 / 2)) = 14
      const result = applyDamage({
        state,
        targetId: caster.id,
        rawAmount: 28,
        damageType: 'bludgeoning',
      });

      expect(result.concentrationCheck!.dc).toBe(14);
    });

    it('breaks concentration automatically when reduced to 0 HP', () => {
      const caster = createMockCombatant({
        id: 'wizard-1',
        name: 'Mage',
        currentHp: 10,
        maxHp: 20,
        concentratingOn: {
          sourceId: 'bless',
          targetEntityIds: ['hero-1', 'hero-2'],
          remainingRounds: 10,
        },
      });
      const state = createMockCombatState([caster]);

      const result = applyDamage({
        state,
        targetId: caster.id,
        rawAmount: 12,
        damageType: 'slashing',
      });

      expect(result.concentrationBroken).toBe(true);
      const updated = result.state.combatants[caster.id]!;
      expect(updated.concentratingOn).toBeUndefined();
      expect(
        result.events.some(
          (e) => e.type === 'CONCENTRATION_ENDED' && e.reason === 'incapacitated',
        ),
      ).toBe(true);
    });
  });

  describe('Integration with Weapon Attack & Auto-Crit against Unconscious Targets', () => {
    it('causes 2 death save failures on melee attack hit within 5 ft against unconscious target', () => {
      const attacker = createMockCombatant({
        id: 'orc-1',
        name: 'Orc Raider',
        side: 'monster',
        position: { x: 5, y: 5 },
      });
      const unconsciousHero = createMockCombatant({
        id: 'hero-down',
        name: 'Fallen Paladin',
        side: 'party',
        currentHp: 0,
        position: { x: 5, y: 6 }, // 5 ft away
        conditions: ['unconscious', 'prone'],
        deathSaves: { successes: 0, failures: 0 },
      });

      const state = createMockCombatState([attacker, unconsciousHero]);

      const attackResult = executeWeaponAttack({
        state,
        attackerId: attacker.id,
        targetId: unconsciousHero.id,
        customAttack: {
          name: 'Greataxe',
          attackType: 'melee_weapon',
          toHitBonus: 20, // guaranteed hit
          damageDice: '1d12',
          damageBonus: 3,
          damageType: 'slashing',
          reachFeet: 5,
        },
      });

      // Within 5 ft against unconscious target -> auto-crit!
      expect(attackResult.outcome).toBe('critical_hit');

      // The damage pipeline received isCritical: true at 0 HP -> 2 death save failures!
      const targetAfter = attackResult.state.combatants[unconsciousHero.id]!;
      expect(targetAfter.deathSaves.failures).toBe(2);
      expect(targetAfter.isDead).toBe(false);

      const dmgEvent = attackResult.events.find((e) => e.type === 'DAMAGE_APPLIED');
      expect(dmgEvent).toBeDefined();
      if (dmgEvent && dmgEvent.type === 'DAMAGE_APPLIED') {
        expect(dmgEvent.deathSaveFailuresAdded).toBe(2);
      }
    });
  });
});
