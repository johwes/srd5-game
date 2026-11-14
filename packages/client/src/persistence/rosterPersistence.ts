import {
  type CharacterBuildState,
  CharacterBuildStateSchema,
  ICONIC_PARTY_IDS,
  SRD_LEGAL_ATTRIBUTION,
  SRD_VERSION,
  type SrdCompendium,
  containsProductIdentityProperName,
  createIconicPartyStates,
  defaultCompendium,
  isProhibitedMonsterId,
} from '@srd5/data';
import { computeDerivedCharacter } from '@srd5/engine';
import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval';

// ============================================================================
// 1. Constants & Schemas for Roster Persistence & .srd5.json Export/Import
// ============================================================================

export const ROSTER_STORAGE_KEY = 'srd5:party-roster:v1' as const;
export const MIN_PARTY_SIZE = 1 as const;
export const MAX_PARTY_SIZE = 4 as const;

export interface PersistedRosterData {
  version: 1;
  characters: CharacterBuildState[];
  activePartyIds: string[];
  updatedAt: string;
}

/**
 * Single-character `.srd5.json` portable file envelope (`SPEC.md` Section 3.1 & Section 5).
 * Includes mandatory CC-BY-4.0 statutory attribution.
 */
export interface Srd5CharacterExportEnvelope {
  format: 'srd5-character';
  version: 1;
  srdVersion: '5.1';
  legalAttribution: string;
  exportedAt: string;
  character: CharacterBuildState;
}

/**
 * Full party roster `.srd5.json` portable file envelope (`SPEC.md` Section 3.1 & Section 5).
 * Includes mandatory CC-BY-4.0 statutory attribution.
 */
export interface Srd5RosterExportEnvelope {
  format: 'srd5-roster';
  version: 1;
  srdVersion: '5.1';
  legalAttribution: string;
  exportedAt: string;
  characters: CharacterBuildState[];
  activePartyIds: string[];
}

function parsePersistedRosterData(
  raw: unknown,
): { ok: true; data: PersistedRosterData } | { ok: false; errors: string[] } {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: ['Persisted roster must be an object.'] };
  }
  const obj = raw as Record<string, unknown>;
  if (obj['version'] !== 1) {
    return { ok: false, errors: ['Unsupported persisted roster version.'] };
  }
  if (!Array.isArray(obj['characters']) || !Array.isArray(obj['activePartyIds'])) {
    return { ok: false, errors: ['Persisted roster is missing characters or activePartyIds.'] };
  }

  const characters: CharacterBuildState[] = [];
  for (const item of obj['characters']) {
    const parsed = CharacterBuildStateSchema.safeParse(item);
    if (!parsed.success) {
      return {
        ok: false,
        errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      };
    }
    characters.push(parsed.data);
  }

  const activePartyIds = obj['activePartyIds'].filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );
  const updatedAt =
    typeof obj['updatedAt'] === 'string' && obj['updatedAt'].length > 0
      ? obj['updatedAt']
      : new Date().toISOString();

  return {
    ok: true,
    data: {
      version: 1,
      characters,
      activePartyIds,
      updatedAt,
    },
  };
}

// ============================================================================
// 2. Pluggable Storage Adapter (IndexedDB via idb-keyval + LocalStorage/Memory Fallback)
// ============================================================================

export interface RosterStorageAdapter {
  getItem: (key: string) => Promise<unknown>;
  setItem: (key: string, value: unknown) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

const memoryFallbackStore = new Map<string, string>();

function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function isLocalStorageAvailable(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
}

/**
 * Default storage adapter that uses `idb-keyval` (IndexedDB) in browser environments
 * and gracefully falls back to `localStorage` / in-memory storage when IndexedDB is unavailable.
 */
export const defaultRosterStorageAdapter: RosterStorageAdapter = {
  async getItem(key: string): Promise<unknown> {
    if (isIndexedDbAvailable()) {
      try {
        const val = await idbGet(key);
        if (val !== undefined) {
          return val;
        }
      } catch {
        // Fall through to localStorage / memory fallback
      }
    }

    if (isLocalStorageAvailable()) {
      try {
        const raw = localStorage.getItem(key);
        if (raw !== null) {
          return JSON.parse(raw) as unknown;
        }
      } catch {
        // Fall through to memory fallback
      }
    }

    const memRaw = memoryFallbackStore.get(key);
    return memRaw !== undefined ? (JSON.parse(memRaw) as unknown) : undefined;
  },

  async setItem(key: string, value: unknown): Promise<void> {
    const serialized = JSON.stringify(value);
    memoryFallbackStore.set(key, serialized);

    if (isLocalStorageAvailable()) {
      try {
        localStorage.setItem(key, serialized);
      } catch {
        // Ignore quota/security errors
      }
    }

    if (isIndexedDbAvailable()) {
      try {
        await idbSet(key, structuredClone(value));
      } catch {
        // Fallback already stored in localStorage / memory
      }
    }
  },

  async removeItem(key: string): Promise<void> {
    memoryFallbackStore.delete(key);

    if (isLocalStorageAvailable()) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Ignore
      }
    }

