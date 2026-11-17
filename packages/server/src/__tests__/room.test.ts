import { describe, expect, it } from 'vitest';
import {
  type Combatant,
  type CombatState,
  type GameState,
  createInitialGameState,
  createTacticalGrid,
  createTurnBudget,
  startCombatEncounter,
} from '@srd5/engine';
import { RoomServerError } from '../errors.js';
import { Room } from '../room.js';
import { makeHero, makeMonster, makeSplitState, makeTestState } from './fixtures.js';

function makeRoom(): Room {
  const room = new Room({
    roomId: 'ROOM01',
    initialState: makeTestState(),
    // Short sight range keeps the far-away goblin behind the fog for projection tests.
    projectionOptions: { sharedVision: true, maxVisionRangeFeet: 20 },
  });
  room.addMember({ playerId: 'player-1' }, null);
  room.addMember({ playerId: 'player-2' }, null);
  return room;
}

/** Authoritative combat state where player p1's hero controls a summoned Hand. */
function makeSummonCombatState(): GameState {
  const caster = makeHero('hero-a', 'Valeros', 1, 1);
  const summon: Combatant = {
    ...makeHero('hand', 'Arcane Hand', 2, 1),
    isSummon: true,
    summonId: 'arcane-hand-token',
    summonedByEntityId: caster.id,
    summonControl: 'commanded',
    summonSourceName: 'Arcane Hand',
    summonActions: [
      {
        id: 'clenched-fist',
        name: 'Clenched Fist',
        description: 'A force strike',
        actionCost: 'action',
        effects: [{ step: 'grant_temp_hp', amountFormula: '1' }],
      },
    ],
  } as Combatant;
  const enemy = makeMonster('goblin-1', 'Goblin', 9, 9);
  const started = startCombatEncounter({
    encounterId: 'summon-room',
    combatants: [caster, summon, enemy],
    rngState: 424242,
  });
  const combat: CombatState = {
    ...started.state,
    activeCombatantId: summon.id,
    activeCombatantIndex: started.state.initiativeOrder.findIndex(
      (e) => e.entityId === summon.id,
    ),
    turnBudget: createTurnBudget(summon, false),
  };
  const base = createInitialGameState({
    id: 'summon-room-game',
    grid: createTacticalGrid(12, 12),
    party: [caster],
    monsters: [enemy],
    slots: [
      { playerId: 'p1', displayName: 'P1', controlledCharacterIds: [caster.id] },
      { playerId: 'p2', displayName: 'P2', controlledCharacterIds: [] },
    ],
    rngState: 424242,
  });
  return { ...base, mode: 'combat', combat, rngState: combat.rngState };
}

function makeSummonRoom(): Room {
  const room = new Room({
    roomId: 'SUMMON01',
    initialState: makeSummonCombatState(),
  });
  room.addMember({ playerId: 'p1' }, null);
  room.addMember({ playerId: 'p2' }, null);
  return room;
}

