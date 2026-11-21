import { describe, expect, it } from 'vitest';
import {
  BEAST_CALMED_EFFECT_ID,
  BEAST_FRIEND_EFFECT_ID,
  HIDDEN_TACTICAL_EFFECT_ID,
  INTIMIDATED_ATTITUDE_COST_EFFECT_ID,
  INTIMIDATION_BACKLASH_EFFECT_ID,
  NATURE_FORAGE_BONUS_EFFECT_ID,
  PERFORMANCE_COVER_EFFECT_ID,
  PERFORMANCE_DISTRACTED_EFFECT_ID,
  getAnimalHandlingDc,
  getIntimidationDc,
  getPassiveScore,
  getSkillBonus,
  getSocialCue,
  hasCunningAction,
  hasHealersKit,
  resolveAnimalHandlingAttempt,
  resolveCombatHide,
  resolveDiagnoseAttempt,
  resolveInsightContest,
  resolveIntimidationAttempt,
  resolveNatureLoreAttempt,
  resolvePerformanceAttempt,
  resolveStabilizeAttempt,
} from '../social/contests.js';
import { createDungeonGameState } from '../dungeon/state.js';
import type { DungeonFloorSpec } from '../dungeon/schemas.js';
import { startCombatEncounter, createTurnBudget, type Combatant } from '../combat/index.js';
import { createTacticalGrid } from '../grid/model.js';
import { createInitialGameState, reduceGame } from '../state/reducer.js';
import type { GameState } from '../state/types.js';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

type SheetOpts = {
  skills?: Record<string, number>;
  tools?: string[];
  featureIds?: string[];
  inventory?: Array<{ itemId?: string; name?: string }>;
  classEntries?: Array<{ classId?: string; subclassId?: string; level?: number }>;
};

function makeSheet(opts: SheetOpts = {}) {
  const skills: Record<string, any> = {};
  for (const [skill, totalBonus] of Object.entries(opts.skills ?? {})) {
    skills[skill] = {
      skill,
      ability: 'wis',
      proficiencyLevel: totalBonus >= 4 ? 'proficient' : 'none',
      abilityModifier: 2,
      proficiencyBonus: 2,
      flatBonus: 0,
      totalBonus,
      passiveScore: 10 + totalBonus,
      rollMode: 'normal',
      breakdown: [],
    };
  }
  // Perception default so theft-DC style fallbacks behave.
  if (!skills['perception']) {
    skills['perception'] = {
      skill: 'perception', ability: 'wis', proficiencyLevel: 'none',
      abilityModifier: 2, proficiencyBonus: 0, flatBonus: 0,
      totalBonus: 2, passiveScore: 12, rollMode: 'normal', breakdown: [],
    };
  }
  return {
    abilities: {
      str: { score: 10, modifier: 0 },
      dex: { score: 14, modifier: 2 },
      con: { score: 14, modifier: 2 },
      int: { score: 12, modifier: 1 },
      wis: { score: 14, modifier: 2 },
      cha: { score: 12, modifier: 1 },
    },
    proficiencyBonus: 2,
    proficiencies: { tools: opts.tools ?? [], expertise: [], skills: [], armor: [], weapons: [], savingThrows: [] },
    skills,
    featureIds: opts.featureIds ?? [],
  } as any;
}

