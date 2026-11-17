import { describe, expect, it } from 'vitest';
import { BUNDLED_SRD_DATASET, type EffectStepSpec, type SpellData } from '@srd5/data';
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
import { dismissSummon, executeSummonAction, isSummonTargetable } from '../combat/summon.js';
import { createTacticalGrid } from '../grid/model.js';

type SummonStep = Extract<EffectStepSpec, { step: 'summon_creature' }>;

/** Returns the real, overlay-enriched SRD spell from the bundled dataset. */
function srdSpell(id: string): SpellData {
  const spell = BUNDLED_SRD_DATASET.spells.find((s) => s.id === id);
  if (!spell) throw new Error(`Bundled spell "${id}" not found`);
  return spell;
}

function summonStepOf(spell: SpellData): SummonStep {
  const step = spell.effects.find((e): e is SummonStep => e.step === 'summon_creature');
  if (!step) throw new Error(`Spell "${spell.id}" has no summon_creature overlay`);
  return step;
}

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

function makeState(combatants: Combatant[], activeId = combatants[0]!.id, rngState = 987654): CombatState {
  const started = startCombatEncounter({ encounterId: 'summon-overlay-test', combatants, rngState });
  const active = combatants.find((c) => c.id === activeId) ?? combatants[0]!;
  return {
    ...started.state,
    activeCombatantId: active.id,
    activeCombatantIndex: started.state.initiativeOrder.findIndex((e) => e.entityId === active.id),
    turnBudget: createTurnBudget(active, false),
  };
}

/** Casts a real bundled SRD summon spell, defaulting the declared target to the caster. */
function castSummon(
  state: CombatState,
  casterId: string,
  spellId: string,
  targetIds: string[] = [casterId],
) {
  return { result: executeSpellCast({ state, casterId, spell: srdSpell(spellId), targetIds }) };
}

function findSummon(state: CombatState, summonId: string): Combatant {
  const found = Object.values(state.combatants).find((c) => c.isSummon && c.summonId === summonId);
  if (!found) throw new Error(`Summon "${summonId}" not found`);
  return found;
}

function withActive(state: CombatState, combatant: Combatant): CombatState {
  return {
    ...state,
    activeCombatantId: combatant.id,
    turnBudget: createTurnBudget(combatant, false),
  };
}

/** A caster fixture with guaranteed spellcasting numbers for summon effects. */
function spellcaster(overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant('caster', {
    maxHp: 55,
    currentHp: 55,
    characterSheet: {
      abilities: {},
      proficiencyBonus: 3,
      spellcasting: { primarySpellSaveDc: 30, primarySpellAttackBonus: 20, primaryAbility: 'int' },
    } as unknown as NonNullable<Combatant['characterSheet']>,
    ...overrides,
  });
}

