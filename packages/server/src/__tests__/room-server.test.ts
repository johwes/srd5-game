import { describe, expect, it } from 'vitest';
import { RoomServer } from '../room-server.js';
import { FakeSocket, makeTestState } from './fixtures.js';

function setup() {
  let counter = 0;
  const server = new RoomServer({ generateRoomId: () => `ROOM${++counter}` });
  const host = new FakeSocket();
  const coop = new FakeSocket();
  const detachHost = server.attachSocket(host);
  const detachCoop = server.attachSocket(coop);
  return { server, host, coop, detachHost, detachCoop };
}

function createRoom(host: FakeSocket, roomId = 'CRYPT'): void {
  host.push({
    type: 'CREATE_ROOM',
    requestId: 'create-1',
    roomId,
    initialState: makeTestState(),
    host: { playerId: 'p1', displayName: 'Host' },
  });
}

function joinRoom(coop: FakeSocket, roomId = 'CRYPT'): void {
  coop.push({
    type: 'JOIN_ROOM',
    requestId: 'join-1',
    roomId,
    player: { playerId: 'p2', displayName: 'Co-op' },
    requestedCharacterIds: ['hero-b'],
  });
}

describe('SRD-701: authoritative RoomServer', () => {
  it('creates rooms with deterministic codes and returns the host projection', () => {
    const { host } = setup();
    createRoom(host);

    const created = host.last('ROOM_CREATED');
    expect(created).toMatchObject({
      requestId: 'create-1',
      roomId: 'CRYPT',
      playerId: 'p1',
    });
    expect(created?.viewState.playerId).toBe('p1');
    expect(created?.slotAssignments[0]?.controlledCharacterIds).toEqual(['hero-a']);
    expect(JSON.stringify(created?.viewState)).not.toContain('rngState');
  });

  it('joins co-op players and allocates requested unclaimed characters', () => {
    const { host, coop } = setup();
    createRoom(host);
    joinRoom(coop);

    const joined = coop.last('ROOM_JOINED');
    expect(joined?.roomId).toBe('CRYPT');
    expect(joined?.playerId).toBe('p2');
    expect(joined?.slotAssignments.find((s) => s.playerId === 'p2')?.controlledCharacterIds).toEqual([
      'hero-b',
    ]);
    expect(host.last('PLAYER_JOINED')).toMatchObject({ playerId: 'p2', roomId: 'CRYPT' });
  });

  it('broadcasts a distinct Fog-of-War projection to every member after a command', () => {
    const { host, coop } = setup();
    createRoom(host);
    joinRoom(coop);
    host.clear();
    coop.clear();

    host.push({
      type: 'DISPATCH_COMMAND',
      requestId: 'cmd-1',
      command: { type: 'EXPLORE_MOVE', actorId: 'hero-a', path: [{ x: 1, y: 2 }] },
    });

    const hostUpdate = host.last('STATE_UPDATE');
    const coopUpdate = coop.last('STATE_UPDATE');
    expect(hostUpdate?.requestId).toBe('cmd-1');
    expect(coopUpdate?.requestId).toBeUndefined();
    expect(hostUpdate?.viewState.party['hero-a']?.position).toEqual({ x: 1, y: 2 });
    expect(hostUpdate?.events.some((e) => e.type === 'ENTITY_MOVED')).toBe(true);
    // Both players share party vision, but each projection is built independently.
    expect(coopUpdate?.viewState.playerId).toBe('p2');
    expect(hostUpdate?.viewState.playerId).toBe('p1');
  });

  it('rejects a command when the sender does not control the acting character', () => {
    const { host, coop } = setup();
    createRoom(host);
    joinRoom(coop);
    coop.clear();

    coop.push({
      type: 'DISPATCH_COMMAND',
      requestId: 'bad-1',
      command: { type: 'EXPLORE_MOVE', actorId: 'hero-a', path: [{ x: 1, y: 2 }] },
    });

    expect(coop.last('ERROR')).toMatchObject({ code: 'UNAUTHORIZED', requestId: 'bad-1' });
    expect(coop.ofType('STATE_UPDATE')).toHaveLength(0);
  });

  it('refuses commands from sockets that are not in a room', () => {
    const { coop } = setup();
    coop.push({
      type: 'DISPATCH_COMMAND',
      requestId: 'orphan',
      command: { type: 'EXPLORE_SEARCH', actorId: 'hero-a' },
    });
    expect(coop.last('ERROR')).toMatchObject({ code: 'NOT_IN_ROOM', requestId: 'orphan' });
  });

  it('rejects malformed JSON and unknown rooms', () => {
    const { host, coop } = setup();
    host.pushRaw('{ not json');
    expect(host.last('ERROR')?.code).toBe('BAD_REQUEST');

    coop.push({ type: 'JOIN_ROOM', roomId: 'NOPE', player: { playerId: 'p9' } });
    expect(coop.last('ERROR')?.code).toBe('ROOM_NOT_FOUND');
  });

  it('supports slot reassignment, snapshots, and leaving the room', () => {
    const { server, host, coop } = setup();
    createRoom(host);
    joinRoom(coop);

    host.clear();
    coop.clear();
    host.push({
      type: 'ASSIGN_SLOTS',
      requestId: 'slots-1',
      assignments: [
        { playerId: 'p1', displayName: 'Host', controlledCharacterIds: ['hero-b'] },
        { playerId: 'p2', displayName: 'Co-op', controlledCharacterIds: ['hero-a'] },
      ],
    });
    expect(host.last('SLOTS_UPDATED')?.requestId).toBe('slots-1');
    expect(coop.last('SLOTS_UPDATED')?.slotAssignments[0]?.controlledCharacterIds).toEqual(['hero-b']);

    host.push({ type: 'GET_STATE', requestId: 'snap-1' });
    expect(host.last('STATE_SNAPSHOT')?.requestId).toBe('snap-1');

    coop.clear();
    coop.push({ type: 'LEAVE_ROOM', requestId: 'leave-1' });
    expect(coop.last('LEFT_ROOM')).toMatchObject({ requestId: 'leave-1', roomId: 'CRYPT' });
    expect(host.last('PLAYER_LEFT')?.playerId).toBe('p2');
    expect(server.getRoom('CRYPT')?.getMemberIds()).toEqual(['p1']);
  });

  it('cleans up a room when its last member disconnects', () => {
    const { server, host } = setup();
    createRoom(host);
    expect(server.listRooms()).toEqual(['CRYPT']);

    host.close();
    expect(server.listRooms()).toEqual([]);
  });

  it('keeps rooms isolated from one another', () => {
    const { server, host, coop } = setup();
    createRoom(host, 'ALPHA');
    joinRoom(coop, 'BETA');

    expect(coop.last('ERROR')?.code).toBe('ROOM_NOT_FOUND');
    expect(server.listRooms()).toEqual(['ALPHA']);
  });
});
