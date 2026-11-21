import { z } from 'zod';
import type { DamageType } from '@srd5/data';
import { normalizeSeed } from '../dice/prng.js';
import { rollDamage, rollD20 } from '../dice/evaluator.js';
import type { CombatEvent, CombatState, Combatant } from './types.js';
import { applyHealing, applyTemporaryHp } from './damage.js';
import { applyConditionToCombatant } from './conditions.js';
import { evaluateCombatVictory } from './state-machine.js';

/**
 * SRD-1210: Bounded capstones — Wish menu + Time Stop solo turns (Spec 11 §4.3).
 *
 * Wish offers a fixed BG2-style menu of 6 explicit effect bundles (no
 * open-ended parsing). Every boon counts as "anything other than duplicating
 * a spell", so SRD 5.1 stress always applies: STR drops to 3 for 2d4 days,
 * 33% chance of losing Wish forever, plus a 1-round incapacitation collapse.
 *
 * Time Stop grants 1d4+1 consecutive solo turns: others are frozen (no turns,
 * no reactions, no hazard start-turn ticks against them) and the window ends
 * early the moment the caster affects another creature.
 */

// ---------------------------------------------------------------------------
// Wish boons
// ---------------------------------------------------------------------------

export const WISH_BOON_IDS = [
  'restore-party',
  'grant-resistance',
  'supply-cache',
  'full-rest',
  'mass-heal',
  'resurrection',
] as const;
export const WishBoonIdSchema = z.enum(WISH_BOON_IDS);
export type WishBoonId = z.infer<typeof WishBoonIdSchema>;

export interface WishBoonMeta {
  id: WishBoonId;
  name: string;
  guidance: string;
}

export const WISH_BOONS: Record<WishBoonId, WishBoonMeta> = {
  'restore-party': {
    id: 'restore-party',
    name: 'Restore the Party',
    guidance:
      'Cleanse blinded, deafened and poisoned from conscious allies and knit wounds (3d8 healing each).',
  },
  'grant-resistance': {
    id: 'grant-resistance',
    name: 'Grant Resistance',
    guidance:
      'Ward conscious allies with resistance to one damage type (default fire) until the next long rest.',
  },
  'supply-cache': {
    id: 'supply-cache',
    name: 'Conjure Supply Cache',
    guidance:
      'Conjure provisions: each conscious ally gains 2d10 temporary HP and sheds one exhaustion level.',
  },
  'full-rest': {
    id: 'full-rest',
    name: 'Grant Full Rest',
    guidance:
      'Grant the party a full rest: HP to max, spell slots and pact magic restored, exhaustion cleared, death saves reset.',
  },
  'mass-heal': {
    id: 'mass-heal',
    name: 'Mass Heal',
    guidance: 'Flood allies with healing light: each conscious ally regains 70 HP.',
  },
  resurrection: {
    id: 'resurrection',
    name: 'Free Resurrection',
    guidance:
      'Call one dead ally back: revive at half max HP with death saves cleared (no costly components).',
  },
};

/** SRD 5.1 Wish stress: 33% chance of losing Wish forever. */
export const WISH_STRESS_LOSS_CHANCE_PERCENT = 33;
/** Stress recovery: STR falls to 3 for 2d4 days. */
export const WISH_STRESS_RECOVERY_DICE = '2d4';
/** Effect ids planted for UI/tooltips. */
export const WISH_RESISTANCE_EFFECT_ID = 'wish-granted-resistance';
export const WISH_STRESS_EFFECT_ID = 'wish-stress';
export const WISH_LOSS_EFFECT_ID = 'wish-lost';

export const WISH_RESTORE_CONDITIONS_CURED = ['blinded', 'deafened', 'poisoned'] as const;

export interface WishStressRoll {
  recoveryDays: number;
  recoveryFormula: string;
  wishLost: boolean;
  lossRoll: number;
  rngState: number;
}

/** Deterministic stress rolls: 2d4 recovery days + d100 loss check (<=33 lost). */
export function rollWishStress(rngState: number): WishStressRoll {
  let current = normalizeSeed(rngState);
  const rec = rollDamage(current, WISH_STRESS_RECOVERY_DICE);
  current = rec.nextState;
  const lossRes = rollD20(current, { mode: 'normal', modifier: 0 });
  // rollD20 yields 1-20; expand to d100 via two rolls for determinism without new PRNG helpers:
  // use the d20 natural roll scaled: simpler to roll 1d100 via rollDamage.
  const d100 = rollDamage(lossRes.nextState, '1d100');
  current = d100.nextState;
  return {
    recoveryDays: rec.total,
    recoveryFormula: WISH_STRESS_RECOVERY_DICE,
    wishLost: d100.total <= WISH_STRESS_LOSS_CHANCE_PERCENT,
    lossRoll: d100.total,
    rngState: current,
  };
}

