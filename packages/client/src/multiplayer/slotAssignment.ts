import type { PlayerSlotAssignment } from '@srd5/transport';
import type { PartySlotAssignment } from '../components/campaign/types.js';

/** A lobby seat: one human player who controls zero or more characters. */
export interface LobbyPlayer {
  playerId: string;
  displayName: string;
}

export const LOCAL_PLAYER_ID = 'local-player';

/**
 * Converts the campaign wizard's campfire seat configuration into authoritative
 * engine `PlayerSlotAssignment` records. Characters assigned to the same seat
 * are grouped under one player; empty slots are ignored.
 */
export function campaignSlotsToEngineSlots(
  slots: PartySlotAssignment[],
  options: { localPlayerId?: string } = {},
): PlayerSlotAssignment[] {
  const localPlayerId = options.localPlayerId ?? LOCAL_PLAYER_ID;
  const byPlayer = new Map<string, PlayerSlotAssignment>();
  const claimed = new Set<string>();

  slots.forEach((slot, index) => {
    if (!slot.character) return;
    const characterId = slot.character.id;
    if (claimed.has(characterId)) return;
    claimed.add(characterId);

    const remote = slot.seatType === 'network_remote';
    const seatName = slot.playerSeatId?.trim();
    const playerId = remote ? (seatName ?? `remote-seat-${index + 1}`) : localPlayerId;
    const displayName = remote ? (seatName ?? `Remote Seat ${index + 1}`) : 'Local Player';

    let assignment = byPlayer.get(playerId);
    if (!assignment) {
      assignment = { playerId, displayName, controlledCharacterIds: [] };
      byPlayer.set(playerId, assignment);
    }
    assignment.controlledCharacterIds.push(characterId);
  });

  return [...byPlayer.values()];
}

/** Even co-op distribution or two-team PvP split of characters across seats. */
export function distributeCharactersEvenly(
  playerIds: string[],
  characterIds: string[],
  mode: 'coop' | 'pvp' = 'coop',
): PlayerSlotAssignment[] {
  const slots: PlayerSlotAssignment[] = playerIds.map((playerId) => ({
    playerId,
    displayName: playerId,
    controlledCharacterIds: [],
  }));
  if (slots.length === 0) return slots;

  if (mode === 'pvp' && slots.length === 2) {
    const firstTeamSize = Math.ceil(characterIds.length / 2);
    characterIds.slice(0, firstTeamSize).forEach((id) => slots[0]!.controlledCharacterIds.push(id));
    characterIds.slice(firstTeamSize).forEach((id) => slots[1]!.controlledCharacterIds.push(id));
    return slots;
  }

  characterIds.forEach((id, index) => {
    slots[index % slots.length]!.controlledCharacterIds.push(id);
  });
  return slots;
}

export interface SlotAssignmentValidation {
  valid: boolean;
  errors: string[];
}

/** Client-side pre-check mirroring the server's `Room.assignSlots()` invariants. */
export function validateSlotAssignments(
  assignments: PlayerSlotAssignment[],
  characterIds: string[],
  options: { requireAllAssigned?: boolean } = {},
): SlotAssignmentValidation {
  const errors: string[] = [];
  const knownCharacters = new Set(characterIds);
  const seenPlayers = new Set<string>();
  const claimed = new Set<string>();

  for (const assignment of assignments) {
    if (!assignment.playerId) errors.push('An assignment is missing a player ID');
    if (seenPlayers.has(assignment.playerId)) {
      errors.push(`Player ${assignment.playerId} appears more than once`);
    }
    seenPlayers.add(assignment.playerId);
    for (const characterId of assignment.controlledCharacterIds) {
      if (!knownCharacters.has(characterId)) {
        errors.push(`Unknown character: ${characterId}`);
      }
      if (claimed.has(characterId)) {
        errors.push(`Character ${characterId} is assigned to more than one player`);
      }
      claimed.add(characterId);
    }
  }

  if (options.requireAllAssigned) {
    for (const characterId of characterIds) {
      if (!claimed.has(characterId)) errors.push(`Character ${characterId} is unassigned`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Immutable move of one character to a (possibly new) player seat. */
export function moveCharacterToPlayer(
  assignments: PlayerSlotAssignment[],
  characterId: string,
  targetPlayerId: string,
  options: { displayName?: string } = {},
): PlayerSlotAssignment[] {
  const next = assignments.map((slot) => ({
    ...slot,
    controlledCharacterIds: slot.controlledCharacterIds.filter((id) => id !== characterId),
  }));

  let target = next.find((slot) => slot.playerId === targetPlayerId);
  if (!target) {
    target = {
      playerId: targetPlayerId,
      displayName: options.displayName ?? targetPlayerId,
      controlledCharacterIds: [],
    };
    next.push(target);
  }
  if (!target.controlledCharacterIds.includes(characterId)) {
    target.controlledCharacterIds.push(characterId);
  }
  return next;
}

/** Unique players referenced by a set of assignments, in first-seen order. */
export function getPlayersFromAssignments(assignments: PlayerSlotAssignment[]): LobbyPlayer[] {
  const players: LobbyPlayer[] = [];
  const seen = new Set<string>();
  for (const assignment of assignments) {
    if (seen.has(assignment.playerId)) continue;
    seen.add(assignment.playerId);
    players.push({ playerId: assignment.playerId, displayName: assignment.displayName });
  }
  return players;
}

/** Character ids controlled by a given player. */
export function getControlledCharacters(
  assignments: PlayerSlotAssignment[],
  playerId: string,
): string[] {
  return assignments.find((slot) => slot.playerId === playerId)?.controlledCharacterIds ?? [];
}
