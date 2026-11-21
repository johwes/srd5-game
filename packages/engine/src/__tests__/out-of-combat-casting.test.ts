import { describe, expect, it } from 'vitest';
import { compendium } from '@srd5/data';
import { createTacticalGrid } from '../grid/model.js';
import type { Combatant } from '../combat/index.js';
import {
  executeOutOfCombatSpellCast,
  getRitualTimeMinutes,
  isSpellAllowedOutOfCombat,
} from '../combat/out-of-combat-casting.js';
import { createInitialGameState, reduceGame } from '../state/reducer.js';

function makeCaster(id: string, name: string, x: number, y: number, slots?: Record<string, number>): Combatant {
  const spellSlots: Record<string, { max: number; expended: number; available: number }> = {};
  const levels = slots ?? { '1': 4, '2': 2, '3': 2 };
  for (const [lvl, max] of Object.entries(levels)) {
    spellSlots[lvl] = { max, expended: 0, available: max };
  }
  return {
    id,
    name,
    side: 'party',
    size: 'medium',
    position: { x, y },
    speedFeet: 30,
    currentHp: 20,
    maxHp: 20,
    tempHp: 0,
    armorClass: 14,
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
    reactionAvailable: true,
    damageResistances: [],
    damageImmunities: [],
    damageVulnerabilities: [],
    conditionImmunities: [],
    spellSlots,
  };
}

function makeParty() {
  const grid = createTacticalGrid(10, 10);
  const cleric = makeCaster('cleric-1', 'Bram', 1, 1);
  const fighter = makeCaster('fighter-1', 'Garrick', 1, 2, {});
  fighter.spellSlots = undefined;
  // Wound the fighter so healing has an observable effect.
  fighter.currentHp = 11;
  fighter.maxHp = 20;
  const party: Record<string, Combatant> = { [cleric.id]: cleric, [fighter.id]: fighter };
  return { grid, party, rngState: 12345 };
}

describe('SRD-1203: out-of-combat gating', () => {
  it('allows heal/buff spells and rejects hostile spells', () => {
    expect(isSpellAllowedOutOfCombat(compendium.requireSpell('cure-wounds')).allowed).toBe(true);
    expect(isSpellAllowedOutOfCombat(compendium.requireSpell('bless')).allowed).toBe(true);
    expect(isSpellAllowedOutOfCombat(compendium.requireSpell('comprehend-languages')).allowed).toBe(true);
    expect(isSpellAllowedOutOfCombat(compendium.requireSpell('detect-magic')).allowed).toBe(true);
    expect(isSpellAllowedOutOfCombat(compendium.requireSpell('fireball')).allowed).toBe(false);
    expect(isSpellAllowedOutOfCombat(compendium.requireSpell('sleep')).allowed).toBe(false);
  });

  it('prices rituals at base time + 10 minutes', () => {
    expect(getRitualTimeMinutes(compendium.requireSpell('comprehend-languages'))).toBe(10);
    expect(getRitualTimeMinutes(compendium.requireSpell('detect-magic'))).toBe(10);
  });
});

