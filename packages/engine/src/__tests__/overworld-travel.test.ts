import { describe, expect, it } from 'vitest';
import { defaultCompendium, getPregenCharacter } from '@srd5/data';
import {
  type Combatant,
  type OverworldMap,
  type OverworldTerrainType,
  type OverworldTravelState,
  OverworldTravelStateSchema,
  TRAVEL_PACE_PROFILES,
  computeDerivedCharacter,
  createCharacterCombatant,
  createOverworldTravelState,
  forageForRations,
  getDailyTravelPoints,
  getForagingDc,
  getMilesPerPoint,
  getOverworldTile,
  getMovementPointCost,
  getTimeOfDayFromProgress,
  campOverworld,
  rollDailyWeather,
  stepOverworldTravel,
  travelAlongPath,
  OverworldTravelError,
  generateOverworldMap,
} from '../index.js';

function smallMap(): OverworldMap {
  const tiles: OverworldMap['tiles'] = {};
  for (let r = 0; r < 3; r++) {
    for (let q = 0; q < 3; q++) {
      tiles[`${q},${r}`] = { q, r, terrain: 'plains', movementCost: 1, elevation: 0.5 };
    }
  }
  return {
    worldSeed: 1234,
    worldName: 'Testrealm',
    width: 3,
    height: 3,
    tiles,
    pois: {},
    factions: {},
  };
}

function nearestReachable(map: OverworldMap, from: { q: number; r: number }) {
  for (const dir of [
    { q: 1, r: 0 },
    { q: 0, r: 1 },
    { q: -1, r: 0 },
    { q: 0, r: -1 },
  ]) {
    const coord = { q: from.q + dir.q, r: from.r + dir.r };
    if (getOverworldTile(map, coord.q, coord.r)?.terrain !== 'ocean' &&
        getOverworldTile(map, coord.q, coord.r) !== undefined) {
      return coord;
    }
  }
  return from;
}

function makeParty(): Record<string, Combatant> {
  const party: Record<string, Combatant> = {};
  const ids = ['pregen-fighter', 'pregen-cleric', 'pregen-rogue', 'pregen-wizard'];
  ids.forEach((id, idx) => {
    const build = getPregenCharacter(id)!;
    const sheet = computeDerivedCharacter(build, defaultCompendium);
    const combatant = createCharacterCombatant(sheet, { x: idx, y: 0 }, {
      side: 'party',
      teamId: 'party',
    });
    combatant.currentHp = 1;
    if (combatant.characterSheet) combatant.characterSheet.currentHp = 1;
    party[combatant.id] = combatant;
  });
  return party;
}

