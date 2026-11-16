import type {
  CampaignModuleSpec,
  CharacterBuildState,
  DungeonFloorSpec,
  LootBundleSpec,
  SrdCompendium,
} from '@srd5/data';
import type {
  Combatant,
  GameState,
  GridPoint,
  InteractiveProp,
  MarchingFormation,
  MarchingOrderConfig,
} from '@srd5/engine';
import type { PlayerViewCombatant, PlayerViewProp, PlayerViewState } from '@srd5/transport';

export type DungeonModalMode =
  | 'marching_order'
  | 'rest_camp'
  | 'loot_inventory'
  | 'save_load'
  | 'pause_menu'
  | 'level_up'
  | 'victory'
  | 'defeat'
  | 'shrine'
  | 'graveyard'
  | null;

export interface DungeonConfig {
  campaignModule: CampaignModuleSpec;
  currentFloorId: string;
  partyCharacters: CharacterBuildState[];
}

export interface MarchingOrderModalProps {
  isOpen: boolean;
  marchingOrder: MarchingOrderConfig;
  party: Record<string, PlayerViewCombatant | Combatant>;
  onClose: () => void;
  onApplyMarchingOrder: (order: string[], formation: MarchingFormation, leadExplorerId: string) => void;
}

export interface RestCampModalProps {
  isOpen: boolean;
  party: Record<string, PlayerViewCombatant | Combatant>;
  compendium: SrdCompendium;
  isSafeRoom: boolean;
  currentRoomName?: string;
  onClose: () => void;
  onStartShortRest: (hitDiceToSpend: Record<string, number>, arcaneRecovery?: Record<string, number[]>) => void;
  onStartLongRest: (options?: { forceSafe?: boolean; preparedSpellUpdates?: Record<string, string[]> }) => void;
}

export interface LootInventoryModalProps {
  isOpen: boolean;
  party: Record<string, PlayerViewCombatant | Combatant>;
  /** Hero to select when the modal opens (targeted/selected combatant, else lead). */
  initialHeroId?: string | null;
  compendium: SrdCompendium;
  activeLoot?: {
    sourcePropId?: string;
    sourceName?: string;
    bundle: LootBundleSpec;
  } | null;
  onClose: () => void;
  onClaimLoot: (characterId: string, propId?: string, loot?: LootBundleSpec) => void;
  onEquipItem: (characterId: string, slotName: 'armor' | 'shield' | 'mainHand' | 'offHand' | 'ranged', instanceId?: string) => void;
  onAttuneItem: (characterId: string, instanceId: string) => void;
  onUnattuneItem: (characterId: string, instanceId: string) => void;
  onUseItem?: (characterId: string, instanceId: string) => void;
}

export interface SaveLoadModalProps {
  isOpen: boolean;
  gameState: GameState;
  campaignId: string;
  campaignName: string;
  floorName: string;
  onClose: () => void;
  onSaveToSlot: (slotId: string, slotName?: string) => Promise<void>;
  onLoadFromSlot: (slotId: string) => Promise<void>;
  onImportSaveState: (savedState: GameState) => void;
}

export interface DungeonExplorationHudProps {
  viewState: PlayerViewState;
  gameState?: GameState;
  compendium: SrdCompendium;
  campaignName: string;
  floorSpec: DungeonFloorSpec;
  leadExplorerId: string;
  inStealth: boolean;
  formation: MarchingFormation;
  adjacentProps: InteractiveProp[] | PlayerViewProp[];
  selectedProp?: InteractiveProp | PlayerViewProp | null;
  hasUnclaimedLoot?: boolean;
  onToggleStealth: () => void;
  onOpenMarchingOrder: () => void;
  onOpenRestCamp: () => void;
  onOpenLootInventory: () => void;
  onOpenSaveLoad: () => void;
  onOpenPauseMenu?: () => void;
  onPerformSearch: () => void;
  onSelectLeadExplorer: (characterId: string) => void;
  onInspectCharacter?: (characterId: string) => void;
  onInteractProp: (
    propId: string,
    interaction: 'open' | 'close' | 'pick_lock' | 'disarm_trap' | 'force_open' | 'search' | 'attack',
  ) => void;
  onDescendStairs?: () => void;
  onAscendStairs?: () => void;
  onExitDelve: () => void;
}
