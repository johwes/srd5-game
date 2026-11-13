import { BUNDLED_SRD_DATASET } from '@srd5/data';
import { describe, expect, it, vi } from 'vitest';
import {
  doubleFormulaAstDice,
  evaluateFormula,
  evaluateStaticFormula,
  formatFormulaAst,
  FormulaParseError,
  nextRandomFloat,
  nextRandomUint32,
  normalizeSeed,
  parseFormula,
  resolveFormulaVariable,
  resolveRollMode,
  rollAbilityScores4d6kh3,
  rollD20,
  rollDamage,
  rollDie,
  rollDiceExpression,
  rollMultipleDice,
  STANDARD_DIE_FACES,
  tryParseFormula,
  validateEngineFormula,
} from '../index.js';

/**
 * Helper to find a deterministic PRNG seed whose first `rollDie(seed, faces)` produces `targetRoll`.
 */
function findSeedForRoll(faces: number, targetRoll: number, startSeed = 1): number {
  for (let s = startSeed; s < startSeed + 100_000; s++) {
    if (rollDie(s, faces).roll === targetRoll) {
      return s;
    }
  }
  throw new Error(`Could not find seed for d${faces} === ${targetRoll}`);
}

/**
 * Helper to find a deterministic PRNG seed whose first two rolls of `faces` match `[first, second]`.
 */
function findSeedForTwoRolls(
  faces: number,
  first: number,
  second: number,
  startSeed = 1,
): number {
  for (let s = startSeed; s < startSeed + 500_000; s++) {
    const r1 = rollDie(s, faces);
    if (r1.roll !== first) continue;
    const r2 = rollDie(r1.nextState, faces);
    if (r2.roll === second) {
      return s;
    }
  }
  throw new Error(`Could not find seed for d${faces} sequence [${first}, ${second}]`);
}

