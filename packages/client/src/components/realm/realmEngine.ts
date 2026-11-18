import {
  type CharacterBuildState,
  type SrdCompendium,
  defaultCompendium,
  getPregenCharacter,
} from '@srd5/data';
import {
  type Combatant,
  type DungeonFloorSpec,
  type GameEvent,
  type GeneratedOverworldBattle,
  type GameState,
  type OverworldBattleOrigin,
  type OverworldCoord,
  type OverworldMap,
  type OverworldPOI,
  type OverworldQuest,
  type OverworldTravelEvent,
  type OverworldTravelState,
  type QuestLog,
  type RealmDelveKind,
  type RealmDelveState,
  type RealmEvent,
  type SettlementRumor,
  type ShopInventory,
  type TravelPace,
  PLAYER_FACTION_ID,
  RealmError,
  acceptQuest,
  acceptSettlementRumor,
  activateOverworldShrine,
  blessPartyWithTemple,
  campOverworld,
  canCampEarly,
  cleansePartyAffliction,
  completeQuestForParty,
  computeDerivedCharacter,
  createCharacterCombatant,
  createOverworldTravelState,
  createQuestLog,
  failQuest,
  filterMarketStockForParty,
  forceExpeditionMarch,
  forageForRations,
  generateOverworldMap,
  generateQuestBoard,
  generateSettlementRumors,
  generateShopInventory,
  generateWildernessBattle,
  getDailyTravelPoints,
  getFactionByPoi,
  getIdentifyCost,
  getPoiAt,
  getReputationDisposition,
  getSettlements,
  getSettlementHubAccess,
  getTempleBlessingCost,
  getTempleCleanseCost,
  getTravelDayBudget,
  identifyMagicItem,
  isSafeRestSite,
  mixBattleSeed,
  nextRandomFloat,
  planExpedition,
  previewExpedition,
  populateSettlements,
  purchaseItem,
  resolveOverworldBattle,
  sellItem,
  startOverworldBattle,
  startRealmDelve,
  travelAlongPath,
} from '@srd5/engine';
import {
  type DungeonStorageAdapter,
  defaultDungeonStorageAdapter,
} from '../../persistence/index.js';

/**
 * Client-side Realm session controller (SRD-805, Spec 06 Section 4).
 *
 * The overworld engine (SRD-801..804) is a pure-function library with no
 * `reduceGame` integration, so this module mirrors the Command/Event boundary
 * locally: the UI dispatches serializable `RealmCommand` objects through
 * `reduceRealm()`, which returns the next session plus domain events. Tactical
 * battles bridge into the standard engine `GameState` via
 * `startOverworldBattle` / `resolveOverworldBattle` and a `LocalTransport`.
 *
 * Every function here is non-mutating and deterministic — RNG is threaded
 * through `OverworldTravelState.rngState`; `Math.random()` is never called.
 */

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

/** Aggregate persistent Realm state: world map + travel loop + party + economy. */
export interface RealmSessionState {
  map: OverworldMap;
  travel: OverworldTravelState;
  party: Record<string, Combatant>;
  /** Stable display/command order of the party combatant ids. */
  partyOrder: string[];
  questLog: QuestLog;
  /** Per-settlement shop inventories keyed by POI id. */
  shops: Record<string, ShopInventory>;
  /** Dungeon entrance / monster lair POIs already cleared by the party. */
  clearedPoiIds: string[];
  /** Wilderness POIs revealed through inn rumors (SRD-808). */
  revealedPoiIds: string[];
  /** Ancient shrine POIs already communed with (one blessing per shrine). */
  usedShrinePoiIds: string[];
}

export type RealmSessionEvent =
  | OverworldTravelEvent
  | RealmEvent
  | { type: 'REALM_ENCOUNTER_STARTED'; battleId: string; origin: OverworldBattleOrigin; poiId?: string }
  | {
      type: 'REALM_BATTLE_RESOLVED';
      battleId: string;
      totalXp: number;
      goldAwarded: number;
      completedQuestIds: string[];
    }
  | { type: 'REALM_POI_CLEARED'; poiId: string; name: string }
  | {
      type: 'REALM_DELVE_STARTED';
      poiId: string;
      name: string;
      kind: RealmDelveKind;
      floors: number;
    }
  | {
      type: 'REALM_DELVE_RESOLVED';
      poiId: string;
      name: string;
      kind: RealmDelveKind;
      cleared: boolean;
      score: number;
      totalXp: number;
      goldAwarded: number;
      completedQuestIds: string[];
    }
  | {
      type: 'REALM_SHRINE_ACTIVATED';
      poiId: string;
      shrineType: string;
      effectDescription: string;
    }
  | { type: 'REALM_LOG'; message: string };

