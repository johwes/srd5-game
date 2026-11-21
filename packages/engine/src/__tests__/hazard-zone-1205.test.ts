import { describe, expect, it } from 'vitest';
import type { Combatant, CombatState } from '../combat/types.js';
import {
  createHazardZone,
  executeHazardZoneEffects,
  expendHazardSpellSlot,
  hazardSlotSpendAvailable,
  parseHazardSlotSpend,
} from '../combat/hazard-zone.js';
import { HAZARD_UNSUPPORTED_STEPS } from '../combat/marker-spells.js';

function makeCombatant(over: Partial<Combatant> & { id: string; name: string }): Combatant {
  return {
    side: 'party',
    size: 'medium',
    position: { x: 0, y: 0 },
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
    ...over,
  } as Combatant;
}

function makeState(combatants: Combatant[], rngState = 42): CombatState {
  const map: Record<string, Combatant> = {};
  for (const c of combatants) map[c.id] = c;
  return {
    encounterId: 'test',
    round: 1,
    phase: 'active_turn',
    initiativeOrder: combatants.map((c) => ({
      entityId: c.id,
      initiative: 10,
      naturalRoll: 10,
      dexterityScore: 14,
      tieBreaker: 0,
    })),
    activeCombatantIndex: 0,
    activeCombatantId: combatants[0]?.id ?? null,
    turnBudget: null,
    combatants: map,
    surprisedCombatantIds: [],
    outcome: 'in_progress',
    rngState,
  };
}

describe('SRD-1205: hazard teleport step resolves (no silent drop)', () => {
  it('flings the triggering creature away from the zone origin', () => {
    const caster = makeCombatant({ id: 'caster', name: 'Wiz', position: { x: 5, y: 5 } });
    const target = makeCombatant({ id: 't', name: 'T', side: 'monster', position: { x: 6, y: 5 } });
    const state = makeState([caster, target], 21);
    const created = createHazardZone(state, {
      zoneId: 'teleport-trap',
      casterId: 'caster',
      sourceName: 'Teleport Trap',
      shape: 'sphere',
      origin: { x: 5, y: 5 },
      sizeFeet: 10,
      durationRounds: 10,
      onEnterOrStartTurn: [{ step: 'teleport', maxDistanceFeet: 10 }],
      cells: [{ x: 6, y: 5 }],
    });
    const zone = Object.values(created.state.hazardZones ?? {})[0]!;
    const res = executeHazardZoneEffects(created.state, zone, created.state.combatants['t']!, 'enter');
    // Ray from origin (5,5) through target (6,5): +x, 10 ft = 2 cells.
    expect(res.state.combatants['t']!.position).toEqual({ x: 8, y: 5 });
    const moved = res.events.find((e) => e.type === 'ENTITY_MOVED') as unknown as {
      entityId: string;
      mode: string;
    };
    expect(moved.entityId).toBe('t');
    expect(moved.mode).toBe('teleport');
    expect(res.events.some((e) => e.type === 'HAZARD_ZONE_STEP_SKIPPED')).toBe(false);
  });

  it('clamps teleports to the board edge deterministically', () => {
    const caster = makeCombatant({ id: 'caster', name: 'Wiz', position: { x: 2, y: 0 } });
    const target = makeCombatant({ id: 't', name: 'T', side: 'monster', position: { x: 0, y: 0 } });
    const state = makeState([caster, target], 21);
    const created = createHazardZone(state, {
      zoneId: 'teleport-trap',
      casterId: 'caster',
      sourceName: 'Teleport Trap',
      shape: 'sphere',
      origin: { x: 2, y: 0 },
      sizeFeet: 10,
      durationRounds: 10,
      onEnterOrStartTurn: [{ step: 'teleport', maxDistanceFeet: 15 }],
      cells: [{ x: 0, y: 0 }],
    });
    const zone = Object.values(created.state.hazardZones ?? {})[0]!;
    const res = executeHazardZoneEffects(created.state, zone, created.state.combatants['t']!, 'enter');
    // Ray (2,0)->(0,0) points -x: 0 - 3 clamps to 0.
    expect(res.state.combatants['t']!.position).toEqual({ x: 0, y: 0 });
    expect(res.events.some((e) => e.type === 'ENTITY_MOVED')).toBe(true);
  });
});

