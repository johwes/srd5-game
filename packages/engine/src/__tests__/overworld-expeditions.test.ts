import { describe, expect, it } from 'vitest';
import { defaultCompendium, getPregenCharacter } from '@srd5/data';
import {
  type Combatant,
  type OverworldCoord,
  type OverworldMap,
  type OverworldTravelState,
  OverworldTravelStateSchema,
  canCampEarly,
  campOverworld,
  computeDerivedCharacter,
  createCharacterCombatant,
  createOverworldTravelState,
  forceExpeditionMarch,
  generateOverworldMap,
  getDailyTravelPoints,
  getOverworldTile,
  getTravelDayBudget,
  marchExpeditionLeg,
  planExpedition,
  previewExpedition,
  stepOverworldTravel,
  OverworldTravelError,
} from '../index.js';

/**
 * SRD-807: Expedition travel — multi-day journey batching, cost preview,
 * forced march (RPG party-scale), and early daylight Short Rests.
 *
 * Acceptance (BACKLOG SRD-807):
 * - Clicking a distant POI/tile shows total cost, days, rations, arrival
 *   phase before committing.
 * - One order queues a multi-day expedition with dawn/dusk camp prompts
 *   (camp short/long, forage yes/no), ambush rolls, and POI-discovery stops.
 * - Forced march trades HD/exhaustion risk for extra points; camping early
 *   allows a safe short rest without burning the day.
 * - 4/6/8 pt economy and ration/ambush/exhaustion rules unchanged.
 */

function smallMap(): OverworldMap {
  const tiles: OverworldMap['tiles'] = {};
  for (let r = 0; r < 3; r++) {
    for (let q = 0; q < 3; q++) {
      tiles[`${q},${r}`] = { q, r, terrain: 'plains', movementCost: 1, elevation: 0.5 };
    }
  }
  return {
    worldSeed: 807,
    worldName: 'Expedition Testrealm',
    width: 3,
    height: 3,
    tiles,
    pois: {},
    factions: {},
  };
}

function landNeighbor(map: OverworldMap, from: OverworldCoord): OverworldCoord {
  for (const d of [
    { q: 1, r: 0 },
    { q: 0, r: 1 },
    { q: -1, r: 0 },
    { q: 0, r: -1 },
  ] as const) {
    const c = { q: from.q + d.q, r: from.r + d.r };
    const tile = getOverworldTile(map, c.q, c.r);
    if (tile && tile.terrain !== 'ocean') return c;
  }
  throw new Error('No land neighbor');
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
    party[combatant.id] = combatant;
  });
  return party;
}

function livingCount(party: Record<string, Combatant>): number {
  return Object.values(party).filter((c) => !c.isDead && c.currentHp > 0).length;
}

