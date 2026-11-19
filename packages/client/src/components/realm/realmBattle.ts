/** Tactical battle resolution: commits a victorious overworld battle back into the Realm session (SRD-804/1105). */
import {
  type CharacterBuildState,
  type SrdCompendium,
  defaultCompendium,
} from '@srd5/data';
import {
  type GeneratedOverworldBattle,
  type GameState,
  buildStarterQuestChains,
  completeQuestForParty,
  createQuestChainLog,
  createWarDiplomacyState,
  resolveOverworldBattle,
} from '@srd5/engine';

import {
  RealmSessionEvent,
  RealmSessionState,
} from './realmSession.js';
import {
  applyWarMissionCompletion,
} from './realmWar.js';
import {
  progressChainsForClearedPoi,
} from './realmChains.js';
export function clearEquippedReferences(
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
  if (!next.chainLog) {
    next.chainLog = createQuestChainLog(buildStarterQuestChains(next.map));
  }
  if (!next.diplomacy) {
    next.diplomacy = createWarDiplomacyState();
  }

  next.party = structuredClone(resolution.nextState.party);
  next.travel = { ...next.travel, gold: next.travel.gold + resolution.goldAwarded };

  const completedQuestIds: string[] = [];
  // War-mission and patrol skirmishes resolve through the war campaign
  // completion path instead of the POI-clearance path (SRD-1105).
  if (next.pendingWarBattle && next.activeWarMission) {
    const missionId = next.activeWarMission.mission.id;
    const poiId = next.activeWarMission.poiId;
    applyWarMissionCompletion(next, events, true);
    events.push({ type: 'WAR_MISSION_COMPLETED', missionId, poiId, victory: true });
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
  if (next.pendingWarBattle) {
    // Standalone patrol skirmish: heat already recorded at interception time.
    const pending = next.pendingWarBattle;
    next.pendingWarBattle = null;
    events.push({
      type: 'REALM_BATTLE_RESOLVED',
      battleId: battle.battleId,
      totalXp: resolution.totalXp,
      goldAwarded: resolution.goldAwarded,
      completedQuestIds,
    });
    events.push({ type: 'REALM_LOG', message: `🏆 Patrol scattered near ${pending.poiName}` });
    return {
      session: next,
      events,
      totalXp: resolution.totalXp,
      goldAwarded: resolution.goldAwarded,
      completedQuestIds,
    };
  }
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

    // Advance bounty / escort / fetch chain stages pointing at this POI.
    progressChainsForClearedPoi(next, events, battle.poiId);
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
