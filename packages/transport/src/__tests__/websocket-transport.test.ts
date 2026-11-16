import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type Combatant,
  type GameCommand,
  type PlayerSlotAssignment,
  createInitialGameState,
  createTacticalGrid,
} from '@srd5/engine';
import {
  ROOM_CODE_ALPHABET,
  type ClientMessage,
  type ServerMessage,
  formatRoomCode,
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
} from '../protocol.js';
import { projectPlayerView } from '../fog.js';
import {
  WebSocketTransport,
  WebSocketTransportError,
  type WebSocketFactory,
  type WebSocketLike,
} from '../websocket.js';

const ROOM_ID = 'ABC234';
const PLAYER_ID = 'player-1';

function makeHero(): Combatant {
  return {
    id: 'hero-1',
    name: 'Hero',
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

function makeState() {
  return createInitialGameState({
    id: 'test-game',
    grid: createTacticalGrid(6, 6),
    party: [makeHero()],
    slots: [{ playerId: PLAYER_ID, displayName: 'Host', controlledCharacterIds: ['hero-1'] }],
  });
}

function view() {
  return projectPlayerView(makeState(), PLAYER_ID);
}

type ReplyBuilder = (message: ClientMessage) => ServerMessage;

class FakeSocket implements WebSocketLike {
  public static instances: FakeSocket[] = [];
  public readyState = 0;
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onerror: ((event?: { message?: string }) => void) | null = null;
  public onclose: (() => void) | null = null;
  public readonly sent: ClientMessage[] = [];
  private readonly replies: ReplyBuilder[] = [];

  constructor(public readonly url: string) {
    FakeSocket.instances.push(this);
  }

  public queueReply(build: ReplyBuilder): this {
    this.replies.push(build);
    return this;
  }

  public open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  public receive(message: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  public send(raw: string): void {
    const message = JSON.parse(raw) as ClientMessage;
    this.sent.push(message);
    const reply = this.replies.shift();
    if (reply) queueMicrotask(() => this.receive(reply(message)));
  }

  public close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  public fail(): void {
    this.onerror?.({ message: 'socket failed' });
  }
}

function makeTransport(extra: Partial<ConstructorParameters<typeof WebSocketTransport>[0]> = {}) {
  const transport = new WebSocketTransport({
    serverUrl: 'ws://localhost:8787',
    playerId: PLAYER_ID,
    displayName: 'Host',
    ...extra,
  });
  return transport;
}

function createdMessage(requestId?: string): ServerMessage {
  return {
    type: 'ROOM_CREATED',
    requestId,
    roomId: ROOM_ID,
    playerId: PLAYER_ID,
    slotAssignments: [
      { playerId: PLAYER_ID, displayName: 'Host', controlledCharacterIds: ['hero-1'] },
    ],
    viewState: view(),
    events: [],
  };
}

function joinedMessage(requestId?: string): ServerMessage {
  return {
    type: 'ROOM_JOINED',
    requestId,
    roomId: ROOM_ID,
    playerId: PLAYER_ID,
    slotAssignments: [
      { playerId: PLAYER_ID, displayName: 'Guest', controlledCharacterIds: ['hero-1'] },
    ],
    viewState: view(),
    events: [],
  };
}

describe('SRD-702: shared room-code helpers', () => {
  it('normalizes, validates, and formats 6-character room codes', () => {
    expect(normalizeRoomCode(' ab-c234 ')).toBe('ABC234');
    expect(isValidRoomCode('abc234')).toBe(true);
    expect(isValidRoomCode('ABC12')).toBe(false);
    expect(isValidRoomCode('ABC001')).toBe(false); // 0/1 are ambiguous and excluded
    expect(formatRoomCode('abc234')).toBe('ABC-234');
  });

  it('generates codes from the ambiguity-free alphabet using an injected RNG', () => {
    const code = generateRoomCode(() => 0);
    expect(code).toBe(ROOM_CODE_ALPHABET[0]!.repeat(6));
    expect(isValidRoomCode(code)).toBe(true);
  });
});

describe('SRD-702: WebSocketTransport client adapter', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.restoreAllMocks();
  });

  const withFactory = () => {
    const factory: WebSocketFactory = (url) => new FakeSocket(url);
    return { factory, sockets: FakeSocket.instances };
  };

  it('connects through an injectable socket factory and disconnects cleanly', async () => {
    const { factory } = withFactory();
    const transport = makeTransport({ socketFactory: factory });
    expect(transport.isConnected()).toBe(false);

    const connecting = transport.connect();
    FakeSocket.instances[0]!.open();
    await connecting;

    expect(transport.isConnected()).toBe(true);
    expect(FakeSocket.instances[0]!.url).toBe('ws://localhost:8787');

    await transport.disconnect();
    expect(transport.isConnected()).toBe(false);
    expect(FakeSocket.instances[0]!.readyState).toBe(3);
  });

  it('appends an auth token to the connection URL', async () => {
    const { factory } = withFactory();
    const transport = makeTransport({ socketFactory: factory, authToken: 'secret key' });
    const connecting = transport.connect();
    FakeSocket.instances[0]!.open();
    await connecting;
    expect(FakeSocket.instances[0]!.url).toBe('ws://localhost:8787?token=secret%20key');
  });

  it('rejects connection errors', async () => {
    const { factory } = withFactory();
    const transport = makeTransport({ socketFactory: factory });
    const connecting = transport.connect();
    FakeSocket.instances[0]!.fail();
    await expect(connecting).rejects.toThrow('socket failed');
    expect(transport.isConnected()).toBe(false);
  });

  it('hosts a room and exposes the generated code, projection, and slot assignments', async () => {
    const { factory } = withFactory();
    const transport = makeTransport({ socketFactory: factory });
    const connecting = transport.connect();
    const socket = FakeSocket.instances[0]!;
    socket.queueReply((msg) => createdMessage(msg.requestId));
    socket.open();
    await connecting;

    const listener = vi.fn();
    transport.subscribe(listener);
    const session = await transport.createRoom(makeState());

    expect(session.roomId).toBe(ROOM_ID);
    expect(transport.getRoomCode()).toBe(ROOM_ID);
    expect(transport.getPlayerViewState().playerId).toBe(PLAYER_ID);
    expect(transport.getSlotAssignments()).toHaveLength(1);
    expect(transport.getControlledCharacterIds()).toEqual(['hero-1']);
    expect(listener).toHaveBeenCalledTimes(1);

    const sent = socket.sent[0]!;
    expect(sent.type).toBe('CREATE_ROOM');
    expect(sent).toMatchObject({
      host: { playerId: PLAYER_ID, displayName: 'Host' },
      initialState: { id: 'test-game' },
    });
  });

  it('joins a room by a normalized code with requested character ids', async () => {
    const { factory } = withFactory();
    const transport = makeTransport({ socketFactory: factory });
    const connecting = transport.connect();
    const socket = FakeSocket.instances[0]!;
    socket.queueReply((msg) => joinedMessage(msg.requestId));
    socket.open();
    await connecting;

    const session = await transport.joinRoom(' abc-234 ', ['hero-1']);

    expect(session.roomId).toBe(ROOM_ID);
    expect(transport.getControlledCharacterIds()).toEqual(['hero-1']);
    expect(socket.sent[0]).toMatchObject({
      type: 'JOIN_ROOM',
      roomId: ROOM_ID,
      player: { playerId: PLAYER_ID },
      requestedCharacterIds: ['hero-1'],
    });
  });

  it('rejects an invalid room code before sending anything', async () => {
    const { factory } = withFactory();
    const transport = makeTransport({ socketFactory: factory });
    const connecting = transport.connect();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    await connecting;

    await expect(transport.joinRoom('NOPE')).rejects.toBeInstanceOf(WebSocketTransportError);
    expect(socket.sent).toHaveLength(0);
  });

  it('dispatches commands and correlates the STATE_UPDATE by requestId', async () => {
    const { factory } = withFactory();
    const transport = makeTransport({ socketFactory: factory });
    const connecting = transport.connect();
    const socket = FakeSocket.instances[0]!;
    socket.queueReply((msg) => createdMessage(msg.requestId));
    socket.open();
    await connecting;
    await transport.createRoom(makeState());

    const listener = vi.fn();
    transport.subscribe(listener);

    socket.queueReply((msg) => ({
      type: 'STATE_UPDATE',
      requestId: msg.requestId,
      roomId: ROOM_ID,
      viewState: view(),
      slotAssignments: [
        { playerId: PLAYER_ID, displayName: 'Host', controlledCharacterIds: ['hero-1'] },
      ],
      events: [{ type: 'TURN_STARTED', entityId: 'hero-1', round: 1 }],
    }));

    const command: GameCommand = { type: 'END_TURN', actorId: 'hero-1' };
    const result = await transport.dispatch(command);

    expect(socket.sent[1]).toMatchObject({ type: 'DISPATCH_COMMAND', command });
    expect(result.events).toEqual([{ type: 'TURN_STARTED', entityId: 'hero-1', round: 1 }]);
    expect(listener).toHaveBeenCalledTimes(1);

    // A broadcast for another player does not resolve a request but still updates the view.
    socket.receive({
      type: 'STATE_UPDATE',
      roomId: ROOM_ID,
      viewState: view(),
      slotAssignments: [],
      events: [],
    });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(transport.getSlotAssignments()).toEqual([]);
  });

  it('assigns co-op/PvP slots from the host and reports the authoritative result', async () => {
    const { factory } = withFactory();
    const transport = makeTransport({ socketFactory: factory });
    const connecting = transport.connect();
    const socket = FakeSocket.instances[0]!;
    socket.queueReply((msg) => createdMessage(msg.requestId));
    socket.open();
    await connecting;
    await transport.createRoom(makeState());

    const assignments: PlayerSlotAssignment[] = [
      { playerId: 'p1', displayName: 'Player 1', controlledCharacterIds: ['hero-1'] },
      { playerId: 'p2', displayName: 'Player 2', controlledCharacterIds: [] },
    ];
    socket.queueReply((msg) => ({
      type: 'SLOTS_UPDATED',
      requestId: msg.requestId,
      roomId: ROOM_ID,
      slotAssignments: assignments,
      viewState: view(),
    }));

    expect(await transport.assignSlots(assignments)).toEqual(assignments);
    expect(socket.sent[1]).toMatchObject({ type: 'ASSIGN_SLOTS', assignments });
    expect(transport.getControlledCharacterIds('p2')).toEqual([]);
  });

  it('requests snapshots and leaves rooms', async () => {
    const { factory } = withFactory();
    const transport = makeTransport({ socketFactory: factory });
    const connecting = transport.connect();
    const socket = FakeSocket.instances[0]!;
    socket.queueReply((msg) => createdMessage(msg.requestId));
    socket.open();
    await connecting;
    await transport.createRoom(makeState());

    socket.queueReply((msg) => ({
      type: 'STATE_SNAPSHOT',
      requestId: msg.requestId,
      roomId: ROOM_ID,
      viewState: view(),
      slotAssignments: [],
    }));
    const snapshot = await transport.requestState();
    expect(snapshot.playerId).toBe(PLAYER_ID);
    expect(socket.sent[1]!.type).toBe('GET_STATE');

    socket.queueReply((msg) => ({ type: 'LEFT_ROOM', requestId: msg.requestId, roomId: ROOM_ID }));
    await transport.leaveRoom();
    expect(transport.getRoomCode()).toBeNull();
    expect(socket.sent[2]!.type).toBe('LEAVE_ROOM');
  });

  it('rejects correlated ERROR replies with the server error code', async () => {
    const { factory } = withFactory();
    const transport = makeTransport({ socketFactory: factory });
    const connecting = transport.connect();
    const socket = FakeSocket.instances[0]!;
    socket.queueReply((msg) => ({
      type: 'ERROR',
      requestId: msg.requestId,
      code: 'UNAUTHORIZED',
      message: 'You do not control that hero',
    }));
    socket.open();
    await connecting;

    const error = await transport.joinRoom(ROOM_ID).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WebSocketTransportError);
    expect((error as WebSocketTransportError).code).toBe('UNAUTHORIZED');
  });

  it('emits lobby lifecycle events for joins, leaves, closure, and uncorrelated errors', async () => {
    const { factory } = withFactory();
    const transport = makeTransport({ socketFactory: factory });
    const connecting = transport.connect();
    const socket = FakeSocket.instances[0]!;
    socket.queueReply((msg) => createdMessage(msg.requestId));
    socket.open();
    await connecting;
    await transport.createRoom(makeState());

    const events: string[] = [];
    transport.onRoomEvent((event) => events.push(event.type));

    socket.receive({
      type: 'PLAYER_JOINED',
      roomId: ROOM_ID,
      playerId: 'p2',
      displayName: 'Guest',
      slotAssignments: [],
    });
    socket.receive({ type: 'PLAYER_LEFT', roomId: ROOM_ID, playerId: 'p2', slotAssignments: [] });
    socket.receive({ type: 'ERROR', code: 'ROOM_FULL', message: 'Full' });
    socket.receive({ type: 'ROOM_CLOSED', roomId: ROOM_ID, reason: 'host left' });

    expect(events).toEqual(['PLAYER_JOINED', 'PLAYER_LEFT', 'ERROR', 'ROOM_CLOSED']);
    expect(transport.getRoomCode()).toBeNull();
  });

  it('rejects pending requests on disconnect and drops subscribers', async () => {
    const { factory } = withFactory();
    const transport = makeTransport({ socketFactory: factory });
    const connecting = transport.connect();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    await connecting;

    const listener = vi.fn();
    transport.subscribe(listener);
    const pending = transport.joinRoom(ROOM_ID);
    for (let i = 0; i < 10 && socket.sent.length === 0; i += 1) {
      await Promise.resolve();
    }
    expect(socket.sent).toHaveLength(1);
    await transport.disconnect();

    await expect(pending).rejects.toThrow('Transport disconnected');
    socket.receive({ type: 'ROOM_JOINED', roomId: ROOM_ID, playerId: PLAYER_ID, slotAssignments: [], viewState: view(), events: [] });
    expect(listener).not.toHaveBeenCalled();
  });
});
