import {
  type SrdCompendium,
  defaultCompendium,
} from '@srd5/data';
import {
  type GameState,
  type OverworldTravelState,
  type WarMission,
  RealmError,
  abandonQuestChain,
  acceptQuest,
  acceptSettlementRumor,
  activateOverworldShrine,
  blessPartyWithTemple,
  buildMissionApproaches,
  buildStarterQuestChains,
  campOverworld,
  chooseChainBranch,
  cleansePartyAffliction,
  createQuestChainLog,
  createWarDiplomacyState,
  failQuest,
  forceExpeditionMarch,
  forageForRations,
  generateWarMissionBattle,
  getDailyTravelPoints,
  getPoiAt,
  getSettlements,
  getSettlementHubAccess,
  getTempleBlessingCost,
  getTempleCleanseCost,
  hireMercenaryCompany,
  hireThievesGuild,
  identifyMagicItem,
  initializeWarState,
  isPoiEligibleForMission,
  mixBattleSeed,
  negotiateTruce,
  purchaseItem,
  reportPatrolKill,
  resolveMissionApproach,
  resolveOverworldBattle,
  resolvePatrolEncounter,
  sellItem,
  startOverworldBattle,
  startQuestChain,
  startRealmDelve,
  travelAlongPath,
} from '@srd5/engine';

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
 * Implementation lives in focused sibling modules (`realmSession`,
 * `realmBootstrap`, `realmExpeditions`, `realmWar`, `realmChains` is folded
 * into the reducer section below, `realmBattle`, `realmDelve`,
 * `realmDescribe`, `realmPersistence`); this file keeps the `reduceRealm()`
 * command reducer and re-exports the whole Realm API so existing importers
 * (`RealmView`, HUD, modals, tests) keep working unchanged.
 *
 * Every function here is non-mutating and deterministic — RNG is threaded
 * through `OverworldTravelState.rngState`; `Math.random()` is never called.
 */

export * from './realmSession.js';
export * from './realmBootstrap.js';
export * from './realmExpeditions.js';
export * from './realmWar.js';
export * from './realmBattle.js';
export * from './realmDelve.js';
export * from './realmDescribe.js';
export * from './realmPersistence.js';
export * from './realmChains.js';

