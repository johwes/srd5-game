import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultCompendium } from '@srd5/data';
import {
  type GameState,
  type OverworldPOI,
  QuestChainLogSchema,
  RealmError,
  generateOverworldBattle,
  getFactionReputation,
  getSettlements,
  startOverworldBattle,
} from '@srd5/engine';
import {
  type RealmSessionState,
  createRealmSession,
  getCurrentPoi,
  getPartyList,
  reduceRealm,
  resolveRealmBattle,
} from '../components/realm/realmEngine.js';

/**
 * SRD-809: Quest chains in the Realm session controller — bootstrap, stage
 * progression through travel/battle commit-back, branching choices with
 * two-way reputation shifts, timed expiry, and follow-up unlocks.
 */

const SEED = 809;

function bootstrap(seed = SEED): RealmSessionState {
  return createRealmSession({ seed, width: 48, height: 48 });
}

function findPoi(session: RealmSessionState, kind: OverworldPOI['kind']): OverworldPOI {
  const poi = Object.values(session.map.pois).find((p) => p.kind === kind);
  if (!poi) throw new Error(`No ${kind} POI on map`);
  return poi;
}

function forceVictory(battleGameState: GameState): GameState {
  const ended = structuredClone(battleGameState);
  for (const monster of Object.values(ended.monsters)) {
    monster.currentHp = 0;
    monster.isDead = true;
  }
  ended.combat = { ...ended.combat!, phase: 'combat_ended', outcome: 'party_victory' };
  return ended;
}

/** Wins a POI-linked tactical battle and commits it back to the realm. */
function winPoiBattle(session: RealmSessionState, poiId: string): RealmSessionState {
  const party = getPartyList(session);
  const battle = generateOverworldBattle({
    seed: 1000 + poiId.length,
    terrain: 'plains',
    partySize: party.length,
    poiId,
    origin: 'monster_lair',
  });
  const started = startOverworldBattle({ battle, party });
  const resolved = resolveRealmBattle(
    session,
    forceVictory(started.gameState),
    battle,
    defaultCompendium,
  );
  return resolved.session;
}

