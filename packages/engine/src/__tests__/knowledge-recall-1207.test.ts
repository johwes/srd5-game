import { describe, expect, it } from 'vitest';
import {
  applyIdentificationToCounterspellPrompt,
  classifyRecallTheme,
  generateFloorRecallTags,
  getRecallSkillBonus,
  getRecallTrapBonus,
  getSpellIdentifyDc,
  KnowledgeRecallSpecSchema,
  recallTrapBonusEffectId,
  resolveArcanaSpellIdentification,
  resolveRecallAttempt,
  type KnowledgeRecallSpec,
} from '../dungeon/recall.js';
import { createDungeonGameState } from '../dungeon/state.js';
import type { DungeonFloorSpec } from '../dungeon/schemas.js';
import type { Combatant } from '../combat/types.js';
import { createTacticalGrid } from '../grid/model.js';
import { createInitialGameState, reduceGame } from '../state/reducer.js';
import type { GameState } from '../state/types.js';

function makeSheet(skillBonuses: Record<string, number> = {}, intMod = 2) {
  const skills: Record<string, any> = {};
  for (const [skill, totalBonus] of Object.entries(skillBonuses)) {
    skills[skill] = {
      skill,
      ability: skill === 'perception' ? 'wis' : 'int',
      proficiencyLevel: 'proficient',
      abilityModifier: skill === 'perception' ? 2 : intMod,
      proficiencyBonus: 2,
      flatBonus: 0,
      totalBonus,
      passiveScore: 10 + totalBonus,
      rollMode: 'normal',
      breakdown: [],
    };
  }
  return {
    abilities: {
      str: { score: 10, modifier: 0 },
      dex: { score: 14, modifier: 2 },
      con: { score: 12, modifier: 1 },
      int: { score: 10 + intMod * 2, modifier: intMod },
      wis: { score: 14, modifier: 2 },
      cha: { score: 10, modifier: 0 },
    },
    proficiencyBonus: 2,
    proficiencies: { tools: [], expertise: [], skills: [], armor: [], weapons: [], savingThrows: [] },
    skills,
    featureIds: [],
  } as any;
}

function makeCombatant(id: string, x: number, y: number, sheet: any = makeSheet(), side: 'party' | 'monster' = 'party'): Combatant {
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
    characterSheet: sheet,
  } as unknown as Combatant;
}

function makeFloor(): DungeonFloorSpec {
  const cells: any[] = [];
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 6; x++) {
      cells.push({ x, y, roomId: x < 3 ? 'room-a' : 'room-b', terrain: 'floor_stone', baseLight: 'bright', elevationFeet: 0 });
    }
  }
  return {
    id: 'recall-test-floor',
    name: 'Recall Test Floor',
    width: 6,
    height: 6,
    rooms: [{ id: 'room-a', name: 'Room A' } as any, { id: 'room-b', name: 'Room B' } as any],
    cells,
    props: [],
    encounters: [],
    partySpawnCells: [{ x: 1, y: 1 }],
  } as unknown as DungeonFloorSpec;
}

function makeExplorationState(opts: { actorSheet?: any; rngState?: number; props?: any[] } = {}): GameState {
  const actor = makeCombatant('sage-1', 1, 1, opts.actorSheet ?? makeSheet({ history: 7, religion: 5, arcana: 6, nature: 4 }));
  const grid = createTacticalGrid(6, 6);
  const base = createInitialGameState({ grid, party: [actor], rngState: opts.rngState ?? 7 });
  const floor = makeFloor();
  const dungeon = createDungeonGameState({ floor, party: [actor], rngState: opts.rngState ?? 7 });
  return {
    ...dungeon,
    id: 'recall-game',
    party: { 'sage-1': { ...actor, roomId: 'room-a' } },
    props: (opts.props ?? []).map((p) => ({ ...p })),
    rngState: opts.rngState ?? 7,
  };
}

describe('SRD-1207 knowledge recall specs', () => {
  it('validates the four skills and four reward kinds', () => {
    const good: KnowledgeRecallSpec = { skill: 'history', dc: 13, reward: { kind: 'reveal_quest', questId: 'q1' } };
    expect(KnowledgeRecallSpecSchema.parse(good)).toEqual(good);
    for (const skill of ['history', 'religion', 'arcana', 'nature'] as const) {
      expect(() => KnowledgeRecallSpecSchema.parse({ skill, dc: 12, reward: { kind: 'lore_note', text: 'x' } })).not.toThrow();
    }
    expect(() => KnowledgeRecallSpecSchema.parse({ skill: 'persuasion', dc: 12, reward: { kind: 'lore_note', text: 'x' } })).toThrow();
    expect(() => KnowledgeRecallSpecSchema.parse({ skill: 'history', dc: 12, reward: { kind: 'nope' } })).toThrow();
  });

  it('reads recall bonuses from the sheet and falls back to INT', () => {
    const skilled = makeCombatant('a', 0, 0, makeSheet({ history: 9 }));
    expect(getRecallSkillBonus(skilled, 'history')).toBe(9);
    const unskilled = makeCombatant('b', 0, 0, makeSheet({}, 3));
    expect(getRecallSkillBonus(unskilled, 'arcana')).toBe(3);
  });
});

