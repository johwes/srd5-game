import { describe, expect, it } from 'vitest';
import type {
  ActivatedAbilitySpec,
  EffectStepSpec,
  SpellData,
  SummonStatblockSpec,
} from '@srd5/data';
import { getFootprintDistanceFeet } from '../grid/footprints.js';
import {
  breakConcentration,
  createTurnBudget,
  executeMoveCombatant,
  executeSpellCast,
  startCombatEncounter,
  startTurn,
  type CombatEvent,
  type CombatState,
  type Combatant,
} from '../combat/index.js';
import {
  controlsSummon,
  dismissSummon,
  executeSummonAction,
  isSummonTargetable,
} from '../combat/summon.js';
import { reduceGame, createInitialGameState } from '../state/reducer.js';
import { createTacticalGrid } from '../grid/model.js';

/** Minimal Combatant fixture with deterministic defaults. */
function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id,
    name: id,
    side: 'party',
    teamId: 'party',
    size: 'medium',
    position: { x: 2, y: 2 },
    speedFeet: 30,
    currentHp: 40,
    maxHp: 40,
    tempHp: 0,
    armorClass: 12,
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
  } as Combatant;
}

function makeState(combatants: Combatant[], activeId = combatants[0]!.id): CombatState {
  const started = startCombatEncounter({
    encounterId: 'summon-test',
    combatants,
    rngState: 987654,
  });
  const active = combatants.find((c) => c.id === activeId) ?? combatants[0]!;
  return {
    ...started.state,
    activeCombatantId: active.id,
    activeCombatantIndex: started.state.initiativeOrder.findIndex((e) => e.entityId === active.id),
    turnBudget: createTurnBudget(active, false),
  };
}

function summonStep(
  summonId: string,
  statblock: SummonStatblockSpec,
  overrides: Partial<Extract<EffectStepSpec, { step: 'summon_creature' }>> = {},
): Extract<EffectStepSpec, { step: 'summon_creature' }> {
  return {
    step: 'summon_creature',
    summonId,
    name: summonId,
    durationRounds: 10,
    requiresConcentration: false,
    placement: 'unoccupied_within_range',
    statblock,
    control: 'commanded',
    ...overrides,
  };
}

function summonSpell(step: Extract<EffectStepSpec, { step: 'summon_creature' }>, id = `${step.summonId}-spell`): SpellData {
  return {
    id,
    name: id,
    level: 4,
    school: 'conjuration',
    castingTime: 'action',
    ritual: false,
    concentration: step.requiresConcentration,
    duration: { type: 'rounds', rounds: step.durationRounds },
    components: { verbal: true, somatic: true, material: false },
    classes: ['wizard'],
    targeting: { type: 'self', rangeFeet: 0 },
    effects: [step],
    description: `Test summon for ${step.summonId}`,
  };
}

const houndStatblock: SummonStatblockSpec = {
  size: 'medium',
  untargetable: true,
  speedFeet: 40,
  actions: [
    {
      id: 'bite',
      name: 'Bite',
      description: '+spell attack, 4d8 force',
      actionCost: 'action',
      effects: [
        {
          step: 'attack_roll',
          attackType: 'melee_spell',
          onHit: [{ step: 'deal_damage', diceFormula: '4d8', damageType: 'force' }],
        },
      ],
    },
  ],
  triggers: [
    { kind: 'start_of_caster_turn_attack', rangeFeet: 5 },
    { kind: 'leash', maxDistanceFeet: 100 },
  ],
};

const guardianStatblock: SummonStatblockSpec = {
  size: 'large',
  untargetable: true,
  speedFeet: 0,
  damageCap: 60,
  actions: [
    {
      id: 'radiant-aura',
      name: 'Radiant Aura',
      description: 'DEX save vs 20 radiant, half on success',
      actionCost: 'action',
      effects: [
        {
          step: 'saving_throw',
          ability: 'dex',
          dcFormula: '@spellSaveDC',
          onFail: [
            { step: 'deal_damage', diceFormula: '20', damageType: 'radiant', halfOnSaveSuccess: true },
          ],
        },
      ],
    },
  ],
  triggers: [{ kind: 'hostile_enter_radius', radiusFeet: 10, perTurnLimit: 1 }],
};