export interface ResolveWishBoonOptions {
  state: CombatState;
  casterId: string;
  boonId: WishBoonId;
  /** For grant-resistance: damage type warded (default fire). */
  resistanceType?: DamageType;
  /** For resurrection: explicit dead ally id (defaults to first dead ally). */
  resurrectionTargetId?: string;
  rngState?: number;
}

export interface ResolveWishBoonResult {
  state: CombatState;
  events: CombatEvent[];
  boonId: WishBoonId;
  healedIds: string[];
  buffedIds: string[];
  revivedId?: string;
  stress: WishStressRoll;
  totalHealingByTarget: Record<string, number>;
}

function partyAllies(state: CombatState, caster: Combatant): Combatant[] {
  return Object.values(state.combatants).filter(
    (c) => (c.teamId ?? c.side) === (caster.teamId ?? caster.side),
  );
}

function setStrengthToThree(c: Combatant): Combatant {
  const next: Combatant = { ...c };
  if ((next.strengthScore ?? 10) > 3) {
    next.strengthScore = 3;
    next.strengthModifier = -4;
  }
  return next;
}

/**
 * Applies one bounded Wish boon plus SRD 5.1 stress. Pure except for seeded
 * PRNG threading; never throws on missing targets (boons simply affect who
 * they can). Callers must have already validated slots/turn budget.
 */
