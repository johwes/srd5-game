import { describe, expect, it } from 'vitest';
import { compendium, requirePregenCharacter } from '@srd5/data';
import { computeDerivedCharacter } from '../character/derived.js';
import { createTacticalGrid, setGridCell, setGridCells } from '../grid/model.js';
import {
  createCharacterCombatant,
  createMonsterCombatant,
  createTurnBudget,
  startCombatEncounter,
  type Combatant,
  type CombatState,
} from '../combat/index.js';
import {
  executeGrapple,
  executeShove,
  executeTwoWeaponFightingAttack,
  executeUnarmedStrike,
  executeWeaponAttack,
  getCombatantAcrobaticsBonus,
  getCombatantAthleticsBonus,
} from '../combat/attack.js';

function createMockEncounter(customAttacker?: Partial<Combatant>, customTarget?: Partial<Combatant>) {
  const fighterSheet = computeDerivedCharacter(requirePregenCharacter('pregen-fighter'), compendium);
  const goblinData = compendium.requireMonster('goblin');

  const fighter = createCharacterCombatant(fighterSheet, { x: 1, y: 1 });
  const goblin = createMonsterCombatant(goblinData, 'goblin-1', { x: 2, y: 1 });

  const mergedAttacker = { ...fighter, ...customAttacker };
  const mergedTarget = { ...goblin, ...customTarget };

  const startRes = startCombatEncounter({
    encounterId: 'test-encounter',
    combatants: [mergedAttacker, mergedTarget],
    rngState: 42,
  });

  const turnBudget = createTurnBudget(mergedAttacker, false);

  // Ensure active turn is attacker
  return {
    ...startRes.state,
    activeCombatantId: mergedAttacker.id,
    turnBudget,
    combatants: {
      [mergedAttacker.id]: mergedAttacker,
      [mergedTarget.id]: mergedTarget,
    },
  };
}

