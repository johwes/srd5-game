import { ABILITY_IDS } from '@srd5/data';
import { describe, expect, it } from 'vitest';
import {
  POINT_BUY_BUDGET,
  POINT_BUY_COST_TABLE,
  STANDARD_ARRAY,
  calculatePointBuySummary,
  computeAbilityModifier,
  createUniformAbilities,
  generateSeededAbilityRolls,
  getPointBuyScoreCost,
  validateAbilityGeneration,
  validateCharacterBuildAbilities,
  validateManualAbilities,
  validatePointBuy,
  validateRolledAbilities,
  validateStandardArray,
} from '../index.js';

describe('SRD-202: Ability Score Generation Validators', () => {
  describe('computeAbilityModifier', () => {
    it('computes floor((score - 10) / 2) across all SRD ability scores (1..30)', () => {
      const expectedTable: ReadonlyArray<[number, number]> = [
        [1, -5],
        [2, -4],
        [3, -4],
        [4, -3],
        [5, -3],
        [6, -2],
        [7, -2],
        [8, -1],
        [9, -1],
        [10, 0],
        [11, 0],
        [12, 1],
        [13, 1],
        [14, 2],
        [15, 2],
        [16, 3],
        [17, 3],
        [18, 4],
        [19, 4],
        [20, 5],
        [24, 7],
        [30, 10],
      ];

      for (const [score, expectedMod] of expectedTable) {
        expect(computeAbilityModifier(score)).toBe(expectedMod);
      }
    });
  });

  describe('Standard Array Validator ([15, 14, 13, 12, 10, 8])', () => {
    it('accepts any valid permutation of [15, 14, 13, 12, 10, 8]', () => {
      const fighterArray = {
        str: 15,
        dex: 13,
        con: 14,
        int: 8,
        wis: 12,
        cha: 10,
      };
      const res1 = validateStandardArray(fighterArray);
      expect(res1.valid).toBe(true);
      expect(res1.errors).toEqual([]);
      expect(res1.missingScores).toEqual([]);
      expect(res1.unexpectedScores).toEqual([]);

      const wizardArray = {
        str: 8,
        dex: 14,
        con: 13,
        int: 15,
        wis: 12,
        cha: 10,
      };
      const res2 = validateStandardArray(wizardArray);
      expect(res2.valid).toBe(true);
      expect(res2.errors).toEqual([]);
    });

    it('rejects duplicate values or scores not in the Standard Array', () => {
      const duplicateFifteen = {
        str: 15,
        dex: 15,
        con: 13,
        int: 12,
        wis: 10,
        cha: 8,
      };
      const res = validateStandardArray(duplicateFifteen);
      expect(res.valid).toBe(false);
      expect(res.missingScores).toEqual([14]);
      expect(res.unexpectedScores).toEqual([15]);
      expect(res.errors[0]).toContain(STANDARD_ARRAY.join(', '));
    });

    it('rejects uniform 10s as invalid for Standard Array', () => {
      const res = validateStandardArray(createUniformAbilities(10));
      expect(res.valid).toBe(false);
      expect(res.missingScores).toEqual([15, 14, 13, 12, 8]);
      expect(res.unexpectedScores).toEqual([10, 10, 10, 10, 10]);
    });
  });

  describe('27-Point Buy Validator & Cost Calculator', () => {
    it('enforces the exact SRD 5.1 Point Buy cost table (8..15)', () => {
      expect(POINT_BUY_COST_TABLE).toEqual({
        8: 0,
        9: 1,
        10: 2,
        11: 3,
        12: 4,
        13: 5,
        14: 7,
        15: 9,
      });
      expect(getPointBuyScoreCost(7)).toBeUndefined();
      expect(getPointBuyScoreCost(8)).toBe(0);
      expect(getPointBuyScoreCost(13)).toBe(5);
      expect(getPointBuyScoreCost(14)).toBe(7);
      expect(getPointBuyScoreCost(15)).toBe(9);
      expect(getPointBuyScoreCost(16)).toBeUndefined();
      expect(getPointBuyScoreCost(12.5)).toBeUndefined();
    });

    it('validates legal 27-point distributions (min-max, standard array, balanced)', () => {
      // 15 (9) + 15 (9) + 15 (9) + 8 (0) + 8 (0) + 8 (0) = 27
      const minMax = {
        str: 15,
        dex: 15,
        con: 15,
        int: 8,
        wis: 8,
        cha: 8,
      };
      const resMinMax = validatePointBuy(minMax);
      expect(resMinMax.valid).toBe(true);
      expect(resMinMax.pointsSpent).toBe(POINT_BUY_BUDGET);
      expect(resMinMax.pointsRemaining).toBe(0);

      // Standard array costs: 9 + 7 + 5 + 4 + 2 + 0 = 27
      const stdArray = {
        str: 15,
        dex: 14,
        con: 13,
        int: 12,
        wis: 10,
        cha: 8,
      };
      const resStd = validatePointBuy(stdArray);
      expect(resStd.valid).toBe(true);
      expect(resStd.pointsSpent).toBe(27);

      // Balanced: 13 (5)*3 + 12 (4)*3 = 15 + 12 = 27
      const balanced = {
        str: 13,
        dex: 13,
        con: 13,
        int: 12,
        wis: 12,
        cha: 12,
      };
      const resBalanced = validatePointBuy(balanced);
      expect(resBalanced.valid).toBe(true);
      expect(resBalanced.pointsSpent).toBe(27);
    });

    it('rejects Point Buy distributions that exceed 27 points', () => {
      // 15 (9)*3 + 10 (2) + 8 (0)*2 = 29 points
      const overBudget = {
        str: 15,
        dex: 15,
        con: 15,
        int: 10,
        wis: 8,
        cha: 8,
      };
      const res = validatePointBuy(overBudget);
      expect(res.valid).toBe(false);
      expect(res.pointsSpent).toBe(29);
      expect(res.pointsRemaining).toBe(-2);
      expect(res.errors[0]).toContain('exceeds the 27-point budget by 2');
    });

    it('rejects unspent points by default, but allows them when allowUnspentPoints is true', () => {
      // All 8s = 0 points spent (27 remaining)
      const allEights = createUniformAbilities(8);
      const strictRes = validatePointBuy(allEights);
      expect(strictRes.valid).toBe(false);
      expect(strictRes.pointsSpent).toBe(0);
      expect(strictRes.pointsRemaining).toBe(27);
      expect(strictRes.errors[0]).toContain('27 point(s) unspent');

      const partialRes = validatePointBuy(allEights, { allowUnspentPoints: true });
      expect(partialRes.valid).toBe(true);
      expect(partialRes.errors).toEqual([]);
    });

    it('rejects base scores below 8 or above 15', () => {
      const outOfBounds = {
        str: 16,
        dex: 14,
        con: 13,
        int: 12,
        wis: 10,
        cha: 7,
      };
      const res = validatePointBuy(outOfBounds);
      expect(res.valid).toBe(false);
      expect(res.outOfRangeAbilities).toEqual(['str', 'cha']);
      expect(res.costByAbility.str).toBeNull();
      expect(res.costByAbility.cha).toBeNull();
      expect(res.errors).toHaveLength(2);
    });

    it('calculates per-ability canIncrement and canDecrement eligibility accurately', () => {
      // Spend 26 points: 15 (9) + 14 (7) + 13 (5) + 12 (4) + 9 (1) + 8 (0) = 26 (1 point left)
      const abilities = {
        str: 15, // max 15 -> cannot increment
        dex: 14, // 14->15 costs 2 -> cannot increment with 1 point left
        con: 13, // 13->14 costs 2 -> cannot increment with 1 point left
        int: 12, // 12->13 costs 1 -> CAN increment
        wis: 9, // 9->10 costs 1 -> CAN increment
        cha: 8, // 8->9 costs 1 -> CAN increment, cannot decrement
      };
      const summary = calculatePointBuySummary(abilities);
      expect(summary.pointsSpent).toBe(26);
      expect(summary.pointsRemaining).toBe(1);

      expect(summary.canIncrement).toEqual({
        str: false,
        dex: false,
        con: false,
        int: true,
        wis: true,
        cha: true,
      });

      expect(summary.canDecrement).toEqual({
        str: true,
        dex: true,
        con: true,
        int: true,
        wis: true,
        cha: false,
      });
    });
  });

  describe('Seeded 4d6kh3 Roll Generator & Validator', () => {
    it('deterministically generates 6 4d6kh3 scores with full roll records from a seed', () => {
      const seed = 424242;
      const pool1 = generateSeededAbilityRolls(seed);
      const pool2 = generateSeededAbilityRolls(seed);

      expect(pool1).toEqual(pool2);
      expect(pool1.scores).toHaveLength(6);
      expect(pool1.records).toHaveLength(6);

      for (let i = 0; i < 6; i++) {
        const record = pool1.records[i]!;
        const score = pool1.scores[i]!;
        expect(score).toBeGreaterThanOrEqual(3);
        expect(score).toBeLessThanOrEqual(18);
        expect(record.diceGroups[0]?.dice).toHaveLength(4);
        expect(record.kept).toHaveLength(3);
        expect(record.kept.reduce((sum, v) => sum + v, 0)).toBe(score);

        // Kept 3 dice must be >= the dropped die
        const dropped = record.diceGroups[0]?.dropped ?? [];
        expect(dropped).toHaveLength(1);
        expect(Math.min(...record.kept)).toBeGreaterThanOrEqual(dropped[0]!);
      }

      // Sorted scores must be descending
      for (let i = 1; i < pool1.sortedScores.length; i++) {
        expect(pool1.sortedScores[i - 1]!).toBeGreaterThanOrEqual(pool1.sortedScores[i]!);
      }
    });

    it('validates any permutation of the seeded 4d6kh3 pool', () => {
      const seed = 1337;
      const pool = generateSeededAbilityRolls(seed);

      // Assign in reverse order to test permutation matching
      const reversed = [...pool.scores].reverse();
      const assigned = {
        str: reversed[0]!,
        dex: reversed[1]!,
        con: reversed[2]!,
        int: reversed[3]!,
        wis: reversed[4]!,
        cha: reversed[5]!,
      };

      const res = validateRolledAbilities(assigned, seed);
      expect(res.valid).toBe(true);
      expect(res.errors).toEqual([]);
      expect(res.rolledScores).toEqual(pool.scores);
    });

    it('rejects tampered rolled scores or missing/invalid seed', () => {
      const seed = 9001;
      const pool = generateSeededAbilityRolls(seed);

      const tampered = {
        str: 18,
        dex: pool.scores[1]!,
        con: pool.scores[2]!,
        int: pool.scores[3]!,
        wis: pool.scores[4]!,
        cha: pool.scores[5]!,
      };
      // Ensure str was actually modified
      if (pool.scores[0] === 18) {
        tampered.str = 17;
      }

      const resTampered = validateRolledAbilities(tampered, seed);
      expect(resTampered.valid).toBe(false);
      expect(resTampered.missingScores).toEqual([pool.scores[0]!]);
      expect(resTampered.unexpectedScores).toEqual([tampered.str]);

      const resNoSeed = validateRolledAbilities(tampered, undefined);
      expect(resNoSeed.valid).toBe(false);
      expect(resNoSeed.errors[0]).toContain('abilityRollSeed');

      const resNegativeSeed = validateRolledAbilities(tampered, -5);
      expect(resNegativeSeed.valid).toBe(false);
    });
  });

  describe('Manual Validator & Unified validateAbilityGeneration Dispatcher', () => {
    it('validates manual scores within default [3..20] or custom bounds', () => {
      const validManual = createUniformAbilities(18);
      expect(validateManualAbilities(validManual).valid).toBe(true);

      const tooLow = { ...validManual, str: 2 };
      const resLow = validateManualAbilities(tooLow);
      expect(resLow.valid).toBe(false);
      expect(resLow.outOfRangeAbilities).toEqual(['str']);
    });

    it('dispatches all 4 ability generation methods via validateAbilityGeneration and validateCharacterBuildAbilities', () => {
      const stdState = {
        abilityMethod: 'standard_array' as const,
        baseAbilities: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
      };
      expect(validateCharacterBuildAbilities(stdState).valid).toBe(true);

      const pbState = {
        abilityMethod: 'point_buy' as const,
        baseAbilities: { str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 },
      };
      expect(validateCharacterBuildAbilities(pbState).valid).toBe(true);

      const seed = 777;
      const pool = generateSeededAbilityRolls(seed);
      const rolledAbilities = Object.fromEntries(
        ABILITY_IDS.map((id, idx) => [id, pool.scores[idx]!]),
      ) as typeof stdState.baseAbilities;

      expect(
        validateAbilityGeneration({
          method: 'rolled',
          baseAbilities: rolledAbilities,
          abilityRollSeed: seed,
        }).valid,
      ).toBe(true);

      expect(
        validateAbilityGeneration({
          method: 'manual',
          baseAbilities: createUniformAbilities(14),
        }).valid,
      ).toBe(true);
    });
  });
});
