import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import {
  type OverworldMap,
  type QuestChainDefinition,
  QuestChainDefinitionSchema,
  QuestChainLogSchema,
  RealmError,
  abandonQuestChain,
  advanceChainsForClearedPoi,
  advanceChainsForVisit,
  buildStarterQuestChains,
  chooseChainBranch,
  createQuestChainLog,
  expireQuestChains,
  getActiveChains,
  getAvailableChains,
  getChainDefinition,
  getCompletedChains,
  getCurrentChainStage,
  startQuestChain,
  generateOverworldMap,
  populateSettlements,
} from '../index.js';

/**
 * SRD-809: Quest chains — stages, branches, competing offers, timed expiry,
 * world-state (cleared POIs stay cleared), and starter chain content.
 */

function settledMap(seed = 809): OverworldMap {
  const generated = generateOverworldMap({ seed, width: 64, height: 64 });
  return populateSettlements(generated.map, generated.settlementSites).map;
}

function starterLog(seed = 809) {
  const map = settledMap(seed);
  const definitions = buildStarterQuestChains(map);
  const log = createQuestChainLog(definitions);
  return { map, definitions, log };
}

describe('SRD-809: Quest chain infrastructure (Spec 06 §4.1)', () => {
  let mathRandomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mathRandomSpy = vi.spyOn(Math, 'random');
  });

  afterEach(() => {
    mathRandomSpy.mockRestore();
  });

  describe('Starter chain construction', () => {
    it('binds 2–3 starter chains (+ follow-up) to real POIs with schema-valid definitions', () => {
      const { map, definitions, log } = starterLog();
      expect(definitions.length).toBeGreaterThanOrEqual(2);
      expect(QuestChainLogSchema.safeParse(log).success).toBe(true);
      for (const def of definitions) {
        expect(QuestChainDefinitionSchema.safeParse(def).success).toBe(true);
        for (const stage of def.stages) {
          if (stage.targetPoiId) {
            expect(map.pois[stage.targetPoiId]).toBeDefined();
            expect(stage.targetName).toBe(map.pois[stage.targetPoiId]!.name);
          }
        }
        if (def.originFactionId) expect(map.factions[def.originFactionId]).toBeDefined();
        for (const effect of def.finalReputationEffects) {
          expect(map.factions[effect.factionId]).toBeDefined();
        }
        for (const stage of def.stages) {
          for (const option of stage.options ?? []) {
            for (const effect of option.reputationEffects) {
              expect(map.factions[effect.factionId]).toBeDefined();
            }
          }
        }
      }
      // Follow-ups start locked behind their prerequisite.
      const tithe = definitions.find((def) => def.id === 'chain_sunken_tithe');
      const shadow = definitions.find((def) => def.id === 'chain_tithes_shadow');
      if (tithe && shadow) {
        expect(shadow.requiresCompletedChainId).toBe(tithe.id);
        expect(log.progress.find((p) => p.chainId === shadow.id)!.status).toBe('locked');
        expect(getAvailableChains(log).length).toBeGreaterThan(0);
      }
    });

    it('is deterministic: the same seed binds identical chains (bit-exact replay)', () => {
      const first = buildStarterQuestChains(settledMap(4242));
      const second = buildStarterQuestChains(settledMap(4242));
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(mathRandomSpy).not.toHaveBeenCalled();
    });

    it('gracefully skips chains whose required POIs are absent', () => {
      const map = settledMap();
      const stripped = structuredClone(map);
      for (const poi of Object.values(stripped.pois)) {
        if (poi.kind === 'dungeon_entrance' || poi.kind === 'monster_lair') {
          delete stripped.pois[poi.id];
        }
      }
      const chains = buildStarterQuestChains(stripped);
      expect(chains.every((chain) => chain.stages.every((s) => s.kind !== 'dungeon'))).toBe(true);
      expect(QuestChainLogSchema.safeParse(createQuestChainLog(chains)).success).toBe(true);
    });

    it('returns no chains when the map has no settlements', () => {
      const map = settledMap();
      const stripped = structuredClone(map);
      for (const poi of Object.values(stripped.pois)) {
        if (poi.kind === 'capital' || poi.kind === 'town' || poi.kind === 'village') {
          delete stripped.pois[poi.id];
        }
      }
      expect(buildStarterQuestChains(stripped)).toEqual([]);
    });
  });

  describe('Chain lifecycle', () => {
    it('starts available chains, rejects unknown/duplicate starts', () => {
      const { log } = starterLog();
      const available = getAvailableChains(log);
      expect(available.length).toBeGreaterThan(0);
      const chainId = available[0]!.chainId;

      const started = startQuestChain(log, chainId, 3);
      const progress = started.log.progress.find((p) => p.chainId === chainId)!;
      expect(progress.status).toBe('active');
      expect(progress.startedDay).toBe(3);
      expect(progress.currentStageId).toBe(getChainDefinition(started.log, chainId).stages[0]!.id);
      expect(started.events).toMatchObject([{ type: 'CHAIN_STARTED', chainId, day: 3 }]);
      expect(log.progress.find((p) => p.chainId === chainId)!.status).toBe('available'); // non-mutating

      expect(() => startQuestChain(started.log, chainId, 3)).toThrow(RealmError);
      expect(() => startQuestChain(log, 'no-such-chain', 3)).toThrow(RealmError);
    });

    it('walks talk → dungeon → choice → turn-in for The Rotted Crown', () => {
      const { definitions, log } = starterLog();
      const crown = definitions.find((def) => def.id === 'chain_rotted_crown');
      if (!crown) return; // map lacked rival settlements; covered by skip test
      const talk = crown.stages[0]!;
      const delve = crown.stages[1]!;
      const choice = crown.stages[2]!;

      let state = startQuestChain(log, crown.id, 1).log;
      // Wrong POI visits are ignored.
      const ignored = advanceChainsForVisit(state, 'definitely-not-a-poi', 2);
      expect(ignored.stageCompletions).toHaveLength(0);

      state = advanceChainsForVisit(state, talk.targetPoiId!, 2).log;
      expect(getCurrentChainStage(state, crown.id)!.stage.id).toBe(delve.id);

      const cleared = advanceChainsForClearedPoi(state, delve.targetPoiId!, 3);
      state = cleared.log;
      expect(getCurrentChainStage(state, crown.id)!.stage.kind).toBe('choice');

      const option = choice.options![0]!;
      const chosen = chooseChainBranch(state, crown.id, option.id, 4);
      state = chosen.log;
      expect(chosen.reputationEffects).toEqual(option.reputationEffects);
      // Reputation shifts both ways: the chosen house gains, the spurned loses.
      const deltas = option.reputationEffects.map((effect) => effect.delta);
      expect(deltas.some((delta) => delta > 0)).toBe(true);
      expect(deltas.some((delta) => delta < 0)).toBe(true);
      expect(chosen.events).toMatchObject([
        { type: 'CHAIN_CHOICE_MADE', chainId: crown.id, optionId: option.id },
      ]);

      // The unchosen branch is locked out: its turn-in can never complete.
      const current = getCurrentChainStage(state, crown.id)!;
      expect(current.stage.id).toBe(option.nextStageId);
      const otherOption = choice.options![1]!;
      expect(current.stage.id).not.toBe(otherOption.nextStageId);

      const turnIn = advanceChainsForVisit(state, current.stage.targetPoiId!, 5);
      expect(turnIn.chainCompletions).toHaveLength(1);
      expect(turnIn.chainCompletions[0]!.rewardGold).toBe(crown.finalRewardGold);
      expect(turnIn.events.map((event) => event.type)).toContain('CHAIN_COMPLETED');
      expect(getCompletedChains(turnIn.log)).toHaveLength(1);

      // Visiting the spurned house afterwards does nothing.
      const spurnedTurnIn = crown.stages.find((s) => s.id === otherOption.nextStageId)!;
      const after = advanceChainsForVisit(turnIn.log, spurnedTurnIn.targetPoiId!, 6);
      expect(after.stageCompletions).toHaveLength(0);
      expect(after.chainCompletions).toHaveLength(0);
    });

    it('rejects invalid branch choices', () => {
      const { definitions, log } = starterLog();
      const crown = definitions.find((def) => def.id === 'chain_rotted_crown');
      if (!crown) return;
      let state = startQuestChain(log, crown.id, 1).log;
      // Choosing on a non-choice stage throws.
      expect(() => chooseChainBranch(state, crown.id, 'crown_origin', 2)).toThrow(RealmError);
      state = advanceChainsForVisit(state, crown.stages[0]!.targetPoiId!, 2).log;
      state = advanceChainsForClearedPoi(state, crown.stages[1]!.targetPoiId!, 3).log;
      expect(() => chooseChainBranch(state, crown.id, 'no-such-option', 4)).toThrow(RealmError);
      expect(() => chooseChainBranch(state, 'no-such-chain', 'crown_origin', 4)).toThrow(RealmError);
    });

    it('resolves bounty and escort verbs through POI clears (Wild Road)', () => {
      const { definitions, log } = starterLog();
      const road = definitions.find((def) => def.id === 'chain_wild_road');
      if (!road) return; // map lacked two lairs; covered by skip test
      const [talk, bounty, escort, turnIn] = road.stages;
      let state = startQuestChain(log, road.id, 1).log;
      expect(getChainDefinition(state, road.id).timeLimitDays).toBe(12);
      const progress = state.progress.find((p) => p.chainId === road.id)!;
      expect(progress.expiresDay).toBe(13);

      state = advanceChainsForVisit(state, talk!.targetPoiId!, 2).log;
      state = advanceChainsForClearedPoi(state, bounty!.targetPoiId!, 3).log;
      expect(getCurrentChainStage(state, road.id)!.stage.id).toBe(escort!.id);
      state = advanceChainsForClearedPoi(state, escort!.targetPoiId!, 4).log;
      const done = advanceChainsForVisit(state, turnIn!.targetPoiId!, 5);
      expect(done.chainCompletions[0]!.rewardGold).toBe(road.finalRewardGold);
      expect(getCompletedChains(done.log).map((p) => p.chainId)).toContain(road.id);
    });

    it('unlocks the follow-up chain when The Sunken Tithe completes', () => {
      const { definitions, log } = starterLog();
      const tithe = definitions.find((def) => def.id === 'chain_sunken_tithe');
      const shadow = definitions.find((def) => def.id === 'chain_tithes_shadow');
      if (!tithe || !shadow) return;
      let state = startQuestChain(log, tithe.id, 1).log;
      // The follow-up cannot start while locked.
      expect(() => startQuestChain(state, shadow.id, 1)).toThrow(RealmError);
      state = advanceChainsForVisit(state, tithe.stages[0]!.targetPoiId!, 2).log;
      state = advanceChainsForClearedPoi(state, tithe.stages[1]!.targetPoiId!, 3).log;
      const done = advanceChainsForVisit(state, tithe.stages[2]!.targetPoiId!, 4);
      expect(done.events.map((event) => event.type)).toContain('CHAIN_UNLOCKED');
      expect(done.log.progress.find((p) => p.chainId === shadow.id)!.status).toBe('available');
      // And the unlocked follow-up plays end to end.
      let follow = startQuestChain(done.log, shadow.id, 5).log;
      follow = advanceChainsForVisit(follow, shadow.stages[0]!.targetPoiId!, 5).log;
      follow = advanceChainsForClearedPoi(follow, shadow.stages[1]!.targetPoiId!, 6).log;
      const finished = advanceChainsForVisit(follow, shadow.stages[2]!.targetPoiId!, 7);
      expect(finished.chainCompletions).toHaveLength(1);
    });
  });

  describe('Competing offers, timing, failure, and world-state', () => {
    function competingLog(): { log: ReturnType<typeof createQuestChainLog>; defs: QuestChainDefinition[] } {
      const { map } = starterLog();
      const settlements = Object.values(map.pois).filter((poi) =>
        ['capital', 'town', 'village'].includes(poi.kind),
      );
      const origin = settlements[0]!;
      const defs: QuestChainDefinition[] = [
        {
          id: 'chain_alpha',
          title: 'Alpha Claim',
          description: 'A test claim from house Alpha.',
          originBoardPoiId: origin.id,
          exclusiveGroupId: 'crown_claimants',
          unlocksChainIds: [],
          stages: [
            { id: 'alpha_talk', kind: 'talk', title: 'Hear Alpha', description: '', targetPoiId: origin.id },
          ],
          finalRewardGold: 10,
          finalReputationEffects: [],
        },
        {
          id: 'chain_beta',
          title: 'Beta Claim',
          description: 'A test claim from house Beta.',
          originBoardPoiId: origin.id,
          exclusiveGroupId: 'crown_claimants',
          unlocksChainIds: [],
          stages: [
            { id: 'beta_talk', kind: 'talk', title: 'Hear Beta', description: '', targetPoiId: origin.id },
          ],
          finalRewardGold: 10,
          finalReputationEffects: [],
        },
      ];
      return { log: createQuestChainLog(defs), defs };
    }

    it('locks competing offers in the same exclusive group when one starts', () => {
      const { log } = competingLog();
      const started = startQuestChain(log, 'chain_alpha', 1);
      expect(started.log.progress.find((p) => p.chainId === 'chain_beta')!.status).toBe('locked');
      expect(started.events.map((event) => event.type)).toContain('CHAIN_FAILED');
      expect(() => startQuestChain(started.log, 'chain_beta', 1)).toThrow(RealmError);
    });

    it('fails timed chains past their expiry and ignores unexpired ones', () => {
      const { definitions, log } = starterLog();
      const road = definitions.find((def) => def.id === 'chain_wild_road');
      if (!road) return;
      let state = startQuestChain(log, road.id, 1).log;
      const early = expireQuestChains(state, 13);
      expect(early.log.progress.find((p) => p.chainId === road.id)!.status).toBe('active');
      const late = expireQuestChains(state, 14);
      const failed = late.log.progress.find((p) => p.chainId === road.id)!;
      expect(failed.status).toBe('failed');
      expect(failed.failedDay).toBe(14);
      expect(late.events).toMatchObject([
        { type: 'CHAIN_FAILED', chainId: road.id, reason: 'The offer expired' },
      ]);
      state = late.log;
      expect(getActiveChains(state)).toHaveLength(0);
    });

    it('abandons active chains and rejects abandoning anything else', () => {
      const { log } = starterLog();
      const available = getAvailableChains(log)[0]!;
      const started = startQuestChain(log, available.chainId, 2);
      const abandoned = abandonQuestChain(started.log, available.chainId, 3);
      expect(abandoned.log.progress.find((p) => p.chainId === available.chainId)!.status).toBe(
        'failed',
      );
      expect(abandoned.events).toMatchObject([
        { type: 'CHAIN_FAILED', chainId: available.chainId, reason: 'Abandoned by the party' },
      ]);
      expect(() => abandonQuestChain(abandoned.log, available.chainId, 4)).toThrow(RealmError);
      expect(() => abandonQuestChain(log, available.chainId, 4)).toThrow(RealmError);
    });

    it('treats cleared POIs as staying cleared: combat stages auto-complete on start', () => {
      const { definitions, log } = starterLog();
      const road = definitions.find((def) => def.id === 'chain_wild_road');
      if (!road) return;
      const bounty = road.stages[1]!;
      const escort = road.stages[2]!;
      const started = startQuestChain(log, road.id, 1, [bounty.targetPoiId!]);
      const progress = started.log.progress.find((p) => p.chainId === road.id)!;
      // Talk still needs a visit, but the already-cleared bounty resolves itself
      // the moment the party reports in.
      expect(progress.status).toBe('active');
      const afterTalk = advanceChainsForVisit(started.log, road.stages[0]!.targetPoiId!, 2, [
        bounty.targetPoiId!,
      ]);
      expect(getCurrentChainStage(afterTalk.log, road.id)!.stage.id).toBe(escort.id);
      expect(afterTalk.stageCompletions.map((s) => s.stageId)).toContain(bounty.id);
    });
  });
});
