import { describe, expect, it } from 'vitest';
import type { Combatant, CombatState } from '../combat/types.js';
import { applyShieldBuff } from '../combat/reactions.js';
import {
  SANCTUARY_WARD_EFFECT_ID,
  SHIELD_AC_EFFECT_ID,
  isShieldActiveEffect,
  hasSanctuaryWard,
  resolveSanctuaryWardAttack,
  resolveSleepHpPool,
  rollSleepPool,
  senseDetectMagic,
  KNOCK_AUDIBLE_FEET,
} from '../combat/marker-spells.js';
import { executeWeaponAttack } from '../combat/attack.js';
import { executeSpellCast } from '../combat/spellcasting.js';
import { executeHazardZoneEffects, createHazardZone } from '../combat/hazard-zone.js';
import { createTacticalGrid } from '../grid/model.js';
import { resolveKnockOnProp } from '../dungeon/props.js';
import { createInitialGameState, reduceGame } from '../state/reducer.js';

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

describe('SRD-1204: shield buff-id reconcile', () => {
  it('plants the canonical shield-ac-bonus id recognised by the data overlay', () => {
    const c = makeCombatant({ id: 'w', name: 'Wiz' });
    const buffed = applyShieldBuff(c);
    expect(buffed.activeEffects?.some((e) => e.effectId === SHIELD_AC_EFFECT_ID)).toBe(true);
    expect(buffed.activeEffects?.some((e) => e.effectId === 'shield_ac_buff')).toBe(false);
    expect(buffed.armorClass).toBe(c.armorClass + 5);
  });

  it('recognises the canonical id and both legacy ids on read', () => {
    expect(isShieldActiveEffect('shield-ac-bonus')).toBe(true);
    expect(isShieldActiveEffect('shield_ac_buff')).toBe(true);
    expect(isShieldActiveEffect('shield')).toBe(true);
    expect(isShieldActiveEffect('mage-armor')).toBe(false);
  });
});

describe('SRD-1204: sanctuary ward', () => {
  function wardedTarget(): Combatant {
    return makeCombatant({
      id: 't',
      name: 'Ward',
      side: 'party',
      position: { x: 1, y: 0 },
      activeEffects: [
        {
          effectId: SANCTUARY_WARD_EFFECT_ID,
          name: 'Sanctuary',
          sourceEntityId: 'cleric',
          requiresConcentration: false,
          remainingRounds: 10,
          modifiers: [],
        },
      ],
    });
  }

  it('blocks an attack on a failed WIS save and emits the ward event', () => {
    const attacker = makeCombatant({ id: 'a', name: 'Gob', side: 'monster', position: { x: 0, y: 0 } });
    const target = wardedTarget();
    const state = makeState([attacker, target], 7);
    // Find a seed where a +0 WIS save vs DC 13 fails.
    let blocked: boolean | null = null;
    let seed = 1;
    for (; seed < 200; seed++) {
      const r = resolveSanctuaryWardAttack({ state, attackerId: 'a', targetId: 't', rngState: seed });
      if (r.blocked) {
        blocked = true;
        expect(r.events.some((e) => e.type === 'SANCTUARY_WARD_RESOLVED' && e.outcome === 'blocked')).toBe(true);
        expect(r.events.some((e) => e.type === 'SAVING_THROW_RESOLVED')).toBe(true);
        break;
      }
    }
    expect(blocked).toBe(true);
    expect(seed).toBeLessThan(200);
  });

  it('executeWeaponAttack loses the attack when the ward holds', () => {
    const attacker = makeCombatant({
      id: 'a',
      name: 'Gob',
      side: 'monster',
      position: { x: 0, y: 0 },
      characterSheet: {
        classes: [],
        weaponAttacks: [
          { weaponId: 'scimitar', name: 'Scimitar', toHitBonus: 4, damageFormula: '1d6+2', damageType: 'slashing', reachFeet: 5, properties: [] },
        ],
      } as never,
    });
    const target = wardedTarget();
    // Seed 7 fails the ward save for a bonus-0 attacker (verified above).
    const grid = createTacticalGrid(10, 10);
    let sawBlock = false;
    for (let s = 1; s < 200; s++) {
      const state = makeState(
        [
          { ...attacker },
          { ...target, activeEffects: [...(target.activeEffects ?? [])] },
        ],
        s,
      );
      const res = executeWeaponAttack({ state, attackerId: 'a', targetId: 't', grid });
      if (res.events.some((e) => e.type === 'SANCTUARY_WARD_RESOLVED' && (e as { outcome: string }).outcome === 'blocked')) {
        expect(res.outcome).toBe('miss');
        sawBlock = true;
        break;
      }
    }
    expect(sawBlock).toBe(true);
  });

  it('hasSanctuaryWard reflects the active effect', () => {
    expect(hasSanctuaryWard(wardedTarget())).toBe(true);
    expect(hasSanctuaryWard(makeCombatant({ id: 'x', name: 'X' }))).toBe(false);
  });
});

