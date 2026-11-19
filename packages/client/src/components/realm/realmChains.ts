/** Realm quest-chain helpers: advance, expiry and POI-visit progression (SRD-809). */

import {
  type ChainAdvanceResult,
  adjustFactionReputation,
  advanceChainsForClearedPoi,
  advanceChainsForVisit,
  expireQuestChains,
  getPoiAt,
} from '@srd5/engine';

import {
  type RealmSessionEvent,
  type RealmSessionState,
} from './realmSession.js';

/** Applies a chain advance: swaps in the next log, pays out completion gold, and shifts faction reputation (both ways). */
export function applyChainAdvance(
  next: RealmSessionState,
  events: RealmSessionEvent[],
  advance: ChainAdvanceResult,
): void {
  next.chainLog = advance.log;
  const applyReputation = (factionId: string, delta: number): void => {
    if (!next.map.factions[factionId]) return;
    const change = adjustFactionReputation(next.map, factionId, delta);
    next.map = change.map;
    events.push({
      type: 'REPUTATION_CHANGED',
      factionId,
      previous: change.previous,
      value: change.reputation,
      tier: change.tier,
    });
  };
  for (const effect of advance.reputationEffects) {
    applyReputation(effect.factionId, effect.delta);
  }
  for (const completion of advance.chainCompletions) {
    next.travel = { ...next.travel, gold: next.travel.gold + completion.rewardGold };
    for (const effect of completion.reputationEffects) {
      applyReputation(effect.factionId, effect.delta);
    }
  }
  events.push(...advance.events);
}

/** Fails timed chain offers past their expiry for the current day. */
export function expireChainsForDay(next: RealmSessionState, events: RealmSessionEvent[]): void {
  const expired = expireQuestChains(next.chainLog, next.travel.currentDay);
  if (expired.events.length > 0) {
    next.chainLog = expired.log;
    events.push(...expired.events);
  }
}

/** Advances talk/turn-in chain stages for the POI the party stands on. */
export function progressChainsForCurrentPoi(next: RealmSessionState, events: RealmSessionEvent[]): void {
  const poi = getPoiAt(next.map, next.travel.partyPosition);
  if (!poi) return;
  const advanced = advanceChainsForVisit(
    next.chainLog,
    poi.id,
    next.travel.currentDay,
    next.clearedPoiIds,
  );
  applyChainAdvance(next, events, advanced);
}

/** Advances combat chain stages for a freshly cleared POI (battle/delve/shrine). */
export function progressChainsForClearedPoi(
  next: RealmSessionState,
  events: RealmSessionEvent[],
  poiId: string,
): void {
  const advanced = advanceChainsForClearedPoi(
    next.chainLog,
    poiId,
    next.travel.currentDay,
    next.clearedPoiIds,
  );
  applyChainAdvance(next, events, advanced);
}
