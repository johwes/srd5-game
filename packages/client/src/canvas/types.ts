import type { Container } from 'pixi.js';
import type { ConditionId, CreatureSize } from '@srd5/data';
import type {
  AoeShape,
  CardinalFacing,
  CombatantSide,
  CoverLevel,
  CoverResult,
  GridCell,
  GridCreature,
  GridPoint,
  PathfindingResult,
  PathStep,
  TacticalGrid,
  TileTerrainType,
  VisionCreature,
} from '@srd5/engine';
import type { GameEvent, PlayerViewCell, PlayerViewCombatant, PlayerViewGrid } from '@srd5/transport';

/**
 * Standard pixel dimensions for a 5-ft tactical square on the canvas.
 */
export const DEFAULT_CELL_SIZE = 48 as const;

/**
 * Minimum and maximum camera zoom limits.
 */
export const MIN_ZOOM = 0.25 as const;
export const MAX_ZOOM = 3.0 as const;
export const DEFAULT_ZOOM = 1.0 as const;
export const ZOOM_STEP = 0.15 as const;

/**
 * 2D Point on the screen or grid.
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Viewport camera state representing pan offset and zoom level.
 */
export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Public camera control interface.
 */
export interface ViewportCameraControls {
  getCamera(): CameraState;
  setCamera(state: Partial<CameraState>): void;
  pan(dx: number, dy: number): void;
  zoomAt(screenX: number, screenY: number, delta: number): void;
  centerOnCell(
    cellX: number,
    cellY: number,
    viewportWidth?: number,
    viewportHeight?: number,
  ): void;
  fitGrid(
    gridWidth: number,
    gridHeight: number,
    viewportWidth: number,
    viewportHeight: number,
    padding?: number,
  ): void;
  screenToWorld(screenX: number, screenY: number): Point;
  worldToScreen(worldX: number, worldY: number): Point;
  screenToCell(screenX: number, screenY: number): Point;
  cellToScreen(cellX: number, cellY: number): Point;
}

/**
 * The 7 scene graph layers as specified in Spec 05 Section 3.1.
 */
export const LAYER_NAMES = [
  'terrain',
  'hazard',
  'prop',
  'pathAoe',
  'token',
  'fog',
  'floatingText',
] as const;

export type LayerName = (typeof LAYER_NAMES)[number];

/**
 * Typed references to the 7 tactical layers under the viewport container.
 */
export interface TacticalSceneGraph {
  stage: Container;
  viewport: Container;
  terrainLayer: Container;
  hazardLayer: Container;
  propLayer: Container;
  pathAoeLayer: Container;
  tokenLayer: Container;
  fogLayer: Container;
  floatingTextLayer: Container;
}

/**
 * Unified cell interface compatible with both TacticalGrid and PlayerViewGrid.
 */
export type CanvasGridInput = TacticalGrid | PlayerViewGrid;
export type CanvasCellInput = GridCell | PlayerViewCell;

/**
 * Cardinal and ordinal creature facing directions.
 */
export const CREATURE_FACINGS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
export type CreatureFacing = (typeof CREATURE_FACINGS)[number];

/**
 * Normalized combatant data for rendering creature tokens on the PixiJS canvas.
 * Directly compatible with PlayerViewCombatant from @srd5/transport.
 */
export interface CreatureTokenData {
  id: string;
  name: string;
  side: CombatantSide;
  size: CreatureSize;
  position: Point;
  currentHp: number;
  maxHp: number;
  tempHp?: number;
  armorClass?: number;
  conditions?: ConditionId[];
  isDead?: boolean;
  isStable?: boolean;
  facing?: CreatureFacing;
  label?: string;
  color?: number;
  teamId?: string;
  avatarUrl?: string;
}

/**
 * Options for configuring and updating the CreatureTokenLayer.
 */
export interface TokenRenderOptions {
  combatants:
    | Record<string, CreatureTokenData | PlayerViewCombatant>
    | Array<CreatureTokenData | PlayerViewCombatant>;
  cellSize: number;
  selectedId?: string | null;
  activeId?: string | null;
  hoveredId?: string | null;
  showHpArc?: boolean;
  showConditionBadges?: boolean;
  showFacing?: boolean;
  showNameTags?: boolean;
}

/**
 * Configuration options for path movement animations.
 */
export interface TokenMoveAnimationOptions {
  path?: Point[];
  durationMs?: number;
  speedCellsPerSec?: number;
  onStep?: (currentPos: Point, stepIndex: number) => void;
}

