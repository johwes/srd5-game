import { type GraveyardEntry } from '@srd5/engine';

export const ROGUELITE_GRAVEYARD_STORAGE_KEY = 'srd5_roguelite_graveyard_v1';

let inMemoryGraveyard: GraveyardEntry[] = [];

/**
 * Returns the effective localStorage instance if running in browser, or undefined in Node.
 */
function getStorage(customStorage?: Storage): Storage | undefined {
  if (customStorage) return customStorage;
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return undefined;
}

/**
 * Persists a completed or fatal roguelite run to the graveyard leaderboard.
 */
export function saveGraveyardEntry(
  entry: GraveyardEntry,
  storage?: Storage,
): void {
  const store = getStorage(storage);
  const existing = loadGraveyardEntries(storage);
  const updated = [entry, ...existing.filter((e) => e.runId !== entry.runId)];

  if (store) {
    try {
      store.setItem(ROGUELITE_GRAVEYARD_STORAGE_KEY, JSON.stringify(updated));
      return;
    } catch (err) {
      console.warn('Failed to persist graveyard entry to localStorage:', err);
    }
  }

  inMemoryGraveyard = updated;
}

/**
 * Loads all recorded graveyard run entries.
 */
export function loadGraveyardEntries(storage?: Storage): GraveyardEntry[] {
  const store = getStorage(storage);
  if (store) {
    try {
      const raw = store.getItem(ROGUELITE_GRAVEYARD_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (err) {
      console.warn('Failed to load graveyard entries from localStorage:', err);
    }
  }

  return inMemoryGraveyard;
}

/**
 * Returns the top high scores sorted descending by final score.
 */
export function getGraveyardHighScores(
  limit: number = 10,
  storage?: Storage,
): GraveyardEntry[] {
  const entries = loadGraveyardEntries(storage);
  return [...entries].sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Clears stored graveyard entries (used for tests or user reset).
 */
export function clearGraveyardEntries(storage?: Storage): void {
  const store = getStorage(storage);
  if (store) {
    try {
      store.removeItem(ROGUELITE_GRAVEYARD_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
  inMemoryGraveyard = [];
}
