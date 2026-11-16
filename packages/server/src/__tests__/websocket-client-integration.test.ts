import { describe, expect, it, vi } from 'vitest';
import {
  type Combatant,
  type GameState,
  type PlayerSlotAssignment,
  createInitialGameState,
  createTacticalGrid,
} from '@srd5/engine';
import {
  WebSocketTransport,
  type WebSocketFactory,
  type WebSocketLike,
} from '@srd5/transport';
import { RoomServer } from '../room-server.js';
import type { RoomSocket } from '../protocol.js';

/** Minimal in-memory pipe joining a `RoomSocket` to a browser-style WebSocket. */
class Pipe {
  public serverToClient: ((raw: string) => void) | null = null;
  public clientToServer: ((raw: string) => void) | null = null;
  public onServerClose: (() => void) | null = null;
}

function makeServerSocket(pipe: Pipe): RoomSocket {
  return {
    send: (raw) => pipe.serverToClient?.(raw),
    onMessage: (handler) => {
      pipe.clientToServer = handler;
      return () => {
        pipe.clientToServer = null;
      };
    },
    onClose: (handler) => {
      pipe.onServerClose = handler;
      return () => {
        pipe.onServerClose = null;
      };
    },
  };
}

class PipeSocket implements WebSocketLike {
  public readyState = 0;
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onerror: ((event?: { message?: string }) => void) | null = null;
  public onclose: (() => void) | null = null;

  constructor(private readonly pipe: Pipe) {}

  public open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  public send(raw: string): void {
    this.pipe.clientToServer?.(raw);
  }

  public close(): void {
    this.readyState = 3;
    this.pipe.onServerClose?.();
    this.onclose?.();
  }
}

function connectClient(server: RoomServer): Promise<{
  client: WebSocketTransport;
  socket: PipeSocket;
}> {
  const pipe = new Pipe();
  server.attachSocket(makeServerSocket(pipe));
  const socket = new PipeSocket(pipe);
  pipe.serverToClient = (raw) => socket.onmessage?.({ data: raw });
  const factory: WebSocketFactory = () => socket;
  const client = new WebSocketTransport({
    serverUrl: 'ws://memory',
    playerId: `player-${Math.floor(Math.random() * 1e6)}`,
    socketFactory: factory,
  });
  const connecting = client.connect();
  socket.open();
  return connecting.then(() => ({ client, socket }));
}

function makeHero(id: string): Combatant {
  return {
    id,
    name: `Hero ${id}`,
    side: 'party',
    size: 'medium',
    position: { x: 1, y: 1 },
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
  };
}

function initialState(): GameState {
  return createInitialGameState({
    id: 'integration-game',
    grid: createTacticalGrid(8, 8),
    party: [makeHero('hero-a'), makeHero('hero-b')],
  });
}

describe('SRD-702: WebSocketTransport <-> authoritative RoomServer integration', () => {
  it('hosts, joins, reassigns slots, and dispatches commands over the shared wire protocol', async () => {
    const server = new RoomServer();
    const { client: host } = await connectClient(server);
    const { client: guest } = await connectClient(server);

    const session = await host.createRoom(initialState(), { roomId: 'ABC234' });
    expect(session.roomId).toBe('ABC234');
    expect(host.getRoomCode()).toBe('ABC234');

    const guestSession = await guest.joinRoom('abc-234');
    expect(guestSession.roomId).toBe('ABC234');
    expect(guest.getSlotAssignments().map((slot) => slot.playerId).sort()).toEqual(
      [host.getPlayerId(), guest.getPlayerId()].sort(),
    );

    const assignments: PlayerSlotAssignment[] = [
      {
        playerId: host.getPlayerId(),
        displayName: 'Host',
        controlledCharacterIds: ['hero-a'],
      },
      {
        playerId: guest.getPlayerId(),
        displayName: 'Guest',
        controlledCharacterIds: ['hero-b'],
      },
    ];
    await host.assignSlots(assignments);
    expect(guest.getControlledCharacterIds()).toEqual(['hero-b']);

    const listener = vi.fn();
    guest.subscribe(listener);
    const command = { type: 'EXPLORE_MOVE' as const, actorId: 'hero-b', path: [] };
    await guest.dispatch(command);
    expect(listener).toHaveBeenCalled();
    expect(guest.getPlayerViewState().playerId).toBe(guest.getPlayerId());

    await guest.leaveRoom();
    await host.disconnect();
    await guest.disconnect();
  });

  it('surfaces server authorization errors to the offending client', async () => {
    const server = new RoomServer();
    const { client: host } = await connectClient(server);
    const { client: guest } = await connectClient(server);
    await host.createRoom(initialState(), { roomId: 'ABC234' });
    await guest.joinRoom('ABC234');

    await expect(
      guest.dispatch({ type: 'END_TURN', actorId: 'hero-a' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    await host.disconnect();
    await guest.disconnect();
  });
});