export function resolveWishBoon(options: ResolveWishBoonOptions): ResolveWishBoonResult {
  const { casterId, boonId } = options;
  let state = options.state;
  const caster = state.combatants[casterId];
  if (!caster) throw new Error(`Caster ${casterId} not found`);
  let rngState = options.rngState ?? state.rngState;
  const events: CombatEvent[] = [];
  const healedIds: string[] = [];
  const buffedIds: string[] = [];
  const totalHealingByTarget: Record<string, number> = {};
  let revivedId: string | undefined;

  const allies = partyAllies(state, caster);
  const consciousAllies = allies.filter((c) => !c.isDead && c.currentHp > 0);

  const trackHeal = (tid: string, amount: number) => {
    if (!healedIds.includes(tid)) healedIds.push(tid);
    totalHealingByTarget[tid] = (totalHealingByTarget[tid] ?? 0) + amount;
  };

  if (boonId === 'restore-party') {
    for (const ally of consciousAllies) {
      let next: Combatant = { ...state.combatants[ally.id]! };
      for (const cond of WISH_RESTORE_CONDITIONS_CURED) {
        if (next.conditions.includes(cond as never)) {
          next = { ...next, conditions: next.conditions.filter((c) => c !== cond) };
          events.push({
            type: 'CONDITION_REMOVED',
            targetId: next.id,
            conditionId: cond as never,
            sourceName: 'Wish (Restore the Party)',
          });
        }
      }
      state = { ...state, combatants: { ...state.combatants, [next.id]: next } };
      const healRoll = rollDamage(rngState, '3d8');
      rngState = healRoll.nextState;
      events.push({
        type: 'DICE_ROLLED',
        actorId: casterId,
        rollPurpose: 'Wish restore-party healing',
        notation: healRoll.record.formula,
        rolls: healRoll.record.rolls,
        kept: healRoll.record.kept,
        modifier: healRoll.record.modifier,
        total: healRoll.total,
        mode: 'normal',
      });
      const res = applyHealing({
        state: { ...state, rngState },
        targetId: next.id,
        amount: healRoll.total,
        sourceName: 'Wish (Restore the Party)',
      });
      state = res.state;
      rngState = state.rngState;
      events.push(...res.events);
      trackHeal(next.id, res.amount);
      if (!buffedIds.includes(next.id)) buffedIds.push(next.id);
    }
  } else if (boonId === 'grant-resistance') {
    const dtype: DamageType = options.resistanceType ?? 'fire';
    for (const ally of consciousAllies) {
      const cur = state.combatants[ally.id]!;
      const existing = cur.activeEffects ? [...cur.activeEffects] : [];
      const entry = {
        effectId: `${WISH_RESISTANCE_EFFECT_ID}-${dtype}`,
        name: `Wish Ward (${dtype} resistance)`,
        sourceEntityId: casterId,
        requiresConcentration: false,
        remainingRounds: 4800,
        modifiers: [{ type: 'damage_mitigation', mitigation: 'resistance', damageTypes: [dtype] }] as never[],
      };
      const updated: Combatant = {
        ...cur,
        activeEffects: [...existing.filter((e) => e.effectId !== entry.effectId), entry] as never,
        damageResistances: cur.damageResistances.includes(dtype)
          ? cur.damageResistances
          : [...cur.damageResistances, dtype],
      };
      state = { ...state, combatants: { ...state.combatants, [updated.id]: updated } };
      if (!buffedIds.includes(updated.id)) buffedIds.push(updated.id);
    }
  } else if (boonId === 'supply-cache') {
    for (const ally of consciousAllies) {
      const tempRoll = rollDamage(rngState, '2d10');
      rngState = tempRoll.nextState;
      events.push({
        type: 'DICE_ROLLED',
        actorId: casterId,
        rollPurpose: 'Wish supply-cache temp HP',
        notation: tempRoll.record.formula,
        rolls: tempRoll.record.rolls,
        kept: tempRoll.record.kept,
        modifier: tempRoll.record.modifier,
        total: tempRoll.total,
        mode: 'normal',
      });
      const cur = state.combatants[ally.id]!;
      const updated: Combatant = {
        ...cur,
        tempHp: Math.max(cur.tempHp, tempRoll.total),
        exhaustionLevel: Math.max(0, (cur.exhaustionLevel ?? 0) - 1),
        conditions:
          (cur.exhaustionLevel ?? 0) - 1 <= 0
            ? cur.conditions.filter((c) => c !== 'exhaustion')
            : cur.conditions,
      };
      state = { ...state, combatants: { ...state.combatants, [updated.id]: updated } };
      events.push({
        type: 'TEMP_HP_APPLIED',
        targetId: updated.id,
        amount: tempRoll.total,
        tempHpBefore: cur.tempHp,
        tempHpAfter: updated.tempHp,
        sourceName: 'Wish (Supply Cache)',
      });
      if (!buffedIds.includes(updated.id)) buffedIds.push(updated.id);
    }
  } else if (boonId === 'full-rest') {
    for (const ally of allies) {
      if (ally.isDead) continue;
      const cur = state.combatants[ally.id]!;
      // Restore HP to max.
      const healRes = applyHealing({
        state: { ...state, rngState },
        targetId: cur.id,
        amount: cur.maxHp,
        sourceName: 'Wish (Full Rest)',
      });
      state = healRes.state;
      rngState = state.rngState;
      events.push(...healRes.events);
      trackHeal(cur.id, healRes.amount);
      // Restore slots/pact, clear exhaustion + death saves + most conditions.
      const afterHeal = state.combatants[cur.id]!;
      const restoredSlots: Combatant['spellSlots'] = afterHeal.spellSlots
        ? Object.fromEntries(
            Object.entries(afterHeal.spellSlots).map(([lvl, pool]) => [
              lvl,
              { ...pool, expended: 0, available: pool.max },
            ]),
          )
        : afterHeal.spellSlots;
      const restoredPact = afterHeal.pactMagic
        ? { ...afterHeal.pactMagic, expendedSlots: 0, availableSlots: afterHeal.pactMagic.maxSlots }
        : afterHeal.pactMagic;
      const cleared: Combatant = {
        ...afterHeal,
        spellSlots: restoredSlots,
        pactMagic: restoredPact,
        exhaustionLevel: 0,
        conditions: afterHeal.conditions.filter((c) =>
          ['unconscious'].includes(c) && afterHeal.currentHp <= 0 ? true : false,
        ),
        deathSaves: { successes: 0, failures: 0 },
        isStable: false,
        characterSheet: afterHeal.characterSheet
          ? {
              ...afterHeal.characterSheet,
              currentHp: afterHeal.characterSheet.maxHp,
              deathSaves: { successes: 0, failures: 0 },
            }
          : afterHeal.characterSheet,
      };
      // Keep unconscious only if still at 0 (shouldn't happen after full heal).
      state = { ...state, combatants: { ...state.combatants, [cleared.id]: cleared } };
      if (!buffedIds.includes(cleared.id)) buffedIds.push(cleared.id);
      if (!healedIds.includes(cleared.id)) healedIds.push(cleared.id);
    }
  } else if (boonId === 'mass-heal') {
    for (const ally of consciousAllies) {
      const res = applyHealing({
        state: { ...state, rngState },
        targetId: ally.id,
        amount: 70,
        sourceName: 'Wish (Mass Heal)',
      });
      state = res.state;
      rngState = state.rngState;
      events.push(...res.events);
      trackHeal(ally.id, res.amount);
    }
  } else {
    // resurrection
    const deadAllies = allies.filter((c) => c.isDead || c.currentHp <= 0);
    const targetId =
      options.resurrectionTargetId ??
      deadAllies.sort((a, b) => (a.id < b.id ? -1 : 1))[0]?.id;
    if (targetId) {
      const cur = state.combatants[targetId];
      if (cur) {
        const halfMax = Math.max(1, Math.floor(cur.maxHp / 2));
        const revived: Combatant = {
          ...cur,
          isDead: false,
          isStable: false,
          currentHp: halfMax,
          conditions: cur.conditions.filter((c) => c !== 'unconscious'),
          deathSaves: { successes: 0, failures: 0 },
          characterSheet: cur.characterSheet
            ? { ...cur.characterSheet, currentHp: halfMax, deathSaves: { successes: 0, failures: 0 } }
            : cur.characterSheet,
        };
        state = { ...state, combatants: { ...state.combatants, [revived.id]: revived } };
        events.push({
          type: 'HEAL_APPLIED',
          targetId: revived.id,
          amount: halfMax,
          hpBefore: cur.currentHp,
          hpAfter: halfMax,
          sourceName: 'Wish (Resurrection)',
          revivedFromZero: true,
        });
        revivedId = revived.id;
        trackHeal(revived.id, halfMax - cur.currentHp);
      }
    }
  }

  // ---- SRD 5.1 stress (non-duplication path): STR 3 for 2d4 days, 33% loss, collapse.
  const stress = rollWishStress(rngState);
  rngState = stress.rngState;
  events.push({
    type: 'DICE_ROLLED',
    actorId: casterId,
    rollPurpose: 'Wish stress recovery (2d4 days)',
    notation: WISH_STRESS_RECOVERY_DICE,
    rolls: [],
    kept: [],
    modifier: 0,
    total: stress.recoveryDays,
    mode: 'normal',
  });
  events.push({
    type: 'DICE_ROLLED',
    actorId: casterId,
    rollPurpose: 'Wish stress loss check (d100 <= 33)',
    notation: '1d100',
    rolls: [stress.lossRoll],
    kept: [stress.lossRoll],
    modifier: 0,
    total: stress.lossRoll,
    mode: 'normal',
  });

  const liveCaster = state.combatants[casterId]!;
  let stressed: Combatant = setStrengthToThree(liveCaster);
  stressed = {
    ...stressed,
    wishStressActive: true,
    wishStressDaysRemaining: stress.recoveryDays,
    wishLost: stress.wishLost ? true : (stressed.wishLost ?? false),
    activeEffects: [
      ...(stressed.activeEffects ?? []),
      {
        effectId: WISH_STRESS_EFFECT_ID,
        name: `Wish Stress (STR 3, ${stress.recoveryDays} days)`,
        sourceEntityId: casterId,
        requiresConcentration: false,
        remainingRounds: stress.recoveryDays * 14400,
        modifiers: [],
      },
      ...(stress.wishLost
        ? [
            {
              effectId: WISH_LOSS_EFFECT_ID,
              name: 'Wish Lost (33% stress)',
              sourceEntityId: casterId,
              requiresConcentration: false,
              remainingRounds: 999999,
              modifiers: [],
            },
          ]
        : []),
    ] as never,
  };
  state = { ...state, combatants: { ...state.combatants, [stressed.id]: stressed } };

  // Collapse: incapacitated for 1 round (the "may incapacitate you" cost).
  const collapse = applyConditionToCombatant(stressed, 'incapacitated', {
    sourceId: 'wish',
    sourceName: 'Wish Stress',
    sourceEntityId: casterId,
    durationRounds: 1,
  });
  state = { ...state, combatants: { ...state.combatants, [stressed.id]: collapse.combatant } };
  events.push(...collapse.events);

  const outcome = evaluateCombatVictory(state.combatants);
  state = { ...state, outcome, rngState };

  events.push({
    type: 'WISH_BOON_RESOLVED',
    actorId: casterId,
    spellId: 'wish',
    boonId,
    healedIds: [...healedIds],
    buffedIds: [...buffedIds],
    revivedId,
    stressDays: stress.recoveryDays,
    wishLost: stress.wishLost,
  });

  return { state, events, boonId, healedIds, buffedIds, revivedId, stress, totalHealingByTarget };
}