describe('SRD-305: Weapon Attack Resolution', () => {
  it('throws when melee target is beyond reach', () => {
    const state = createMockEncounter(
      { position: { x: 0, y: 0 } },
      { position: { x: 3, y: 0 } }, // 15 ft away
    );

    expect(() =>
      executeWeaponAttack({
        state,
        attackerId: 'pregen-fighter',
        targetId: 'goblin-1',
      }),
    ).toThrow(/out of melee reach/i);
  });

  it('resolves a melee attack hit, deals damage, and consumes action economy', () => {
    const state = createMockEncounter(
      { position: { x: 1, y: 1 } },
      { position: { x: 2, y: 1 } }, // 5 ft away
    );

    const initialTargetHp = state.combatants['goblin-1']!.currentHp;
    expect(state.turnBudget?.action).toBe(1);
    expect(state.turnBudget?.attackActionTaken).toBe(false);

    // Use custom high to-hit to guarantee hit
    const res = executeWeaponAttack({
      state,
      attackerId: 'pregen-fighter',
      targetId: 'goblin-1',
      customAttack: {
        name: 'Greatsword',
        attackType: 'melee_weapon',
        toHitBonus: 20,
        damageDice: '2d6',
        damageBonus: 3,
        damageType: 'slashing',
        reachFeet: 5,
      },
    });

    expect(res.outcome).toBe('hit');
    expect(res.damageDealt).toBeGreaterThan(0);
    expect(res.state.combatants['goblin-1']!.currentHp).toBe(
      Math.max(0, initialTargetHp - res.damageDealt!),
    );
    expect(res.state.turnBudget?.action).toBe(0);
    expect(res.state.turnBudget?.attackActionTaken).toBe(true);

    const attackEvent = res.events.find((e) => e.type === 'ATTACK_RESOLVED');
    expect(attackEvent).toBeDefined();
    if (attackEvent && attackEvent.type === 'ATTACK_RESOLVED') {
      expect(attackEvent.outcome).toBe('hit');
      expect(attackEvent.damage?.total).toBe(res.damageDealt);
    }
  });

  it('resolves a melee attack miss when total to hit is below target AC', () => {
    const state = createMockEncounter(
      { position: { x: 1, y: 1 } },
      { position: { x: 2, y: 1 } },
    );

    const initialTargetHp = state.combatants['goblin-1']!.currentHp;

    const res = executeWeaponAttack({
      state,
      attackerId: 'pregen-fighter',
      targetId: 'goblin-1',
      customAttack: {
        name: 'Dagger',
        attackType: 'melee_weapon',
        toHitBonus: -15, // guaranteed miss against AC 15
        damageDice: '1d4',
        damageBonus: 0,
        damageType: 'piercing',
        reachFeet: 5,
      },
    });

    expect(res.outcome).toBe('miss');
    expect(res.damageDealt).toBeUndefined();
    expect(res.state.combatants['goblin-1']!.currentHp).toBe(initialTargetHp);

    const attackEvent = res.events.find((e) => e.type === 'ATTACK_RESOLVED');
    expect(attackEvent).toBeDefined();
    if (attackEvent && attackEvent.type === 'ATTACK_RESOLVED') {
      expect(attackEvent.outcome).toBe('miss');
      expect(attackEvent.damage).toBeUndefined();
    }
  });

  it('doubles damage dice on a Critical Hit (natural 20)', () => {
    const state = createMockEncounter(
      { position: { x: 1, y: 1 } },
      { position: { x: 2, y: 1 } },
    );

    // Find a seed that produces natural 20
    let critSeed = 0;
    for (let s = 1; s < 500; s++) {
      const testState = { ...state, rngState: s };
      try {
        const r = executeWeaponAttack({
          state: testState,
          attackerId: 'pregen-fighter',
          targetId: 'goblin-1',
          customAttack: {
            name: 'Greatsword',
            attackType: 'melee_weapon',
            toHitBonus: 5,
            damageDice: '2d6',
            damageBonus: 3,
            damageType: 'slashing',
            reachFeet: 5,
          },
        });
        if (r.attackRollRecord.naturalRoll === 20) {
          critSeed = s;
          break;
        }
      } catch {
        // continue
      }
    }

    expect(critSeed).toBeGreaterThan(0);

    const critRes = executeWeaponAttack({
      state: { ...state, rngState: critSeed },
      attackerId: 'pregen-fighter',
      targetId: 'goblin-1',
      customAttack: {
        name: 'Greatsword',
        attackType: 'melee_weapon',
        toHitBonus: 5,
        damageDice: '2d6',
        damageBonus: 3,
        damageType: 'slashing',
        reachFeet: 5,
      },
    });

    expect(critRes.outcome).toBe('critical_hit');
    expect(critRes.damageRollRecord).toBeDefined();
    // 2d6 doubled on crit -> 4d6 (4 dice kept)
    expect(critRes.damageRollRecord!.kept.length).toBe(4);
  });

  it('supports expanded critical hit ranges (e.g. Champion 19-20)', () => {
    const state = createMockEncounter(
      { position: { x: 1, y: 1 } },
      { position: { x: 2, y: 1 } },
    );

    let roll19Seed = 0;
    for (let s = 1; s < 500; s++) {
      const testState = { ...state, rngState: s };
      const r = executeWeaponAttack({
        state: testState,
        attackerId: 'pregen-fighter',
        targetId: 'goblin-1',
        customAttack: {
          name: 'Champion Sword',
          attackType: 'melee_weapon',
          toHitBonus: 5,
          damageDice: '1d8',
          damageBonus: 3,
          damageType: 'slashing',
          reachFeet: 5,
          critRange: 19,
        },
      });
      if (r.attackRollRecord.naturalRoll === 19) {
        roll19Seed = s;
        break;
      }
    }

    expect(roll19Seed).toBeGreaterThan(0);

    const res = executeWeaponAttack({
      state: { ...state, rngState: roll19Seed },
      attackerId: 'pregen-fighter',
      targetId: 'goblin-1',
      customAttack: {
        name: 'Champion Sword',
        attackType: 'melee_weapon',
        toHitBonus: 5,
        damageDice: '1d8',
        damageBonus: 3,
        damageType: 'slashing',
        reachFeet: 5,
        critRange: 19,
      },
    });

    expect(res.outcome).toBe('critical_hit');
    expect(res.attackRollRecord.naturalRoll).toBe(19);
  });

  it('rerolls 1s and 2s on damage dice for Great Weapon Fighting', () => {
    const state = createMockEncounter(
      { position: { x: 1, y: 1 } },
      { position: { x: 2, y: 1 } },
    );

    const res = executeWeaponAttack({
      state,
      attackerId: 'pregen-fighter',
      targetId: 'goblin-1',
      customAttack: {
        name: 'Maul',
        attackType: 'melee_weapon',
        toHitBonus: 20,
        damageDice: '2d6',
        damageBonus: 3,
        damageType: 'bludgeoning',
        reachFeet: 5,
        properties: ['two-handed'],
      },
      greatWeaponFighting: true,
    });

    expect(res.damageRollRecord).toBeDefined();
    // Verify dice were evaluated
    expect(res.damageRollRecord!.kept.length).toBe(2);
  });

  it('adds extra weapon die for Half-Orc Savage Attacks on critical hit', () => {
    const state = createMockEncounter(
      { position: { x: 1, y: 1 } },
      { position: { x: 2, y: 1 } },
    );

    const res = executeWeaponAttack({
      state,
      attackerId: 'pregen-fighter',
      targetId: 'goblin-1',
      customAttack: {
        name: 'Greataxe',
        attackType: 'melee_weapon',
        toHitBonus: 20,
        damageDice: '1d12',
        damageBonus: 3,
        damageType: 'slashing',
        reachFeet: 5,
        critRange: 1, // force crit
      },
      extraCritDice: 1,
    });

    expect(res.outcome).toBe('critical_hit');
    // 1d12 doubled on crit (2d12) + 1 extra Savage Attacks die = 3d12
    expect(res.damageRollRecord!.kept.length).toBe(3);
  });
});

