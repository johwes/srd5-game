import {
  type OverworldCoord,
  type OverworldMap,
  type OverworldPOIKind,
  type OverworldTerrainType,
  type OverworldTravelConfig,
  type OverworldTravelConfigInput,
  type OverworldTravelState,
  type TimeOfDay,
  type TravelPace,
  type WeatherType,
  OVERWORLD_EDGE_DIRECTIONS,
  OverworldTravelConfigSchema,
  OverworldTravelStateSchema,
  TRAVEL_PACE_PROFILES,
  WEATHER_PROFILES,
  getOverworldTile,
  overworldTileKey,
} from './schemas.js';
import { findOverworldPath } from './generator.js';
import { normalizeSeed, nextRandomFloat, rollDie } from '../dice/prng.js';
import { type Combatant } from '../combat/types.js';
import { applyConditionToCombatant } from '../combat/conditions.js';
import {
  applyArcaneRecoveryForHero,
  getPartySongOfRestDie,
  restoreCombatantAfterLongRest,
  spendHitDiceForHero,
} from '../dungeon/rest.js';
import { rechargeHeroCharges } from '../dungeon/use-item.js';
import { defaultCompendium } from '@srd5/data';

/**
 * Overworld Party Travel loop (SRD-802, Spec 06 Section 4.1 & 4.3).
 *
 * Layers a deterministic daily movement / weather / foraging / camping cycle
 * over the static `OverworldMap` produced by SRD-801. Long and Short Rests
 * reuse the SRD-504 restoration helpers; starvation follows the same ration
 * rules as the Deep Descent run loop (1 ration per living party member).
 *
 * Architectural invariant: every random choice threads `rngState` through the
 * seeded Mulberry32 PRNG. `Math.random()` is never called.
 */

/** Roads halve the movement cost of a tile. */
export const ROAD_TRAVEL_MULTIPLIER = 0.5;
/** Moving after dark is slower (and hazards are harder to spot). */
export const NIGHT_TRAVEL_MULTIPLIER = 1.25;
/** Foraging occupies a slice of the day's movement budget. */
export const FORAGE_POINT_COST = 1;
export const FORCED_MARCH_POINTS = 2;

export class OverworldTravelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OverworldTravelError';
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type OverworldTravelEvent =
  | {
      type: 'TRAVEL_STEP';
      from: OverworldCoord;
      to: OverworldCoord;
      movementPointsSpent: number;
      timeOfDay: TimeOfDay;
    }
  | {
      type: 'TRAVEL_COMPLETED';
      destination: OverworldCoord;
      arrived: boolean;
      reason: 'arrived' | 'out_of_points';
    }
  | { type: 'TIME_OF_DAY_CHANGED'; from: TimeOfDay; to: TimeOfDay; day: number }
  | { type: 'DAY_ADVANCED'; day: number; weather: WeatherType }
  | { type: 'WEATHER_CHANGED'; weather: WeatherType; day: number }
  | {
      type: 'FORAGE_RESULT';
      success: boolean;
      roll: number;
      total: number;
      dc: number;
      rationsFound: number;
    }
  | {
      type: 'CAMP_REST';
      restType: 'short' | 'long';
      safe: boolean;
      starved: boolean;
      rationsConsumed: number;
    }
  | { type: 'STARVATION'; characterId: string; exhaustionLevel: number }
  | { type: 'FORCED_MARCH'; points: number; spentHitDice: string[]; exhausted: string[] }
  | { type: 'POI_DISCOVERED'; poiId: string; kind: OverworldPOIKind; name: string };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Movement points refreshed at dawn for a travel pace. */
export function getDailyTravelPoints(pace: TravelPace): number {
  return TRAVEL_PACE_PROFILES[pace].movementPointsPerDay;
}

/** Miles represented by a single movement point at a given pace. */
export function getMilesPerPoint(pace: TravelPace): number {
  const profile = TRAVEL_PACE_PROFILES[pace];
  return profile.milesPerDay / profile.movementPointsPerDay;
}