function makeCombatant(
  id: string,
  x: number,
  y: number,
  side: 'party' | 'monster' = 'party',
  opts: SheetOpts & {
    perceptionPassive?: number;
    stealthModifier?: number;
    hp?: number;
    monsterType?: string;
    conditions?: string[];
    deathSaves?: { successes: number; failures: number };
    isStable?: boolean;
  } = {},
): Combatant {
  const c = {
    id,
    name: id,
    side,
    size: 'medium',
    position: { x, y },
    speedFeet: 30,
    currentHp: opts.hp ?? 20,
    maxHp: 20,
    tempHp: 0,
    armorClass: 14,
    dexterityScore: 14,
    dexterityModifier: 2,
    initiativeBonus: 2,
    initiativeRollMode: 'normal',
    passivePerception: opts.perceptionPassive ?? 12,
    stealthModifier: opts.stealthModifier ?? 2,
    isSurprised: false,
    conditions: (opts.conditions ?? []) as any,
    deathSaves: opts.deathSaves ?? { successes: 0, failures: 0 },
    isDead: false,
    isStable: opts.isStable ?? false,
    attacksPerAction: 1,
    reactionAvailable: true,
    damageResistances: [],
    damageImmunities: [],
    damageVulnerabilities: [],
    conditionImmunities: [],
    characterSheet: makeSheet(opts),
  } as unknown as Combatant;
  if (opts.inventory) {
    (c as any).buildState = {
      inventory: opts.inventory,
      currency: { gp: 10 },
    };
  }
  if (opts.classEntries) {
    (c as any).buildState = {
      ...(c as any).buildState,
      inventory: opts.inventory ?? [],
      currency: { gp: 10 },
      classEntries: opts.classEntries,
    };
  }
  if (opts.monsterType) {
    (c as any).monsterData = { type: opts.monsterType, skills: {} };
  }
  return c;
}

function makeFloor(): DungeonFloorSpec {
  const cells = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      cells.push({ x, y, roomId: 'room-1', terrain: 'floor_stone', baseLight: 'bright', elevationFeet: 0 } as any);
    }
  }
  return {
    id: 'skill-test-floor',
    name: 'Skill Test Floor',
    width: 5,
    height: 5,
    rooms: [{ id: 'room-1', name: 'Test Room' } as any],
    cells,
    props: [],
    encounters: [],
    partySpawnCells: [{ x: 1, y: 1 }],
  } as unknown as DungeonFloorSpec;
}

function makeExplorationState(opts: {
  actor?: Combatant;
  target?: Combatant;
  rngState?: number;
  targetSide?: 'party' | 'monster';
} = {}): GameState {
  const actor = opts.actor ?? makeCombatant('hero-1', 1, 1, 'party', { skills: { insight: 5 } });
  const target = opts.target ?? makeCombatant('mark-1', 1, 2, opts.targetSide ?? 'monster', { skills: { deception: 2 } });
  const state = createDungeonGameState({ floor: makeFloor(), party: [actor], rngState: opts.rngState ?? 7 });
  state.monsters = {};
  if ((opts.targetSide ?? 'monster') === 'monster') {
    state.monsters[target.id] = { ...target, roomId: 'room-1' };
  } else {
    state.party[target.id] = { ...target, roomId: 'room-1' };
  }
  state.party[actor.id] = { ...state.party[actor.id]!, position: { x: 1, y: 1 }, roomId: 'room-1' };
  const mark = state.monsters[target.id] ?? state.party[target.id];
  if (mark) mark.position = { x: 1, y: 2 };
  return state;
}

function makeCombatState(actor: Combatant, foes: Combatant[], rngState = 11): GameState {
  const grid = createTacticalGrid(5, 5);
  const state = createInitialGameState({ grid, party: [actor], monsters: foes, rngState });
  const started = startCombatEncounter({
    encounterId: 'skill-combat',
    combatants: [actor, ...foes],
    rngState: state.rngState,
  });
  const combatActor = started.state.combatants[actor.id]!;
  state.mode = 'combat';
  state.combat = {
    ...started.state,
    activeCombatantId: actor.id,
    activeCombatantIndex: started.state.initiativeOrder.findIndex((e) => e.entityId === actor.id),
    turnBudget: createTurnBudget(combatActor, false),
  };
  state.rngState = started.state.rngState;
  return state;
}