describe('SRD-305: Ranged Attacks, Ranges & Close Combat Disadvantage', () => {
  it('throws when target is beyond maximum long range', () => {
    const state = createMockEncounter(
      { position: { x: 0, y: 0 } },
      { position: { x: 70, y: 0 } }, // 350 ft > 320 ft max range
    );

    expect(() =>
      executeWeaponAttack({
        state,
        attackerId: 'pregen-fighter',
        targetId: 'goblin-1',
        customAttack: {
          name: 'Shortbow',
          attackType: 'ranged_weapon',
          toHitBonus: 5,
          damageDice: '1d6',
          damageBonus: 3,
          damageType: 'piercing',
          rangeFeet: { normal: 80, long: 320 },
        },
      }),
    ).toThrow(/beyond maximum range/i);
  });

  it('imposes Disadvantage at long range (between normal and long)', () => {
    const state = createMockEncounter(
      { position: { x: 0, y: 0 } },
      { position: { x: 20, y: 0 } }, // 100 ft (80 < 100 <= 320)
    );

    const res = executeWeaponAttack({
      state,
      attackerId: 'pregen-fighter',
      targetId: 'goblin-1',
      customAttack: {
        name: 'Shortbow',
        attackType: 'ranged_weapon',
        toHitBonus: 5,
        damageDice: '1d6',
        damageBonus: 3,
        damageType: 'piercing',
        rangeFeet: { normal: 80, long: 320 },
      },
    });

    expect(res.rollMode).toBe('disadvantage');
    expect(res.disadvantageSources.some((s) => s.includes('Long range'))).toBe(true);
  });

  it('imposes Disadvantage on ranged attacks when a hostile creature is within 5 ft', () => {
    const state = createMockEncounter(
      { position: { x: 1, y: 1 } },
      { position: { x: 10, y: 1 } }, // target is 45 ft away
    );

    // Place an adjacent hostile monster right next to attacker (5 ft away)
    const goblinData = compendium.requireMonster('goblin');
    const adjacentMonster = createMonsterCombatant(goblinData, 'adjacent-goblin', { x: 2, y: 1 });
    const stateWithAdjacent = {
      ...state,
      combatants: {
        ...state.combatants,
        'adjacent-goblin': adjacentMonster,
      },
    };

    const res = executeWeaponAttack({
      state: stateWithAdjacent,
      attackerId: 'pregen-fighter',
      targetId: 'goblin-1',
      customAttack: {
        name: 'Light Crossbow',
        attackType: 'ranged_weapon',
        toHitBonus: 5,
        damageDice: '1d8',
        damageBonus: 2,
        damageType: 'piercing',
        rangeFeet: { normal: 80, long: 320 },
      },
    });

    expect(res.rollMode).toBe('disadvantage');
    expect(res.disadvantageSources.some((s) => s.includes('within 5 ft of ranged attacker'))).toBe(
      true,
    );
  });
});

