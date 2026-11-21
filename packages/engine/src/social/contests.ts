import { z } from 'zod';
import { SKILL_DEFAULT_ABILITY, type AbilityId, type SkillId } from '@srd5/data';
import { rollD20 } from '../dice/evaluator.js';
import { spendAction, spendBonusAction } from '../combat/turn-budget.js';
import { applyConditionToCombatant } from '../combat/conditions.js';
import { areHostile } from '../combat/allegiance.js';
import type { Combatant } from '../combat/types.js';
import type { GameEvent, GameState } from '../state/types.js';

/**
 * SRD-1208: Contested and missing skill verbs (Spec 11 §3.3).
 *
 * Gives every remaining skill a mechanical home:
 * - Insight (opposed vs Deception, passive floor + "something feels off" cue)
 * - Medicine (DC 10 stabilize with healer's-kit advantage; diagnose branch)
 * - Intimidation (third social leg: compliance + attitude cost)
 * - Animal Handling (calm/befriend/command beasts)
 * - Nature (identify what is it / is it safe; forage bonus marker)
 * - Performance (earn coin / distract = Help-equivalent / cover identity)
 * - Combat `hide` (DEX Stealth vs hostile passive Perception → `invisible`
 *   as the unseen-attacker proxy per Spec 03 §4.3 item 7)
 *
 * All resolvers are pure + deterministic (threaded PRNG state) and work in
 * both exploration and combat. In combat they spend the turn budget.
 */

// ---------------------------------------------------------------------------
// Generic skill helpers
// ---------------------------------------------------------------------------

type SheetLike = {
  skills?: Record<string, { totalBonus?: number; passiveScore?: number } | undefined>;
  abilities?: Record<string, { modifier?: number } | undefined>;
} | undefined;

function sheetOf(actor: Combatant): SheetLike {
  return actor.characterSheet as unknown as SheetLike;
}

function abilityModOf(actor: Combatant, ability: AbilityId): number {
  const sheet = sheetOf(actor);
  const mod = sheet?.abilities?.[ability]?.modifier;
  if (typeof mod === 'number') return mod;
  if (ability === 'dex') return actor.dexterityModifier;
  if (ability === 'str' && typeof actor.strengthModifier === 'number') return actor.strengthModifier;
  return 0;
}

/** Total skill bonus for any SRD skill id (sheet → monster skills → ability mod). */
export function getSkillBonus(actor: Combatant, skill: SkillId): number {
  const sheet = sheetOf(actor);
  const entry = sheet?.skills?.[skill];
  if (typeof entry?.totalBonus === 'number') return entry.totalBonus;
  const monsterSkills = (actor.monsterData as unknown as { skills?: Record<string, number> } | undefined)?.skills;
  if (typeof monsterSkills?.[skill] === 'number') return monsterSkills[skill]!;
  return abilityModOf(actor, SKILL_DEFAULT_ABILITY[skill]);
}

/** Passive score for any SRD skill (sheet → 10 + bonus). */
export function getPassiveScore(actor: Combatant, skill: SkillId): number {
  const sheet = sheetOf(actor);
  const entry = sheet?.skills?.[skill];
  if (typeof entry?.passiveScore === 'number') return entry.passiveScore;
  return 10 + getSkillBonus(actor, skill);
}

function pushMarkerEffect(target: Combatant, effectId: string, name: string): void {
  const existing = target.activeEffects ?? [];
  if (existing.some((e) => e.effectId === effectId)) return;
  target.activeEffects = [
    ...existing,
    { effectId, name, requiresConcentration: false, modifiers: [] },
  ];
}

function findCombatant(state: GameState, id: string): Combatant | undefined {
  const inCombat = state.mode === 'combat' && state.combat !== null;
  if (inCombat) {
    const c = state.combat!.combatants[id];
    if (c) return c;
  }
  return state.party[id] ?? state.monsters[id];
}

function spendCombatBudget(
  nextState: GameState,
  actorId: string,
  asBonusAction: boolean,
  featureGate?: { hasFeature: boolean; featureName: string },
): 'action' | 'bonus_action' | 'free' {
  if (nextState.mode !== 'combat' || !nextState.combat) return 'free';
  const combat = nextState.combat;
  if (combat.activeCombatantId !== actorId) {
    throw new Error(`It is not ${actorId}'s turn`);
  }
  if (!combat.turnBudget) throw new Error('No active turn budget');
  if (asBonusAction) {
    if (featureGate && !featureGate.hasFeature) {
      throw new Error(`Bonus-action use requires ${featureGate.featureName}`);
    }
    combat.turnBudget = spendBonusAction(combat.turnBudget);
    return 'bonus_action';
  }
  combat.turnBudget = spendAction(combat.turnBudget);
  return 'action';
}

function syncMirrors(nextState: GameState, rngState: number): void {
  nextState.rngState = rngState;
  if (nextState.combat) {
    nextState.combat.rngState = rngState;
    for (const [id, c] of Object.entries(nextState.combat.combatants)) {
      if (c.side === 'party') nextState.party[id] = c;
      else nextState.monsters[id] = c;
    }
  }
}

// ---------------------------------------------------------------------------
// 1. Insight vs Deception (opposed)
// ---------------------------------------------------------------------------

export const INSIGHT_CUE_TEXT = 'something feels off';

export interface InsightContestOptions {
  state: GameState;
  /** Observer reading the speaker (rolls Insight). */
  actorId: string;
  /** Speaker who may be lying (rolls/defends with Deception). */
  targetId: string;
  /** Pre-rolled speaker Deception total (skips the speaker roll; passive cue still applies). */
  speakerDeceptionTotal?: number;
  /** Override the speaker's Deception modifier (tests). */
  speakerDeceptionModifierOverride?: number;
  /** Spend a bonus action instead of a free read in combat. Defaults to free. */
  asBonusAction?: boolean;
}