describe('SRD-1204: sleep HP pool', () => {
  it('rolls 5d8 at 1st level and upscales 2d8 per slot', () => {
    const base = rollSleepPool(100, 1);
    expect(base.poolFormula).toBe('5d8');
    expect(base.poolTotal).toBeGreaterThanOrEqual(5);
    expect(base.poolTotal).toBeLessThanOrEqual(40);
    const up = rollSleepPool(100, 3);
    expect(up.poolFormula).toBe('5d8 + 4d8');
  });

  it('affects creatures in ascending HP order and exhausts the pool', () => {
    const caster = makeCombatant({ id: 'caster', name: 'Wiz', position: { x: 0, y: 0 } });
    const weak = makeCombatant({ id: 'weak', name: 'Weak', side: 'monster', position: { x: 1, y: 0 }, currentHp: 5, maxHp: 12 });
    const mid = makeCombatant({ id: 'mid', name: 'Mid', side: 'monster', position: { x: 2, y: 0 }, currentHp: 9, maxHp: 12 });
    const tank = makeCombatant({ id: 'tank', name: 'Tank', side: 'monster', position: { x: 3, y: 0 }, currentHp: 30, maxHp: 40 });
    const state = makeState([caster, weak, mid, tank], 11);
    const res = resolveSleepHpPool({ state, casterId: 'caster', candidateIds: ['tank', 'mid', 'weak'], slotLevel: 1, rngState: 11 });
    // Ascending order regardless of input order.
    expect(res.affectedIds[0]).toBe('weak');
    // Pool accounting is exact: affected HP + remaining = pool total.
    const affectedHp = res.affectedIds.reduce((sum, id) => sum + state.combatants[id]!.currentHp, 0);
    expect(affectedHp + res.remainingPool).toBe(res.poolTotal);
    expect(res.events.some((e) => e.type === 'SLEEP_HP_POOL_RESOLVED')).toBe(true);
  });

  it('sleep via executeSpellCast applies unconscious only to pool winners', () => {
    const caster = makeCombatant({
      id: 'caster',
      name: 'Wiz',
      side: 'party',
      position: { x: 0, y: 0 },
      spellSlots: { '1': { max: 2, expended: 0, available: 2 } },
    });
    const weak = makeCombatant({ id: 'weak', name: 'Weak', side: 'monster', position: { x: 1, y: 0 }, currentHp: 4, maxHp: 12 });
    const tank = makeCombatant({ id: 'tank', name: 'Tank', side: 'monster', position: { x: 2, y: 0 }, currentHp: 40, maxHp: 60 });
    const state = makeState([caster, weak, tank], 5);
    const grid = createTacticalGrid(10, 10);
    const res = executeSpellCast({
      state,
      casterId: 'caster',
      spellId: 'sleep',
      slotLevel: 1,
      targetIds: ['weak', 'tank'],
      originCell: { x: 1, y: 0 },
      grid,
    });
    expect(res.events.some((e) => e.type === 'SLEEP_HP_POOL_RESOLVED')).toBe(true);
    // The 4-HP creature always fits in a 5d8 pool (min 5); the tank only if the pool is huge.
    expect(res.state.combatants['weak']!.conditions).toContain('unconscious');
    const sleepEvt = res.events.find((e) => e.type === 'SLEEP_HP_POOL_RESOLVED') as unknown as {
      affectedIds: string[];
    };
    expect(sleepEvt.affectedIds).toContain('weak');
  });

  it('skips undead and already-unconscious creatures', () => {
    const caster = makeCombatant({ id: 'caster', name: 'Wiz' });
    const zombie = makeCombatant({
      id: 'z',
      name: 'Zombie',
      side: 'monster',
      position: { x: 1, y: 0 },
      currentHp: 3,
      maxHp: 22,
      monsterData: { type: 'undead', abilities: { str: 10, dex: 10, con: 10, int: 3, wis: 6, cha: 5 } } as never,
    });
    const state = makeState([caster, zombie], 3);
    const res = resolveSleepHpPool({ state, casterId: 'caster', candidateIds: ['z'], slotLevel: 1, rngState: 3 });
    expect(res.affectedIds).not.toContain('z');
    expect(res.skippedIds.some((s) => s.id === 'z')).toBe(true);
  });
});