describe('SRD-807: Expedition travel (multi-day batching, preview, forced march, early camp)', () => {
  describe('Route planning', () => {
    it('plans a contiguous orthogonal route to a reachable destination', () => {
      const map = smallMap();
      const state = createOverworldTravelState(map, { initialWeather: 'clear', weatherEnabled: false });
      const path = planExpedition(map, state.partyPosition, { q: 2, r: 2 });
      expect(path.length).toBeGreaterThan(0);
      expect(path.at(-1)).toEqual({ q: 2, r: 2 });
      let prev = state.partyPosition;
      for (const step of path) {
        expect(Math.abs(step.q - prev.q) + Math.abs(step.r - prev.r)).toBe(1);
        prev = step;
      }
    });

    it('rejects unreachable ocean destinations', () => {
      const map = smallMap();
      map.tiles['2,2'] = { q: 2, r: 2, terrain: 'ocean', movementCost: 99, elevation: 0.1 };
      const state = createOverworldTravelState(map, { weatherEnabled: false });
      expect(() => planExpedition(map, state.partyPosition, { q: 2, r: 2 })).toThrow(
        OverworldTravelError,
      );
    });
  });

  describe('Cost preview (pre-commit estimate)', () => {
    it('reports total cost, days, rations and arrival phase for a nearby tile', () => {
      const map = smallMap();
      const state = createOverworldTravelState(map, { initialWeather: 'clear', weatherEnabled: false });
      const party = makeParty();
      const preview = previewExpedition(state, map, { q: 2, r: 0 }, livingCount(party));
      expect(preview.path.at(-1)).toEqual({ q: 2, r: 0 });
      expect(preview.points).toBeGreaterThan(0);
      expect(preview.days).toBe(1);
      expect(preview.rations).toBe(0); // same-day arrival burns no overnight rations
      expect(preview.arrivalDay).toBe(1);
      expect(['dawn', 'noon', 'dusk', 'night']).toContain(preview.arrivalPhase);
    });

    it('never samples or exposes future RNG (bit-exact, rngState untouched)', () => {
      const map = smallMap();
      const state = createOverworldTravelState(map, { seed: 807, initialWeather: 'clear' });
      const party = makeParty();
      const before = state.rngState;
      const a = previewExpedition(state, map, { q: 2, r: 2 }, livingCount(party));
      const b = previewExpedition(state, map, { q: 2, r: 2 }, livingCount(party));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(a.rations).toBeGreaterThanOrEqual(0);
      // Preview is a pure estimate: caller state RNG is never consumed.
      expect(state.rngState).toBe(before);
    });

    it('estimates multi-day rations for a long journey at Normal pace', () => {
      const { map } = generateOverworldMap({ seed: 807, width: 48, height: 48 });
      const state = createOverworldTravelState(map, { seed: 807, pace: 'normal', weatherEnabled: false });
      const party = makeParty();
      // Pick a far reachable tile: walk the first long path found.
      let destination: OverworldCoord | null = null;
      outer: for (let q = 0; q < map.width; q += 7) {
        for (let r = 0; r < map.height; r += 7) {
          if (q === state.partyPosition.q && r === state.partyPosition.r) continue;
          try {
            planExpedition(map, state.partyPosition, { q, r });
            destination = { q, r };
            break outer;
          } catch {
            continue;
          }
        }
      }
      expect(destination).not.toBeNull();
      const preview = previewExpedition(state, map, destination!, livingCount(party));
      expect(preview.days).toBeGreaterThanOrEqual(1);
      // Overnight Long Rests in the wild cost 1 ration per living member (4 heroes).
      expect(preview.rations).toBe((preview.days - 1) * 4);
      expect(preview.arrivalDay).toBe(state.currentDay + preview.days - 1);
      expect(OverworldTravelStateSchema.safeParse(state).success).toBe(true);
    });

    it('preserves the 4/6/8 pt economy across paces', () => {
      expect(getDailyTravelPoints('slow')).toBe(4);
      expect(getDailyTravelPoints('normal')).toBe(6);
      expect(getDailyTravelPoints('fast')).toBe(8);
      const map = smallMap();
      for (const pace of ['slow', 'normal', 'fast'] as const) {
        const state = createOverworldTravelState(map, { pace, weatherEnabled: false, initialWeather: 'clear' });
        expect(state.travelPointsRemaining).toBe(getDailyTravelPoints(pace));
        expect(getTravelDayBudget(state)).toBe(getDailyTravelPoints(pace));
      }
    });

    it('throws a helpful error when the route needs a faster pace or better weather', () => {
      const map = smallMap();
      // Make every tile a mountain so a Slow party cannot afford a single step in a storm.
      for (const tile of Object.values(map.tiles)) {
        tile.terrain = 'mountains';
        tile.movementCost = 3;
      }
      const state = createOverworldTravelState(map, {
        pace: 'slow',
        weatherEnabled: false,
        initialWeather: 'storm',
      });
      const party = makeParty();
      expect(() =>
        previewExpedition(state, map, { q: 2, r: 2 }, livingCount(party)),
      ).toThrow(/faster pace or better weather/);
    });
  });

  describe('Expedition leg marching (dusk + POI stops)', () => {
    it('marches a queued route up to dusk, then prompts camp', () => {
      const map = smallMap();
      const state = createOverworldTravelState(map, {
        pace: 'slow', // 4 pts: dusk falls after 2 plains steps
        weatherEnabled: false,
        initialWeather: 'clear',
      });
      const path = planExpedition(map, state.partyPosition, { q: 2, r: 2 });
      expect(path.length).toBe(4);
      const leg = marchExpeditionLeg(state, map, path, []);
      // Auto-march halts on reaching dusk so the party can camp (or force march).
      expect(leg.steps).toBe(2);
      expect(leg.state.partyPosition).toEqual(path[1]);
      expect(leg.state.timeOfDay).toBe('dusk');
      expect(leg.discovery).toBeUndefined();
      expect(leg.events.some((e) => e.type === 'TRAVEL_STEP')).toBe(true);
      expect(leg.events.some((e) => e.type === 'TIME_OF_DAY_CHANGED')).toBe(true);
    });

    it('stops at dusk and resumes after camp', () => {
      const map = smallMap();
      const slow = createOverworldTravelState(map, {
        pace: 'slow',
        weatherEnabled: false,
        initialWeather: 'clear',
      });
      const path = planExpedition(map, slow.partyPosition, { q: 2, r: 2 });
      const leg = marchExpeditionLeg(slow, map, path, []);
      expect(leg.steps).toBe(2);
      expect(leg.state.timeOfDay).toBe('dusk');
      // Camp overnight, then the remaining steps are marchable again at dawn.
      const camped = campOverworld(leg.state, map, makeParty(), { restType: 'long' });
      expect(camped.state.timeOfDay).toBe('dawn');
      const resume = marchExpeditionLeg(camped.state, map, path.slice(leg.steps), []);
      expect(resume.steps).toBe(2);
      expect(resume.state.partyPosition).toEqual({ q: 2, r: 2 });
    });

    it('halts at a newly discovered POI so the party can react', () => {
      const map = smallMap();
      const state = createOverworldTravelState(map, { weatherEnabled: false, initialWeather: 'clear' });
      const path = planExpedition(map, state.partyPosition, { q: 2, r: 2 });
      expect(path.length).toBeGreaterThan(1);
      // Plant an unknown POI on the second step of the planned route.
      const poiTile = path[1]!;
      map.pois['dungeon_1'] = {
        id: 'dungeon_1',
        name: 'Old Barrow',
        kind: 'dungeon_entrance',
        q: poiTile.q,
        r: poiTile.r,
        dungeonSeed: 7,
        depthTier: 2,
      };
      map.tiles[`${poiTile.q},${poiTile.r}`]!.poiId = 'dungeon_1';
      const leg = marchExpeditionLeg(state, map, path, []);
      expect(leg.discovery).toBe('dungeon_1');
      expect(leg.state.partyPosition).toEqual(poiTile);
      expect(leg.steps).toBe(2);
      // Known POIs do not halt the march (Normal pace marches to dusk: 3 steps).
      const resume = marchExpeditionLeg(state, map, path, ['dungeon_1']);
      expect(resume.discovery).toBeUndefined();
      expect(resume.steps).toBe(3);
      expect(resume.state.timeOfDay).toBe('dusk');
    });

    it('is deterministic for a fixed seed', () => {
      const run = () => {
        const { map } = generateOverworldMap({ seed: 807, width: 48, height: 48 });
        const state = createOverworldTravelState(map, { seed: 807 });
        const dest = landNeighbor(map, state.partyPosition);
        const path = planExpedition(map, state.partyPosition, dest);
        return JSON.stringify(marchExpeditionLeg(state, map, path, []));
      };
      expect(run()).toBe(run());
    });
  });

  describe('Forced march (party-scale, HD/exhaustion cost)', () => {
    it('grants +2 movement points by spending one Hit Die per living hero', () => {
      const map = smallMap();
      const state = createOverworldTravelState(map, { weatherEnabled: false });
      const party = makeParty();
      const before = state.travelPointsRemaining;
      const result = forceExpeditionMarch(state, party);
      expect(result.state.travelPointsRemaining).toBe(before + 2);
      expect(result.state.forcedMarchDay).toBe(state.currentDay);
      expect(result.event).toMatchObject({ type: 'FORCED_MARCH', points: 2 });
      // Every living hero spends exactly one HD and gains no healing here.
      const spent = Object.values(result.party).filter((h) => !h.isDead);
      expect(spent).toHaveLength(4);
      for (const hero of spent) {
        const pools = hero.characterSheet?.hitDicePools ?? [];
        const totalSpent = pools.reduce((s, p) => s + p.spent, 0);
        expect(totalSpent).toBe(1);
      }
      expect(OverworldTravelStateSchema.safeParse(result.state).success).toBe(true);
      // Inputs not mutated.
      expect(state.forcedMarchDay).toBeUndefined();
    });

    it('applies exhaustion when a hero has no Hit Dice left', () => {
      const map = smallMap();
      const state = createOverworldTravelState(map, { weatherEnabled: false });
      const party = makeParty();
      for (const hero of Object.values(party)) {
        for (const pool of hero.characterSheet?.hitDicePools ?? []) {
          pool.spent = pool.total;
          pool.available = 0;
        }
      }
      const result = forceExpeditionMarch(state, party);
      expect(result.event.type).toBe('FORCED_MARCH');
      if (result.event.type === 'FORCED_MARCH') {
        expect(result.event.exhausted).toHaveLength(4);
        expect(result.event.spentHitDice).toHaveLength(0);
      }
      for (const hero of Object.values(result.party)) {
        expect(hero.conditions).toContain('exhaustion');
        expect(hero.exhaustionLevel).toBe(1);
      }
    });

    it('skips the dead and is limited to once per day', () => {
      const map = smallMap();
      const state = createOverworldTravelState(map, { weatherEnabled: false });
      const party = makeParty();
      const deadId = Object.keys(party)[0]!;
      party[deadId]!.isDead = true;
      party[deadId]!.currentHp = 0;
      const result = forceExpeditionMarch(state, party);
      expect(Object.keys(result.party)).toHaveLength(4);
      expect(() => forceExpeditionMarch(result.state, result.party)).toThrow(
        /already forced a march/,
      );
      // A new day resets the once-per-day limit.
      const nextDay: OverworldTravelState = { ...result.state, currentDay: result.state.currentDay + 1 };
      expect(() => forceExpeditionMarch(nextDay, result.party)).not.toThrow();
    });

    it('lets the party march after dusk when forced', () => {
      const map = smallMap();
      // March a Normal party to dusk (3 pts spent of 6), then force for +2.
      let state = createOverworldTravelState(map, { weatherEnabled: false, initialWeather: 'clear' });
      state = stepOverworldTravel(state, map, { q: 1, r: 0 }).state;
      state = stepOverworldTravel(state, map, { q: 2, r: 0 }).state;
      state = stepOverworldTravel(state, map, { q: 2, r: 1 }).state;
      expect(state.timeOfDay).toBe('dusk');
      expect(state.travelPointsRemaining).toBe(3);
      const forced = forceExpeditionMarch(state, makeParty());
      expect(forced.state.travelPointsRemaining).toBe(5);
      expect(getTravelDayBudget(forced.state)).toBe(8);
      const leg = marchExpeditionLeg(forced.state, map, [{ q: 2, r: 2 }], []);
      expect(leg.steps).toBe(1);
    });
  });

  describe('Early daylight Short Rest (safe, no day advance)', () => {
    it('is available once per day before dusk only', () => {
      const map = smallMap();
      const dawn = createOverworldTravelState(map, { weatherEnabled: false });
      expect(canCampEarly(dawn)).toBe(true);
      const noon = stepOverworldTravel(dawn, map, { q: 1, r: 0 }).state;
      expect(noon.timeOfDay).toBe('dawn'); // 1 of 6 spent stays dawn
      expect(canCampEarly(noon)).toBe(true);
      // March to dusk: no longer eligible.
      let dusk = noon;
      dusk = stepOverworldTravel(dusk, map, { q: 2, r: 0 }).state;
      dusk = stepOverworldTravel(dusk, map, { q: 2, r: 1 }).state;
      expect(dusk.timeOfDay).toBe('dusk');
      expect(canCampEarly(dusk)).toBe(false);
    });

    it('heals via hit dice without consuming rations or advancing the day', () => {
      const map = smallMap();
      const state = createOverworldTravelState(map, { weatherEnabled: false });
      const party = makeParty();
      for (const hero of Object.values(party)) {
        hero.currentHp = 1;
        if (hero.characterSheet) hero.characterSheet.currentHp = 1;
      }
      const spend: Record<string, number> = {};
      for (const id of Object.keys(party)) spend[id] = 1;
      const result = campOverworld(state, map, party, { restType: 'short', early: true, hitDiceToSpend: spend });
      expect(result.safe).toBe(true);
      expect(result.starved).toBe(false);
      expect(result.state.currentDay).toBe(state.currentDay); // day NOT burned
      expect(result.state.timeOfDay).toBe(state.timeOfDay);
      expect(result.state.travelPointsRemaining).toBe(state.travelPointsRemaining);
      expect(result.state.rations).toBe(state.rations);
      expect(result.state.earlyCampDay).toBe(state.currentDay);
      const healed = Object.values(result.hpRecovered).reduce((a, b) => a + b, 0);
      expect(healed).toBeGreaterThan(0);
      // Second early rest the same day is rejected.
      expect(() =>
        campOverworld(result.state, map, result.party, { restType: 'short', early: true }),
      ).toThrow(/once per day/);
    });

    it('rejects early Long Rests and early rests after dusk', () => {
      const map = smallMap();
      const state = createOverworldTravelState(map, { weatherEnabled: false });
      expect(() =>
        campOverworld(state, map, makeParty(), { restType: 'long', early: true }),
      ).toThrow(/Short Rest/);
      let dusk = state;
      dusk = stepOverworldTravel(dusk, map, { q: 1, r: 0 }).state;
      dusk = stepOverworldTravel(dusk, map, { q: 2, r: 0 }).state;
      dusk = stepOverworldTravel(dusk, map, { q: 2, r: 1 }).state;
      expect(dusk.timeOfDay).toBe('dusk');
      expect(() =>
        campOverworld(dusk, map, makeParty(), { restType: 'short', early: true }),
      ).toThrow(/before dusk/);
    });
  });

  describe('Full expedition loop determinism', () => {
    it('replays preview + leg + forced march + early camp bit-exactly', () => {
      const run = () => {
        const { map } = generateOverworldMap({ seed: 807, width: 48, height: 48 });
        let state = createOverworldTravelState(map, { seed: 807 });
        const party = makeParty();
        const dest = landNeighbor(map, state.partyPosition);
        const preview = previewExpedition(state, map, dest, 4);
        const path = planExpedition(map, state.partyPosition, dest);
        const leg = marchExpeditionLeg(state, map, path, []);
        state = leg.state;
        const forced = forceExpeditionMarch(state, party);
        state = forced.state;
        const camp = campOverworld(state, map, forced.party, { restType: 'short', early: true });
        return JSON.stringify({ preview, leg: leg.state, forced: forced.state, camp: camp.state });
      };
      expect(run()).toBe(run());
    });
  });
});
