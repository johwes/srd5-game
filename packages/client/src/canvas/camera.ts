import type { Container } from 'pixi.js';
import {
  DEFAULT_CELL_SIZE,
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  type CameraState,
  type Point,
  type ViewportCameraControls,
} from './types.js';

export interface ViewportCameraOptions {
  x?: number;
  y?: number;
  zoom?: number;
  cellSize?: number;
  minZoom?: number;
  maxZoom?: number;
}

/**
 * Deterministic 2D Viewport Camera with pan, zoom-at-cursor, and coordinate transforms.
 */
export class ViewportCamera implements ViewportCameraControls {
  private x: number;
  private y: number;
  private zoom: number;
  public readonly cellSize: number;
  public readonly minZoom: number;
  public readonly maxZoom: number;

  constructor(options: ViewportCameraOptions = {}) {
    this.x = options.x ?? 0;
    this.y = options.y ?? 0;
    this.zoom = options.zoom ?? DEFAULT_ZOOM;
    this.cellSize = options.cellSize ?? DEFAULT_CELL_SIZE;
    this.minZoom = options.minZoom ?? MIN_ZOOM;
    this.maxZoom = options.maxZoom ?? MAX_ZOOM;
    this.clampZoom();
  }

  public getCamera(): CameraState {
    return {
      x: this.x,
      y: this.y,
      zoom: this.zoom,
    };
  }

  public setCamera(state: Partial<CameraState>): void {
    if (state.x !== undefined) this.x = state.x;
    if (state.y !== undefined) this.y = state.y;
    if (state.zoom !== undefined) {
      this.zoom = state.zoom;
      this.clampZoom();
    }
  }

  public pan(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
  }

  /**
   * Zooms in or out while preserving the world point under the given screen coordinate.
   */
  public zoomAt(screenX: number, screenY: number, delta: number): void {
    const worldPoint = this.screenToWorld(screenX, screenY);
    const targetZoom = Math.min(
      this.maxZoom,
      Math.max(this.minZoom, this.zoom + delta),
    );

    if (Math.abs(targetZoom - this.zoom) < 0.0001) {
      return;
    }

    this.zoom = targetZoom;
    this.x = screenX - worldPoint.x * this.zoom;
    this.y = screenY - worldPoint.y * this.zoom;
  }

  /**
   * Centers the viewport camera on a specific grid cell coordinate.
   */
  public centerOnCell(
    cellX: number,
    cellY: number,
    viewportWidth = 800,
    viewportHeight = 600,
  ): void {
    const cellCenterX = (cellX + 0.5) * this.cellSize;
    const cellCenterY = (cellY + 0.5) * this.cellSize;

    this.x = viewportWidth / 2 - cellCenterX * this.zoom;
    this.y = viewportHeight / 2 - cellCenterY * this.zoom;
  }

  /**
   * Fits the entire tactical grid within the viewport dimensions.
   */
  public fitGrid(
    gridWidth: number,
    gridHeight: number,
    viewportWidth: number,
    viewportHeight: number,
    padding = 32,
  ): void {
    const availW = Math.max(10, viewportWidth - padding * 2);
    const availH = Math.max(10, viewportHeight - padding * 2);
    const gridPixelW = gridWidth * this.cellSize;
    const gridPixelH = gridHeight * this.cellSize;

    const scale = Math.min(availW / gridPixelW, availH / gridPixelH);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, scale));

    this.x = (viewportWidth - gridPixelW * this.zoom) / 2;
    this.y = (viewportHeight - gridPixelH * this.zoom) / 2;
  }

  /**
   * Transforms screen (canvas pixel) coordinates to world (grid pixel) coordinates.
   */
  public screenToWorld(screenX: number, screenY: number): Point {
    return {
      x: (screenX - this.x) / this.zoom,
      y: (screenY - this.y) / this.zoom,
    };
  }

  /**
   * Transforms world (grid pixel) coordinates to screen (canvas pixel) coordinates.
   */
  public worldToScreen(worldX: number, worldY: number): Point {
    return {
      x: worldX * this.zoom + this.x,
      y: worldY * this.zoom + this.y,
    };
  }

  /**
   * Transforms screen (canvas pixel) coordinates to integer 5-ft cell coordinates.
   */
  public screenToCell(screenX: number, screenY: number): Point {
    const world = this.screenToWorld(screenX, screenY);
    return {
      x: Math.floor(world.x / this.cellSize),
      y: Math.floor(world.y / this.cellSize),
    };
  }

  /**
   * Transforms top-left of a cell coordinate to screen (canvas pixel) coordinates.
   */
  public cellToScreen(cellX: number, cellY: number): Point {
    return this.worldToScreen(cellX * this.cellSize, cellY * this.cellSize);
  }

  /**
   * Synchronizes the camera transform directly to a PixiJS Container.
   */
  public applyToContainer(container: Container): void {
    container.position.set(this.x, this.y);
    container.scale.set(this.zoom, this.zoom);
  }

  private clampZoom(): void {
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom));
  }
}