describe('SRD-1204: detect-magic sense', () => {
  it('reveals magical auras within 30 ft and ignores distant ones', () => {
    const observer = makeCombatant({ id: 'obs', name: 'Obs', position: { x: 0, y: 0 } });
    const near = makeCombatant({
      id: 'near',
      name: 'Near',
      side: 'monster',
      position: { x: 2, y: 0 },
      activeEffects: [{ effectId: 'bless-buff', name: 'Bless', requiresConcentration: true, remainingRounds: 10, modifiers: [] }],
      concentratingOn: { sourceId: 'bless', sourceName: 'Bless', targetEntityIds: ['near'], remainingRounds: 10 },
    });
    const far = makeCombatant({
      id: 'far',
      name: 'Far',
      side: 'monster',
      position: { x: 9, y: 9 },
      activeEffects: [{ effectId: 'bless-buff', name: 'Bless', requiresConcentration: true, remainingRounds: 10, modifiers: [] }],
    });
    const state = makeState([observer, near, far], 1);
    const sense = senseDetectMagic(state, 'obs');
    expect(sense.rangeFeet).toBe(30);
    expect(sense.auraCount).toBeGreaterThan(0);
    expect(sense.auras.some((a) => a.id.startsWith('near:'))).toBe(true);
    expect(sense.auras.some((a) => a.id.startsWith('far:'))).toBe(false);
  });
});

describe('SRD-1204: knock prop hook + alert tradeoff', () => {
  function knockGameState() {
    const grid = createTacticalGrid(12, 12);
    const hero = makeCombatant({
      id: 'hero',
      name: 'Hero',
      position: { x: 5, y: 5 },
      spellSlots: { '2': { max: 2, expended: 0, available: 2 } },
    });
    return { grid, hero };
  }

  it('unlocks a locked door and reports adjacent rooms with a 300-ft report', () => {
    const { grid, hero } = knockGameState();
    const s0 = createInitialGameState({
      grid,
      party: [hero],
      props: [
        { id: 'door-1', kind: 'door', state: 'locked', x: 6, y: 5, blocksMovement: true, blocksSight: true, lockDc: 15 },
      ],
      rngState: 99,
    });
    const res = resolveKnockOnProp({ state: s0, actorId: 'hero', propId: 'door-1' });
    expect(res.nextState.props.find((p) => p.id === 'door-1')!.state).toBe('closed');
    expect(res.events.some((e) => e.type === 'PROP_STATE_CHANGED')).toBe(true);
    const alert = res.events.find((e) => e.type === 'KNOCK_ALERTED') as unknown as {
      audibleFeet: number;
      alertedRoomIds: string[];
    };
    expect(alert.audibleFeet).toBe(KNOCK_AUDIBLE_FEET);
    expect(Array.isArray(alert.alertedRoomIds)).toBe(true);
  });

  it('DECLARE_CAST_SPELL knock unlocks the targeted lock out of combat', () => {
    const { grid } = knockGameState();
    const hero = makeCombatant({
      id: 'hero',
      name: 'Hero',
      position: { x: 5, y: 5 },
      spellSlots: { '2': { max: 2, expended: 0, available: 2 } },
    });
    const s0 = createInitialGameState({
      grid,
      party: [hero],
      props: [
        { id: 'chest-1', kind: 'chest', state: 'locked', x: 6, y: 5, blocksMovement: false, blocksSight: false, lockDc: 13 },
      ],
      rngState: 7,
    });
    const out = reduceGame(s0, {
      type: 'DECLARE_CAST_SPELL',
      actorId: 'hero',
      spellId: 'knock',
      slotLevel: 2,
      targetCell: { x: 6, y: 5 },
    });
    expect(out.nextState.props.find((p) => p.id === 'chest-1')!.state).toBe('closed');
    expect(out.events.some((e) => e.type === 'KNOCK_ALERTED')).toBe(true);
    expect(out.events.some((e) => e.type === 'SPELL_CAST')).toBe(true);
  });

  it('knock rejects non-lockable targets and out-of-range locks', () => {
    const grid = createTacticalGrid(8, 8);
    const hero = makeCombatant({ id: 'hero', name: 'Hero', position: { x: 0, y: 0 } });
    const s0 = createInitialGameState({
      grid,
      party: [hero],
      props: [{ id: 'lever-1', kind: 'lever', state: 'closed', x: 1, y: 0, blocksMovement: false, blocksSight: false }],
      rngState: 1,
    });
    expect(() => resolveKnockOnProp({ state: s0, actorId: 'hero', propId: 'lever-1' })).toThrow();
  });
});