describe('SRD-305: Tactical Grid LoS & Cover', () => {
  it('prevents targeting creatures behind total cover', () => {
    let grid = createTacticalGrid(10, 10);
    // Place a full wall column between x=1 and x=3
    grid = setGridCells(
      grid,
      Array.from({ length: 10 }, (_, y) => ({ x: 2, y, terrain: 'wall_solid' as const })),
    );

    const state = createMockEncounter(
      { position: { x: 0, y: 5 } },
      { position: { x: 4, y: 5 } },
    );

    expect(() =>
      executeWeaponAttack({
        state,
        attackerId: 'pregen-fighter',
        targetId: 'goblin-1',
        grid,
        customAttack: {
          name: 'Shortbow',
          attackType: 'ranged_weapon',
          toHitBonus: 5,
          damageDice: '1d6',
          damageBonus: 2,
          damageType: 'piercing',
          rangeFeet: { normal: 80, long: 320 },
        },
      }),
    ).toThrow(/total cover/i);
  });

  it('adds +2 AC for half cover from an intervening creature', () => {
    const grid = createTacticalGrid(10, 10);
    const state = createMockEncounter(
      { position: { x: 0, y: 0 } },
      { position: { x: 4, y: 0 } },
    );

    // Place an intervening creature at (2, 0)
    const goblinData = compendium.requireMonster('goblin');
    const intervening = createMonsterCombatant(goblinData, 'intervening', { x: 2, y: 0 });
    const stateWithIntervening = {
      ...state,
      combatants: {
        ...state.combatants,
        intervening,
      },
    };

    const res = executeWeaponAttack({
      state: stateWithIntervening,
      attackerId: 'pregen-fighter',
      targetId: 'goblin-1',
      grid,
      customAttack: {
        name: 'Shortbow',
        attackType: 'ranged_weapon',
        toHitBonus: 5,
        damageDice: '1d6',
        damageBonus: 2,
        damageType: 'piercing',
        rangeFeet: { normal: 80, long: 320 },
      },
    });

    expect(res.cover).toBe('half');
    // Goblin base AC 15 + 2 (half cover) = 17
    expect(res.targetEffectiveAc).toBe(17);
  });
});