describe('SRD-905: bundled summon overlays replace adjudication cards', () => {
  const spellIds = ['faithful-hound', 'guardian-of-faith', 'arcane-hand', 'arcane-sword'];

  it.each(spellIds)('%s resolves to a single executable summon_creature step', (spellId) => {
    const spell = srdSpell(spellId);
    expect(spell.effects).toHaveLength(1);
    expect(spell.effects.some((e) => e.step === 'manual_adjudication')).toBe(false);
    expect(summonStepOf(spell).placement).toBe('unoccupied_within_range');
  });

  it('authors a rules-accurate Faithful Hound statblock (4d8 bite, bark/leash, untargetable)', () => {
    const step = summonStepOf(srdSpell('faithful-hound'));
    expect(step.control).toBe('autonomous');
    expect(step.durationRounds).toBe(4800); // 8 hours
    expect(step.requiresConcentration).toBe(false);
    expect(step.summonId).toBe('faithful-hound-token');
    expect(step.statblock.size).toBe('medium');
    expect(step.statblock.untargetable).toBe(true);
    expect(step.statblock.armorClass).toBeUndefined();
    expect(step.statblock.hitPointsFormula).toBeUndefined();
    expect(step.statblock.speedFeet).toBe(40);
    expect(step.statblock.actions?.map((a) => a.id)).toContain('bite');
    const damage = step.statblock.actions?.find((a) => a.id === 'bite')?.effects[0];
    expect(damage).toMatchObject({ step: 'attack_roll', attackType: 'melee_spell' });
    expect(JSON.stringify(damage)).toContain('4d8');
    expect(step.statblock.triggers).toEqual([
      { kind: 'start_of_caster_turn_attack', rangeFeet: 5 },
      { kind: 'leash', maxDistanceFeet: 100 },
    ]);
  });

  it('authors a rules-accurate Guardian of Faith statblock (20 radiant / half, 60 damage cap)', () => {
    const step = summonStepOf(srdSpell('guardian-of-faith'));
    expect(step.control).toBe('autonomous');
    expect(step.durationRounds).toBe(4800); // 8 hours
    expect(step.requiresConcentration).toBe(false);
    expect(step.statblock.size).toBe('large');
    expect(step.statblock.untargetable).toBe(true);
    expect(step.statblock.damageCap).toBe(60);
    expect(step.statblock.triggers).toEqual([
      { kind: 'hostile_enter_radius', radiusFeet: 10, perTurnLimit: 1 },
    ]);
    const aura = step.statblock.actions?.[0];
    expect(aura).toMatchObject({ id: 'radiant-aura' });
    const save = aura?.effects[0];
    expect(save).toMatchObject({ step: 'saving_throw', ability: 'dex', dcFormula: '@spellSaveDC' });
    expect(JSON.stringify(save)).toContain('"diceFormula":"20"');
    expect(JSON.stringify(save)).toContain('radiant');
  });

  it('authors a rules-accurate Arcane Hand statblock (AC 20, @casterMaxHp, STR 26, 4 actions)', () => {
    const step = summonStepOf(srdSpell('arcane-hand'));
    expect(step.control).toBe('commanded');
    expect(step.durationRounds).toBe(10); // 1 minute
    expect(step.requiresConcentration).toBe(true);
    expect(step.statblock.size).toBe('large');
    expect(step.statblock.armorClass).toBe(20);
    expect(step.statblock.hitPointsFormula).toBe('@casterMaxHp');
    expect(step.statblock.abilities).toMatchObject({ str: 26, dex: 10 });
    expect(step.statblock.speedFeet).toBe(60);
    expect(step.statblock.actions?.map((a) => a.id)).toEqual([
      'clenched-fist',
      'forceful-hand',
      'grasping-hand',
      'interposing-hand',
    ]);
    expect(JSON.stringify(step.statblock.actions?.find((a) => a.id === 'clenched-fist'))).toContain('4d6');
  });

  it('authors a rules-accurate Arcane Sword statblock with the 3d10 force correction', () => {
    const step = summonStepOf(srdSpell('arcane-sword'));
    expect(step.control).toBe('commanded');
    expect(step.durationRounds).toBe(10); // 1 minute
    expect(step.requiresConcentration).toBe(true);
    expect(step.statblock.size).toBe('small');
    expect(step.statblock.untargetable).toBe(true);
    expect(step.statblock.speedFeet).toBe(20);
    expect(JSON.stringify(step.statblock)).toContain('3d10');
    expect(JSON.stringify(step.statblock)).not.toContain('4d8');
  });
});