// ---------------------------------------------------------------------------
// Time Stop
// ---------------------------------------------------------------------------

export const TIME_STOP_TURN_FORMULA = '1d4 + 1';

export interface TimeStopState {
  casterId: string;
  remainingTurns: number;
  totalTurns: number;
}

export interface RollTimeStopResult {
  totalTurns: number;
  formula: string;
  rngState: number;
}

/** Deterministic 1d4+1 solo-turn roll. */
export function rollTimeStopTurns(rngState: number): RollTimeStopResult {
  const res = rollDamage(normalizeSeed(rngState), TIME_STOP_TURN_FORMULA);
  return { totalTurns: res.total, formula: TIME_STOP_TURN_FORMULA, rngState: res.nextState };
}

/** True while the window holds and the creature is not the caster. */
export function isTimeFrozen(state: CombatState, entityId: string): boolean {
  const ts = (state as CombatState & { timeStop?: TimeStopState }).timeStop;
  if (!ts) return false;
  return entityId !== ts.casterId;
}

/** True when the caster still holds a frozen window. */
export function isTimeStopActive(state: CombatState): boolean {
  return Boolean((state as CombatState & { timeStop?: TimeStopState }).timeStop);
}

export interface StartTimeStopResult {
  state: CombatState;
  events: CombatEvent[];
  totalTurns: number;
}

