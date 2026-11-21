import { describe, expect, it } from 'vitest';
import {
  COMPONENT_POUCH_SNIPPED_EFFECT_ID,
  FAST_HANDS_FEATURE_ID,
  PLANTED_EVIDENCE_EFFECT_ID,
  STOLEN_KEY_EFFECT_ID,
  THEFT_ALERTED_EFFECT_ID,
  getAvailableTheftKinds,
  getSleightOfHandBonus,
  hasFastHands,
  hasThievesTools,
  resolveTheftAttempt,
  type TheftKind,
} from '../dungeon/theft.js';
import { createDungeonGameState } from '../dungeon/state.js';
import type { DungeonFloorSpec } from '../dungeon/schemas.js';
import { startCombatEncounter, createTurnBudget, type Combatant } from '../combat/index.js';
import { createTacticalGrid } from '../grid/model.js';
import { createInitialGameState, reduceGame } from '../state/reducer.js';
import type { GameState } from '../state/types.js';

function makeSheet(overrides: {
  sleightBonus?: number;
  perceptionPassive?: number;
  tools?: string[];
  featureIds?: string[];
  dexMod?: number;
} = {}) {
  const dexMod = overrides.dexMod ?? 3;
  const sleightBonus = overrides.sleightBonus ?? dexMod;
  const perceptionPassive = overrides.perceptionPassive ?? 12;
  return {
    abilities: {
      str: { score: 10, modifier: 0 },
      dex: { score: 10 + dexMod * 2, modifier: dexMod },
      con: { score: 14, modifier: 2 },
      int: { score: 10, modifier: 0 },
      wis: { score: 14, modifier: 2 },
      cha: { score: 10, modifier: 0 },
    },
    proficiencyBonus: 2,
    proficiencies: {
      tools: overrides.tools ?? [],
      expertise: [],
      skills: [],
      armor: [],
      weapons: [],
      savingThrows: [],
    },
    skills: {
      'sleight-of-hand': {
        skill: 'sleight-of-hand',
        ability: 'dex',
        proficiencyLevel: 'proficient',
        abilityModifier: dexMod,
        proficiencyBonus: 2,
        flatBonus: 0,
        totalBonus: sleightBonus,
        passiveScore: 10 + sleightBonus,
        rollMode: 'normal',
        breakdown: [],
      },
      perception: {
        skill: 'perception',
        ability: 'wis',
        proficiencyLevel: 'none',
        abilityModifier: 2,
        proficiencyBonus: 0,
        flatBonus: 0,
        totalBonus: perceptionPassive - 10,
        passiveScore: perceptionPassive,
        rollMode: 'normal',
        breakdown: [],
      },
    },
    featureIds: overrides.featureIds ?? [],
  } as any;
}

function makeCombatant(id: string, x: number, y: number, side: 'party' | 'monster' = 'party', sheetOpts: Parameters<typeof makeSheet>[0] = {}): Combatant {
  return {
    id,
    name: id,
    side,
    size: 'medium',
    position: { x, y },
    speedFeet: 30,
    currentHp: 20,
    maxHp: 20,
    tempHp: 0,
    armorClass: 14,
    dexterityScore: 14,
    dexterityModifier: 3,
    initiativeBonus: 2,
    initiativeRollMode: 'normal',
    passivePerception: sheetOpts.perceptionPassive ?? 12,
    stealthModifier: 3,
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
    characterSheet: makeSheet(sheetOpts),
  } as unknown as Combatant;
}