const fistAction: ActivatedAbilitySpec = {
  id: 'clenched-fist',
  name: 'Clenched Fist',
  description: '+spell attack, 4d6 force',
  actionCost: 'action',
  effects: [
    {
      step: 'attack_roll',
      attackType: 'melee_spell',
      onHit: [{ step: 'deal_damage', diceFormula: '4d6', damageType: 'force' }],
    },
  ],
};

const handStatblock: SummonStatblockSpec = {
  size: 'large',
  armorClass: 20,
  hitPointsFormula: '@casterMaxHp',
  speedFeet: 60,
  abilities: { str: 26, dex: 10 },
  actions: [fistAction],
};

const swordAction: ActivatedAbilitySpec = {
  id: 'force-blade',
  name: 'Force Blade',
  description: '3d10 force (SRD 5.1 correction)',
  actionCost: 'action',
  effects: [
    {
      step: 'attack_roll',
      attackType: 'melee_spell',
      onHit: [{ step: 'deal_damage', diceFormula: '3d10', damageType: 'force' }],
    },
  ],
};

const swordStatblock: SummonStatblockSpec = {
  size: 'small',
  untargetable: true,
  speedFeet: 20,
  actions: [swordAction],
};

function summonFromCast(
  state: CombatState,
  casterId: string,
  statblock: SummonStatblockSpec,
  summonId: string,
  overrides: Partial<Extract<EffectStepSpec, { step: 'summon_creature' }>> = {},
) {
  const step = summonStep(summonId, statblock, overrides);
  return { step, result: executeSpellCast({ state, casterId, spell: summonSpell(step) }) };
}

function findSummon(state: CombatState, summonId: string): Combatant {
  const found = Object.values(state.combatants).find((c) => c.isSummon && c.summonId === summonId);
  if (!found) throw new Error(`Summon ${summonId} not found`);
  return found;
}

function findEvent(events: CombatEvent[], type: CombatEvent['type']) {
  return events.find((e) => e.type === type);
}

describe('SRD-902: engine summon pipeline — spawn', () => {
  it('spawns all four SRD summons with correct team, HP/AC, untargetable flags and initiative membership', () => {
    const cases: Array<[string, SummonStatblockSpec, Partial<Combatant>]> = [
      ['faithful-hound-token', houndStatblock, { untargetable: true }],
      ['guardian-of-faith-token', guardianStatblock, { untargetable: true }],
      ['arcane-hand-token', handStatblock, { armorClass: 20, untargetable: false }],
      ['arcane-sword-token', swordStatblock, { untargetable: true }],
    ];

    for (const [summonId, statblock, expected] of cases) {
      const caster = makeCombatant('caster');
      const enemy = makeCombatant('enemy', { side: 'monster', teamId: 'monsters', position: { x: 6, y: 6 } });
      const state = makeState([caster, enemy]);
      const { result } = summonFromCast(state, 'caster', statblock, summonId);
      const summon = findSummon(result.state, summonId);

      expect(summon.isSummon).toBe(true);
      expect(summon.summonedByEntityId).toBe('caster');
      expect(summon.teamId).toBe('party');
      expect(summon.playerId).toBe(caster.playerId);
      expect(summon.untargetable).toBe(Boolean(expected.untargetable));
      expect(isSummonTargetable(summon)).toBe(!expected.untargetable);
      if (summonId === 'arcane-hand-token') {
        expect(summon.armorClass).toBe(20);
        expect(summon.maxHp).toBe(caster.maxHp);
      }
      expect(result.state.initiativeOrder.some((e) => e.entityId === summon.id)).toBe(true);
      expect(findEvent(result.events, 'SUMMON_SPAWNED')).toBeDefined();
    }
  });

  it('is deterministic for identical seeds and states', () => {
    const run = () => {
      const caster = makeCombatant('caster');
      const enemy = makeCombatant('enemy', { side: 'monster', teamId: 'monsters', position: { x: 6, y: 6 } });
      const state = makeState([caster, enemy]);
      return summonFromCast(state, 'caster', handStatblock, 'arcane-hand-token').result;
    };

    const a = run();
    const b = run();
    expect(a.state.rngState).toBe(b.state.rngState);
    expect(a.state.initiativeOrder).toEqual(b.state.initiativeOrder);
    expect(JSON.stringify(findSummon(a.state, 'arcane-hand-token'))).toBe(
      JSON.stringify(findSummon(b.state, 'arcane-hand-token')),
    );
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });
});

