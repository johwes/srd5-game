import { describe, expect, it } from 'vitest';
import { compendium } from '@srd5/data';
import { createMonsterCombatant } from '../combat/combatant.js';
import { executeSpellCast } from '../combat/spellcasting.js';
import { executeWeaponAttack } from '../combat/attack.js';
import { endTurn } from '../combat/state-machine.js';
import { executeOutOfCombatSpellCast } from '../combat/out-of-combat-casting.js';
import {
  WISH_BOON_IDS,
  isTimeFrozen,
  maybeBreachTimeStopOnTargets,
  rollTimeStopTurns,
  rollWishStress,
  resolveWishBoon,
  startTimeStop,
  endTimeStop,
} from '../combat/capstones.js';
import type { CombatState, Combatant } from '../combat/types.js';

function buildState(list: Combatant[]): CombatState {
  const map: Record<string, Combatant> = {};
  for (const c of list) map[c.id] = c;
  return {
    encounterId: 'capstone-1210',
    round: 1,
    phase: 'active_turn',
    initiativeOrder: list.map((c) => ({
      entityId: c.id,
      initiative: 10,
      naturalRoll: 10,
      dexterityScore: c.dexterityScore,
      tieBreaker: 10,
    })),
    activeCombatantIndex: 0,
    activeCombatantId: list[0]?.id ?? null,
    turnBudget: {
      action: 1,
      bonusAction: 1,
      reactionAvailable: true,
      movementRemainingFeet: 30,
      freeObjectInteraction: 1,
      bonusActionSpellCast: false,
      leveledActionSpellCast: false,
      attackActionTaken: false,
      extraAttacksRemaining: 0,
      disengaged: false,
      dodging: false,
    },
    combatants: map,
    surprisedCombatantIds: [],
    outcome: 'in_progress',
    rngState: 1234,
  };
}

function makeCaster(id: string): Combatant {
  const c = createMonsterCombatant(compendium.requireMonster('mage'), id, { x: 0, y: 0 }, { side: 'party' });
  const slots = {} as Record<string, { max: number; expended: number; available: number }>;
  for (let l = 1; l <= 9; l++) slots[String(l)] = { max: 2, expended: 0, available: 2 };
  c.spellSlots = slots;
  c.strengthScore = 16;
  c.strengthModifier = 3;
  return c;
}

