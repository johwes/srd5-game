import { ABILITY_IDS, type AbilityId } from '@srd5/data';
import {
  type AbilityRollSetResult,
  type DiceRollRecord,
  rollAbilityScores4d6kh3,
} from '../dice/evaluator.js';
import { normalizeSeed } from '../dice/prng.js';
import type {
  AbilityGenerationMethod,
  BaseAbilities,
  CharacterBuildState,
} from './schemas.js';

// ============================================================================
// 1. SRD 5.1 Ability Generation Constants
// ============================================================================

/**
 * Canonical SRD 5.1 Standard Array values (`[15, 14, 13, 12, 10, 8]`).
 */
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;

/**
 * Total point budget for SRD 5.1 Point Buy ability generation.
 */
export const POINT_BUY_BUDGET = 27 as const;

/**
 * Minimum base ability score allowed in SRD 5.1 Point Buy (before racial bonuses).
 */
export const POINT_BUY_MIN_SCORE = 8 as const;

/**
 * Maximum base ability score allowed in SRD 5.1 Point Buy (before racial bonuses).
 */
export const POINT_BUY_MAX_SCORE = 15 as const;

/**
 * SRD 5.1 Point Buy ability score cost table (`8 -> 0` up to `15 -> 9`).
 */
export const POINT_BUY_COST_TABLE: Readonly<Record<number, number>> = {
  8: 0,
  9: 1,
  10: 2,
  11: 3,
  12: 4,
  13: 5,
  14: 7,
  15: 9,
} as const;

/**
 * Default minimum base ability score for manual entry (`3`, equivalent to min 3d6).
 */
export const MANUAL_MIN_BASE_SCORE = 3 as const;

/**
 * Default maximum base ability score for manual entry before racial/ASI bonuses (`18`, or `20` cap).
 */
export const MANUAL_MAX_BASE_SCORE = 20 as const;

// ============================================================================
// 2. Core Ability Math & Multiset Helpers
// ============================================================================

/**
 * Computes the SRD 5.1 ability modifier for a given ability score:
 * `floor((score - 10) / 2)`.
 */
export function computeAbilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/**
 * Extracts the 6 ability scores from a `BaseAbilities` object in canonical `ABILITY_IDS` order.
 */
export function getAbilityScoreList(abilities: BaseAbilities): number[] {
  return ABILITY_IDS.map((id) => abilities[id]);
}

/**
 * Compares an assigned list of 6 ability scores against a target multiset of 6 scores.
 * Returns whether the multisets match, plus any missing or unexpected values.
 */
function diffScoreMultisets(
  assigned: readonly number[],
  target: readonly number[],
): {
  matches: boolean;
  missingFromTarget: number[];
  unexpectedInAssigned: number[];
} {
  const remainingTarget = [...target];
  const unexpectedInAssigned: number[] = [];

  for (const score of assigned) {
    const idx = remainingTarget.indexOf(score);
    if (idx !== -1) {
      remainingTarget.splice(idx, 1);
    } else {
      unexpectedInAssigned.push(score);
    }
  }

  return {
    matches: remainingTarget.length === 0 && unexpectedInAssigned.length === 0,
    missingFromTarget: remainingTarget.sort((a, b) => b - a),
    unexpectedInAssigned: unexpectedInAssigned.sort((a, b) => b - a),
  };
}

// ============================================================================
// 3. Validation Result Types
// ============================================================================

export interface BaseAbilityValidationResult {
  valid: boolean;
  method: AbilityGenerationMethod;
  errors: string[];
}

export interface StandardArrayValidationResult extends BaseAbilityValidationResult {
  method: 'standard_array';
  assignedScores: number[];
  missingScores: number[];
  unexpectedScores: number[];
}

export interface PointBuySummary {
  budget: number;
  pointsSpent: number;
  pointsRemaining: number;
  costByAbility: Record<AbilityId, number | null>;
  outOfRangeAbilities: AbilityId[];
  canIncrement: Record<AbilityId, boolean>;
  canDecrement: Record<AbilityId, boolean>;
}

