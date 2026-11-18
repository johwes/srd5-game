import { describe, expect, it } from 'vitest';
import { defaultCompendium } from '@srd5/data';
import {
  BOSS_RUSH_WAVES,
  calculateBossRushScore,
  computeDailyDescentSeed,
  createDailyDescentRun,
  endRogueliteRun,
  generateDraftHero,
  generateDraftParty,
  getBossRushMonstersForWave,
  getDailyDescentDateString,
  getDailyDescentLeaderboard,
  getDailyDescentScoreRank,
  getDailyDescentSeed,
  isDailyDescentAttempted,
} from '../index.js';
import { computeDerivedCharacter } from '../character/derived.js';
import { DerivedCharacterSheetSchema } from '../character/schemas.js';

describe('Remix Modes Engine Suite (SRD-1005)', () => {
  describe('Daily Descent Seed & Leaderboard', () => {
    it('formats UTC dates consistently as YYYY-MM-DD', () => {
      const d1 = new Date(Date.UTC(2026, 10, 18, 12, 0, 0));
      expect(getDailyDescentDateString(d1)).toBe('2026-11-18');

      const d2 = new Date(Date.UTC(2027, 0, 1, 0, 0, 0));
      expect(getDailyDescentDateString(d2)).toBe('2027-01-01');

      expect(getDailyDescentDateString('2026-11-18T23:59:59Z')).toBe('2026-11-18');
    });

    it('derives deterministic positive seeds from daily date strings', () => {
      const seed1 = computeDailyDescentSeed('2026-11-18');
      const seed2 = computeDailyDescentSeed('2026-11-18');
      expect(seed1).toBe(seed2);
      expect(seed1).toBeGreaterThan(0);

      const seedOtherDay = computeDailyDescentSeed('2026-11-19');
      expect(seedOtherDay).not.toBe(seed1);

      expect(getDailyDescentSeed('2026-11-18')).toBe(seed1);
    });

    it('initializes and completes a Daily Descent run with isDaily metadata', () => {
      const session = createDailyDescentRun({
        date: '2026-11-18',
      });

      expect(session.runState.isDaily).toBe(true);
      expect(session.runState.dailyDate).toBe('2026-11-18');
      expect(session.runState.mode).toBe('daily_descent');
      expect(session.runState.seed).toBe(computeDailyDescentSeed('2026-11-18'));

      const completed = endRogueliteRun(
        session.runState,
        session.gameState,
        'Victory in the Depths',
      );

      expect(completed.graveyardEntry).toBeDefined();
      expect(completed.graveyardEntry?.isDaily).toBe(true);
      expect(completed.graveyardEntry?.dailyDate).toBe('2026-11-18');
      expect(completed.graveyardEntry?.mode).toBe('daily_descent');
    });

    it('tracks whether a daily run has been attempted and computes leaderboard ranking', () => {
      const mockHistory = [
        {
          runId: 'daily_2026-11-18_deadbeef',
          timestamp: '2026-11-18T10:00:00.000Z',
          depth: 4,
          score: 8500,
          monstersSlain: 12,
          goldCollected: 300,
          deathCause: 'Slain by Troll',
          livingPartyCount: 0,
          totalPartyCount: 4,
          partyNames: ['Garrick', 'Vex', 'Bram', 'Ezren'],
          turnsTaken: 45,
          isDaily: true,
          dailyDate: '2026-11-18',
          mode: 'daily_descent',
        },
        {
          runId: 'daily_2026-11-17_cafebabe',
          timestamp: '2026-11-17T11:00:00.000Z',
          depth: 7,
          score: 14200,
          monstersSlain: 25,
          goldCollected: 750,
          deathCause: 'Perished in Lava',
          livingPartyCount: 0,
          totalPartyCount: 4,
          partyNames: ['Garrick', 'Vex', 'Bram', 'Ezren'],
          turnsTaken: 82,
          isDaily: true,
          dailyDate: '2026-11-17',
          mode: 'daily_descent',
        },
        {
          runId: 'regular_run_999',
          timestamp: '2026-11-18T12:00:00.000Z',
          depth: 2,
          score: 3000,
          monstersSlain: 4,
          goldCollected: 50,
          deathCause: 'Fell in Pit',
          livingPartyCount: 0,
          totalPartyCount: 4,
          partyNames: ['Garrick'],
          turnsTaken: 15,
        },
      ];

      expect(isDailyDescentAttempted('2026-11-18', mockHistory)).toBe(true);
      expect(isDailyDescentAttempted('2026-11-19', mockHistory)).toBe(false);

      const leaderboard = getDailyDescentLeaderboard(mockHistory);
      expect(leaderboard.length).toBe(2);
      expect(leaderboard[0]!.score).toBe(14200);
      expect(leaderboard[1]!.score).toBe(8500);

      const rankTop = getDailyDescentScoreRank(15000, mockHistory);
      expect(rankTop.rank).toBe(1);
      expect(rankTop.percentile).toBe(100);

      const rankMiddle = getDailyDescentScoreRank(10000, mockHistory);
      expect(rankMiddle.rank).toBe(2);
      expect(rankMiddle.percentile).toBe(50);
    });
  });

  describe('Draft Party Generator', () => {
    it('generates a deterministic single hero with valid stats and derived sheet', () => {
      const resA = generateDraftHero({ seed: 12345, classId: 'wizard' });
      const resB = generateDraftHero({ seed: 12345, classId: 'wizard' });

      expect(resA.hero.name).toBe(resB.hero.name);
      expect(resA.hero.baseAbilities).toEqual(resB.hero.baseAbilities);
      expect(resA.hero.raceId).toBe(resB.hero.raceId);
      expect(resA.hero.classes[0]?.classId).toBe('wizard');

      // Intelligence should be highest base score for wizard
      expect(resA.hero.baseAbilities.int).toBeGreaterThanOrEqual(resA.hero.baseAbilities.str);

      // Verify derived character calculation
      const sheet = computeDerivedCharacter(resA.hero, defaultCompendium);
      expect(() => DerivedCharacterSheetSchema.parse(sheet)).not.toThrow();
      expect(sheet.totalLevel).toBe(1);
      expect(sheet.maxHp).toBeGreaterThanOrEqual(6);
      expect(sheet.armorClass.totalAc).toBeGreaterThanOrEqual(10);
      expect(sheet.spellcasting?.isSpellcaster).toBe(true);
      expect(sheet.spellcasting?.cantripIds.length).toBeGreaterThanOrEqual(3);
    });

    it('generates a full 4-hero party with distinct classes and valid derived sheets', () => {
      const party = generateDraftParty({ seed: 777, partySize: 4 });
      expect(party.length).toBe(4);

      // Verify distinct classes
      const classIds = party.map((h) => h.classes[0]!.classId);
      const uniqueClasses = new Set(classIds);
      expect(uniqueClasses.size).toBe(4);

      // Check all heroes compute cleanly with valid HP, AC, and attacks
      for (const hero of party) {
        const sheet = computeDerivedCharacter(hero, defaultCompendium);
        expect(() => DerivedCharacterSheetSchema.parse(sheet)).not.toThrow();
        expect(sheet.name).toBeTruthy();
        expect(sheet.maxHp).toBeGreaterThan(0);
        expect(sheet.armorClass.totalAc).toBeGreaterThan(0);
        expect(sheet.weaponAttacks.length).toBeGreaterThanOrEqual(1);
        expect(hero.abilityMethod).toBe('rolled');
      }

      // Verify replayability
      const partyRepeat = generateDraftParty({ seed: 777, partySize: 4 });
      expect(partyRepeat.map((h) => h.name)).toEqual(party.map((h) => h.name));
      expect(partyRepeat.map((h) => h.classes[0]!.classId)).toEqual(classIds);
    });
  });

  describe('Boss Rush Gauntlet Mode', () => {
    it('defines 7 escalating boss waves ending with Adult Red Dragon', () => {
      expect(BOSS_RUSH_WAVES.length).toBe(7);
      expect(BOSS_RUSH_WAVES[0]!.waveNumber).toBe(1);
      expect(BOSS_RUSH_WAVES[0]!.bossMonsterIds).toEqual(['minotaur', 'knight']);

      expect(BOSS_RUSH_WAVES[6]!.waveNumber).toBe(7);
      expect(BOSS_RUSH_WAVES[6]!.bossMonsterIds).toEqual(['adult-red-dragon']);
    });

    it('resolves monsters for each wave from the bundled compendium', () => {
      for (let wave = 1; wave <= 7; wave++) {
        const monsters = getBossRushMonstersForWave(wave, defaultCompendium);
        expect(monsters.length).toBeGreaterThan(0);
        for (const monsterId of monsters) {
          const m = defaultCompendium.getMonster(monsterId);
          expect(m).toBeDefined();
          expect(m?.name).toBeTruthy();
        }
      }
    });

    it('calculates Boss Rush final score accurately', () => {
      const score = calculateBossRushScore({
        wavesCleared: 5,
        monstersDefeated: 10,
        totalXp: 18000,
        livingPartyCount: 3,
        turnsTaken: 40,
        breathersUsed: 4,
      });

      // (5 * 2500) + 18000 + (3 * 500) + (10 * 250) - (40 * 5) - (4 * 100)
      // 12500 + 18000 + 1500 + 2500 - 200 - 400 = 33900
      expect(score).toBe(33900);

      // Floor to 0
      const negativeScore = calculateBossRushScore({
        wavesCleared: 0,
        monstersDefeated: 0,
        totalXp: 0,
        livingPartyCount: 0,
        turnsTaken: 1000,
        breathersUsed: 10,
      });
      expect(negativeScore).toBe(0);
    });
  });
});
