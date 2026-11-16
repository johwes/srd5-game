import { z } from 'zod';
import {
  type GameCommand,
  type GameEvent,
  type GameState,
  type PlayerSlotAssignment,
} from '@srd5/engine';
import type { PlayerViewState } from './types.js';

/**
 * Wire protocol shared by the authoritative `@srd5/server` room server and the
 * browser `@srd5/client` WebSocket adapter (Spec 05 Section 2 / SRD-701, SRD-702).
 * Keeping the definitions here makes client and server agree on message shapes
 * without the browser bundle importing the Node-only `ws` server package.
 */

/** Wire protocol version advertised by the room server. */
export const ROOM_SERVER_PROTOCOL_VERSION = '1.0.0' as const;

/** Room-code alphabet (ambiguity-free: no 0/1/I/O). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

/** Stable error codes returned to clients in `ERROR` messages. */
export const ROOM_ERROR_CODES = [
  'BAD_REQUEST',
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'DUPLICATE_PLAYER',
  'NOT_IN_ROOM',
  'UNAUTHORIZED',
  'INVALID_ASSIGNMENT',
  'ENGINE_ERROR',
  'INTERNAL_ERROR',
] as const;
export type RoomErrorCode = (typeof ROOM_ERROR_CODES)[number];

/** Identity a client supplies when creating or joining a room. */
export interface PlayerIdentity {
  playerId: string;
  displayName?: string;
}

/**
 * Client -> server messages. Every message may carry a `requestId` which the
 * server echoes on its direct replies so a client can correlate promises.
 */
export type ClientMessage =
  | {
      type: 'CREATE_ROOM';
      requestId?: string;
      roomId?: string;
      initialState: GameState;
      host?: PlayerIdentity;
      maxPlayers?: number;
    }
  | {
      type: 'JOIN_ROOM';
      requestId?: string;
      roomId: string;
      player: PlayerIdentity;
      /** Characters this player would like to control; unclaimed ones are granted. */
      requestedCharacterIds?: string[];
    }
  | {
      type: 'ASSIGN_SLOTS';
      requestId?: string;
      assignments: PlayerSlotAssignment[];
    }
  | {
      type: 'DISPATCH_COMMAND';
      requestId?: string;
      command: GameCommand;
    }
  | { type: 'GET_STATE'; requestId?: string }
  | { type: 'LEAVE_ROOM'; requestId?: string };

/** Server -> client messages. */
export type ServerMessage =
  | {
      type: 'ROOM_CREATED';
      requestId?: string;
      roomId: string;
      playerId: string;
      slotAssignments: PlayerSlotAssignment[];
      viewState: PlayerViewState;
      events: GameEvent[];
    }
  | {
      type: 'ROOM_JOINED';
      requestId?: string;
      roomId: string;
      playerId: string;
      slotAssignments: PlayerSlotAssignment[];
      viewState: PlayerViewState;
      events: GameEvent[];
    }
  | {
      type: 'STATE_UPDATE';
      requestId?: string;
      roomId: string;
      viewState: PlayerViewState;
      slotAssignments: PlayerSlotAssignment[];
      events: GameEvent[];
    }
  | {
      type: 'STATE_SNAPSHOT';
      requestId?: string;
      roomId: string;
      viewState: PlayerViewState;
      slotAssignments: PlayerSlotAssignment[];
    }
  | {
      type: 'SLOTS_UPDATED';
      requestId?: string;
      roomId: string;
      slotAssignments: PlayerSlotAssignment[];
      viewState: PlayerViewState;
    }
  | {
      type: 'PLAYER_JOINED';
      roomId: string;
      playerId: string;
      displayName: string;
      slotAssignments: PlayerSlotAssignment[];
    }
  | {
      type: 'PLAYER_LEFT';
      roomId: string;
      playerId: string;
      slotAssignments: PlayerSlotAssignment[];
    }
  | { type: 'LEFT_ROOM'; requestId?: string; roomId: string }
  | { type: 'ROOM_CLOSED'; roomId: string; reason: string }
  | { type: 'ERROR'; requestId?: string; code: RoomErrorCode; message: string };

/**
 * Minimal transport handle the room server needs from a socket. The `ws`
 * adapter wraps a real `ws.WebSocket`; tests use in-memory fakes.
 */
export interface RoomSocket {
  /** Send a raw JSON string to the remote peer. */
  send(raw: string): void;
  /** Register a handler for incoming raw JSON strings; returns an unsubscribe fn. */
  onMessage(handler: (raw: string) => void): () => void;
  /** Register a handler invoked when the peer disconnects; returns an unsubscribe fn. */
  onClose(handler: () => void): () => void;
}

/* -------------------------------------------------------------------------- */
/* Room code helpers (used by lobby UIs before/after joining).                  */
/* -------------------------------------------------------------------------- */

/** Uppercases and strips separators so `abc-234` and ` ABC234 ` are equivalent. */
export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** True when a code is a canonical, server-generatable 6-character room code. */
export function isValidRoomCode(raw: string): boolean {
  const code = normalizeRoomCode(raw);
  if (code.length !== ROOM_CODE_LENGTH) return false;
  return [...code].every((ch) => ROOM_CODE_ALPHABET.includes(ch));
}

/** Display form of a room code (e.g. `ABC234` -> `ABC-234`). */
export function formatRoomCode(raw: string): string {
  const code = normalizeRoomCode(raw);
  return code.length > 3 ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

/** Generates a client-side suggested room code (server remains authoritative). */
export function generateRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/* -------------------------------------------------------------------------- */
/* Runtime validation of untrusted network payloads (Spec 05 Section 5).       */
/* -------------------------------------------------------------------------- */

const nonEmptyString = z.string().min(1);
const looseObject = z.object({}).passthrough();
const commandEnvelope = z.object({ type: nonEmptyString }).passthrough();

export const PlayerIdentitySchema = z.object({
  playerId: nonEmptyString,
  displayName: z.string().optional(),
});

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('CREATE_ROOM'),
    requestId: z.string().optional(),
    roomId: z.string().optional(),
    initialState: looseObject,
    host: PlayerIdentitySchema.optional(),
    maxPlayers: z.number().int().min(1).max(16).optional(),
  }),
  z.object({
    type: z.literal('JOIN_ROOM'),
    requestId: z.string().optional(),
    roomId: nonEmptyString,
    player: PlayerIdentitySchema,
    requestedCharacterIds: z.array(nonEmptyString).optional(),
  }),
  z.object({
    type: z.literal('ASSIGN_SLOTS'),
    requestId: z.string().optional(),
    assignments: z.array(
      z.object({
        playerId: nonEmptyString,
        displayName: z.string(),
        controlledCharacterIds: z.array(nonEmptyString),
      }),
    ),
  }),
  z.object({
    type: z.literal('DISPATCH_COMMAND'),
    requestId: z.string().optional(),
    command: commandEnvelope,
  }),
  z.object({ type: z.literal('GET_STATE'), requestId: z.string().optional() }),
  z.object({ type: z.literal('LEAVE_ROOM'), requestId: z.string().optional() }),
]);

export type ParseClientMessageResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; error: string };

/**
 * Parses and validates a raw JSON wire message. The loosely validated object is
 * narrowed to `ClientMessage`; full `GameCommand` semantics remain the engine's
 * responsibility (the reducer is authoritative).
 */
export function parseClientMessage(raw: string): ParseClientMessageResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Malformed JSON payload' };
  }

  const parsed = ClientMessageSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Invalid client message: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    };
  }

  return { ok: true, message: parsed.data as unknown as ClientMessage };
}

/** Serializes a server message for transmission. */
export function serializeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}