describe('SRD-1203: out-of-combat healing (required acceptance)', () => {
  it('resolves cure-wounds out of combat, expends a slot, and heals the target', () => {
    const { party, grid, rngState } = makeParty();
    const fighterBefore = party['fighter-1']!.currentHp;

    const res = executeOutOfCombatSpellCast({
      party,
      casterId: 'cleric-1',
      spellId: 'cure-wounds',
      slotLevel: 1,
      targetIds: ['fighter-1'],
      rngState,
      grid,
    });

    expect(res.targetsHealed).toContain('fighter-1');
    expect(res.totalHealingByTarget['fighter-1']).toBeGreaterThan(0);
    expect(res.party['fighter-1']!.currentHp).toBeGreaterThan(fighterBefore);
    expect(res.party['fighter-1']!.currentHp).toBeLessThanOrEqual(res.party['fighter-1']!.maxHp);
    expect(res.party['cleric-1']!.spellSlots?.['1']?.available).toBe(3);
    expect(res.events.some((e) => e.type === 'SPELL_CAST')).toBe(true);
    expect(res.events.some((e) => e.type === 'HEAL_APPLIED')).toBe(true);
  });

  it('is deterministic: same seed replays the same heal', () => {
    const first = makeParty();
    const second = makeParty();
    const a = executeOutOfCombatSpellCast({
      party: first.party,
      casterId: 'cleric-1',
      spellId: 'cure-wounds',
      slotLevel: 1,
      targetIds: ['fighter-1'],
      rngState: 777,
      grid: first.grid,
    });
    const b = executeOutOfCombatSpellCast({
      party: second.party,
      casterId: 'cleric-1',
      spellId: 'cure-wounds',
      slotLevel: 1,
      targetIds: ['fighter-1'],
      rngState: 777,
      grid: second.grid,
    });
    expect(a.totalHealingByTarget).toEqual(b.totalHealingByTarget);
    expect(a.rngState).toBe(b.rngState);
  });

  it('caps healing at maxHp and revives a 0-HP ally', () => {
    const { party, grid, rngState } = makeParty();
    const fighter = party['fighter-1']!;
    fighter.currentHp = 0;
    fighter.conditions = [...fighter.conditions, 'unconscious'];

    const res = executeOutOfCombatSpellCast({
      party,
      casterId: 'cleric-1',
      spellId: 'healing-word',
      slotLevel: 1,
      targetIds: ['fighter-1'],
      rngState,
      grid,
    });

    const after = res.party['fighter-1']!;
    expect(after.currentHp).toBeGreaterThan(0);
    expect(after.currentHp).toBeLessThanOrEqual(after.maxHp);
    expect(after.conditions).not.toContain('unconscious');
    const healEvent = res.events.find((e) => e.type === 'HEAL_APPLIED');
    expect(healEvent && healEvent.type === 'HEAL_APPLIED' && healEvent.revivedFromZero).toBe(true);
  });

  it('rejects downcasting, exhausted slots, dead casters, and out-of-range targets', () => {
    const { party, grid, rngState } = makeParty();
    expect(() =>
      executeOutOfCombatSpellCast({
        party,
        casterId: 'cleric-1',
        spellId: 'aid',
        slotLevel: 1,
        targetIds: ['fighter-1'],
        rngState,
        grid,
      }),
    ).toThrow(/lower slot/i);

    const noSlots: Record<string, Combatant> = structuredClone(party);
    noSlots['cleric-1']!.spellSlots = {
      '1': { max: 4, expended: 4, available: 0 },
      '2': { max: 2, expended: 2, available: 0 },
    };
    expect(() =>
      executeOutOfCombatSpellCast({
        party: noSlots,
        casterId: 'cleric-1',
        spellId: 'cure-wounds',
        slotLevel: 1,
        targetIds: ['fighter-1'],
        rngState,
        grid,
      }),
    ).toThrow(/no level 1 spell slots/i);

    const deadCaster: Record<string, Combatant> = structuredClone(party);
    deadCaster['cleric-1']!.currentHp = 0;
    deadCaster['cleric-1']!.isDead = true;
    expect(() =>
      executeOutOfCombatSpellCast({
        party: deadCaster,
        casterId: 'cleric-1',
        spellId: 'cure-wounds',
        slotLevel: 1,
        targetIds: ['fighter-1'],
        rngState,
        grid,
      }),
    ).toThrow(/dead or at 0 HP/i);

    const farGrid = createTacticalGrid(10, 10);
    const farCleric = makeCaster('cleric-1', 'Bram', 0, 0);
    const farFighter = makeCaster('fighter-1', 'Garrick', 9, 9, {});
    farFighter.spellSlots = undefined;
    farFighter.currentHp = 11;
    expect(() =>
      executeOutOfCombatSpellCast({
        party: { 'cleric-1': farCleric, 'fighter-1': farFighter },
        casterId: 'cleric-1',
        spellId: 'cure-wounds',
        slotLevel: 1,
        targetIds: ['fighter-1'],
        rngState,
        grid: farGrid,
      }),
    ).toThrow(/touch range/i);
  });

  it('rejects hostile casts (fireball, sleep) out of combat', () => {
    const { party, grid, rngState } = makeParty();
    expect(() =>
      executeOutOfCombatSpellCast({
        party,
        casterId: 'cleric-1',
        spellId: 'fireball',
        slotLevel: 3,
        targetIds: ['fighter-1'],
        rngState,
        grid,
      }),
    ).toThrow(/requires combat/i);
    expect(() =>
      executeOutOfCombatSpellCast({
        party,
        casterId: 'cleric-1',
        spellId: 'sleep',
        slotLevel: 1,
        rngState,
        grid,
      }),
    ).toThrow(/requires combat/i);
  });
});

