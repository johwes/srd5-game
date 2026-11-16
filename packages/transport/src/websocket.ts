import {
  type GameCommand,
  type GameEvent,
  type GameState,
  type PlayerSlotAssignment,
} from '@srd5/engine';
import {
  type GameTransport,
  type PlayerViewState,
  type StateUpdateListener,
} from './types.js';
import {
  ROOM_ERROR_CODES,
  type ClientMessage,
  type RoomErrorCode,
  type ServerMessage,
  isValidRoomCode,
  normalizeRoomCode,
} from './protocol.js';

/** Distributive `Omit` so every union variant keeps its own fields. */
type WithoutRequestId<T> = T extends unknown ? Omit<T, 'requestId'> : never;

/* -------------------------------------------------------------------------- */
/* Browser socket abstraction                                                   */
/* -------------------------------------------------------------------------- */

/** Minimal browser `WebSocket` surface used by the client transport. */
export interface WebSocketLike {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event?: { message?: string }) => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** Injectable socket constructor (native `WebSocket` in the browser, fakes in tests). */
export type WebSocketFactory = (url: string) => WebSocketLike;

export interface WebSocketTransportOptions {
  serverUrl: string;
  /** Default room code used by `joinRoom()` when none is supplied. */
  roomId?: string;
  playerId: string;
  displayName?: string;
  /** Optional bearer token appended to the connection URL as `?token=`. */
  authToken?: string;
  /** Inject a socket implementation; defaults to `globalThis.WebSocket`. */
  socketFactory?: WebSocketFactory;
  connectionTimeoutMs?: number;
  requestTimeoutMs?: number;
}

export interface CreateRoomOptions {
  /** Server-generated when omitted (recommended — guarantees a valid room code). */
  roomId?: string;
  displayName?: string;
  maxPlayers?: number;
}

export interface RoomSessionInfo {
  roomId: string;
  playerId: string;
  viewState: PlayerViewState;
  slotAssignments: PlayerSlotAssignment[];
  events: GameEvent[];
}

/** Lobby lifecycle events broadcast outside the state-update stream. */
export type RoomEvent =
  | { type: 'PLAYER_JOINED'; roomId: string; playerId: string; displayName: string }
  | { type: 'PLAYER_LEFT'; roomId: string; playerId: string }
  | { type: 'ROOM_CLOSED'; roomId: string; reason: string }
  | { type: 'CONNECTION_LOST' }
  | { type: 'ERROR'; code: RoomErrorCode; message: string };

export type RoomEventListener = (event: RoomEvent) => void;

/** Error raised for transport/protocol failures, carrying the server error code. */
export class WebSocketTransportError extends Error {
  public readonly code: RoomErrorCode;

  constructor(code: RoomErrorCode, message: string) {
    super(message);
    this.name = 'WebSocketTransportError';
    this.code = code;
  }
}

