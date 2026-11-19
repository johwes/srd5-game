/** Expedition planning, travel helpers, settlement hub services and wilderness encounter rolls (SRD-802/807/808). */
import {
  type SrdCompendium,
} from '@srd5/data';
import {
  type Combatant,
  type GameEvent,
  type GeneratedOverworldBattle,
  type GameState,
  type OverworldCoord,
  type OverworldPOI,
  type OverworldTravelState,
  type SettlementRumor,
  type ShopInventory,
  RealmError,
  canCampEarly,
  filterMarketStockForParty,
  generateSettlementRumors,
  generateWildernessBattle,
  getFactionByPoi,
  getPoiAt,
  getReputationDisposition,
  getSettlementHubAccess,
  getTravelDayBudget,
  mixBattleSeed,
  nextRandomFloat,
  planExpedition,
  previewExpedition,
  startOverworldBattle,
} from '@srd5/engine';

import {
  RealmSessionState,
} from './realmSession.js';
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

export function getPartySurvivalBonus(session: RealmSessionState): number {
  let best = 0;
  for (const hero of getPartyList(session)) {
    const bonus = hero.characterSheet?.skills?.survival?.totalBonus ?? 0;
    if (bonus > best) best = bonus;
  }
  return best;
}

export function requirePoiAtParty(session: RealmSessionState, poiId: string): OverworldPOI {
  const poi = session.map.pois[poiId];
  if (!poi) throw new RealmError(`Unknown location "${poiId}"`);
  if (poi.q !== session.travel.partyPosition.q || poi.r !== session.travel.partyPosition.r) {
    throw new RealmError(`Travel to ${poi.name} first`);
  }
  return poi;
}

export function getTradeReputation(session: RealmSessionState, poi: OverworldPOI): number {
  const faction = getFactionByPoi(session.map, poi.id);
  return faction?.relationshipWithParty ?? 0;
}

export function assertTradeAllowed(session: RealmSessionState, poi: OverworldPOI): void {
  const reputation = getTradeReputation(session, poi);
  if (getReputationDisposition(reputation) === 'hostile') {
    const faction = getFactionByPoi(session.map, poi.id);
    throw new RealmError(
      `${faction?.name ?? 'The locals'} refuse to trade with your party (hostile reputation)`,
    );
  }
}

export function requireSettlementAtParty(session: RealmSessionState, poiId: string): OverworldPOI {
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

export function startBattleFromSession(
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
export function rollWildernessEncounter(
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
