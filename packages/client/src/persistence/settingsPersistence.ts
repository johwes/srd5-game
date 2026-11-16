export interface AppSettings {
  masterVolume: number; // 0 to 100
  sfxVolume: number; // 0 to 100
  musicVolume: number; // 0 to 100
  animationSpeed: 'normal' | 'fast' | 'instant';
  uiScale: '100%' | '110%' | '125%' | '150%';
  gridBrightness: number; // 0 to 100
  diceTray3d: boolean;
  fastAiTurns: boolean;
  /** BG3-style hotbar density: visible icon-grid rows (1–3). */
  hotbarRows: 1 | 2 | 3;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  masterVolume: 80,
  sfxVolume: 80,
  musicVolume: 70,
  animationSpeed: 'normal',
  uiScale: '100%',
  gridBrightness: 70,
  diceTray3d: true,
  fastAiTurns: false,
  hotbarRows: 2,
};

export const SETTINGS_STORAGE_KEY = 'srd5_settings_v1';

let inMemorySettings: AppSettings = { ...DEFAULT_APP_SETTINGS };

function getEffectiveStorage(customStorage?: Storage): Storage | undefined {
  if (customStorage) return customStorage;
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return undefined;
}

/**
 * Loads user settings from storage or returns default settings.
 */
export function loadAppSettings(storage?: Storage): AppSettings {
  const store = getEffectiveStorage(storage);
  if (store) {
    try {
      const raw = store.getItem(SETTINGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) {
          return {
            ...DEFAULT_APP_SETTINGS,
            ...parsed,
          };
        }
      }
    } catch (err) {
      console.warn('Failed to load settings from storage:', err);
    }
  }
  return { ...inMemorySettings };
}

/**
 * Persists user settings to storage.
 */
export function saveAppSettings(
  settings: AppSettings,
  storage?: Storage,
): AppSettings {
  const merged: AppSettings = {
    ...DEFAULT_APP_SETTINGS,
    ...settings,
  };
  inMemorySettings = { ...merged };

  const store = getEffectiveStorage(storage);
  if (store) {
    try {
      store.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged));
    } catch (err) {
      console.warn('Failed to save settings to storage:', err);
    }
  }

  return merged;
}

/**
 * Resets settings back to default values.
 */
export function resetAppSettings(storage?: Storage): AppSettings {
  return saveAppSettings(DEFAULT_APP_SETTINGS, storage);
}