describe('SRD-305: Advantage / Disadvantage Tactical Matrix', () => {
  it('grants Advantage on melee attacks against a prone target within 5 ft', () => {
    const state = createMockEncounter(
      { position: { x: 1, y: 1 } },
      { position: { x: 2, y: 1 }, conditions: ['prone'] },
    );

    const res = executeWeaponAttack({
      state,
      attackerId: 'pregen-fighter',
      targetId: 'goblin-1',
      customAttack: {
        name: 'Longsword',
        attackType: 'melee_weapon',
        toHitBonus: 5,
        damageDice: '1d8',
        damageBonus: 3,
        damageType: 'slashing',
        reachFeet: 5,
      },
    });

    expect(res.rollMode).toBe('advantage');
    expect(res.advantageSources.some((s) => s.includes('prone within 5 ft'))).toBe(true);
  });

  it('imposes Disadvantage on attacks against a prone target beyond 5 ft', () => {
    const state = createMockEncounter(
      { position: { x: 0, y: 0 } },
      { position: { x: 4, y: 0 }, conditions: ['prone'] }, // 20 ft
    );

    const res = executeWeaponAttack({
      state,
      attackerId: 'pregen-fighter',
      targetId: 'goblin-1',
      customAttack: {
        name: 'Longbow',
        attackType: 'ranged_weapon',
        toHitBonus: 5,
        damageDice: '1d8',
        damageBonus: 3,
        damageType: 'piercing',
        rangeFeet: { normal: 150, long: 600 },
      },
    });

    expect(res.rollMode).toBe('disadvantage');
    expect(res.disadvantageSources.some((s) => s.includes('prone beyond 5 ft'))).toBe(true);
  });

  it('imposes Disadvantage against a dodging target', () => {
    const state = createMockEncounter(
      { position: { x: 1, y: 1 } },
      { position: { x: 2, y: 1 }, isDodging: true },
    );

    const res = executeWeaponAttack({
      state,
      attackerId: 'pregen-fighter',
      targetId: 'goblin-1',
    });

    expect(res.rollMode).toBe('disadvantage');
    expect(res.disadvantageSources.some((s) => s.includes('Target is dodging'))).toBe(true);
  });

  it('cancels out Advantage and Disadvantage to normal roll mode', () => {
    const state = createMockEncounter(
      { position: { x: 1, y: 1 }, conditions: ['poisoned'] }, // Disadvantage
      { position: { x: 2, y: 1 }, conditions: ['prone'] }, // Advantage within 5 ft
    );

    const res = executeWeaponAttack({
      state,
      attackerId: 'pregen-fighter',
      targetId: 'goblin-1',
    });

    expect(res.rollMode).toBe('normal');
    expect(res.advantageSources.length).toBeGreaterThan(0);
    expect(res.disadvantageSources.length).toBeGreaterThan(0);
  });

  it('elevates a hit within 5 ft to automatic Critical Hit against paralyzed or unconscious targets', () => {
    const state = createMockEncounter(
      { position: { x: 1, y: 1 } },
      { position: { x: 2, y: 1 }, conditions: ['paralyzed'] },
    );

    // Guaranteed hit (toHit 20) with critRange 20
    const res = executeWeaponAttack({
      state,
      attackerId: 'pregen-fighter',
      targetId: 'goblin-1',
      customAttack: {
        name: 'Dagger',
        attackType: 'melee_weapon',
        toHitBonus: 20,
        damageDice: '1d4',
        damageBonus: 2,
        damageType: 'piercing',
        reachFeet: 5,
        critRange: 20,
      },
    });

    expect(res.outcome).toBe('critical_hit');
    // Damage dice doubled on auto-crit: 1d4 -> 2d4
    expect(res.damageRollRecord!.kept.length).toBe(2);
  });
});

describe('SRD-305: Two-Weapon Fighting & Extra Attacks', () => {
  it('throws when attempting off-hand bonus attack before taking the Attack action', () => {
    const state = createMockEncounter(
      { position: { x: 1, y: 1 } },
      { position: { x: 2, y: 1 } },
    );

    expect(state.turnBudget?.attackActionTaken).toBe(false);

    expect(() =>
      executeTwoWeaponFightingAttack(state, 'pregen-fighter', 'goblin-1'),
    ).toThrow(/requires taking the Attack action first/i);
  });

  it('executes off-hand bonus attack after Attack action, deducting 1 bonus action', () => {
    const state = createMockEncounter(
      { position: { x: 1, y: 1 } },
      { position: { x: 2, y: 1 } },
    );

    // 1. Take main Attack action
    const attack1 = executeWeaponAttack({
      state,
      attackerId: 'pregen-fighter',
      targetId: 'goblin-1',
    });
    expect(attack1.state.turnBudget?.action).toBe(0);
    expect(attack1.state.turnBudget?.bonusAction).toBe(1);
    expect(attack1.state.turnBudget?.attackActionTaken).toBe(true);

    // 2. Take off-hand bonus attack
    const attack2 = executeTwoWeaponFightingAttack(
      attack1.state,
      'pregen-fighter',
      'goblin-1',
      {
        customAttack: {
          name: 'Off-hand Shortsword',
          attackType: 'melee_weapon',
          toHitBonus: 5,
          damageDice: '1d6',
          damageBonus: 0, // no ability modifier to off-hand damage
          damageType: 'piercing',
          reachFeet: 5,
          isOffHand: true,
        },
      },
    );

    expect(attack2.state.turnBudget?.bonusAction).toBe(0);
  });

  it('handles Extra Attack (multiple attacks per Attack action)', () => {
    const state = createMockEncounter(
      { position: { x: 1, y: 1 }, attacksPerAction: 2 },
      { position: { x: 2, y: 1 } },
    );

    // First attack: consumes action, sets extraAttacksRemaining = 1
    const res1 = executeWeaponAttack({
      state,
      attackerId: 'pregen-fighter',
      targetId: 'goblin-1',
    });
    expect(res1.state.turnBudget?.action).toBe(0);
    expect(res1.state.turnBudget?.extraAttacksRemaining).toBe(1);

    // Second attack: consumes extraAttacksRemaining, action remains 0
    const res2 = executeWeaponAttack({
      state: res1.state,
      attackerId: 'pregen-fighter',
      targetId: 'goblin-1',
    });
    expect(res2.state.turnBudget?.action).toBe(0);
    expect(res2.state.turnBudget?.extraAttacksRemaining).toBe(0);

    // Third attack: throws error because budget is exhausted
    expect(() =>
      executeWeaponAttack({
        state: res2.state,
        attackerId: 'pregen-fighter',
        targetId: 'goblin-1',
      }),
    ).toThrow(/No actions remaining/i);
  });
});

