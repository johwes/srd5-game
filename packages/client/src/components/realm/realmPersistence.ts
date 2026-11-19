/** Realm session save / load via the shared IndexedDB storage adapter. */

import {
  buildStarterQuestChains,
  createQuestChainLog,
  createWarDiplomacyState,
  getSettlements,
} from '@srd5/engine';
import {
  type DungeonStorageAdapter,
  defaultDungeonStorageAdapter,
} from '../../persistence/index.js';

import {
  getPartyList,
} from './realmExpeditions.js';
import {
  RealmSessionState,
} from './realmSession.js';
// ---------------------------------------------------------------------------
// Save / Load (IndexedDB via the shared storage adapter)
// ---------------------------------------------------------------------------

export const REALM_SAVE_STORAGE_KEY = 'srd5:realm-save:v1';

export interface RealmSaveData {
  version: 1;
  savedAt: string;
  worldName: string;
  currentDay: number;
  partySummary: Array<{ id: string; name: string; currentHp: number; maxHp: number }>;
  session: RealmSessionState;
}

export async function quickSaveRealmSession(
  session: RealmSessionState,
  adapter: DungeonStorageAdapter = defaultDungeonStorageAdapter,
): Promise<RealmSaveData> {
  const data: RealmSaveData = {
    version: 1,
    savedAt: new Date().toISOString(),
    worldName: session.map.worldName,
    currentDay: session.travel.currentDay,
    partySummary: getPartyList(session).map((c) => ({
      id: c.id,
      name: c.name,
      currentHp: c.currentHp,
      maxHp: c.maxHp,
    })),
    session: structuredClone(session),
  };
  await adapter.setItem(REALM_SAVE_STORAGE_KEY, data);
  return data;
}

export async function loadRealmSession(
  adapter: DungeonStorageAdapter = defaultDungeonStorageAdapter,
): Promise<RealmSaveData | null> {
  const raw = await adapter.getItem(REALM_SAVE_STORAGE_KEY);
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as RealmSaveData;
  if (data.version !== 1 || !data.session?.map || !data.session?.travel) return null;
  // Backward compatibility with pre-SRD-808 saves (no revealed POI tracking).
  if (!Array.isArray((data.session as RealmSessionState).revealedPoiIds)) {
    (data.session as RealmSessionState).revealedPoiIds = getSettlements(data.session.map).map(
      (poi) => poi.id,
    );
  }
  // Backward compatibility with pre-SRD-809 saves (no quest chains).
  if (!(data.session as RealmSessionState).chainLog) {
    (data.session as RealmSessionState).chainLog = createQuestChainLog(
      buildStarterQuestChains(data.session.map),
    );
  }
  // Backward compatibility with pre-SRD-1105 saves (no war campaign).
  if ((data.session as RealmSessionState).war === undefined) {
    (data.session as RealmSessionState).war = null;
  }
  if (!(data.session as RealmSessionState).diplomacy) {
    (data.session as RealmSessionState).diplomacy = createWarDiplomacyState();
  }
  if ((data.session as RealmSessionState).activeWarMission === undefined) {
    (data.session as RealmSessionState).activeWarMission = null;
  }
  if ((data.session as RealmSessionState).pendingWarBattle === undefined) {
    (data.session as RealmSessionState).pendingWarBattle = null;
  }
  return data;
}
