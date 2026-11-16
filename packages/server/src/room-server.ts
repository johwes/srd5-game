import type { SrdCompendium } from '@srd5/data';
import type { GameEvent, GameState, PlayerSlotAssignment } from '@srd5/engine';
import type { ProjectPlayerViewOptions } from '@srd5/transport';
import { RoomServerError } from './errors.js';
import {
  ROOM_CODE_ALPHABET,
  parseClientMessage,
  serializeServerMessage,
  type ClientMessage,
  type PlayerIdentity,
  type RoomSocket,
  type ServerMessage,
} from './protocol.js';
import { Room } from './room.js';

/** Per-connection routing state. */
interface ConnectionState {
  roomId: string | null;
  playerId: string | null;
}

/** Default grace period for an unanswered reaction prompt before it auto-passes. */
export const DEFAULT_REACTION_PROMPT_TIMEOUT_MS = 30_000;

export interface RoomServerOptions {
  /** Custom room-code generator (defaults to a random 6-character code). */
  generateRoomId?: () => string;
  projectionOptions?: ProjectPlayerViewOptions;
  compendium?: SrdCompendium;
  maxPlayers?: number;
  maxRooms?: number;
  /** Fallback reaction timeout when the engine prompt omits `timeoutMs`. */
  reactionPromptTimeoutMs?: number;
  /** Set false to leave prompts pending until a player responds (default true). */
  autoResolveReactionPrompts?: boolean;
}

/** One active reaction countdown, scoped to a room. */
interface ReactionTimer {
  promptId: string;
  timer: ReturnType<typeof setTimeout>;
}

export interface CreateRoomOptions {
  initialState: GameState;
  roomId?: string;
  host?: PlayerIdentity;
  maxPlayers?: number;
}

/** Reason a room was closed, relayed to clients still subscribed to it. */
export const ROOM_CLOSE_REASON = {
  EMPTY: 'All players left the room',
  DELETED: 'Room deleted by the server',
} as const;

/**
 * Authoritative room registry. Owns every `Room`, routes validated client
 * messages, and broadcasts per-player Fog-of-War projections.
 *
 * Transport-agnostic: `attachSocket()` accepts any `RoomSocket`, so the same
 * core is used by the `ws` adapter and by in-memory tests.
 */
export class RoomServer {
  private readonly rooms = new Map<string, Room>();
  private readonly options: RoomServerOptions;
  private readonly reactionTimers = new Map<string, ReactionTimer>();
  private playerSequence = 0;

  constructor(options: RoomServerOptions = {}) {
    this.options = options;
  }

  public generateRoomCode(): string {
    if (this.options.generateRoomId) {
      return this.options.generateRoomId();
    }
    let code = '';
    for (let i = 0; i < 6; i += 1) {
      code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
    }
    return code;
  }

  public listRooms(): string[] {
    return [...this.rooms.keys()];
  }

  public getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /**
   * Starts (or refreshes) the countdown for a room's pending reaction prompt.
   * The reactor alone receives the deadline in its Fog-of-War projection; when
   * the timer fires the prompt is auto-passed and the resumed state is
   * broadcast to every member (Spec 03 Section 5.2 / SRD-703).
   */
  public maybeScheduleReactionTimer(room: Room): void {
    const prompt = room.getPendingReactionPrompt();
    const existing = this.reactionTimers.get(room.roomId);
    if (!prompt || this.options.autoResolveReactionPrompts === false) {
      this.clearReactionTimer(room);
      return;
    }
    if (existing?.promptId === prompt.promptId) return;
    this.clearReactionTimer(room);

    const timeoutMs =
      prompt.timeoutMs ?? this.options.reactionPromptTimeoutMs ?? DEFAULT_REACTION_PROMPT_TIMEOUT_MS;
    const timer = setTimeout(() => {
      this.reactionTimers.delete(room.roomId);
      this.handleReactionTimeout(room.roomId, prompt.promptId);
    }, timeoutMs);
    // A pending reaction must not keep a Node process alive by itself.
    timer.unref?.();
    this.reactionTimers.set(room.roomId, { promptId: prompt.promptId, timer });
    room.setReactionPromptDeadline(Date.now() + timeoutMs);
  }

  /** Cancels a room's reaction countdown and clears its projected deadline. */
  public clearReactionTimer(room: Room): void {
    const existing = this.reactionTimers.get(room.roomId);
    if (existing) {
      clearTimeout(existing.timer);
      this.reactionTimers.delete(room.roomId);
    }
    room.setReactionPromptDeadline(null);
  }

