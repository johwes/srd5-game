import { describe, expect, it } from 'vitest';
import type { SpellData } from '@srd5/data';
import {
  aimRangeFeet,
  buildPendingTargetForAttack,
  buildPendingTargetForSpell,
  canCommitPending,
  commitAoeTarget,
  isSelfEmanation,
  needsDirectionPick,
  pendingTargetHint,
  validateTargetPick,
  STACKABLE_MULTI_SPELLS,
} from '../utils/pendingTargeting.js';

const caster: any = {
  id: 'hero-wizard',
  name: 'Lyra',
  side: 'party',
  teamId: 'party',
  position: { x: 2, y: 2 },
  size: 'medium',
  currentHp: 16,
  isDead: false,
};

const goblin: any = {
  id: 'goblin-1',
  name: 'Goblin',
  side: 'monster',
  teamId: 'monsters',
  position: { x: 4, y: 2 },
  size: 'small',
  currentHp: 7,
  isDead: false,
};

const ally: any = {
  id: 'hero-fighter',
  name: 'Garrick',
  side: 'party',
  teamId: 'party',
  position: { x: 2, y: 3 },
  size: 'medium',
  currentHp: 24,
  isDead: false,
};

const combatants = { [caster.id]: caster, [goblin.id]: goblin, [ally.id]: ally };

function spellFixture(overrides: Partial<SpellData> = {}): SpellData {
  return {
    id: 'fire-bolt',
    name: 'Fire Bolt',
    level: 0,
    school: 'evocation',
    castingTime: '1 action',
    targeting: { type: 'single', rangeFeet: 120, targetFilter: 'enemy' },
    effects: [],
    ...overrides,
  } as unknown as SpellData;
}

describe('SRD-410 manual targeting state machine', () => {
  it('arms single-target attacks with weapon range', () => {
    const pending = buildPendingTargetForAttack({
      id: 'longsword',
      weaponId: 'longsword',
      name: 'Longsword',
      rangeType: 'melee',
      reachFeet: 5,
    });
    expect(pending.kind).toBe('single');
    if (pending.kind === 'single') {
      expect(pending.action).toBe('attack');
      expect(pending.rangeFeet).toBe(5);
      expect(canCommitPending(pending)).toBe(false); // singles commit on click
    }
  });

  it('fires self spells immediately (no pending)', () => {
    const pending = buildPendingTargetForSpell(
      spellFixture({ targeting: { type: 'self', rangeFeet: 0 } }),
    );
    expect(pending).toBeNull();
  });

  it('arms multi-target spells with stacking for magic missile', () => {
    expect(STACKABLE_MULTI_SPELLS.has('magic-missile')).toBe(true);
    const pending = buildPendingTargetForSpell(
      spellFixture({
        id: 'magic-missile',
        name: 'Magic Missile',
        level: 1,
        targeting: { type: 'multiple', rangeFeet: 120, targetFilter: 'enemy' },
      }),
      1,
    );
    expect(pending?.kind).toBe('multi');
  });

  it('arms AOE spells with shape and size', () => {
    const pending = buildPendingTargetForSpell(
      spellFixture({
        id: 'burning-hands',
        name: 'Burning Hands',
        level: 1,
        targeting: { type: 'point_aoe', rangeFeet: 15, targetFilter: 'enemy', aoe: { shape: 'cone', sizeFeet: 15 } },
      }),
      1,
    );
    expect(pending?.kind).toBe('aoe');
    if (pending?.kind === 'aoe') {
      expect(pending.shape).toBe('cone');
      expect(canCommitPending({ ...pending, origin: null })).toBe(false);
      expect(canCommitPending({ ...pending, origin: { x: 3, y: 3 } })).toBe(true);
    }
  });

  it('validates token picks by range, disposition, and vitality', () => {
    const attack = buildPendingTargetForAttack({
      id: 'fire-bolt', name: 'Fire Bolt', rangeType: 'ranged', rangeFeet: { normal: 120 },
    });
    if (attack.kind === 'none') throw new Error('expected armed attack');
    expect(validateTargetPick(attack, goblin, caster, combatants)).toEqual({ ok: true });
    // friendly fire blocked for hostile spells
    expect(validateTargetPick(attack, ally, caster, combatants).ok).toBe(false);
    // dead targets rejected
    expect(
      validateTargetPick(attack, { ...goblin, currentHp: 0, isDead: true }, caster, combatants).ok,
    ).toBe(false);
    // out of range rejected
    const far = { ...goblin, position: { x: 60, y: 60 } };
    const res = validateTargetPick(attack, far, caster, combatants);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/out of range/);
  });

  it('describes hints for each pending kind', () => {
    const attack = buildPendingTargetForAttack({
      id: 'longsword', name: 'Longsword', rangeType: 'melee', reachFeet: 5,
    });
    expect(pendingTargetHint(attack)).toMatch(/Click an enemy/);
    expect(pendingTargetHint({ kind: 'none' })).toBe('');
  });

  it('models self-emanation AOEs: origin on caster, bearing picks for cones', () => {
    const cone = buildPendingTargetForSpell(
      spellFixture({
        id: 'burning-hands', name: 'Burning Hands', level: 1,
        targeting: { type: 'self_aoe', rangeFeet: 0, targetFilter: 'enemy', aoe: { shape: 'cone', sizeFeet: 15 } },
      }),
      1,
    );
    if (cone?.kind !== 'aoe') throw new Error('expected armed cone');
    expect(isSelfEmanation(cone)).toBe(true);
    expect(needsDirectionPick(cone)).toBe(true);
    expect(aimRangeFeet(cone)).toBe(15);
    // No bearing yet: not committable.
    expect(commitAoeTarget(cone, { x: 2, y: 2 })).toBeNull();
    // Bearing picked east of the caster: origin snaps to caster + directionRad 0.
    const aimed = { ...cone, origin: { x: 5, y: 2 } };
    const commit = commitAoeTarget(aimed, { x: 2, y: 2 });
    expect(commit).toEqual({ targetCell: { x: 2, y: 2 }, directionRad: 0 });

    const sphere = buildPendingTargetForSpell(
      spellFixture({
        id: 'shatter', name: 'Shatter', level: 2,
        targeting: { type: 'self_aoe', rangeFeet: 0, targetFilter: 'enemy', aoe: { shape: 'sphere', sizeFeet: 10 } },
      }),
      2,
    );
    if (sphere?.kind !== 'aoe') throw new Error('expected armed sphere');
    expect(isSelfEmanation(sphere)).toBe(true);
    expect(needsDirectionPick(sphere)).toBe(false);
    expect(aimRangeFeet(sphere)).toBe(0);
  });
});