describe('SRD-902: autonomous triggers', () => {
  it('hound bites a hostile within 5 ft at the start of its caster’s turn', () => {
    const caster = makeCombatant('caster', { position: { x: 2, y: 2 } });
    const enemy = makeCombatant('goblin', {
      side: 'monster',
      teamId: 'monsters',
      position: { x: 3, y: 2 },
      armorClass: 10,
    });
    const state = makeState([caster, enemy]);
    const { result } = summonFromCast(state, 'caster', houndStatblock, 'faithful-hound-token', {
      control: 'autonomous',
    });
    const hound = findSummon(result.state, 'faithful-hound-token');
    // Anchor the hound next to its target so the 5-ft bite trigger fires.
    const biteState: CombatState = {
      ...result.state,
      combatants: {
        ...result.state.combatants,
        [hound.id]: { ...hound, position: { x: 2, y: 1 } },
        goblin: { ...result.state.combatants['goblin']!, position: { x: 3, y: 1 } },
      },
    };
    expect(
      getFootprintDistanceFeet(
        { x: 2, y: 1 },
        hound.size,
        { x: 3, y: 1 },
        enemy.size,
      ),
    ).toBeLessThanOrEqual(5);

    const turnRes = startTurn(biteState, 'caster');
    expect(turnRes.events.some((e) => e.type === 'SUMMON_TRIGGERED' && e.trigger === 'bite')).toBe(true);
    const attack = turnRes.events.find((e) => e.type === 'ATTACK_RESOLVED');
    expect(attack).toBeDefined();
    if (attack && attack.type === 'ATTACK_RESOLVED') {
      expect(attack.attackerId).toBe(hound.id);
      expect(attack.targetId).toBe('goblin');
    }
  });

  it('hound dismiss beyond the 100 ft leash and via the dedicated command', () => {
    const caster = makeCombatant('caster', { position: { x: 2, y: 2 } });
    const enemy = makeCombatant('enemy', { side: 'monster', teamId: 'monsters', position: { x: 8, y: 8 } });
    const state = makeState([caster, enemy]);
    const { result } = summonFromCast(state, 'caster', houndStatblock, 'faithful-hound-token', {
      control: 'autonomous',
    });

    // Move the caster far from the hound, then start their turn: leash despawns it.
    const movedCaster: Combatant = { ...result.state.combatants['caster']!, position: { x: 40, y: 40 } };
    const leashState: CombatState = {
      ...result.state,
      combatants: { ...result.state.combatants, caster: movedCaster },
    };
    const turnRes = startTurn(leashState, 'caster');
    const leashExpiry = turnRes.events.find(
      (e) => e.type === 'SUMMON_EXPIRED' && e.reason === 'leash',
    );
    expect(leashExpiry).toBeDefined();
    expect(turnRes.state.combatants[findSummon(result.state, 'faithful-hound-token').id]).toBeUndefined();

    // Dismiss command on a fresh summon (a standard action on the caster's turn).
    const freshSummonState = summonFromCast(state, 'caster', houndStatblock, 'faithful-hound-token').result.state;
    const fresh: CombatState = {
      ...freshSummonState,
      activeCombatantId: 'caster',
      turnBudget: createTurnBudget(freshSummonState.combatants['caster']!, false),
    };
    const dismissRes = dismissSummon(fresh, 'caster', { summonId: 'faithful-hound-token' });
    expect(dismissRes.events.some((e) => e.type === 'SUMMON_EXPIRED' && e.reason === 'dismissed')).toBe(true);
    expect(Object.values(dismissRes.state.combatants).some((c) => c.summonId === 'faithful-hound-token')).toBe(false);
  });

  it('guardian triggers a DEX save for 20 radiant and despawns once 60 damage is dealt', () => {
    const caster = makeCombatant('caster', {
      position: { x: 2, y: 2 },
      // Guarantee the guardian's DEX saves fail so the 60-damage cap is exact.
      characterSheet: {
        abilities: {},
        spellcasting: { primarySpellSaveDc: 30 },
      } as unknown as NonNullable<Combatant['characterSheet']>,
    });
    const goblins = [0, 1, 2].map((i) =>
      makeCombatant(`goblin-${i}`, {
        side: 'monster',
        teamId: 'monsters',
        position: { x: 7 + i, y: 2 },
        armorClass: 10,
        dexterityScore: 8,
        dexterityModifier: -1,
      }),
    );
    const state = makeState([caster, ...goblins]);
    const { result } = summonFromCast(state, 'caster', guardianStatblock, 'guardian-of-faith-token', {
      requiresConcentration: false,
      control: 'autonomous',
    });
    const guardian = findSummon(result.state, 'guardian-of-faith-token');
    // Place the guardian in the middle of the goblins' approach.
    const placedState: CombatState = {
      ...result.state,
      combatants: {
        ...result.state.combatants,
        [guardian.id]: { ...guardian, position: { x: 5, y: 2 }, size: 'large' },
      },
    };

    let current = placedState;
    let saves = 0;
    for (const goblin of goblins) {
      current = { ...current, activeCombatantId: goblin.id, turnBudget: createTurnBudget(goblin, false) };
      const moveRes = executeMoveCombatant(current, {
        actorId: goblin.id,
        path: [{ x: goblin.position.x - 1, y: goblin.position.y }],
        grid: createTacticalGrid(20, 20),
      });
      current = moveRes.state;
      saves += moveRes.events.filter((e) => e.type === 'SAVING_THROW_RESOLVED').length;
    }

    expect(saves).toBeGreaterThanOrEqual(3);
    expect(Object.values(current.combatants).some((c) => c.summonId === 'guardian-of-faith-token')).toBe(false);
  });
});