/** Opens the solo-turn window immediately after the cast resolves. */
export function startTimeStop(state: CombatState, casterId: string): StartTimeStopResult {
  const caster = state.combatants[casterId];
  if (!caster) throw new Error(`Caster ${casterId} not found`);
  const rolled = rollTimeStopTurns(state.rngState);
  const timeStop: TimeStopState = {
    casterId,
    remainingTurns: rolled.totalTurns,
    totalTurns: rolled.totalTurns,
  };
  const events: CombatEvent[] = [
    {
      type: 'DICE_ROLLED',
      actorId: casterId,
      rollPurpose: 'Time Stop solo turns (1d4+1)',
      notation: rolled.formula,
      rolls: [],
      kept: [],
      modifier: 0,
      total: rolled.totalTurns,
      mode: 'normal',
    },
    {
      type: 'TIME_STOP_STARTED',
      casterId,
      totalTurns: rolled.totalTurns,
      formula: rolled.formula,
    },
  ];
  return {
    state: { ...state, rngState: rolled.rngState, timeStop } as CombatState,
    events,
    totalTurns: rolled.totalTurns,
  };
}

export type TimeStopEndReason = 'completed' | 'breach' | 'caster_down' | 'manual';

export interface EndTimeStopResult {
  state: CombatState;
  events: CombatEvent[];
  ended: boolean;
}

/** Clears the window (resume normal initiative). No-op when inactive. */
export function endTimeStop(
  state: CombatState,
  reason: TimeStopEndReason = 'completed',
): EndTimeStopResult {
  const ts = (state as CombatState & { timeStop?: TimeStopState }).timeStop;
  if (!ts) return { state, events: [], ended: false };
  const { timeStop: _dropped, ...rest } = state as CombatState & { timeStop?: TimeStopState };
  const events: CombatEvent[] = [
    { type: 'TIME_STOP_ENDED', casterId: ts.casterId, reason, totalTurns: ts.totalTurns },
  ];
  return { state: { ...(rest as CombatState) }, events, ended: true };
}

/**
 * SRD 5.1 breach rule: the window ends early the moment the caster affects
 * another creature. Returns the (possibly cleared) state plus events.
 */
export function maybeBreachTimeStopOnTargets(
  state: CombatState,
  casterId: string,
  targetIds: readonly string[],
): EndTimeStopResult {
  const ts = (state as CombatState & { timeStop?: TimeStopState }).timeStop;
  if (!ts || ts.casterId !== casterId) return { state, events: [], ended: false };
  const affectsOther = targetIds.some((tid) => tid !== casterId);
  if (!affectsOther) return { state, events: [], ended: false };
  return endTimeStop(state, 'breach');
}