export interface InsightContestOutcome {
  success: boolean;
  observerRoll: number;
  observerModifier: number;
  observerTotal: number;
  observerPassive: number;
  speakerRoll: number | null;
  speakerModifier: number;
  speakerTotal: number;
  /** True when the party passive alone beats the lie (cue shown even on failed roll). */
  passiveBeatsLie: boolean;
  cue?: string;
  headline: string;
}

export interface InsightContestResult {
  nextState: GameState;
  events: GameEvent[];
  outcome: InsightContestOutcome;
}

/**
 * Opposed WIS (Insight) vs CHA (Deception). The observer wins ties
 * (reader-friendly: a straight read meets the lie). `passiveInsight` is the
 * floor for the cue: whenever it meets or beats the speaker's Deception
 * total the prompt carries a "something feels off" cue.
 */
export function resolveInsightContest(options: InsightContestOptions): InsightContestResult {
  const { actorId, targetId } = options;
  const nextState = structuredClone(options.state);
  const observer = findCombatant(nextState, actorId);
  const speaker = findCombatant(nextState, targetId);
  if (!observer) throw new Error(`Insight observer not found: ${actorId}`);
  if (!speaker) throw new Error(`Insight speaker not found: ${targetId}`);
  if (actorId === targetId) throw new Error('Cannot read your own intent');

  const inCombat = nextState.mode === 'combat' && nextState.combat !== null;
  // Insight reads are free out of combat; in combat they ride the free
  // object-interaction-equivalent (no budget) unless explicitly bonus.
  let spentAs: 'action' | 'bonus_action' | 'free' = 'free';
  if (inCombat && options.asBonusAction) {
    spentAs = spendCombatBudget(nextState, actorId, true);
  }

  const observerModifier = getSkillBonus(observer, 'insight');
  const observerPassive = getPassiveScore(observer, 'insight');
  const speakerModifier =
    options.speakerDeceptionModifierOverride ?? getSkillBonus(speaker, 'deception');

  let rngState = inCombat ? nextState.combat!.rngState : nextState.rngState;
  const observerRes = rollD20(rngState, { modifier: observerModifier, mode: 'normal' });
  rngState = observerRes.nextState;

  let speakerRoll: number | null = null;
  let speakerTotal: number;
  if (typeof options.speakerDeceptionTotal === 'number') {
    speakerTotal = options.speakerDeceptionTotal;
  } else {
    const speakerRes = rollD20(rngState, { modifier: speakerModifier, mode: 'normal' });
    rngState = speakerRes.nextState;
    speakerRoll = speakerRes.naturalRoll;
    speakerTotal = speakerRes.total;
  }

  const success = observerRes.total >= speakerTotal;
  const passiveBeatsLie = observerPassive >= speakerTotal;
  const cue = passiveBeatsLie
    ? `${observer.name} senses ${INSIGHT_CUE_TEXT} about ${speaker.name}'s words.`
    : undefined;
  const headline = success
    ? `${observer.name} reads ${speaker.name}'s intent (${observerRes.total} vs ${speakerTotal}).${cue ? ` ${cue}` : ''}`
    : `${observer.name} cannot read ${speaker.name} (${observerRes.total} vs ${speakerTotal}).${cue ? ` But ${cue}` : ''}`;

  const events: GameEvent[] = [
    {
      type: 'CHECK_RESOLVED',
      actorId,
      checkType: 'insight',
      targetId,
      dc: speakerTotal,
      roll: observerRes.naturalRoll,
      modifier: observerModifier,
      total: observerRes.total,
      success,
      ...(cue ? { note: cue } : {}),
    } as unknown as GameEvent,
  ];
  if (speakerRoll !== null) {
    events.push({
      type: 'CHECK_RESOLVED',
      actorId: targetId,
      checkType: 'deception',
      targetId: actorId,
      dc: observerRes.total,
      roll: speakerRoll,
      modifier: speakerModifier,
      total: speakerTotal,
      success: !success,
    } as unknown as GameEvent);
  }

  syncMirrors(nextState, rngState);
  void spentAs;
  return {
    nextState,
    events,
    outcome: {
      success,
      observerRoll: observerRes.naturalRoll,
      observerModifier,
      observerTotal: observerRes.total,
      observerPassive,
      speakerRoll,
      speakerModifier,
      speakerTotal,
      passiveBeatsLie,
      ...(cue ? { cue } : {}),
      headline,
    },
  };
}