describe('SRD-902: commanded summons', () => {
  it('hand has AC 20 / HP = caster max and resolves Clenched Fist; concentration break despawns it', () => {
    const caster = makeCombatant('caster', { maxHp: 55, currentHp: 55 });
    const enemy = makeCombatant('enemy', { side: 'monster', teamId: 'monsters', position: { x: 3, y: 2 }, armorClass: 10 });
    const state = makeState([caster, enemy]);
    const { result } = summonFromCast(state, 'caster', handStatblock, 'arcane-hand-token', {
      requiresConcentration: true,
      control: 'commanded',
    });
    const hand = findSummon(result.state, 'arcane-hand-token');
    expect(hand.armorClass).toBe(20);
    expect(hand.maxHp).toBe(55);
    expect(hand.summonConcentrationLinked).toBe(true);

    const handTurn: CombatState = {
      ...result.state,
      activeCombatantId: hand.id,
      turnBudget: createTurnBudget(hand, false),
    };
    const actionRes = executeSummonAction(handTurn, {
      summonId: hand.id,
      actorId: 'caster',
      actionId: 'clenched-fist',
      targetId: 'enemy',
    });
    expect(actionRes.events.some((e) => e.type === 'ATTACK_RESOLVED')).toBe(true);
    expect(actionRes.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'force')).toBe(true);

    const breakRes = breakConcentration(actionRes.state, 'caster', 'manual');
    const expiry = breakRes.events.find((e) => e.type === 'SUMMON_EXPIRED' && e.reason === 'concentration');
    expect(expiry).toBeDefined();
    expect(breakRes.state.combatants[hand.id]).toBeUndefined();
  });

  it('sword has 20 ft speed and attacks for 3d10 force', () => {
    const caster = makeCombatant('caster');
    const enemy = makeCombatant('enemy', { side: 'monster', teamId: 'monsters', position: { x: 4, y: 2 }, armorClass: 10 });
    const state = makeState([caster, enemy]);
    const { result } = summonFromCast(state, 'caster', swordStatblock, 'arcane-sword-token', {
      control: 'commanded',
    });
    const sword = findSummon(result.state, 'arcane-sword-token');
    expect(sword.speedFeet).toBe(20);

    const swordTurn: CombatState = {
      ...result.state,
      activeCombatantId: sword.id,
      turnBudget: createTurnBudget(sword, false),
    };
    const actionRes = executeSummonAction(swordTurn, {
      summonId: sword.id,
      actorId: 'caster',
      actionId: 'force-blade',
      targetId: 'enemy',
    });
    const damageEvent = actionRes.events.find(
      (e) => e.type === 'DICE_ROLLED' && e.rollPurpose.includes('3d10'),
    );
    expect(damageEvent).toBeDefined();
    expect(actionRes.events.some((e) => e.type === 'ATTACK_RESOLVED')).toBe(true);
  });

  it('rejects commands from non-owning players and excludes untargetable summons from targeting', () => {
    const caster = makeCombatant('caster', { playerId: 'player-1' });
    const enemy = makeCombatant('enemy', { side: 'monster', teamId: 'monsters', position: { x: 5, y: 5 } });
    const state = makeState([caster, enemy]);
    const { result } = summonFromCast(state, 'caster', houndStatblock, 'faithful-hound-token');
    const hound = findSummon(result.state, 'faithful-hound-token');

    expect(controlsSummon(result.state, 'player-1', hound)).toBe(true);
    expect(controlsSummon(result.state, 'player-2', hound)).toBe(false);
    expect(() => dismissSummon(result.state, 'player-2', { summonId: 'faithful-hound-token' })).toThrow(/No summon owned/i);
    expect(() =>
      executeSummonAction(result.state, {
        summonId: hound.id,
        actorId: 'player-2',
        actionId: 'bite',
        targetId: 'enemy',
      }),
    ).toThrow(/does not control/i);

    const targetingState: CombatState = {
      ...result.state,
      activeCombatantId: 'caster',
      turnBudget: createTurnBudget(result.state.combatants['caster']!, false),
    };
    expect(() =>
      executeSpellCast({
        state: targetingState,
        casterId: 'caster',
        spell: {
          ...summonSpell(summonStep('unused', swordStatblock)),
          id: 'fire-bolt-test',
          targeting: { type: 'single', rangeFeet: 60 },
          effects: [{ step: 'attack_roll', attackType: 'ranged_spell', onHit: [{ step: 'deal_damage', diceFormula: '1d10', damageType: 'fire' }] }],
        },
        targetIds: [hound.id],
      }),
    ).toThrow(/untargetable conjuration/i);
  });
});

