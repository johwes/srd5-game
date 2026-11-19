import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultCompendium } from '@srd5/data';
import {
  type Combatant,
  type GameState,
  getDueReinforcementWaves,
  reduceGame,
  spawnWarReinforcements,
} from '@srd5/engine';
import { LocalTransport } from '@srd5/transport';
import {
  getStrategicPoiBadge,
  isStrategicPoiKind,
  OVERWORLD_STRATEGIC_POI_COLORS,
} from '../canvas/layers/OverworldMapLayer.js';
import { getReinforcementWaveNumber } from '../components/realm/RealmBattleView.js';
import {
  createRealmSession,
  describeRealmEvent,
  getPartyList,
  reduceRealm,
  resolveRealmBattle,
  type RealmSessionState,
} from '../components/realm/realmEngine.js';

/**
 * SRD-1105: War Campaign wiring — nation selection, mission Approach flow,
 * multi-wave battle reinforcements, diplomacy, patrols, and strategic POI
 * map badges (Spec 10). Real engine sessions, seeded and deterministic.
 */

const SEED = 1105;

function bootWar(seed = SEED, width = 48, height = 48): RealmSessionState {
  const fresh = createRealmSession({ seed, width, height });
  const result = reduceRealm(fresh, { type: 'SELECT_PLAYER_NATION' });
  expect(result.session.war).not.toBeNull();
  return result.session;
}

function rivalNationId(session: RealmSessionState): string {
  return session.war!.nationOrder.find((id) => id !== session.war!.playerNationId)!;
}

function findEnemyBridge(session: RealmSessionState) {
  const rival = rivalNationId(session);
  const poi = Object.values(session.map.pois).find(
    (p) =>
      p.kind === 'bridge' &&
      p.strategicStatus === 'intact' &&
      (p.ownerNationId ?? p.factionId) === rival,
  );
  if (!poi) throw new Error('No intact rival bridge on the war map');
  return poi;
}

function findPlayerFortress(session: RealmSessionState) {
  const player = session.war!.playerNationId;
  const poi = Object.values(session.map.pois).find(
    (p) =>
      ['fortress', 'mine', 'bridge', 'supply_depot'].includes(p.kind) &&
      p.strategicStatus === 'intact' &&
      (p.ownerNationId ?? p.factionId) === player,
  );
  if (!poi) throw new Error('No intact player stronghold on the war map');
  return poi;
}

/** Forces a tactical victory in a war battle GameState (mirrors SRD-805 tests). */
function forceWarVictory(state: GameState): GameState {
  const ended = structuredClone(state);
  for (const monster of Object.values(ended.monsters)) {
    monster.currentHp = 0;
    monster.isDead = true;
  }
  ended.combat = { ...ended.combat!, phase: 'combat_ended', outcome: 'party_victory' };
  return ended;
}

