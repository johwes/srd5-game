import type { GameState } from '@srd5/engine';
import type { DungeonStorageAdapter } from '../../persistence/dungeonSavePersistence.js';

export type PauseMenuSubView =
  | 'main'
  | 'save'
  | 'load'
  | 'party'
  | 'settings'
  | 'confirm_exit';

export interface PauseMenuPartyMember {
  id: string;
  name: string;
  className: string;
  level: number;
  currentHp: number;
  maxHp: number;
  ac?: number;
  conditions?: string[];
}

export interface PauseMenuModalProps {
  isOpen: boolean;
  onClose: () => void; // Resume Game
  gameState?: GameState;
  campaignId?: string;
  campaignName?: string;
  floorName?: string;
  party?: Record<string, any> | any[];
  storageAdapter?: DungeonStorageAdapter;
  settingsStorage?: Storage;
  onQuickSave?: () => Promise<void> | void;
  onSaveToSlot?: (slotId: string, label: string) => Promise<void> | void;
  onLoadFromSlot?: (slotId: string) => Promise<void> | void;
  onOpenCharacterSheet?: (characterId: string) => void;
  onOpenInventory?: () => void;
  onExitToTitle: () => void;
}