describe('SRD-108: Deterministic Seeded PRNG (Mulberry32) & 5e Dice/Formula Evaluator', () => {
  describe('Seeded PRNG (Mulberry32) Determinism & Replay', () => {
    it('replays identical uint32, float, and die sequences for the same seed and never calls Math.random()', () => {
      const randomSpy = vi.spyOn(Math, 'random');

      const seed = 0x12345678;
      let stateA = seed;
      let stateB = seed;

      const seqA: number[] = [];
      const seqB: number[] = [];

      for (let i = 0; i < 50; i++) {
        const stepA = nextRandomUint32(stateA);
        const stepB = nextRandomUint32(stateB);
        expect(stepA.value).toBe(stepB.value);
        expect(stepA.nextState).toBe(stepB.nextState);
        seqA.push(stepA.value);
        seqB.push(stepB.value);
        stateA = stepA.nextState;
        stateB = stepB.nextState;
      }

      expect(seqA).toEqual(seqB);

      // Different seed produces a different sequence
      let stateC = 0x87654321;
      const seqC: number[] = [];
      for (let i = 0; i < 50; i++) {
        const stepC = nextRandomUint32(stateC);
        seqC.push(stepC.value);
        stateC = stepC.nextState;
      }
      expect(seqC).not.toEqual(seqA);

      // Float range check [0, 1)
      let floatState = 42;
      for (let i = 0; i < 100; i++) {
        const f = nextRandomFloat(floatState);
        expect(f.value).toBeGreaterThanOrEqual(0);
        expect(f.value).toBeLessThan(1);
        floatState = f.nextState;
      }

      expect(normalizeSeed(NaN)).toBe(0);
      expect(normalizeSeed(-1)).toBe(0xffffffff);
      expect(randomSpy).not.toHaveBeenCalled();
      randomSpy.mockRestore();
    });

    it('rolls all standard 5e dice (d4, d6, d8, d10, d12, d20, d100) within exact [1..faces] bounds', () => {
      let state = 9999;
      for (const faces of STANDARD_DIE_FACES) {
        const seen = new Set<number>();
        for (let i = 0; i < faces * 30; i++) {
          const { roll, nextState } = rollDie(state, faces);
          expect(Number.isInteger(roll)).toBe(true);
          expect(roll).toBeGreaterThanOrEqual(1);
          expect(roll).toBeLessThanOrEqual(faces);
          seen.add(roll);
          state = nextState;
        }
        // For d4..d20, 30x rolls should hit every face at least once
        if (faces <= 20) {
          expect(seen.size).toBe(faces);
        }
      }

      const multi = rollMultipleDice(1234, 5, 8);
      expect(multi.rolls).toHaveLength(5);
      expect(rollMultipleDice(1234, 5, 8).rolls).toEqual(multi.rolls);

      expect(() => rollDie(1, 0)).toThrow(RangeError);
      expect(() => rollDie(1, -6)).toThrow(RangeError);
      expect(() => rollMultipleDice(1, -1, 6)).toThrow(RangeError);
    });
  });

  describe('2d20kh1 (Advantage), 2d20kl1 (Disadvantage), and Cancellation Rule', () => {
    it('evaluates 2d20kh1 (Advantage) by keeping the highest of 2d20', () => {
      const seed = findSeedForTwoRolls(20, 5, 18);

      // Explicit notation 2d20kh1
      const explicitRes = evaluateFormula('2d20kh1 + 4', { rngState: seed });
      expect(explicitRes.record.mode).toBe('advantage');
      expect(explicitRes.record.rolls).toEqual([5, 18]);
      expect(explicitRes.record.kept).toEqual([18]);
      expect(explicitRes.record.diceGroups[0]?.dropped).toEqual([5]);
      expect(explicitRes.record.modifier).toBe(4);
      expect(explicitRes.total).toBe(22);
      expect(explicitRes.record.naturalRoll).toBe(18);

      // Roll mode option on 1d20
      const modeRes = rollD20(seed, { mode: 'advantage', modifier: 4 });
      expect(modeRes.record.mode).toBe('advantage');
      expect(modeRes.record.resolvedNotation).toBe('2d20kh1 + 4');
      expect(modeRes.record.rolls).toEqual([5, 18]);
      expect(modeRes.record.kept).toEqual([18]);
      expect(modeRes.naturalRoll).toBe(18);
      expect(modeRes.total).toBe(22);
      expect(modeRes.nextState).toBe(explicitRes.nextState);
    });

    it('evaluates 2d20kl1 (Disadvantage) by keeping the lowest of 2d20', () => {
      const seed = findSeedForTwoRolls(20, 17, 3);

      // Explicit notation 2d20kl1
      const explicitRes = evaluateFormula('2d20kl1 + 4', { rngState: seed });
      expect(explicitRes.record.mode).toBe('disadvantage');
      expect(explicitRes.record.rolls).toEqual([17, 3]);
      expect(explicitRes.record.kept).toEqual([3]);
      expect(explicitRes.record.diceGroups[0]?.dropped).toEqual([17]);
      expect(explicitRes.record.modifier).toBe(4);
      expect(explicitRes.total).toBe(7);
      expect(explicitRes.record.naturalRoll).toBe(3);

      // Roll mode option on 1d20
      const modeRes = rollD20(seed, { mode: 'disadvantage', modifier: 4 });
      expect(modeRes.record.mode).toBe('disadvantage');
      expect(modeRes.record.resolvedNotation).toBe('2d20kl1 + 4');
      expect(modeRes.record.rolls).toEqual([17, 3]);
      expect(modeRes.record.kept).toEqual([3]);
      expect(modeRes.naturalRoll).toBe(3);
      expect(modeRes.total).toBe(7);
      expect(modeRes.nextState).toBe(explicitRes.nextState);
    });

    it('enforces the SRD 5.1 Advantage + Disadvantage Cancellation Rule regardless of source counts', () => {
      expect(resolveRollMode({ advantageCount: 1, disadvantageCount: 1 })).toBe('normal');
      expect(resolveRollMode({ advantageCount: 3, disadvantageCount: 1 })).toBe('normal');
      expect(resolveRollMode({ advantageCount: 1, disadvantageCount: 4 })).toBe('normal');
      expect(
        resolveRollMode({
          advantageSources: ['pack_tactics', 'invisible', 'guiding_bolt'],
          disadvantageSources: ['prone'],
        }),
      ).toBe('normal');
      expect(resolveRollMode({ advantageSources: ['pack_tactics'] })).toBe('advantage');
      expect(resolveRollMode({ disadvantageSources: ['poisoned'] })).toBe('disadvantage');

      const seed = findSeedForTwoRolls(20, 11, 19);
      const singleDieExpected = rollDie(seed, 20);

      // 3 Advantage sources vs 1 Disadvantage source cancels to a single 1d20 roll
      const cancelled = rollD20(seed, {
        advantageCount: 3,
        disadvantageCount: 1,
        modifier: 5,
      });
      expect(cancelled.record.mode).toBe('normal');
      expect(cancelled.record.resolvedNotation).toBe('1d20 + 5');
      expect(cancelled.record.rolls).toEqual([11]);
      expect(cancelled.record.kept).toEqual([11]);
      expect(cancelled.total).toBe(16);
      // Only 1 PRNG step was consumed because the roll cancelled to 1d20
      expect(cancelled.nextState).toBe(singleDieExpected.nextState);

      // Cancellation also overrides explicit 2d20kh1 if both sources are present
      const cancelledExplicit = evaluateFormula('2d20kh1 + 5', {
        rngState: seed,
        advantageSources: ['reckless_attack'],
        disadvantageSources: ['frightened'],
      });
      expect(cancelledExplicit.record.mode).toBe('normal');
      expect(cancelledExplicit.record.rolls).toEqual([11]);
      expect(cancelledExplicit.total).toBe(16);
    });
  });

  describe('4d6kh3 Ability Score Generation', () => {
    it('rolls 4d6, drops the lowest die, and sums the highest 3 dice', () => {
      const res = evaluateFormula('4d6kh3', { rngState: 101 });
      const group = res.record.diceGroups[0]!;
      expect(group.count).toBe(4);
      expect(group.faces).toBe(6);
      expect(group.rolls).toHaveLength(4);
      expect(group.kept).toHaveLength(3);
      expect(group.dropped).toHaveLength(1);

      const minRolled = Math.min(...group.rolls);
      expect(group.dropped[0]).toBe(minRolled);
      expect(res.total).toBe(group.kept[0]! + group.kept[1]! + group.kept[2]!);

      // Verify 4d6dl1 (drop lowest 1) produces identical result for the same seed
      const dlRes = evaluateFormula('4d6dl1', { rngState: 101 });
      expect(dlRes.record.rolls).toEqual(res.record.rolls);
      expect(dlRes.record.kept).toEqual(res.record.kept);
      expect(dlRes.total).toBe(res.total);
    });

    it('generates a deterministic 6-ability array via rollAbilityScores4d6kh3', () => {
      const setA = rollAbilityScores4d6kh3(777);
      const setB = rollAbilityScores4d6kh3(777);
      expect(setA.scores).toHaveLength(6);
      expect(setA.records).toHaveLength(6);
      expect(setA.scores).toEqual(setB.scores);
      expect(setA.nextState).toBe(setB.nextState);

      for (const score of setA.scores) {
        expect(score).toBeGreaterThanOrEqual(3);
        expect(score).toBeLessThanOrEqual(18);
      }
    });
  });

  describe('Halfling Lucky Rerolls', () => {
    it('automatically rerolls a natural 1 on the active d20 once and records both rolls in DiceRollRecord', () => {
      // Find a seed that rolls 1 on d20 followed by 15 on d20
      const seed = findSeedForTwoRolls(20, 1, 15);

      const luckyRes = rollD20(seed, {
        halflingLucky: true,
        modifier: 4,
      });

      expect(luckyRes.naturalRoll).toBe(15);
      expect(luckyRes.total).toBe(19);
      expect(luckyRes.isFumble).toBe(false);
      expect(luckyRes.record.halflingLuckyReroll).toEqual({
        initialRoll: 1,
        replacementRoll: 15,
      });
      expect(luckyRes.record.rerolledInitialRolls).toEqual([1]);
      expect(luckyRes.record.rolls).toEqual([1, 15]);
      expect(luckyRes.record.kept).toEqual([15]);

      const dieSlot = luckyRes.record.diceGroups[0]?.dice[0];
      expect(dieSlot?.initialRoll).toBe(1);
      expect(dieSlot?.value).toBe(15);
      expect(dieSlot?.history).toEqual([1, 15]);
      expect(dieSlot?.rerolled).toBe(true);
      expect(dieSlot?.rerollReason).toBe('halfling_lucky');
    });

    it('rerolls at most once even if the replacement d20 also rolls a 1', () => {
      const seedDoubleOne = findSeedForTwoRolls(20, 1, 1);

      const res = rollD20(seedDoubleOne, {
        dieManipulations: [{ rule: 'halfling_lucky' }],
        modifier: 3,
      });

      expect(res.naturalRoll).toBe(1);
      expect(res.isFumble).toBe(true);
      expect(res.total).toBe(4);
      expect(res.record.halflingLuckyReroll).toEqual({
        initialRoll: 1,
        replacementRoll: 1,
      });
      expect(res.record.rolls).toEqual([1, 1]);
      expect(res.record.kept).toEqual([1]);
    });

    it('does not reroll or advance PRNG when the active d20 is not 1', () => {
      const seedNotOne = findSeedForRoll(20, 12);
      const singleStep = rollDie(seedNotOne, 20);

      const res = rollD20(seedNotOne, {
        halflingLucky: true,
        modifier: 2,
      });

      expect(res.naturalRoll).toBe(12);
      expect(res.record.halflingLuckyReroll).toBeUndefined();
      expect(res.record.rolls).toEqual([12]);
      expect(res.nextState).toBe(singleStep.nextState);
    });
  });

  describe('Great Weapon Fighting Rerolls', () => {
    it('rerolls any damage die showing 1 or 2 once and keeps 3+ untouched', () => {
      // Find a seed where d6 rolls a 2 first, then a 5 on the reroll
      const seed = findSeedForTwoRolls(6, 2, 5);
      const afterSecond = rollDie(rollDie(seed, 6).nextState, 6);
      const thirdDieRoll = rollDie(afterSecond.nextState, 6);

      // Roll 2d6 + 3 with Great Weapon Fighting:
      // Die 1 rolls 2 -> rerolls 5
      // Die 2 rolls thirdDieRoll.roll (if 1 or 2 it also rerolls; pick a seed where thirdDieRoll >= 3)
      let gwfSeed = seed;
      for (let s = 1; s < 500_000; s++) {
        const r1 = rollDie(s, 6);
        if (r1.roll !== 1 && r1.roll !== 2) continue;
        const r1Reroll = rollDie(r1.nextState, 6);
        if (r1Reroll.roll < 4) continue;
        const r2 = rollDie(r1Reroll.nextState, 6);
        if (r2.roll >= 3) {
          gwfSeed = s;
          break;
        }
      }

      const d1Init = rollDie(gwfSeed, 6);
      const d1Replacement = rollDie(d1Init.nextState, 6);
      const d2 = rollDie(d1Replacement.nextState, 6);

      const damageRes = rollDamage(gwfSeed, '2d6 + @strMod', {
        greatWeaponFighting: true,
        context: { '@strMod': 4 },
      });

      const group = damageRes.record.diceGroups[0]!;
      expect(group.dice[0]?.initialRoll).toBe(d1Init.roll);
      expect(group.dice[0]?.value).toBe(d1Replacement.roll);
      expect(group.dice[0]?.history).toEqual([d1Init.roll, d1Replacement.roll]);
      expect(group.dice[0]?.rerolled).toBe(true);
      expect(group.dice[0]?.rerollReason).toBe('great_weapon_fighting');

      expect(group.dice[1]?.initialRoll).toBe(d2.roll);
      expect(group.dice[1]?.value).toBe(d2.roll);
      expect(group.dice[1]?.rerolled).toBe(false);

      expect(damageRes.record.rerolledInitialRolls).toEqual([d1Init.roll]);
      expect(damageRes.record.rolls).toEqual([d1Init.roll, d1Replacement.roll, d2.roll]);
      expect(damageRes.record.kept).toEqual([d1Replacement.roll, d2.roll]);
      expect(damageRes.total).toBe(d1Replacement.roll + d2.roll + 4);
      expect(damageRes.nextState).toBe(d2.nextState);
    });

    it('rerolls 1 or 2 only once even if the replacement roll is also 1 or 2', () => {
      const seed = findSeedForTwoRolls(10, 1, 2);
      const res = rollDamage(seed, '1d10 + 3', {
        dieManipulations: [{ rule: 'great_weapon_fighting' }],
      });

      expect(res.record.diceGroups[0]?.dice[0]?.history).toEqual([1, 2]);
      expect(res.record.kept).toEqual([2]);
      expect(res.total).toBe(5);
    });
  });

  describe('Critical Hit Dice Doubling & Brutal Critical / Savage Attacks', () => {
    it('doubles all damage dice on a critical hit while adding flat modifiers once', () => {
      const seed = 4242;
      const normal = rollDamage(seed, '1d8 + 2d6 + @dexMod + 1', {
        critical: false,
        context: { '@dexMod': 4 },
      });
      expect(normal.record.resolvedNotation).toBe('1d8 + 2d6 + 4 + 1');
      expect(normal.record.diceGroups[0]?.count).toBe(1);
      expect(normal.record.diceGroups[1]?.count).toBe(2);
      expect(normal.record.kept).toHaveLength(3);
      expect(normal.record.modifier).toBe(5);

      const crit = rollDamage(seed, '1d8 + 2d6 + @dexMod + 1', {
        critical: true,
        context: { '@dexMod': 4 },
      });
      expect(crit.record.resolvedNotation).toBe('2d8 + 4d6 + 4 + 1');
      expect(crit.record.diceGroups[0]?.count).toBe(2);
      expect(crit.record.diceGroups[1]?.count).toBe(4);
      expect(crit.record.kept).toHaveLength(6);
      // Flat modifiers (@dexMod + 1 = 5) are added only once!
      expect(crit.record.modifier).toBe(5);
      expect(crit.total).toBe(
        crit.record.kept.reduce((sum, v) => sum + v, 0) + 5,
      );
    });

    it('adds Brutal Critical and Savage Attacks extra weapon dice on a critical hit', () => {
      const critGreataxe = rollDamage(100, '1d12 + @strMod', {
        critical: true,
        context: { '@strMod': 5 },
        dieManipulations: [
          { rule: 'brutal_critical', params: { extraDice: 1 } },
          { rule: 'savage_attacks' },
        ],
      });
      // Base 1d12 doubled to 2d12 + 1 (Brutal Critical) + 1 (Savage Attacks) = 4d12
      expect(critGreataxe.record.resolvedNotation).toBe('4d12 + 5');
      expect(critGreataxe.record.diceGroups[0]?.count).toBe(4);
      expect(critGreataxe.record.modifier).toBe(5);

      // AST transform helper doubleFormulaAstDice
      const doubledAst = doubleFormulaAstDice(parseFormula('2d6 + 1d4 + @strMod'), 1);
      expect(formatFormulaAst(doubledAst)).toBe('5d6 + 2d4 + @strMod');
    });

    it('supports Champion Improved Critical (19-20) and Superior Critical (18-20) on d20 rolls', () => {
      const seed19 = findSeedForRoll(20, 19);
      const seed18 = findSeedForRoll(20, 18);

      const normal19 = rollD20(seed19, { modifier: 5 });
      expect(normal19.naturalRoll).toBe(19);
      expect(normal19.isCrit).toBe(false);

      const improved19 = rollD20(seed19, {
        modifier: 5,
        dieManipulations: [{ rule: 'expanded_crit_range', params: { minCritRoll: 19 } }],
      });
      expect(improved19.naturalRoll).toBe(19);
      expect(improved19.isCrit).toBe(true);

      const superior18 = rollD20(seed18, {
        modifier: 5,
        critRange: 18,
      });
      expect(superior18.naturalRoll).toBe(18);
      expect(superior18.isCrit).toBe(true);
    });
  });

  describe('Variable Substitution & Formula AST Functions', () => {
    it('substitutes @strMod, @prof, @slotLevel, and all canonical variables accurately', () => {
      const context = {
        '@strMod': 4,
        '@dexMod': 2,
        '@conMod': 3,
        '@intMod': -1,
        '@wisMod': 1,
        '@chaMod': 3,
        '@prof': 3,
        '@charLevel': 5,
        '@classLevel': 5,
        '@slotLevel': 3,
        '@spellMod': 4,
        '@spellSaveDC': 15,
      } as const;

      // Static formulas
      expect(evaluateStaticFormula('10 + @dexMod + @conMod', context)).toBe(15);
      expect(evaluateStaticFormula('8 + @prof + @spellMod', context)).toBe(15);
      expect(evaluateStaticFormula('max(1, @chaMod)', context)).toBe(3);
      expect(evaluateStaticFormula('max(1, @intMod)', context)).toBe(1);
      expect(evaluateStaticFormula('min(2, @dexMod)', context)).toBe(2);
      expect(evaluateStaticFormula('floor(@classLevel / 2)', context)).toBe(2);
      expect(evaluateStaticFormula('ceil(@charLevel / 2)', context)).toBe(3);
      expect(evaluateStaticFormula('3 + (@slotLevel - 1)', context)).toBe(5);

      // Supports bare variable names (without '@') in context as well
      expect(
        evaluateStaticFormula('10 + @strMod + @prof', { strMod: 3, prof: 2 }),
      ).toBe(15);

      // Dynamic dice count expression: (@slotLevel + 5)d6 with @slotLevel = 3 -> 8d6
      const fireballUpcast = evaluateFormula('(@slotLevel + 5)d6', {
        rngState: 555,
        context,
      });
      expect(fireballUpcast.record.resolvedNotation).toBe('8d6');
      expect(fireballUpcast.record.diceGroups[0]?.count).toBe(8);
      expect(fireballUpcast.record.kept).toHaveLength(8);

      // Weapon damage with @strMod and @prof
      const attackDamage = rollDiceExpression(555, '1d8 + @strMod + @prof', {
        context,
      });
      expect(attackDamage.record.resolvedNotation).toBe('1d8 + 4 + 3');
      expect(attackDamage.record.modifier).toBe(7);
      expect(attackDamage.total).toBe(attackDamage.record.kept[0]! + 7);

      // Negative dice modifier (e.g. Bane '-1d4')
      const baneRoll = evaluateFormula('-1d4', { rngState: 555 });
      expect(baneRoll.total).toBe(-baneRoll.record.kept[0]!);
      expect(baneRoll.record.modifier).toBe(0);
    });

    it('rejects invalid syntax, unknown variables, division by zero, and dice in evaluateStaticFormula', () => {
      expect(() => parseFormula('')).toThrow(FormulaParseError);
      expect(() => parseFormula('1d20 + @unknownVar')).toThrow(FormulaParseError);
      expect(() => parseFormula('unknownFn(1, 2)')).toThrow(FormulaParseError);
      expect(() => parseFormula('floor(1, 2)')).toThrow(FormulaParseError);
      expect(() => parseFormula('max(1)')).toThrow(FormulaParseError);
      expect(() => parseFormula('1d8 + ()')).toThrow(FormulaParseError);
      expect(() => parseFormula('1d8 +')).toThrow(FormulaParseError);
      expect(() => evaluateStaticFormula('1d8 + 2')).toThrow(/cannot contain dice term/);
      expect(() => evaluateFormula('10 / 0')).toThrow(/Division by zero/);
      expect(() =>
        resolveFormulaVariable('@strMod', {}, true),
      ).toThrow(/Missing required formula variable/);
      expect(tryParseFormula('invalid @@').valid).toBe(false);
    });

    it('parses and evaluates 100% of formulas in the bundled SRD 5.1 dataset (@srd5/data)', () => {
      const formulas: string[] = [];

      for (const cls of BUNDLED_SRD_DATASET.classes) {
        formulas.push(cls.startingGoldFormula);
      }
      for (const eq of BUNDLED_SRD_DATASET.equipment) {
        if (eq.kind === 'weapon') {
          formulas.push(eq.damageDice);
          if (eq.versatileDamageDice) {
            formulas.push(eq.versatileDamageDice);
          }
        }
      }
      for (const monster of BUNDLED_SRD_DATASET.monsters) {
        formulas.push(monster.hitPoints.rollFormula);
        for (const action of monster.actions) {
          for (const effect of action.effects) {
            if (effect.step === 'deal_damage' || effect.step === 'heal') {
              formulas.push(effect.diceFormula);
            } else if (effect.step === 'saving_throw') {
              formulas.push(effect.dcFormula);
              for (const sub of effect.onFail) {
                if (sub.step === 'deal_damage' || sub.step === 'heal') {
                  formulas.push(sub.diceFormula);
                }
              }
            } else if (effect.step === 'attack_roll') {
              for (const sub of effect.onHit) {
                if (sub.step === 'deal_damage' || sub.step === 'heal') {
                  formulas.push(sub.diceFormula);
                }
              }
            }
          }
        }
      }
      for (const spell of BUNDLED_SRD_DATASET.spells) {
        if (typeof spell.targeting.maxTargets === 'string') {
          formulas.push(spell.targeting.maxTargets);
        }
        for (const effect of spell.effects) {
          if (effect.step === 'deal_damage' || effect.step === 'heal') {
            formulas.push(effect.diceFormula);
          } else if (effect.step === 'grant_temp_hp') {
            formulas.push(effect.amountFormula);
          } else if (effect.step === 'saving_throw') {
            formulas.push(effect.dcFormula);
          }
        }
      }

      for (const feat of BUNDLED_SRD_DATASET.features) {
        for (const mod of feat.modifiers) {
          if (mod.type === 'ac_calculation') formulas.push(mod.formula);
          if (mod.type === 'flat_bonus' && typeof mod.value === 'string') formulas.push(mod.value);
          if (mod.type === 'grant_resource') formulas.push(mod.maxFormula);
        }
        for (const ab of feat.activatedAbilities ?? []) {
          for (const effect of ab.effects) {
            if (effect.step === 'deal_damage' || effect.step === 'heal') {
              formulas.push(effect.diceFormula);
            }
          }
        }
      }

      expect(formulas.length).toBeGreaterThan(150);

      const sampleContext = {
        '@strMod': 3,
        '@dexMod': 2,
        '@conMod': 2,
        '@intMod': 4,
        '@wisMod': 3,
        '@chaMod': 2,
        '@prof': 2,
        '@charLevel': 5,
        '@classLevel': 5,
        '@slotLevel': 3,
        '@spellMod': 4,
        '@spellSaveDC': 14,
      };

      for (const formula of formulas) {
        const parsed = validateEngineFormula(formula);
        expect(parsed.valid, `Failed to parse SRD formula "${formula}"`).toBe(true);
        const evalRes = evaluateFormula(formula, {
          rngState: 12345,
          context: sampleContext,
        });
        expect(Number.isFinite(evalRes.total)).toBe(true);
      }
    });
  });
});
