import { applyConditionToCombatant } from '../combat/conditions.js';
import type { Combatant } from '../combat/types.js';
import { findOverworldPath } from './generator.js';
import { getOverworldTile, type OverworldCoord, type OverworldMap, type OverworldTravelState } from './schemas.js';
import {
  FORCED_MARCH_POINTS,
  OverworldTravelError,
  getDailyTravelPoints,
  getMovementPointCost,
  isSafeRestSite,
  stepOverworldTravel,
  type OverworldTravelEvent,
} from './travel.js';

export function planExpedition(map: OverworldMap, from: OverworldCoord, destination: OverworldCoord) {
  const route = findOverworldPath(map, from, destination);
  if (!route) throw new OverworldTravelError(`No overland route to (${destination.q}, ${destination.r})`);
  return route.path.slice(1);
}

function canMarch(state: OverworldTravelState, map: OverworldMap, target: OverworldCoord): boolean {
  if ((state.timeOfDay === 'dusk' || state.timeOfDay === 'night') &&
    state.forcedMarchDay !== state.currentDay) return false;
  const tile = getOverworldTile(map, target.q, target.r)!;
  return getMovementPointCost(tile, state.weather, state.timeOfDay) <= state.travelPointsRemaining + 1e-9;
}

/** Follow the queued route up to dusk, an unaffordable step, or a new POI. */
export function marchExpeditionLeg(
  state: OverworldTravelState,
  map: OverworldMap,
  remainingPath: OverworldCoord[],
  knownPoiIds: readonly string[],
) {
  const events: OverworldTravelEvent[] = [];
  let steps = 0;
  let discovery: string | undefined;
  while (steps < remainingPath.length && canMarch(state, map, remainingPath[steps])) {
    const step = stepOverworldTravel(state, map, remainingPath[steps++]);
    state = step.state;
    for (const event of step.events) {
      if (event.type === 'POI_DISCOVERED') {
        if (knownPoiIds.includes(event.poiId)) continue;
        discovery = event.poiId;
      }
      events.push(event);
    }
    if (discovery) break;
  }
  return { state, steps, discovery, events };
}

/** Estimate with overnight Long Rests, no forage or interruptions, and clear
 * weather after today if weather can change. Never samples or exposes future RNG. */
export function previewExpedition(
  state: OverworldTravelState,
  map: OverworldMap,
  destination: OverworldCoord,
  livingCount: number,
) {
  const path = planExpedition(map, state.partyPosition, destination);
  const departureDay = state.currentDay;
  const dailyPoints = getDailyTravelPoints(state.travelPace);
  let points = 0;
  let rations = 0;
  for (const target of path) {
    if (!canMarch(state, map, target)) {
      if (!isSafeRestSite(map, state.partyPosition)) rations += Math.max(1, livingCount);
      state = {
        ...state, currentDay: state.currentDay + 1, timeOfDay: 'dawn',
        weather: state.weatherEnabled ? 'clear' : state.weather, travelPointsRemaining: dailyPoints,
      };
      if (!canMarch(state, map, target)) {
        throw new OverworldTravelError('This route needs a faster pace or better weather');
      }
    }
    const step = stepOverworldTravel(state, map, target);
    state = step.state;
    points += step.movementPointsSpent;
  }
  return {
    path, points: Math.round(points * 100) / 100, days: state.currentDay - departureDay + 1,
    rations, arrivalDay: state.currentDay, arrivalPhase: state.timeOfDay,
  };
}

/** Each living hero spends one Hit Die without healing, or gains exhaustion. */
export function forceExpeditionMarch(state: OverworldTravelState, party: Record<string, Combatant>) {
  if (state.forcedMarchDay === state.currentDay) {
    throw new OverworldTravelError('The party has already forced a march today');
  }
  const nextParty = structuredClone(party);
  const spentHitDice: string[] = [];
  const exhausted: string[] = [];
  for (const [id, hero] of Object.entries(nextParty)) {
    if (hero.isDead || hero.currentHp <= 0) continue;
    const pool = hero.characterSheet?.hitDicePools
      .filter((die) => die.available > 0).sort((a, b) => b.dieSize - a.dieSize)[0];
    if (pool) {
      pool.spent += 1;
      pool.available -= 1;
      spentHitDice.push(hero.name);
    } else {
      nextParty[id] = applyConditionToCombatant(hero, 'exhaustion', {
        exhaustionLevelChange: 1, sourceName: 'Forced march',
      }).combatant;
      exhausted.push(hero.name);
    }
  }
  const event: OverworldTravelEvent = { type: 'FORCED_MARCH', points: FORCED_MARCH_POINTS, spentHitDice, exhausted };
  return {
    state: {
      ...state, forcedMarchDay: state.currentDay,
      travelPointsRemaining: state.travelPointsRemaining + FORCED_MARCH_POINTS,
    },
    party: nextParty, event,
  };
}
