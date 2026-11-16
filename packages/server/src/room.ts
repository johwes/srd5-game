import type { SrdCompendium } from '@srd5/data';
import {
  type GameCommand,
  type GameEvent,
  type GameState,
  type PlayerSlotAssignment,
  reduceGame,
} from '@srd5/engine';
import {
  projectPlayerView,
  type PlayerViewState,
  type ProjectPlayerViewOptions,
} from '@srd5/transport';
import { RoomServerError } from './errors.js';
import type { PlayerIdentity, RoomSocket } from './protocol.js';

/** A connected participant in a room. */
export interface RoomMember {
  playerId: string;
  displayName: string;
  socket: RoomSocket | null;
  joinedAt: number;
}

export interface RoomOptions {
  roomId: string;
  initialState: GameState;
  maxPlayers?: number;
  projectionOptions?: ProjectPlayerViewOptions;
  compendium?: SrdCompendium;
}

/**
 * Extracts the character ids a command acts through. A player may only drive
 * commands whose subject characters they control (Spec 05 Section 2.3).
 */
function commandSubjectIds(command: GameCommand): string[] {
  const record = command as unknown as Record<string, unknown>;
  const ids: string[] = [];
  for (const key of ['actorId', 'characterId', 'reactorId'] as const) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) ids.push(value);
  }
  return ids;
}

/**
 * One authoritative @srd5/engine game session. The room owns the canonical
 * GameState; clients only ever receive per-player Fog-of-War projections.
 */
export class Room {
  public readonly roomId: string;
  public readonly createdAt: number;
  public readonly maxPlayers: number;

  private authoritativeState: GameState;
  private readonly members = new Map<string, RoomMember>();
  private readonly projectionOptions: ProjectPlayerViewOptions;
  private readonly compendium?: SrdCompendium;
  private hostPlayerId: string | null = null;

  constructor(options: RoomOptions) {
    this.roomId = options.roomId;
    this.createdAt = Date.now();
    this.maxPlayers = options.maxPlayers ?? 8;
    this.authoritativeState = structuredClone(options.initialState);
    this.projectionOptions = options.projectionOptions ?? { sharedVision: true };
    this.compendium = options.compendium;
  }

  /** Rebinds the room's first slot to the creating player (the host). */
  public assignHostIdentity(host: PlayerIdentity): void {
    this.hostPlayerId = host.playerId;
    const slots = this.authoritativeState.slots;
    if (slots.length > 0) {
      slots[0] = {
        ...slots[0]!,
        playerId: host.playerId,
        displayName: host.displayName ?? slots[0]!.displayName,
      };
    } else {
      slots.push({
        playerId: host.playerId,
        displayName: host.displayName ?? 'Host',
        controlledCharacterIds: Object.keys(this.authoritativeState.party),
      });
    }
  }

  /** True when the room has no connected participants. */
  public isEmpty(): boolean {
    return this.members.size === 0;
  }

  public isHost(playerId: string): boolean {
    return this.hostPlayerId === playerId;
  }

  public getHostPlayerId(): string | null {
    return this.hostPlayerId;
  }

  public hasMember(playerId: string): boolean {
    return this.members.has(playerId);
  }

  public getMember(playerId: string): RoomMember | undefined {
    return this.members.get(playerId);
  }

  public getMembers(): RoomMember[] {
    return [...this.members.values()];
  }

  public getMemberIds(): string[] {
    return [...this.members.keys()];
  }

  /**
   * Adds a participant and grants control of unclaimed party characters.
   * Explicit `requestedCharacterIds` let co-op players pick specific heroes.
   */
  public addMember(
    player: PlayerIdentity,
    socket: RoomSocket | null,
    requestedCharacterIds?: string[],
  ): RoomMember {
    if (this.members.has(player.playerId)) {
      throw new RoomServerError('DUPLICATE_PLAYER', `Player ${player.playerId} is already in room ${this.roomId}`);
    }
    if (this.members.size >= this.maxPlayers) {
      throw new RoomServerError('ROOM_FULL', `Room ${this.roomId} is full`);
    }

    const member: RoomMember = {
      playerId: player.playerId,
      displayName: player.displayName ?? player.playerId,
      socket,
      joinedAt: Date.now(),
    };
    this.members.set(member.playerId, member);
    if (this.hostPlayerId === null) {
      this.hostPlayerId = member.playerId;
    }

    this.ensureSlotForMember(member, requestedCharacterIds);
    return { ...member };
  }

  /** Detaches a participant, keeping their slot so a reconnect can reclaim it. */
  public removeMember(playerId: string): RoomMember | undefined {
    const member = this.members.get(playerId);
    if (member) {
      this.members.delete(playerId);
    }
    return member;
  }

  public setMemberSocket(playerId: string, socket: RoomSocket | null): void {
    const member = this.members.get(playerId);
    if (member) {
      member.socket = socket;
    }
  }