describe('SRD-809: Quest chains in the Realm session (Spec 06 §4.1)', () => {
  let mathRandomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mathRandomSpy = vi.spyOn(Math, 'random');
  });

  afterEach(() => {
    mathRandomSpy.mockRestore();
  });

  describe('Bootstrap', () => {
    it('binds schema-valid starter chains deterministically from the world seed', () => {
      const session = bootstrap();
      expect(QuestChainLogSchema.safeParse(session.chainLog).success).toBe(true);
      expect(session.chainLog.definitions.length).toBeGreaterThanOrEqual(2);
      const again = bootstrap();
      expect(JSON.stringify(again.chainLog)).toBe(JSON.stringify(session.chainLog));
      expect(getCurrentPoi(session)).not.toBeNull();
      expect(mathRandomSpy).not.toHaveBeenCalled();
    });
  });

  describe('Chain commands', () => {
    it('starts a chain and immediately satisfies its talk stage at the home board', () => {
      const session = bootstrap();
      const startPoi = getCurrentPoi(session)!;
      const available = session.chainLog.progress.find((p) => p.status === 'available')!;
      const def = session.chainLog.definitions.find((d) => d.id === available.chainId)!;
      if (def.originBoardPoiId !== startPoi.id || def.stages[0]!.kind !== 'talk') return;
      const result = reduceRealm(session, { type: 'REALM_START_CHAIN', chainId: def.id });
      const progress = result.session.chainLog.progress.find((p) => p.chainId === def.id)!;
      expect(progress.status).toBe('active');
      expect(progress.completedStageIds).toContain(def.stages[0]!.id);
      expect(progress.currentStageId).toBe(def.stages[1]!.id);
      expect(result.events.map((event) => event.type)).toContain('CHAIN_STARTED');
      expect(result.events.map((event) => event.type)).toContain('CHAIN_STAGE_COMPLETED');
      expect(() =>
        reduceRealm(result.session, { type: 'REALM_START_CHAIN', chainId: def.id }),
      ).toThrow(RealmError);
      expect(() => reduceRealm(session, { type: 'REALM_START_CHAIN', chainId: 'nope' })).toThrow(
        RealmError,
      );
    });

    it('rejects abandoning a chain that was never started', () => {
      const session = bootstrap();
      const available = session.chainLog.progress.find((p) => p.status === 'available')!;
      expect(() =>
        reduceRealm(session, { type: 'REALM_ABANDON_CHAIN', chainId: available.chainId }),
      ).toThrow(RealmError);
    });
  });

  describe('Branching choices and reputation', () => {
    it('applies a two-way reputation shift when the Rotted Crown changes hands', () => {
      const session = bootstrap();
      const crown = session.chainLog.definitions.find((def) => def.id === 'chain_rotted_crown');
      if (!crown) return; // map lacked rival settlements
      const startPoi = getCurrentPoi(session)!;
      if (crown.originBoardPoiId !== startPoi.id) return;
      const delve = crown.stages.find((stage) => stage.kind === 'dungeon')!;
      const choice = crown.stages.find((stage) => stage.kind === 'choice')!;
      const rivalOption = choice.options!.find((option) => option.id.endsWith('rival'))!;
      const rivalEffects = Object.fromEntries(rivalOption.reputationEffects.map((e) => [e.factionId, e.delta]));
      const originRepBefore = getFactionReputation(session.map, crown.originFactionId!);
      const rivalFactionId = Object.keys(rivalEffects).find((id) => id !== crown.originFactionId)!;
      const rivalRepBefore = getFactionReputation(session.map, rivalFactionId);

      let next = reduceRealm(session, { type: 'REALM_START_CHAIN', chainId: crown.id }).session;
      // Clearing the vault in battle commits back like a delve clear for chains.
      next = winPoiBattle(next, delve.targetPoiId!);
      expect(
        next.chainLog.progress.find((p) => p.chainId === crown.id)!.currentStageId,
      ).toBe(choice.id);

      const goldBefore = next.travel.gold;
      const decided = reduceRealm(next, {
        type: 'REALM_CHOOSE_CHAIN_OPTION',
        chainId: crown.id,
        optionId: rivalOption.id,
      });
      next = decided.session;
      expect(decided.events.map((event) => event.type)).toContain('CHAIN_CHOICE_MADE');
      // Reputation shifts both ways at decision time: +rival, −origin.
      expect(getFactionReputation(next.map, rivalFactionId)).toBe(
        rivalRepBefore + rivalEffects[rivalFactionId]!,
      );
      expect(getFactionReputation(next.map, crown.originFactionId!)).toBe(
        originRepBefore + rivalEffects[crown.originFactionId!]!,
      );
      expect(rivalEffects[rivalFactionId]).toBeGreaterThan(0);
      expect(rivalEffects[crown.originFactionId!]).toBeLessThan(0);

      // Deliver the crown to the rival house to complete the chain.
      const turnIn = crown.stages.find((stage) => stage.id === rivalOption.nextStageId)!;
      const target = next.map.pois[turnIn.targetPoiId!]!;
      next = reduceRealm(next, {
        type: 'REALM_TRAVEL_TO',
        destination: { q: target.q, r: target.r },
      }).session;
      const finished = next.chainLog.progress.find((p) => p.chainId === crown.id)!;
      expect(finished.status).toBe('completed');
      expect(next.travel.gold).toBe(goldBefore + crown.finalRewardGold);

      expect(() =>
        reduceRealm(next, {
          type: 'REALM_CHOOSE_CHAIN_OPTION',
          chainId: crown.id,
          optionId: rivalOption.id,
        }),
      ).toThrow(RealmError);
    });
  });

  describe('Battle commit-back', () => {
    it('advances bounty chain stages when a lair battle resolves', () => {
      const session = bootstrap();
      const road = session.chainLog.definitions.find((def) => def.id === 'chain_wild_road');
      if (!road) return; // map lacked two lairs
      const startPoi = getCurrentPoi(session)!;
      if (road.originBoardPoiId !== startPoi.id) return;
      const talk = road.stages[0]!;
      const bounty = road.stages[1]!;
      let next = reduceRealm(session, { type: 'REALM_START_CHAIN', chainId: road.id }).session;
      expect(
        next.chainLog.progress.find((p) => p.chainId === road.id)!.completedStageIds,
      ).toContain(talk.id);
      next = winPoiBattle(next, bounty.targetPoiId!);
      const progress = next.chainLog.progress.find((p) => p.chainId === road.id)!;
      expect(progress.completedStageIds).toContain(bounty.id);
      expect(next.clearedPoiIds).toContain(bounty.targetPoiId!);
      expect(next.travel.gold).toBeGreaterThan(session.travel.gold);
    });

    it('completing the Wild Road through battle pays final gold and reputation', () => {
      const session = bootstrap();
      const road = session.chainLog.definitions.find((def) => def.id === 'chain_wild_road');
      if (!road) return;
      const startPoi = getCurrentPoi(session)!;
      if (road.originBoardPoiId !== startPoi.id) return;
      const factionId = road.originFactionId!;
      const repBefore = getFactionReputation(session.map, factionId);
      let next = reduceRealm(session, { type: 'REALM_START_CHAIN', chainId: road.id }).session;
      const goldBefore = next.travel.gold;
      next = winPoiBattle(next, road.stages[1]!.targetPoiId!);
      next = winPoiBattle(next, road.stages[2]!.targetPoiId!);
      // Ride home: travel to a far settlement and back so the origin turn-in fires.
      const other = getSettlements(next.map).find((poi) => poi.id !== startPoi.id)!;
      const origin = next.map.pois[road.stages[3]!.targetPoiId!]!;
      next = reduceRealm(next, {
        type: 'REALM_TRAVEL_TO',
        destination: { q: other.q, r: other.r },
      }).session;
      next = reduceRealm(next, {
        type: 'REALM_TRAVEL_TO',
        destination: { q: origin.q, r: origin.r },
      }).session;
      const finished = next.chainLog.progress.find((p) => p.chainId === road.id)!;
      expect(finished.status).toBe('completed');
      expect(finished.completedDay).toBe(next.travel.currentDay);
      expect(next.travel.gold).toBeGreaterThanOrEqual(goldBefore + road.finalRewardGold);
      expect(getFactionReputation(next.map, factionId)).toBeGreaterThan(repBefore);
    });

    it('unlocks the follow-up chain when the Sunken Tithe completes', () => {
      const session = bootstrap();
      const tithe = session.chainLog.definitions.find((def) => def.id === 'chain_sunken_tithe');
      const shadow = session.chainLog.definitions.find((def) => def.id === 'chain_tithes_shadow');
      if (!tithe || !shadow) return;
      const startPoi = getCurrentPoi(session)!;
      if (tithe.originBoardPoiId !== startPoi.id) return;
      let next = reduceRealm(session, { type: 'REALM_START_CHAIN', chainId: tithe.id }).session;
      expect(() =>
        reduceRealm(next, { type: 'REALM_START_CHAIN', chainId: shadow.id }),
      ).toThrow(RealmError);
      // Fetch resolves through a POI clear, like a delve commit-back.
      next = winPoiBattle(next, tithe.stages[1]!.targetPoiId!);
      const origin = next.map.pois[tithe.stages[2]!.targetPoiId!]!;
      const other = getSettlements(next.map).find((poi) => poi.id !== origin.id)!;
      next = reduceRealm(next, {
        type: 'REALM_TRAVEL_TO',
        destination: { q: other.q, r: other.r },
      }).session;
      next = reduceRealm(next, {
        type: 'REALM_TRAVEL_TO',
        destination: { q: origin.q, r: origin.r },
      }).session;
      expect(next.chainLog.progress.find((p) => p.chainId === tithe.id)!.status).toBe('completed');
      const unlocked = next.chainLog.progress.find((p) => p.chainId === shadow.id)!;
      expect(unlocked.status).toBe('available');
    });
  });

  describe('Timed offers', () => {
    it('fails an expired timed chain when the party travels after the deadline', () => {
      const session = bootstrap();
      const road = session.chainLog.definitions.find((def) => def.id === 'chain_wild_road');
      if (!road) return;
      const startPoi = getCurrentPoi(session)!;
      if (road.originBoardPoiId !== startPoi.id) return;
      let next = reduceRealm(session, { type: 'REALM_START_CHAIN', chainId: road.id }).session;
      const progress = next.chainLog.progress.find((p) => p.chainId === road.id)!;
      expect(progress.expiresDay).toBeDefined();
      // Jump the calendar past the deadline, then travel: expiry fires on arrival.
      next = {
        ...next,
        travel: { ...next.travel, currentDay: progress.expiresDay! + 1 },
      };
      const other = getSettlements(next.map).find((poi) => poi.id !== startPoi.id)!;
      const result = reduceRealm(next, {
        type: 'REALM_TRAVEL_TO',
        destination: { q: other.q, r: other.r },
      });
      expect(result.session.chainLog.progress.find((p) => p.chainId === road.id)!.status).toBe(
        'failed',
      );
      expect(result.events.map((event) => event.type)).toContain('CHAIN_FAILED');
    });
  });
});
