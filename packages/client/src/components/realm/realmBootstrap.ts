/** Realm session bootstrap: default party, procedural world generation, settlement economies and quest boards (SRD-801/803/805). */
import {
  type CharacterBuildState,
  type SrdCompendium,
  defaultCompendium,
  getPregenCharacter,
} from '@srd5/data';
import {
  type Combatant,
  type OverworldQuest,
  type ShopInventory,
  type TravelPace,
  PLAYER_FACTION_ID,
  buildStarterQuestChains,
  computeDerivedCharacter,
  createCharacterCombatant,
  createOverworldTravelState,
  createQuestChainLog,
  createQuestLog,
  createWarDiplomacyState,
  generateOverworldMap,
  generateQuestBoard,
  generateShopInventory,
  getSettlements,
  mixBattleSeed,
  populateSettlements,
} from '@srd5/engine';

import {
  RealmSessionState,
} from './realmSession.js';
// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

export interface CreateRealmSessionOptions {
  seed?: number;
  width?: number;
  height?: number;
  partyCharacters?: CharacterBuildState[];
  compendium?: SrdCompendium;
  pace?: TravelPace;
  startingRations?: number;
  /** Shared party purse for overworld trade (character gp stays on sheets). */
  startingGold?: number;
  /** SRD-1403: Civ setup-screen session config (scope/wildness/scarcity/seed). */
  worldOptions?: import('@srd5/engine').WorldOptions;
}

export const DEFAULT_REALM_SEED = 805;
export const DEFAULT_REALM_SIZE = 64;
export const DEFAULT_REALM_STARTING_GOLD = 100;

/** Wilderness encounter chance per travel action, by pace (fast = riskier). */
export const WILDERNESS_ENCOUNTER_CHANCE: Record<TravelPace, number> = {
  slow: 0.08,
  normal: 0.15,
  fast: 0.22,
};

/** Ambush chance when taking a Long Rest outside a safe inn site. */
export const WILDERNESS_CAMP_AMBUSH_CHANCE = 0.25;

export function getDefaultRealmPartyCharacters(): CharacterBuildState[] {
  return [
    getPregenCharacter('pregen-fighter')!,
    getPregenCharacter('pregen-cleric')!,
    getPregenCharacter('pregen-rogue')!,
    getPregenCharacter('pregen-wizard')!,
  ].filter((c): c is CharacterBuildState => c !== undefined);
}

/**
 * Generates a fresh Realm: procedural world map, faction settlements with
 * shops and quest boards, the travel loop state, and persistent party
 * combatants (with `buildState` so XP / gold / loot commit back correctly).
 */
export function createRealmSession(
  options: CreateRealmSessionOptions = {},
): RealmSessionState {
  const compendium = options.compendium ?? defaultCompendium;
  const seed = options.worldOptions?.seed ?? options.seed ?? DEFAULT_REALM_SEED;

  const generated = generateOverworldMap({
    seed,
    width: options.width ?? DEFAULT_REALM_SIZE,
    height: options.height ?? DEFAULT_REALM_SIZE,
    ...(options.worldOptions ? { worldOptions: options.worldOptions } : {}),
  });
  const settled = populateSettlements(generated.map, generated.settlementSites);
  const map = settled.map;

  const travel = createOverworldTravelState(map, {
    pace: options.pace ?? 'normal',
    startingRations: options.startingRations ?? 10,
    startingGold: options.startingGold ?? DEFAULT_REALM_STARTING_GOLD,
    ...(options.worldOptions ? { worldOptions: options.worldOptions } : {}),
  });

  const characters =
    options.partyCharacters && options.partyCharacters.length > 0
      ? options.partyCharacters
      : getDefaultRealmPartyCharacters();

  const party: Record<string, Combatant> = {};
  const partyOrder: string[] = [];
  for (const char of characters) {
    const sheet = computeDerivedCharacter(char, compendium);
    const combatant = createCharacterCombatant(sheet, { x: 0, y: 0 }, {
      side: 'party',
      teamId: 'party',
      factionId: PLAYER_FACTION_ID,
      playerId: 'player-1',
      buildState: char,
    });
    party[combatant.id] = combatant;
    partyOrder.push(combatant.id);
  }

  // Deterministic per-POI economy: shops and quest boards derive their RNG
  // from the world seed + POI coordinates so replays are bit-exact.
  const shops: Record<string, ShopInventory> = {};
  const boardQuests: OverworldQuest[] = [];
  for (const poi of getSettlements(map)) {
    const poiSeed = mixBattleSeed(map.worldSeed, poi.q, poi.r);
    if (poi.services?.some((s) => s === 'blacksmith' || s === 'magic_shop' || s === 'temple')) {
      shops[poi.id] = generateShopInventory(poi, mixBattleSeed(poiSeed, 101)).inventory;
    }
    if (poi.services?.includes('quest_board')) {
      const board = generateQuestBoard(map, poi, mixBattleSeed(poiSeed, 202), {
        currentDay: travel.currentDay,
      });
      boardQuests.push(...board.quests);
    }
  }

  return {
    map,
    travel,
    party,
    partyOrder,
    questLog: createQuestLog(boardQuests),
    chainLog: createQuestChainLog(buildStarterQuestChains(map)),
    shops,
    clearedPoiIds: [],
    revealedPoiIds: getSettlements(map).map((poi) => poi.id),
    usedShrinePoiIds: [],
    war: null,
    diplomacy: createWarDiplomacyState(),
    activeWarMission: null,
    pendingWarBattle: null,
  };
}
