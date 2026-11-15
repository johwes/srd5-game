import {
  SRD_LEGAL_ATTRIBUTION,
  SRD_VERSION,
} from '@srd5/data';
import { type GameState } from '@srd5/engine';
import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval';

export const DUNGEON_SAVES_STORAGE_KEY = 'srd5:dungeon-saves:v1' as const;

export interface DungeonPartyMemberSummary {
  id: string;
  name: string;
  className: string;
  level: number;
  currentHp: number;
  maxHp: number;
}

export interface DungeonSaveSlotMeta {
  slotId: string;
  slotName: string;
  savedAt: string;
  campaignId: string;
  campaignName: string;
  floorId: string;
  floorName: string;
  currentRoomName?: string;
  mode: 'exploration' | 'combat';
  partySummary: DungeonPartyMemberSummary[];
}

export interface DungeonSaveSlotData {
  version: 1;
  slotId: string;
  slotName: string;
  savedAt: string;
  campaignId: string;
  campaignName: string;
  floorId: string;
  gameState: GameState;
  meta: DungeonSaveSlotMeta;
}

export interface Srd5DungeonSaveExportEnvelope {
  format: 'srd5-dungeon-save';
  version: 1;
  srdVersion: '5.1';
  legalAttribution: string;
  exportedAt: string;
  saveData: DungeonSaveSlotData;
}

export interface DungeonStorageAdapter {
  getItem: (key: string) => Promise<unknown>;
  setItem: (key: string, value: unknown) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

const memoryStore: Record<string, unknown> = {};

function isIndexedDbAvailable(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.indexedDB !== 'undefined' &&
      window.indexedDB !== null
    );
  } catch {
    return false;
  }
}

function isLocalStorageAvailable(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    const testKey = '__srd5_test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

export const defaultDungeonStorageAdapter: DungeonStorageAdapter = {
  async getItem(key: string): Promise<unknown> {
    if (isIndexedDbAvailable()) {
      try {
        const val = await idbGet(key);
        if (val !== undefined) {
          return val;
        }
      } catch {
        // Fall through to localStorage
      }
    }

    if (isLocalStorageAvailable()) {
      try {
        const item = window.localStorage.getItem(key);
        if (item !== null) {
          return JSON.parse(item);
        }
      } catch {
        // Fall through to memory
      }
    }

    return memoryStore[key];
  },

  async setItem(key: string, value: unknown): Promise<void> {
    memoryStore[key] = structuredClone(value);

    if (isIndexedDbAvailable()) {
      try {
        await idbSet(key, value);
      } catch {
        // Fall through
      }
    }

    if (isLocalStorageAvailable()) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Fall through
      }
    }
  },

  async removeItem(key: string): Promise<void> {
    delete memoryStore[key];

    if (isIndexedDbAvailable()) {
      try {
        await idbDel(key);
      } catch {
        // Fall through
      }
    }

    if (isLocalStorageAvailable()) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Fall through
      }
    }
  },
};

export const DEFAULT_DUNGEON_SLOT_IDS = [
  'slot_1',
  'slot_2',
  'slot_3',
  'slot_auto',
] as const;

export type DefaultDungeonSlotId = (typeof DEFAULT_DUNGEON_SLOT_IDS)[number];

export function getDefaultDungeonSlotLabel(slotId: string): string {
  switch (slotId) {
    case 'slot_1':
      return 'Save Slot 1';
    case 'slot_2':
      return 'Save Slot 2';
    case 'slot_3':
      return 'Save Slot 3';
    case 'slot_auto':
      return 'Auto-Save';
    default:
      return `Slot ${slotId}`;
  }
}

/**
 * Builds metadata for a dungeon save from current GameState.
 */
export function buildDungeonSaveMeta(
  slotId: string,
  slotName: string,
  gameState: GameState,
  options: {
    campaignId: string;
    campaignName: string;
    floorName: string;
  },
): DungeonSaveSlotMeta {
  const partyList = Object.values(gameState.party);
  const partySummary: DungeonPartyMemberSummary[] = partyList.map((hero) => {
    const sheet = hero.characterSheet;
    const firstClass = sheet?.classes?.[0];
    const className = firstClass ? `${firstClass.classId} ${firstClass.level}` : 'Adventurer';
    return {
      id: hero.id,
      name: hero.name,
      className,
      level: sheet?.totalLevel ?? 1,
      currentHp: hero.currentHp,
      maxHp: hero.maxHp,
    };
  });

  // Determine current room if any
  let currentRoomName: string | undefined;
  if (gameState.dungeon && partyList[0]?.roomId) {
    const room = gameState.dungeon.rooms[partyList[0].roomId];
    if (room) {
      currentRoomName = room.name;
    }
  }

  return {
    slotId,
    slotName,
    savedAt: new Date().toISOString(),
    campaignId: options.campaignId,
    campaignName: options.campaignName,
    floorId: gameState.dungeon?.floorId ?? 'unknown-floor',
    floorName: options.floorName,
    currentRoomName,
    mode: gameState.mode,
    partySummary,
  };
}

