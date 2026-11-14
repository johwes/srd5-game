import type { Container } from 'pixi.js';
import type { GridCell, TacticalGrid, TileTerrainType } from '@srd5/engine';
import type { PlayerViewCell, PlayerViewGrid } from '@srd5/transport';

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
  onCellHover?: (cell: Point | null) => void;
  onCellClick?: (cell: Point, button: number) => void;
  onCameraChange?: (camera: CameraState) => void;
  cameraRef?: React.MutableRefObject<ViewportCameraControls | null>;
  initialCamera?: Partial<CameraState>;
  interactive?: boolean;
  width?: number | string;
  height?: number | string;
  testId?: string;
}