  public getSlotAssignments(): PlayerSlotAssignment[] {
    return structuredClone(this.authoritativeState.slots);
  }

  /** Per-player Fog-of-War projection. Never exposes the authoritative state. */
  public getView(playerId: string): PlayerViewState {
    return projectPlayerView(this.authoritativeState, playerId, this.projectionOptions);
  }

  /** Authoritative state clone — for snapshots, persistence, or diagnostics only. */
  public getAuthoritativeState(): GameState {
    return structuredClone(this.authoritativeState);
  }

  /** Loads an authoritative state (host migration / save restore). */
  public setAuthoritativeState(state: GameState): void {
    this.authoritativeState = structuredClone(state);
  }

  /**
   * Validates and applies an explicit player-to-character assignment.
   * Every current member must be represented, every character must exist,
   * and no character may be assigned to more than one player.
   */
  public assignSlots(assignments: PlayerSlotAssignment[]): PlayerSlotAssignment[] {
    const memberIds = new Set(this.members.keys());
    const partyIds = new Set(Object.keys(this.authoritativeState.party));
    const seenPlayers = new Set<string>();
    const claimedCharacters = new Set<string>();

    for (const assignment of assignments) {
      if (!memberIds.has(assignment.playerId) || seenPlayers.has(assignment.playerId)) {
        throw new RoomServerError(
          'INVALID_ASSIGNMENT',
          `Slot assignment references an unknown or duplicate player: ${assignment.playerId}`,
        );
      }
      seenPlayers.add(assignment.playerId);
      for (const characterId of assignment.controlledCharacterIds) {
        if (!partyIds.has(characterId)) {
          throw new RoomServerError(
            'INVALID_ASSIGNMENT',
            `Unknown character in slot assignment: ${characterId}`,
          );
        }
        if (claimedCharacters.has(characterId)) {
          throw new RoomServerError(
            'INVALID_ASSIGNMENT',
            `Character ${characterId} is assigned to more than one player`,
          );
        }
        claimedCharacters.add(characterId);
      }
    }

    for (const playerId of memberIds) {
      if (!seenPlayers.has(playerId)) {
        throw new RoomServerError(
          'INVALID_ASSIGNMENT',
          `Slot assignment is missing player ${playerId}`,
        );
      }
    }

    this.authoritativeState.slots = structuredClone(assignments);
    return this.getSlotAssignments();
  }

  /**
   * Runs a command through the authoritative reducer after verifying that the
   * caller controls every character the command acts through.
   */
  public dispatch(playerId: string, command: GameCommand): GameEvent[] {
    if (!this.members.has(playerId)) {
      throw new RoomServerError('NOT_IN_ROOM', `Player ${playerId} is not in room ${this.roomId}`);
    }

    const slot = this.authoritativeState.slots.find((s) => s.playerId === playerId);
    const controlled = new Set(slot?.controlledCharacterIds ?? []);
    for (const subjectId of commandSubjectIds(command)) {
      if (!controlled.has(subjectId)) {
        throw new RoomServerError(
          'UNAUTHORIZED',
          `Player ${playerId} does not control character ${subjectId}`,
        );
      }
    }

    let result: ReturnType<typeof reduceGame>;
    try {
      result = reduceGame(this.authoritativeState, command, { compendium: this.compendium });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new RoomServerError('ENGINE_ERROR', `Command rejected by engine: ${message}`);
    }

    this.authoritativeState = result.nextState;
    return result.events;
  }

  private ensureSlotForMember(member: RoomMember, requestedCharacterIds?: string[]): void {
    const slots = this.authoritativeState.slots;
    const partyCharacterIds = Object.keys(this.authoritativeState.party);
    const partyIds = new Set(partyCharacterIds);
    const claimed = new Set(slots.flatMap((s) => s.controlledCharacterIds));
    const unclaimed = () => partyCharacterIds.filter((id) => !claimed.has(id));

    const existing = slots.find((s) => s.playerId === member.playerId);
    if (existing) {
      if (existing.controlledCharacterIds.length === 0 && requestedCharacterIds?.length) {
        const granted = this.filterClaimable(requestedCharacterIds, claimed, partyIds);
        existing.controlledCharacterIds = granted;
        for (const id of granted) claimed.add(id);
      }
      existing.displayName = member.displayName;
      return;
    }

    const desired = requestedCharacterIds?.length ? requestedCharacterIds : unclaimed();
    const granted = this.filterClaimable(desired, claimed, partyIds);
    slots.push({
      playerId: member.playerId,
      displayName: member.displayName,
      controlledCharacterIds: granted,
    });
  }

  private filterClaimable(desired: string[], claimed: Set<string>, partyIds: Set<string>): string[] {
    const granted: string[] = [];
    for (const id of desired) {
      if (partyIds.has(id) && !claimed.has(id)) {
        granted.push(id);
        claimed.add(id);
      }
    }
    return granted;
  }
}