export interface PointBuyValidationOptions {
  /** Total point budget (defaults to `27`). */
  budget?: number | undefined;
  /** If true, allows valid scores in `8..15` that spend fewer than `budget` points. Defaults to `false`. */
  allowUnspentPoints?: boolean | undefined;
}

export interface PointBuyValidationResult
  extends BaseAbilityValidationResult,
    PointBuySummary {
  method: 'point_buy';
}

export interface SeededAbilityRollPool {
  seed: number;
  normalizedSeed: number;
  scores: [number, number, number, number, number, number];
  sortedScores: [number, number, number, number, number, number];
  records: AbilityRollSetResult['records'];
  totalSum: number;
  nextState: number;
}

export interface RolledAbilityValidationResult extends BaseAbilityValidationResult {
  method: 'rolled';
  seed?: number | undefined;
  rolledScores?: [number, number, number, number, number, number] | undefined;
  records?:
    | [
        DiceRollRecord,
        DiceRollRecord,
        DiceRollRecord,
        DiceRollRecord,
        DiceRollRecord,
        DiceRollRecord,
      ]
    | undefined;
  missingScores: number[];
  unexpectedScores: number[];
}

export interface ManualAbilityValidationOptions {
  minScore?: number | undefined;
  maxScore?: number | undefined;
}

export interface ManualAbilityValidationResult extends BaseAbilityValidationResult {
  method: 'manual';
  minScore: number;
  maxScore: number;
  outOfRangeAbilities: AbilityId[];
}

export type AbilityGenerationValidationResult =
  | StandardArrayValidationResult
  | PointBuyValidationResult
  | RolledAbilityValidationResult
  | ManualAbilityValidationResult;

// ============================================================================
// 4. Standard Array Validator (`[15, 14, 13, 12, 10, 8]`)
// ============================================================================

/**
 * Validates that `abilities` is an exact permutation of the SRD 5.1 Standard Array
 * (`[15, 14, 13, 12, 10, 8]`).
 */
export function validateStandardArray(
  abilities: BaseAbilities,
): StandardArrayValidationResult {
  const errors: string[] = [];
  const assignedScores = getAbilityScoreList(abilities);

  for (const abilityId of ABILITY_IDS) {
    const score = abilities[abilityId];
    if (!Number.isInteger(score)) {
      errors.push(`Ability '${abilityId}' score (${String(score)}) must be an integer.`);
    }
  }

  const { matches, missingFromTarget, unexpectedInAssigned } = diffScoreMultisets(
    assignedScores,
    STANDARD_ARRAY,
  );

  if (!matches) {
    errors.push(
      `Standard Array requires an exact permutation of [${STANDARD_ARRAY.join(', ')}]. ` +
        `Missing: [${missingFromTarget.join(', ')}]; unexpected: [${unexpectedInAssigned.join(', ')}].`,
    );
  }

  return {
    valid: errors.length === 0,
    method: 'standard_array',
    errors,
    assignedScores,
    missingScores: missingFromTarget,
    unexpectedScores: unexpectedInAssigned,
  };
}

// ============================================================================
// 5. 27-Point Buy Cost Calculator & Validator
// ============================================================================

/**
 * Returns the SRD 5.1 Point Buy cost for a single ability score (`8..15`),
 * or `undefined` if the score is outside the legal Point Buy range.
 */
export function getPointBuyScoreCost(score: number): number | undefined {
  if (!Number.isInteger(score)) {
    return undefined;
  }
  return POINT_BUY_COST_TABLE[score];
}

/**
 * Computes the complete Point Buy expenditure summary, remaining points, and per-ability
 * increment/decrement eligibility for UI controls and validation.
 */