describe('SRD-1207 history recall', () => {
  it('successful reveal_quest unlocks the quest id; failure is fail-forward', () => {
    const okState = makeExplorationState({ actorSheet: makeSheet({ history: 20 }), rngState: 11 });
    const ok = resolveRecallAttempt({
      state: okState,
      actorId: 'sage-1',
      spec: { skill: 'history', dc: 5, reward: { kind: 'reveal_quest', questId: 'forgotten-cache' } },
    });
    expect(ok.outcome.success).toBe(true);
    expect(ok.outcome.questId).toBe('forgotten-cache');
    expect(ok.events.some((e) => e.type === 'CHECK_RESOLVED' && (e as any).checkType === 'history')).toBe(true);
    const recalled = ok.events.find((e) => e.type === 'RECALL_RESOLVED') as any;
    expect(recalled.questId).toBe('forgotten-cache');

    const failState = makeExplorationState({ actorSheet: makeSheet({ history: -2 }, -2), rngState: 11 });
    const fail = resolveRecallAttempt({
      state: failState,
      actorId: 'sage-1',
      spec: { skill: 'history', dc: 30, reward: { kind: 'reveal_quest', questId: 'forgotten-cache' } },
    });
    expect(fail.outcome.success).toBe(false);
    expect(fail.outcome.questId).toBeUndefined();
    // Fail-forward: no throw, no unlock, but the check is still logged.
    expect(fail.events.some((e) => e.type === 'CHECK_RESOLVED')).toBe(true);
  });

  it('successful trap_bonus attaches a scoped marker that boosts searches', () => {
    const state = makeExplorationState({ actorSheet: makeSheet({ history: 20 }), rngState: 11 });
    const res = resolveRecallAttempt({
      state,
      actorId: 'sage-1',
      spec: { skill: 'history', dc: 5, reward: { kind: 'trap_bonus', bonus: 2, scope: 'room-a' } },
      roomId: 'room-a',
    });
    expect(res.outcome.success).toBe(true);
    expect(res.outcome.trapBonus).toBe(2);
    const actor = res.nextState.party['sage-1']!;
    expect(actor.activeEffects?.some((e) => e.effectId === recallTrapBonusEffectId('room-a'))).toBe(true);
    expect(getRecallTrapBonus(actor, 'room-a')).toBe(2);
    // Wrong-room scope does not leak.
    expect(getRecallTrapBonus(actor, 'room-b')).toBe(0);
    expect(getRecallTrapBonus(actor, undefined)).toBe(0);
  });
});

describe('SRD-1207 religion ward_info', () => {
  it('reveals warded traps/shrines in scope; failure leaves them hidden', () => {
    const props = [
      { id: 'trap-1', x: 1, y: 2, kind: 'trap', state: 'closed', blocksMovement: false, blocksSight: false, detectionDc: 25, disarmDc: 15, trapDamageFormula: '2d6', discovered: false },
      { id: 'shrine-1', x: 4, y: 4, kind: 'shrine', state: 'closed', blocksMovement: false, blocksSight: false, shrineType: 'shrine_blood_god', discovered: false },
    ];
    const okState = makeExplorationState({ actorSheet: makeSheet({ religion: 20 }), rngState: 11, props });
    const ok = resolveRecallAttempt({
      state: okState,
      actorId: 'sage-1',
      spec: { skill: 'religion', dc: 5, reward: { kind: 'ward_info', target: 'room-a' } },
      roomId: 'room-a',
    });
    expect(ok.outcome.success).toBe(true);
    // Trap at (1,2) sits in room-a (x<3); shrine at (4,4) is room-b and stays hidden.
    expect(ok.outcome.revealedPropIds).toContain('trap-1');
    expect(ok.outcome.revealedPropIds).not.toContain('shrine-1');
    expect(ok.nextState.props.find((p) => p.id === 'trap-1')!.discovered).toBe(true);
    expect(ok.events.some((e) => e.type === 'SECRET_DISCOVERED' && (e as any).propId === 'trap-1')).toBe(true);

    const failState = makeExplorationState({ actorSheet: makeSheet({ religion: -2 }, -2), rngState: 11, props });
    const fail = resolveRecallAttempt({
      state: failState,
      actorId: 'sage-1',
      spec: { skill: 'religion', dc: 30, reward: { kind: 'ward_info', target: 'room-a' } },
      roomId: 'room-a',
    });
    expect(fail.outcome.success).toBe(false);
    expect(fail.nextState.props.find((p) => p.id === 'trap-1')!.discovered).toBe(false);
  });
});