describe('SRD-905: headless casting of the real summon overlays', () => {
  it('spawns all four summons with correct team, flags, initiative membership, and seeded determinism', () => {
    const cases: Array<[string, string, Partial<Combatant>]> = [
      ['faithful-hound', 'faithful-hound-token', { untargetable: true, size: 'medium' }],
      ['guardian-of-faith', 'guardian-of-faith-token', { untargetable: true, size: 'large' }],
      ['arcane-hand', 'arcane-hand-token', { untargetable: false, size: 'large' }],
      ['arcane-sword', 'arcane-sword-token', { untargetable: true, size: 'small' }],
    ];

    for (const [spellId, summonId, expected] of cases) {
      const caster = spellcaster();
      const enemy = makeCombatant('enemy', { side: 'monster', teamId: 'monsters', position: { x: 6, y: 6 } });
      const state = makeState([caster, enemy]);
      const { result } = castSummon(state, 'caster', spellId);
      const summon = findSummon(result.state, summonId);

      expect(summon.isSummon).toBe(true);
      expect(summon.summonedByEntityId).toBe('caster');
      expect(summon.teamId).toBe('party');
      expect(summon.playerId).toBe(caster.playerId);
      expect(summon.summonControl).toBe(spellcasterControl(spellId));
      expect(summon.untargetable).toBe(Boolean(expected.untargetable));
      expect(isSummonTargetable(summon)).toBe(!expected.untargetable);
      expect(summon.size).toBe(expected.size);
      expect(summon.summonSourceName).toBe(srdSpell(spellId).name);
      expect(result.state.initiativeOrder.some((e) => e.entityId === summon.id)).toBe(true);
      expect(result.events.some((e) => e.type === 'SUMMON_SPAWNED')).toBe(true);
      if (spellId === 'arcane-hand') {
        expect(summon.armorClass).toBe(20);
        expect(summon.maxHp).toBe(caster.maxHp);
      }
    }
  });

  it('replays identically for the same seed', () => {
    const run = () => {
      const caster = spellcaster();
      const enemy = makeCombatant('enemy', { side: 'monster', teamId: 'monsters', position: { x: 6, y: 6 } });
      return castSummon(makeState([caster, enemy]), 'caster', 'arcane-hand');
    };
    const a = run();
    const b = run();
    expect(a.result.state.rngState).toBe(b.result.state.rngState);
    expect(a.result.state.initiativeOrder).toEqual(b.result.state.initiativeOrder);
    expect(JSON.stringify(findSummon(a.result.state, 'arcane-hand-token'))).toBe(
      JSON.stringify(findSummon(b.result.state, 'arcane-hand-token')),
    );
    expect(JSON.stringify(a.result.events)).toBe(JSON.stringify(b.result.events));
  });

  it('Faithful Hound bites its caster’s turn start, enforces the leash, and dismisses on command', () => {
    const caster = spellcaster({ position: { x: 2, y: 2 } });
    const goblin = makeCombatant('goblin', {
      side: 'monster',
      teamId: 'monsters',
      position: { x: 3, y: 2 },
      armorClass: 10,
    });
    const state = makeState([caster, goblin]);
    const { result } = castSummon(state, 'caster', 'faithful-hound');
    const hound = findSummon(result.state, 'faithful-hound-token');

    // Anchor the hound adjacent to the goblin so the 5-ft bite trigger fires.
    const anchored: CombatState = {
      ...result.state,
      combatants: {
        ...result.state.combatants,
        [hound.id]: { ...hound, position: { x: 2, y: 1 } },
        goblin: { ...result.state.combatants['goblin']!, position: { x: 3, y: 1 } },
      },
    };
    const turnRes = startTurn(anchored, 'caster');
    expect(turnRes.events.some((e) => e.type === 'SUMMON_TRIGGERED' && e.trigger === 'bite')).toBe(true);
    const attack = turnRes.events.find((e) => e.type === 'ATTACK_RESOLVED');
    expect(attack).toBeDefined();
    if (attack?.type === 'ATTACK_RESOLVED') {
      expect(attack.attackerId).toBe(hound.id);
      expect(attack.targetId).toBe('goblin');
    }
    expect(turnRes.events.some((e) => e.type === 'DICE_ROLLED' && e.rollPurpose.includes('4d8'))).toBe(true);

    // Leash: moving the caster 100+ ft away despawns the hound at their next turn.
    const leashState: CombatState = {
      ...result.state,
      combatants: {
        ...result.state.combatants,
        caster: { ...result.state.combatants['caster']!, position: { x: 40, y: 40 } },
      },
    };
    const leashRes = startTurn(leashState, 'caster');
    expect(leashRes.events.some((e) => e.type === 'SUMMON_EXPIRED' && e.reason === 'leash')).toBe(true);
    expect(leashRes.state.combatants[hound.id]).toBeUndefined();

    // Dedicated dismiss command ends a freshly cast hound.
    const dismissRes = dismissSummon(withActive(result.state, result.state.combatants['caster']!), 'caster', {
      summonId: 'faithful-hound-token',
    });
    expect(dismissRes.events.some((e) => e.type === 'SUMMON_EXPIRED' && e.reason === 'dismissed')).toBe(true);
    expect(Object.values(dismissRes.state.combatants).some((c) => c.summonId === 'faithful-hound-token')).toBe(false);
  });

  it('Guardian of Faith deals 20/half radiant on entry and despawns at the 60 damage cap', () => {
    const caster = spellcaster({ position: { x: 2, y: 2 } });
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
    const { result } = castSummon(state, 'caster', 'guardian-of-faith');
    const guardian = findSummon(result.state, 'guardian-of-faith-token');
    let current: CombatState = {
      ...result.state,
      combatants: {
        ...result.state.combatants,
        [guardian.id]: { ...guardian, position: { x: 5, y: 2 } },
      },
    };

    let saves = 0;
    const radiant: CombatEvent[] = [];
    for (const goblin of goblins) {
      current = withActive(current, current.combatants[goblin.id]!);
      const moveRes = executeMoveCombatant(current, {
        actorId: goblin.id,
        path: [{ x: goblin.position.x - 1, y: goblin.position.y }],
        grid: createTacticalGrid(20, 20),
      });
      current = moveRes.state;
      saves += moveRes.events.filter(
        (e) => e.type === 'SAVING_THROW_RESOLVED' && e.ability === 'dex' && e.dc === 30,
      ).length;
      radiant.push(...moveRes.events.filter((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'radiant'));
    }

    expect(saves).toBe(3);
    expect(radiant.length).toBeGreaterThanOrEqual(3);
    expect(radiant.every((e) => e.type === 'DAMAGE_APPLIED' && e.finalAmount === 20)).toBe(true);
    const capExpiry = current.combatants[guardian.id];
    expect(capExpiry).toBeUndefined();
  });

  it('Arcane Hand has AC 20 / caster-max HP, resolves Clenched Fist, and despawns on concentration break', () => {
    const caster = spellcaster();
    const enemy = makeCombatant('enemy', {
      side: 'monster',
      teamId: 'monsters',
      position: { x: 3, y: 2 },
      armorClass: 10,
    });
    const { result } = castSummon(makeState([caster, enemy]), 'caster', 'arcane-hand');
    const hand = findSummon(result.state, 'arcane-hand-token');
    expect(hand.armorClass).toBe(20);
    expect(hand.maxHp).toBe(55);
    expect(hand.summonConcentrationLinked).toBe(true);

    const actionRes = executeSummonAction(withActive(result.state, hand), {
      summonId: hand.id,
      actorId: 'caster',
      actionId: 'clenched-fist',
      targetId: 'enemy',
    });
    expect(actionRes.events.some((e) => e.type === 'ATTACK_RESOLVED')).toBe(true);
    expect(actionRes.events.some((e) => e.type === 'DICE_ROLLED' && e.rollPurpose.includes('4d6'))).toBe(true);
    expect(actionRes.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'force')).toBe(true);

    const breakRes = breakConcentration(actionRes.state, 'caster', 'manual');
    expect(breakRes.events.some((e) => e.type === 'SUMMON_EXPIRED' && e.reason === 'concentration')).toBe(true);
    expect(breakRes.state.combatants[hand.id]).toBeUndefined();
  });

  it('Arcane Sword moves at 20 ft and its melee attack rolls 3d10 force', () => {
    const caster = spellcaster();
    const enemy = makeCombatant('enemy', {
      side: 'monster',
      teamId: 'monsters',
      position: { x: 4, y: 2 },
      armorClass: 10,
    });
    const { result } = castSummon(makeState([caster, enemy]), 'caster', 'arcane-sword');
    const sword = findSummon(result.state, 'arcane-sword-token');
    expect(sword.speedFeet).toBe(20);
    expect(sword.untargetable).toBe(true);

    const actionRes = executeSummonAction(withActive(result.state, sword), {
      summonId: sword.id,
      actorId: 'caster',
      actionId: 'force-blade',
      targetId: 'enemy',
    });
    expect(actionRes.events.some((e) => e.type === 'ATTACK_RESOLVED')).toBe(true);
    expect(actionRes.events.some((e) => e.type === 'DICE_ROLLED' && e.rollPurpose.includes('3d10'))).toBe(true);
    expect(actionRes.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'force')).toBe(true);
    expect(JSON.stringify(actionRes.events)).not.toContain('4d8');
  });
});

function spellcasterControl(spellId: string): string {
  return spellId === 'arcane-hand' || spellId === 'arcane-sword' ? 'commanded' : 'autonomous';
}
