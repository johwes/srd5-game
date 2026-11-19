/** Realm event formatting for the travel log feed. */

import {
  RealmSessionEvent,
} from './realmSession.js';
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
    case 'CHAIN_STARTED':
      return `Quest chain begun: ${event.title}`;
    case 'CHAIN_STAGE_COMPLETED':
      return `Chain stage complete: ${event.title}`;
    case 'CHAIN_CHOICE_MADE':
      return `Chain choice: ${event.label}`;
    case 'CHAIN_COMPLETED':
      return `Quest chain complete: ${event.title} (+${event.goldAwarded} gp, +${event.reputationAwarded} rep)`;
    case 'CHAIN_FAILED':
      return `Quest chain failed: ${event.title} (${event.reason})`;
    case 'CHAIN_UNLOCKED':
      return `New quest chain unlocked: ${event.title}`;
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
    case 'WAR_NATION_SELECTED':
      return `Banners raised for ${event.nationName} — the war for the Realm begins`;
    case 'WAR_MISSION_ACCEPTED':
      return `Special-ops mission accepted: ${event.kind} at ${event.poiName}`;
    case 'WAR_APPROACH_RESOLVED':
      return event.headline;
    case 'WAR_MISSION_COMPLETED':
      return event.victory
        ? `War mission at ${event.poiId} complete — the enemy reels`
        : `War mission at ${event.poiId} failed — the enemy holds the field`;
    case 'WAR_PATROL_RESOLVED':
      return event.headline;
    case 'WAR_TRUCE_NEGOTIATED':
      return event.headline;
    case 'WAR_ASSET_HIRED':
      return event.headline;
    default:
      return '';
  }
}