/** Movement point cost of entering a tile under current weather/time conditions. */
export function getMovementPointCost(
  tile: { movementCost: number; roadThrough?: boolean },
  weather: WeatherType,
  timeOfDay: TimeOfDay,
): number {
  let cost = tile.movementCost;
  if (tile.roadThrough) cost *= ROAD_TRAVEL_MULTIPLIER;
  cost *= WEATHER_PROFILES[weather].travelMultiplier;
  if (timeOfDay === 'night') cost *= NIGHT_TRAVEL_MULTIPLIER;
  return round2(cost);
}

/** Derives the current day phase from the fraction of the daily budget spent. */
export function getTimeOfDayFromProgress(pace: TravelPace, pointsRemaining: number): TimeOfDay {
  const budget = getDailyTravelPoints(pace);
  const elapsed = (budget - pointsRemaining) / budget;
  if (elapsed >= 0.75) return 'night';
  if (elapsed >= 0.5) return 'dusk';
  if (elapsed >= 0.25) return 'noon';
  return 'dawn';
}

export function getTravelDayBudget(state: OverworldTravelState): number {
  return getDailyTravelPoints(state.travelPace) +
    (state.forcedMarchDay === state.currentDay ? FORCED_MARCH_POINTS : 0);
}

function phaseAfterSpending(state: OverworldTravelState, remaining: number): TimeOfDay {
  const bonus = getTravelDayBudget(state) - getDailyTravelPoints(state.travelPace);
  const phase = getTimeOfDayFromProgress(state.travelPace, remaining - bonus);
  const phases: TimeOfDay[] = ['dawn', 'noon', 'dusk', 'night'];
  return phases.indexOf(phase) > phases.indexOf(state.timeOfDay) ? phase : state.timeOfDay;
}

/** Survival (Forage) DC for a terrain type. Impassable ocean can never be foraged. */
export function getForagingDc(terrain: OverworldTerrainType): number {
  switch (terrain) {
    case 'plains':
    case 'forest':
      return 10;
    case 'coast':
    case 'hills':
    case 'swamp':
      return 12;
    case 'mountains':
    case 'tundra':
      return 14;
    case 'desert':
      return 15;
    case 'ocean':
      return 99;
  }
}

/** Weather base weights, biased per terrain by `TERRAIN_WEATHER_BIAS`. */
export const WEATHER_BASE_WEIGHTS: Record<WeatherType, number> = {
  clear: 30,
  cloudy: 22,
  rain: 15,
  storm: 6,
  snow: 6,
  fog: 9,
  heatwave: 12,
};

export const TERRAIN_WEATHER_BIAS: Partial<
  Record<OverworldTerrainType, Partial<Record<WeatherType, number>>>
> = {
  desert: { heatwave: 30, rain: -10, snow: -6, clear: 10 },
  tundra: { snow: 26, heatwave: -12, clear: -8 },
  mountains: { snow: 18, storm: 10, clear: -8 },
  swamp: { rain: 12, fog: 14, clear: -8 },
  coast: { rain: 8, fog: 8, storm: 4 },
  forest: { rain: 6, fog: 4 },
};

/**
 * Rolls deterministic daily weather from the seeded PRNG, biased by the
 * terrain the party occupies. Every path consumes exactly one PRNG step.
 */
export function rollDailyWeather(
  rngState: number,
  terrain?: OverworldTerrainType,
): { weather: WeatherType; nextRng: number } {
  let state = normalizeSeed(rngState);
  const draw = nextRandomFloat(state);
  state = draw.nextState;

  const weights = { ...WEATHER_BASE_WEIGHTS };
  if (terrain) {
    const bias = TERRAIN_WEATHER_BIAS[terrain];
    if (bias) {
      for (const key of Object.keys(bias) as WeatherType[]) {
        weights[key] = Math.max(0, weights[key] + (bias[key] ?? 0));
      }
    }
  }

  const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
  let threshold = draw.value * total;
  for (const weather of Object.keys(weights) as WeatherType[]) {
    threshold -= weights[weather];
    if (threshold < 0) return { weather, nextRng: state };
  }
  return { weather: 'clear', nextRng: state };
}

/** True when two coordinates share an orthogonal edge. */
function areOrthogonallyAdjacent(a: OverworldCoord, b: OverworldCoord): boolean {
  return Math.abs(a.q - b.q) + Math.abs(a.r - b.r) === 1;
}

function isSameCoord(a: OverworldCoord, b: OverworldCoord): boolean {
  return a.q === b.q && a.r === b.r;
}