describe('SRD-305: Unarmed Strike', () => {
  it('executes an unarmed strike dealing 1 + STR damage', () => {
    const state = createMockEncounter(
      { position: { x: 1, y: 1 } },
      { position: { x: 2, y: 1 } },
    );

    const res = executeUnarmedStrike(state, 'pregen-fighter', 'goblin-1', {
      customAttack: {
        name: 'Unarmed Strike',
        attackType: 'melee_weapon',
        toHitBonus: 20, // guaranteed hit
        damageDice: '1',
        damageBonus: 3,
        damageType: 'bludgeoning',
        reachFeet: 5,
      },
    });

    expect(res.outcome).toBe('hit');
    expect(res.damageDealt).toBe(4); // 1 + 3 STR
  });
});

describe('SRD-305: Grapple Resolution', () => {
  it('throws when grapple target is out of melee reach (> 5 ft)', () => {
    const state = createMockEncounter(
      { position: { x: 0, y: 0 } },
      { position: { x: 2, y: 0 } }, // 10 ft away
    );

    expect(() =>
      executeGrapple({
        state,
        attackerId: 'pregen-fighter',
        targetId: 'goblin-1',
      }),
    ).toThrow(/out of melee reach/i);
  });

  it('throws when grapple target is more than one size category larger', () => {
    const state = createMockEncounter(
      { position: { x: 1, y: 1 }, size: 'medium' },
      { position: { x: 2, y: 1 }, size: 'huge' }, // Medium -> Large -> Huge (2 sizes larger)
    );

    expect(() =>
      executeGrapple({
        state,
        attackerId: 'pregen-fighter',
        targetId: 'goblin-1',
      }),
    ).toThrow(/too large to grapple/i);
  });

  it('applies grappled condition when attacker wins Athletics contest', () => {
    const state = createMockEncounter(
      { position: { x: 1, y: 1 } },
      { position: { x: 2, y: 1 } },
    );

    // Run grapple with a seed where attacker rolls higher
    let winSeed = 0;
    for (let s = 1; s < 50; s++) {
      const res = executeGrapple({
        state: { ...state, rngState: s },
        attackerId: 'pregen-fighter',
        targetId: 'goblin-1',
      });
      if (res.success) {
        winSeed = s;
        break;
      }
    }

    expect(winSeed).toBeGreaterThan(0);

    const res = executeGrapple({
      state: { ...state, rngState: winSeed },
      attackerId: 'pregen-fighter',
      targetId: 'goblin-1',
    });

    expect(res.success).toBe(true);
    expect(res.attackerAthleticsTotal).toBeGreaterThan(res.targetContestTotal);
    expect(res.state.combatants['goblin-1']!.conditions).toContain('grappled');

    const grappleEvent = res.events.find((e) => e.type === 'GRAPPLE_RESOLVED');
    expect(grappleEvent).toBeDefined();
    expect(res.events.some((e) => e.type === 'CONDITION_ADDED' && e.conditionId === 'grappled')).toBe(
      true,
    );
  });

  it('does not apply grappled condition on contest tie or loss', () => {
    const state = createMockEncounter(
      { position: { x: 1, y: 1 } },
      { position: { x: 2, y: 1 } },
    );

    let failSeed = 0;
    for (let s = 1; s < 50; s++) {
      const res = executeGrapple({
        state: { ...state, rngState: s },
        attackerId: 'pregen-fighter',
        targetId: 'goblin-1',
      });
      if (!res.success) {
        failSeed = s;
        break;
      }
    }

    expect(failSeed).toBeGreaterThan(0);

    const res = executeGrapple({
      state: { ...state, rngState: failSeed },
      attackerId: 'pregen-fighter',
      targetId: 'goblin-1',
    });

    expect(res.success).toBe(false);
    expect(res.attackerAthleticsTotal).toBeLessThanOrEqual(res.targetContestTotal);
    expect(res.state.combatants['goblin-1']!.conditions).not.toContain('grappled');
  });
});