function findSeed(
  build: (seed: number) => GameState,
  attempt: (state: GameState) => unknown,
  want: boolean,
  max = 3000,
): { seed: number; state: GameState } {
  for (let seed = 1; seed < max; seed++) {
    const state = build(seed);
    try {
      const out = attempt(state) as unknown as { outcome?: { success?: boolean }; success?: boolean };
      const success = (out as any).outcome?.success ?? (out as any).success;
      if (success === want) return { seed, state };
    } catch {
      // setup invalid for this seed — keep scanning
    }
  }
  throw new Error(`No seed found for success=${want}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe('SRD-1208: skill bonus helpers', () => {
  it('reads sheet bonuses and passive scores with ability fallback', () => {
    const c = makeCombatant('a', 0, 0, 'party', { skills: { insight: 7 } });
    expect(getSkillBonus(c, 'insight')).toBe(7);
    expect(getPassiveScore(c, 'insight')).toBe(17);
    // untracked skill falls back to governing ability (persuasion → CHA +1)
    expect(getSkillBonus(c, 'persuasion')).toBe(1);
    expect(getPassiveScore(c, 'persuasion')).toBe(11);
  });

  it('detects healers kits and cunning action', () => {
    const withKit = makeCombatant('a', 0, 0, 'party', {
      inventory: [{ itemId: 'healers_kit', name: "Healer's Kit" }],
    });
    expect(hasHealersKit(withKit)).toBe(true);
    const rogue = makeCombatant('b', 0, 0, 'party', {
      classEntries: [{ classId: 'rogue', level: 2 }],
    });
    expect(hasCunningAction(rogue)).toBe(true);
    const plain = makeCombatant('c', 0, 0);
    expect(hasHealersKit(plain)).toBe(false);
    expect(hasCunningAction(plain)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Insight vs Deception
// ---------------------------------------------------------------------------

describe('SRD-1208: Insight opposes Deception', () => {
  it('observer Insight opposes speaker Deception; winner takes the read', () => {
    const build = (seed: number) =>
      makeExplorationState({
        rngState: seed,
        actor: makeCombatant('reader-1', 1, 1, 'party', { skills: { insight: 8 } }),
        target: makeCombatant('liar-1', 1, 2, 'monster', { skills: { deception: 1 } }),
      });
    const { state } = findSeed(
      build,
      (s) => resolveInsightContest({ state: s, actorId: 'reader-1', targetId: 'liar-1' }),
      true,
    );
    const res = resolveInsightContest({ state, actorId: 'reader-1', targetId: 'liar-1' });
    expect(res.outcome.success).toBe(true);
    expect(res.outcome.observerTotal).toBeGreaterThanOrEqual(res.outcome.speakerTotal);
    const checks = res.events.filter((e) => e.type === 'CHECK_RESOLVED');
    expect(checks.some((e: any) => e.checkType === 'insight')).toBe(true);
    expect(checks.some((e: any) => e.checkType === 'deception')).toBe(true);
  });

  it('a failed read still surfaces the passive "something feels off" cue', () => {
    // Reader passive (10+8=18) beats a fixed high lie (15) even when the
    // rolled read can be forced low via seed scan for failure.
    const build = (seed: number) =>
      makeExplorationState({
        rngState: seed,
        actor: makeCombatant('reader-1', 1, 1, 'party', { skills: { insight: 8 } }),
        target: makeCombatant('liar-1', 1, 2, 'monster', { skills: { deception: 5 } }),
      });
    const { state } = findSeed(
      build,
      (s) =>
        resolveInsightContest({
          state: s,
          actorId: 'reader-1',
          targetId: 'liar-1',
          speakerDeceptionTotal: 15,
        }),
      false,
    );
    const res = resolveInsightContest({
      state,
      actorId: 'reader-1',
      targetId: 'liar-1',
      speakerDeceptionTotal: 15,
    });
    expect(res.outcome.success).toBe(false);
    expect(res.outcome.passiveBeatsLie).toBe(true);
    expect(res.outcome.cue).toContain('something feels off');
    const insightCheck: any = res.events.find(
      (e: any) => e.type === 'CHECK_RESOLVED' && e.checkType === 'insight',
    );
    expect(insightCheck?.note).toContain('something feels off');
  });

  it('getSocialCue is passive-only and returns undefined when passive is low', () => {
    const sharp = makeCombatant('a', 0, 0, 'party', { skills: { insight: 6 } });
    expect(getSocialCue(sharp, 15)).toContain('something feels off');
    const dull = makeCombatant('b', 0, 0, 'party', { skills: { insight: 0 } });
    expect(getSocialCue(dull, 15)).toBeUndefined();
  });

  it('routes through the CONTEST_INSIGHT reducer command', () => {
    const state = makeExplorationState({
      rngState: 42,
      actor: makeCombatant('reader-1', 1, 1, 'party', { skills: { insight: 8 } }),
      target: makeCombatant('liar-1', 1, 2, 'monster', { skills: { deception: 1 } }),
    });
    const { events } = reduceGame(state, {
      type: 'CONTEST_INSIGHT',
      actorId: 'reader-1',
      targetId: 'liar-1',
    });
    expect(events.some((e: any) => e.type === 'CHECK_RESOLVED' && e.checkType === 'insight')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Medicine stabilize + diagnose
// ---------------------------------------------------------------------------

describe('SRD-1208: Medicine stabilize requires the check', () => {
  function dyingState(seed: number, opts: { kit?: boolean; medicine?: number } = {}) {
    return makeExplorationState({
      rngState: seed,
      actor: makeCombatant('cleric-1', 1, 1, 'party', {
        skills: { medicine: opts.medicine ?? 5 },
        ...(opts.kit ? { inventory: [{ itemId: 'healers_kit' }] } : {}),
      }),
      target: makeCombatant('down-1', 1, 2, 'party', {}, ),
      targetSide: 'party',
    });
  }

  it('DC 10 success stabilizes and resets death saves; failure leaves dying', () => {
    // Force the downed target into a dying shape first.
    const { state: winState } = findSeed(
      (seed) => {
        const s = dyingState(seed);
        s.party['down-1'] = {
          ...s.party['down-1']!,
          currentHp: 0,
          conditions: ['unconscious'] as any,
          deathSaves: { successes: 1, failures: 2 } as { successes: 0 | 1 | 2 | 3; failures: 0 | 1 | 2 | 3 },
          isStable: false,
        };
        return s;
      },
      (s) => resolveStabilizeAttempt({ state: s, actorId: 'cleric-1', targetId: 'down-1' }),
      true,
    );
    const target = { ...winState.party['down-1']!, currentHp: 0, conditions: ['unconscious'] as any, deathSaves: { successes: 1, failures: 2 } as { successes: 0 | 1 | 2 | 3; failures: 0 | 1 | 2 | 3 }, isStable: false };
    winState.party['down-1'] = target;
    const won = resolveStabilizeAttempt({ state: winState, actorId: 'cleric-1', targetId: 'down-1' });
    expect(won.outcome.success).toBe(true);
    const stabilized = won.nextState.party['down-1']!;
    expect(stabilized.isStable).toBe(true);
    expect(stabilized.deathSaves).toEqual({ successes: 0, failures: 0 });

    const { state: loseState } = findSeed(
      (seed) => {
        const s = dyingState(seed, { medicine: -2 });
        s.party['down-1'] = {
          ...s.party['down-1']!,
          currentHp: 0,
          conditions: ['unconscious'] as any,
          deathSaves: { successes: 0, failures: 1 } as { successes: 0 | 1 | 2 | 3; failures: 0 | 1 | 2 | 3 },
          isStable: false,
        };
        return s;
      },
      (s) => resolveStabilizeAttempt({ state: s, actorId: 'cleric-1', targetId: 'down-1' }),
      false,
    );
    const doomed = { ...loseState.party['down-1']!, currentHp: 0, conditions: ['unconscious'] as any, deathSaves: { successes: 0, failures: 1 } as { successes: 0 | 1 | 2 | 3; failures: 0 | 1 | 2 | 3 }, isStable: false };
    loseState.party['down-1'] = doomed;
    const lost = resolveStabilizeAttempt({ state: loseState, actorId: 'cleric-1', targetId: 'down-1' });
    expect(lost.outcome.success).toBe(false);
    expect(lost.nextState.party['down-1']!.isStable).toBe(false);
    expect(lost.nextState.party['down-1']!.deathSaves).toEqual({ successes: 0, failures: 1 });
  });

  it("healer's kit grants advantage on the stabilize roll", () => {
    const withKit = makeCombatant('cleric-1', 1, 1, 'party', {
      skills: { medicine: 3 },
      inventory: [{ itemId: 'healers_kit' }],
    });
    const downed = makeCombatant('down-1', 1, 2, 'party');
    const state = makeExplorationState({ rngState: 9, actor: withKit, target: downed, targetSide: 'party' });
    state.party['down-1'] = { ...state.party['down-1']!, currentHp: 0, conditions: ['unconscious'] as any, isStable: false };
    const res = resolveStabilizeAttempt({ state, actorId: 'cleric-1', targetId: 'down-1' });
    expect(res.outcome.hadKitAdvantage).toBe(true);
    const check: any = res.events.find((e: any) => e.type === 'CHECK_RESOLVED' && e.checkType === 'medicine');
    expect(check).toBeDefined();
    expect(check.dc).toBe(10);
  });

  it('diagnose identifies poison and names the cure path', () => {
    const actor = makeCombatant('cleric-1', 1, 1, 'party', { skills: { medicine: 9 } });
    const victim = makeCombatant('sick-1', 1, 2, 'party', {}, );
    const state = makeExplorationState({ rngState: 3, actor, target: victim, targetSide: 'party' });
    state.party['sick-1'] = { ...state.party['sick-1']!, conditions: ['poisoned'] as any };
    const res = resolveDiagnoseAttempt({ state, actorId: 'cleric-1', targetId: 'sick-1' });
    expect(res.outcome.success).toBe(true);
    expect(res.outcome.ailment).toBe('poisoned');
    expect(res.outcome.cure).toContain('lesser restoration');
    expect(res.outcome.headline).toContain('poisoned');
  });

  it('routes through the ATTEMPT_STABILIZE reducer command', () => {
    const state = dyingState(5);
    state.party['down-1'] = { ...state.party['down-1']!, currentHp: 0, conditions: ['unconscious'] as any, isStable: false };
    const { events } = reduceGame(state, { type: 'ATTEMPT_STABILIZE', actorId: 'cleric-1', targetId: 'down-1' });
    expect(events.some((e: any) => e.type === 'CHECK_RESOLVED' && e.checkType === 'medicine')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Intimidation
// ---------------------------------------------------------------------------

describe('SRD-1208: Intimidation third leg', () => {
  it('success frightens with an attitude-cost marker; dc defaults to Insight passive', () => {
    const target = makeCombatant('guard-1', 1, 2, 'monster', { skills: { insight: 2 } });
    expect(getIntimidationDc(target)).toBe(12);
    const build = (seed: number) =>
      makeExplorationState({
        rngState: seed,
        actor: makeCombatant('boss-1', 1, 1, 'party', { skills: { intimidation: 9 } }),
        target: makeCombatant('guard-1', 1, 2, 'monster', { skills: { insight: 2 } }),
      });
    const { state } = findSeed(
      build,
      (s) => resolveIntimidationAttempt({ state: s, actorId: 'boss-1', targetId: 'guard-1' }),
      true,
    );
    const res = resolveIntimidationAttempt({ state, actorId: 'boss-1', targetId: 'guard-1' });
    expect(res.outcome.success).toBe(true);
    const marked = res.nextState.monsters['guard-1']!;
    expect(marked.conditions).toContain('frightened');
    expect(marked.activeEffects?.some((e) => e.effectId === INTIMIDATED_ATTITUDE_COST_EFFECT_ID)).toBe(true);
    expect(res.outcome.headline).toContain('attitude');
  });

  it('disastrous failure marks backlash instead of silent nothing', () => {
    const build = (seed: number) =>
      makeExplorationState({
        rngState: seed,
        actor: makeCombatant('boss-1', 1, 1, 'party', { skills: { intimidation: -2 } }),
        target: makeCombatant('guard-1', 1, 2, 'monster', { skills: { insight: 6 } }),
      });
    const { state } = findSeed(
      build,
      (s) => {
        const r = resolveIntimidationAttempt({ state: s, actorId: 'boss-1', targetId: 'guard-1' });
        return { success: r.outcome.backlash };
      },
      true,
    );
    const res = resolveIntimidationAttempt({ state, actorId: 'boss-1', targetId: 'guard-1' });
    expect(res.outcome.success).toBe(false);
    expect(res.outcome.backlash).toBe(true);
    expect(
      res.nextState.monsters['guard-1']!.activeEffects?.some((e) => e.effectId === INTIMIDATION_BACKLASH_EFFECT_ID),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Animal Handling / Nature / Performance
// ---------------------------------------------------------------------------

describe('SRD-1208: Animal Handling, Nature, Performance homes', () => {
  it('calm ends fear on a beast; befriend charms it', () => {
    const beast = makeCombatant('wolf-1', 1, 2, 'monster', {
      skills: {},
      monsterType: 'beast',
      conditions: ['frightened'],
    });
    expect(getAnimalHandlingDc(beast, 'calm')).toBeLessThan(getAnimalHandlingDc(beast, 'command'));
    const handler = makeCombatant('ranger-1', 1, 1, 'party', { skills: { 'animal-handling': 9 } });
    const state = makeExplorationState({ rngState: 21, actor: handler, target: beast });
    const calmed = resolveAnimalHandlingAttempt({ state, actorId: 'ranger-1', targetId: 'wolf-1', intent: 'calm', dcOverride: 5 });
    expect(calmed.outcome.success).toBe(true);
    expect(calmed.nextState.monsters['wolf-1']!.conditions).not.toContain('frightened');
    expect(
      calmed.nextState.monsters['wolf-1']!.activeEffects?.some((e) => e.effectId === BEAST_CALMED_EFFECT_ID),
    ).toBe(true);

    const state2 = makeExplorationState({ rngState: 21, actor: handler, target: beast });
    const befriended = resolveAnimalHandlingAttempt({ state: state2, actorId: 'ranger-1', targetId: 'wolf-1', intent: 'befriend', dcOverride: 5 });
    expect(befriended.outcome.success).toBe(true);
    expect(befriended.nextState.monsters['wolf-1']!.conditions).toContain('charmed');
    expect(
      befriended.nextState.monsters['wolf-1']!.activeEffects?.some((e) => e.effectId === BEAST_FRIEND_EFFECT_ID),
    ).toBe(true);
  });

  it('nature lore identifies the subject and caches a forage bonus', () => {
    const state = makeExplorationState({
      rngState: 4,
      actor: makeCombatant('druid-1', 1, 1, 'party', { skills: { nature: 9 } }),
    });
    const res = resolveNatureLoreAttempt({ state, actorId: 'druid-1', subject: 'owlbear spoor', dc: 5 });
    expect(res.outcome.success).toBe(true);
    expect(res.outcome.headline).toContain('whether it is safe');
    const actor = res.nextState.party['druid-1']!;
    expect(actor.activeEffects?.some((e) => e.effectId === NATURE_FORAGE_BONUS_EFFECT_ID)).toBe(true);
  });

  it('performance earn pays coin; distract marks the mark; cover marks the performer', () => {
    const actor = makeCombatant('bard-1', 1, 1, 'party', {
      skills: { performance: 9 },
      inventory: [],
    });
    (actor as any).buildState = { inventory: [], currency: { gp: 0 } };
    const mark = makeCombatant('noble-1', 1, 2, 'monster');
    const earnState = makeExplorationState({ rngState: 8, actor, target: mark });
    const earned = resolvePerformanceAttempt({ state: earnState, actorId: 'bard-1', intent: 'earn', dc: 5 });
    expect(earned.outcome.success).toBe(true);
    expect(earned.outcome.goldEarned).toBeGreaterThan(0);

    const distractState = makeExplorationState({ rngState: 8, actor, target: mark });
    const distracted = resolvePerformanceAttempt({ state: distractState, actorId: 'bard-1', targetId: 'noble-1', intent: 'distract', dc: 5 });
    expect(distracted.outcome.success).toBe(true);
    expect(
      distracted.nextState.monsters['noble-1']!.activeEffects?.some((e) => e.effectId === PERFORMANCE_DISTRACTED_EFFECT_ID),
    ).toBe(true);

    const coverState = makeExplorationState({ rngState: 8, actor, target: mark });
    const covered = resolvePerformanceAttempt({ state: coverState, actorId: 'bard-1', intent: 'cover', dc: 5 });
    expect(covered.outcome.success).toBe(true);
    expect(
      covered.nextState.party['bard-1']!.activeEffects?.some((e) => e.effectId === PERFORMANCE_COVER_EFFECT_ID),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Combat hide
// ---------------------------------------------------------------------------

describe('SRD-1208: real combat hide grants hidden', () => {
  it('Stealth beating hostile passive Perception hides (invisible + marker)', () => {
    const rogue = makeCombatant('rogue-1', 0, 0, 'party', {
      skills: { stealth: 9 },
      classEntries: [{ classId: 'rogue', level: 2 }],
    });
    const goblin = makeCombatant('goblin-1', 4, 4, 'monster', { perceptionPassive: 9, stealthModifier: 2 });
    const build = (seed: number) => makeCombatState(rogue, [goblin], seed);
    const { state } = findSeed(
      build,
      (s) => resolveCombatHide({ state: s, actorId: 'rogue-1' }),
      true,
    );
    const res = resolveCombatHide({ state, actorId: 'rogue-1' });
    expect(res.outcome.success).toBe(true);
    const hidden = res.nextState.combat!.combatants['rogue-1']!;
    expect(hidden.conditions).toContain('invisible');
    expect(hidden.activeEffects?.some((e) => e.effectId === HIDDEN_TACTICAL_EFFECT_ID)).toBe(true);
    expect(res.outcome.headline).toContain('unseen attacker');
  });

  it('failed hide names the spotter and spends the action', () => {
    const clumsy = makeCombatant('clumsy-1', 0, 0, 'party', { skills: { stealth: -2 } });
    const watcher = makeCombatant('watcher-1', 4, 4, 'monster', { perceptionPassive: 16 });
    const build = (seed: number) => makeCombatState(clumsy, [watcher], seed);
    const { state } = findSeed(
      build,
      (s) => resolveCombatHide({ state: s, actorId: 'clumsy-1' }),
      false,
    );
    const res = resolveCombatHide({ state, actorId: 'clumsy-1' });
    expect(res.outcome.success).toBe(false);
    expect(res.outcome.spottedById).toBe('watcher-1');
    expect(res.nextState.combat!.combatants['clumsy-1']!.conditions).not.toContain('invisible');
  });

  it('rogues may hide as a bonus action; others cannot', () => {
    const rogue = makeCombatant('rogue-1', 0, 0, 'party', {
      skills: { stealth: 9 },
      classEntries: [{ classId: 'rogue', level: 2 }],
    });
    const goblin = makeCombatant('goblin-1', 4, 4, 'monster', { perceptionPassive: 5 });
    const rogueState = makeCombatState(rogue, [goblin], 77);
    const bonus = resolveCombatHide({ state: rogueState, actorId: 'rogue-1', asBonusAction: true });
    expect(bonus.outcome.success).toBe(true);
    expect(bonus.nextState.combat!.turnBudget?.action).toBe(1);

    const plain = makeCombatant('plain-1', 0, 0, 'party', { skills: { stealth: 9 } });
    const plainState = makeCombatState(plain, [goblin], 77);
    expect(() => resolveCombatHide({ state: plainState, actorId: 'plain-1', asBonusAction: true })).toThrow(
      /Cunning Action/,
    );
  });

  it('USE_STANDARD_ACTION hide resolves through the reducer with CHECK_RESOLVED stealth', () => {
    const rogue = makeCombatant('rogue-1', 0, 0, 'party', { skills: { stealth: 12 } });
    const goblin = makeCombatant('goblin-1', 4, 4, 'monster', { perceptionPassive: 5 });
    const state = makeCombatState(rogue, [goblin], 99);
    const { events, nextState } = reduceGame(state, {
      type: 'USE_STANDARD_ACTION',
      actorId: 'rogue-1',
      action: 'hide',
    });
    expect(events.some((e: any) => e.type === 'CHECK_RESOLVED' && e.checkType === 'stealth')).toBe(true);
    expect(nextState.combat!.combatants['rogue-1']!.conditions).toContain('invisible');
  });
});