describe('SRD-1204: hazard-zone onEnter step coverage (no silent drops)', () => {
  it('resolves heal/buff/attack shoves and explicitly skips summon (SRD-1205: teleport resolves)', () => {
    const caster = makeCombatant({ id: 'caster', name: 'Wiz', position: { x: 0, y: 0 } });
    const target = makeCombatant({ id: 't', name: 'T', side: 'monster', position: { x: 1, y: 0 }, currentHp: 5, maxHp: 20 });
    const grid = createTacticalGrid(10, 10);
    const state = makeState([caster, target], 21);
    const created = createHazardZone(state, {
      zoneId: 'test-zone',
      casterId: 'caster',
      sourceName: 'Test Zone',
      shape: 'sphere',
      origin: { x: 1, y: 0 },
      sizeFeet: 10,
      durationRounds: 10,
      onEnterOrStartTurn: [
        { step: 'heal', diceFormula: '1d4' },
        { step: 'grant_temp_hp', amountFormula: '4' },
        { step: 'apply_active_effect', effectId: 'zone-ward', name: 'Zone Ward', durationRounds: 2, requiresConcentration: false, modifiers: [] },
        { step: 'forced_movement', direction: 'push_from_actor', distanceFeet: 5 },
        { step: 'teleport', maxDistanceFeet: 30 },
        { step: 'summon_creature', summonId: 'x', name: 'X', durationRounds: 2, requiresConcentration: false, placement: 'unoccupied_within_range', statblock: { size: 'medium', speedFeet: 30 }, control: 'commanded' },
      ],
      cells: [{ x: 1, y: 0 }],
    });
    const zone = Object.values(created.state.hazardZones ?? {})[0]!;
    const res = executeHazardZoneEffects(created.state, zone, created.state.combatants['t']!, 'enter');
    expect(res.events.some((e) => e.type === 'HEAL_APPLIED')).toBe(true);
    expect(res.events.some((e) => e.type === 'TEMP_HP_APPLIED')).toBe(true);
    expect(res.state.combatants['t']!.activeEffects?.some((e) => e.effectId === 'zone-ward')).toBe(true);
    // SRD-1205: teleport now relocates the triggering creature (forced shove
    // moved it +1 cell, then teleport flings it further along the same ray).
    expect(
      res.events.some(
        (e) => e.type === 'ENTITY_MOVED' && (e as { mode: string }).mode === 'teleport',
      ),
    ).toBe(true);
    const skipped = res.events.filter((e) => e.type === 'HAZARD_ZONE_STEP_SKIPPED');
    expect(skipped.length).toBe(1);
    expect(new Set(skipped.map((s) => (s as unknown as { step: string }).step))).toEqual(new Set(['summon_creature']));
    void grid;
  });
});

describe('SRD-1204: shared-language precondition still enforced', () => {
  it('command does not affect a target that cannot understand the caster', () => {
    const caster = makeCombatant({
      id: 'caster',
      name: 'Bard',
      position: { x: 0, y: 0 },
      spellSlots: { '1': { max: 2, expended: 0, available: 2 } },
      characterSheet: { proficiencies: { languages: ['common'] }, spellcasting: { primarySpellSaveDc: 13, primarySpellAttackBonus: 5, primaryAbility: 'cha' } } as never,
    });
    const target = makeCombatant({
      id: 'orc',
      name: 'Orc',
      side: 'monster',
      position: { x: 1, y: 0 },
      monsterData: { languages: ['orc'], abilities: { str: 12, dex: 10, con: 12, int: 8, wis: 10, cha: 8 } } as never,
    });
    const state = makeState([caster, target], 4);
    const res = executeSpellCast({ state, casterId: 'caster', spellId: 'command', slotLevel: 1, targetIds: ['orc'] });
    expect(res.targetsUnaffectedByLanguage).toContain('orc');
    expect(res.events.some((e) => e.type === 'SPELL_TARGET_UNAFFECTED')).toBe(true);
  });
});