    if (isIndexedDbAvailable()) {
      try {
        await idbDel(key);
      } catch {
        // Ignore
      }
    }
  },
};

/**
 * Creates an isolated in-memory `RosterStorageAdapter` for deterministic testing.
 */
export function createInMemoryRosterStorageAdapter(): RosterStorageAdapter {
  const map = new Map<string, string>();
  return {
    async getItem(key: string): Promise<unknown> {
      const raw = map.get(key);
      return raw !== undefined ? (JSON.parse(raw) as unknown) : undefined;
    },
    async setItem(key: string, value: unknown): Promise<void> {
      map.set(key, JSON.stringify(value));
    },
    async removeItem(key: string): Promise<void> {
      map.delete(key);
    },
  };
}

// ============================================================================
// 3. Roster State Factory, Normalization & CRUD Operations
// ============================================================================

/**
 * Normalizes `activePartyIds` so it only contains unique IDs present in `characters`
 * and is capped at `MAX_PARTY_SIZE` (4).
 */
export function normalizeActivePartyIds(
  characters: readonly CharacterBuildState[],
  activePartyIds: readonly string[],
): string[] {
  const validIds = new Set(characters.map((c) => c.id));
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const id of activePartyIds) {
    if (validIds.has(id) && !seen.has(id) && normalized.length < MAX_PARTY_SIZE) {
      seen.add(id);
      normalized.push(id);
    }
  }

  return normalized;
}

/**
 * Creates the default initial `PersistedRosterData` seeded with the 4 pre-generated
 * SRD 5.1 iconic Level 1 party members (Fighter, Wizard, Cleric, Rogue).
 */
