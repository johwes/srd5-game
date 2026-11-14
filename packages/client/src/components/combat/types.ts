import type { SrdCompendium } from '@srd5/data';
import type {
  DerivedCharacterSheet,
  DerivedWeaponAttackProfile,
  TurnBudget,
} from '@srd5/engine';
import type {
  PlayerViewCombatant,
  PlayerViewInitiativeEntry,
  PlayerViewState,
} from '@srd5/transport';

export type CombatActionTab =
  | 'attack'
  | 'spells'
  | 'features'
  | 'standard'
  | 'items';

export type StandardActionType =
  | 'dash'
  | 'disengage'
  | 'dodge'
  | 'help'
  | 'hide'
  | 'search'
  | 'stand_up'
  | 'drop_concentration'
  | 'action_surge';

export interface StandardActionDefinition {
  id: StandardActionType;
  name: string;
  actionCost: 'action' | 'bonus_action' | 'movement' | 'free';
  description: string;
  icon: string;
  requiresBonusAction?: boolean;
}

export interface InitiativeRibbonProps {
  round: number;
  phase?: string;
  initiativeOrder: PlayerViewInitiativeEntry[];
  combatants: Record<string, PlayerViewCombatant>;
  activeCombatantId: string | null;
  selectedCombatantId?: string | null;
  onSelectCombatant?: (combatantId: string) => void;
  className?: string;
}

export interface PartyPortraitsProps {
  party: Record<string, PlayerViewCombatant> | PlayerViewCombatant[];
  activeCombatantId: string | null;
  selectedCombatantId?: string | null;
  onSelectPartyMember?: (combatantId: string) => void;
  onOpenCharacterSheet?: (combatantId: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  className?: string;
}

export interface TurnBudgetIndicatorProps {
  turnBudget: TurnBudget | null;
  speedFeet?: number;
  compact?: boolean;
  className?: string;
}

export interface ActionHotbarProps {
  activeCombatant: PlayerViewCombatant | null;
  turnBudget: TurnBudget | null;
  compendium?: SrdCompendium;
  isPlayerControlled?: boolean;
  activeTab?: CombatActionTab;
  onTabChange?: (tab: CombatActionTab) => void;
  onDeclareAttack?: (
    weaponProfile: DerivedWeaponAttackProfile,
    options?: { isOffHand?: boolean; twoHanded?: boolean },
  ) => void;
  onCastSpell?: (spellId: string, slotLevel: number) => void;
  onUseClassFeature?: (featureId: string, optionId?: string) => void;
  onStandardAction?: (action: StandardActionType) => void;
  onUseItem?: (itemId: string) => void;
  onEndTurn?: () => void;
  className?: string;
}

export interface TacticalCombatHudProps {
  viewState: PlayerViewState;
  compendium?: SrdCompendium;
  selectedCombatantId?: string | null;
  title?: string;
  subtitle?: string;
  onSelectCombatant?: (combatantId: string) => void;
  onOpenCharacterSheet?: (combatantId: string) => void;
  onDeclareAttack?: (
    weaponProfile: DerivedWeaponAttackProfile,
    options?: { isOffHand?: boolean; twoHanded?: boolean },
  ) => void;
  onCastSpell?: (spellId: string, slotLevel: number) => void;
  onUseClassFeature?: (featureId: string, optionId?: string) => void;
  onStandardAction?: (action: StandardActionType) => void;
  onUseItem?: (itemId: string) => void;
  onEndTurn?: () => void;
  onToggleMenu?: () => void;
  children?: React.ReactNode;
  rightPanel?: React.ReactNode;
  className?: string;
}