/** Finds a POI located on a given tile, if any. */
export function getPoiAt(map: OverworldMap, coord: OverworldCoord) {
  const tile = getOverworldTile(map, coord.q, coord.r);
  if (!tile?.poiId) return undefined;
  return map.pois[tile.poiId];
}

/** True when the tile hosts a settlement with an inn (safe, free Long Rest). */
export function isSafeRestSite(map: OverworldMap, coord: OverworldCoord): boolean {
  const poi = getPoiAt(map, coord);
  if (!poi) return false;
  if (!['capital', 'town', 'village'].includes(poi.kind)) return false;
  return poi.services?.includes('inn') === true;
}

// ---------------------------------------------------------------------------
// State creation
// ---------------------------------------------------------------------------

/**
 * Initializes a travel session on top of a generated world map (SRD-802).
 * Defaults to a Normal pace, 10 rations, the map seed for RNG, and a start at
 * the first settlement land tile (falling back to the first walkable tile).
 */
export function createOverworldTravelState(
  map: OverworldMap,
  rawConfig: OverworldTravelConfigInput = {},
): OverworldTravelState {
  const config: OverworldTravelConfig = OverworldTravelConfigSchema.parse(rawConfig);
  let rngState = normalizeSeed(config.seed ?? map.worldSeed);

  const settlementCoord = Object.values(map.pois)
    .filter((poi) => ['capital', 'town', 'village'].includes(poi.kind))
    .map((poi) => ({ q: poi.q, r: poi.r }))
    .sort((a, b) => a.q - b.q || a.r - b.r)[0];
  const firstLand = Object.values(map.tiles)
    .filter((tile) => tile.terrain !== 'ocean')
    .sort((a, b) => a.q - b.q || a.r - b.r)[0];
  const start = config.start ?? settlementCoord ?? firstLand;
  if (!start) {
    throw new OverworldTravelError('World map has no walkable starting tile');
  }
  const startTile = getOverworldTile(map, start.q, start.r);
  if (!startTile || startTile.terrain === 'ocean') {
    throw new OverworldTravelError(`Starting tile (${start.q},${start.r}) is not walkable`);
  }

  // Always consume one RNG step for the initial weather so replay is stable
  // even when a caller overrides the weather.
  const rolled = rollDailyWeather(rngState, startTile.terrain);
  rngState = rolled.nextRng;
  const weather = config.weatherEnabled ? (config.initialWeather ?? rolled.weather) : (config.initialWeather ?? 'clear');

  return OverworldTravelStateSchema.parse({
    worldSeed: map.worldSeed,
    worldName: map.worldName,
    currentDay: 1,
    timeOfDay: 'dawn',
    weather,
    partyPosition: { q: start.q, r: start.r },
    travelPace: config.pace,
    travelPointsRemaining: getDailyTravelPoints(config.pace),
    rations: config.startingRations,
    gold: config.startingGold,
    milesTraveled: 0,
    foragedRations: 0,
    weatherEnabled: config.weatherEnabled,
    rngState,
  });
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

export interface TravelStepResult {
  state: OverworldTravelState;
  from: OverworldCoord;
  to: OverworldCoord;
  movementPointsSpent: number;
  events: OverworldTravelEvent[];
}

/**
 * Moves the party one orthogonal tile. Ocean tiles are impassable and a step
 * that would overspend the remaining daily budget is rejected (the party must
 * camp first). Deterministic and non-mutating.
 */
export function stepOverworldTravel(
  state: OverworldTravelState,
  map: OverworldMap,
  next: OverworldCoord,
): TravelStepResult {
  const from = state.partyPosition;
  if (!areOrthogonallyAdjacent(from, next)) {
    throw new OverworldTravelError(
      `Travel targets must be orthogonally adjacent (from ${from.q},${from.r} to ${next.q},${next.r})`,
    );
  }
  const tile = getOverworldTile(map, next.q, next.r);
  if (!tile) {
    throw new OverworldTravelError(`Tile (${next.q},${next.r}) is outside the world map`);
  }
  if (tile.terrain === 'ocean') {
    throw new OverworldTravelError(`Ocean tiles are impassable (${next.q},${next.r})`);
  }

  const cost = getMovementPointCost(tile, state.weather, state.timeOfDay);
  if (cost > state.travelPointsRemaining + 1e-9) {
    throw new OverworldTravelError(
      `Insufficient travel points (need ${cost}, have ${state.travelPointsRemaining}); camp before continuing`,
    );
  }

  const remaining = round2(Math.max(0, state.travelPointsRemaining - cost));
  const nextTime = phaseAfterSpending(state, remaining);
  const events: OverworldTravelEvent[] = [];

  events.push({
    type: 'TRAVEL_STEP',
    from: { ...from },
    to: { q: next.q, r: next.r },
    movementPointsSpent: cost,
    timeOfDay: nextTime,
  });
  if (nextTime !== state.timeOfDay) {
    events.push({
      type: 'TIME_OF_DAY_CHANGED',
      from: state.timeOfDay,
      to: nextTime,
      day: state.currentDay,
    });
  }

  const nextState: OverworldTravelState = {
    ...state,
    partyPosition: { q: next.q, r: next.r },
    travelPointsRemaining: remaining,
    timeOfDay: nextTime,
    milesTraveled: round2(state.milesTraveled + cost * getMilesPerPoint(state.travelPace)),
  };

  const poi = getPoiAt(map, next);
  if (poi) {
    events.push({ type: 'POI_DISCOVERED', poiId: poi.id, kind: poi.kind, name: poi.name });
  }

  return { state: nextState, from: { ...from }, to: { q: next.q, r: next.r }, movementPointsSpent: cost, events };
}

export interface OverworldTravelResult {
  state: OverworldTravelState;
  /** Coordinates actually entered, in order. */
  traversed: OverworldCoord[];
  arrived: boolean;
  reason: 'arrived' | 'out_of_points';
  path: OverworldCoord[];
  events: OverworldTravelEvent[];
}

/**
 * Follows the cheapest overland route toward `destination` until the party
 * arrives or runs out of the day's movement points. Does not advance the day
 * (camping does that) — callers camp at night to refresh the budget.
 */
export function travelAlongPath(
  state: OverworldTravelState,
  map: OverworldMap,
  destination: OverworldCoord,
): OverworldTravelResult {
  const route = findOverworldPath(map, state.partyPosition, destination);
  if (!route) {
    throw new OverworldTravelError(
      `No overland route from (${state.partyPosition.q},${state.partyPosition.r}) to (${destination.q},${destination.r})`,
    );
  }

  let current = state;
  const events: OverworldTravelEvent[] = [];
  const traversed: OverworldCoord[] = [];
  let reason: 'arrived' | 'out_of_points' = 'arrived';

  for (let i = 1; i < route.path.length; i++) {
    const stepTarget = route.path[i];
    const projectedCost = getMovementPointCost(
      getOverworldTile(map, stepTarget.q, stepTarget.r)!,
      current.weather,
      current.timeOfDay,
    );
    if (projectedCost > current.travelPointsRemaining + 1e-9) {
      reason = 'out_of_points';
      break;
    }
    const step = stepOverworldTravel(current, map, stepTarget);
    current = step.state;
    traversed.push(step.to);
    events.push(...step.events);
  }

  const arrived = isSameCoord(current.partyPosition, destination);
  if (arrived) reason = 'arrived';
  events.push({
    type: 'TRAVEL_COMPLETED',
    destination: { ...destination },
    arrived,
    reason,
  });

  return { state: current, traversed, arrived, reason, path: route.path, events };
}

// ---------------------------------------------------------------------------
// Foraging
// ---------------------------------------------------------------------------

export interface ForageOptions {
  /** Bonus from Survival proficiency / guide features (default 0). */
  survivalBonus?: number;
  /**
   * SRD-1213: Nature standing-passive bonus rations (Spec 11 §3.4 —
   * proficient/expert foragers yield +1). Added to a successful forage;
   * compute via `getPartyNatureForageBonus(party)` and pass in.
   */
  natureBonusRations?: number;
}

export interface ForageResult {
  state: OverworldTravelState;
  success: boolean;
  roll: number;
  total: number;
  dc: number;
  rationsFound: number;
  events: OverworldTravelEvent[];
}

/**
 * Forages for rations using a Survival (1d20 + modifiers) check. Terrain sets
 * the DC; pace and weather modify the roll. Consumes one movement point.
 */
export function forageForRations(
  state: OverworldTravelState,
  map: OverworldMap,
  options: ForageOptions = {},
): ForageResult {
  if (state.travelPointsRemaining + 1e-9 < FORAGE_POINT_COST) {
    throw new OverworldTravelError('Not enough travel points remaining to forage; camp first');
  }
  const tile = getOverworldTile(map, state.partyPosition.q, state.partyPosition.r);
  if (!tile || tile.terrain === 'ocean') {
    throw new OverworldTravelError('Cannot forage on ocean tiles');
  }

  const dc = getForagingDc(tile.terrain);
  const modifier =
    (options.survivalBonus ?? 0) +
    TRAVEL_PACE_PROFILES[state.travelPace].foragingModifier +
    WEATHER_PROFILES[state.weather].foragingModifier;

  let rngState = normalizeSeed(state.rngState);
  const rollResult = rollDie(rngState, 20);
  rngState = rollResult.nextState;
  const total = rollResult.roll + modifier;
  const success = total >= dc;

  let rationsFound = 0;
  if (success) {
    const yieldResult = rollDie(rngState, 4);
    rngState = yieldResult.nextState;
    rationsFound = yieldResult.roll;
    if (total >= dc + 5) rationsFound += 1; // exceptional success
    // SRD-1213: Nature standing passive — proficient/expert foragers yield +1.
    rationsFound += Math.max(0, Math.floor(options.natureBonusRations ?? 0));
  }

  const remaining = round2(Math.max(0, state.travelPointsRemaining - FORAGE_POINT_COST));
  const nextTime = phaseAfterSpending(state, remaining);
  const events: OverworldTravelEvent[] = [
    {
      type: 'FORAGE_RESULT',
      success,
      roll: rollResult.roll,
      total,
      dc,
      rationsFound,
    },
  ];
  if (nextTime !== state.timeOfDay) {
    events.push({
      type: 'TIME_OF_DAY_CHANGED',
      from: state.timeOfDay,
      to: nextTime,
      day: state.currentDay,
    });
  }

  const nextState: OverworldTravelState = {
    ...state,
    travelPointsRemaining: remaining,
    timeOfDay: nextTime,
    rations: state.rations + rationsFound,
    foragedRations: state.foragedRations + rationsFound,
    rngState,
  };
  return { state: nextState, success, roll: rollResult.roll, total, dc, rationsFound, events };
}

// ---------------------------------------------------------------------------
// Camping / rests
// ---------------------------------------------------------------------------

export interface CampOptions {
  restType: 'short' | 'long';
  /** Per-character hit dice to spend on a Short Rest. */
  hitDiceToSpend?: Record<string, number | Record<number, number>>;
  arcaneRecovery?: Record<string, number[]>;
  /** Treat the campsite as secure (no ambush / starvation), e.g. a guarded grove. */
  forceSafe?: boolean;
  /** Secure daylight Short Rest without rolling the calendar forward. */
  early?: boolean;
}

export function canCampEarly(state: OverworldTravelState): boolean {
  return (state.timeOfDay === 'dawn' || state.timeOfDay === 'noon') &&
    state.earlyCampDay !== state.currentDay;
}

export interface CampResult {
  state: OverworldTravelState;
  party: Record<string, Combatant>;
  safe: boolean;
  starved: boolean;
  rationsConsumed: number;
  hpRecovered: Record<string, number>;
  events: OverworldTravelEvent[];
}

/**
 * Camp for the night: resolves a Short or Long Rest on the party, then rolls
 * the calendar forward to dawn with a fresh movement budget and new weather.
 *
 * Long Rests at a settlement with an inn are free and safe (Spec 06 §4.3).
 * Wilderness Long Rests consume one ration per living member; if supplies are
 * insufficient the party does not recover and instead gains exhaustion
 * (matching the Deep Descent starvation rule in Spec 06 §3.2).
 */
export function campOverworld(
  state: OverworldTravelState,
  map: OverworldMap,
  party: Record<string, Combatant>,
  options: CampOptions,
): CampResult {
  if (options.early && (options.restType !== 'short' || !canCampEarly(state))) {
    throw new OverworldTravelError('An early Short Rest is available once per day before dusk');
  }
  const nextParty: Record<string, Combatant> = structuredClone(party);
  const events: OverworldTravelEvent[] = [];
  let rngState = normalizeSeed(state.rngState);
  let rations = state.rations;
  let starved = false;
  let rationsConsumed = 0;
  const hpRecovered: Record<string, number> = {};
  const safe = isSafeRestSite(map, state.partyPosition) || options.forceSafe === true || options.early === true;

  if (options.restType === 'short') {
    const songDie = getPartySongOfRestDie(nextParty);
    for (const [heroId, hero] of Object.entries(nextParty)) {
      if (hero.isDead) continue;
      const request = options.hitDiceToSpend?.[heroId] ?? 0;
      const spend = spendHitDiceForHero(hero, request, rngState);
      rngState = spend.nextRng;
      let regained = spend.hpRegained;
      if (regained > 0 && songDie !== null) {
        const song = rollDie(rngState, songDie);
        rngState = song.nextState;
        const songHeal = Math.min(song.roll, hero.maxHp - hero.currentHp);
        hero.currentHp += songHeal;
        if (hero.characterSheet) hero.characterSheet.currentHp = hero.currentHp;
        regained += songHeal;
      }
      const arcane = options.arcaneRecovery?.[heroId];
      if (arcane && arcane.length > 0) applyArcaneRecoveryForHero(hero, arcane);
      if (regained > 0) hpRecovered[heroId] = regained;
    }
  } else {
    const living = Object.values(nextParty).filter((c) => !c.isDead && c.currentHp > 0);
    const required = Math.max(1, living.length);

    if (safe || rations >= required) {
      if (!safe) {
        rationsConsumed = required;
        rations -= required;
      }
      for (const [heroId, hero] of Object.entries(nextParty)) {
        const restored = restoreCombatantAfterLongRest(hero);
        if (restored.hpRecovered > 0) hpRecovered[heroId] = restored.hpRecovered;
        // SRD-1303: dawn recharge for wands/staffs while camping.
        if (hero.buildState) {
          const recharge = rechargeHeroCharges(hero.buildState.inventory, defaultCompendium, rngState);
          rngState = recharge.nextRng;
          if (recharge.inventory !== hero.buildState.inventory) {
            hero.buildState = { ...hero.buildState, inventory: recharge.inventory };
          }
        }
      }
    } else {
      // Starvation: no recovery; every living member gains a level of exhaustion.
      starved = true;
      rationsConsumed = rations;
      rations = 0;
      for (const hero of living) {
        const result = applyConditionToCombatant(hero, 'exhaustion', {
          exhaustionLevelChange: 1,
          sourceName: 'Wilderness starvation',
        });
        nextParty[hero.id] = result.combatant;
        events.push({
          type: 'STARVATION',
          characterId: hero.id,
          exhaustionLevel: result.combatant.exhaustionLevel ?? 1,
        });
      }
    }
  }

  events.push({
    type: 'CAMP_REST',
    restType: options.restType,
    safe,
    starved,
    rationsConsumed,
  });

  if (options.early) {
    return {
      state: { ...state, earlyCampDay: state.currentDay, rngState },
      party: nextParty, safe, starved, rationsConsumed, hpRecovered, events,
    };
  }

  // Roll over to the next dawn: refill the budget and reroll weather.
  const nextDay = state.currentDay + 1;
  const nextTile = getOverworldTile(map, state.partyPosition.q, state.partyPosition.r);
  const weatherRoll = state.weatherEnabled
    ? rollDailyWeather(rngState, nextTile?.terrain)
    : { weather: state.weather, nextRng: rngState };
  rngState = weatherRoll.nextRng;
  events.push({ type: 'DAY_ADVANCED', day: nextDay, weather: weatherRoll.weather });
  if (weatherRoll.weather !== state.weather) {
    events.push({ type: 'WEATHER_CHANGED', weather: weatherRoll.weather, day: nextDay });
  }

  const nextState: OverworldTravelState = {
    ...state,
    currentDay: nextDay,
    timeOfDay: 'dawn',
    weather: weatherRoll.weather,
    travelPointsRemaining: getDailyTravelPoints(state.travelPace),
    rations,
    rngState,
  };

  return {
    state: nextState,
    party: nextParty,
    safe,
    starved,
    rationsConsumed,
    hpRecovered,
    events,
  };
}