describe('SRD-305: Shove Resolution', () => {
  it('knocks target prone when shove knock_prone succeeds', () => {
    const state = createMockEncounter(
      { position: { x: 1, y: 1 } },
      { position: { x: 2, y: 1 } },
    );

    let winSeed = 0;
    for (let s = 1; s < 50; s++) {
      const res = executeShove({
        state: { ...state, rngState: s },
        attackerId: 'pregen-fighter',
        targetId: 'goblin-1',
        shoveType: 'knock_prone',
      });
      if (res.success) {
        winSeed = s;
        break;
      }
    }

    expect(winSeed).toBeGreaterThan(0);

    const res = executeShove({
      state: { ...state, rngState: winSeed },
      attackerId: 'pregen-fighter',
      targetId: 'goblin-1',
      shoveType: 'knock_prone',
    });

    expect(res.success).toBe(true);
    expect(res.state.combatants['goblin-1']!.conditions).toContain('prone');
    expect(res.events.some((e) => e.type === 'CONDITION_ADDED' && e.conditionId === 'prone')).toBe(
      true,
    );
  });

  it('pushes target 5 feet away on shove push_away', () => {
    const grid = createTacticalGrid(10, 10);
    const state = createMockEncounter(
      { position: { x: 1, y: 1 } },
      { position: { x: 2, y: 1 } },
    );

    let winSeed = 0;
    for (let s = 1; s < 50; s++) {
      const res = executeShove({
        state: { ...state, rngState: s },
        attackerId: 'pregen-fighter',
        targetId: 'goblin-1',
        shoveType: 'push_away',
        grid,
      });
      if (res.success) {
        winSeed = s;
        break;
      }
    }

    expect(winSeed).toBeGreaterThan(0);

    const res = executeShove({
      state: { ...state, rngState: winSeed },
      attackerId: 'pregen-fighter',
      targetId: 'goblin-1',
      shoveType: 'push_away',
      grid,
    });

    expect(res.success).toBe(true);
    // Attacker at (1, 1), target at (2, 1) -> pushed to (3, 1)
    expect(res.destination).toEqual({ x: 3, y: 1 });
    expect(res.state.combatants['goblin-1']!.position).toEqual({ x: 3, y: 1 });

    const moveEvent = res.events.find((e) => e.type === 'ENTITY_MOVED');
    expect(moveEvent).toBeDefined();
    if (moveEvent && moveEvent.type === 'ENTITY_MOVED') {
      expect(moveEvent.mode).toBe('forced');
      expect(moveEvent.path).toEqual([{ x: 3, y: 1 }]);
    }
  });

  it('prevents pushing target into a solid wall or occupied cell', () => {
    let grid = createTacticalGrid(10, 10);
    // Place wall at destination (3, 1)
    grid = setGridCell(grid, { x: 3, y: 1, terrain: 'wall_solid', blocksMovement: true });

    const state = createMockEncounter(
      { position: { x: 1, y: 1 } },
      { position: { x: 2, y: 1 } },
    );

    let winSeed = 0;
    for (let s = 1; s < 50; s++) {
      const res = executeShove({
        state: { ...state, rngState: s },
        attackerId: 'pregen-fighter',
        targetId: 'goblin-1',
        shoveType: 'push_away',
        grid,
      });
      if (res.success) {
        winSeed = s;
        break;
      }
    }

    const res = executeShove({
      state: { ...state, rngState: winSeed },
      attackerId: 'pregen-fighter',
      targetId: 'goblin-1',
      shoveType: 'push_away',
      grid,
    });

    expect(res.success).toBe(true);
    // Wall blocks movement, target stays at (2, 1)
    expect(res.destination).toBeUndefined();
    expect(res.state.combatants['goblin-1']!.position).toEqual({ x: 2, y: 1 });
  });
});

