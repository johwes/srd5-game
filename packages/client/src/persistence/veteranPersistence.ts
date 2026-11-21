import {
  CharacterBuildStateSchema,
  type CharacterBuildState,
} from '@srd5/data';
import {
  VETERAN_MAX_LEVEL,
  VETERAN_MAX_ROSTER_SIZE,
  VETERAN_MIN_LEVEL,
  getBuildTotalLevel,
  type VeteranRosterEntry,
  type VeteranSource,
} from '@srd5/engine';
import {
  createInMemoryRosterStorageAdapter,
  defaultRosterStorageAdapter,
  type RosterStorageAdapter,
} from './rosterPersistence.js';

/**
 * SRD-1405: Veteran Roster persistence (Spec 13 §7).
 *
 * Retired heroes persist as full `CharacterBuildState` snapshots in the
 * existing delve IndexedDB store (same offline `idb-keyval` +
 * localStorage/memory fallback machinery as saves and the party roster).
 * Cap 8, FIFO with a confirm-to-release row (enforced by the engine planner).
 */

export const VETERAN_ROSTER_STORAGE_KEY = 'srd5:veteran-roster:v1' as const;

const VETERAN_SOURCES: VeteranSource[] = ['descent', 'delve', 'realm'];

function parseVeteranEntry(raw: unknown): VeteranRosterEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj['veteranId'] !== 'string' || obj['veteranId'].length === 0) return null;
  if (typeof obj['retiredAt'] !== 'string') return null;
  if (!VETERAN_SOURCES.includes(obj['source'] as VeteranSource)) return null;
  const heroParsed = CharacterBuildStateSchema.safeParse(obj['hero']);
  if (!heroParsed.success) return null;
  const hero = heroParsed.data;
  // Recompute the level from the snapshot so tampered records cannot smuggle
  // in out-of-band costs or epic heroes.
  const level = getBuildTotalLevel(hero);
  if (level < VETERAN_MIN_LEVEL || level > VETERAN_MAX_LEVEL) return null;
  const entry: VeteranRosterEntry = {
    veteranId: obj['veteranId'],
    hero,
    level,
    retiredAt: obj['retiredAt'],
    source: obj['source'] as VeteranSource,
  };
  if (typeof obj['runId'] === 'string' && obj['runId'].length > 0) {
    entry.runId = obj['runId'];
  }
  return entry;
}

/**
 * Loads the persisted veteran roster. Invalid records are dropped; an
 * oversized store is defensively trimmed to the newest
 * `VETERAN_MAX_ROSTER_SIZE` entries.
 */
export async function loadVeteranRoster(
  adapter: RosterStorageAdapter = defaultRosterStorageAdapter,
): Promise<VeteranRosterEntry[]> {
  try {
    const raw = await adapter.getItem(VETERAN_ROSTER_STORAGE_KEY);
    if (!Array.isArray(raw)) return [];
    const entries: VeteranRosterEntry[] = [];
    for (const item of raw) {
      const entry = parseVeteranEntry(item);
      if (entry && !entries.some((e) => e.veteranId === entry.veteranId)) {
        entries.push(entry);
      }
    }
    return entries.slice(-VETERAN_MAX_ROSTER_SIZE);
  } catch {
    return [];
  }
}

/** Persists the veteran roster (cap enforced by the engine planner). */
export async function saveVeteranRoster(
  roster: VeteranRosterEntry[],
  adapter: RosterStorageAdapter = defaultRosterStorageAdapter,
): Promise<VeteranRosterEntry[]> {
  const next = roster.slice(-VETERAN_MAX_ROSTER_SIZE).map((v) => structuredClone(v));
  await adapter.setItem(VETERAN_ROSTER_STORAGE_KEY, next);
  return next;
}

/** Clears the veteran roster (used for tests and user reset). */
export async function clearVeteranRoster(
  adapter: RosterStorageAdapter = defaultRosterStorageAdapter,
): Promise<void> {
  await adapter.removeItem(VETERAN_ROSTER_STORAGE_KEY);
}

export { createInMemoryRosterStorageAdapter };
export type { CharacterBuildState };
