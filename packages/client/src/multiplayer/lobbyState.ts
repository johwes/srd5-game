import type { CharacterBuildState, SrdCompendium } from '@srd5/data';
import {
  type Combatant,
  type GameState,
  type PlayerSlotAssignment,
  computeDerivedCharacter,
  createCharacterCombatant,
  createInitialGameState,
  createTacticalGrid,
} from '@srd5/engine';
import type { PartySlotAssignment } from '../components/campaign/types.js';
import { LOCAL_PLAYER_ID, campaignSlotsToEngineSlots } from './slotAssignment.js';

export interface MultiplayerInitialStateOptions {
  party: CharacterBuildState[];
  compendium: SrdCompendium;
  /** Campfire seat config from the campaign wizard, if available. */
  campaignSlots?: PartySlotAssignment[];
  localPlayerId?: string;
  rngSeed?: number;
}

/**
 * Builds the authoritative `GameState` a host uploads when creating a room.
 * Party combatants are derived from real SRD character sheets, so the server
 * can immediately project a valid Fog-of-War view to every connected player.
 */
export function createMultiplayerInitialState(
  options: MultiplayerInitialStateOptions,
): GameState {
  const localPlayerId = options.localPlayerId ?? LOCAL_PLAYER_ID;
  const party: Combatant[] = options.party.map((character, index) => {
    const sheet = computeDerivedCharacter(character, options.compendium);
    return createCharacterCombatant(sheet, { x: 1 + index, y: 9 }, {
      side: 'party',
      teamId: 'party',
      playerId: localPlayerId,
      buildState: character,
    });
  });

  const slots: PlayerSlotAssignment[] = options.campaignSlots?.length
    ? campaignSlotsToEngineSlots(options.campaignSlots, { localPlayerId })
    : [
        {
          playerId: localPlayerId,
          displayName: 'Local Player',
          controlledCharacterIds: party.map((c) => c.id),
        },
      ];

  return createInitialGameState({
    id: `multiplayer-${Date.now()}`,
    grid: createTacticalGrid(20, 12),
    party,
    slots,
    rngState: options.rngSeed ?? 123456789,
  });
}