describe('SRD-1207 arcana counterspell identification', () => {
  it('pass reveals name/level; fail redacts but keeps blind counterspell available', () => {
    expect(getSpellIdentifyDc(3)).toBe(13);
    const sharp = makeCombatant('wiz', 0, 0, makeSheet({ arcana: 20 }));
    const sharpRes = resolveArcanaSpellIdentification({ observer: sharp, spellId: 'fireball', spellName: 'Fireball', spellLevel: 3, rngState: 11 });
    expect(sharpRes.identification.identified).toBe(true);
    expect(sharpRes.identification.displayName).toBe('Fireball');
    expect(sharpRes.identification.displayLevel).toBe(3);

    const dull = makeCombatant('wiz2', 0, 0, makeSheet({ arcana: -2 }, -2));
    const dullRes = resolveArcanaSpellIdentification({ observer: dull, spellId: 'fireball', spellName: 'Fireball', spellLevel: 9, rngState: 11, dcOverride: 30 });
    expect(dullRes.identification.identified).toBe(false);
    expect(dullRes.identification.displayName).toBe('an unknown spell');
    expect(dullRes.identification.displayLevel).toBeUndefined();

    const prompt = {
      promptId: 'counter-1',
      reactorEntityId: 'wiz2',
      triggerType: 'spell_cast',
      triggerDescription: 'Goblin is casting Fireball (Level 3). Cast Counterspell?',
      availableReactions: [{ id: 'counterspell_slot_3', label: 'Cast Counterspell (Slot Level 3)', reactionType: 'counterspell', slotLevel: 3, description: 'Automatically interrupts Fireball!' }],
    } as any;
    const redacted = applyIdentificationToCounterspellPrompt(prompt, dullRes.identification);
    expect(redacted.triggerDescription).not.toContain('Fireball');
    // Blind counterspell stays offered — identification never removes the verb.
    expect(redacted.availableReactions).toHaveLength(1);
    expect(redacted.availableReactions[0]!.id).toBe('counterspell_slot_3');
    // Identified prompts pass through untouched.
    expect(applyIdentificationToCounterspellPrompt(prompt, sharpRes.identification)).toBe(prompt);
  });
});

describe('SRD-1207 nature lore notes', () => {
  it('surfaces lore text on success and nothing on failure', () => {
    const okState = makeExplorationState({ actorSheet: makeSheet({ nature: 20 }), rngState: 11 });
    const ok = resolveRecallAttempt({
      state: okState,
      actorId: 'sage-1',
      spec: { skill: 'nature', dc: 5, reward: { kind: 'lore_note', text: 'Owlbear spoor — safe to eat, unsafe to approach.' } },
    });
    expect(ok.outcome.loreNote).toContain('Owlbear');
    const failState = makeExplorationState({ actorSheet: makeSheet({ nature: -2 }, -2), rngState: 11 });
    const fail = resolveRecallAttempt({
      state: failState,
      actorId: 'sage-1',
      spec: { skill: 'nature', dc: 30, reward: { kind: 'lore_note', text: 'Owlbear spoor.' } },
    });
    expect(fail.outcome.loreNote).toBeUndefined();
  });
});

describe('SRD-1207 generator recall tags', () => {
  it('is deterministic per seed and themes undead floors with religion tags', () => {
    const rooms = [{ id: 'room-a' }, { id: 'room-b' }, { id: 'room-c' }];
    const undead = ['skeleton', 'zombie', 'ghoul'];
    const first = generateFloorRecallTags({ floorId: 'f1', seed: 42, rooms, monsterIds: undead, depth: 2 });
    const second = generateFloorRecallTags({ floorId: 'f1', seed: 42, rooms, monsterIds: undead, depth: 2 });
    expect(second).toEqual(first);
    const skills = Object.values(first).flat().map((t) => t.skill);
    expect(skills).toContain('religion');
    // Wizard lairs emit arcana/history tags.
    const lair = generateFloorRecallTags({ floorId: 'f1', seed: 42, rooms, monsterIds: ['mage', 'cult-fanatic'], depth: 4 });
    expect(Object.values(lair).flat().some((t) => t.skill === 'arcana' || t.skill === 'history')).toBe(true);
  });

  it('classifies themes from rosters', () => {
    expect(classifyRecallTheme(['skeleton', 'zombie'])).toBe('undead_crypt');
    expect(classifyRecallTheme(['mage', 'apprentice'])).toBe('wizard_lair');
    expect(classifyRecallTheme(['giant-wolf-spider', 'giant-rat'])).toBe('wilds');
  });
});

describe('SRD-1207 reducer wiring', () => {
  it('ATTEMPT_RECALL emits CHECK_RESOLVED + RECALL_RESOLVED and advances rng', () => {
    const state = makeExplorationState({ actorSheet: makeSheet({ history: 20 }), rngState: 99 });
    const before = state.rngState;
    const res = reduceGame(state, {
      type: 'ATTEMPT_RECALL',
      actorId: 'sage-1',
      skill: 'history',
      dc: 5,
      reward: { kind: 'lore_note', text: 'Old kings drilled pit traps here.' },
      roomId: 'room-a',
    });
    expect(res.events.some((e) => e.type === 'CHECK_RESOLVED')).toBe(true);
    expect(res.events.some((e) => e.type === 'RECALL_RESOLVED')).toBe(true);
    expect(res.nextState.rngState).not.toBe(before);
  });
});