describe('SRD-802: Overworld Party Travel loop (Spec 06 Section 4.1 / 4.3)', () => {
  describe('State Creation & Schema', () => {
    it('creates a valid Normal-pace starting state with canonical defaults', () => {
      const map = smallMap();
      const state = createOverworldTravelState(map);
      expect(OverworldTravelStateSchema.safeParse(state).success).toBe(true);
      expect(state.currentDay).toBe(1);
      expect(state.timeOfDay).toBe('dawn');
      expect(state.travelPace).toBe('normal');
      expect(state.travelPointsRemaining).toBe(6);
      expect(state.rations).toBe(10);
      expect(state.gold).toBe(0);
      expect(state.milesTraveled).toBe(0);
      expect(state.worldSeed).toBe(map.worldSeed);
      expect(state.partyPosition).toEqual({ q: 0, r: 0 });
    });

    it('honors config overrides and rejects an ocean start', () => {
      const map = smallMap();
      const state = createOverworldTravelState(map, {
        seed: 99,
        start: { q: 2, r: 1 },
        pace: 'fast',
        startingRations: 3,
        startingGold: 50,
        initialWeather: 'clear',
        weatherEnabled: false,
      });
      expect(state.partyPosition).toEqual({ q: 2, r: 1 });
      expect(state.travelPace).toBe('fast');
      expect(state.travelPointsRemaining).toBe(8);
      expect(state.rations).toBe(3);
      expect(state.gold).toBe(50);
      expect(state.weather).toBe('clear');
      expect(state.weatherEnabled).toBe(false);

      map.tiles['1,1'] = { q: 1, r: 1, terrain: 'ocean', movementCost: 99, elevation: 0.1 };
      expect(() => createOverworldTravelState(map, { start: { q: 1, r: 1 } })).toThrow(
        OverworldTravelError,
      );
    });

    it('starts on walkable land of a generated world', () => {
      const { map } = generateOverworldMap({ seed: 4321, width: 48, height: 48 });
      const state = createOverworldTravelState(map, { seed: 4321 });
      const tile = map.tiles[`${state.partyPosition.q},${state.partyPosition.r}`];
      expect(tile).toBeDefined();
      expect(tile.terrain).not.toBe('ocean');
    });
  });

  describe('Travel Pace, Movement Cost & Day Phases', () => {
    it('uses canonical 5e miles/day and movement budgets per pace', () => {
      expect(TRAVEL_PACE_PROFILES.slow.milesPerDay).toBe(18);
      expect(TRAVEL_PACE_PROFILES.normal.milesPerDay).toBe(24);
      expect(TRAVEL_PACE_PROFILES.fast.milesPerDay).toBe(30);
      expect(getDailyTravelPoints('slow')).toBe(4);
      expect(getDailyTravelPoints('normal')).toBe(6);
      expect(getDailyTravelPoints('fast')).toBe(8);
      expect(getMilesPerPoint('normal')).toBe(4);
      expect(TRAVEL_PACE_PROFILES.fast.detectionModifier).toBe(-5);
      expect(TRAVEL_PACE_PROFILES.slow.foragingModifier).toBe(2);
    });

    it('applies road, weather and night multipliers to movement cost', () => {
      const plains = { movementCost: 1 };
      expect(getMovementPointCost(plains, 'clear', 'dawn')).toBe(1);
      expect(getMovementPointCost({ movementCost: 2 }, 'clear', 'dawn')).toBe(2);
      expect(getMovementPointCost({ ...plains, roadThrough: true }, 'clear', 'dawn')).toBe(0.5);
      expect(getMovementPointCost(plains, 'storm', 'dawn')).toBe(1.5);
      expect(getMovementPointCost(plains, 'clear', 'night')).toBe(1.25);
      expect(getMovementPointCost(plains, 'snow', 'night')).toBe(1.88);
    });

    it('advances dawn -> noon -> dusk -> night as the daily budget is spent', () => {
      expect(getTimeOfDayFromProgress('normal', 6)).toBe('dawn');
      expect(getTimeOfDayFromProgress('normal', 4.5)).toBe('noon');
      expect(getTimeOfDayFromProgress('normal', 3)).toBe('dusk');
      expect(getTimeOfDayFromProgress('normal', 1.5)).toBe('night');
    });

    it('steps one orthogonal land tile, deducting points without mutating state', () => {
      const map = smallMap();
      const state = createOverworldTravelState(map, { initialWeather: 'clear', weatherEnabled: false });
      const before = JSON.stringify(state);
      const result = stepOverworldTravel(state, map, { q: 1, r: 0 });
      expect(result.movementPointsSpent).toBe(1);
      expect(result.state.partyPosition).toEqual({ q: 1, r: 0 });
      expect(result.state.travelPointsRemaining).toBe(5);
      expect(result.state.milesTraveled).toBe(4);
      expect(JSON.stringify(state)).toBe(before);
      expect(result.events[0]).toMatchObject({ type: 'TRAVEL_STEP' });
    });

    it('rejects non-adjacent, ocean and budget-overspending steps', () => {
      const map = smallMap();
      const state = createOverworldTravelState(map);
      expect(() => stepOverworldTravel(state, map, { q: 2, r: 2 })).toThrow(OverworldTravelError);
      map.tiles['1,0'] = { q: 1, r: 0, terrain: 'ocean', movementCost: 99, elevation: 0.1 };
      expect(() => stepOverworldTravel(state, map, { q: 1, r: 0 })).toThrow(/Ocean tiles/);
      const broke = { ...state, travelPointsRemaining: 0.5 };
      expect(() => stepOverworldTravel(broke, map, { q: 0, r: 1 })).toThrow(/Insufficient travel points/);
    });

    it('discovers a POI when stepping onto its tile', () => {
      const map = smallMap();
      map.pois['dungeon_1'] = {
        id: 'dungeon_1',
        name: 'Old Barrow',
        kind: 'dungeon_entrance',
        q: 1,
        r: 0,
        dungeonSeed: 7,
        depthTier: 2,
      };
      map.tiles['1,0'].poiId = 'dungeon_1';
      const state = createOverworldTravelState(map);
      const result = stepOverworldTravel(state, map, { q: 1, r: 0 });
      expect(result.events).toContainEqual({
        type: 'POI_DISCOVERED',
        poiId: 'dungeon_1',
        kind: 'dungeon_entrance',
        name: 'Old Barrow',
      });
    });
  });

  describe('Route Travel', () => {
    it('travels the full path when the daily budget allows', () => {
      const map = smallMap();
      const state = createOverworldTravelState(map, { initialWeather: 'clear', weatherEnabled: false });
      const result = travelAlongPath(state, map, { q: 2, r: 2 });
      expect(result.arrived).toBe(true);
      expect(result.reason).toBe('arrived');
      expect(result.traversed).toHaveLength(4);
      expect(result.state.partyPosition).toEqual({ q: 2, r: 2 });
      expect(result.state.travelPointsRemaining).toBe(2);
      expect(result.events.at(-1)).toMatchObject({ type: 'TRAVEL_COMPLETED', arrived: true });
    });

    it('stops at the daily budget limit and reports out_of_points', () => {
      const map = smallMap();
      const state = createOverworldTravelState(map, {
        pace: 'slow',
        initialWeather: 'clear',
        weatherEnabled: false,
      });
      const result = travelAlongPath(state, map, { q: 2, r: 2 });
      expect(result.arrived).toBe(false);
      expect(result.reason).toBe('out_of_points');
      expect(result.traversed).toHaveLength(3);
      expect(result.state.timeOfDay).toBe('night');
      expect(result.state.travelPointsRemaining).toBe(1);
      expect(result.events.at(-1)).toMatchObject({ type: 'TRAVEL_COMPLETED', arrived: false });
    });

    it('rejects unreachable ocean destinations', () => {
      const map = smallMap();
      map.tiles['2,2'] = { q: 2, r: 2, terrain: 'ocean', movementCost: 99, elevation: 0.1 };
      const state = createOverworldTravelState(map);
      expect(() => travelAlongPath(state, map, { q: 2, r: 2 })).toThrow(/No overland route/);
    });
  });

  describe('Deterministic Weather', () => {
    it('replays exactly and differs across seeds', () => {
      expect(rollDailyWeather(12345, 'plains')).toEqual(rollDailyWeather(12345, 'plains'));
      const a = rollDailyWeather(1, 'plains').weather;
      let differs = false;
      for (const seed of [2, 3, 4, 5, 6]) {
        if (rollDailyWeather(seed, 'plains').weather !== a) differs = true;
      }
      expect(differs).toBe(true);
    });

    it('biases weather by terrain (tundra snow, desert heat)', () => {
      let tundraSnow = 0;
      let desertSnow = 0;
      let desertHeat = 0;
      let tundraHeat = 0;
      for (let seed = 0; seed < 300; seed++) {
        if (rollDailyWeather(seed, 'tundra').weather === 'snow') tundraSnow++;
        if (rollDailyWeather(seed, 'desert').weather === 'snow') desertSnow++;
        if (rollDailyWeather(seed, 'desert').weather === 'heatwave') desertHeat++;
        if (rollDailyWeather(seed, 'tundra').weather === 'heatwave') tundraHeat++;
      }
      expect(tundraSnow).toBeGreaterThan(desertSnow);
      expect(desertHeat).toBeGreaterThan(tundraHeat);
    });
  });

  describe('Foraging', () => {
    it('uses terrain DC, adds rations on success and consumes a movement point', () => {
      expect(getForagingDc('plains')).toBe(10);
      expect(getForagingDc('desert')).toBe(15);
      expect(getForagingDc('ocean')).toBe(99);
      const map = smallMap();
      const state = createOverworldTravelState(map, { seed: 2026, initialWeather: 'clear' });
      const result = forageForRations(state, map, { survivalBonus: 5 });
      expect(result.total).toBe(result.roll + 5);
      expect(result.dc).toBe(10);
      expect(result.success).toBe(true);
      expect(result.rationsFound).toBeGreaterThan(0);
      expect(result.state.rations).toBe(state.rations + result.rationsFound);
      expect(result.state.foragedRations).toBe(result.rationsFound);
      expect(result.state.travelPointsRemaining).toBe(state.travelPointsRemaining - 1);
      expect(result.state.rngState).not.toBe(state.rngState);
      expect(result.events).toContainEqual({
        type: 'FORAGE_RESULT',
        success: true,
        roll: result.roll,
        total: result.total,
        dc: 10,
        rationsFound: result.rationsFound,
      });
    });

    it('yields nothing on a failed check and requires points to forage', () => {
      const map = smallMap();
      const state = createOverworldTravelState(map, { seed: 77, initialWeather: 'storm' });
      const result = forageForRations(state, map, { survivalBonus: -10 });
      expect(result.success).toBe(false);
      expect(result.rationsFound).toBe(0);
      expect(result.state.rations).toBe(state.rations);
      expect(() =>
        forageForRations({ ...state, travelPointsRemaining: 0 }, map),
      ).toThrow(/Not enough travel points/);
    });
  });

  describe('Camping & Rests', () => {
    it('long rests safely for free at a settlement inn and rolls to next dawn', () => {
      const map = smallMap();
      map.pois['town_1'] = {
        id: 'town_1',
        name: 'Haven',
        kind: 'town',
        q: 0,
        r: 0,
        services: ['inn'],
      };
      map.tiles['0,0'].poiId = 'town_1';
      const state = createOverworldTravelState(map, { weatherEnabled: false, initialWeather: 'clear' });
      const party = makeParty();
      const result = campOverworld(state, map, party, { restType: 'long' });
      expect(result.safe).toBe(true);
      expect(result.starved).toBe(false);
      expect(result.rationsConsumed).toBe(0);
      expect(result.state.rations).toBe(state.rations);
      for (const hero of Object.values(result.party)) {
        expect(hero.currentHp).toBe(hero.maxHp);
      }
      expect(result.state.currentDay).toBe(2);
      expect(result.state.timeOfDay).toBe('dawn');
      expect(result.state.travelPointsRemaining).toBe(6);
      expect(result.events).toContainEqual({ type: 'DAY_ADVANCED', day: 2, weather: 'clear' });
      expect(party[Object.keys(party)[0]].currentHp).toBe(1); // inputs not mutated
    });

    it('wilderness long rest consumes one ration per living member and restores HP', () => {
      const map = smallMap();
      const state = createOverworldTravelState(map, { startingRations: 10, weatherEnabled: false });
      const party = makeParty();
      const result = campOverworld(state, map, party, { restType: 'long' });
      expect(result.safe).toBe(false);
      expect(result.starved).toBe(false);
      expect(result.rationsConsumed).toBe(4);
      expect(result.state.rations).toBe(6);
      for (const hero of Object.values(result.party)) {
        expect(hero.currentHp).toBe(hero.maxHp);
      }
    });

    it('starvation on short rations grants exhaustion instead of recovery', () => {
      const map = smallMap();
      const state = createOverworldTravelState(map, { startingRations: 2, weatherEnabled: false });
      const party = makeParty();
      const result = campOverworld(state, map, party, { restType: 'long' });
      expect(result.starved).toBe(true);
      expect(result.rationsConsumed).toBe(2);
      expect(result.state.rations).toBe(0);
      for (const hero of Object.values(result.party)) {
        expect(hero.currentHp).toBe(1); // no recovery
        expect(hero.exhaustionLevel).toBe(1);
        expect(hero.conditions).toContain('exhaustion');
      }
      expect(result.events.filter((e) => e.type === 'STARVATION')).toHaveLength(4);
    });

    it('short rest spends hit dice and heals without consuming rations', () => {
      const map = smallMap();
      const state = createOverworldTravelState(map, { weatherEnabled: false });
      const party = makeParty();
      const hitDiceToSpend: Record<string, number> = {};
      for (const id of Object.keys(party)) hitDiceToSpend[id] = 1;
      const result = campOverworld(state, map, party, { restType: 'short', hitDiceToSpend });
      expect(result.starved).toBe(false);
      expect(result.state.rations).toBe(state.rations);
      const totalHealed = Object.values(result.hpRecovered).reduce((a, b) => a + b, 0);
      expect(totalHealed).toBeGreaterThan(0);
      expect(result.state.currentDay).toBe(2);
    });

    it('honors forceSafe and keeps weather fixed when disabled', () => {
      const map = smallMap();
      const state = createOverworldTravelState(map, { startingRations: 0, weatherEnabled: false, initialWeather: 'fog' });
      const result = campOverworld(state, map, makeParty(), { restType: 'long', forceSafe: true });
      expect(result.safe).toBe(true);
      expect(result.starved).toBe(false);
      expect(result.state.weather).toBe('fog');
      expect(result.state.currentDay).toBe(2);
    });
  });

  describe('Full Loop Determinism', () => {
    it('replays travel, foraging and camping bit-exactly for the same seed', () => {
      const run = () => {
        const { map } = generateOverworldMap({ seed: 5150, width: 48, height: 48 });
        let state = createOverworldTravelState(map, { seed: 5150, pace: 'normal' });
        let party = makeParty();
        state = forageForRations(state, map, { survivalBonus: 2 }).state;
        state = travelAlongPath(state, map, nearestReachable(map, state.partyPosition)).state;
        const camp = campOverworld(state, map, party, { restType: 'long' });
        state = camp.state;
        party = camp.party;
        return JSON.stringify({ state, party });
      };
      expect(run()).toBe(run());
    });

    it('all emitted states pass Zod validation throughout a multi-day loop', () => {
      const { map } = generateOverworldMap({ seed: 8080, width: 48, height: 48 });
      let state: OverworldTravelState = createOverworldTravelState(map, { seed: 8080 });
      let party = makeParty();
      for (let day = 0; day < 3; day++) {
        expect(OverworldTravelStateSchema.safeParse(state).success).toBe(true);
        state = travelAlongPath(state, map, nearestReachable(map, state.partyPosition)).state;
        state = forageForRations(state, map).state;
        const camp = campOverworld(state, map, party, { restType: 'long' });
        state = camp.state;
        party = camp.party;
      }
      expect(state.currentDay).toBe(4);
      expect(OverworldTravelStateSchema.safeParse(state).success).toBe(true);
    });
  });
});
