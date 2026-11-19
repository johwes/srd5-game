/** Dungeon-delver resolution: commits a POI delve back into the Realm session (SRD-806). */
import {
  type SrdCompendium,
  defaultCompendium,
} from '@srd5/data';
import {
  type GameState,
  type RealmDelveState,
  buildStarterQuestChains,
  completeQuestForParty,
  createQuestChainLog,
} from '@srd5/engine';

import {
  RealmSessionEvent,
  RealmSessionState,
} from './realmSession.js';
import {
  progressChainsForClearedPoi,
} from './realmChains.js';
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
  if (!next.chainLog) {
    next.chainLog = createQuestChainLog(buildStarterQuestChains(next.map));
  }

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

    // Advance dungeon / fetch chain stages pointing at this delve.
    progressChainsForClearedPoi(next, events, delve.poiId);
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