/**
 * Returns the most recently updated DungeonSaveSlotData from a collection of slots, or null.
 */
export function getLatestDungeonSaveSlot(
  slots: Record<string, DungeonSaveSlotData>,
): DungeonSaveSlotData | null {
  const slotList = Object.values(slots);
  if (slotList.length === 0) return null;
  return slotList.reduce((latest, current) => {
    const latestTime = new Date(latest.savedAt).getTime();
    const currentTime = new Date(current.savedAt).getTime();
    return currentTime > latestTime ? current : latest;
  }, slotList[0]!);
}

/**
 * Loads all saved dungeon slots from storage.
 */
export async function loadDungeonSaveSlots(
  storageAdapter: DungeonStorageAdapter = defaultDungeonStorageAdapter,
): Promise<Record<string, DungeonSaveSlotData>> {
  try {
    const raw = await storageAdapter.getItem(DUNGEON_SAVES_STORAGE_KEY);
    if (typeof raw === 'object' && raw !== null) {
      return raw as Record<string, DungeonSaveSlotData>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Saves a GameState into the specified save slot.
 */
export async function saveDungeonGameToSlot(
  slotId: string,
  slotName: string,
  gameState: GameState,
  options: {
    campaignId: string;
    campaignName: string;
    floorName: string;
  },
  storageAdapter: DungeonStorageAdapter = defaultDungeonStorageAdapter,
): Promise<DungeonSaveSlotData> {
  const slots = await loadDungeonSaveSlots(storageAdapter);
  const meta = buildDungeonSaveMeta(slotId, slotName, gameState, options);

  const slotData: DungeonSaveSlotData = {
    version: 1,
    slotId,
    slotName,
    savedAt: meta.savedAt,
    campaignId: options.campaignId,
    campaignName: options.campaignName,
    floorId: meta.floorId,
    gameState: structuredClone(gameState),
    meta,
  };

  slots[slotId] = slotData;
  await storageAdapter.setItem(DUNGEON_SAVES_STORAGE_KEY, slots);
  return slotData;
}

/**
 * Loads a single save slot from storage.
 */
export async function loadDungeonGameFromSlot(
  slotId: string,
  storageAdapter: DungeonStorageAdapter = defaultDungeonStorageAdapter,
): Promise<DungeonSaveSlotData | null> {
  const slots = await loadDungeonSaveSlots(storageAdapter);
  return slots[slotId] ?? null;
}

/**
 * Deletes a save slot from storage.
 */
export async function deleteDungeonSaveSlot(
  slotId: string,
  storageAdapter: DungeonStorageAdapter = defaultDungeonStorageAdapter,
): Promise<void> {
  const slots = await loadDungeonSaveSlots(storageAdapter);
  if (slots[slotId]) {
    delete slots[slotId];
    await storageAdapter.setItem(DUNGEON_SAVES_STORAGE_KEY, slots);
  }
}

/**
 * Exports a DungeonSaveSlotData to a downloadable JSON envelope string with statutory CC-BY-4.0 notice.
 */
export function exportDungeonSaveToJson(slotData: DungeonSaveSlotData): string {
  const envelope: Srd5DungeonSaveExportEnvelope = {
    format: 'srd5-dungeon-save',
    version: 1,
    srdVersion: '5.1',
    legalAttribution: SRD_LEGAL_ATTRIBUTION,
    exportedAt: new Date().toISOString(),
    saveData: slotData,
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Imports a JSON envelope string into a DungeonSaveSlotData object.
 */
export function importDungeonSaveFromJson(
  rawJson: string,
): { ok: true; data: DungeonSaveSlotData } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(rawJson);
    if (typeof parsed !== 'object' || parsed === null) {
      return { ok: false, error: 'Save file is not a valid JSON object.' };
    }

    if (parsed.format === 'srd5-dungeon-save' && parsed.saveData) {
      return { ok: true, data: parsed.saveData as DungeonSaveSlotData };
    }

    if (parsed.version === 1 && parsed.gameState && parsed.slotId) {
      return { ok: true, data: parsed as DungeonSaveSlotData };
    }

    return { ok: false, error: 'Unrecognized dungeon save file format.' };
  } catch (err) {
    return {
      ok: false,
      error: `JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Triggers a browser download of the exported dungeon save file.
 */
export function triggerDungeonSaveDownload(filename: string, content: string): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