/** Passive-only cue helper for social prompts (no dice spent). */
export function getSocialCue(observer: Combatant, speakerDeceptionTotal: number): string | undefined {
  if (getPassiveScore(observer, 'insight') >= speakerDeceptionTotal) {
    return `${observer.name} senses ${INSIGHT_CUE_TEXT} about the speaker's words.`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 2. Medicine: stabilize (DC 10, healer's kit advantage) + diagnose
// ---------------------------------------------------------------------------

export const MEDICINE_STABILIZE_DC = 10;
export const STABILIZED_EFFECT_ID = 'medicine-stabilized';
export const DIAGNOSED_EFFECT_ID = 'medicine-diagnosed';

function normalizeItemId(id: string): string {
  return id.trim().toLowerCase().replace(/['’]/g, '').replace(/[\s-]+/g, '_');
}

/** True when the actor carries a healer's kit (build inventory or monster gear). */
export function hasHealersKit(actor: Combatant): boolean {
  const inv = (actor.buildState as unknown as { inventory?: Array<{ itemId?: string; name?: string }> } | undefined)?.inventory;
  if (Array.isArray(inv)) {
    for (const item of inv) {
      const id = normalizeItemId(item?.itemId ?? '');
      const name = normalizeItemId(item?.name ?? '');
      if (id.includes('healer') && id.includes('kit')) return true;
      if (name.includes('healer') && name.includes('kit')) return true;
    }
  }
  const gear = (actor.monsterData as unknown as { gear?: string[] } | undefined)?.gear;
  if (Array.isArray(gear) && gear.some((g) => normalizeItemId(g).includes('healer'))) return true;
  return false;
}

export interface StabilizeAttemptOptions {
  state: GameState;
  actorId: string;
  targetId: string;
  asBonusAction?: boolean;
  /** Override kit detection (tests). */
  hasHealersKitOverride?: boolean;
  /** Override the DC (tests, special injuries). Defaults to 10. */
  dcOverride?: number;
}

export interface StabilizeAttemptOutcome {
  success: boolean;
  roll: number;
  modifier: number;
  total: number;
  dc: number;
  hadKitAdvantage: boolean;
  headline: string;
}

export interface StabilizeAttemptResult {
  nextState: GameState;
  events: GameEvent[];
  outcome: StabilizeAttemptOutcome;
}

/**
 * WIS (Medicine) stabilize check (SRD 5.1 DC 10). A healer's kit grants
 * advantage (deliberate table simplification noted in Spec 11 §3.3).
 * Success stabilizes the dying target (death saves reset, `isStable` true);
 * failure leaves them dying — never silent, always a CHECK_RESOLVED.
 */
export function resolveStabilizeAttempt(options: StabilizeAttemptOptions): StabilizeAttemptResult {
  const { actorId, targetId, asBonusAction = false } = options;
  const nextState = structuredClone(options.state);
  const actor = findCombatant(nextState, actorId);
  const target = findCombatant(nextState, targetId);
  if (!actor) throw new Error(`Stabilize actor not found: ${actorId}`);
  if (!target) throw new Error(`Stabilize target not found: ${targetId}`);
  if (actor.isDead || actor.currentHp <= 0) throw new Error(`Stabilize actor ${actorId} is down`);
  if (target.isDead) throw new Error(`Cannot stabilize dead creature "${target.name}"`);
  if (target.currentHp > 0) throw new Error(`Cannot stabilize creature "${target.name}" with HP > 0`);
  if (target.isStable) throw new Error(`Creature "${target.name}" is already stable`);

  const inCombat = nextState.mode === 'combat' && nextState.combat !== null;
  let spentAs: 'action' | 'bonus_action' | 'free' = 'free';
  if (inCombat) {
    spentAs = spendCombatBudget(nextState, actorId, asBonusAction);
  } else if (asBonusAction) {
    throw new Error('Bonus-action stabilize is only meaningful in combat');
  }

  const modifier = getSkillBonus(actor, 'medicine');
  const hadKitAdvantage = options.hasHealersKitOverride ?? hasHealersKit(actor);
  const dc = options.dcOverride ?? MEDICINE_STABILIZE_DC;

  let rngState = inCombat ? nextState.combat!.rngState : nextState.rngState;
  const rollRes = rollD20(rngState, {
    modifier,
    mode: hadKitAdvantage ? 'advantage' : 'normal',
  });
  rngState = rollRes.nextState;
  const success = rollRes.total >= dc;

  const events: GameEvent[] = [];
  events.push({
    type: 'CHECK_RESOLVED',
    actorId,
    checkType: 'medicine',
    targetId,
    dc,
    roll: rollRes.naturalRoll,
    modifier,
    total: rollRes.total,
    success,
  } as unknown as GameEvent);

  let headline: string;
  if (success) {
    // Stabilize in place (mirror of damage.stabilizeCreature without the throw).
    const before = findCombatant(nextState, targetId)!;
    const stabilized: Combatant = {
      ...before,
      isStable: true,
      deathSaves: { successes: 0, failures: 0 },
    };
    if (inCombat) {
      nextState.combat!.combatants[targetId] = stabilized;
    } else if (nextState.party[targetId]) {
      nextState.party[targetId] = stabilized;
    } else {
      nextState.monsters[targetId] = stabilized;
    }
    pushMarkerEffect(
      (inCombat ? nextState.combat!.combatants[targetId]! : (nextState.party[targetId] ?? nextState.monsters[targetId]!)),
      STABILIZED_EFFECT_ID,
      'Stabilized (Medicine)',
    );
    headline = `${actor.name} stabilizes ${target.name} (${rollRes.total} vs DC ${dc}).`;
    if (inCombat) {
      events.push({
        type: 'ACTION_USED',
        actorId,
        actionName: 'custom',
        cost: spentAs === 'bonus_action' ? 'bonus_action' : 'action',
      } as unknown as GameEvent);
    }
  } else {
    headline = `${actor.name} fails to stabilize ${target.name} (${rollRes.total} vs DC ${dc}) — still dying.`;
    if (inCombat) {
      events.push({
        type: 'ACTION_USED',
        actorId,
        actionName: 'custom',
        cost: spentAs === 'bonus_action' ? 'bonus_action' : 'action',
      } as unknown as GameEvent);
    }
  }

  syncMirrors(nextState, rngState);
  return { nextState, events, outcome: { success, roll: rollRes.naturalRoll, modifier, total: rollRes.total, dc, hadKitAdvantage, headline } };
}

export interface DiagnoseOptions {
  state: GameState;
  actorId: string;
  targetId: string;
  dcOverride?: number;
}

/**
 * WIS (Medicine) diagnosis branch: identifies poison/disease on the target.
 * Success attaches a `medicine-diagnosed` marker naming the cure path
 * (antitoxin / lesser restoration / rest); failure gives no bonus.
 */
export function resolveDiagnoseAttempt(options: DiagnoseOptions): {
  nextState: GameState;
  events: GameEvent[];
  outcome: { success: boolean; roll: number; modifier: number; total: number; dc: number; ailment?: string; cure?: string; headline: string };
} {
  const { actorId, targetId } = options;
  const nextState = structuredClone(options.state);
  const actor = findCombatant(nextState, actorId);
  const target = findCombatant(nextState, targetId);
  if (!actor) throw new Error(`Diagnose actor not found: ${actorId}`);
  if (!target) throw new Error(`Diagnose target not found: ${targetId}`);

  const modifier = getSkillBonus(actor, 'medicine');
  const dc = options.dcOverride ?? 10;
  const inCombat = nextState.mode === 'combat' && nextState.combat !== null;
  let rngState = inCombat ? nextState.combat!.rngState : nextState.rngState;
  const rollRes = rollD20(rngState, { modifier, mode: 'normal' });
  rngState = rollRes.nextState;
  const success = rollRes.total >= dc;

  const ailment = target.conditions.includes('poisoned')
    ? 'poisoned'
    : target.exhaustionLevel && target.exhaustionLevel > 0
      ? 'diseased'
      : target.conditions.includes('diseased' as never)
        ? 'diseased'
        : undefined;
  const cure = ailment === 'poisoned' ? 'antitoxin or lesser restoration' : ailment === 'diseased' ? 'lesser restoration or rest' : undefined;

  const events: GameEvent[] = [{
    type: 'CHECK_RESOLVED',
    actorId,
    checkType: 'medicine',
    targetId,
    dc,
    roll: rollRes.naturalRoll,
    modifier,
    total: rollRes.total,
    success,
    ...(success && ailment ? { note: `${target.name} is ${ailment} — treat with ${cure}.` } : {}),
  } as unknown as GameEvent];

  let headline = success
    ? `${actor.name} diagnoses ${target.name} (${rollRes.total} vs DC ${dc}).`
    : `${actor.name} cannot diagnose ${target.name} (${rollRes.total} vs DC ${dc}) — no bonus.`;
  if (success && ailment) {
    const live = findCombatant(nextState, targetId)!;
    pushMarkerEffect(live, `${DIAGNOSED_EFFECT_ID}-${ailment}`, `Diagnosed: ${ailment} (cure: ${cure})`);
    headline = `${actor.name} diagnoses ${target.name} as ${ailment} — treat with ${cure} (${rollRes.total} vs DC ${dc}).`;
  }

  syncMirrors(nextState, rngState);
  return { nextState, events, outcome: { success, roll: rollRes.naturalRoll, modifier, total: rollRes.total, dc, ...(ailment ? { ailment } : {}), ...(cure ? { cure } : {}), headline } };
}

// ---------------------------------------------------------------------------
// 3. Intimidation (third social leg)
// ---------------------------------------------------------------------------

export const INTIMIDATED_ATTITUDE_COST_EFFECT_ID = 'intimidated-attitude-cost';
export const INTIMIDATION_BACKLASH_EFFECT_ID = 'intimidation-backlash';
/** Missing the DC by this margin (or a natural 1) escalates failure → hostility. */
export const INTIMIDATION_BACKLASH_MARGIN = 5;

export interface IntimidationAttemptOptions {
  state: GameState;
  actorId: string;
  targetId: string;
  asBonusAction?: boolean;
  dcOverride?: number;
}

export interface IntimidationAttemptOutcome {
  success: boolean;
  backlash: boolean;
  roll: number;
  modifier: number;
  total: number;
  dc: number;
  headline: string;
}

/**
 * CHA (Intimidation) vs the target's composure (default DC 10 + WIS mod +
 * half proficiency-equivalent guard: Insight passive − 10, i.e. Insight
 * passive is the DC). Success inflicts `frightened` until the end of the
 * target's next turn (compliance) plus an attitude-cost marker (the
 * consequence that distinguishes it from Persuasion/Deception). Failure by
 * >= margin (or nat 1) marks backlash (attitude loss / patrol hook).
 */
export function getIntimidationDc(target: Combatant, dcOverride?: number): number {
  if (typeof dcOverride === 'number') return dcOverride;
  // Default: the target's Insight passive (10 + Insight bonus).
  return getPassiveScore(target, 'insight');
}

export function resolveIntimidationAttempt(options: IntimidationAttemptOptions): {
  nextState: GameState;
  events: GameEvent[];
  outcome: IntimidationAttemptOutcome;
} {
  const { actorId, targetId, asBonusAction = false } = options;
  const nextState = structuredClone(options.state);
  const actor = findCombatant(nextState, actorId);
  const target = findCombatant(nextState, targetId);
  if (!actor) throw new Error(`Intimidation actor not found: ${actorId}`);
  if (!target) throw new Error(`Intimidation target not found: ${targetId}`);
  if (actorId === targetId) throw new Error('Cannot intimidate yourself');
  if (actor.isDead || actor.currentHp <= 0) throw new Error(`Intimidation actor ${actorId} is down`);
  if (target.isDead || target.currentHp <= 0) throw new Error(`Intimidation target ${targetId} is down`);

  const inCombat = nextState.mode === 'combat' && nextState.combat !== null;
  let spentAs: 'action' | 'bonus_action' | 'free' = 'free';
  if (inCombat) {
    spentAs = spendCombatBudget(nextState, actorId, asBonusAction);
  } else if (asBonusAction) {
    throw new Error('Bonus-action intimidation is only meaningful in combat');
  }

  const modifier = getSkillBonus(actor, 'intimidation');
  const dc = getIntimidationDc(target, options.dcOverride);
  let rngState = inCombat ? nextState.combat!.rngState : nextState.rngState;
  const rollRes = rollD20(rngState, { modifier, mode: 'normal' });
  rngState = rollRes.nextState;

  const success = rollRes.total >= dc;
  const backlash = !success && (rollRes.naturalRoll === 1 || rollRes.total <= dc - INTIMIDATION_BACKLASH_MARGIN);

  const events: GameEvent[] = [{
    type: 'CHECK_RESOLVED',
    actorId,
    checkType: 'intimidation',
    targetId,
    dc,
    roll: rollRes.naturalRoll,
    modifier,
    total: rollRes.total,
    success,
  } as unknown as GameEvent];

  let headline: string;
  if (success) {
    const live = findCombatant(nextState, targetId)!;
    const applied = applyConditionToCombatant(live, 'frightened', {
      sourceEntityId: actorId,
      sourceName: `Intimidated by ${actor.name}`,
      durationRounds: 1,
    });
    const withFear: Combatant = { ...applied.combatant, frightenedByEntityId: actorId };
    if (inCombat) nextState.combat!.combatants[targetId] = withFear;
    else if (nextState.party[targetId]) nextState.party[targetId] = withFear;
    else nextState.monsters[targetId] = withFear;
    pushMarkerEffect(
      (inCombat ? nextState.combat!.combatants[targetId]! : (nextState.party[targetId] ?? nextState.monsters[targetId]!)),
      INTIMIDATED_ATTITUDE_COST_EFFECT_ID,
      'Intimidated: compliance at an attitude cost',
    );
    events.push(...applied.events);
    headline = `${actor.name} intimidates ${target.name} into compliance (${rollRes.total} vs DC ${dc}) — frightened, but attitude sours.`;
  } else if (backlash) {
    const live = findCombatant(nextState, targetId)!;
    pushMarkerEffect(live, INTIMIDATION_BACKLASH_EFFECT_ID, 'Intimidation Backlash (hostile)');
    headline = `${actor.name}'s threats enrage ${target.name} (${rollRes.total} vs DC ${dc}) — backlash.`;
  } else {
    headline = `${target.name} stands firm against ${actor.name}'s threats (${rollRes.total} vs DC ${dc}) — no effect.`;
  }

  if (inCombat) {
    events.push({
      type: 'ACTION_USED',
      actorId,
      actionName: 'custom',
      cost: spentAs === 'bonus_action' ? 'bonus_action' : 'action',
    } as unknown as GameEvent);
  }

  syncMirrors(nextState, rngState);
  return { nextState, events, outcome: { success, backlash, roll: rollRes.naturalRoll, modifier, total: rollRes.total, dc, headline } };
}

// ---------------------------------------------------------------------------
// 4. Animal Handling (calm / befriend / command)
// ---------------------------------------------------------------------------

export const AnimalHandlingIntentSchema = z.enum(['calm', 'befriend', 'command']);
export type AnimalHandlingIntent = z.infer<typeof AnimalHandlingIntentSchema>;

export const BEAST_CALMED_EFFECT_ID = 'beast-calmed';
export const BEAST_FRIEND_EFFECT_ID = 'beast-befriended';

export interface AnimalHandlingOptions {
  state: GameState;
  actorId: string;
  targetId: string;
  intent?: AnimalHandlingIntent;
  asBonusAction?: boolean;
  dcOverride?: number;
}

function isBeast(target: Combatant): boolean {
  const monsterType = (target.monsterData as unknown as { type?: string } | undefined)?.type;
  if (typeof monsterType === 'string' && monsterType.toLowerCase() === 'beast') return true;
  return false;
}

export function getAnimalHandlingDc(target: Combatant, intent: AnimalHandlingIntent, dcOverride?: number): number {
  if (typeof dcOverride === 'number') return dcOverride;
  const base = isBeast(target) ? 12 : 15;
  if (intent === 'command') return base + 3;
  if (intent === 'befriend') return base;
  return base - 2; // calm is the easiest ask
}

/**
 * WIS (Animal Handling) vs a beast (or beast-adjacent encounter). `calm`
 * ends `frightened` on the beast and marks it calmed; `befriend` charms it
 * (one attitude step friendlier, buys the parley round); `command` charms it
 * with a named task. Non-beasts are DC +3 territory (handled via base).
 */
export function resolveAnimalHandlingAttempt(options: AnimalHandlingOptions): {
  nextState: GameState;
  events: GameEvent[];
  outcome: { intent: AnimalHandlingIntent; success: boolean; roll: number; modifier: number; total: number; dc: number; headline: string };
} {
  const { actorId, targetId, asBonusAction = false } = options;
  const intent = AnimalHandlingIntentSchema.parse(options.intent ?? 'calm');
  const nextState = structuredClone(options.state);
  const actor = findCombatant(nextState, actorId);
  const target = findCombatant(nextState, targetId);
  if (!actor) throw new Error(`Animal Handling actor not found: ${actorId}`);
  if (!target) throw new Error(`Animal Handling target not found: ${targetId}`);
  if (actorId === targetId) throw new Error('Cannot handle yourself');
  if (actor.isDead || actor.currentHp <= 0) throw new Error(`Animal Handling actor ${actorId} is down`);
  if (target.isDead || target.currentHp <= 0) throw new Error(`Animal Handling target ${targetId} is down`);

  const inCombat = nextState.mode === 'combat' && nextState.combat !== null;
  let spentAs: 'action' | 'bonus_action' | 'free' = 'free';
  if (inCombat) {
    spentAs = spendCombatBudget(nextState, actorId, asBonusAction);
  } else if (asBonusAction) {
    throw new Error('Bonus-action handling is only meaningful in combat');
  }

  const modifier = getSkillBonus(actor, 'animal-handling');
  const dc = getAnimalHandlingDc(target, intent, options.dcOverride);
  let rngState = inCombat ? nextState.combat!.rngState : nextState.rngState;
  const rollRes = rollD20(rngState, { modifier, mode: 'normal' });
  rngState = rollRes.nextState;
  const success = rollRes.total >= dc;

  const events: GameEvent[] = [{
    type: 'CHECK_RESOLVED',
    actorId,
    checkType: 'animal_handling',
    targetId,
    dc,
    roll: rollRes.naturalRoll,
    modifier,
    total: rollRes.total,
    success,
  } as unknown as GameEvent];

  let headline: string;
  if (success) {
    const live = findCombatant(nextState, targetId)!;
    if (intent === 'calm') {
      const withoutFear: Combatant = {
        ...live,
        conditions: live.conditions.filter((c) => c !== 'frightened'),
        frightenedByEntityId: undefined,
      };
      if (inCombat) nextState.combat!.combatants[targetId] = withoutFear;
      else if (nextState.party[targetId]) nextState.party[targetId] = withoutFear;
      else nextState.monsters[targetId] = withoutFear;
      const marked = findCombatant(nextState, targetId)!;
      pushMarkerEffect(marked, BEAST_CALMED_EFFECT_ID, `Calmed by ${actor.name}`);
      headline = `${actor.name} calms ${target.name} (${rollRes.total} vs DC ${dc}) — fear ends.`;
    } else {
      const applied = applyConditionToCombatant(live, 'charmed', {
        sourceEntityId: actorId,
        sourceName: intent === 'befriend' ? `Befriended by ${actor.name}` : `Commanded by ${actor.name}`,
        durationRounds: 10,
      });
      const charmed: Combatant = { ...applied.combatant, charmedByEntityId: actorId };
      if (inCombat) nextState.combat!.combatants[targetId] = charmed;
      else if (nextState.party[targetId]) nextState.party[targetId] = charmed;
      else nextState.monsters[targetId] = charmed;
      pushMarkerEffect(
        (inCombat ? nextState.combat!.combatants[targetId]! : (nextState.party[targetId] ?? nextState.monsters[targetId]!)),
        BEAST_FRIEND_EFFECT_ID,
        intent === 'befriend' ? `Befriended by ${actor.name}` : `Commanded by ${actor.name}`,
      );
      events.push(...applied.events);
      headline = intent === 'befriend'
        ? `${actor.name} befriends ${target.name} (${rollRes.total} vs DC ${dc}) — one step friendlier.`
        : `${actor.name} commands ${target.name} (${rollRes.total} vs DC ${dc}) — it obeys a simple task.`;
    }
  } else {
    headline = `${target.name} ignores ${actor.name}'s handling (${rollRes.total} vs DC ${dc}) — no effect.`;
  }

  if (inCombat) {
    events.push({
      type: 'ACTION_USED',
      actorId,
      actionName: 'custom',
      cost: spentAs === 'bonus_action' ? 'bonus_action' : 'action',
    } as unknown as GameEvent);
  }

  syncMirrors(nextState, rngState);
  return { nextState, events, outcome: { intent, success, roll: rollRes.naturalRoll, modifier, total: rollRes.total, dc, headline } };
}

// ---------------------------------------------------------------------------
// 5. Nature lore (what is it / is it safe) + forage bonus
// ---------------------------------------------------------------------------

export const NATURE_IDENTIFIED_EFFECT_ID = 'nature-identified';
export const NATURE_FORAGE_BONUS_EFFECT_ID = 'nature-forage-bonus';

export interface NatureLoreOptions {
  state: GameState;
  actorId: string;
  /** Free-text subject (beast track, plant, terrain feature). */
  subject?: string;
  dcOverride?: number;
  dc?: number;
}

/**
 * INT (Nature): identifies a beast/plant/terrain feature — what it is and
 * whether it is safe — and caches a +2 forage marker on the actor (the
 * Nature/Survival split: Nature knows, Survival gathers). Failure is
 * fail-forward: no bonus, never a block.
 */
export function resolveNatureLoreAttempt(options: NatureLoreOptions): {
  nextState: GameState;
  events: GameEvent[];
  outcome: { success: boolean; roll: number; modifier: number; total: number; dc: number; subject: string; headline: string };
} {
  const { actorId } = options;
  const subject = options.subject ?? 'the wilds';
  const nextState = structuredClone(options.state);
  const actor = findCombatant(nextState, actorId);
  if (!actor) throw new Error(`Nature actor not found: ${actorId}`);
  if (actor.isDead || actor.currentHp <= 0) throw new Error(`Nature actor ${actorId} is down`);

  const modifier = getSkillBonus(actor, 'nature');
  const dc = options.dcOverride ?? options.dc ?? 12;
  const inCombat = nextState.mode === 'combat' && nextState.combat !== null;
  let rngState = inCombat ? nextState.combat!.rngState : nextState.rngState;
  const rollRes = rollD20(rngState, { modifier, mode: 'normal' });
  rngState = rollRes.nextState;
  const success = rollRes.total >= dc;

  const events: GameEvent[] = [{
    type: 'CHECK_RESOLVED',
    actorId,
    checkType: 'nature',
    dc,
    roll: rollRes.naturalRoll,
    modifier,
    total: rollRes.total,
    success,
    ...(success ? { note: `${actor.name} identifies ${subject}: known habits, safe to approach with care.` } : {}),
  } as unknown as GameEvent];

  let headline = success
    ? `${actor.name} identifies ${subject} (${rollRes.total} vs DC ${dc}) — knows what it is and whether it is safe.`
    : `${actor.name} cannot place ${subject} (${rollRes.total} vs DC ${dc}) — no bonus.`;
  if (success) {
    const live = findCombatant(nextState, actorId)!;
    pushMarkerEffect(live, `${NATURE_IDENTIFIED_EFFECT_ID}`, `Identified: ${subject} (safe to approach with care)`);
    pushMarkerEffect(live, NATURE_FORAGE_BONUS_EFFECT_ID, 'Nature lore: +2 to the next forage');
  }

  syncMirrors(nextState, rngState);
  return { nextState, events, outcome: { success, roll: rollRes.naturalRoll, modifier, total: rollRes.total, dc, subject, headline } };
}

// ---------------------------------------------------------------------------
// 6. Performance (earn / distract / cover)
// ---------------------------------------------------------------------------

export const PerformanceIntentSchema = z.enum(['earn', 'distract', 'cover']);
export type PerformanceIntent = z.infer<typeof PerformanceIntentSchema>;

export const PERFORMANCE_DISTRACTED_EFFECT_ID = 'performance-distracted';
export const PERFORMANCE_COVER_EFFECT_ID = 'performance-cover';

export interface PerformanceAttemptOptions {
  state: GameState;
  actorId: string;
  targetId?: string;
  intent?: PerformanceIntent;
  asBonusAction?: boolean;
  dcOverride?: number;
  dc?: number;
}

export interface PerformanceAttemptOutcome {
  intent: PerformanceIntent;
  success: boolean;
  roll: number;
  modifier: number;
  total: number;
  dc: number;
  goldEarned?: number;
  headline: string;
}

/**
 * CHA (Performance): `earn` plays the tavern for coin + rumors (fail-forward:
 * half coin, no rumor); `distract` marks one mark distracted (Help-equivalent:
 * the next attack against it has advantage); `cover` marks the performer with
 * a cover identity (advantage hook for the next Deception/Stealth blend-in).
 */
export function resolvePerformanceAttempt(options: PerformanceAttemptOptions): {
  nextState: GameState;
  events: GameEvent[];
  outcome: PerformanceAttemptOutcome;
} {
  const { actorId } = options;
  const intent = PerformanceIntentSchema.parse(options.intent ?? 'earn');
  const nextState = structuredClone(options.state);
  const actor = findCombatant(nextState, actorId);
  if (!actor) throw new Error(`Performance actor not found: ${actorId}`);
  if (actor.isDead || actor.currentHp <= 0) throw new Error(`Performance actor ${actorId} is down`);

  const inCombat = nextState.mode === 'combat' && nextState.combat !== null;
  let spentAs: 'action' | 'bonus_action' | 'free' = 'free';
  if (inCombat) {
    if (intent === 'earn') throw new Error('Cannot busk for coin in combat — use distract or cover');
    spentAs = spendCombatBudget(nextState, actorId, options.asBonusAction ?? false);
  } else if (options.asBonusAction) {
    throw new Error('Bonus-action performance is only meaningful in combat');
  }

  const modifier = getSkillBonus(actor, 'performance');
  const dc = options.dcOverride ?? options.dc ?? 12;
  let rngState = inCombat ? nextState.combat!.rngState : nextState.rngState;
  const rollRes = rollD20(rngState, { modifier, mode: 'normal' });
  rngState = rollRes.nextState;
  const success = rollRes.total >= dc;

  const events: GameEvent[] = [{
    type: 'CHECK_RESOLVED',
    actorId,
    checkType: 'performance',
    ...(options.targetId ? { targetId: options.targetId } : {}),
    dc,
    roll: rollRes.naturalRoll,
    modifier,
    total: rollRes.total,
    success,
  } as unknown as GameEvent];

  let headline: string;
  let goldEarned: number | undefined;
  if (intent === 'earn') {
    // Tavern take is deterministic from the check (no extra stream burn):
    // success → 3 + half-modifier, failure → 1 (fail-forward half coin).
    const chaLike = Math.max(0, Math.floor(modifier / 2));
    goldEarned = success ? 3 + chaLike : 1;
    if (actor.buildState && goldEarned > 0) {
      actor.buildState.currency = { ...actor.buildState.currency, gp: actor.buildState.currency.gp + goldEarned };
      events.push({
        type: 'INVENTORY_UPDATED',
        characterId: actorId,
        inventory: actor.buildState.inventory,
        currency: actor.buildState.currency,
      } as unknown as GameEvent);
    }
    headline = success
      ? `${actor.name}'s performance earns ${goldEarned} gp and a rumor (${rollRes.total} vs DC ${dc}).`
      : `${actor.name}'s performance earns ${goldEarned} gp but no rumor (${rollRes.total} vs DC ${dc}).`;
  } else if (intent === 'distract') {
    if (!options.targetId) throw new Error('Distraction requires a targetId');
    const mark = findCombatant(nextState, options.targetId);
    if (!mark) throw new Error(`Performance target not found: ${options.targetId}`);
    if (success) {
      pushMarkerEffect(mark, PERFORMANCE_DISTRACTED_EFFECT_ID, `Distracted by ${actor.name} (next attack vs it has advantage)`);
      headline = `${actor.name} distracts ${mark.name} (${rollRes.total} vs DC ${dc}) — Help-equivalent opening.`;
    } else {
      headline = `${mark.name} ignores ${actor.name}'s distraction (${rollRes.total} vs DC ${dc}) — no opening.`;
    }
  } else {
    if (success) {
      const live = findCombatant(nextState, actorId)!;
      pushMarkerEffect(live, PERFORMANCE_COVER_EFFECT_ID, `Cover identity (${actor.name} blends in)`);
      headline = `${actor.name} establishes a cover identity (${rollRes.total} vs DC ${dc}) — blends into the crowd.`;
    } else {
      headline = `${actor.name}'s cover does not land (${rollRes.total} vs DC ${dc}) — no cover.`;
    }
  }

  if (inCombat) {
    events.push({
      type: 'ACTION_USED',
      actorId,
      actionName: 'custom',
      cost: spentAs === 'bonus_action' ? 'bonus_action' : 'action',
    } as unknown as GameEvent);
  }

  syncMirrors(nextState, rngState);
  return { nextState, events, outcome: { intent, success, roll: rollRes.naturalRoll, modifier, total: rollRes.total, dc, ...(goldEarned !== undefined ? { goldEarned } : {}), headline } };
}

// ---------------------------------------------------------------------------
// 7. Combat hide (real Stealth vs passive Perception → hidden)
// ---------------------------------------------------------------------------

export const HIDDEN_TACTICAL_EFFECT_ID = 'hidden-tactical';
export const CUNNING_ACTION_FEATURE_ID = 'cunning-action';

export function hasCunningAction(actor: Combatant): boolean {
  const featureIds = actor.characterSheet?.featureIds ?? [];
  if (featureIds.includes(CUNNING_ACTION_FEATURE_ID)) return true;
  const build = actor.buildState as unknown as {
    classEntries?: Array<{ subclassId?: string; classId?: string; level?: number }>;
    classes?: Array<{ subclassId?: string; classId?: string; level?: number }>;
  } | undefined;
  const entries = build?.classEntries ?? build?.classes ?? [];
  if (Array.isArray(entries) && entries.some((e) => e?.classId === 'rogue' && (e?.level ?? 0) >= 2)) return true;
  return false;
}

export interface CombatHideOptions {
  state: GameState;
  actorId: string;
  asBonusAction?: boolean;
}

export interface CombatHideOutcome {
  success: boolean;
  roll: number;
  modifier: number;
  total: number;
  dc: number;
  beatenIds: string[];
  spottedById?: string;
  headline: string;
}

/**
 * Combat Hide (Spec 03 §4.3 item 7): DEX (Stealth) contested by every
 * hostile living creature's passive Perception. Success grants the `hidden`
 * tactical state — implemented as the `invisible` condition (unseen attacker:
 * advantage on attacks made, attacks against have disadvantage) plus a
 * `hidden-tactical` marker so the UI can render it distinctly from magic.
 * Rogues with Cunning Action may hide as a bonus action.
 */
export function resolveCombatHide(options: CombatHideOptions): {
  nextState: GameState;
  events: GameEvent[];
  outcome: CombatHideOutcome;
} {
  const { actorId, asBonusAction = false } = options;
  const nextState = structuredClone(options.state);
  if (nextState.mode !== 'combat' || !nextState.combat) {
    throw new Error('Cannot hide outside active combat — use exploration stealth instead');
  }
  const combat = nextState.combat;
  const actor = combat.combatants[actorId];
  if (!actor) throw new Error(`Hide actor not found: ${actorId}`);
  if (combat.activeCombatantId !== actorId) throw new Error(`It is not ${actorId}'s turn`);
  if (!combat.turnBudget) throw new Error('No active turn budget');
  if (actor.isDead || actor.currentHp <= 0) throw new Error(`Hide actor ${actorId} is down`);

  if (asBonusAction) {
    if (!hasCunningAction(actor)) {
      throw new Error('Hiding as a bonus action requires Cunning Action (rogue 2)');
    }
    combat.turnBudget = spendBonusAction(combat.turnBudget);
  } else {
    combat.turnBudget = spendAction(combat.turnBudget);
  }

  const hostiles = Object.values(combat.combatants).filter(
    (c) => c.id !== actorId && !c.isDead && c.currentHp > 0 && areHostile(actor, c, combat.dispositionMatrix),
  );
  if (hostiles.length === 0) {
    throw new Error('Nothing to hide from — no hostile creatures remain');
  }
  const dc = Math.max(...hostiles.map((h) => h.passivePerception));

  const modifier = getSkillBonus(actor, 'stealth');
  let rngState: number = combat.rngState;
  const rollRes = rollD20(rngState, { modifier, mode: 'normal' });
  rngState = rollRes.nextState;
  const success = rollRes.total >= dc;

  const events: GameEvent[] = [{
    type: 'CHECK_RESOLVED',
    actorId,
    checkType: 'stealth',
    dc,
    roll: rollRes.naturalRoll,
    modifier,
    total: rollRes.total,
    success,
  } as unknown as GameEvent];

  let headline: string;
  const beatenIds = success ? hostiles.map((h) => h.id) : [];
  let spottedById: string | undefined;
  if (success) {
    const applied = applyConditionToCombatant(actor, 'invisible', {
      sourceEntityId: actorId,
      sourceName: 'Hidden (Stealth)',
    });
    const hidden: Combatant = { ...applied.combatant };
    combat.combatants[actorId] = hidden;
    pushMarkerEffect(combat.combatants[actorId]!, HIDDEN_TACTICAL_EFFECT_ID, 'Hidden (unseen attacker)');
    events.push(...applied.events);
    events.push({
      type: 'ACTION_USED',
      actorId,
      actionName: 'hide',
      cost: asBonusAction ? 'bonus_action' : 'action',
    } as unknown as GameEvent);
    headline = `${actor.name} hides (${rollRes.total} vs passive ${dc}) — hidden (unseen attacker).`;
  } else {
    spottedById = [...hostiles].sort((a, b) => b.passivePerception - a.passivePerception)[0]!.id;
    events.push({
      type: 'ACTION_USED',
      actorId,
      actionName: 'hide',
      cost: asBonusAction ? 'bonus_action' : 'action',
    } as unknown as GameEvent);
    headline = `${actor.name} fails to hide (${rollRes.total} vs passive ${dc}) — spotted by ${spottedById}.`;
  }

  syncMirrors(nextState, rngState);
  return {
    nextState,
    events,
    outcome: {
      success,
      roll: rollRes.naturalRoll,
      modifier,
      total: rollRes.total,
      dc,
      beatenIds,
      ...(spottedById ? { spottedById } : {}),
      headline,
    },
  };
}
