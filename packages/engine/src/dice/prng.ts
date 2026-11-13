/**
 * Deterministic Seeded PRNG (`Mulberry32`) for `@srd5/engine`.
 *
 * Architectural Invariant: `Math.random()` is NEVER called in `@srd5/engine`.
 * Every random roll is a pure function of `rngState: number` (uint32) returning
 * `{ value/roll, nextState }`.
 */

export const STANDARD_DIE_FACES = [4, 6, 8, 10, 12, 20, 100] as const;
export type StandardDieFaces = (typeof STANDARD_DIE_FACES)[number];

/**
 * Coerces any JavaScript number into an unsigned 32-bit integer state.
 */
export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) {
    return 0;
  }
  return seed >>> 0;
}

/**
 * Advances the Mulberry32 PRNG by one step and returns an unsigned 32-bit integer
 * (`0` to `4294967295`) along with the next uint32 state.
 */
export function nextRandomUint32(state: number): { value: number; nextState: number } {
  const nextState = ((state >>> 0) + 0x6d2b79f5) >>> 0;
  let t = nextState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = (t ^ (t >>> 14)) >>> 0;
  return { value, nextState };
}

/**
 * Advances the Mulberry32 PRNG by one step and returns a uniform float in `[0, 1)`.
 */
export function nextRandomFloat(state: number): { value: number; nextState: number } {
  const { value, nextState } = nextRandomUint32(state);
  return {
    value: value / 0x100000000,
    nextState,
  };
}

/**
 * Rolls a single die with the specified number of faces (`1..faces` inclusive)
 * using a single Mulberry32 PRNG step.
 */
export function rollDie(
  state: number,
  faces: StandardDieFaces | number,
): { roll: number; nextState: number } {
  if (!Number.isInteger(faces) || faces < 1) {
    throw new RangeError(`Die faces must be a positive integer, received: ${faces}`);
  }
  const { value, nextState } = nextRandomUint32(state);
  const roll = Math.floor((value / 0x100000000) * faces) + 1;
  return { roll, nextState };
}

/**
 * Rolls `count` dice with `faces` sides sequentially, threading `rngState`.
 */
export function rollMultipleDice(
  state: number,
  count: number,
  faces: StandardDieFaces | number,
): { rolls: number[]; nextState: number } {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`Dice count must be a non-negative integer, received: ${count}`);
  }
  if (!Number.isInteger(faces) || faces < 1) {
    throw new RangeError(`Die faces must be a positive integer, received: ${faces}`);
  }
  const rolls: number[] = [];
  let currentState = state >>> 0;
  for (let i = 0; i < count; i++) {
    const res = rollDie(currentState, faces);
    rolls.push(res.roll);
    currentState = res.nextState;
  }
  return { rolls, nextState: currentState };
}