interface PendingRequest {
  resolve: (message: ServerMessage) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function defaultSocketFactory(): WebSocketFactory {
  const ctor = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  if (!ctor) {
    throw new WebSocketTransportError(
      'INTERNAL_ERROR',
      'No WebSocket implementation is available; supply a socketFactory',
    );
  }
  return (url) => new ctor(url);
}

function buildSocketUrl(base: string, token?: string): string {
  if (!token) return base;
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}token=${encodeURIComponent(token)}`;
}

function isRoomErrorCode(code: unknown): code is RoomErrorCode {
  return typeof code === 'string' && (ROOM_ERROR_CODES as readonly string[]).includes(code);
}

/**
 * Multiplayer WebSocket Transport (Spec 05 Section 2 / SRD-702).
 *
 * Speaks the authoritative room-server wire protocol and implements the same
 * `GameTransport` contract as `LocalTransport`, so gameplay UI code never
 * mutates state directly. Adds room-code lifecycle helpers and explicit
 * player-to-character slot assignment for co-op and PvP lobbies.
 */
export class WebSocketTransport implements GameTransport {
  private readonly options: WebSocketTransportOptions;
  private socket: WebSocketLike | null = null;
  private connected = false;
  private roomId: string | null = null;
  private playerId: string;
  private currentViewState: PlayerViewState | null = null;
  private slotAssignments: PlayerSlotAssignment[] = [];
  private readonly listeners = new Set<StateUpdateListener>();
  private readonly roomListeners = new Set<RoomEventListener>();
  private readonly pending = new Map<string, PendingRequest>();
  private requestSequence = 0;

  constructor(options: WebSocketTransportOptions) {
    this.options = options;
    this.playerId = options.playerId;
    this.roomId = options.roomId ? normalizeRoomCode(options.roomId) : null;
  }

  /* --------------------------- connection lifecycle ----------------------- */

  public async connect(): Promise<void> {
    if (this.connected && this.socket) return;

    const factory = this.options.socketFactory ?? defaultSocketFactory();
    const socket = factory(buildSocketUrl(this.options.serverUrl, this.options.authToken));
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(
          new WebSocketTransportError(
            'INTERNAL_ERROR',
            `WebSocket connection timed out after ${this.options.connectionTimeoutMs ?? 10000}ms`,
          ),
        );
      }, this.options.connectionTimeoutMs ?? 10000);

      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };

      socket.onopen = () => {
        this.connected = true;
        finish();
      };
      socket.onmessage = (event) => this.handleRawMessage(event.data);
      socket.onerror = (event) =>
        finish(
          new WebSocketTransportError(
            'INTERNAL_ERROR',
            event?.message ?? 'WebSocket connection error',
          ),
        );
      socket.onclose = () => {
        if (!settled) {
          finish(new WebSocketTransportError('INTERNAL_ERROR', 'WebSocket closed before opening'));
        } else {
          this.handleClose();
        }
      };
    });
  }

  public async disconnect(): Promise<void> {
    // Best-effort server-side cleanup; the room also drops us on socket close.
    if (this.socket && this.roomId) {
      try {
        this.socket.send(JSON.stringify({ type: 'LEAVE_ROOM' }));
      } catch {
        // Ignore a socket that has already gone away.
      }
    }

    this.rejectAllPending(new WebSocketTransportError('BAD_REQUEST', 'Transport disconnected'));

    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    this.roomId = null;
    this.currentViewState = null;
    this.slotAssignments = [];
    this.listeners.clear();
    this.roomListeners.clear();

    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        // Ignore close failures on already-dead sockets.
      }
    }
  }

  public isConnected(): boolean {
    return this.connected;
  }

  /* --------------------------- room lifecycle ---------------------------- */

  /** Hosts a new authoritative room and returns its shareable room code. */
  public async createRoom(
    initialState: GameState,
    options: CreateRoomOptions = {},
  ): Promise<RoomSessionInfo> {
    await this.ensureConnected();
    const roomId = options.roomId ? this.requireValidCode(options.roomId) : undefined;
    const response = await this.request({
      type: 'CREATE_ROOM',
      initialState,
      roomId,
      host: {
        playerId: this.playerId,
        displayName: options.displayName ?? this.options.displayName,
      },
      maxPlayers: options.maxPlayers,
    });
    const created = this.expect(response, 'ROOM_CREATED');
    this.roomId = created.roomId;
    this.playerId = created.playerId;
    this.applyServerState(response);
    return {
      roomId: created.roomId,
      playerId: created.playerId,
      viewState: created.viewState,
      slotAssignments: created.slotAssignments,
      events: created.events,
    };
  }

  /** Joins a room by its (case/separator-insensitive) 6-character code. */
  public async joinRoom(
    roomCode?: string,
    requestedCharacterIds: string[] = [],
  ): Promise<RoomSessionInfo> {
    await this.ensureConnected();
    const code = this.requireValidCode(roomCode ?? this.options.roomId ?? '');
    const response = await this.request({
      type: 'JOIN_ROOM',
      roomId: code,
      player: { playerId: this.playerId, displayName: this.options.displayName },
      requestedCharacterIds: requestedCharacterIds.length ? requestedCharacterIds : undefined,
    });
    const joined = this.expect(response, 'ROOM_JOINED');
    this.roomId = joined.roomId;
    this.playerId = joined.playerId;
    this.applyServerState(response);
    return {
      roomId: joined.roomId,
      playerId: joined.playerId,
      viewState: joined.viewState,
      slotAssignments: joined.slotAssignments,
      events: joined.events,
    };
  }

  /** Host-only: explicitly reassigns characters to player seats (co-op or PvP). */
  public async assignSlots(assignments: PlayerSlotAssignment[]): Promise<PlayerSlotAssignment[]> {
    await this.ensureConnected();
    const response = await this.request({ type: 'ASSIGN_SLOTS', assignments });
    const updated = this.expect(response, 'SLOTS_UPDATED');
    this.applyServerState(response);
    return updated.slotAssignments;
  }

  /** Requests a fresh Fog-of-War projection without mutating state. */
  public async requestState(): Promise<PlayerViewState> {
    await this.ensureConnected();
    const response = await this.request({ type: 'GET_STATE' });
    const snapshot = this.expect(response, 'STATE_SNAPSHOT');
    this.applyServerState(response);
    return snapshot.viewState;
  }

  /** Leaves the current room; subsequent calls require joining/creating again. */
  public async leaveRoom(): Promise<void> {
    await this.ensureConnected();
    const response = await this.request({ type: 'LEAVE_ROOM' });
    this.expect(response, 'LEFT_ROOM');
    this.roomId = null;
    this.slotAssignments = [];
  }

  /* --------------------------- GameTransport ----------------------------- */

  public async dispatch(command: GameCommand): Promise<{
    viewState: PlayerViewState;
    events: GameEvent[];
  }> {
    await this.ensureConnected();
    const response = await this.request({ type: 'DISPATCH_COMMAND', command });
    const update = this.expect(response, 'STATE_UPDATE');
    this.applyServerState(response);
    return { viewState: update.viewState, events: update.events };
  }

  public subscribe(listener: StateUpdateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getPlayerViewState(_playerId?: string): PlayerViewState {
    if (!this.currentViewState) {
      throw new Error('No view state received from server yet');
    }
    return this.currentViewState;
  }

  public getSlotAssignments(): PlayerSlotAssignment[] {
    return structuredClone(this.slotAssignments);
  }

  /* --------------------------- lobby helpers ----------------------------- */

  public getRoomCode(): string | null {
    return this.roomId;
  }

  public getPlayerId(): string {
    return this.playerId;
  }

  /** Character ids this client is currently allowed to command. */
  public getControlledCharacterIds(playerId: string = this.playerId): string[] {
    const slot = this.slotAssignments.find((s) => s.playerId === playerId);
    return [...(slot?.controlledCharacterIds ?? [])];
  }

  /** Subscribe to lobby lifecycle events (joins/leaves/closure/errors). */
  public onRoomEvent(listener: RoomEventListener): () => void {
    this.roomListeners.add(listener);
    return () => {
      this.roomListeners.delete(listener);
    };
  }

  /* --------------------------- internals --------------------------------- */

  /** Kept for callers that want to push a projected state directly (e.g. tests). */
  public handleServerMessage(viewState: PlayerViewState, events: GameEvent[]): void {
    this.currentViewState = viewState;
    this.notifyListeners(viewState, events);
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) await this.connect();
  }

  private requireValidCode(raw: string): string {
    const code = normalizeRoomCode(raw);
    if (!isValidRoomCode(code)) {
      throw new WebSocketTransportError('BAD_REQUEST', `Invalid room code: ${raw}`);
    }
    return code;
  }

  private nextRequestId(): string {
    this.requestSequence += 1;
    return `req-${this.playerId}-${this.requestSequence}`;
  }

  private requireSocket(): WebSocketLike {
    if (!this.socket) {
      throw new WebSocketTransportError('BAD_REQUEST', 'WebSocketTransport is not connected');
    }
    return this.socket;
  }

  private request(message: WithoutRequestId<ClientMessage>): Promise<ServerMessage> {
    const requestId = this.nextRequestId();
    return new Promise<ServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(requestId)) {
          reject(
            new WebSocketTransportError(
              'INTERNAL_ERROR',
              `Request ${requestId} timed out after ${this.options.requestTimeoutMs ?? 15000}ms`,
            ),
          );
        }
      }, this.options.requestTimeoutMs ?? 15000);

      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.requireSocket().send(JSON.stringify({ ...message, requestId }));
      } catch (error) {
        this.pending.delete(requestId);
        clearTimeout(timer);
        reject(
          error instanceof Error
            ? error
            : new WebSocketTransportError('INTERNAL_ERROR', String(error)),
        );
      }
    });
  }

  private expect<T extends ServerMessage['type']>(
    message: ServerMessage,
    type: T,
  ): Extract<ServerMessage, { type: T }> {
    if (message.type !== type) {
      throw new WebSocketTransportError(
        'INTERNAL_ERROR',
        `Expected ${type} response but received ${message.type}`,
      );
    }
    return message as Extract<ServerMessage, { type: T }>;
  }

  private handleRawMessage(raw: unknown): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(String(raw)) as ServerMessage;
    } catch {
      return;
    }
    if (!message || typeof message.type !== 'string') return;

    const requestId = 'requestId' in message ? message.requestId : undefined;

    if (message.type === 'ERROR') {
      const code = isRoomErrorCode(message.code) ? message.code : 'INTERNAL_ERROR';
      if (requestId) {
        const pending = this.pending.get(requestId);
        if (pending) {
          this.pending.delete(requestId);
          clearTimeout(pending.timer);
          pending.reject(new WebSocketTransportError(code, message.message));
          return;
        }
      }
      this.emitRoomEvent({ type: 'ERROR', code, message: message.message });
      return;
    }

    if (requestId) {
      const pending = this.pending.get(requestId);
      if (pending) {
        this.pending.delete(requestId);
        clearTimeout(pending.timer);
        pending.resolve(message);
      }
    }

    if ('slotAssignments' in message && Array.isArray(message.slotAssignments)) {
      this.slotAssignments = structuredClone(message.slotAssignments);
    }

    switch (message.type) {
      case 'ROOM_CREATED':
      case 'ROOM_JOINED':
      case 'STATE_UPDATE':
      case 'STATE_SNAPSHOT':
      case 'SLOTS_UPDATED':
        this.currentViewState = message.viewState;
        this.notifyListeners(
          message.viewState,
          'events' in message ? message.events : [],
        );
        break;
      case 'PLAYER_JOINED':
        this.emitRoomEvent({
          type: 'PLAYER_JOINED',
          roomId: message.roomId,
          playerId: message.playerId,
          displayName: message.displayName,
        });
        break;
      case 'PLAYER_LEFT':
        this.emitRoomEvent({
          type: 'PLAYER_LEFT',
          roomId: message.roomId,
          playerId: message.playerId,
        });
        break;
      case 'ROOM_CLOSED':
        this.roomId = null;
        this.currentViewState = null;
        this.emitRoomEvent({
          type: 'ROOM_CLOSED',
          roomId: message.roomId,
          reason: message.reason,
        });
        break;
      case 'LEFT_ROOM':
      default:
        break;
    }
  }

  private applyServerState(message: ServerMessage): void {
    if ('viewState' in message) {
      this.currentViewState = message.viewState;
    }
    if ('slotAssignments' in message && Array.isArray(message.slotAssignments)) {
      this.slotAssignments = structuredClone(message.slotAssignments);
    }
  }

  private notifyListeners(viewState: PlayerViewState, events: GameEvent[]): void {
    for (const listener of this.listeners) {
      try {
        listener(viewState, events);
      } catch (error) {
        console.error('Error in WebSocketTransport state update listener:', error);
      }
    }
  }

  private emitRoomEvent(event: RoomEvent): void {
    for (const listener of this.roomListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in WebSocketTransport room event listener:', error);
      }
    }
  }

  private handleClose(): void {
    if (!this.connected) return;
    this.connected = false;
    this.socket = null;
    this.rejectAllPending(new WebSocketTransportError('INTERNAL_ERROR', 'Connection lost'));
    this.emitRoomEvent({ type: 'CONNECTION_LOST' });
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

/** Factory helper mirroring `createLocalTransport()`. */
export function createWebSocketTransport(options: WebSocketTransportOptions): WebSocketTransport {
  return new WebSocketTransport(options);
}