import {
  clearEquippedReferences,
} from './realmBattle.js';
import {
  applyChainAdvance,
  expireChainsForDay,
  progressChainsForClearedPoi,
  progressChainsForCurrentPoi,
} from './realmChains.js';
import {
  WILDERNESS_CAMP_AMBUSH_CHANCE,
  WILDERNESS_ENCOUNTER_CHANCE,
} from './realmBootstrap.js';
import {
  assertTradeAllowed,
  getHubRumors,
  getPartyList,
  getPartySurvivalBonus,
  getTradeReputation,
  isSettlementPoi,
  requirePoiAtParty,
  requireSettlementAtParty,
  rollWildernessEncounter,
} from './realmExpeditions.js';
import {
  RealmCommand,
  RealmReduceResult,
  RealmSessionEvent,
  RealmSessionState,
} from './realmSession.js';
import {
  applyWarMissionCompletion,
  getPartyAverageLevel,
  getPartySheets,
  requireWar,
  startWarMissionBattleState,
  syncSheetsToParty,
  syncWarToTravelDay,
} from './realmWar.js';

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
  // Backward compatibility with pre-SRD-809 sessions (no quest chains).
  if (!next.chainLog) {
    next.chainLog = createQuestChainLog(buildStarterQuestChains(next.map));
  }
  // Backward compatibility with pre-SRD-1105 sessions (no war campaign).
  if (next.war === undefined) {
    next.war = null;
  }
  if (!next.diplomacy) {
    next.diplomacy = createWarDiplomacyState();
  }
  if (next.activeWarMission === undefined) {
    next.activeWarMission = null;
  }
  if (next.pendingWarBattle === undefined) {
    next.pendingWarBattle = null;
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
      expireChainsForDay(next, events);
      syncWarToTravelDay(next, events);

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
      progressChainsForCurrentPoi(next, events);
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
      expireChainsForDay(next, events);
      syncWarToTravelDay(next, events);
      progressChainsForCurrentPoi(next, events);
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

    case 'REALM_START_CHAIN': {
      const started = startQuestChain(
        next.chainLog,
        command.chainId,
        next.travel.currentDay,
        next.clearedPoiIds,
      );
      applyChainAdvance(next, events, started);
      // Starting at the offering board can immediately satisfy a `talk` stage.
      progressChainsForCurrentPoi(next, events);
      return { session: next, events };
    }

    case 'REALM_CHOOSE_CHAIN_OPTION': {
      const chosen = chooseChainBranch(
        next.chainLog,
        command.chainId,
        command.optionId,
        next.travel.currentDay,
        next.clearedPoiIds,
      );
      applyChainAdvance(next, events, chosen);
      return { session: next, events };
    }

    case 'REALM_ABANDON_CHAIN': {
      const abandoned = abandonQuestChain(next.chainLog, command.chainId, next.travel.currentDay);
      applyChainAdvance(next, events, abandoned);
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
        // Shrine communion can satisfy `fetch` chain stages pointing here.
        progressChainsForClearedPoi(next, events, poi.id);
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

    case 'SELECT_PLAYER_NATION': {
      if (next.war) {
        throw new RealmError('Your nation has already sworn its banners — the war is joined');
      }
      const founded = initializeWarState(next.map, {
        seed: next.map.worldSeed,
        ...(command.archetypeId ? { playerNationArchetypeId: command.archetypeId } : {}),
      });
      next.war = founded.war;
      next.map = founded.map;
      for (const entry of founded.events) {
        events.push({ type: 'REALM_LOG', message: `⚔️ ${entry.headline}` });
      }
      events.push({
        type: 'WAR_NATION_SELECTED',
        nationId: founded.war.playerNationId,
        nationName: founded.war.nations[founded.war.playerNationId]!.name,
      });
      return { session: next, events };
    }

    case 'ACCEPT_WAR_MISSION': {
      const war = requireWar(next);
      if (next.activeWarMission) {
        throw new RealmError('Finish or abandon the current operation before accepting another');
      }
      const poi = next.map.pois[command.poiId];
      if (!poi) throw new RealmError(`Unknown location "${command.poiId}"`);
      if (!isPoiEligibleForMission(command.missionKind, poi.kind)) {
        throw new RealmError(`${command.missionKind} cannot target ${poi.kind} (${poi.name})`);
      }
      // Default the target nation to the POI holder when it is a rival war
      // nation (so offensive completions drain the right enemy even when the
      // caller does not name one explicitly).
      const holderId = poi.ownerNationId ?? poi.factionId;
      const impliedTarget =
        command.targetNationId ??
        (holderId && holderId !== war.playerNationId && war.nations[holderId]
          ? holderId
          : undefined);
      const mission: WarMission = {
        id: `war_${command.missionKind}_${poi.id}`,
        kind: command.missionKind,
        poiId: poi.id,
        poiKind: poi.kind,
        poiName: poi.name,
        ...(impliedTarget ? { targetNationId: impliedTarget } : {}),
      };
      const approaches = buildMissionApproaches(command.missionKind, poi.kind, {
        seed: mixBattleSeed(next.map.worldSeed, poi.q, poi.r),
      });
      next.activeWarMission = {
        mission,
        poiId: poi.id,
        poiName: poi.name,
        ...(impliedTarget ? { targetNationId: impliedTarget } : {}),
        approaches,
        resolved: null,
        status: 'offered',
      };
      void war;
      events.push({
        type: 'WAR_MISSION_ACCEPTED',
        missionId: mission.id,
        kind: command.missionKind,
        poiId: poi.id,
        poiName: poi.name,
      });
      return { session: next, events };
    }

    case 'RESOLVE_MISSION_APPROACH': {
      const war = requireWar(next);
      const missionState = next.activeWarMission;
      if (!missionState || missionState.status !== 'offered') {
        throw new RealmError('No offered war mission awaiting an approach');
      }
      const sheets = getPartySheets(next);
      if (sheets.length === 0) throw new RealmError('No living heroes to lead the approach');
      const resolved = resolveMissionApproach({
        mission: missionState.mission,
        approachId: command.approachId,
        party: sheets,
        rngState: next.travel.rngState,
        approaches: missionState.approaches,
      });
      next.travel = { ...next.travel, rngState: resolved.nextRngState };
      syncSheetsToParty(next, resolved.updatedParty);
      missionState.resolved = resolved;
      missionState.status = 'approached';
      const bloodless = resolved.outcome === 'bloodless_success';
      events.push({
        type: 'WAR_APPROACH_RESOLVED',
        missionId: missionState.mission.id,
        approachId: resolved.approach.id,
        success: resolved.success,
        bloodless,
        headline: resolved.headline,
      });
      if (bloodless) {
        return { session: next, events };
      }
      // A contested approach escalates to a modified tactical battle with
      // scheduled multi-wave reinforcements (SRD-1102/1105).
      const poiNow = next.map.pois[missionState.poiId];
      const firstRival = war.nationOrder.find((id) => id !== war.playerNationId)!;
      const isOffensive = !['protect_poi', 'cleanse_cursed_mine', 'capture_neutral_mine', 'recover_war_artifact'].includes(
        missionState.mission.kind,
      );
      const targetNation =
        (isOffensive
          ? (missionState.targetNationId ??
            missionState.mission.targetNationId ??
            (poiNow?.ownerNationId as string | undefined) ??
            (poiNow?.factionId as string | undefined))
          : ((poiNow?.contestedByNationId as string | undefined) ??
            (poiNow?.ownerNationId && poiNow.ownerNationId !== war.playerNationId
              ? (poiNow.ownerNationId as string)
              : undefined))) ?? firstRival;
      const generated = generateWarMissionBattle(
        {
          seed: mixBattleSeed(next.map.worldSeed, next.travel.currentDay, missionState.poiId.length),
          missionKind: missionState.mission.kind,
          poi: { id: missionState.poiId, kind: missionState.mission.poiKind },
          party: getPartyList(next),
          partyAverageLevel: getPartyAverageLevel(next),
          nationId: targetNation,
          enemyTeamId: 'war_enemies',
          modifiers: resolved.modifiers,
        },
        compendium,
      );
      const started = startWarMissionBattleState(next, generated, compendium);
      missionState.status = 'battle';
      next.pendingWarBattle = {
        missionId: missionState.mission.id,
        poiId: missionState.poiId,
        poiName: missionState.poiName,
        battle: started.battle,
        waves: generated.waves,
        reinforcementQueue: [...generated.reinforcementQueue],
        modifiers: generated.modifiers,
      };
      events.push({
        type: 'REALM_ENCOUNTER_STARTED',
        battleId: started.battle.battleId,
        origin: 'wilderness',
        poiId: missionState.poiId,
      });
      return {
        session: next,
        events,
        battle: started.battle,
        battleGameState: started.gameState,
        battleEvents: started.events,
      };
    }

    case 'COMPLETE_WAR_MISSION': {
      requireWar(next);
      if (!next.activeWarMission) {
        throw new RealmError('No active war mission to complete');
      }
      const missionId = next.activeWarMission.mission.id;
      const poiId = next.activeWarMission.poiId;
      applyWarMissionCompletion(next, events, command.victory);
      events.push({ type: 'WAR_MISSION_COMPLETED', missionId, poiId, victory: command.victory });
      return { session: next, events };
    }

    case 'RESOLVE_PATROL_ENCOUNTER': {
      requireWar(next);
      const sheets = getPartySheets(next);
      if (sheets.length === 0) throw new RealmError('No living heroes to face the patrol');
      const resolved = resolvePatrolEncounter({
        diplomacy: next.diplomacy,
        war: next.war!,
        party: sheets,
        nationId: command.nationId,
        approach: command.approach,
        rngState: next.travel.rngState,
        goldAvailable: next.travel.gold,
      });
      next.diplomacy = resolved.diplomacy;
      next.travel = {
        ...next.travel,
        rngState: resolved.nextRngState,
        gold: resolved.remainingGold,
      };
      syncSheetsToParty(next, resolved.updatedParty);
      events.push({
        type: 'WAR_PATROL_RESOLVED',
        nationId: command.nationId,
        approach: command.approach,
        headline: resolved.headline,
      });
      if (resolved.outcome === 'passed') {
        return { session: next, events };
      }
      // Steel is drawn: intercept with a Hunter-Killer pursuit squad battle.
      // The default multi-wave defense schedule doubles as the pursuit
      // reinforcement timetable (Spec 10 §7 + §4.2).
      const avgLevel = getPartyAverageLevel(next);
      const generated = generateWarMissionBattle(
        {
          seed: mixBattleSeed(next.map.worldSeed, next.travel.currentDay, command.nationId.length),
          missionKind: 'protect_poi',
          party: getPartyList(next),
          partyAverageLevel: avgLevel,
          nationId: command.nationId,
          enemyTeamId: 'war_enemies',
          modifiers: {},
        },
        compendium,
      );
      const started = startWarMissionBattleState(next, generated, compendium);
      // Patrol fights are standalone skirmishes, not mission battles — but the
      // multi-wave plumbing reuses the same reinforcement schedule.
      next.pendingWarBattle = {
        missionId: `patrol_${command.nationId}_${next.travel.currentDay}`,
        poiId: command.nationId,
        poiName: `Patrol (${command.nationId})`,
        battle: started.battle,
        waves: generated.waves,
        reinforcementQueue: [...generated.reinforcementQueue],
        modifiers: generated.modifiers,
      };
      events.push({
        type: 'REALM_ENCOUNTER_STARTED',
        battleId: started.battle.battleId,
        origin: 'wilderness',
      });
      // Patrol kills raise Threat only once reported; record the kill now so a
      // victorious skirmish heats the territory (SRD-1104 §7).
      const kill = reportPatrolKill({
        diplomacy: next.diplomacy,
        war: next.war!,
        nationId: command.nationId,
        day: next.travel.currentDay,
      });
      next.diplomacy = kill.diplomacy;
      if (kill.war) next.war = kill.war;
      return {
        session: next,
        events,
        battle: started.battle,
        battleGameState: started.gameState,
        battleEvents: started.events,
      };
    }

    case 'NEGOTIATE_TRUCE': {
      const war = requireWar(next);
      const sheets = getPartySheets(next);
      if (sheets.length === 0) throw new RealmError('No living heroes to parley');
      const tribute = command.tributeGold ?? 0;
      if (tribute > next.travel.gold) {
        throw new RealmError(`War chest holds ${next.travel.gold} gp — cannot offer ${tribute} gp tribute`);
      }
      const negotiated = negotiateTruce({
        war,
        party: sheets,
        targetNationId: command.targetNationId,
        rngState: next.travel.rngState,
        day: next.travel.currentDay,
        tributeGold: tribute,
      });
      next.war = negotiated.war;
      next.travel = { ...next.travel, rngState: negotiated.nextRngState, gold: next.travel.gold - negotiated.goldSpent };
      events.push({
        type: 'WAR_TRUCE_NEGOTIATED',
        nationId: command.targetNationId,
        success: negotiated.success,
        headline: negotiated.headline,
      });
      return { session: next, events };
    }

    case 'HIRE_COVERT_ASSET': {
      const war = requireWar(next);
      const sheets = getPartySheets(next);
      if (sheets.length === 0) throw new RealmError('No living heroes to hire blades');
      if (command.asset === 'mercenaries') {
        const hired = hireMercenaryCompany({
          war,
          party: sheets,
          rngState: next.travel.rngState,
          goldAvailable: next.travel.gold,
          day: next.travel.currentDay,
        });
        next.war = hired.war;
        next.travel = { ...next.travel, rngState: hired.nextRngState, gold: hired.remainingGold };
        events.push({
          type: 'WAR_ASSET_HIRED',
          asset: 'mercenaries',
          success: hired.success,
          headline: hired.headline,
        });
        return { session: next, events };
      }
      if (!command.targetPoiId) {
        throw new RealmError('Thieves’ Guild cells need a target supply depot or mine');
      }
      const job = hireThievesGuild({
        war,
        map: next.map,
        party: sheets,
        targetPoiId: command.targetPoiId,
        rngState: next.travel.rngState,
        goldAvailable: next.travel.gold,
        day: next.travel.currentDay,
      });
      next.war = job.war;
      next.map = job.map;
      next.travel = { ...next.travel, rngState: job.nextRngState, gold: job.remainingGold };
      events.push({
        type: 'WAR_ASSET_HIRED',
        asset: 'thieves_guild',
        success: job.success,
        headline: job.headline,
      });
      return { session: next, events };
    }

    default: {
      const exhaustive: never = command;
      throw new RealmError(`Unknown realm command: ${JSON.stringify(exhaustive)}`);
    }
  }
}
