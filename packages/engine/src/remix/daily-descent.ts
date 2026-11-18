import {
  type CreateRogueliteRunOptions,
  type DeepDescentRunState,
  type GraveyardEntry,
  type RogueliteRunSession,
  startRogueliteRun,
} from '../dungeon/roguelite.js';

/**
 * Returns a standardized UTC date string (`YYYY-MM-DD`) for Daily Descent runs.
 */
export function getDailyDescentDateString(date?: Date | string): string {
  if (typeof date === 'string') {
    // If string already matches YYYY-MM-DD, return trimmed
    const match = /^\d{4}-\d{2}-\d{2}/.exec(date.trim());
    if (match) return match[0];
    const parsed = new Date(date);
    if (!Number.isNaN(parsed.getTime())) {
      return getDailyDescentDateString(parsed);
    }
    date = undefined;
  }
  const d = date instanceof Date ? date : new Date();
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Derives a deterministic 32-bit positive integer seed from a Daily Descent date string.
 * Uses 32-bit FNV-1a hashing with a dedicated daily descent namespace.
 */
export function computeDailyDescentSeed(dateString: string): number {
  const normalized = getDailyDescentDateString(dateString);
  let hash = 2166136261;
  const str = `srd5:daily_descent:${normalized}`;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const uint = hash >>> 0;
  // Ensure non-zero positive integer
  return uint === 0 ? 1337 : uint;
}

/**
 * Convenience wrapper returning the deterministic seed for the given date (defaulting to today UTC).
 */
export function getDailyDescentSeed(date?: Date | string): number {
  return computeDailyDescentSeed(getDailyDescentDateString(date));
}

export interface CreateDailyDescentRunOptions extends Partial<CreateRogueliteRunOptions> {
  date?: Date | string;
}

/**
 * Initializes an authoritative Daily Descent run session pinned to the shared daily seed.
 */
export function createDailyDescentRun(
  options: CreateDailyDescentRunOptions = {},
): RogueliteRunSession {
  const dailyDate = getDailyDescentDateString(options.date);
  const seed = options.seed ?? computeDailyDescentSeed(dailyDate);
  const runId = options.runId ?? `daily_${dailyDate}_${seed.toString(16)}`;

  return startRogueliteRun({
    ...options,
    runId,
    seed,
    isDaily: true,
    dailyDate,
    mode: 'daily_descent',
  });
}

/**
 * Checks whether today's (or the specified date's) Daily Descent has already been attempted
 * in the provided Graveyard history.
 */
export function isDailyDescentAttempted(
  dateOrDateString: Date | string = new Date(),
  graveyardEntries: GraveyardEntry[] = [],
): boolean {
  const targetDate = getDailyDescentDateString(dateOrDateString);
  return graveyardEntries.some(
    (entry) =>
      entry.dailyDate === targetDate ||
      (entry.isDaily && entry.timestamp.startsWith(targetDate)) ||
      entry.runId.startsWith(`daily_${targetDate}`),
  );
}

/**
 * Filters and ranks all Daily Descent entries in graveyard history descending by score.
 */
export function getDailyDescentLeaderboard(
  graveyardEntries: GraveyardEntry[] = [],
): GraveyardEntry[] {
  const dailyRuns = graveyardEntries.filter(
    (e) => e.isDaily || e.mode === 'daily_descent' || e.runId.startsWith('daily_'),
  );
  return [...dailyRuns].sort((a, b) => b.score - a.score);
}

/**
 * Calculates rank and percentile for a given score against historical daily descent runs.
 */
export function getDailyDescentScoreRank(
  score: number,
  graveyardEntries: GraveyardEntry[] = [],
): {
  rank: number;
  totalDailyRuns: number;
  percentile: number;
} {
  const leaderboard = getDailyDescentLeaderboard(graveyardEntries);
  const totalDailyRuns = leaderboard.length;
  if (totalDailyRuns === 0) {
    return { rank: 1, totalDailyRuns: 1, percentile: 100 };
  }

  // Count how many runs strictly beat this score
  const higherCount = leaderboard.filter((e) => e.score > score).length;
  const rank = higherCount + 1;
  const lowerCount = leaderboard.filter((e) => e.score < score).length;
  const percentile = Math.round((lowerCount / totalDailyRuns) * 100);

  return { rank, totalDailyRuns, percentile };
}