describe('SRD-1205: hazard nested create_hazard_zone resolves', () => {
  it('anchors a child zone at the triggering creature without recursing', () => {
    const caster = makeCombatant({ id: 'caster', name: 'Wiz', position: { x: 0, y: 0 } });
    const target = makeCombatant({ id: 't', name: 'T', side: 'monster', position: { x: 3, y: 3 } });
    const state = makeState([caster, target], 21);
    const created = createHazardZone(state, {
      zoneId: 'outer-zone',
      casterId: 'caster',
      sourceName: 'Outer Zone',
      shape: 'sphere',
      origin: { x: 3, y: 3 },
      sizeFeet: 10,
      durationRounds: 10,
      onEnterOrStartTurn: [
        {
          step: 'create_hazard_zone',
          zoneId: 'nested-zone',
          shape: 'sphere',
          sizeFeet: 10,
          durationRounds: 5,
          requiresConcentration: false,
          difficultTerrain: false,
          onEnterOrStartTurn: [{ step: 'deal_damage', diceFormula: '1d4', damageType: 'fire' }],
        },
      ],
      cells: [{ x: 3, y: 3 }],
    });
    const zone = Object.values(created.state.hazardZones ?? {})[0]!;
    const res = executeHazardZoneEffects(created.state, zone, created.state.combatants['t']!, 'enter');
    const zones = Object.values(res.state.hazardZones ?? {});
    expect(zones).toHaveLength(2);
    const nested = zones.find((z) => z.zoneId === 'nested-zone')!;
    expect(nested).toBeDefined();
    expect(nested.origin).toEqual({ x: 3, y: 3 });
    expect(nested.cells.length).toBeGreaterThan(0);
    expect(nested.requiresConcentration).toBe(false);
    // Exactly one immediate trigger (the outer) — the nested zone waits.
    expect(res.events.filter((e) => e.type === 'HAZARD_ZONE_TRIGGERED')).toHaveLength(1);
    expect(
      res.events.some(
        (e) => e.type === 'HAZARD_ZONE_CREATED' && (e as { zoneId: string }).zoneId === 'nested-zone',
      ),
    ).toBe(true);
    expect(res.events.some((e) => e.type === 'HAZARD_ZONE_STEP_SKIPPED')).toBe(false);
  });
});

