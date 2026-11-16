import { describe, expect, it } from 'vitest';
import type { PlayerViewCombatant } from '@srd5/transport';
import { defaultCompendium } from '@srd5/data';
import {
  buildPendingTargetForAttack,
  buildPendingTargetForSpell,
  canCommitPending,
  pendingTargetHint,
  validateTargetPick,
} from './pendingTargeting.js';
import { resolveSpellTargets } from './combatTargeting.js';

function makeCombatant(overrides: Partial<PlayerViewCombatant> & { id: string }): PlayerViewCombatant {
  return {
    name: overrides.id,
    side: 'party',
    teamId: 'party',
    position: { x: 0, y: 0 },
    size: 'medium',
    currentHp: 10,
    maxHp: 10,
    isDead: false,
    armorClass: 10,
    speedFeet: 30,
    ...overrides,
  } as PlayerViewCombatant;
}

describe('SRD-410 pending targeting', () => {
  it('builds single pending for sword with melee reach', () => {
    const p = buildPendingTargetForAttack({
      id: 'longsword',
      weaponId: 'longsword',
      name: 'Longsword',
      rangeType: 'melee',
      reachFeet: 5,
    });
    expect(p.kind).toBe('single');
    if (p.kind === 'single') {
      expect(p.rangeFeet).toBe(5);
      expect(p.disposition).toBe('hostile');
    }
  });

  it('builds multi distinct pending for Bless', () => {
    const bless = defaultCompendium.getSpell('bless')!;
    const p = buildPendingTargetForSpell(bless, 1);
    expect(p?.kind).toBe('multi');
    if (p?.kind === 'multi') {
      expect(p.maxTargets).toBe(3);
      expect(p.allowDuplicates).toBe(false);
      expect(pickedCanCommit(p)).toBe(false);
    }
  });

  it('builds stacked multi pending for Magic Missile with slot scaling', () => {
    const mm = defaultCompendium.getSpell('magic-missile')!;
    const p1 = buildPendingTargetForSpell(mm, 1);
    const p2 = buildPendingTargetForSpell(mm, 2);
    expect(p1?.kind).toBe('multi');
    if (p1?.kind === 'multi' && p2?.kind === 'multi') {
      expect(p1.maxTargets).toBe(3);
      expect(p1.allowDuplicates).toBe(true);
      expect(p2.maxTargets).toBe(4);
    }
  });

  it('builds aoe pending for Fireball with sphere geometry', () => {
    const fb = defaultCompendium.getSpell('fireball')!;
    const p = buildPendingTargetForSpell(fb, 3);
    expect(p?.kind).toBe('aoe');
    if (p?.kind === 'aoe') {
      expect(p.shape).toBe('sphere');
      expect(p.sizeFeet).toBe(20);
      expect(p.rangeFeet).toBe(150);
      expect(canCommitPending(p)).toBe(false);
      expect(pendingTargetHint(p)).toContain('Click a point');
    }
  });

  it('validates hostile single rejects allies and out-of-range', () => {
    const caster = makeCombatant({ id: 'hero', position: { x: 0, y: 0 } });
    const ally = makeCombatant({ id: 'ally', position: { x: 1, y: 0 } });
    const foe = makeCombatant({ id: 'goblin', side: 'monster', teamId: 'monsters', position: { x: 1, y: 0 } });
    const far = makeCombatant({ id: 'far', side: 'monster', teamId: 'monsters', position: { x: 10, y: 0 } });
    const pending = buildPendingTargetForAttack({
      id: 'sword',
      name: 'Sword',
      rangeType: 'melee',
      reachFeet: 5,
    });
    expect(pending.kind).toBe('single');
    if (pending.kind !== 'single') return;
    expect(validateTargetPick(pending, foe, caster, {}).ok).toBe(true);
    expect(validateTargetPick(pending, ally, caster, {}).ok).toBe(false);
    expect(validateTargetPick(pending, far, caster, {}).ok).toBe(false);
  });

  it('resolveSpellTargets honors stacked manual picks for Magic Missile', () => {
    const mm = defaultCompendium.getSpell('magic-missile')!;
    const caster = makeCombatant({ id: 'wizard', position: { x: 0, y: 0 } });
    const goblin = makeCombatant({ id: 'goblin-1', side: 'monster', teamId: 'monsters', position: { x: 5, y: 0 } });
    const combatants = { wizard: caster, 'goblin-1': goblin };
    const res = resolveSpellTargets({
      spell: mm,
      slotLevel: 1,
      caster,
      combatants,
      pickedTargetIds: ['goblin-1', 'goblin-1', 'goblin-1'],
      allowDuplicates: true,
    });
    expect(res.errorFeedback).toBeUndefined();
    expect(res.targetIds).toEqual(['goblin-1', 'goblin-1', 'goblin-1']);
  });

  it('resolveSpellTargets rejects duplicate picks for Bless', () => {
    const bless = defaultCompendium.getSpell('bless')!;
    const caster = makeCombatant({ id: 'cleric', position: { x: 0, y: 0 } });
    const ally = makeCombatant({ id: 'fighter', position: { x: 1, y: 0 } });
    const combatants = { cleric: caster, fighter: ally };
    const res = resolveSpellTargets({
      spell: bless,
      slotLevel: 1,
      caster,
      combatants,
      pickedTargetIds: ['fighter', 'fighter'],
      allowDuplicates: false,
    });
    expect(res.errorFeedback).toMatch(/twice/);
  });
});

function pickedCanCommit(p: { kind: string }): boolean {
  return canCommitPending(p as never);
}