export function calculatePointBuySummary(
  abilities: BaseAbilities,
  budget: number = POINT_BUY_BUDGET,
): PointBuySummary {
  const costByAbility = {} as Record<AbilityId, number | null>;
  const outOfRangeAbilities: AbilityId[] = [];
  let pointsSpent = 0;

  for (const abilityId of ABILITY_IDS) {
    const score = abilities[abilityId];
    const cost = getPointBuyScoreCost(score);
    if (cost === undefined) {
      costByAbility[abilityId] = null;
      outOfRangeAbilities.push(abilityId);
    } else {
      costByAbility[abilityId] = cost;
      pointsSpent += cost;
    }
  }

  const pointsRemaining = budget - pointsSpent;
  const allInRange = outOfRangeAbilities.length === 0;

  const canIncrement = {} as Record<AbilityId, boolean>;
  const canDecrement = {} as Record<AbilityId, boolean>;

  for (const abilityId of ABILITY_IDS) {
    const score = abilities[abilityId];
    const currentCost = getPointBuyScoreCost(score);
    const nextCost = getPointBuyScoreCost(score + 1);

    if (
      allInRange &&
      currentCost !== undefined &&
      nextCost !== undefined &&
      score < POINT_BUY_MAX_SCORE
    ) {
      const marginalCost = nextCost - currentCost;
      canIncrement[abilityId] = marginalCost <= pointsRemaining;
    } else {
      canIncrement[abilityId] = false;
    }

    canDecrement[abilityId] =
      currentCost !== undefined &&
      score > POINT_BUY_MIN_SCORE &&
      score <= POINT_BUY_MAX_SCORE;
  }

  return {
    budget,
    pointsSpent,
    pointsRemaining,
    costByAbility,
    outOfRangeAbilities,
    canIncrement,
    canDecrement,
  };
}

/**
 * Validates `abilities` against the SRD 5.1 27-Point Buy rules:
 * - Every base score must be an integer between 8 and 15 (inclusive).
 * - Total cost across all 6 scores must equal `budget` (27 by default, or `<= budget` when `allowUnspentPoints` is true).
 */