describe('SRD-1203: ritual casting costs time, not slots', () => {
  it('casts comprehend-languages as a ritual without expending a slot', () => {
    const grid = createTacticalGrid(10, 10);
    const wizard = makeCaster('wizard-1', 'Lyra', 2, 2);
    const party: Record<string, Combatant> = { [wizard.id]: wizard };

    const res = executeOutOfCombatSpellCast({
      party,
      casterId: 'wizard-1',
      spellId: 'comprehend-languages',
      castAsRitual: true,
      rngState: 4242,
      grid,
    });

    expect(res.ritualCast).toBe(true);
    expect(res.timeSpentMinutes).toBe(10);
    expect(res.party['wizard-1']!.spellSlots?.['1']?.available).toBe(4);
    expect(
      res.party['wizard-1']!.activeEffects?.some(
        (e) => e.effectId === 'comprehend-languages-understanding',
      ),
    ).toBe(true);
    const cast = res.events.find((e) => e.type === 'SPELL_CAST');
    expect(cast && cast.type === 'SPELL_CAST' && cast.slotExpended).toBeUndefined();
    expect(cast && cast.type === 'SPELL_CAST' && cast.actionCost).toBe('ritual_10_minutes');
  });

  it('rejects non-ritual spells cast as rituals', () => {
    const { party, grid, rngState } = makeParty();
    expect(() =>
      executeOutOfCombatSpellCast({
        party,
        casterId: 'cleric-1',
        spellId: 'cure-wounds',
        castAsRitual: true,
        rngState,
        grid,
      }),
    ).toThrow(/cannot be cast as a ritual/i);
  });

  it('expends a slot for non-ritual utility casts (bless)', () => {
    const { party, grid, rngState } = makeParty();
    const res = executeOutOfCombatSpellCast({
      party,
      casterId: 'cleric-1',
      spellId: 'bless',
      slotLevel: 1,
      targetIds: ['cleric-1', 'fighter-1'],
      rngState,
      grid,
    });
    expect(res.targetsBuffed).toContain('fighter-1');
    expect(res.party['cleric-1']!.spellSlots?.['1']?.available).toBe(3);
    expect(
      res.party['fighter-1']!.activeEffects?.some((e) => e.effectId === 'bless-buff'),
    ).toBe(true);
  });
});

describe('SRD-1203: reducer + transport path (exploration mode)', () => {
  it('resolves DECLARE_CAST_SPELL in exploration via reduceGame', () => {
    const { party, grid } = makeParty();
    const fighterBefore = party['fighter-1']!.currentHp;
    const state = createInitialGameState({ grid, party: Object.values(party), rngState: 31337 });
    expect(state.mode).toBe('exploration');

    const { nextState, events } = reduceGame(state, {
      type: 'DECLARE_CAST_SPELL',
      actorId: 'cleric-1',
      spellId: 'cure-wounds',
      slotLevel: 1,
      targetIds: ['fighter-1'],
    });

    expect(nextState.party['fighter-1']!.currentHp).toBeGreaterThan(fighterBefore);
    expect(events.some((e) => e.type === 'SPELL_CAST')).toBe(true);
    expect(events.some((e) => e.type === 'HEAL_APPLIED')).toBe(true);
  });

  it('resolves ritual comprehend-languages in exploration without a slot', () => {
    const grid = createTacticalGrid(10, 10);
    const wizard = makeCaster('wizard-1', 'Lyra', 2, 2);
    const state = createInitialGameState({ grid, party: [wizard], rngState: 5150 });

    const { nextState, events } = reduceGame(state, {
      type: 'DECLARE_CAST_SPELL',
      actorId: 'wizard-1',
      spellId: 'comprehend-languages',
      castAsRitual: true,
    });

    expect(nextState.party['wizard-1']!.spellSlots?.['1']?.available).toBe(4);
    expect(
      nextState.party['wizard-1']!.activeEffects?.some(
        (e) => e.effectId === 'comprehend-languages-understanding',
      ),
    ).toBe(true);
    expect(events.some((e) => e.type === 'SPELL_CAST')).toBe(true);
  });
});
