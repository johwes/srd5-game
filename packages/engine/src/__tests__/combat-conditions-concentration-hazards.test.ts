import { describe, expect, it } from 'vitest';
import {
  type Combatant,
  type CombatState,
  startCombatEncounter,
  applyConditionToCombatant,
  removeConditionFromCombatant,
  getConditionAttackRollMode,
  getConditionSavingThrowRollMode,
  getConditionAbilityCheckRollMode,
  getConditionSpeed,
  canAttackTarget,
  canFrightenedCreatureMove,
  resolveConditionTurnEndSaves,
  startConcentration,
  breakConcentration,
  resolveConcentrationSavingThrow,
  tickConcentration,
  createHazardZone,
  removeHazardZone,
  executeHazardZoneEffects,
  triggerHazardZonesOnMove,
  triggerHazardZonesAtTurnStart,
  tickHazardZones,
  isCellInHazardDifficultTerrain,
  executeMoveCombatant,
  startTurn,
  endTurn,
  applyDamage,
  executeWeaponAttack,
  executeGrapple,
  executeShove,
  createTacticalGrid,
} from '../index.js';

function makeTestCombatant(overrides: Partial<Combatant> = {}): Combatant {
  return {
    id: 'hero-1',
    name: 'Valeros',
    side: 'party',
    size: 'medium',
    position: { x: 5, y: 5 },
    speedFeet: 30,
    currentHp: 20,
    maxHp: 20,
    tempHp: 0,
    armorClass: 15,
    dexterityScore: 14,
    dexterityModifier: 2,
    initiativeBonus: 2,
    initiativeRollMode: 'normal',
    passivePerception: 12,
    stealthModifier: 2,
    isSurprised: false,
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

describe('SRD-308: Concentration Tracking', () => {
  it('enforces concentration DC = max(10, floor(dmg/2)) on taking damage', () => {
    const caster = makeTestCombatant({
      id: 'wizard-1',
      name: 'Ezren',
      concentratingOn: {
        sourceId: 'fly',
        targetEntityIds: ['wizard-1'],
        remainingRounds: 10,
      },
    });

    const state: CombatState = {
      encounterId: 'enc-1',
      round: 1,
      phase: 'active_turn',
      initiativeOrder: [{ entityId: caster.id, initiative: 15, naturalRoll: 13, dexterityScore: 14, tieBreaker: 0 }],
      activeCombatantIndex: 0,
      activeCombatantId: caster.id,
      turnBudget: null,
      combatants: { [caster.id]: caster },
      surprisedCombatantIds: [],
      outcome: 'in_progress',
      rngState: 42,
    };

    // 12 damage -> DC = max(10, floor(12 / 2)) = 10
    const res1 = resolveConcentrationSavingThrow(state, caster.id, 12);
    expect(res1.dc).toBe(10);

    // 35 damage -> DC = max(10, floor(35 / 2)) = 17
    const res2 = resolveConcentrationSavingThrow(state, caster.id, 35);
    expect(res2.dc).toBe(17);
  });

  it('drops concentration on failed saving throw and cleans up linked hazard zones', () => {
    const caster = makeTestCombatant({
      id: 'wizard-1',
      name: 'Ezren',
      concentratingOn: {
        sourceId: 'web',
        targetEntityIds: [],
        remainingRounds: 10,
      },
    });

    const state: CombatState = {
      encounterId: 'enc-1',
      round: 1,
      phase: 'active_turn',
      initiativeOrder: [{ entityId: caster.id, initiative: 15, naturalRoll: 13, dexterityScore: 14, tieBreaker: 0 }],
      activeCombatantIndex: 0,
      activeCombatantId: caster.id,
      turnBudget: null,
      combatants: { [caster.id]: caster },
      hazardZones: {
        'zone-1': {
          id: 'zone-1',
          zoneId: 'web-zone',
          casterId: caster.id,
          sourceName: 'Web',
          shape: 'cube',
          origin: { x: 5, y: 5 },
          sizeFeet: 20,
          cells: [{ x: 5, y: 5 }],
          durationRounds: 10,
          remainingRounds: 10,
          requiresConcentration: true,
          difficultTerrain: true,
          onEnterOrStartTurn: [],
          triggeredCreaturesThisTurn: [],
        },
      },
      surprisedCombatantIds: [],
      outcome: 'in_progress',
      rngState: 42,
    };

    // Force failure with rollModeOverride or huge DC
    const res = resolveConcentrationSavingThrow(state, caster.id, 100);
    expect(res.passed).toBe(false);
    expect(res.concentrationBroken).toBe(true);
    expect(res.state.combatants[caster.id]?.concentratingOn).toBeUndefined();
    expect(res.state.hazardZones?.['zone-1']).toBeUndefined();
    expect(res.events.some((e) => e.type === 'CONCENTRATION_ENDED' && e.reason === 'damaged')).toBe(true);
    expect(res.events.some((e) => e.type === 'HAZARD_ZONE_REMOVED' && e.reason === 'concentration_ended')).toBe(true);
  });

  it('ends previous concentration when casting a new concentration spell', () => {
    const caster = makeTestCombatant({
      id: 'cleric-1',
      name: 'Kyra',
      concentratingOn: {
        sourceId: 'bless',
        targetEntityIds: ['cleric-1'],
        remainingRounds: 10,
      },
    });

    const state: CombatState = {
      encounterId: 'enc-1',
      round: 1,
      phase: 'active_turn',
      initiativeOrder: [{ entityId: caster.id, initiative: 15, naturalRoll: 13, dexterityScore: 14, tieBreaker: 0 }],
      activeCombatantIndex: 0,
      activeCombatantId: caster.id,
      turnBudget: null,
      combatants: { [caster.id]: caster },
      surprisedCombatantIds: [],
      outcome: 'in_progress',
      rngState: 42,
    };

    const res = startConcentration(state, caster.id, {
      sourceId: 'spirit_guardians',
      sourceName: 'Spirit Guardians',
      durationRounds: 100,
    });

    expect(res.events.some((e) => e.type === 'CONCENTRATION_ENDED' && e.reason === 'new_spell')).toBe(true);
    expect(res.events.some((e) => e.type === 'CONCENTRATION_STARTED' && e.spellId === 'spirit_guardians')).toBe(true);
    expect(res.state.combatants[caster.id]?.concentratingOn?.sourceId).toBe('spirit_guardians');
  });

  it('ticks concentration rounds and breaks on expiry', () => {
    const caster = makeTestCombatant({
      id: 'cleric-1',
      name: 'Kyra',
      concentratingOn: {
        sourceId: 'shield_of_faith',
        remainingRounds: 1,
        targetEntityIds: [],
      },
    });

    const state: CombatState = {
      encounterId: 'enc-1',
      round: 1,
      phase: 'active_turn',
      initiativeOrder: [{ entityId: caster.id, initiative: 15, naturalRoll: 13, dexterityScore: 14, tieBreaker: 0 }],
      activeCombatantIndex: 0,
      activeCombatantId: caster.id,
      turnBudget: null,
      combatants: { [caster.id]: caster },
      surprisedCombatantIds: [],
      outcome: 'in_progress',
      rngState: 42,
    };

    const res = tickConcentration(state, caster.id);
    expect(res.state.combatants[caster.id]?.concentratingOn).toBeUndefined();
    expect(res.events.some((e) => e.type === 'CONCENTRATION_ENDED' && e.reason === 'turn_expiry')).toBe(true);
  });
});

describe('SRD-308: Hazard Zones', () => {
  it('creates hazard zone, calculates AOE cells, and imposes difficult terrain', () => {
    const caster = makeTestCombatant({ id: 'caster-1', position: { x: 0, y: 0 } });
    const state: CombatState = {
      encounterId: 'enc-1',
      round: 1,
      phase: 'active_turn',
      initiativeOrder: [{ entityId: caster.id, initiative: 15, naturalRoll: 13, dexterityScore: 14, tieBreaker: 0 }],
      activeCombatantIndex: 0,
      activeCombatantId: caster.id,
      turnBudget: null,
      combatants: { [caster.id]: caster },
      surprisedCombatantIds: [],
      outcome: 'in_progress',
      rngState: 100,
    };

    const res = createHazardZone(state, {
      zoneId: 'web-zone',
      casterId: caster.id,
      sourceName: 'Web',
      shape: 'sphere',
      origin: { x: 5, y: 5 },
      sizeFeet: 10,
      requiresConcentration: true,
      difficultTerrain: true,
      onEnterOrStartTurn: [],
    });

    expect(Object.keys(res.state.hazardZones ?? {}).length).toBe(1);
    const zoneInstance = Object.values(res.state.hazardZones!)[0]!;
    expect(zoneInstance.cells.length).toBeGreaterThan(0);
    expect(zoneInstance.cells.some((c) => c.x === 5 && c.y === 5)).toBe(true);

    // Difficult terrain check
    expect(isCellInHazardDifficultTerrain(res.state.hazardZones, { x: 5, y: 5 })).toBe(true);
    expect(isCellInHazardDifficultTerrain(res.state.hazardZones, { x: 20, y: 20 })).toBe(false);

    // Creator is now concentrating
    expect(res.state.combatants[caster.id]?.concentratingOn?.sourceId).toBe('web-zone');
  });

  it('triggers hazard zone saving throw and damage on entering during movement', () => {
    const caster = makeTestCombatant({ id: 'caster-1', position: { x: 0, y: 0 } });
    const goblin = makeTestCombatant({
      id: 'goblin-1',
      name: 'Goblin',
      side: 'monster',
      position: { x: 0, y: 2 },
      currentHp: 15,
      maxHp: 15,
      speedFeet: 30,
    });

    const zoneRes = createHazardZone(
      {
        encounterId: 'enc-1',
        round: 1,
        phase: 'active_turn',
        initiativeOrder: [{ entityId: goblin.id, initiative: 12, naturalRoll: 10, dexterityScore: 14, tieBreaker: 0 }],
        activeCombatantIndex: 0,
        activeCombatantId: goblin.id,
        turnBudget: null,
        combatants: { [caster.id]: caster, [goblin.id]: goblin },
        surprisedCombatantIds: [],
        outcome: 'in_progress',
        rngState: 50,
      },
      {
        zoneId: 'spirit-guardians-zone',
        casterId: caster.id,
        sourceName: 'Spirit Guardians',
        shape: 'sphere',
        origin: { x: 4, y: 2 },
        sizeFeet: 10,
        requiresConcentration: true,
        difficultTerrain: true,
        saveDc: 15,
        onEnterOrStartTurn: [
          {
            step: 'saving_throw',
            ability: 'wis',
            dcFormula: '15',
            onFail: [
              {
                step: 'deal_damage',
                diceFormula: '3d8',
                damageType: 'radiant',
              },
            ],
          },
        ],
      },
    );

    const startTurnRes = startTurn(zoneRes.state, goblin.id);

    // Goblin starts at (0, 2) outside zone, moves to (1, 2) then into the hazard zone at (3, 2)
    const moveRes = executeMoveCombatant(startTurnRes.state, {
      actorId: goblin.id,
      path: [{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }],
    });

    expect(moveRes.events.some((e) => e.type === 'HAZARD_ZONE_TRIGGERED' && e.trigger === 'enter')).toBe(true);
    expect(moveRes.events.some((e) => e.type === 'SAVING_THROW_RESOLVED')).toBe(true);
    expect(moveRes.state.combatants[goblin.id]!.position).toEqual({ x: 3, y: 2 });
  });

  it('triggers hazard zone at the start of creature turn', () => {
    const caster = makeTestCombatant({ id: 'caster-1', position: { x: 0, y: 0 } });
    const orc = makeTestCombatant({
      id: 'orc-1',
      name: 'Orc',
      side: 'monster',
      position: { x: 5, y: 5 },
      currentHp: 20,
      maxHp: 20,
    });

    const zoneRes = createHazardZone(
      {
        encounterId: 'enc-1',
        round: 1,
        phase: 'active_turn',
        initiativeOrder: [{ entityId: orc.id, initiative: 10, naturalRoll: 10, dexterityScore: 10, tieBreaker: 0 }],
        activeCombatantIndex: 0,
        activeCombatantId: orc.id,
        turnBudget: null,
        combatants: { [caster.id]: caster, [orc.id]: orc },
        surprisedCombatantIds: [],
        outcome: 'in_progress',
        rngState: 77,
      },
      {
        zoneId: 'fire-zone',
        casterId: caster.id,
        sourceName: 'Wall of Fire',
        shape: 'sphere',
        origin: { x: 5, y: 5 },
        sizeFeet: 10,
        requiresConcentration: false,
        difficultTerrain: false,
        saveDc: 14,
        onEnterOrStartTurn: [
          {
            step: 'deal_damage',
            diceFormula: '2d6',
            damageType: 'fire',
          },
        ],
      },
    );

    const turnRes = startTurn(zoneRes.state, orc.id);
    expect(turnRes.events.some((e) => e.type === 'HAZARD_ZONE_TRIGGERED' && e.trigger === 'start_turn')).toBe(true);
    expect(turnRes.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'fire')).toBe(true);
    expect(turnRes.state.combatants[orc.id]!.currentHp).toBeLessThan(20);
  });
});

describe('SRD-308: All 15 SRD 5.1 Conditions', () => {
  it('1. blinded: imposes disadvantage on attacks, advantage to attackers, auto-fails sight checks', () => {
    const attacker = makeTestCombatant({ id: 'a1', conditions: ['blinded'] });
    const target = makeTestCombatant({ id: 't1' });

    // Attacker is blinded -> disadvantage
    const mode1 = getConditionAttackRollMode(attacker, target, 'melee_weapon', 5);
    expect(mode1.mode).toBe('disadvantage');

    // Attacking a blinded target -> advantage
    const mode2 = getConditionAttackRollMode(target, attacker, 'melee_weapon', 5);
    expect(mode2.mode).toBe('advantage');

    // Sight-based ability check auto-fails
    const checkRes = getConditionAbilityCheckRollMode(attacker, 'wis', 'perception', { isSightBased: true });
    expect(checkRes.autoFail).toBe(true);
  });

  it('2. charmed: prevents attacking charmer and grants charmer advantage on social checks', () => {
    const charmer = makeTestCombatant({ id: 'c1' });
    const charmedVictim = makeTestCombatant({
      id: 'v1',
      conditions: ['charmed'],
      charmedByEntityId: charmer.id,
    });

    const attackAllowed = canAttackTarget(charmedVictim, charmer);
    expect(attackAllowed.allowed).toBe(false);
    expect(attackAllowed.reason).toMatch(/cannot attack the charmer/i);

    const socialCheck = getConditionAbilityCheckRollMode(charmedVictim, 'cha', 'persuasion', { isSocialWithCharmer: true });
    expect(socialCheck.mode).toBe('advantage');
  });

  it('3. deafened: auto-fails hearing-based ability checks', () => {
    const creature = makeTestCombatant({ conditions: ['deafened'] });
    const checkRes = getConditionAbilityCheckRollMode(creature, 'wis', 'perception', { isHearingBased: true });
    expect(checkRes.autoFail).toBe(true);
  });

  it('4. exhaustion: enforces 6 progressive cumulative tiers (L1 checks, L2 half speed, L3 attacks & saves, L4 half HP, L5 speed 0, L6 death)', () => {
    let hero = makeTestCombatant({ maxHp: 40, currentHp: 40, speedFeet: 30 });

    // Tier 1: Disadvantage on ability checks
    hero = applyConditionToCombatant(hero, 'exhaustion', { exhaustionLevelChange: 1 }).combatant;
    expect(hero.exhaustionLevel).toBe(1);
    expect(getConditionAbilityCheckRollMode(hero, 'str').mode).toBe('disadvantage');

    // Tier 2: Speed halved
    hero = applyConditionToCombatant(hero, 'exhaustion', { exhaustionLevelChange: 1 }).combatant;
    expect(hero.exhaustionLevel).toBe(2);
    expect(getConditionSpeed(hero)).toBe(15);

    // Tier 3: Disadvantage on attack rolls & saving throws
    hero = applyConditionToCombatant(hero, 'exhaustion', { exhaustionLevelChange: 1 }).combatant;
    expect(hero.exhaustionLevel).toBe(3);
    const target = makeTestCombatant({ id: 't2' });
    expect(getConditionAttackRollMode(hero, target, 'melee_weapon', 5).mode).toBe('disadvantage');
    expect(getConditionSavingThrowRollMode(hero, 'dex').mode).toBe('disadvantage');

    // Tier 4: Max HP halved
    hero = applyConditionToCombatant(hero, 'exhaustion', { exhaustionLevelChange: 1 }).combatant;
    expect(hero.exhaustionLevel).toBe(4);
    expect(hero.maxHp).toBe(20);
    expect(hero.currentHp).toBe(20);

    // Tier 5: Speed reduced to 0
    hero = applyConditionToCombatant(hero, 'exhaustion', { exhaustionLevelChange: 1 }).combatant;
    expect(hero.exhaustionLevel).toBe(5);
    expect(getConditionSpeed(hero)).toBe(0);

    // Tier 6: Death
    const res6 = applyConditionToCombatant(hero, 'exhaustion', { exhaustionLevelChange: 1 });
    expect(res6.combatant.exhaustionLevel).toBe(6);
    expect(res6.combatant.isDead).toBe(true);
    expect(res6.events.some((e) => e.type === 'CREATURE_DIED')).toBe(true);
  });

  it('5. frightened: disadvantage on checks/attacks while fear source visible, cannot move closer', () => {
    const dragon = makeTestCombatant({ id: 'dragon-1', position: { x: 10, y: 10 } });
    const hero = makeTestCombatant({
      id: 'hero-1',
      conditions: ['frightened'],
      frightenedByEntityId: dragon.id,
      position: { x: 5, y: 5 },
    });

    const attackMode = getConditionAttackRollMode(hero, dragon, 'ranged_weapon', 30, { hasLineOfSightToFrightenedSource: true });
    expect(attackMode.mode).toBe('disadvantage');

    // Moving from (5,5) to (6,6) is moving closer to (10,10) -> disallowed!
    expect(canFrightenedCreatureMove(hero, dragon.position, { x: 5, y: 5 }, { x: 6, y: 6 })).toBe(false);

    // Moving from (5,5) to (4,4) is moving further away -> allowed!
    expect(canFrightenedCreatureMove(hero, dragon.position, { x: 5, y: 5 }, { x: 4, y: 4 })).toBe(true);
  });

  it('6. grappled: speed is 0', () => {
    const creature = makeTestCombatant({ conditions: ['grappled'], speedFeet: 30 });
    expect(getConditionSpeed(creature)).toBe(0);
  });

  it('7. incapacitated: cannot take actions/reactions, drops concentration', () => {
    const caster = makeTestCombatant({
      conditions: [],
      concentratingOn: { sourceId: 'bless', targetEntityIds: [], remainingRounds: 5 },
    });

    const res = applyConditionToCombatant(caster, 'incapacitated');
    expect(res.concentrationBroken).toBe(true);
    expect(res.combatant.concentratingOn).toBeUndefined();
    expect(res.events.some((e) => e.type === 'CONCENTRATION_ENDED' && e.reason === 'incapacitated')).toBe(true);
  });

  it('8. invisible: advantage on attacks made, disadvantage on attacks against', () => {
    const invisibleAttacker = makeTestCombatant({ id: 'inv-1', conditions: ['invisible'] });
    const visibleTarget = makeTestCombatant({ id: 'vis-1' });

    expect(getConditionAttackRollMode(invisibleAttacker, visibleTarget, 'melee_weapon', 5).mode).toBe('advantage');
    expect(getConditionAttackRollMode(visibleTarget, invisibleAttacker, 'melee_weapon', 5).mode).toBe('disadvantage');
  });

  it('9. paralyzed: incapacitated, auto-fails STR/DEX saves, attacks against have advantage, melee within 5 ft auto-crits', () => {
    const victim = makeTestCombatant({ id: 'p1', conditions: ['paralyzed'] });
    const attacker = makeTestCombatant({ id: 'a1' });

    // Auto-fail STR and DEX saves
    expect(getConditionSavingThrowRollMode(victim, 'str').autoFail).toBe(true);
    expect(getConditionSavingThrowRollMode(victim, 'dex').autoFail).toBe(true);
    expect(getConditionSavingThrowRollMode(victim, 'con').autoFail).toBe(false);

    // Attack within 5 ft has advantage and auto-crit
    const attack5ft = getConditionAttackRollMode(attacker, victim, 'melee_weapon', 5);
    expect(attack5ft.mode).toBe('advantage');
    expect(attack5ft.isAutoCrit).toBe(true);

    // Attack from 20 ft has advantage but no auto-crit
    const attack20ft = getConditionAttackRollMode(attacker, victim, 'ranged_weapon', 20);
    expect(attack20ft.mode).toBe('advantage');
    expect(attack20ft.isAutoCrit).toBe(false);
  });

  it('10. petrified: resistance to all damage, immune to poison, auto-fails STR/DEX saves', () => {
    const victim = makeTestCombatant({ id: 'pet-1', conditions: ['petrified'], currentHp: 30, maxHp: 30 });
    const state: CombatState = {
      encounterId: 'enc-1',
      round: 1,
      phase: 'active_turn',
      initiativeOrder: [{ entityId: victim.id, initiative: 10, naturalRoll: 10, dexterityScore: 10, tieBreaker: 0 }],
      activeCombatantIndex: 0,
      activeCombatantId: victim.id,
      turnBudget: null,
      combatants: { [victim.id]: victim },
      surprisedCombatantIds: [],
      outcome: 'in_progress',
      rngState: 42,
    };

    // Slashing damage is halved (Resistance)
    const dmgSlash = applyDamage({
      state,
      targetId: victim.id,
      rawAmount: 20,
      damageType: 'slashing',
    });
    expect(dmgSlash.finalAmount).toBe(10);

    // Poison damage is negated (Immunity)
    const dmgPoison = applyDamage({
      state,
      targetId: victim.id,
      rawAmount: 20,
      damageType: 'poison',
    });
    expect(dmgPoison.finalAmount).toBe(0);

    // Cannot apply poisoned condition to petrified creature
    const poisonCondRes = applyConditionToCombatant(victim, 'poisoned');
    expect(poisonCondRes.applied).toBe(false);
  });

  it('11. poisoned: disadvantage on attacks and ability checks', () => {
    const poisoned = makeTestCombatant({ id: 'poi-1', conditions: ['poisoned'] });
    const target = makeTestCombatant({ id: 'tgt-1' });

    expect(getConditionAttackRollMode(poisoned, target, 'melee_weapon', 5).mode).toBe('disadvantage');
    expect(getConditionAbilityCheckRollMode(poisoned, 'str').mode).toBe('disadvantage');
  });

  it('12. prone: crawl 2x cost, disadvantage on attacks, advantage within 5 ft, disadvantage > 5 ft', () => {
    const proneCreature = makeTestCombatant({ id: 'pro-1', conditions: ['prone'] });
    const attacker = makeTestCombatant({ id: 'att-1' });

    // Prone creature has disadvantage on its attacks
    expect(getConditionAttackRollMode(proneCreature, attacker, 'melee_weapon', 5).mode).toBe('disadvantage');

    // Attack within 5 ft against prone creature has advantage
    expect(getConditionAttackRollMode(attacker, proneCreature, 'melee_weapon', 5).mode).toBe('advantage');

    // Attack from > 5 ft against prone creature has disadvantage
    expect(getConditionAttackRollMode(attacker, proneCreature, 'ranged_weapon', 30).mode).toBe('disadvantage');
  });

  it('13. restrained: speed 0, disadvantage on attacks made, advantage against, disadvantage on DEX saves', () => {
    const restrained = makeTestCombatant({ id: 'res-1', conditions: ['restrained'] });
    const attacker = makeTestCombatant({ id: 'att-1' });

    expect(getConditionSpeed(restrained)).toBe(0);
    expect(getConditionAttackRollMode(restrained, attacker, 'melee_weapon', 5).mode).toBe('disadvantage');
    expect(getConditionAttackRollMode(attacker, restrained, 'melee_weapon', 5).mode).toBe('advantage');
    expect(getConditionSavingThrowRollMode(restrained, 'dex').mode).toBe('disadvantage');
  });

  it('14. stunned: incapacitated, speed 0, auto-fails STR/DEX saves, attacks against have advantage', () => {
    const stunned = makeTestCombatant({ id: 'stu-1', conditions: ['stunned'] });
    const attacker = makeTestCombatant({ id: 'att-1' });

    expect(getConditionSpeed(stunned)).toBe(0);
    expect(getConditionSavingThrowRollMode(stunned, 'str').autoFail).toBe(true);
    expect(getConditionSavingThrowRollMode(stunned, 'dex').autoFail).toBe(true);
    expect(getConditionAttackRollMode(attacker, stunned, 'melee_weapon', 5).mode).toBe('advantage');
  });

  it('15. unconscious: incapacitated, speed 0, prone, auto-fails STR/DEX saves, attacks within 5 ft auto-crit', () => {
    const unconscious = makeTestCombatant({ id: 'unc-1', conditions: ['unconscious'] });
    const attacker = makeTestCombatant({ id: 'att-1' });

    expect(getConditionSpeed(unconscious)).toBe(0);
    expect(getConditionSavingThrowRollMode(unconscious, 'str').autoFail).toBe(true);
    expect(getConditionSavingThrowRollMode(unconscious, 'dex').autoFail).toBe(true);

    const hit5ft = getConditionAttackRollMode(attacker, unconscious, 'melee_weapon', 5);
    expect(hit5ft.mode).toBe('advantage');
    expect(hit5ft.isAutoCrit).toBe(true);
  });

  it('respects condition immunities', () => {
    const golem = makeTestCombatant({
      id: 'golem-1',
      name: 'Iron Golem',
      conditionImmunities: ['charmed', 'paralyzed', 'poisoned'],
    });

    const res1 = applyConditionToCombatant(golem, 'charmed');
    expect(res1.applied).toBe(false);
    expect(res1.combatant.conditions.includes('charmed')).toBe(false);

    const res2 = applyConditionToCombatant(golem, 'poisoned');
    expect(res2.applied).toBe(false);
    expect(res2.combatant.conditions.includes('poisoned')).toBe(false);
  });

  it('resolves repeat saving throw at end of turn and removes condition on success', () => {
    const hero = makeTestCombatant({
      id: 'hero-1',
      conditions: ['restrained'],
      activeConditions: [
        {
          conditionId: 'restrained',
          sourceName: 'Web',
          repeatSaveAtTurnEnd: {
            ability: 'dex',
            dc: 5, // very easy DC to pass
          },
        },
      ],
    });

    const state: CombatState = {
      encounterId: 'enc-1',
      round: 1,
      phase: 'active_turn',
      initiativeOrder: [{ entityId: hero.id, initiative: 15, naturalRoll: 10, dexterityScore: 14, tieBreaker: 0 }],
      activeCombatantIndex: 0,
      activeCombatantId: hero.id,
      turnBudget: null,
      combatants: { [hero.id]: hero },
      surprisedCombatantIds: [],
      outcome: 'in_progress',
      rngState: 999,
    };

    const res = resolveConditionTurnEndSaves(state, hero.id);
    const updatedHero = res.state.combatants[hero.id]!;
    expect(updatedHero.conditions.includes('restrained')).toBe(false);
    expect(res.events.some((e) => e.type === 'CONDITION_REMOVED' && e.conditionId === 'restrained')).toBe(true);
  });
});
