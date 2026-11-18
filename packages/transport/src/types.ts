import {
  type ActiveEffectInstance,
  type ConditionId,
  type CreatureSize,
} from '@srd5/data';
import {
  type ActiveConcentration,
  type CombatPhase,
  type CombatVictoryOutcome,
  type CombatantSide,
  type DerivedCharacterSheet,
  type CharacterBuildState,
  type GameCommand,
  type GameEvent,
  type GameMode,
  type GameState,
  type GridPoint,
  type HazardZone,
  type InteractiveProp,
  type LightLevel,
  type PendingReactionPrompt,
  type PlayerSlotAssignment,
  type PropKind,
  type PropState,
  type TileTerrainType,
  type TurnBudget,
} from '@srd5/engine';

export type {
  GameCommand,
  GameEvent,
  GameState,
  GameMode,
  InteractiveProp,
  PlayerSlotAssignment,
  PropKind,
  PropState,
};

/**
 * Fog-of-War cell visibility levels (Spec 05 Section 2.3).
 */
export const CELL_VISIBILITIES = ['unexplored', 'remembered', 'visible'] as const;
export type CellVisibility = (typeof CELL_VISIBILITIES)[number];

/**
 * Projected cell visible to a player client.
 * For 'unexplored' cells, terrain geometry is masked / redacted.
 */
export interface PlayerViewCell {
  x: number;
  y: number;
  visibility: CellVisibility;
  terrain?: TileTerrainType | undefined;
  effectiveLight?: LightLevel | undefined;
  elevationFeet?: number | undefined;
  difficultTerrain?: boolean | undefined;
  blocksMovement?: boolean | undefined;
  blocksSight?: boolean | undefined;
}

/**
 * 2D Grid with dynamic Fog-of-War masking applied.
 */
export interface PlayerViewGrid {
  width: number;
  height: number;
  cells: PlayerViewCell[];
}

/**
 * Interactive prop filtered for player visibility.
 * Hidden traps or secret doors not yet detected are completely stripped.
 */
export interface PlayerViewProp {
  id: string;
  x: number;
  y: number;
  kind: PropKind;
  state: PropState;
  blocksMovement: boolean;
  blocksSight: boolean;
  shrineType?: string;
  /** SRD-512: furniture subtype (desk, throne, …) for canvas icons. */
  furnitureType?: string;
  /** Engine discovery flag, projected so the canvas can hide undiscovered
   * traps and secret doors without re-deriving fog. */
  discovered?: boolean;
}

/**
 * Creature token projected for client rendering.
 * Hostile monsters located in 'unexplored' or 'remembered' fog are stripped.
 */
export interface PlayerViewCombatant {
  id: string;
  name: string;
  side: CombatantSide;
  teamId?: string | undefined;
  playerId?: string | undefined;
  size: CreatureSize;
  position: GridPoint;
  speedFeet: number;
  currentHp: number;
  maxHp: number;
  tempHp: number;
  armorClass: number;
  conditions: ConditionId[];
  activeEffects?: ActiveEffectInstance[] | undefined;
  concentratingOn?: ActiveConcentration | undefined;
  isDead: boolean;
  isStable: boolean;
  reactionAvailable?: boolean | undefined;
  characterSheet?: DerivedCharacterSheet | undefined;
  levelUpAvailable?: boolean | undefined;
  buildState?: CharacterBuildState | undefined;
  tokenSpriteId?: string | undefined;
  monsterType?: string | undefined;
  challengeRating?: number | undefined;
  /** True for conjured tokens spawned by the summon pipeline (Spec 08 §5 / SRD-903). */
  isSummon?: boolean | undefined;
  /** Entity id of the caster who owns this summon's transitive control chain. */
  summonedByEntityId?: string | undefined;
  /** Stable DSL id of the summon (e.g. `faithful-hound-token`). */
  summonId?: string | undefined;
  /** Source spell name, shown on the HUD medallion "Summoned" chip (SRD-904). */
  summonSourceName?: string | undefined;
  /** Commanded summons take turns; autonomous ones resolve via triggers. */
  summonControl?: 'commanded' | 'autonomous' | undefined;
  /** Untargetable conjurations are skipped by client target picks (SRD-904). */
  untargetable?: boolean | undefined;
  /** Autonomous summons that the caster can dismiss as an action. */
  summonDismissible?: boolean | undefined;
  /** Lightweight action list for the summon command hotbar (SRD-904). */
  summonActions?: Array<{ id: string; name: string; description: string }> | undefined;
}

/**
 * Single entry in the projected initiative ribbon.
 */
export interface PlayerViewInitiativeEntry {
  entityId: string;
  initiative: number;
  isVisible: boolean;
}

/**
 * Projected combat state.
 * Authoritative RNG seeds and other players' private data are stripped.
 */
export interface PlayerViewCombatState {
  encounterId: string;
  round: number;
  phase: CombatPhase;
  initiativeOrder: PlayerViewInitiativeEntry[];
  activeCombatantId: string | null;
  turnBudget: TurnBudget | null;
  outcome: CombatVictoryOutcome;
  pendingReactionPrompt?: PendingReactionPrompt | null | undefined;
  /**
   * Absolute epoch-ms deadline for the pending reaction prompt. Projected only
   * to the player who controls the reactor so multiplayer clients can show an
   * authoritative countdown (Spec 03 Section 5.2 / SRD-703).
   */
  reactionPromptDeadline?: number | null | undefined;
  hazardZones?: HazardZone[] | undefined;
}

/**
 * Projected authoritative game state filtered for a specific player view (Spec 05 Section 2.3).
 */
export interface PlayerViewState {
  playerId: string;
  mode: GameMode;
  grid: PlayerViewGrid;
  party: Record<string, PlayerViewCombatant>;
  combatants: Record<string, PlayerViewCombatant>;
  props: PlayerViewProp[];
  combat: PlayerViewCombatState | null;
}

/**
 * Callback listener invoked on state transitions.
 */
export type StateUpdateListener = (
  viewState: PlayerViewState,
  events: GameEvent[],
) => void;

/**
 * Abstract Command / Event Transport Interface (Spec 05 Section 2).
 */
export interface GameTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  dispatch(command: GameCommand): Promise<{
    viewState: PlayerViewState;
    events: GameEvent[];
  }>;
  subscribe(listener: StateUpdateListener): () => void;
  getPlayerViewState(playerId?: string): PlayerViewState;
  getSlotAssignments(): PlayerSlotAssignment[];
}