  private handleReactionTimeout(roomId: string, promptId: string): void {
    const room = this.rooms.get(roomId);
    if (!room || room.getPendingReactionPrompt()?.promptId !== promptId) return;

    const events = room.passReactionPromptBySystem(promptId);
    room.setReactionPromptDeadline(null);
    this.broadcastState(room, events, '');
  }

  public createRoom(options: CreateRoomOptions): Room {
    const maxRooms = this.options.maxRooms ?? 64;
    if (this.rooms.size >= maxRooms) {
      throw new RoomServerError('ROOM_FULL', 'Server room capacity has been reached');
    }

    let roomId = options.roomId ?? this.generateRoomCode();
    while (this.rooms.has(roomId)) {
      roomId = this.generateRoomCode();
    }

    const room = new Room({
      roomId,
      initialState: options.initialState,
      maxPlayers: options.maxPlayers ?? this.options.maxPlayers,
      projectionOptions: this.options.projectionOptions,
      compendium: this.options.compendium,
    });
    if (options.host) {
      room.assignHostIdentity(options.host);
    }
    this.rooms.set(roomId, room);
    return room;
  }

  public deleteRoom(roomId: string, reason: string = ROOM_CLOSE_REASON.DELETED): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    this.clearReactionTimer(room);
    this.broadcast(room, () => ({ type: 'ROOM_CLOSED', roomId, reason }));
    for (const member of room.getMembers()) {
      member.socket = null;
    }
    return this.rooms.delete(roomId);
  }

  /**
   * Wires a socket to the server. Returns a detach function that removes all
   * listeners and cleans up any room membership held by the connection.
   */
  public attachSocket(socket: RoomSocket): () => void {
    const state: ConnectionState = { roomId: null, playerId: null };

    const offMessage = socket.onMessage((raw) => {
      this.handleMessage(socket, state, raw);
    });
    const offClose = socket.onClose(() => {
      this.handleDisconnect(state);
    });

    return () => {
      offMessage();
      offClose();
      this.handleDisconnect(state);
    };
  }

  /** Routes one validated client message and dispatches all resulting replies. */
  public handleMessage(socket: RoomSocket, state: ConnectionState, raw: string): void {
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      this.send(socket, { type: 'ERROR', code: 'BAD_REQUEST', message: parsed.error });
      return;
    }

    try {
      this.route(socket, state, parsed.message);
    } catch (error) {
      if (error instanceof RoomServerError) {
        this.send(socket, {
          type: 'ERROR',
          code: error.code,
          message: error.message,
          requestId: parsed.message.requestId,
        });
      } else {
        this.send(socket, {
          type: 'ERROR',
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : String(error),
          requestId: parsed.message.requestId,
        });
      }
    }
  }

  private route(socket: RoomSocket, state: ConnectionState, message: ClientMessage): void {
    switch (message.type) {
      case 'CREATE_ROOM': {
        if (state.roomId !== null) {
          throw new RoomServerError('BAD_REQUEST', 'Leave the current room before creating another');
        }
        const host: PlayerIdentity = message.host ?? {
          playerId: `player-${++this.playerSequence}`,
          displayName: 'Host',
        };
        const room = this.createRoom({
          initialState: message.initialState as GameState,
          roomId: message.roomId,
          host,
          maxPlayers: message.maxPlayers,
        });
        const member = room.addMember(host, socket);
        state.roomId = room.roomId;
        state.playerId = member.playerId;

        this.send(socket, {
          type: 'ROOM_CREATED',
          requestId: message.requestId,
          roomId: room.roomId,
          playerId: member.playerId,
          slotAssignments: room.getSlotAssignments(),
          viewState: room.getView(member.playerId),
          events: [],
        });
        break;
      }

      case 'JOIN_ROOM': {
        if (state.roomId !== null) {
          throw new RoomServerError('BAD_REQUEST', 'Leave the current room before joining another');
        }
        const room = this.rooms.get(message.roomId);
        if (!room) {
          throw new RoomServerError('ROOM_NOT_FOUND', `Room ${message.roomId} does not exist`);
        }
        const member = room.addMember(message.player, socket, message.requestedCharacterIds);
        state.roomId = room.roomId;
        state.playerId = member.playerId;

        this.send(socket, {
          type: 'ROOM_JOINED',
          requestId: message.requestId,
          roomId: room.roomId,
          playerId: member.playerId,
          slotAssignments: room.getSlotAssignments(),
          viewState: room.getView(member.playerId),
          events: [],
        });
        this.broadcast(
          room,
          () => ({
            type: 'PLAYER_JOINED',
            roomId: room.roomId,
            playerId: member.playerId,
            displayName: member.displayName,
            slotAssignments: room.getSlotAssignments(),
          }),
          member.playerId,
        );
        break;
      }

      case 'ASSIGN_SLOTS': {
        const { room, playerId } = this.requireMembership(state);
        const assignments: PlayerSlotAssignment[] = room.assignSlots(message.assignments);
        this.send(socket, {
          type: 'SLOTS_UPDATED',
          requestId: message.requestId,
          roomId: room.roomId,
          slotAssignments: assignments,
          viewState: room.getView(playerId),
        });
        this.broadcast(
          room,
          (memberId) => ({
            type: 'SLOTS_UPDATED',
            roomId: room.roomId,
            slotAssignments: assignments,
            viewState: room.getView(memberId),
          }),
          playerId,
        );
        break;
      }

      case 'DISPATCH_COMMAND': {
        const { room, playerId } = this.requireMembership(state);
        const events = room.dispatch(playerId, message.command);
        this.maybeScheduleReactionTimer(room);
        this.broadcastState(room, events, playerId, message.requestId);
        break;
      }

      case 'GET_STATE': {
        const { room, playerId } = this.requireMembership(state);
        this.send(socket, {
          type: 'STATE_SNAPSHOT',
          requestId: message.requestId,
          roomId: room.roomId,
          viewState: room.getView(playerId),
          slotAssignments: room.getSlotAssignments(),
        });
        break;
      }

      case 'LEAVE_ROOM': {
        const { room, playerId } = this.requireMembership(state);
        this.leaveRoom(socket, state, room, playerId, message.requestId);
        break;
      }
    }
  }

  private requireMembership(state: ConnectionState): { room: Room; playerId: string } {
    if (!state.roomId || !state.playerId) {
      throw new RoomServerError('NOT_IN_ROOM', 'This connection is not in a room');
    }
    const room = this.rooms.get(state.roomId);
    if (!room || !room.hasMember(state.playerId)) {
      throw new RoomServerError('NOT_IN_ROOM', 'Room membership is no longer valid');
    }
    return { room, playerId: state.playerId };
  }

  private leaveRoom(
    socket: RoomSocket,
    state: ConnectionState,
    room: Room,
    playerId: string,
    requestId?: string,
  ): void {
    room.removeMember(playerId);
    state.roomId = null;
    state.playerId = null;

    this.send(socket, { type: 'LEFT_ROOM', requestId, roomId: room.roomId });
    this.broadcast(
      room,
      () => ({
        type: 'PLAYER_LEFT',
        roomId: room.roomId,
        playerId,
        slotAssignments: room.getSlotAssignments(),
      }),
      playerId,
    );

    if (room.isEmpty()) {
      this.clearReactionTimer(room);
      this.rooms.delete(room.roomId);
    }
  }

  private handleDisconnect(state: ConnectionState): void {
    if (!state.roomId || !state.playerId) return;
    const room = this.rooms.get(state.roomId);
    const playerId = state.playerId;
    state.roomId = null;
    state.playerId = null;

    if (room && room.hasMember(playerId)) {
      room.removeMember(playerId);
      this.broadcast(
        room,
        () => ({
          type: 'PLAYER_LEFT',
          roomId: room.roomId,
          playerId,
          slotAssignments: room.getSlotAssignments(),
        }),
        playerId,
      );
      // Do not stall the encounter when the only player who could answer leaves.
      const pending = room.getPendingReactionPrompt();
      if (pending && room.getReactionOwnerPlayerId(pending) === playerId) {
        const events = room.passReactionPromptBySystem(pending.promptId);
        this.clearReactionTimer(room);
        this.broadcastState(room, events, '');
      }
      if (room.isEmpty()) {
        this.clearReactionTimer(room);
        this.rooms.delete(room.roomId);
      }
    }
  }

  /** Broadcasts a freshly projected STATE_UPDATE to every connected member. */
  private broadcastState(
    room: Room,
    events: GameEvent[],
    senderPlayerId: string,
    requestId?: string,
  ): void {
    for (const member of room.getMembers()) {
      this.send(member.socket, {
        type: 'STATE_UPDATE',
        requestId: member.playerId === senderPlayerId ? requestId : undefined,
        roomId: room.roomId,
        viewState: room.getView(member.playerId),
        slotAssignments: room.getSlotAssignments(),
        events,
      });
    }
  }

  private broadcast(
    room: Room,
    build: (playerId: string) => ServerMessage,
    exceptPlayerId?: string,
  ): void {
    for (const member of room.getMembers()) {
      if (member.playerId === exceptPlayerId) continue;
      this.send(member.socket, build(member.playerId));
    }
  }

  private send(socket: RoomSocket | null, message: ServerMessage): void {
    if (!socket) return;
    try {
      socket.send(serializeServerMessage(message));
    } catch {
      // A peer may have gone away between projection and send; ignore it.
    }
  }
}