describe('SRD-1205: hazard spend_resource slot drain', () => {
  it('parses every spell-slot id form and rejects class resources', () => {
    expect(parseHazardSlotSpend('spell_slot_3')).toBe(3);
    expect(parseHazardSlotSpend('slot_3')).toBe(3);
    expect(parseHazardSlotSpend('level_3')).toBe(3);
    expect(parseHazardSlotSpend('3')).toBe(3);
    expect(parseHazardSlotSpend('3_slot')).toBe(3);
    expect(parseHazardSlotSpend('SPELL_SLOT_1')).toBe(1);
    expect(parseHazardSlotSpend('action_surge')).toBeNull();
    expect(parseHazardSlotSpend('ki')).toBeNull();
    expect(parseHazardSlotSpend('')).toBeNull();
    expect(parseHazardSlotSpend('slot_10')).toBeNull();
  });

  function slottedTarget(extra: Partial<Combatant> = {}): Combatant {
    return makeCombatant({
      id: 't',
      name: 'T',
      side: 'monster',
      position: { x: 1, y: 0 },
      spellSlots: { '2': { max: 2, expended: 0, available: 2 } },
      ...extra,
    });
  }

  function drainState(target: Combatant, resourceId: string, amount = 1) {
    const caster = makeCombatant({ id: 'caster', name: 'Wiz', position: { x: 0, y: 0 } });
    const state = makeState([caster, target], 21);
    const created = createHazardZone(state, {
      zoneId: 'drain-zone',
      casterId: 'caster',
      sourceName: 'Drain Zone',
      shape: 'sphere',
      origin: { x: 1, y: 0 },
      sizeFeet: 10,
      durationRounds: 10,
      onEnterOrStartTurn: [{ step: 'spend_resource', resourceId, amount }],
      cells: [{ x: 1, y: 0 }],
    });
    const zone = Object.values(created.state.hazardZones ?? {})[0]!;
    return executeHazardZoneEffects(created.state, zone, created.state.combatants['t']!, 'enter');
  }

  it('expends a tracked slot and emits RESOURCE_SPENT', () => {
    expect(hazardSlotSpendAvailable(slottedTarget(), 2, 1)).toBe(true);
    const res = drainState(slottedTarget(), 'spell_slot_2', 1);
    expect(res.state.combatants['t']!.spellSlots!['2']).toMatchObject({ expended: 1, available: 1 });
    const spent = res.events.find((e) => e.type === 'RESOURCE_SPENT') as unknown as {
      entityId: string;
      resourceId: string;
      amount: number;
      slotLevel: number;
    };
    expect(spent.entityId).toBe('t');
    expect(spent.slotLevel).toBe(2);
    expect(spent.amount).toBe(1);
    expect(res.events.some((e) => e.type === 'HAZARD_ZONE_STEP_SKIPPED')).toBe(false);
  });

  it('is all-or-nothing on insufficient slots (explicit skip, no partial)', () => {
    const res = drainState(slottedTarget(), 'slot_2', 3);
    expect(res.state.combatants['t']!.spellSlots!['2']).toMatchObject({ expended: 0, available: 2 });
    expect(
      res.events.some(
        (e) =>
          e.type === 'HAZARD_ZONE_STEP_SKIPPED' &&
          (e as { reason: string }).reason === 'insufficient_spell_slot_2',
      ),
    ).toBe(true);
  });

  it('marks untracked resources explicitly instead of dropping them', () => {
    const res = drainState(slottedTarget(), 'action_surge', 1);
    expect(
      res.events.some(
        (e) =>
          e.type === 'HAZARD_ZONE_STEP_SKIPPED' &&
          (e as { reason: string }).reason === 'untracked_resource_action_surge',
      ),
    ).toBe(true);
  });

  it('expendHazardSpellSlot mirrors the character-sheet pool', () => {
    const target = makeCombatant({
      id: 't',
      name: 'T',
      spellSlots: { '1': { max: 3, expended: 0, available: 3 } },
      characterSheet: {
        spellcasting: { spellSlots: { 1: { max: 3, expended: 0, available: 3 } } },
      } as never,
    });
    const next = expendHazardSpellSlot(target, 1, 2);
    expect(next.spellSlots!['1']).toMatchObject({ expended: 2, available: 1 });
    expect(next.characterSheet!.spellcasting!.spellSlots[1]).toMatchObject({
      expended: 2,
      available: 1,
    });
  });
});

describe('SRD-1205: summon_creature stays explicitly unsupported (never silent)', () => {
  it('emits a named skip and nothing else is dropped', () => {
    const caster = makeCombatant({ id: 'caster', name: 'Wiz', position: { x: 0, y: 0 } });
    const target = makeCombatant({ id: 't', name: 'T', side: 'monster', position: { x: 1, y: 0 } });
    const state = makeState([caster, target], 21);
    const created = createHazardZone(state, {
      zoneId: 'spawn-zone',
      casterId: 'caster',
      sourceName: 'Spawn Zone',
      shape: 'sphere',
      origin: { x: 1, y: 0 },
      sizeFeet: 10,
      durationRounds: 10,
      onEnterOrStartTurn: [
        {
          step: 'summon_creature',
          summonId: 'x',
          name: 'X',
          durationRounds: 2,
          requiresConcentration: false,
          placement: 'unoccupied_within_range',
          statblock: { size: 'medium', speedFeet: 30 },
          control: 'commanded',
        },
      ],
      cells: [{ x: 1, y: 0 }],
    });
    const zone = Object.values(created.state.hazardZones ?? {})[0]!;
    const res = executeHazardZoneEffects(created.state, zone, created.state.combatants['t']!, 'enter');
    expect(
      res.events.some(
        (e) =>
          e.type === 'HAZARD_ZONE_STEP_SKIPPED' &&
          (e as { reason: string }).reason === 'no_hazard_resolver_for_summon_creature',
      ),
    ).toBe(true);
  });

  it('shrinks the unsupported set to summon_creature only', () => {
    expect(HAZARD_UNSUPPORTED_STEPS.has('summon_creature')).toBe(true);
    expect(HAZARD_UNSUPPORTED_STEPS.has('teleport')).toBe(false);
    expect(HAZARD_UNSUPPORTED_STEPS.has('create_hazard_zone')).toBe(false);
    expect(HAZARD_UNSUPPORTED_STEPS.has('spend_resource')).toBe(false);
    expect(HAZARD_UNSUPPORTED_STEPS.size).toBe(1);
  });
});