export function createDefaultRosterData(): PersistedRosterData {
  const iconics = createIconicPartyStates();
  return {
    version: 1,
    characters: iconics,
    activePartyIds: [...ICONIC_PARTY_IDS],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Loads the persisted roster from storage only if an explicit record has been saved;
 * returns `null` when storage is empty so initial UI renders don't perform redundant state updates.
 */
export async function loadStoredRosterIfPresent(
  adapter: RosterStorageAdapter = defaultRosterStorageAdapter,
): Promise<PersistedRosterData | null> {
  try {
    const raw = await adapter.getItem(ROSTER_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = parsePersistedRosterData(raw);
    if (!parsed.ok) {
      return null;
    }
    const normalizedParty = normalizeActivePartyIds(
      parsed.data.characters,
      parsed.data.activePartyIds,
    );
    return {
      ...parsed.data,
      activePartyIds: normalizedParty,
    };
  } catch {
    return null;
  }
}

/**
 * Loads the persisted roster from IndexedDB / fallback storage.
 * If no valid saved roster exists, returns `createDefaultRosterData()`.
 */
export async function loadPersistedRoster(
  adapter: RosterStorageAdapter = defaultRosterStorageAdapter,
): Promise<PersistedRosterData> {
  const stored = await loadStoredRosterIfPresent(adapter);
  return stored ?? createDefaultRosterData();
}

/**
 * Persists the given `PersistedRosterData` to IndexedDB / fallback storage.
 */
export async function savePersistedRoster(
  roster: PersistedRosterData,
  adapter: RosterStorageAdapter = defaultRosterStorageAdapter,
): Promise<PersistedRosterData> {
  const normalized: PersistedRosterData = {
    version: 1,
    characters: roster.characters.map((c) => structuredClone(c)),
    activePartyIds: normalizeActivePartyIds(roster.characters, roster.activePartyIds),
    updatedAt: new Date().toISOString(),
  };
  await adapter.setItem(ROSTER_STORAGE_KEY, normalized);
  return normalized;
}

/**
 * Clears the persisted roster from storage and resets to the 4 iconic SRD heroes.
 */
export async function resetPersistedRosterToIconics(
  adapter: RosterStorageAdapter = defaultRosterStorageAdapter,
): Promise<PersistedRosterData> {
  const fresh = createDefaultRosterData();
  await savePersistedRoster(fresh, adapter);
  return fresh;
}

/**
 * Inserts or updates a character in `roster.characters`.
 * If `addToPartyIfRoom` is true (default) and the character is newly added while
 * `activePartyIds.length < MAX_PARTY_SIZE`, also appends the character to `activePartyIds`.
 */
export function upsertRosterCharacter(
  roster: PersistedRosterData,
  character: CharacterBuildState,
  options?: { addToPartyIfRoom?: boolean },
): PersistedRosterData {
  const addToPartyIfRoom = options?.addToPartyIfRoom ?? true;
  const cloned = structuredClone(character);
  const existingIndex = roster.characters.findIndex((c) => c.id === cloned.id);

  const nextCharacters = [...roster.characters];
  if (existingIndex >= 0) {
    nextCharacters[existingIndex] = cloned;
  } else {
    nextCharacters.push(cloned);
  }

  let nextPartyIds = normalizeActivePartyIds(nextCharacters, roster.activePartyIds);
  if (
    existingIndex === -1 &&
    addToPartyIfRoom &&
    !nextPartyIds.includes(cloned.id) &&
    nextPartyIds.length < MAX_PARTY_SIZE
  ) {
    nextPartyIds = [...nextPartyIds, cloned.id];
  }

  return {
    version: 1,
    characters: nextCharacters,
    activePartyIds: nextPartyIds,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Removes a character by ID from `roster.characters` and `roster.activePartyIds`.
 */
export function removeRosterCharacter(
  roster: PersistedRosterData,
  characterId: string,
): PersistedRosterData {
  const nextCharacters = roster.characters.filter((c) => c.id !== characterId);
  const nextPartyIds = normalizeActivePartyIds(
    nextCharacters,
    roster.activePartyIds.filter((id) => id !== characterId),
  );
  return {
    version: 1,
    characters: nextCharacters,
    activePartyIds: nextPartyIds,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Toggles whether `characterId` is in the active 1–4 hero Party Roster.
 * Returns `{ roster, added, error }` where `error` is populated if the party is already full (4 heroes).
 */
export function togglePartyMember(
  roster: PersistedRosterData,
  characterId: string,
): { roster: PersistedRosterData; inParty: boolean; error?: string } {
  const exists = roster.characters.some((c) => c.id === characterId);
  if (!exists) {
    return {
      roster,
      inParty: false,
      error: `Character '${characterId}' does not exist in the roster.`,
    };
  }

  const currentlyInParty = roster.activePartyIds.includes(characterId);
  if (currentlyInParty) {
    const nextPartyIds = roster.activePartyIds.filter((id) => id !== characterId);
    return {
      roster: {
        ...roster,
        activePartyIds: nextPartyIds,
        updatedAt: new Date().toISOString(),
      },
      inParty: false,
    };
  }

  if (roster.activePartyIds.length >= MAX_PARTY_SIZE) {
    return {
      roster,
      inParty: false,
      error: `Party Roster is full (maximum ${MAX_PARTY_SIZE} heroes). Remove a party member first.`,
    };
  }

  return {
    roster: {
      ...roster,
      activePartyIds: [...roster.activePartyIds, characterId],
      updatedAt: new Date().toISOString(),
    },
    inParty: true,
  };
}

/**
 * Moves a party member up or down in the active party marching order (`0..3`).
 */
export function movePartyMemberOrder(
  roster: PersistedRosterData,
  characterId: string,
  direction: 'up' | 'down',
): PersistedRosterData {
  const idx = roster.activePartyIds.indexOf(characterId);
  if (idx === -1) {
    return roster;
  }
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= roster.activePartyIds.length) {
    return roster;
  }
  const nextPartyIds = [...roster.activePartyIds];
  const [removed] = nextPartyIds.splice(idx, 1);
  if (removed) {
    nextPartyIds.splice(targetIdx, 0, removed);
  }
  return {
    ...roster,
    activePartyIds: nextPartyIds,
    updatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// 4. Portable .srd5.json Serialization, Parsing & Validation
// ============================================================================

/**
 * Formats a clean `.srd5.json` filename for a character or party export.
 */
export function formatSrd5Filename(
  nameOrLabel: string,
  kind: 'character' | 'roster' = 'character',
): string {
  const slug = nameOrLabel
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = slug.length > 0 ? slug : kind === 'roster' ? 'party-roster' : 'hero';
  return `${base}.srd5.json`;
}

/**
 * Serializes a single `CharacterBuildState` into a portable `.srd5.json` string
 * with the mandatory CC-BY-4.0 attribution notice (`SPEC.md` Section 3.1).
 */
export function serializeCharacterToSrd5Json(character: CharacterBuildState): string {
  const envelope: Srd5CharacterExportEnvelope = {
    format: 'srd5-character',
    version: 1,
    srdVersion: SRD_VERSION,
    legalAttribution: SRD_LEGAL_ATTRIBUTION,
    exportedAt: new Date().toISOString(),
    character: structuredClone(character),
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Serializes a Party Roster (`characters` and `activePartyIds`) into a portable `.srd5.json` string
 * with the mandatory CC-BY-4.0 attribution notice (`SPEC.md` Section 3.1).
 */
export function serializeRosterToSrd5Json(
  roster: Pick<PersistedRosterData, 'characters' | 'activePartyIds'>,
): string {
  const normalizedPartyIds = normalizeActivePartyIds(
    roster.characters,
    roster.activePartyIds,
  );
  const envelope: Srd5RosterExportEnvelope = {
    format: 'srd5-roster',
    version: 1,
    srdVersion: SRD_VERSION,
    legalAttribution: SRD_LEGAL_ATTRIBUTION,
    exportedAt: new Date().toISOString(),
    characters: roster.characters.map((c) => structuredClone(c)),
    activePartyIds: normalizedPartyIds,
  };
  return JSON.stringify(envelope, null, 2);
}

export type Srd5ImportResult =
  | {
      ok: true;
      format: 'srd5-character' | 'srd5-roster' | 'raw-character';
      characters: CharacterBuildState[];
      activePartyIds: string[];
    }
  | {
      ok: false;
      errors: string[];
    };

/**
 * Validates that a `CharacterBuildState` conforms to SRD 5.1 referential integrity
 * and Product Identity guardrails (`SPEC.md` Section 3.2).
 */
export function validateImportedCharacterSemantics(
  character: CharacterBuildState,
  compendium: SrdCompendium = defaultCompendium,
): string[] {
  const errors: string[] = [];
  const trimmedName = character.name.trim();

  if (trimmedName.length === 0) {
    errors.push('Character name cannot be empty.');
  } else {
    const tokens = trimmedName
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    if (
      containsProductIdentityProperName(trimmedName) ||
      tokens.some((t) => isProhibitedMonsterId(t))
    ) {
      errors.push(
        `Character "${trimmedName}" contains a prohibited non-SRD Product Identity name.`,
      );
    }
  }

  if (!compendium.getRace(character.raceId)) {
    errors.push(
      `Character "${trimmedName}" references unknown SRD 5.1 race '${character.raceId}'.`,
    );
  }
  if (character.subraceId && !compendium.getSubrace(character.subraceId)) {
    errors.push(
      `Character "${trimmedName}" references unknown SRD 5.1 subrace '${character.subraceId}'.`,
    );
  }
  if (
    !character.customBackground &&
    character.backgroundId !== 'custom' &&
    !compendium.getBackground(character.backgroundId)
  ) {
    errors.push(
      `Character "${trimmedName}" references unknown SRD 5.1 background '${character.backgroundId}'.`,
    );
  }

  for (const clsEntry of character.classes) {
    const cls = compendium.getClass(clsEntry.classId);
    if (!cls) {
      errors.push(
        `Character "${trimmedName}" references unknown SRD 5.1 class '${clsEntry.classId}'.`,
      );
    }
    if (clsEntry.subclassId && !compendium.getSubclass(clsEntry.subclassId)) {
      errors.push(
        `Character "${trimmedName}" references unknown SRD 5.1 subclass '${clsEntry.subclassId}'.`,
      );
    }
  }

  const totalLevel = character.classes.reduce((sum, c) => sum + c.level, 0);
  if (totalLevel < 1 || totalLevel > 20) {
    errors.push(
      `Character "${trimmedName}" has invalid total level ${totalLevel} (must be between 1 and 20).`,
    );
  }

  // Ensure derived stat pipeline executes cleanly without throwing
  if (errors.length === 0) {
    try {
      computeDerivedCharacter(character, compendium);
    } catch (err) {
      errors.push(
        `Failed to compute derived stats for "${trimmedName}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return errors;
}

/**
 * Parses and validates an imported `.srd5.json` file (supporting single-character envelopes,
 * party roster envelopes, or raw `CharacterBuildState` JSON).
 */
export function parseSrd5JsonImport(
  jsonText: string,
  compendium: SrdCompendium = defaultCompendium,
): Srd5ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    return {
      ok: false,
      errors: [
        `Invalid JSON syntax in .srd5.json file: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }

  if (typeof raw !== 'object' || raw === null) {
    return {
      ok: false,
      errors: ['Imported .srd5.json content must be a JSON object.'],
    };
  }

  const record = raw as Record<string, unknown>;

  // Case 1: Single-Character Envelope (`format: 'srd5-character'`)
  if (record['format'] === 'srd5-character') {
    if (
      typeof record['legalAttribution'] !== 'string' ||
      record['legalAttribution'].trim().length === 0
    ) {
      return {
        ok: false,
        errors: ['legalAttribution: Statutory SRD 5.1 CC-BY-4.0 attribution is required.'],
      };
    }
    const parsedChar = CharacterBuildStateSchema.safeParse(record['character']);
    if (!parsedChar.success) {
      return {
        ok: false,
        errors: parsedChar.error.issues.map(
          (i) => `${i.path.join('.') || 'character'}: ${i.message}`,
        ),
      };
    }
    const semErrors = validateImportedCharacterSemantics(
      parsedChar.data,
      compendium,
    );
    if (semErrors.length > 0) {
      return { ok: false, errors: semErrors };
    }
    return {
      ok: true,
      format: 'srd5-character',
      characters: [parsedChar.data],
      activePartyIds: [parsedChar.data.id],
    };
  }

  // Case 2: Party Roster Envelope (`format: 'srd5-roster'`)
  if (record['format'] === 'srd5-roster') {
    if (
      typeof record['legalAttribution'] !== 'string' ||
      record['legalAttribution'].trim().length === 0
    ) {
      return {
        ok: false,
        errors: ['legalAttribution: Statutory SRD 5.1 CC-BY-4.0 attribution is required.'],
      };
    }
    if (!Array.isArray(record['characters']) || record['characters'].length === 0) {
      return {
        ok: false,
        errors: ['characters: Must be a non-empty array of characters.'],
      };
    }
    const characters: CharacterBuildState[] = [];
    for (const rawChar of record['characters']) {
      const parsedChar = CharacterBuildStateSchema.safeParse(rawChar);
      if (!parsedChar.success) {
        return {
          ok: false,
          errors: parsedChar.error.issues.map(
            (i) => `${i.path.join('.') || 'roster'}: ${i.message}`,
          ),
        };
      }
      characters.push(parsedChar.data);
    }

    const semErrors: string[] = [];
    for (const char of characters) {
      semErrors.push(...validateImportedCharacterSemantics(char, compendium));
    }
    if (semErrors.length > 0) {
      return { ok: false, errors: semErrors };
    }

    const rawActiveIds = Array.isArray(record['activePartyIds'])
      ? record['activePartyIds'].filter((id): id is string => typeof id === 'string')
      : [];

    return {
      ok: true,
      format: 'srd5-roster',
      characters,
      activePartyIds: normalizeActivePartyIds(characters, rawActiveIds),
    };
  }

  // Case 3: Raw `CharacterBuildState` JSON object
  const rawCharParsed = CharacterBuildStateSchema.safeParse(raw);
  if (rawCharParsed.success) {
    const semErrors = validateImportedCharacterSemantics(
      rawCharParsed.data,
      compendium,
    );
    if (semErrors.length > 0) {
      return { ok: false, errors: semErrors };
    }
    return {
      ok: true,
      format: 'raw-character',
      characters: [rawCharParsed.data],
      activePartyIds: [rawCharParsed.data.id],
    };
  }

  return {
    ok: false,
    errors: rawCharParsed.error.issues.map(
      (i) => `${i.path.join('.') || 'root'}: ${i.message}`,
    ),
  };
}

/**
 * Merges imported characters into an existing `PersistedRosterData` state.
 */
export function mergeImportedCharactersIntoRoster(
  roster: PersistedRosterData,
  imported: Extract<Srd5ImportResult, { ok: true }>,
  options?: { replaceActiveParty?: boolean },
): PersistedRosterData {
  let nextRoster: PersistedRosterData = {
    ...roster,
    characters: [...roster.characters],
    activePartyIds: [...roster.activePartyIds],
  };

  for (const char of imported.characters) {
    nextRoster = upsertRosterCharacter(nextRoster, char, {
      addToPartyIfRoom: !options?.replaceActiveParty,
    });
  }

  if (options?.replaceActiveParty && imported.activePartyIds.length > 0) {
    nextRoster = {
      ...nextRoster,
      activePartyIds: normalizeActivePartyIds(
        nextRoster.characters,
        imported.activePartyIds,
      ),
      updatedAt: new Date().toISOString(),
    };
  }

  return nextRoster;
}

/**
 * Triggers a browser file download for a `.srd5.json` payload when running in a DOM environment.
 */
export function triggerSrd5FileDownload(filename: string, jsonContent: string): void {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') {
    return;
  }
  try {
    if (typeof URL.createObjectURL !== 'function') {
      return;
    }
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url);
    }
  } catch {
    // Ignore in headless test environments without URL.createObjectURL
  }
}