export function validatePointBuy(
  abilities: BaseAbilities,
  options?: PointBuyValidationOptions,
): PointBuyValidationResult {
  const budget = options?.budget ?? POINT_BUY_BUDGET;
  const allowUnspentPoints = options?.allowUnspentPoints ?? false;
  const summary = calculatePointBuySummary(abilities, budget);
  const errors: string[] = [];

  for (const abilityId of summary.outOfRangeAbilities) {
    const score = abilities[abilityId];
    errors.push(
      `Point Buy score for '${abilityId}' (${String(score)}) must be an integer between ${POINT_BUY_MIN_SCORE} and ${POINT_BUY_MAX_SCORE}.`,
    );
  }

  if (summary.outOfRangeAbilities.length === 0) {
    if (summary.pointsSpent > budget) {
      errors.push(
        `Point Buy total cost (${summary.pointsSpent}) exceeds the ${budget}-point budget by ${summary.pointsSpent - budget}.`,
      );
    } else if (!allowUnspentPoints && summary.pointsSpent < budget) {
      errors.push(
        `Point Buy total cost (${summary.pointsSpent}) must spend all ${budget} points (${summary.pointsRemaining} point(s) unspent).`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    method: 'point_buy',
    errors,
    ...summary,
  };
}

// ============================================================================
// 6. Seeded `4d6kh3` Roll Generator & Validator
// ============================================================================

/**
 * Deterministically rolls 6 ability scores using `4d6kh3` (roll 4d6, keep highest 3)
 * from the provided `seed`.
 */
export function generateSeededAbilityRolls(seed: number): SeededAbilityRollPool {
  const normalizedSeed = normalizeSeed(seed);
  const rollSet = rollAbilityScores4d6kh3(normalizedSeed);
  const sortedScores = [...rollSet.scores].sort((a, b) => b - a) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const totalSum = rollSet.scores.reduce((sum, s) => sum + s, 0);

  return {
    seed,
    normalizedSeed,
    scores: rollSet.scores,
    sortedScores,
    records: rollSet.records,
    totalSum,
    nextState: rollSet.nextState,
  };
}

/**
 * Validates that `abilities` is an exact permutation of the 6 `4d6kh3` scores
 * deterministically generated from `seed`.
 */
export function validateRolledAbilities(
  abilities: BaseAbilities,
  seed?: number,
): RolledAbilityValidationResult {
  const errors: string[] = [];

  if (seed === undefined || !Number.isInteger(seed) || seed < 0) {
    errors.push(
      'Rolled ability score generation requires a non-negative integer abilityRollSeed.',
    );
    return {
      valid: false,
      method: 'rolled',
      seed,
      errors,
      missingScores: [],
      unexpectedScores: getAbilityScoreList(abilities),
    };
  }

  for (const abilityId of ABILITY_IDS) {
    const score = abilities[abilityId];
    if (!Number.isInteger(score)) {
      errors.push(`Ability '${abilityId}' score (${String(score)}) must be an integer.`);
    }
  }

  const rollPool = generateSeededAbilityRolls(seed);
  const assignedScores = getAbilityScoreList(abilities);
  const { matches, missingFromTarget, unexpectedInAssigned } = diffScoreMultisets(
    assignedScores,
    rollPool.scores,
  );

  if (!matches) {
    errors.push(
      `Assigned rolled scores do not match the seeded 4d6kh3 pool [${rollPool.scores.join(', ')}] for seed ${seed}. ` +
        `Missing: [${missingFromTarget.join(', ')}]; unexpected: [${unexpectedInAssigned.join(', ')}].`,
    );
  }

  return {
    valid: errors.length === 0,
    method: 'rolled',
    seed,
    rolledScores: rollPool.scores,
    records: rollPool.records,
    errors,
    missingScores: missingFromTarget,
    unexpectedScores: unexpectedInAssigned,
  };
}

// ============================================================================
// 7. Manual Ability Score Validator & Unified Dispatcher
// ============================================================================

/**
 * Validates manually entered base ability scores against `[minScore, maxScore]` bounds
 * (defaults to `3..20`).
 */
export function validateManualAbilities(
  abilities: BaseAbilities,
  options?: ManualAbilityValidationOptions,
): ManualAbilityValidationResult {
  const minScore = options?.minScore ?? MANUAL_MIN_BASE_SCORE;
  const maxScore = options?.maxScore ?? MANUAL_MAX_BASE_SCORE;
  const errors: string[] = [];
  const outOfRangeAbilities: AbilityId[] = [];

  for (const abilityId of ABILITY_IDS) {
    const score = abilities[abilityId];
    if (!Number.isInteger(score) || score < minScore || score > maxScore) {
      outOfRangeAbilities.push(abilityId);
      errors.push(
        `Manual ability score for '${abilityId}' (${String(score)}) must be an integer between ${minScore} and ${maxScore}.`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    method: 'manual',
    minScore,
    maxScore,
    outOfRangeAbilities,
    errors,
  };
}

export interface ValidateAbilityGenerationInput {
  method: AbilityGenerationMethod;
  baseAbilities: BaseAbilities;
  abilityRollSeed?: number | undefined;
  allowUnspentPointBuy?: boolean | undefined;
  pointBuyBudget?: number | undefined;
  manualMinScore?: number | undefined;
  manualMaxScore?: number | undefined;
}

/**
 * Unified validator that dispatches to Standard Array, 27-Point Buy, Seeded `4d6kh3`,
 * or Manual validation based on `method`.
 */
export function validateAbilityGeneration(
  input: ValidateAbilityGenerationInput,
): AbilityGenerationValidationResult {
  switch (input.method) {
    case 'standard_array':
      return validateStandardArray(input.baseAbilities);
    case 'point_buy':
      return validatePointBuy(input.baseAbilities, {
        budget: input.pointBuyBudget,
        allowUnspentPoints: input.allowUnspentPointBuy,
      });
    case 'rolled':
      return validateRolledAbilities(input.baseAbilities, input.abilityRollSeed);
    case 'manual':
      return validateManualAbilities(input.baseAbilities, {
        minScore: input.manualMinScore,
        maxScore: input.manualMaxScore,
      });
  }
}

/**
 * Convenience validator that checks the ability generation fields directly on a `CharacterBuildState`.
 */
export function validateCharacterBuildAbilities(
  state: Pick<CharacterBuildState, 'abilityMethod' | 'baseAbilities' | 'abilityRollSeed'>,
): AbilityGenerationValidationResult {
  return validateAbilityGeneration({
    method: state.abilityMethod,
    baseAbilities: state.baseAbilities,
    abilityRollSeed: state.abilityRollSeed,
  });
}