/**
 * Categories of floating combat text.
 */
export type FloatingTextType = 'damage' | 'heal' | 'crit' | 'miss' | 'condition' | 'info';

/**
 * Parameters for spawning an animated floating text entry.
 */
export interface FloatingTextOptions {
  id?: string;
  text: string;
  worldX: number;
  worldY: number;
  type?: FloatingTextType;
  color?: number;
  durationMs?: number;
  driftY?: number;
  fontSize?: number;
}

/**
 * Options for rendering the terrain layer.
 */
export interface TerrainRenderOptions {
  grid: CanvasGridInput;
  cellSize: number;
  showGridLines?: boolean;
  showCoordinates?: boolean;
  hoveredCell?: Point | null;
  selectedCell?: Point | null;
}

/**
 * Options for configuring movement path previews and Opportunity Attack warnings.
 */
export interface PathPreviewOptions {
  mover: GridCreature | CreatureTokenData | PlayerViewCombatant;
  destination: Point;
  grid: CanvasGridInput;
  creatures?: ReadonlyArray<GridCreature | CreatureTokenData | PlayerViewCombatant>;
  movementRemainingFeet?: number;
  dashBonusFeet?: number;
  isDisengaged?: boolean;
  precomputedResult?: PathfindingResult;
  showOpportunityAttacks?: boolean;
  showDestinationBadge?: boolean;
}

/**
 * Options for configuring AOE spell and ability targeting templates.
 */
export interface AoeOverlayOptions {
  shape: AoeShape;
  cursor: Point;
  cursorIsWorldCoords?: boolean;
  casterPosition?: Point;
  casterSize?: CreatureSize;
  radiusFeet?: number;
  lengthFeet?: number;
  widthFeet?: number;
  sideFeet?: number;
  facing?: CardinalFacing;
  grid?: CanvasGridInput;
  creatures?: ReadonlyArray<GridCreature | CreatureTokenData | PlayerViewCombatant>;
  color?: number;
  alpha?: number;
}

/**
 * Options for configuring Line of Sight and Cover targeting rays.
 */
export interface TargetingRayOptions {
  attacker: VisionCreature | CreatureTokenData | PlayerViewCombatant;
  target: VisionCreature | CreatureTokenData | PlayerViewCombatant;
  grid: CanvasGridInput;
  obstacles?: ReadonlyArray<VisionCreature | CreatureTokenData | PlayerViewCombatant>;
  attackBonus?: number;
  targetAc?: number;
  showAllRays?: boolean;
  precomputedCover?: CoverResult;
}

/**
 * Combined options for PathAndAoeLayer rendering.
 */
export interface InteractiveOverlayOptions {
  cellSize: number;
  pathPreview?: PathPreviewOptions | null;
  aoeTemplate?: AoeOverlayOptions | null;
  targetingRay?: TargetingRayOptions | null;
}

/**
 * Props for the TacticalCanvasViewport React component.
 */
export interface TacticalCanvasViewportProps {
  grid: CanvasGridInput;
  cellSize?: number;
  className?: string;
  showGridLines?: boolean;
  showCoordinates?: boolean;
  selectedCell?: Point | null;
  hoveredCell?: Point | null;
  combatants?:
    | Record<string, CreatureTokenData | PlayerViewCombatant>
    | Array<CreatureTokenData | PlayerViewCombatant>;
  selectedCombatantId?: string | null;
  activeCombatantId?: string | null;
  hoveredCombatantId?: string | null;
  showTokenHpArcs?: boolean;
  showConditionBadges?: boolean;
  showTokenFacing?: boolean;
  showTokenNames?: boolean;
  pathPreview?: PathPreviewOptions | null;
  enableHoverPathPreview?: boolean;
  activeAoeTemplate?: AoeOverlayOptions | null;
  targetingRay?: TargetingRayOptions | null;
  attackBonus?: number;
  targetingMode?: 'move' | 'aoe' | 'attack' | 'none';
  onCellHover?: (cell: Point | null) => void;
  onCellClick?: (cell: Point, button: number) => void;
  onCombatantHover?: (combatantId: string | null) => void;
  onCombatantClick?: (combatantId: string) => void;
  onCameraChange?: (camera: CameraState) => void;
  cameraRef?: React.MutableRefObject<ViewportCameraControls | null>;
  initialCamera?: Partial<CameraState>;
  interactive?: boolean;
  width?: number | string;
  height?: number | string;
  testId?: string;
}