describe('SRD-701: authoritative Room', () => {
  it('keeps authoritative state isolated from the caller and strips RNG from views', () => {
    const source = makeTestState();
    const room = new Room({ roomId: 'ROOM01', initialState: source });

    const authoritative = room.getAuthoritativeState();
    expect(authoritative.rngState).toBe(424242);
    authoritative.party['hero-a']!.position = { x: 99, y: 99 };
    expect(room.getAuthoritativeState().party['hero-a']!.position).toEqual({ x: 1, y: 1 });

    const view = room.getView('player-1');
    expect(view.playerId).toBe('player-1');
    expect(JSON.stringify(view)).not.toContain('rngState');
  });

  it('projects fog-of-war so remote monsters are hidden from players', () => {
    const room = makeRoom();
    const view = room.getView('player-1');

    expect(view.combatants['hero-a']).toBeDefined();
    expect(view.combatants['goblin-1']).toBeUndefined();
  });

  it('rebinding the host identity transfers the initial slot ownership', () => {
    const room = makeRoom();
    room.assignHostIdentity({ playerId: 'host-xyz', displayName: 'Dungeon Master' });

    expect(room.getHostPlayerId()).toBe('host-xyz');
    expect(room.getSlotAssignments()[0]).toMatchObject({
      playerId: 'host-xyz',
      displayName: 'Dungeon Master',
      controlledCharacterIds: ['hero-a'],
    });
  });

  it('runs commands through the authoritative reducer and enforces character ownership', () => {
    const room = makeRoom();

    const events = room.dispatch('player-1', {
      type: 'EXPLORE_MOVE',
      actorId: 'hero-a',
      path: [{ x: 1, y: 2 }],
    });
    expect(events.some((e) => e.type === 'ENTITY_MOVED')).toBe(true);
    expect(room.getView('player-1').party['hero-a']?.position).toEqual({ x: 1, y: 2 });

    expect(() =>
      room.dispatch('player-1', {
        type: 'EXPLORE_MOVE',
        actorId: 'hero-b',
        path: [{ x: 2, y: 2 }],
      }),
    ).toThrowError(RoomServerError);

    try {
      room.dispatch('player-1', {
        type: 'EXPLORE_MOVE',
        actorId: 'hero-b',
        path: [{ x: 2, y: 2 }],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(RoomServerError);
      expect((error as RoomServerError).code).toBe('UNAUTHORIZED');
    }
  });

  it('rejects commands from players who are not members', () => {
    const room = makeRoom();
    expect(() =>
      room.dispatch('stranger', { type: 'EXPLORE_SEARCH', actorId: 'hero-a' }),
    ).toThrowError(RoomServerError);
  });

  it('grants unclaimed characters to joining co-op players', () => {
    const room = makeRoom();
    room.addMember({ playerId: 'player-3' }, null, ['hero-a']);

    // hero-a is already claimed, so nothing new is granted.
    expect(room.getSlotAssignments().find((s) => s.playerId === 'player-3')?.controlledCharacterIds).toEqual([]);

    const room2 = new Room({
      roomId: 'ROOM02',
      initialState: {
        ...makeTestState(),
        slots: [{ playerId: 'host', displayName: 'Host', controlledCharacterIds: ['hero-a'] }],
      },
    });
    room2.addMember({ playerId: 'host' }, null);
    room2.addMember({ playerId: 'coop' }, null, ['hero-b']);

    expect(room2.getSlotAssignments().find((s) => s.playerId === 'host')?.controlledCharacterIds).toEqual([
      'hero-a',
    ]);
    expect(room2.getSlotAssignments().find((s) => s.playerId === 'coop')?.controlledCharacterIds).toEqual([
      'hero-b',
    ]);
  });

  it('tracks Fog-of-War exploration memory independently for each player (SRD-703)', () => {
    const room = new Room({
      roomId: 'ROOM-FOG',
      initialState: makeSplitState(),
      projectionOptions: { sharedVision: false, maxVisionRangeFeet: 15 },
    });
    room.addMember({ playerId: 'p1' }, null);
    room.addMember({ playerId: 'p2' }, null);

    const cell = (playerId: string, x: number, y: number) =>
      room
        .getView(playerId)
        .grid.cells.find((c) => c.x === x && c.y === y)?.visibility;

    expect(cell('p1', 1, 1)).toBe('visible');
    expect(cell('p2', 1, 1)).toBe('unexplored');

    room.dispatch('p1', {
      type: 'EXPLORE_MOVE',
      actorId: 'hero-a',
      path: [{ x: 1, y: 2 }, { x: 1, y: 3 }, { x: 1, y: 4 }, { x: 1, y: 5 }],
    });

    // p1 remembers the corridor it walked; p2 never saw it.
    expect(cell('p1', 1, 1)).toBe('remembered');
    expect(cell('p2', 1, 1)).toBe('unexplored');
    expect(cell('p2', 10, 10)).toBe('visible');
  });

  it('authorizes summon commands through the caster ownership chain (SRD-903)', () => {
    const room = makeSummonRoom();

    const events = room.dispatch('p1', {
      type: 'USE_SUMMON_ACTION',
      actorId: 'hand',
      actionId: 'clenched-fist',
    });
    expect(events.some((e) => e.type === 'ACTION_USED')).toBe(true);

    const other = makeSummonRoom();
    expect(() =>
      other.dispatch('p2', {
        type: 'USE_SUMMON_ACTION',
        actorId: 'hand',
        actionId: 'clenched-fist',
      }),
    ).toThrowError(RoomServerError);
    try {
      other.dispatch('p2', {
        type: 'USE_SUMMON_ACTION',
        actorId: 'hand',
        actionId: 'clenched-fist',
      });
    } catch (error) {
      expect((error as RoomServerError).code).toBe('UNAUTHORIZED');
    }
  });

  it('still lets the caster dismiss its own summon (SRD-903 regression)', () => {
    const room = makeSummonRoom();
    const events = room.dispatch('p1', {
      type: 'DISMISS_SUMMON',
      actorId: 'hero-a',
      summonId: 'arcane-hand-token',
    });
    expect(events.some((e) => e.type === 'SUMMON_EXPIRED')).toBe(true);
  });

  it('projects summon metadata and routes summon reactions to their owner (SRD-903)', () => {
    const room = makeSummonRoom();

    const ownerView = room.getView('p1');
    expect(ownerView.combatants['hand']).toMatchObject({
      isSummon: true,
      summonedByEntityId: 'hero-a',
    });
    expect(ownerView.combat?.turnBudget).not.toBeNull();
    expect(room.getView('p2').combat?.turnBudget).toBeNull();

    expect(
      room.getReactionOwnerPlayerId({
        promptId: 'reaction-hand',
        reactorEntityId: 'hand',
        triggerType: 'attack_roll_hit',
        triggerDescription: 'Enemy hits the Hand',
        availableReactions: [],
        timeoutMs: 30000,
      }),
    ).toBe('p1');
  });

  it('validates explicit slot assignments and rejects double-booked characters', () => {
    const room = makeRoom();

    const valid = room.assignSlots([
      { playerId: 'player-1', displayName: 'P1', controlledCharacterIds: ['hero-a'] },
      { playerId: 'player-2', displayName: 'P2', controlledCharacterIds: ['hero-b'] },
    ]);
    expect(valid).toHaveLength(2);

    expect(() =>
      room.assignSlots([
        { playerId: 'player-1', displayName: 'P1', controlledCharacterIds: ['hero-a'] },
        { playerId: 'player-2', displayName: 'P2', controlledCharacterIds: ['hero-a'] },
      ]),
    ).toThrowError(/more than one player/);

    expect(() =>
      room.assignSlots([
        { playerId: 'player-1', displayName: 'P1', controlledCharacterIds: ['ghost'] },
        { playerId: 'player-2', displayName: 'P2', controlledCharacterIds: [] },
      ]),
    ).toThrowError(/Unknown character/);

    expect(() =>
      room.assignSlots([
        { playerId: 'player-1', displayName: 'P1', controlledCharacterIds: [] },
      ]),
    ).toThrowError(/missing player/);
  });
});