describe('SRD-1105: War Campaign wiring (Spec 10)', () => {
  let mathRandomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mathRandomSpy = vi.spyOn(Math, 'random');
  });

  afterEach(() => {
    mathRandomSpy.mockRestore();
  });

  describe('SELECT_PLAYER_NATION', () => {
    it('founds a 3–4 nation war with strategic POIs and a chronicle headline', () => {
      const fresh = createRealmSession({ seed: SEED, width: 48, height: 48 });
      expect(fresh.war).toBeNull();
      const result = reduceRealm(fresh, { type: 'SELECT_PLAYER_NATION' });
      const war = result.session.war!;
      expect(war.nationOrder.length).toBeGreaterThanOrEqual(3);
      expect(war.nationOrder.length).toBeLessThanOrEqual(4);
      expect(war.nations[war.playerNationId]).toBeDefined();
      const strategic = Object.values(result.session.map.pois).filter((p) =>
        isStrategicPoiKind(p.kind),
      );
      expect(strategic.length).toBeGreaterThan(0);
      expect(strategic.every((p) => p.strategicStatus === 'intact')).toBe(true);
      expect(result.events.some((e) => e.type === 'WAR_NATION_SELECTED')).toBe(true);
      expect(mathRandomSpy).not.toHaveBeenCalled();
    });

    it('rejects picking a nation once the war is joined', () => {
      const session = bootWar();
      expect(() =>
        reduceRealm(session, { type: 'SELECT_PLAYER_NATION' }),
      ).toThrowError(/already sworn/);
    });
  });

  describe('ACCEPT_WAR_MISSION + RESOLVE_MISSION_APPROACH', () => {
    it('offers POI-specific approaches ending in a mandatory Frontal Assault', () => {
      const session = bootWar();
      const bridge = findEnemyBridge(session);
      const result = reduceRealm(session, {
        type: 'ACCEPT_WAR_MISSION',
        missionKind: 'destroy_bridge',
        poiId: bridge.id,
      });
      const mission = result.session.activeWarMission!;
      expect(mission.mission.kind).toBe('destroy_bridge');
      expect(mission.approaches.length).toBeGreaterThanOrEqual(3);
      expect(mission.approaches.at(-1)!.id).toBe('frontal-assault');
      // Bridges never offer teleport/spell-entry approaches (Spec 10 §5).
      for (const approach of mission.approaches) {
        expect(approach.requiresSpellIds).toEqual([]);
      }
      expect(result.events.some((e) => e.type === 'WAR_MISSION_ACCEPTED')).toBe(true);
    });

    it('rejects missions on ineligible POI kinds', () => {
      const session = bootWar();
      const bridge = findEnemyBridge(session);
      expect(() =>
        reduceRealm(session, {
          type: 'ACCEPT_WAR_MISSION',
          missionKind: 'assassinate_general',
          poiId: bridge.id,
        }),
      ).toThrowError(/cannot target/);
    });

    it('resolves Frontal Assault into a tactical battle with wave reserves', () => {
      const session = bootWar();
      const stronghold = findPlayerFortress(session);
      const accepted = reduceRealm(session, {
        type: 'ACCEPT_WAR_MISSION',
        missionKind: 'protect_poi',
        poiId: stronghold.id,
      });
      const result = reduceRealm(accepted.session, {
        type: 'RESOLVE_MISSION_APPROACH',
        approachId: 'frontal-assault',
      });
      expect(result.events.some((e) => e.type === 'WAR_APPROACH_RESOLVED')).toBe(true);
      expect(result.battle).toBeDefined();
      expect(result.battleGameState).toBeDefined();
      const pending = result.session.pendingWarBattle!;
      expect(pending.waves.length).toBeGreaterThanOrEqual(2);
      expect(pending.reinforcementQueue.length).toBeGreaterThan(0);
      // Wave 1 deploys at round 1; later waves arrive on schedule.
      expect(pending.waves[0]!.deployRound).toBe(1);
      expect(
        pending.reinforcementQueue.every(
          (c) => result.battleGameState!.combat!.combatants[c.id] === undefined,
        ),
      ).toBe(true);
      expect(mathRandomSpy).not.toHaveBeenCalled();
    });

    it('requires an offered mission before resolving an approach', () => {
      const session = bootWar();
      expect(() =>
        reduceRealm(session, { type: 'RESOLVE_MISSION_APPROACH', approachId: 'frontal-assault' }),
      ).toThrowError(/No offered war mission/);
    });
  });

  describe('COMPLETE_WAR_MISSION + resolveRealmBattle war path', () => {
    it('completes a bloodless bridge demolition: bridge destroyed, enemy drained', () => {
      const session = bootWar();
      const bridge = findEnemyBridge(session);
      const rival = (bridge.ownerNationId ?? bridge.factionId)!;
      const enemyBefore = { ...session.war!.nations[rival]!.power };
      const accepted = reduceRealm(session, {
        type: 'ACCEPT_WAR_MISSION',
        missionKind: 'destroy_bridge',
        poiId: bridge.id,
      });
      // Impersonate-guard-rotation either succeeds bloodless or falls back to
      // battle; drive the mission to completion either way.
      const approached = reduceRealm(accepted.session, {
        type: 'RESOLVE_MISSION_APPROACH',
        approachId: 'impersonate-guard-rotation',
      });
      const approachEvent = approached.events.find(
        (e) => e.type === 'WAR_APPROACH_RESOLVED',
      )!;
      expect(approachEvent).toBeDefined();
      if (!approached.battle) {
        // Bloodless: complete directly.
        const done = reduceRealm(approached.session, {
          type: 'COMPLETE_WAR_MISSION',
          victory: true,
        });
        expect(done.session.map.pois[bridge.id]!.strategicStatus).toBe('destroyed');
        expect(done.session.map.pois[bridge.id]!.recoveryDay).toBeGreaterThan(
          done.session.travel.currentDay,
        );
        expect(done.session.war!.nations[rival]!.power.economy).toBeLessThan(
          enemyBefore.economy,
        );
        expect(done.session.activeWarMission).toBeNull();
        expect(done.events.some((e) => e.type === 'WAR_MISSION_COMPLETED')).toBe(true);
      } else {
        // Contested: win the tactical battle and commit it back.
        const ended = forceWarVictory(approached.battleGameState!);
        const resolved = resolveRealmBattle(approached.session, ended, approached.battle!);
        expect(resolved.session.map.pois[bridge.id]!.strategicStatus).toBe('destroyed');
        expect(resolved.session.war!.nations[rival]!.power.economy).toBeLessThan(
          enemyBefore.economy,
        );
        expect(resolved.events.some((e) => e.type === 'WAR_MISSION_COMPLETED')).toBe(true);
      }
      expect(mathRandomSpy).not.toHaveBeenCalled();
    });

    it('holds a protect_poi defense: under_attack clears to intact', () => {
      let session = bootWar();
      const stronghold = findPlayerFortress(session);
      // Simulate an incoming attack warning, then defend it.
      const warned = structuredClone(session);
      warned.map.pois[stronghold.id] = {
        ...stronghold,
        strategicStatus: 'under_attack',
        attackDeadlineDay: warned.travel.currentDay + 6,
        contestedByNationId: rivalNationId(session),
      };
      session = warned;
      const accepted = reduceRealm(session, {
        type: 'ACCEPT_WAR_MISSION',
        missionKind: 'protect_poi',
        poiId: stronghold.id,
      });
      const approached = reduceRealm(accepted.session, {
        type: 'RESOLVE_MISSION_APPROACH',
        approachId: 'frontal-assault',
      });
      expect(approached.battle).toBeDefined();
      const ended = forceWarVictory(approached.battleGameState!);
      const resolved = resolveRealmBattle(approached.session, ended, approached.battle!);
      expect(resolved.session.map.pois[stronghold.id]!.strategicStatus).toBe('intact');
    });

    it('rejects completion with no active mission', () => {
      const session = bootWar();
      expect(() =>
        reduceRealm(session, { type: 'COMPLETE_WAR_MISSION', victory: true }),
      ).toThrowError(/No active war mission/);
    });
  });

  describe('RESOLVE_PATROL_ENCOUNTER', () => {
    it('bribes a patrol: gold spent, Threat +5, no battle', () => {
      const session = bootWar();
      const rival = rivalNationId(session);
      const goldBefore = session.travel.gold;
      const result = reduceRealm(session, {
        type: 'RESOLVE_PATROL_ENCOUNTER',
        nationId: rival,
        approach: 'bribe',
      });
      expect(result.battle).toBeUndefined();
      expect(result.session.travel.gold).toBe(goldBefore - 50);
      expect(result.session.diplomacy.threats[rival]).toBe(5);
      const event = result.events.find((e) => e.type === 'WAR_PATROL_RESOLVED')!;
      expect(event).toBeDefined();
    });

    it('fighting a patrol mounts a Hunter-Killer skirmish battle', () => {
      const session = bootWar();
      const rival = rivalNationId(session);
      const result = reduceRealm(session, {
        type: 'RESOLVE_PATROL_ENCOUNTER',
        nationId: rival,
        approach: 'fight',
      });
      expect(result.battle).toBeDefined();
      expect(result.battleGameState).toBeDefined();
      expect(result.session.pendingWarBattle?.missionId).toContain('patrol_');
      expect(result.session.pendingWarBattle?.reinforcementQueue.length).toBeGreaterThan(0);
      // The kill is reported at interception: pursuit heat is on the books.
      expect(result.session.diplomacy.threats[rival]).toBe(20);
    });
  });

  describe('NEGOTIATE_TRUCE + HIRE_COVERT_ASSET', () => {
    it('negotiates a truce with a consistent success/failure record', () => {
      const session = bootWar();
      const rival = rivalNationId(session);
      const result = reduceRealm(session, {
        type: 'NEGOTIATE_TRUCE',
        targetNationId: rival,
        tributeGold: 0,
      });
      const event = result.events.find((e) => e.type === 'WAR_TRUCE_NEGOTIATED')!;
      expect(event).toBeDefined();
      if (event.success) {
        expect(result.session.war!.truces.length).toBe(1);
        expect(result.session.war!.truces[0]!.untilDay).toBeGreaterThan(
          result.session.travel.currentDay,
        );
      } else {
        expect(result.session.war!.truces.length).toBe(0);
        expect(result.session.travel.gold).toBe(session.travel.gold);
      }
    });

    it('rejects tribute beyond the war chest', () => {
      const session = bootWar();
      expect(() =>
        reduceRealm(session, {
          type: 'NEGOTIATE_TRUCE',
          targetNationId: rivalNationId(session),
          tributeGold: 999999,
        }),
      ).toThrowError(/War chest holds/);
    });

    it('refuses mercenaries the party cannot afford (no gold spent)', () => {
      const session = bootWar(1105);
      // Starting purse is 100 gp; a company costs 200 gp (170 gilded).
      expect(session.travel.gold).toBeLessThan(200);
      const result = reduceRealm(session, {
        type: 'HIRE_COVERT_ASSET',
        asset: 'mercenaries',
      });
      const event = result.events.find((e) => e.type === 'WAR_ASSET_HIRED')!;
      expect(event.success).toBe(false);
      expect(result.session.travel.gold).toBe(session.travel.gold);
    });

    it('musters a mercenary company when the chest covers the fee', () => {
      const session = bootWar();
      const funded: RealmSessionState = {
        ...session,
        travel: { ...session.travel, gold: 1000 },
      };
      const militaryBefore = session.war!.nations[session.war!.playerNationId]!.power.military;
      const result = reduceRealm(funded, {
        type: 'HIRE_COVERT_ASSET',
        asset: 'mercenaries',
      });
      const event = result.events.find((e) => e.type === 'WAR_ASSET_HIRED')!;
      expect(event.success).toBe(true);
      expect(result.session.travel.gold).toBeLessThan(1000);
      expect(
        result.session.war!.nations[result.session.war!.playerNationId]!.power.military,
      ).toBeGreaterThan(militaryBefore);
    });

    it('requires a target for a Thieves’ Guild cell', () => {
      const session = bootWar();
      expect(() =>
        reduceRealm(session, { type: 'HIRE_COVERT_ASSET', asset: 'thieves_guild' }),
      ).toThrowError(/need a target/);
    });
  });

  describe('multi-wave reinforcement spawning (engine)', () => {
    function bootDefenseBattle() {
      const session = bootWar();
      const stronghold = findPlayerFortress(session);
      const accepted = reduceRealm(session, {
        type: 'ACCEPT_WAR_MISSION',
        missionKind: 'protect_poi',
        poiId: stronghold.id,
      });
      const approached = reduceRealm(accepted.session, {
        type: 'RESOLVE_MISSION_APPROACH',
        approachId: 'frontal-assault',
      });
      return { session: approached.session, gameState: approached.battleGameState! };
    }

    it('deploys scheduled waves on their deployRound via getDueReinforcementWaves', () => {
      const { session } = bootDefenseBattle();
      const waves = session.pendingWarBattle!.waves;
      expect(getDueReinforcementWaves(waves, 1, [])).toEqual([]);
      const dueAt3 = getDueReinforcementWaves(waves, 3, []);
      expect(dueAt3.map((w) => w.wave)).toContain(2);
      expect(getDueReinforcementWaves(waves, 3, [2])).toEqual(
        waves.filter((w) => w.wave !== 1 && w.wave !== 2 && w.deployRound <= 3),
      );
    });

    it('spawns reserves into live combat with seeded initiative (deterministic replay)', () => {
      const first = bootDefenseBattle();
      const membersA = first.session.pendingWarBattle!.reinforcementQueue.slice(0, 2);
      const membersB = structuredClone(membersA);
      const activeBefore = first.gameState.combat!.activeCombatantId;
      const resA = spawnWarReinforcements(first.gameState, membersA);
      const resB = spawnWarReinforcements(first.gameState, membersB);
      expect(resA.spawnedIds).toHaveLength(2);
      for (const id of resA.spawnedIds) {
        expect(resA.nextState.combat!.combatants[id]).toBeDefined();
        expect(resA.nextState.monsters[id] ?? resA.nextState.party[id]).toBeDefined();
      }
      // Deterministic: identical queue + state yields identical initiative.
      expect(resA.nextState.combat!.initiativeOrder).toEqual(
        resB.nextState.combat!.initiativeOrder,
      );
      // The active turn pointer survives reinforcement injection.
      expect(resA.nextState.combat!.activeCombatantId).toBe(activeBefore);
      expect(mathRandomSpy).not.toHaveBeenCalled();
    });

    it('reopens a finished encounter when reserves arrive late', () => {
      const { gameState } = bootDefenseBattle();
      const members = bootDefenseBattle().session.pendingWarBattle!.reinforcementQueue.slice(0, 2);
      const ended = forceWarVictory(gameState);
      expect(ended.combat!.phase).toBe('combat_ended');
      const reopened = spawnWarReinforcements(ended, members);
      expect(reopened.nextState.combat!.phase).toBe('active_turn');
      expect(reopened.nextState.combat!.outcome).toBe('in_progress');
      expect(reopened.spawnedIds).toHaveLength(2);
    });

    it('supports the SPAWN_REINFORCEMENTS game command through reduceGame', async () => {
      const { gameState } = bootDefenseBattle();
      const members = bootDefenseBattle().session.pendingWarBattle!.reinforcementQueue.slice(0, 2);
      const transport = new LocalTransport({ initialState: gameState });
      await transport.connect();
      const before = Object.keys(transport.getAuthoritativeState().combat!.combatants).length;
      const { events } = await transport.dispatch({
        type: 'SPAWN_REINFORCEMENTS',
        combatants: members,
        wave: 2,
      });
      const after = transport.getAuthoritativeState();
      expect(Object.keys(after.combat!.combatants).length).toBe(before + 2);
      expect(events.some((e) => e.type === 'ENCOUNTER_TRIGGERED')).toBe(true);
      expect(
        after.combat!.initiativeOrder.some((e) => e.entityId === members[0]!.id),
      ).toBe(true);
    });

    it('parses reinforcement wave numbers from combatant ids', () => {
      expect(getReinforcementWaveNumber('war_1_w1_blade_1_spawn1')).toBe(1);
      expect(getReinforcementWaveNumber('war_blade_wave2')).toBe(2);
      expect(getReinforcementWaveNumber('war_1105_w3_orc')).toBe(3);
      expect(getReinforcementWaveNumber('plain-guard')).toBeNull();
    });
  });

  describe('strategic POI map badges', () => {
    it('tags every non-intact status and stays silent otherwise', () => {
      expect(getStrategicPoiBadge({ kind: 'mine', strategicStatus: 'cursed' })).toContain('cursed');
      expect(getStrategicPoiBadge({ kind: 'bridge', strategicStatus: 'destroyed' })).toContain(
        'destroyed',
      );
      expect(getStrategicPoiBadge({ kind: 'fortress', strategicStatus: 'sabotaged' })).toContain(
        'sabotaged',
      );
      expect(getStrategicPoiBadge({ kind: 'mine', strategicStatus: 'contested' })).toContain(
        'contested',
      );
      expect(getStrategicPoiBadge({ kind: 'mine', strategicStatus: 'under_attack' })).toContain(
        'under attack',
      );
      expect(getStrategicPoiBadge({ kind: 'mine', strategicStatus: 'intact' })).toBeNull();
      expect(getStrategicPoiBadge({ kind: 'mine', strategicStatus: undefined })).toBeNull();
      expect(getStrategicPoiBadge({ kind: 'town', strategicStatus: 'under_attack' })).toBeNull();
    });

    it('covers every strategic POI kind with a palette color', () => {
      for (const kind of [
        'fortress',
        'mine',
        'bridge',
        'supply_depot',
        'prison_keep',
        'subfaction_camp',
      ]) {
        expect(isStrategicPoiKind(kind)).toBe(true);
        expect(OVERWORLD_STRATEGIC_POI_COLORS[kind]).toBeDefined();
      }
      expect(isStrategicPoiKind('town')).toBe(false);
      expect(isStrategicPoiKind('dungeon_entrance')).toBe(false);
    });
  });

  describe('war event narration', () => {
    it('describes every war session event for the travel log', () => {
      const session = bootWar();
      const rival = rivalNationId(session);
      const H = (type: string) => ({ type }) as never;
      for (const event of [
        { type: 'WAR_NATION_SELECTED', nationId: 'x', nationName: 'The Dawn Crown' },
        { type: 'WAR_MISSION_ACCEPTED', missionId: 'm', kind: 'destroy_bridge', poiId: 'p', poiName: 'P' },
        { type: 'WAR_APPROACH_RESOLVED', missionId: 'm', approachId: 'a', success: true, bloodless: true, headline: 'Bloodless!' },
        { type: 'WAR_MISSION_COMPLETED', missionId: 'm', poiId: 'p', victory: true },
        { type: 'WAR_MISSION_COMPLETED', missionId: 'm', poiId: 'p', victory: false },
        { type: 'WAR_PATROL_RESOLVED', nationId: rival, approach: 'bribe', headline: 'Paid.' },
        { type: 'WAR_TRUCE_NEGOTIATED', nationId: rival, success: true, headline: 'Peace!' },
        { type: 'WAR_ASSET_HIRED', asset: 'mercenaries', success: true, headline: 'Hired!' },
      ] as never[]) {
        expect(describeRealmEvent(event).length).toBeGreaterThan(0);
      }
      void H;
      expect(getPartyList(session).length).toBe(4);
    });
  });
});