describe('SRD-1210: Bounded Wish menu + Time Stop sequencing', () => {
  it('exposes exactly the 6 bounded Wish boons', () => {
    expect(WISH_BOON_IDS).toContain('restore-party');
    expect(WISH_BOON_IDS).toContain('grant-resistance');
    expect(WISH_BOON_IDS).toContain('supply-cache');
    expect(WISH_BOON_IDS).toContain('full-rest');
    expect(WISH_BOON_IDS).toContain('mass-heal');
    expect(WISH_BOON_IDS).toContain('resurrection');
    expect(WISH_BOON_IDS).toHaveLength(6);
  });

  it('rolls Wish stress deterministically (2d4 days + d100 loss)', () => {
    const a = rollWishStress(42);
    const b = rollWishStress(42);
    expect(a).toEqual(b);
    expect(a.recoveryDays).toBeGreaterThanOrEqual(2);
    expect(a.recoveryDays).toBeLessThanOrEqual(8);
    expect(a.lossRoll).toBeGreaterThanOrEqual(1);
    expect(a.lossRoll).toBeLessThanOrEqual(100);
    expect(a.wishLost).toBe(a.lossRoll <= 33);
  });

  it('resolveWishBoon mass-heal heals allies and applies stress (STR 3, collapse, loss flag)', () => {
    const caster = makeCaster('caster');
    const ally = createMonsterCombatant(compendium.requireMonster('bandit'), 'ally', { x: 1, y: 0 }, { side: 'party' });
    ally.maxHp = 100;
    ally.currentHp = 10;
    const state = buildState([caster, ally]);
    const res = resolveWishBoon({ state, casterId: caster.id, boonId: 'mass-heal' });
    const healed = res.state.combatants['ally']!;
    expect(healed.currentHp).toBeGreaterThan(10);
    expect(res.healedIds).toContain('ally');
    expect(res.events.some((e) => e.type === 'WISH_BOON_RESOLVED')).toBe(true);
    const stressed = res.state.combatants['caster']!;
    expect(stressed.strengthScore).toBe(3);
    expect(stressed.strengthModifier).toBe(-4);
    expect(stressed.wishStressActive).toBe(true);
    expect(stressed.wishStressDaysRemaining).toBe(res.stress.recoveryDays);
    expect(stressed.conditions).toContain('incapacitated');
    expect(stressed.wishLost).toBe(res.stress.wishLost);
    // Deterministic replay.
    const again = resolveWishBoon({ state, casterId: caster.id, boonId: 'mass-heal' });
    expect(JSON.stringify(res.events)).toBe(JSON.stringify(again.events));
  });

  it('Wish restore-party cleanses and heals; grant-resistance wards; supply-cache grants temp HP', () => {
    const caster = makeCaster('caster');
    const ally = createMonsterCombatant(compendium.requireMonster('bandit'), 'ally', { x: 1, y: 0 }, { side: 'party' });
    ally.maxHp = 60;
    ally.currentHp = 20;
    ally.conditions = ['blinded', 'poisoned'];
    let state = buildState([caster, ally]);
    const restore = resolveWishBoon({ state, casterId: caster.id, boonId: 'restore-party' });
    expect(restore.state.combatants['ally']!.conditions).not.toContain('blinded');
    expect(restore.state.combatants['ally']!.currentHp).toBeGreaterThan(20);

    state = buildState([makeCaster('caster'), ally]);
    const ward = resolveWishBoon({ state, casterId: 'caster', boonId: 'grant-resistance', resistanceType: 'fire' as never });
    expect(ward.state.combatants['ally']!.damageResistances).toContain('fire');

    state = buildState([makeCaster('caster'), ally]);
    const cache = resolveWishBoon({ state, casterId: 'caster', boonId: 'supply-cache' });
    expect(cache.state.combatants['ally']!.tempHp).toBeGreaterThan(0);
  });

  it('Wish full-rest restores HP/slots/exhaustion; resurrection revives the fallen', () => {
    const caster = makeCaster('caster');
    caster.spellSlots!['9'] = { max: 1, expended: 1, available: 0 };
    const ally = createMonsterCombatant(compendium.requireMonster('bandit'), 'ally', { x: 1, y: 0 }, { side: 'party' });
    ally.maxHp = 50;
    ally.currentHp = 5;
    ally.exhaustionLevel = 2;
    ally.conditions = ['exhaustion'];
    let state = buildState([caster, ally]);
    const rest = resolveWishBoon({ state, casterId: caster.id, boonId: 'full-rest' });
    expect(rest.state.combatants['ally']!.currentHp).toBe(50);
    expect(rest.state.combatants['ally']!.exhaustionLevel).toBe(0);
    expect(rest.state.combatants['caster']!.spellSlots!['9']!.available).toBe(1);

    const dead = createMonsterCombatant(compendium.requireMonster('bandit'), 'fallen', { x: 2, y: 0 }, { side: 'party' });
    dead.maxHp = 40;
    dead.currentHp = 0;
    dead.isDead = true;
    state = buildState([makeCaster('caster2'), dead]);
    const rez = resolveWishBoon({ state, casterId: 'caster2', boonId: 'resurrection', resurrectionTargetId: 'fallen' });
    expect(rez.revivedId).toBe('fallen');
    expect(rez.state.combatants['fallen']!.isDead).toBe(false);
    expect(rez.state.combatants['fallen']!.currentHp).toBe(20);
  });

  it('Wish via executeSpellCast with a boon resolves the bundle; without a boon keeps the legacy card', () => {
    const wish = compendium.requireSpell('wish');
    const caster = makeCaster('caster');
    const ally = createMonsterCombatant(compendium.requireMonster('bandit'), 'ally', { x: 1, y: 0 }, { side: 'party' });
    ally.maxHp = 80;
    ally.currentHp = 8;
    const state = buildState([caster, ally]);
    const withBoon = executeSpellCast({
      state,
      casterId: caster.id,
      spell: wish,
      slotLevel: 9,
      wishBoonId: 'mass-heal',
      skipReactionPrompts: true,
    });
    expect(withBoon.events.some((e) => e.type === 'WISH_BOON_RESOLVED')).toBe(true);
    expect(withBoon.state.combatants['ally']!.currentHp).toBeGreaterThan(8);

    const caster2 = makeCaster('caster');
    const state2 = buildState([caster2]);
    const legacy = executeSpellCast({
      state: state2,
      casterId: caster2.id,
      spell: wish,
      slotLevel: 9,
      skipReactionPrompts: true,
    });
    expect(legacy.events.some((e) => e.type === 'MANUAL_ADJUDICATION_REQUIRED')).toBe(true);
    expect(legacy.events.some((e) => e.type === 'WISH_BOON_RESOLVED')).toBe(false);
  });

  it('Wish out of combat resolves the mass-heal bundle', () => {
    const caster = makeCaster('caster');
    caster.position = { x: 0, y: 0 };
    const ally = createMonsterCombatant(compendium.requireMonster('bandit'), 'ally', { x: 1, y: 0 }, { side: 'party' });
    ally.maxHp = 60;
    ally.currentHp = 6;
    ally.position = { x: 1, y: 0 };
    const res = executeOutOfCombatSpellCast({
      party: { [caster.id]: caster, [ally.id]: ally },
      casterId: caster.id,
      spellId: 'wish',
      slotLevel: 9,
      wishBoonId: 'mass-heal',
      rngState: 77,
    });
    expect(res.events.some((e) => e.type === 'WISH_BOON_RESOLVED')).toBe(true);
    expect(res.party['ally']!.currentHp).toBeGreaterThan(6);
  });

  it('rejects a second Wish after the 33% loss (when the seed loses)', () => {
    // Find a seed that loses (loss roll <= 33) to verify the gate headlessly.
    let losingSeed: number | null = null;
    for (let s = 0; s < 200; s++) {
      if (rollWishStress(s).wishLost) {
        losingSeed = s;
        break;
      }
    }
    expect(losingSeed).not.toBeNull();
    const caster = makeCaster('caster');
    const state = buildState([caster]);
    const first = resolveWishBoon({ state, casterId: caster.id, boonId: 'mass-heal', rngState: losingSeed! });
    expect(first.stress.wishLost).toBe(true);
    expect(first.state.combatants['caster']!.wishLost).toBe(true);
    const wish = compendium.requireSpell('wish');
    // Collapse (1-round incapacitation) expires before the second attempt;
    // the loss gate is what must block the re-cast.
    const recovered = {
      ...first.state.combatants['caster']!,
      conditions: first.state.combatants['caster']!.conditions.filter((c) => c !== 'incapacitated'),
    };
    const state2 = buildState([recovered]);
    expect(() =>
      executeSpellCast({
        state: state2,
        casterId: 'caster',
        spell: wish,
        slotLevel: 9,
        wishBoonId: 'mass-heal',
        skipReactionPrompts: true,
      }),
    ).toThrow(/lost the ability to cast Wish/);
  });

  it('rolls Time Stop turns deterministically in 2..5', () => {
    const a = rollTimeStopTurns(42);
    const b = rollTimeStopTurns(42);
    expect(a.totalTurns).toBe(b.totalTurns);
    expect(a.totalTurns).toBeGreaterThanOrEqual(2);
    expect(a.totalTurns).toBeLessThanOrEqual(5);
  });

  it('Time Stop via executeSpellCast opens a frozen window with an adjudication card', () => {
    const ts = compendium.requireSpell('time-stop');
    const caster = makeCaster('caster');
    const foe = createMonsterCombatant(compendium.requireMonster('bandit'), 'foe', { x: 5, y: 5 }, { side: 'monster' });
    const state = buildState([caster, foe]);
    const res = executeSpellCast({
      state,
      casterId: caster.id,
      spell: ts,
      slotLevel: 9,
      skipReactionPrompts: true,
    });
    expect(res.events.some((e) => e.type === 'TIME_STOP_STARTED')).toBe(true);
    expect(res.events.some((e) => e.type === 'MANUAL_ADJUDICATION_REQUIRED')).toBe(true);
    const started = res.events.find((e) => e.type === 'TIME_STOP_STARTED');
    expect(res.state.timeStop?.casterId).toBe(caster.id);
    expect(res.state.timeStop?.totalTurns).toBe(
      started?.type === 'TIME_STOP_STARTED' ? started.totalTurns : -1,
    );
    expect(isTimeFrozen(res.state, 'foe')).toBe(true);
    expect(isTimeFrozen(res.state, 'caster')).toBe(false);
  });

  it('Time Stop chains solo caster turns and then resumes (no round advance during solos)', () => {
    const caster = makeCaster('caster');
    const foe = createMonsterCombatant(compendium.requireMonster('bandit'), 'foe', { x: 5, y: 5 }, { side: 'monster' });
    let state = buildState([caster, foe]);
    // Force initiative order caster -> foe.
    state.initiativeOrder = [
      { entityId: 'caster', initiative: 20, naturalRoll: 20, dexterityScore: 14, tieBreaker: 10 },
      { entityId: 'foe', initiative: 10, naturalRoll: 10, dexterityScore: 10, tieBreaker: 5 },
    ];
    state.activeCombatantIndex = 0;
    state.activeCombatantId = 'caster';
    const opened = startTimeStop(state, 'caster');
    state = opened.state;
    const total = opened.totalTurns;
    expect(total).toBeGreaterThanOrEqual(2);
    const roundBefore = state.round;
    let casterTurns = 0;
    // End the casting turn + each solo turn; every intermediate turn must be the caster.
    for (let i = 0; i < total; i++) {
      const after = endTurn(state);
      state = after.state;
      if (i < total - 1 || total === 1) {
        // Still inside or on the last solo turn: active must be caster and window retained appropriately.
      }
      // Count caster turns started (TURN_STARTED for caster).
      casterTurns += after.events.filter((e) => e.type === 'TURN_STARTED' && e.entityId === 'caster').length;
      if (state.timeStop) {
        expect(state.activeCombatantId).toBe('caster');
        expect(state.round).toBe(roundBefore);
      }
    }
    expect(casterTurns).toBe(total);
    // After the final solo turn ends, the window closes and foe acts.
    const fin = endTurn(state);
    expect(fin.events.some((e) => e.type === 'TIME_STOP_ENDED')).toBe(true);
    expect(fin.state.timeStop).toBeUndefined();
    expect(fin.state.activeCombatantId).toBe('foe');
  });

  it('Time Stop ends early on breach (affecting another creature)', () => {
    const caster = makeCaster('caster');
    const foe = createMonsterCombatant(compendium.requireMonster('bandit'), 'foe', { x: 1, y: 0 }, { side: 'monster' });
    foe.armorClass = 5;
    foe.maxHp = 200;
    foe.currentHp = 200;
    let state = buildState([caster, foe]);
    const opened = startTimeStop(state, 'caster');
    state = opened.state;
    expect(isTimeFrozen(state, 'foe')).toBe(true);
    // A self-only note does not breach.
    const noBreach = maybeBreachTimeStopOnTargets(state, 'caster', ['caster']);
    expect(noBreach.ended).toBe(false);
    // Affecting another breaches.
    const breach = maybeBreachTimeStopOnTargets(state, 'caster', ['caster', 'foe']);
    expect(breach.ended).toBe(true);
    expect(breach.events.some((e) => e.type === 'TIME_STOP_ENDED')).toBe(true);
    expect(breach.state.timeStop).toBeUndefined();

    // Weapon attacks breach automatically.
    state = startTimeStop(buildState([makeCaster('caster'), foe]), 'caster').state;
    const atk = executeWeaponAttack({
      state: { ...state, activeCombatantId: 'caster', turnBudget: buildState([makeCaster('x')]).turnBudget },
      attackerId: 'caster',
      targetId: 'foe',
      attackProfileId: 'unarmed_strike',
    });
    expect(atk.events.some((e) => e.type === 'TIME_STOP_ENDED')).toBe(true);
    expect(atk.state.timeStop).toBeUndefined();
    // Explicit manual close is a no-op-safe helper.
    expect(endTimeStop(state, 'manual').ended).toBe(true);
  });
});
