import { describe, expect, it } from 'vitest';
import type { CharacterBuildState } from '@srd5/data';
import { getPregenCharacter } from '@srd5/data';
import type { PartySlotAssignment } from '../components/campaign/types.js';
import {
  LOCAL_PLAYER_ID,
  campaignSlotsToEngineSlots,
  distributeCharactersEvenly,
  getControlledCharacters,
  getPlayersFromAssignments,
  moveCharacterToPlayer,
  validateSlotAssignments,
} from '../multiplayer/slotAssignment.js';

const heroes = [
  getPregenCharacter('pregen-fighter')!,
  getPregenCharacter('pregen-rogue')!,
  getPregenCharacter('pregen-wizard')!,
  getPregenCharacter('pregen-cleric')!,
].filter((c): c is CharacterBuildState => Boolean(c));
const ids = heroes.map((c) => c.id);

function campfireSlots(): PartySlotAssignment[] {
  return heroes.map((character, index) => ({
    slotIndex: index,
    roleSuggestion: 'frontline' as const,
    character,
    seatType: index === 1 ? 'network_remote' : 'local',
    playerSeatId: index === 1 ? 'FriendSeat' : undefined,
  }));
}

describe('SRD-702: player-to-character slot assignment', () => {
  it('maps campfire seats to engine slot assignments, grouping shared seats', () => {
    const assignments = campaignSlotsToEngineSlots(campfireSlots());
    const local = assignments.find((a) => a.playerId === LOCAL_PLAYER_ID);
    const remote = assignments.find((a) => a.playerId === 'FriendSeat');

    expect(local?.controlledCharacterIds).toEqual([ids[0], ids[2], ids[3]]);
    expect(remote?.controlledCharacterIds).toEqual([ids[1]]);
    expect(remote?.displayName).toBe('FriendSeat');
  });

  it('ignores empty campfire slots and duplicate characters', () => {
    const slots = campfireSlots();
    slots[2] = { ...slots[2]!, character: null };
    slots[3] = { ...slots[3]!, character: heroes[0]! };
    const assignments = campaignSlotsToEngineSlots(slots);
    expect(assignments.flatMap((a) => a.controlledCharacterIds)).toEqual([ids[0], ids[1]]);
  });

  it('distributes characters round-robin for co-op and splits them into two PvP teams', () => {
    const coop = distributeCharactersEvenly(['p1', 'p2'], ids, 'coop');
    expect(coop[0]!.controlledCharacterIds).toEqual([ids[0], ids[2]]);
    expect(coop[1]!.controlledCharacterIds).toEqual([ids[1], ids[3]]);

    const pvp = distributeCharactersEvenly(['red', 'blue'], ids, 'pvp');
    expect(pvp[0]!.controlledCharacterIds).toEqual([ids[0], ids[1]]);
    expect(pvp[1]!.controlledCharacterIds).toEqual([ids[2], ids[3]]);
  });

  it('moves a character between seats immutably', () => {
    const initial = distributeCharactersEvenly(['p1', 'p2'], ids);
    const next = moveCharacterToPlayer(initial, ids[0]!, 'p2', { displayName: 'Player 2' });

    expect(getControlledCharacters(initial, 'p1')).toContain(ids[0]);
    expect(getControlledCharacters(next, 'p1')).not.toContain(ids[0]);
    expect(getControlledCharacters(next, 'p2')).toContain(ids[0]);
    expect(getPlayersFromAssignments(next).map((p) => p.playerId)).toEqual(['p1', 'p2']);
  });

  it('validates duplicate/unknown/unassigned characters', () => {
    const valid = distributeCharactersEvenly(['p1', 'p2'], ids);
    expect(validateSlotAssignments(valid, ids, { requireAllAssigned: true }).valid).toBe(true);

    const duplicate = moveCharacterToPlayer(valid, ids[1]!, 'p1');
    // move removes from p2 first, so build a true duplicate explicitly
    duplicate.find((a) => a.playerId === 'p2')!.controlledCharacterIds.push(ids[0]!);
    const result = validateSlotAssignments(duplicate, ids);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/more than one player/);

    const unknown = validateSlotAssignments(
      [{ playerId: 'p1', displayName: 'P1', controlledCharacterIds: ['ghost'] }],
      ids,
    );
    expect(unknown.valid).toBe(false);
    expect(unknown.errors.join(' ')).toMatch(/Unknown character/);

    const missing = validateSlotAssignments(valid.slice(0, 1), ids, {
      requireAllAssigned: true,
    });
    expect(missing.errors.join(' ')).toMatch(/unassigned/);
  });
});
