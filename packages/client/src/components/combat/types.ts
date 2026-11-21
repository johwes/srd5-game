import type { SrdCompendium } from '@srd5/data';
import type {
  DerivedCharacterSheet,
  DerivedWeaponAttackProfile,
  DiceRollRecord,
  GameEvent,
  PendingReactionPrompt,
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
  | 'items'
  | 'summon';

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
  onLevelUpCharacter?: (combatantId: string) => void;
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
  combatants?: Record<string, PlayerViewCombatant>;
  selectedCombatantId?: string | null;
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
  onUseItem?: (itemInstanceId: string, targetId?: string) => void;
  onUseSummonAction?: (actionId: string) => void;
  onDismissSummon?: (summon: PlayerViewCombatant) => void;
  onEndTurn?: () => void;
  onOpenCharacterSheet?: (combatantId: string) => void;
  /** Initial hotbar icon-grid rows (1–3); defaults to persisted AppSettings. */
  initialRows?: number;
  className?: string;
}

export interface ReactionInterruptModalProps {
  prompt: PendingReactionPrompt;
  reactorCombatant?: PlayerViewCombatant | null;
  onResolve: (
    decision:
      | { execute: false }
      | { execute: true; reactionId: string; slotLevel?: number },
  ) => void;
  isOpen?: boolean;
  /** Server-authoritative absolute epoch-ms deadline (multiplayer). */
  deadlineMs?: number | null;
  /** When true the server owns timeout resolution; expiry only stops the UI clock. */
  serverAuthoritativeTimeout?: boolean;
  className?: string;
}

export interface DiceTrayProps {
  activeRoll?: DiceRollRecord | null;
  rollHistory?: DiceRollRecord[];
  rollPurpose?: string;
  actorName?: string;
  onReroll?: () => void;
  onClearHistory?: () => void;
  onSelectHistoryRoll?: (roll: DiceRollRecord) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  className?: string;
}

export type CombatLogFilter =
  | 'all'
  | 'attacks'
  | 'damage'
  | 'saves'
  | 'spells'
  | 'conditions'
  | 'reactions'
  | 'system';

export interface CombatLogProps {
  events?: GameEvent[];
  combatants?: Record<string, PlayerViewCombatant>;
  maxEntries?: number;
  activeFilter?: CombatLogFilter;
  onFilterChange?: (filter: CombatLogFilter) => void;
  onInspectRoll?: (roll: DiceRollRecord, label?: string) => void;
  onClearLog?: () => void;
  className?: string;
}

export interface TacticalCombatHudProps {
  viewState: PlayerViewState;
  compendium?: SrdCompendium;
  selectedCombatantId?: string | null;
  title?: string;
  subtitle?: string;
  menuButtonText?: string;
  menuButtonTestId?: string;
  headerExtras?: React.ReactNode;
  events?: GameEvent[];
  activeRoll?: DiceRollRecord | null;
  rollHistory?: DiceRollRecord[];
  /**
   * BG3-style single owner: the HUD always owns log/dice visibility. Parents
   * pass initial values only; toggles report the new state via the
   * `onToggle*` notification callbacks (previously the Arena mirrored this
   * state and fought the HUD for ownership).
   */
  defaultShowCombatLog?: boolean;
  defaultShowDiceTray?: boolean;
  isPlayerControlled?: boolean;
  onToggleCombatLog?: (open: boolean) => void;
  onToggleDiceTray?: (open: boolean) => void;
  onSelectCombatant?: (combatantId: string) => void;
  onOpenCharacterSheet?: (combatantId: string) => void;
  onLevelUpCharacter?: (combatantId: string) => void;
  onDeclareAttack?: (
    weaponProfile: DerivedWeaponAttackProfile,
    options?: { isOffHand?: boolean; twoHanded?: boolean },
  ) => void;
  onCastSpell?: (spellId: string, slotLevel: number) => void;
  onUseClassFeature?: (featureId: string, optionId?: string) => void;
  onStandardAction?: (action: StandardActionType) => void;
  onUseItem?: (itemInstanceId: string, targetId?: string) => void;
  onUseSummonAction?: (actionId: string) => void;
  onDismissSummon?: (summon: PlayerViewCombatant) => void;
  onEndTurn?: () => void;
  onToggleMenu?: () => void;
  onResolveReaction?: (
    decision:
      | { execute: false }
      | { execute: true; reactionId: string; slotLevel?: number },
  ) => void;
  onClearLog?: () => void;
  onInspectRoll?: (roll: DiceRollRecord, label?: string) => void;
  children?: React.ReactNode;
  rightPanel?: React.ReactNode;
  className?: string;
}
