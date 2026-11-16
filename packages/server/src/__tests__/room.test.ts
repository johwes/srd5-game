import { describe, expect, it } from 'vitest';
import { RoomServerError } from '../errors.js';
import { Room } from '../room.js';
import { makeTestState } from './fixtures.js';

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