function makeFloor(): DungeonFloorSpec {
  const cells = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      cells.push({ x, y, roomId: 'room-1', terrain: 'floor_stone', baseLight: 'bright', elevationFeet: 0 } as any);
    }
  }
  return {
    id: 'theft-test-floor',
    name: 'Theft Test Floor',
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
  actorSheet?: Parameters<typeof makeSheet>[0];
  targetSheet?: Parameters<typeof makeSheet>[0];
  rngState?: number;
  targetSide?: 'party' | 'monster';
} = {}): GameState {
  const actor = makeCombatant('rogue-1', 1, 1, 'party', opts.actorSheet);
  const target = makeCombatant('mark-1', 1, 2, opts.targetSide ?? 'monster', opts.targetSheet);
  const state = createDungeonGameState({
    floor: makeFloor(),
    party: [actor],
    rngState: opts.rngState ?? 7,
  });
  // Place the mark adjacent in the same room.
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

/** Brute-force a seed producing the requested theft outcome band. */
function findSeedFor(
  kind: TheftKind,
  predicate: (res: ReturnType<typeof resolveTheftAttempt>) => boolean,
  baseOpts: { actorSheet?: Parameters<typeof makeSheet>[0]; targetSheet?: Parameters<typeof makeSheet>[0] } = {},
  liftWhat: 'key' | 'pouch' = 'key',
): { seed: number; res: ReturnType<typeof resolveTheftAttempt> } {
  for (let seed = 1; seed < 2000; seed++) {
    const state = makeExplorationState({ ...baseOpts, rngState: seed });
    try {
      const res = resolveTheftAttempt({
        state,
        actorId: 'rogue-1',
        targetId: 'mark-1',
        kind,
        liftWhat,
      });
      if (predicate(res)) return { seed, res };
    } catch {
      // Invalid setup for this seed — keep scanning.
    }
  }
  throw new Error(`No seed found for theft predicate (kind=${kind})`);
}

function makeCombatTheftState(opts: {
  actorSheet?: Parameters<typeof makeSheet>[0];
  targetSheet?: Parameters<typeof makeSheet>[0];
  rngState?: number;
} = {}): GameState {
  const state = makeExplorationState({ ...opts, rngState: opts.rngState ?? 11 });
  const actor = state.party['rogue-1']!;
  const mark = state.monsters['mark-1'] ?? state.party['mark-1']!;
  const started = startCombatEncounter({
    encounterId: 'theft-combat',
    combatants: [actor, mark],
    rngState: state.rngState,
  });
  const combatActor = started.state.combatants['rogue-1']!;
  state.mode = 'combat';
  state.combat = {
    ...started.state,
    activeCombatantId: 'rogue-1',
    activeCombatantIndex: started.state.initiativeOrder.findIndex((e) => e.entityId === 'rogue-1'),
    turnBudget: createTurnBudget(combatActor, false),
  };
  state.rngState = started.state.rngState;
  return state;
}

describe('SRD-1206: Sleight of Hand helpers', () => {
  it('reads the DEX (Sleight of Hand) bonus and tools/fast-hands flags', () => {
    const skilled = makeCombatant('a', 0, 0, 'party', { sleightBonus: 7, tools: ['thieves_tools'], featureIds: [FAST_HANDS_FEATURE_ID] });
    expect(getSleightOfHandBonus(skilled)).toBe(7);
    expect(hasThievesTools(skilled)).toBe(true);
    expect(hasFastHands(skilled)).toBe(true);

    const plain = makeCombatant('b', 0, 0, 'party', { sleightBonus: 2 });
    expect(getSleightOfHandBonus(plain)).toBe(2);
    expect(hasThievesTools(plain)).toBe(false);
    expect(hasFastHands(plain)).toBe(false);
  });

  it('lists the three theft verbs with check hints', () => {
    const actor = makeCombatant('a', 0, 0, 'party', { sleightBonus: 5, tools: ['thieves_tools'] });
    const kinds = getAvailableTheftKinds(actor);
    expect(kinds.map((k) => k.kind).sort()).toEqual(['lift', 'pickpocket', 'plant']);
    expect(kinds[0]!.hint).toContain('Sleight of Hand');
    expect(kinds[0]!.hint).toContain('adv');
  });

  it('rejects self-theft, down targets, and out-of-reach marks', () => {
    const state = makeExplorationState();
    expect(() =>
      resolveTheftAttempt({ state, actorId: 'rogue-1', targetId: 'rogue-1', kind: 'pickpocket' }),
    ).toThrow(/yourself/);
    expect(() =>
      resolveTheftAttempt({ state, actorId: 'rogue-1', targetId: 'ghost', kind: 'pickpocket' }),
    ).toThrow(/not found/);
    const far = makeExplorationState();
    far.monsters['mark-1']!.position = { x: 4, y: 4 };
    expect(() =>
      resolveTheftAttempt({ state: far, actorId: 'rogue-1', targetId: 'mark-1', kind: 'pickpocket' }),
    ).toThrow(/out of reach/);
  });
});

describe('SRD-1206: theft payloads (success path)', () => {
  it('pickpocket success lifts gold and emits CHECK + THEFT events', () => {
    const { res } = findSeedFor('pickpocket', (r) => r.outcome.success, {
      actorSheet: { sleightBonus: 7, tools: ['thieves_tools'] },
      targetSheet: { perceptionPassive: 10 },
    });
    expect(res.outcome.success).toBe(true);
    expect(res.outcome.caught).toBe(false);
    expect(res.outcome.goldStolen).toBeGreaterThan(0);
    expect(res.outcome.hadToolsAdvantage).toBe(true);
    const check = res.events.find((e) => e.type === 'CHECK_RESOLVED');
    expect(check).toBeDefined();
    expect((check as any).checkType).toBe('sleight_of_hand');
    const theft = res.events.find((e) => e.type === 'THEFT_RESOLVED');
    expect(theft).toBeDefined();
    expect((theft as any).kind).toBe('pickpocket');
    expect((theft as any).headline).toContain('gp');
  });

  it('tools proficiency is reported via hadToolsAdvantage (no gate)', () => {
    const withTools = makeExplorationState({
      actorSheet: { sleightBonus: 3, tools: ['thieves_tools'] },
      targetSheet: { perceptionPassive: 12 },
      rngState: 42,
    });
    const withoutTools = makeExplorationState({
      actorSheet: { sleightBonus: 3 },
      targetSheet: { perceptionPassive: 12 },
      rngState: 42,
    });
    const a = resolveTheftAttempt({ state: withTools, actorId: 'rogue-1', targetId: 'mark-1', kind: 'pickpocket' });
    const b = resolveTheftAttempt({ state: withoutTools, actorId: 'rogue-1', targetId: 'mark-1', kind: 'pickpocket' });
    expect(a.outcome.hadToolsAdvantage).toBe(true);
    expect(b.outcome.hadToolsAdvantage).toBe(false);
  });

  it('plant success marks the target with planted evidence', () => {
    const { res } = findSeedFor('plant', (r) => r.outcome.success, {
      actorSheet: { sleightBonus: 7 },
      targetSheet: { perceptionPassive: 10 },
    });
    expect(res.outcome.success).toBe(true);
    const mark = res.nextState.monsters['mark-1'] ?? res.nextState.party['mark-1'];
    expect(mark!.activeEffects?.some((e: any) => e.effectId === PLANTED_EVIDENCE_EFFECT_ID)).toBe(true);
  });

  it('lift steals a key vs snips a component pouch', () => {
    const keyHit = findSeedFor('lift', (r) => r.outcome.success, {
      actorSheet: { sleightBonus: 7 },
      targetSheet: { perceptionPassive: 10 },
    }, 'key');
    const thief = keyHit.res.nextState.party['rogue-1']!;
    expect(thief.activeEffects?.some((e: any) => e.effectId === STOLEN_KEY_EFFECT_ID)).toBe(true);

    const pouchHit = findSeedFor('lift', (r) => r.outcome.success, {
      actorSheet: { sleightBonus: 7 },
      targetSheet: { perceptionPassive: 10 },
    }, 'pouch');
    const mark = pouchHit.res.nextState.monsters['mark-1'] ?? pouchHit.res.nextState.party['mark-1'];
    expect(mark!.activeEffects?.some((e: any) => e.effectId === COMPONENT_POUCH_SNIPPED_EFFECT_ID)).toBe(true);
    expect((pouchHit.res.events.find((e) => e.type === 'THEFT_RESOLVED') as any).liftWhat).toBe('pouch');
  });
});

describe('SRD-1206: failure branches are never silent', () => {
  it('a close miss is spotted (no payload, not caught, still emits both events)', () => {
    // Bonus +0 vs DC 12: totals 8..11 are spotted (fail by <5), never silent.
    const { res } = findSeedFor('pickpocket', (r) => !r.outcome.success && !r.outcome.caught, {
      actorSheet: { sleightBonus: 0, dexMod: 0 },
      targetSheet: { perceptionPassive: 12 },
    });
    expect(res.outcome.success).toBe(false);
    expect(res.outcome.caught).toBe(false);
    expect(res.outcome.goldStolen).toBeUndefined();
    expect(res.events.some((e) => e.type === 'CHECK_RESOLVED')).toBe(true);
    const theft = res.events.find((e) => e.type === 'THEFT_RESOLVED') as any;
    expect(theft).toBeDefined();
    expect(theft.success).toBe(false);
    expect(theft.caught).toBe(false);
    const mark = res.nextState.monsters['mark-1'] ?? res.nextState.party['mark-1'];
    expect((mark!.activeEffects ?? []).some((e: any) => e.effectId === PLANTED_EVIDENCE_EFFECT_ID)).toBe(false);
  });

  it('a disastrous miss is caught (margin>=5 or nat 1) and alerts the mark', () => {
    const { res } = findSeedFor('pickpocket', (r) => !r.outcome.success && r.outcome.caught, {
      actorSheet: { sleightBonus: 0, dexMod: 0 },
      targetSheet: { perceptionPassive: 16 },
    });
    expect(res.outcome.success).toBe(false);
    expect(res.outcome.caught).toBe(true);
    expect(res.events.some((e) => e.type === 'CHECK_RESOLVED')).toBe(true);
    const theft = res.events.find((e) => e.type === 'THEFT_RESOLVED') as any;
    expect(theft.caught).toBe(true);
    expect(theft.headline).toMatch(/catch|caught/i);
    const mark = res.nextState.monsters['mark-1'] ?? res.nextState.party['mark-1'];
    expect(mark!.activeEffects?.some((e: any) => e.effectId === THEFT_ALERTED_EFFECT_ID)).toBe(true);
  });
});

describe('SRD-1206: Fast Hands bonus-action tie-in (combat)', () => {
  it('a Thief spends a bonus action; others must spend the action', () => {
    const thiefState = makeCombatTheftState({
      actorSheet: { sleightBonus: 7, tools: ['thieves_tools'], featureIds: [FAST_HANDS_FEATURE_ID] },
      targetSheet: { perceptionPassive: 8 },
    });
    const budgetBefore = thiefState.combat!.turnBudget!;
    const res = resolveTheftAttempt({
      state: thiefState,
      actorId: 'rogue-1',
      targetId: 'mark-1',
      kind: 'pickpocket',
      asBonusAction: true,
    });
    expect(res.outcome.asBonusAction).toBe(true);
    expect(res.nextState.combat!.turnBudget!.bonusAction).toBe(budgetBefore.bonusAction - 1);
    expect(res.nextState.combat!.turnBudget!.action).toBe(budgetBefore.action);

    const plainState = makeCombatTheftState({
      actorSheet: { sleightBonus: 7 },
      targetSheet: { perceptionPassive: 8 },
    });
    expect(() =>
      resolveTheftAttempt({
        state: plainState,
        actorId: 'rogue-1',
        targetId: 'mark-1',
        kind: 'pickpocket',
        asBonusAction: true,
      }),
    ).toThrow(/Fast Hands/);
  });

  it('action theft spends the action budget and emits ACTION_USED', () => {
    const state = makeCombatTheftState({
      actorSheet: { sleightBonus: 7 },
      targetSheet: { perceptionPassive: 8 },
    });
    const budgetBefore = state.combat!.turnBudget!;
    const res = resolveTheftAttempt({
      state,
      actorId: 'rogue-1',
      targetId: 'mark-1',
      kind: 'plant',
    });
    expect(res.nextState.combat!.turnBudget!.action).toBe(budgetBefore.action - 1);
    expect(res.events.some((e) => e.type === 'ACTION_USED')).toBe(true);
  });

  it('theft outside your turn is rejected', () => {
    const state = makeCombatTheftState();
    state.combat!.activeCombatantId = 'mark-1';
    expect(() =>
      resolveTheftAttempt({ state, actorId: 'rogue-1', targetId: 'mark-1', kind: 'pickpocket' }),
    ).toThrow(/not.*turn/);
  });
});

describe('SRD-1206: reducer + transport wiring (ATTEMPT_THEFT)', () => {
  it('reduceGame resolves ATTEMPT_THEFT in exploration', () => {
    const grid = createTacticalGrid(5, 5);
    const actor = makeCombatant('rogue-1', 0, 0, 'party', { sleightBonus: 9, tools: ['thieves_tools'] });
    const mark = makeCombatant('mark-1', 0, 1, 'monster', { perceptionPassive: 8 });
    let state = createInitialGameState({ grid, party: [actor], monsters: [mark], rngState: 3 });
    const res = reduceGame(state, {
      type: 'ATTEMPT_THEFT',
      actorId: 'rogue-1',
      targetId: 'mark-1',
      kind: 'plant',
    });
    expect(res.events.some((e) => e.type === 'THEFT_RESOLVED')).toBe(true);
    expect(res.events.some((e) => e.type === 'CHECK_RESOLVED')).toBe(true);
  });

  it('reduceGame resolves combat theft through the turn budget', () => {
    const grid = createTacticalGrid(5, 5);
    const actor = makeCombatant('rogue-1', 0, 0, 'party', {
      sleightBonus: 9,
      tools: ['thieves_tools'],
      featureIds: [FAST_HANDS_FEATURE_ID],
    });
    const mark = makeCombatant('mark-1', 0, 1, 'monster', { perceptionPassive: 8 });
    let state = createInitialGameState({ grid, party: [actor], monsters: [mark], rngState: 5 });
    const started = reduceGame(state, { type: 'START_COMBAT', encounterId: 'theft-enc' });
    state = started.nextState;
    // Force the rogue to act first regardless of initiative.
    state.combat!.activeCombatantId = 'rogue-1';
    state.combat!.activeCombatantIndex = state.combat!.initiativeOrder.findIndex((e) => e.entityId === 'rogue-1');
    const res = reduceGame(state, {
      type: 'ATTEMPT_THEFT',
      actorId: 'rogue-1',
      targetId: 'mark-1',
      kind: 'lift',
      liftWhat: 'pouch',
      asBonusAction: true,
    });
    const theft = res.events.find((e) => e.type === 'THEFT_RESOLVED') as any;
    expect(theft).toBeDefined();
    expect(theft.asBonusAction).toBe(true);
  });
});
