import type { DungeonSaveSlotData, DungeonStorageAdapter } from '../../persistence/index.js';
import type { AppSettings } from '../../persistence/settingsPersistence.js';

export type { AppSettings };

export interface TitleMenuViewProps {
  onContinue?: (slot: DungeonSaveSlotData) => void;
  onNewGame?: () => void;
  onLoadSlot?: (slot: DungeonSaveSlotData) => void;
  onOpenVault?: () => void;
  onOpenBuilder?: () => void;
  onOpenCompendium?: () => void;
  onOpenArena?: () => void;
  onOpenMultiplayer?: () => void;
  storageAdapter?: DungeonStorageAdapter;
  activeSave?: DungeonSaveSlotData | null;
  settings?: AppSettings;
  onUpdateSettings?: (settings: AppSettings) => void;
}

export interface TitleMenuModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export interface TitleMenuSettingsModalProps extends TitleMenuModalProps {
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => void;
  onResetSettings: () => void;
}

export interface TitleMenuLoadModalProps extends TitleMenuModalProps {
  storageAdapter?: DungeonStorageAdapter;
  onSelectSlot: (slot: DungeonSaveSlotData) => void;
}