describe('SRD-305: Seeded PRNG Determinism', () => {
  it('produces identical attack rolls, damage, and state given the same rngState', () => {
    const state = createMockEncounter(
      { position: { x: 1, y: 1 } },
      { position: { x: 2, y: 1 } },
    );

    const seed = 98765;
    const resA = executeWeaponAttack({
      state: { ...state, rngState: seed },
      attackerId: 'pregen-fighter',
      targetId: 'goblin-1',
    });

    const resB = executeWeaponAttack({
      state: { ...state, rngState: seed },
      attackerId: 'pregen-fighter',
      targetId: 'goblin-1',
    });

    expect(resA.attackRollRecord).toEqual(resB.attackRollRecord);
    expect(resA.damageRollRecord).toEqual(resB.damageRollRecord);
    expect(resA.damageDealt).toBe(resB.damageDealt);
    expect(resA.outcome).toBe(resB.outcome);
    expect(resA.state.rngState).toBe(resB.state.rngState);
  });
});

describe('SRD 5.1 Rogue Sneak Attack', () => {
  it('adds Sneak Attack dice on a ranged/finesse hit when an ally is within 5 ft of the target, once per turn', () => {
    const rogueBuild = requirePregenCharacter('pregen-rogue');
    const rogueSheet = computeDerivedCharacter(rogueBuild, compendium);
    const rogue = createCharacterCombatant(rogueSheet, { x: 1, y: 1 }, { side: 'party', buildState: rogueBuild });

    const fighterBuild = requirePregenCharacter('pregen-fighter');
    const fighterSheet = computeDerivedCharacter(fighterBuild, compendium);
    // Fighter stands adjacent (5 ft) to the goblin at (5, 1)
    const fighter = createCharacterCombatant(fighterSheet, { x: 4, y: 1 }, { side: 'party', buildState: fighterBuild });

    const goblinData = compendium.getMonster('goblin')!;
    const goblin = createMonsterCombatant(goblinData, 'goblin-1', { x: 5, y: 1 }, { side: 'monster' });
    goblin.maxHp = 50;
    goblin.currentHp = 50;

    const started = startCombatEncounter({
      encounterId: 'sneak-test',
      combatants: [rogue, fighter, goblin],
      rngState: 42,
    }).state;
    const baseState: CombatState = {
      ...started,
      activeCombatantId: rogue.id,
      turnBudget: createTurnBudget(rogue),
    };

    const res = executeWeaponAttack({
      state: baseState,
      attackerId: rogue.id,
      targetId: goblin.id,
      customAttack: {
        name: 'Shortbow',
        attackType: 'ranged_weapon',
        toHitBonus: 20, // guaranteed hit
        damageDice: '1d6',
        damageBonus: 3,
        damageType: 'piercing',
        reachFeet: 5,
        rangeFeet: { normal: 80, long: 320 },
      },
    });

    expect(res.outcome === 'hit' || res.outcome === 'critical_hit').toBe(true);
    const sneakRoll = res.events.find(
      (e) => e.type === 'DICE_ROLLED' && e.rollPurpose === 'sneak_attack_damage',
    );
    expect(sneakRoll).toBeDefined();
    expect(res.state.turnBudget?.sneakAttackUsedThisTurn).toBe(true);

    // Second attack on the same turn must NOT trigger Sneak Attack again
    const secondRes = executeWeaponAttack({
      state: {
        ...res.state,
        turnBudget: { ...res.state.turnBudget!, action: 1 },
      },
      attackerId: rogue.id,
      targetId: goblin.id,
      customAttack: {
        name: 'Shortbow',
        attackType: 'ranged_weapon',
        toHitBonus: 20,
        damageDice: '1d6',
        damageBonus: 3,
        damageType: 'piercing',
        reachFeet: 5,
        rangeFeet: { normal: 80, long: 320 },
      },
    });
    expect(
      secondRes.events.some(
        (e) => e.type === 'DICE_ROLLED' && e.rollPurpose === 'sneak_attack_damage',
      ),
    ).toBe(false);
  });
});