describe('SRD-902: command dispatch', () => {
  it('routes DISMISS_SUMMON through the authoritative reducer', () => {
    const caster = makeCombatant('caster', { side: 'party' });
    const enemy = makeCombatant('enemy', { side: 'monster', teamId: 'monsters', position: { x: 6, y: 6 } });
    const state = makeState([caster, enemy]);
    const { result } = summonFromCast(state, 'caster', houndStatblock, 'faithful-hound-token');

    const grid = createTacticalGrid(20, 20);
    const combatState: CombatState = {
      ...result.state,
      activeCombatantId: 'caster',
      turnBudget: createTurnBudget(result.state.combatants['caster']!, false),
    };
    const game = {
      ...createInitialGameState({ id: 'summon-game', grid, party: [combatState.combatants['caster']!], monsters: [enemy] }),
      mode: 'combat' as const,
      combat: combatState,
      rngState: combatState.rngState,
    };
    const reduced = reduceGame(game, {
      type: 'DISMISS_SUMMON',
      actorId: 'caster',
      summonId: 'faithful-hound-token',
    });
    expect(reduced.events.some((e) => e.type === 'SUMMON_EXPIRED')).toBe(true);
    expect(Object.values(reduced.nextState.combat?.combatants ?? {}).some((c) => c.summonId === 'faithful-hound-token')).toBe(false);
  });
});