export interface RealmReduceResult {
  session: RealmSessionState;
  events: RealmSessionEvent[];
  /** Set when the command triggered a tactical battle; the view swaps to combat. */
  battle?: GeneratedOverworldBattle;
  battleGameState?: GameState;
  battleEvents?: GameEvent[];
  /** Set when the command launched a POI delve; the view swaps to the delver. */
  delve?: RealmDelveState;
  delveGameState?: GameState;
  delveFloor?: DungeonFloorSpec;
  delveEvents?: GameEvent[];
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export type RealmCommand =
  | { type: 'REALM_TRAVEL_TO'; destination: OverworldCoord }
  | { type: 'REALM_SET_PACE'; pace: TravelPace }
  | { type: 'REALM_FORAGE' }
  | { type: 'REALM_FORCE_MARCH' }
  | {
      type: 'REALM_CAMP';
      restType: 'short' | 'long';
      hitDiceToSpend?: Record<string, number>;
      /** Secure daylight Short Rest that does not advance the day (SRD-807). */
      early?: boolean;
    }
  | { type: 'REALM_ACCEPT_QUEST'; questId: string }
  | { type: 'REALM_ABANDON_QUEST'; questId: string }
  | { type: 'REALM_BUY_ITEM'; poiId: string; itemId: string; quantity: number; characterId?: string }
  | { type: 'REALM_SELL_ITEM'; poiId: string; characterId: string; instanceId: string }
  | { type: 'REALM_HEAR_RUMOR'; poiId: string; targetPoiId: string }
  | { type: 'REALM_IDENTIFY_ITEM'; poiId: string; characterId: string; instanceId: string }
  | { type: 'REALM_TEMPLE_CLEANSE'; poiId: string; characterId: string }
  | { type: 'REALM_TEMPLE_BLESS'; poiId: string }
  | { type: 'REALM_ENTER_POI'; poiId: string };

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

function getDefaultRealmPartyCharacters(): CharacterBuildState[] {
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
  const seed = options.seed ?? DEFAULT_REALM_SEED;

  const generated = generateOverworldMap({
    seed,
    width: options.width ?? DEFAULT_REALM_SIZE,
    height: options.height ?? DEFAULT_REALM_SIZE,
  });
  const settled = populateSettlements(generated.map, generated.settlementSites);
  const map = settled.map;

  const travel = createOverworldTravelState(map, {
    pace: options.pace ?? 'normal',
    startingRations: options.startingRations ?? 10,
    startingGold: options.startingGold ?? DEFAULT_REALM_STARTING_GOLD,
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
    shops,
    clearedPoiIds: [],
    revealedPoiIds: getSettlements(map).map((poi) => poi.id),
    usedShrinePoiIds: [],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getPartyList(session: RealmSessionState): Combatant[] {
  return session.partyOrder
    .map((id) => session.party[id])
    .filter((c): c is Combatant => Boolean(c));
}

export function getLivingParty(session: RealmSessionState): Combatant[] {
  return getPartyList(session).filter((c) => !c.isDead && c.currentHp > 0);
}

export function getCurrentPoi(session: RealmSessionState): OverworldPOI | null {
  return getPoiAt(session.map, session.travel.partyPosition) ?? null;
}

export function isSettlementPoi(poi: OverworldPOI): boolean {
  return poi.kind === 'capital' || poi.kind === 'town' || poi.kind === 'village';
}

export interface RealmExpeditionPreview {
  path: OverworldCoord[];
  points: number;
  days: number;
  rations: number;
  arrivalDay: number;
  arrivalPhase: OverworldTravelState['timeOfDay'];
}

/**
 * Pre-commit expedition estimate (SRD-807): total movement cost, days,
 * overnight rations, and arrival phase for a distant tile/POI. Pure and
 * deterministic — never samples or exposes future RNG.
 */
export function previewRealmExpedition(
  session: RealmSessionState,
  destination: OverworldCoord,
): RealmExpeditionPreview {
  return previewExpedition(
    session.travel,
    session.map,
    destination,
    getLivingParty(session).length,
  );
}

/** Planned expedition route (orthogonal tile steps, excluding the start). */
export function planRealmExpedition(
  session: RealmSessionState,
  destination: OverworldCoord,
): OverworldCoord[] {
  return planExpedition(session.map, session.travel.partyPosition, destination);
}

/** Whether a secure daylight Short Rest is available right now (SRD-807). */
export function canTakeEarlyCamp(session: RealmSessionState): boolean {
  return canCampEarly(session.travel);
}

/** Whether the party can force an extra +2 movement points today (SRD-807). */
export function canForceMarch(session: RealmSessionState): boolean {
  return (
    session.travel.forcedMarchDay !== session.travel.currentDay &&
    getLivingParty(session).length > 0
  );
}

/** Today's full movement budget including any forced-march bonus (SRD-807). */
export function getRealmDayBudget(session: RealmSessionState): number {
  return getTravelDayBudget(session.travel);
}

function getPartySurvivalBonus(session: RealmSessionState): number {
  let best = 0;
  for (const hero of getPartyList(session)) {
    const bonus = hero.characterSheet?.skills?.survival?.totalBonus ?? 0;
    if (bonus > best) best = bonus;
  }
  return best;
}

function requirePoiAtParty(session: RealmSessionState, poiId: string): OverworldPOI {
  const poi = session.map.pois[poiId];
  if (!poi) throw new RealmError(`Unknown location "${poiId}"`);
  if (poi.q !== session.travel.partyPosition.q || poi.r !== session.travel.partyPosition.r) {
    throw new RealmError(`Travel to ${poi.name} first`);
  }
  return poi;
}

function getTradeReputation(session: RealmSessionState, poi: OverworldPOI): number {
  const faction = getFactionByPoi(session.map, poi.id);
  return faction?.relationshipWithParty ?? 0;
}

function assertTradeAllowed(session: RealmSessionState, poi: OverworldPOI): void {
  const reputation = getTradeReputation(session, poi);
  if (getReputationDisposition(reputation) === 'hostile') {
    const faction = getFactionByPoi(session.map, poi.id);
    throw new RealmError(
      `${faction?.name ?? 'The locals'} refuse to trade with your party (hostile reputation)`,
    );
  }
}

function requireSettlementAtParty(session: RealmSessionState, poiId: string): OverworldPOI {
  const poi = requirePoiAtParty(session, poiId);
  if (!isSettlementPoi(poi)) throw new RealmError(`${poi.name} is not a settlement`);
  return poi;
}

/** Deterministic inn rumors for a settlement (SRD-808). Stable per map seed. */
export function getHubRumors(session: RealmSessionState, poiId: string): SettlementRumor[] {
  const poi = session.map.pois[poiId];
  if (!poi) throw new RealmError(`Unknown location "${poiId}"`);
  const seed = mixBattleSeed(session.map.worldSeed, poi.q, poi.r);
  return generateSettlementRumors(session.map, poi, mixBattleSeed(seed, 808), {
    excludePoiIds: session.clearedPoiIds,
  }).rumors;
}

/** Market stock visible to the party after reputation gating (SRD-808). */
export function getHubMarketStock(session: RealmSessionState, poiId: string): ShopInventory | null {
  const inventory = session.shops[poiId];
  if (!inventory) return null;
  const poi = session.map.pois[poiId];
  if (!poi) return null;
  const access = getSettlementHubAccess(session.map, poi);
  if (!access.marketOpen) return { ...inventory, items: [] };
  return { ...inventory, items: filterMarketStockForParty(inventory.items, access.reputation) };
}

function startBattleFromSession(
  session: RealmSessionState,
  battle: GeneratedOverworldBattle,
  compendium: SrdCompendium,
): { battle: GeneratedOverworldBattle; battleGameState: GameState; battleEvents: GameEvent[] } {
  const battleSession = startOverworldBattle({
    battle,
    party: getPartyList(session),
    compendium,
  });
  return {
    battle: battleSession.battle,
    battleGameState: battleSession.gameState,
    battleEvents: battleSession.events,
  };
}

/** Rolls a wilderness encounter using the threaded travel RNG (non-mutating). */
function rollWildernessEncounter(
  session: RealmSessionState,
  chance: number,
  compendium: SrdCompendium,
): {
  travel: OverworldTravelState;
  battle?: GeneratedOverworldBattle;
  battleGameState?: GameState;
  battleEvents?: GameEvent[];
} {
  const roll = nextRandomFloat(session.travel.rngState);
  const travel = { ...session.travel, rngState: roll.nextState };
  if (roll.value >= chance) return { travel };
  const battle = generateWildernessBattle(
    session.map,
    travel,
    Math.max(1, getPartyList(session).length),
    {},
    compendium,
  );
  const started = startBattleFromSession({ ...session, travel }, battle, compendium);
  return { travel, ...started };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export interface ReduceRealmOptions {
  compendium?: SrdCompendium;
}

/**
 * Applies a serializable Realm command to the session, returning the next
 * session, domain events, and (when triggered) a tactical battle to mount.
 * Throws `RealmError` / `OverworldTravelError` on invalid commands.
 */
export function reduceRealm(
  session: RealmSessionState,
  command: RealmCommand,
  options: ReduceRealmOptions = {},
): RealmReduceResult {
  const compendium = options.compendium ?? defaultCompendium;
  const next: RealmSessionState = structuredClone(session);
  const events: RealmSessionEvent[] = [];
  // Backward compatibility with pre-SRD-808 sessions (no revealed POI tracking).
  if (!Array.isArray(next.revealedPoiIds)) {
    next.revealedPoiIds = getSettlements(next.map).map((poi) => poi.id);
  }

  switch (command.type) {
    case 'REALM_TRAVEL_TO': {
      const { q, r } = command.destination;
      if (q === next.travel.partyPosition.q && r === next.travel.partyPosition.r) {
        return { session: next, events };
      }
      const result = travelAlongPath(next.travel, next.map, { q, r });
      next.travel = result.state;
      events.push(...result.events);

      // Wandering hostiles may ambush the party on the road (never inside a
      // settlement). The encounter roll consumes the threaded travel RNG.
      const poi = getPoiAt(next.map, next.travel.partyPosition);
      const inSettlement = poi ? isSettlementPoi(poi) : false;
      if (result.traversed.length > 0 && !inSettlement) {
        const encounter = rollWildernessEncounter(
          next,
          WILDERNESS_ENCOUNTER_CHANCE[next.travel.travelPace],
          compendium,
        );
        next.travel = encounter.travel;
        if (encounter.battle && encounter.battleGameState) {
          events.push({
            type: 'REALM_ENCOUNTER_STARTED',
            battleId: encounter.battle.battleId,
            origin: 'wilderness',
          });
          return {
            session: next,
            events,
            battle: encounter.battle,
            battleGameState: encounter.battleGameState,
            battleEvents: encounter.battleEvents,
          };
        }
      }
      return { session: next, events };
    }

    case 'REALM_SET_PACE': {
      next.travel = { ...next.travel, travelPace: command.pace };
      events.push({
        type: 'REALM_LOG',
        message: `Travel pace set to ${command.pace} (${getDailyTravelPoints(command.pace)} movement points per day)`,
      });
      return { session: next, events };
    }

    case 'REALM_FORAGE': {
      const result = forageForRations(next.travel, next.map, {
        survivalBonus: getPartySurvivalBonus(next),
      });
      next.travel = result.state;
      events.push(...result.events);
      return { session: next, events };
    }

    case 'REALM_FORCE_MARCH': {
      const forced = forceExpeditionMarch(next.travel, next.party);
      next.travel = forced.state;
      next.party = forced.party;
      events.push(forced.event);
      return { session: next, events };
    }

    case 'REALM_CAMP': {
      const camp = campOverworld(next.travel, next.map, next.party, {
        restType: command.restType,
        hitDiceToSpend: command.hitDiceToSpend,
        early: command.early,
      });
      next.travel = camp.state;
      next.party = camp.party;
      events.push(...camp.events);

      // Unsafe wilderness Long Rests risk an ambush at dawn. Early daylight
      // Short Rests never roll the calendar (or an ambush).
      if (command.restType === 'long' && !command.early && !camp.safe) {
        const encounter = rollWildernessEncounter(
          next,
          WILDERNESS_CAMP_AMBUSH_CHANCE,
          compendium,
        );
        next.travel = encounter.travel;
        if (encounter.battle && encounter.battleGameState) {
          events.push({
            type: 'REALM_ENCOUNTER_STARTED',
            battleId: encounter.battle.battleId,
            origin: 'wilderness',
          });
          return {
            session: next,
            events,
            battle: encounter.battle,
            battleGameState: encounter.battleGameState,
            battleEvents: encounter.battleEvents,
          };
        }
      }
      return { session: next, events };
    }

    case 'REALM_ACCEPT_QUEST': {
      const quest = next.questLog.quests.find((qq) => qq.id === command.questId);
      if (!quest) throw new RealmError(`Unknown quest "${command.questId}"`);
      next.questLog = acceptQuest(next.questLog, command.questId, next.travel.currentDay);
      events.push({
        type: 'QUEST_ACCEPTED',
        questId: quest.id,
        title: quest.title,
        day: next.travel.currentDay,
      });
      return { session: next, events };
    }

    case 'REALM_ABANDON_QUEST': {
      const quest = next.questLog.quests.find((qq) => qq.id === command.questId);
      if (!quest) throw new RealmError(`Unknown quest "${command.questId}"`);
      next.questLog = failQuest(next.questLog, command.questId, next.travel.currentDay);
      events.push({
        type: 'QUEST_FAILED',
        questId: quest.id,
        title: quest.title,
        day: next.travel.currentDay,
      });
      return { session: next, events };
    }

    case 'REALM_BUY_ITEM': {
      const poi = requirePoiAtParty(next, command.poiId);
      assertTradeAllowed(next, poi);
      const inventory = next.shops[poi.id];
      if (!inventory) throw new RealmError(`${poi.name} has no shop`);
      const reputation = getTradeReputation(next, poi);
      const result = purchaseItem(
        next.travel,
        inventory,
        command.itemId,
        command.quantity,
        reputation,
      );
      next.travel = result.state;
      next.shops[poi.id] = result.inventory;

      const recipientId = command.characterId ?? next.partyOrder[0];
      const recipient = next.party[recipientId];
      if (!recipient?.buildState) {
        throw new RealmError(`Cannot deliver purchases to "${recipientId}"`);
      }
      recipient.buildState = {
        ...recipient.buildState,
        inventory: [...recipient.buildState.inventory, ...result.items],
      };
      events.push(...result.events);
      events.push({
        type: 'REALM_LOG',
        message: `${result.items.map((i) => `${i.quantity}× ${i.itemId}`).join(', ')} delivered to ${recipient.name}`,
      });
      return { session: next, events };
    }

    case 'REALM_SELL_ITEM': {
      const poi = requirePoiAtParty(next, command.poiId);
      assertTradeAllowed(next, poi);
      const inventory = next.shops[poi.id];
      if (!inventory) throw new RealmError(`${poi.name} has no shop`);
      const seller = next.party[command.characterId];
      if (!seller?.buildState) throw new RealmError(`Unknown seller "${command.characterId}"`);
      const instance = seller.buildState.inventory.find(
        (i) => i.instanceId === command.instanceId,
      );
      if (!instance) throw new RealmError(`Item "${command.instanceId}" not in ${seller.name}'s inventory`);
      const reputation = getTradeReputation(next, poi);
      const result = sellItem(next.travel, inventory, instance, reputation);
      next.travel = result.state;
      seller.buildState = {
        ...seller.buildState,
        inventory: seller.buildState.inventory.filter(
          (i) => i.instanceId !== command.instanceId,
        ),
        equippedSlots: clearEquippedReferences(seller.buildState.equippedSlots, command.instanceId),
      };
      events.push(...result.events);
      return { session: next, events };
    }

    case 'REALM_HEAR_RUMOR': {
      const poi = requireSettlementAtParty(next, command.poiId);
      const access = getSettlementHubAccess(next.map, poi);
      if (!access.innOpen) throw new RealmError(`${poi.name} has no inn`);
      const rumors = getHubRumors(next, poi.id);
      const rumor = rumors.find((entry) => entry.targetPoiId === command.targetPoiId);
      if (!rumor) throw new RealmError(`No such rumor at ${poi.name}`);
      if (next.revealedPoiIds.includes(rumor.targetPoiId)) {
        throw new RealmError(`${rumor.targetName} is already marked on your map`);
      }
      if (next.travel.gold < rumor.costGp) {
        throw new RealmError(`Not enough gold for a round of ale (need ${rumor.costGp} gp)`);
      }
      next.travel = { ...next.travel, gold: next.travel.gold - rumor.costGp };
      next.revealedPoiIds = acceptSettlementRumor(next.revealedPoiIds, rumor);
      events.push({
        type: 'RUMOR_HEARD',
        poiId: poi.id,
        targetPoiId: rumor.targetPoiId,
        targetName: rumor.targetName,
      });
      events.push({
        type: 'REALM_LOG',
        message: `Rumor heard: ${rumor.targetName} marked on the map`,
      });
      return { session: next, events };
    }

    case 'REALM_IDENTIFY_ITEM': {
      const poi = requireSettlementAtParty(next, command.poiId);
      const access = getSettlementHubAccess(next.map, poi);
      if (!access.marketOpen) {
        throw new RealmError(`${poi.name} market is closed to your party (${access.tier})`);
      }
      const hero = next.party[command.characterId];
      if (!hero?.buildState) throw new RealmError(`Unknown hero "${command.characterId}"`);
      const index = hero.buildState.inventory.findIndex(
        (i) => i.instanceId === command.instanceId,
      );
      if (index < 0) throw new RealmError(`Item "${command.instanceId}" not in ${hero.name}'s inventory`);
      const result = identifyMagicItem(next.travel, hero.buildState.inventory[index]!, access.reputation);
      next.travel = result.state;
      const inventory = [...hero.buildState.inventory];
      inventory[index] = result.instance;
      hero.buildState = { ...hero.buildState, inventory };
      events.push({
        type: 'ITEM_IDENTIFIED',
        poiId: poi.id,
        itemId: result.instance.itemId,
        instanceId: result.instance.instanceId,
        costGp: result.costGp,
        goldRemaining: result.state.gold,
      });
      return { session: next, events };
    }

    case 'REALM_TEMPLE_CLEANSE': {
      const poi = requireSettlementAtParty(next, command.poiId);
      const access = getSettlementHubAccess(next.map, poi);
      if (!access.templeOpen) {
        throw new RealmError(
          `${poi.name} temple is closed to your party (${access.tier})`,
        );
      }
      const costGp = getTempleCleanseCost(access.reputation);
      if (next.travel.gold < costGp) {
        throw new RealmError(`Not enough gold for cleansing (need ${costGp} gp)`);
      }
      const cleansed = cleansePartyAffliction(next.party, command.characterId);
      next.party = cleansed.party;
      next.travel = { ...next.travel, gold: next.travel.gold - costGp };
      const hero = next.party[command.characterId]!;
      events.push({
        type: 'TEMPLE_CLEANSED',
        poiId: poi.id,
        characterId: command.characterId,
        characterName: hero.name,
        removed: cleansed.removed,
        costGp,
        goldRemaining: next.travel.gold,
      });
      return { session: next, events };
    }

    case 'REALM_TEMPLE_BLESS': {
      const poi = requireSettlementAtParty(next, command.poiId);
      const access = getSettlementHubAccess(next.map, poi);
      if (!access.templeOpen) {
        throw new RealmError(
          `${poi.name} temple is closed to your party (${access.tier})`,
        );
      }
      const costGp = getTempleBlessingCost(access.reputation);
      if (next.travel.gold < costGp) {
        throw new RealmError(`Not enough gold for a blessing (need ${costGp} gp)`);
      }
      const blessed = blessPartyWithTemple(next.party);
      next.party = blessed.party;
      next.travel = { ...next.travel, gold: next.travel.gold - costGp };
      events.push({
        type: 'TEMPLE_BLESSED',
        poiId: poi.id,
        costGp,
        goldRemaining: next.travel.gold,
        blessedCount: blessed.blessedCount,
      });
      return { session: next, events };
    }

    case 'REALM_ENTER_POI': {
      const poi = requirePoiAtParty(next, command.poiId);
      if (poi.kind === 'ancient_shrine') {
        if (next.usedShrinePoiIds.includes(poi.id)) {
          throw new RealmError(`${poi.name} has already granted its blessing`);
        }
        const shrine = activateOverworldShrine(next.map, poi, next.party);
        next.party = shrine.party;
        next.usedShrinePoiIds.push(poi.id);
        events.push({
          type: 'REALM_SHRINE_ACTIVATED',
          poiId: poi.id,
          shrineType: shrine.shrineType,
          effectDescription: shrine.effectDescription,
        });
        events.push({ type: 'REALM_LOG', message: shrine.effectDescription });
        return { session: next, events };
      }
      if (poi.kind !== 'dungeon_entrance' && poi.kind !== 'monster_lair') {
        throw new RealmError(`${poi.name} is entered through its services panel`);
      }
      if (next.clearedPoiIds.includes(poi.id)) {
        throw new RealmError(`${poi.name} has already been cleared`);
      }
      // SRD-806: dungeon entrances launch a bounded delve; lairs a single-floor
      // clear. Both run the Deep Descent loop scoped to the POI (Spec 06 §4.3).
      const delveSession = startRealmDelve({
        map: next.map,
        poi,
        party: getPartyList(next),
        startingRations: next.travel.rations,
        compendium,
      });
      events.push({
        type: 'REALM_DELVE_STARTED',
        poiId: poi.id,
        name: poi.name,
        kind: delveSession.delve.kind,
        floors: delveSession.delve.finalDepth - delveSession.delve.startDepth + 1,
      });
      return {
        session: next,
        events,
        delve: delveSession.delve,
        delveGameState: delveSession.gameState,
        delveFloor: delveSession.generatedFloor.floor,
      };
    }

    default: {
      const exhaustive: never = command;
      throw new RealmError(`Unknown realm command: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function clearEquippedReferences(
  slots: CharacterBuildState['equippedSlots'],
  instanceId: string,
): CharacterBuildState['equippedSlots'] {
  const nextSlots = { ...slots };
  for (const key of Object.keys(nextSlots) as Array<keyof typeof nextSlots>) {
    if (nextSlots[key] === instanceId) delete nextSlots[key];
  }
  return nextSlots;
}

// ---------------------------------------------------------------------------
// Battle resolution (tactical -> overworld commit-back)
// ---------------------------------------------------------------------------

export interface ResolveRealmBattleResult {
  session: RealmSessionState;
  events: RealmSessionEvent[];
  totalXp: number;
  goldAwarded: number;
  completedQuestIds: string[];
}

/**
 * Commits a victorious tactical battle back into the Realm session: XP and
 * per-hero gold via `resolveOverworldBattle`, party HP/slots persistence,
 * overworld purse gold, POI clearance, and linked quest completion.
 */
export function resolveRealmBattle(
  session: RealmSessionState,
  battleGameState: GameState,
  battle: GeneratedOverworldBattle,
  compendium: SrdCompendium = defaultCompendium,
): ResolveRealmBattleResult {
  const resolution = resolveOverworldBattle(battleGameState, { compendium });
  const next: RealmSessionState = structuredClone(session);
  // Tactical GameEvents stay in the battle view's combat log; the realm log
  // only records the strategic commit-back summary below.
  const events: RealmSessionEvent[] = [];

  next.party = structuredClone(resolution.nextState.party);
  next.travel = { ...next.travel, gold: next.travel.gold + resolution.goldAwarded };

  const completedQuestIds: string[] = [];
  if (battle.poiId) {
    if (!next.clearedPoiIds.includes(battle.poiId)) {
      next.clearedPoiIds.push(battle.poiId);
    }
    const poi = next.map.pois[battle.poiId];
    events.push({
      type: 'REALM_POI_CLEARED',
      poiId: battle.poiId,
      name: poi?.name ?? battle.poiId,
    });

    // Complete active quests targeting this POI (bounties / dungeon delves).
    const linked = next.questLog.quests.filter(
      (quest) => quest.status === 'active' && quest.targetPoiId === battle.poiId,
    );
    for (const quest of linked) {
      const resolved = completeQuestForParty(
        next.questLog,
        next.travel,
        next.map,
        quest.id,
        next.travel.currentDay,
      );
      next.questLog = resolved.log;
      next.travel = resolved.state;
      next.map = resolved.map;
      events.push(...resolved.events);
      completedQuestIds.push(quest.id);
    }
  }

  events.push({
    type: 'REALM_BATTLE_RESOLVED',
    battleId: battle.battleId,
    totalXp: resolution.totalXp,
    goldAwarded: resolution.goldAwarded,
    completedQuestIds,
  });

  return {
    session: next,
    events,
    totalXp: resolution.totalXp,
    goldAwarded: resolution.goldAwarded,
    completedQuestIds,
  };
}

// ---------------------------------------------------------------------------
// Delve resolution (dungeon-delver -> overworld commit-back, SRD-806)
// ---------------------------------------------------------------------------

export interface ResolveRealmDelveResult {
  session: RealmSessionState;
  events: RealmSessionEvent[];
  totalXp: number;
  goldAwarded: number;
  completedQuestIds: string[];
  cleared: boolean;
  score: number;
  graveyardEntry?: RealmDelveState['graveyardEntry'];
}

/**
 * Commits a concluded POI delve back into the Realm session (Spec 06 §4.2 step 3
 * & §4.3): persistent party HP/slots/XP, plundered gold to the overworld purse,
 * unused rations returned to the travel supplies, POI clearance and linked quest
 * completion on a clear. The input session is never mutated.
 */
export function resolveRealmDelve(
  session: RealmSessionState,
  delve: RealmDelveState,
  delveGameState: GameState,
  compendium: SrdCompendium = defaultCompendium,
): ResolveRealmDelveResult {
  void compendium;
  const next: RealmSessionState = structuredClone(session);
  const events: RealmSessionEvent[] = [];

  // Persistent party state (XP was awarded to buildState during encounters).
  next.party = structuredClone(delveGameState.party);
  next.travel = {
    ...next.travel,
    gold: next.travel.gold + delve.goldCollected,
    rations: delve.suppliesRemaining,
  };

  const completedQuestIds: string[] = [];
  if (delve.cleared) {
    if (!next.clearedPoiIds.includes(delve.poiId)) {
      next.clearedPoiIds.push(delve.poiId);
    }
    const poi = next.map.pois[delve.poiId];
    events.push({
      type: 'REALM_POI_CLEARED',
      poiId: delve.poiId,
      name: poi?.name ?? delve.poiName,
    });

    const linked = next.questLog.quests.filter(
      (quest) => quest.status === 'active' && quest.targetPoiId === delve.poiId,
    );
    for (const quest of linked) {
      const resolved = completeQuestForParty(
        next.questLog,
        next.travel,
        next.map,
        quest.id,
        next.travel.currentDay,
      );
      next.questLog = resolved.log;
      next.travel = resolved.state;
      next.map = resolved.map;
      events.push(...resolved.events);
      completedQuestIds.push(quest.id);
    }
  }

  events.push({
    type: 'REALM_DELVE_RESOLVED',
    poiId: delve.poiId,
    name: delve.poiName,
    kind: delve.kind,
    cleared: delve.cleared,
    score: delve.score,
    totalXp: delve.totalXp,
    goldAwarded: delve.goldCollected,
    completedQuestIds,
  });

  return {
    session: next,
    events,
    totalXp: delve.totalXp,
    goldAwarded: delve.goldCollected,
    completedQuestIds,
    cleared: delve.cleared,
    score: delve.score,
    graveyardEntry: delve.graveyardEntry,
  };
}

// ---------------------------------------------------------------------------
// Event formatting (travel log feed)
// ---------------------------------------------------------------------------

export function describeRealmEvent(event: RealmSessionEvent): string {
  switch (event.type) {
    case 'TRAVEL_STEP':
      return `Marched to (${event.to.q}, ${event.to.r}) — ${event.movementPointsSpent} MP`;
    case 'TRAVEL_COMPLETED':
      return event.arrived
        ? `Arrived at (${event.destination.q}, ${event.destination.r})`
        : `Out of movement points — camp to continue`;
    case 'TIME_OF_DAY_CHANGED':
      return `${event.from} falls to ${event.to}`;
    case 'DAY_ADVANCED':
      return `Day ${event.day} dawns (${event.weather})`;
    case 'WEATHER_CHANGED':
      return `The weather turns: ${event.weather}`;
    case 'FORAGE_RESULT':
      return event.success
        ? `Foraging success (${event.total} vs DC ${event.dc}): +${event.rationsFound} rations`
        : `Foraging failed (${event.total} vs DC ${event.dc})`;
    case 'CAMP_REST':
      return event.restType === 'long'
        ? event.safe
          ? 'Long rest at a safe inn — fully recovered'
          : event.starved
            ? 'Long rest on short rations — the party suffers exhaustion'
            : `Long rest in the wild (${event.rationsConsumed} rations consumed)`
        : 'Short rest — hit dice spent';
    case 'STARVATION':
      return `${event.characterId} gains exhaustion level ${event.exhaustionLevel}`;
    case 'FORCED_MARCH': {
      const costs: string[] = [];
      if (event.spentHitDice.length > 0) costs.push(`HD spent: ${event.spentHitDice.join(', ')}`);
      if (event.exhausted.length > 0) costs.push(`exhausted: ${event.exhausted.join(', ')}`);
      return `Forced march (+${event.points} MP)${costs.length > 0 ? ` — ${costs.join('; ')}` : ''}`;
    }
    case 'POI_DISCOVERED':
      return `Discovered ${event.name} (${event.kind.replace(/_/g, ' ')})`;
    case 'REPUTATION_CHANGED':
      return `Reputation with ${event.factionId}: ${event.previous} → ${event.value} (${event.tier})`;
    case 'SHOP_PURCHASE':
      return `Bought ${event.quantity}× ${event.itemId} for ${event.costGp} gp`;
    case 'SHOP_SALE':
      return `Sold ${event.quantity}× ${event.itemId} for ${event.goldEarned} gp`;
    case 'QUEST_ACCEPTED':
      return `Quest accepted: ${event.title}`;
    case 'QUEST_COMPLETED':
      return `Quest complete: ${event.title} (+${event.goldAwarded} gp, +${event.reputationAwarded} rep)`;
    case 'QUEST_FAILED':
      return `Quest failed: ${event.title}`;
    case 'RUMOR_HEARD':
      return `Inn rumor: ${event.targetName} marked on the map`;
    case 'ITEM_IDENTIFIED':
      return `Identified ${event.itemId} for ${event.costGp} gp`;
    case 'TEMPLE_CLEANSED':
      return `${event.characterName} cleansed (${event.removed.join(', ')}) for ${event.costGp} gp`;
    case 'TEMPLE_BLESSED':
      return event.costGp > 0
        ? `The temple blesses ${event.blessedCount} hero(es) for ${event.costGp} gp`
        : `The temple blesses ${event.blessedCount} hero(es) free of charge (exalted allies)`;
    case 'REALM_ENCOUNTER_STARTED':
      return event.origin === 'wilderness'
        ? 'Wandering hostiles attack the party on the road!'
        : `The party enters ${event.poiId ?? 'the dungeon'} — battle begins!`;
    case 'REALM_BATTLE_RESOLVED':
      return `Victory! ${event.totalXp} XP, +${event.goldAwarded} gp${
        event.completedQuestIds.length > 0
          ? ` · ${event.completedQuestIds.length} quest(s) completed`
          : ''
      }`;
    case 'REALM_POI_CLEARED':
      return `${event.name} is cleared`;
    case 'REALM_DELVE_STARTED':
      return event.kind === 'lair_clear'
        ? `The party assaults ${event.name} — a single-floor lair clear!`
        : `The party descends into ${event.name} — a ${event.floors}-floor delve!`;
    case 'REALM_DELVE_RESOLVED':
      return event.cleared
        ? `${event.name} cleared! ${event.totalXp} XP, +${event.goldAwarded} gp${
            event.kind === 'bounded_delve' ? ` · score ${event.score.toLocaleString()}` : ''
          }${
            event.completedQuestIds.length > 0
              ? ` · ${event.completedQuestIds.length} quest(s) completed`
              : ''
          }`
        : `The party was overcome in ${event.name}…`;
    case 'REALM_SHRINE_ACTIVATED':
      return event.effectDescription;
    case 'REALM_LOG':
      return event.message;
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Save / Load (IndexedDB via the shared storage adapter)
// ---------------------------------------------------------------------------

export const REALM_SAVE_STORAGE_KEY = 'srd5:realm-save:v1';

export interface RealmSaveData {
  version: 1;
  savedAt: string;
  worldName: string;
  currentDay: number;
  partySummary: Array<{ id: string; name: string; currentHp: number; maxHp: number }>;
  session: RealmSessionState;
}

export async function quickSaveRealmSession(
  session: RealmSessionState,
  adapter: DungeonStorageAdapter = defaultDungeonStorageAdapter,
): Promise<RealmSaveData> {
  const data: RealmSaveData = {
    version: 1,
    savedAt: new Date().toISOString(),
    worldName: session.map.worldName,
    currentDay: session.travel.currentDay,
    partySummary: getPartyList(session).map((c) => ({
      id: c.id,
      name: c.name,
      currentHp: c.currentHp,
      maxHp: c.maxHp,
    })),
    session: structuredClone(session),
  };
  await adapter.setItem(REALM_SAVE_STORAGE_KEY, data);
  return data;
}

export async function loadRealmSession(
  adapter: DungeonStorageAdapter = defaultDungeonStorageAdapter,
): Promise<RealmSaveData | null> {
  const raw = await adapter.getItem(REALM_SAVE_STORAGE_KEY);
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as RealmSaveData;
  if (data.version !== 1 || !data.session?.map || !data.session?.travel) return null;
  // Backward compatibility with pre-SRD-808 saves (no revealed POI tracking).
  if (!Array.isArray((data.session as RealmSessionState).revealedPoiIds)) {
    (data.session as RealmSessionState).revealedPoiIds = getSettlements(data.session.map).map(
      (poi) => poi.id,
    );
  }
  return data;
}
