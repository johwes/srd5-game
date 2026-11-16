import { Container, Graphics, Text } from 'pixi.js';
import type { TileTerrainType } from '@srd5/engine';
import type { CanvasCellInput, CanvasGridInput, Point, TerrainRenderOptions } from '../types.js';

export const TERRAIN_PALETTE: Record<TileTerrainType, { fill: number; border?: number }> = {
  void: { fill: 0x020617 },
  floor_stone: { fill: 0x334155, border: 0x1e293b },
  floor_wood: { fill: 0x78350f, border: 0x451a03 },
  floor_sand: { fill: 0x9a7d46, border: 0x6e5a30 },
  floor_basalt: { fill: 0x1c1917, border: 0x44403c },
  wall_solid: { fill: 0x0f172a, border: 0x020617 },
  chasm: { fill: 0x020617, border: 0x334155 },
  water_shallow: { fill: 0x0284c7, border: 0x0369a1 },
  water_deep: { fill: 0x1e3a8a, border: 0x172554 },
  rubble: { fill: 0x475569, border: 0x334155 },
  lava: { fill: 0xdc2626, border: 0xb91c1c },
};

/**
 * Handles rendering the terrain tiles, 5-ft grid lines overlay, coordinates, and cell highlights.
 */
export class TerrainTileRenderer {
  public readonly container: Container;
  private tilesGraphics: Graphics;
  private gridLinesGraphics: Graphics;
  private highlightsGraphics: Graphics;
  private coordsContainer: Container;

  private lastGridSignature: string | null = null;
  private lastShowGridLines: boolean | undefined;
  private lastShowCoords: boolean | undefined;
  private lastIgnoreVisibility: boolean | undefined;

  constructor(parent?: Container) {
    this.container = new Container();
    this.container.label = 'TerrainTileRenderer';

    this.tilesGraphics = new Graphics();
    this.tilesGraphics.label = 'TilesGraphics';

    this.gridLinesGraphics = new Graphics();
    this.gridLinesGraphics.label = 'GridLinesGraphics';

    this.highlightsGraphics = new Graphics();
    this.highlightsGraphics.label = 'HighlightsGraphics';

    this.coordsContainer = new Container();
    this.coordsContainer.label = 'CoordsContainer';

    this.container.addChild(this.tilesGraphics);
    this.container.addChild(this.gridLinesGraphics);
    this.container.addChild(this.coordsContainer);
    this.container.addChild(this.highlightsGraphics);

    if (parent) {
      parent.addChild(this.container);
    }
  }

  /**
   * Renders or updates the terrain layer with the specified options.
   */
  public render(options: TerrainRenderOptions): void {
    const {
      grid,
      cellSize,
      showGridLines = true,
      showCoordinates = false,
      hoveredCell,
      selectedCell,
      ignoreVisibility = false,
    } = options;

    // Signature covers dimensions AND terrain content: tiles must redraw when
    // the environment changes even if the grid size stays identical (e.g.
    // arena relaunch with a different obstacle set, or dungeon floor change).
    const gridSignature = [
      grid.width,
      grid.height,
      cellSize,
      ignoreVisibility,
      grid.cells
        .map(
          (c) =>
            `${c.terrain}${c.difficultTerrain ? 'd' : ''}${c.blocksMovement ? 'm' : ''}${c.blocksSight ? 's' : ''}${'visibility' in c ? (c as { visibility?: string }).visibility?.[0] ?? '' : ''}`,
        )
        .join(','),
    ].join('|');

    const gridChanged = this.lastGridSignature !== gridSignature;

    if (gridChanged) {
      this.lastGridSignature = gridSignature;
      this.drawTiles(grid, cellSize, ignoreVisibility);
    }

    if (gridChanged || this.lastShowGridLines !== showGridLines) {
      this.lastShowGridLines = showGridLines;
      this.drawGridLines(grid.width, grid.height, cellSize, showGridLines);
    }

    if (gridChanged || this.lastShowCoords !== showCoordinates) {
      this.lastShowCoords = showCoordinates;
      this.drawCoordinates(grid.width, grid.height, cellSize, showCoordinates);
    }

    this.drawHighlights(grid.width, grid.height, cellSize, hoveredCell, selectedCell);
  }

  /**
   * Redraws all individual terrain tiles.
   */
  public drawTiles(grid: CanvasGridInput, cellSize: number, ignoreVisibility = false): void {
    this.tilesGraphics.clear();

    const cellMap = new Map<string, CanvasCellInput>();
    for (const cell of grid.cells) {
      cellMap.set(`${cell.x},${cell.y}`, cell);
    }

    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = cellMap.get(`${x},${y}`);
        const px = x * cellSize;
        const py = y * cellSize;

        // If cell is unexplored in PlayerViewGrid, render opaque void and skip tile details (unless visibility check is bypassed)
        if (
          !ignoreVisibility &&
          cell &&
          'visibility' in cell &&
          (cell as any).visibility === 'unexplored'
        ) {
          this.tilesGraphics.rect(px, py, cellSize, cellSize).fill(0x000000);
          continue;
        }

        const terrain: TileTerrainType = cell?.terrain ?? 'floor_stone';
        const palette = TERRAIN_PALETTE[terrain] ?? TERRAIN_PALETTE.floor_stone;

        // Base tile fill
        this.tilesGraphics.rect(px, py, cellSize, cellSize).fill(palette.fill);

        // Subtle tile inner border
        if (palette.border !== undefined) {
          this.tilesGraphics.rect(px, py, cellSize, cellSize).stroke({
            color: palette.border,
            width: 1,
            alpha: 0.5,
          });
        }

        // Distinct styling details by terrain type.
        // Pseudo-random offsets derive from cell coords so renders are stable.
        const hash = Math.abs(x * 7 + y * 13);
        if (terrain === 'wall_solid') {
          // Thick wall bevel
          this.tilesGraphics
            .rect(px + 3, py + 3, cellSize - 6, cellSize - 6)
            .fill(0x020617);
        } else if (terrain === 'floor_wood') {
          // Wood plank seams (bridge decking reads clearly)
          this.tilesGraphics
            .moveTo(px + 2, py + cellSize / 3)
            .lineTo(px + cellSize - 2, py + cellSize / 3)
            .stroke({ color: 0x451a03, width: 1.5, alpha: 0.7 });
          this.tilesGraphics
            .moveTo(px + 2, py + (2 * cellSize) / 3)
            .lineTo(px + cellSize - 2, py + (2 * cellSize) / 3)
            .stroke({ color: 0x451a03, width: 1.5, alpha: 0.7 });
        } else if (terrain === 'floor_sand') {
          // Wind-blown sand speckles
          const dots = [
            [8 + (hash % 9), 10 + ((hash >> 2) % 9)],
            [cellSize - 12 - (hash % 7), 8 + ((hash >> 3) % 11)],
            [10 + ((hash >> 4) % 8), cellSize - 10 - (hash % 6)],
          ];
          for (const [dx, dy] of dots) {
            this.tilesGraphics.rect(px + dx, py + dy, 3, 2).fill(0x6e5a30);
          }
        } else if (terrain === 'floor_basalt') {
          // Cooled volcanic cracks with a faint ember seam
          this.tilesGraphics
            .moveTo(px + 5 + (hash % 8), py + 4)
            .lineTo(px + 9 + (hash % 8), py + cellSize - 4)
            .stroke({ color: 0x0a0a0a, width: 1.5, alpha: 0.8 });
          this.tilesGraphics
            .moveTo(px + 4, py + 8 + ((hash >> 2) % 10))
            .lineTo(px + cellSize - 4, py + 12 + ((hash >> 2) % 10))
            .stroke({ color: 0x7f1d1d, width: 1, alpha: 0.55 });
        } else if (terrain === 'chasm') {
          // Pit depth: darker core with a rocky rim-light on edges bordering
          // non-chasm cells, so the rift reads as a hole instead of a shadow.
          this.tilesGraphics
            .rect(px + 5, py + 5, cellSize - 10, cellSize - 10)
            .fill({ color: 0x000000, alpha: 0.65 });
          const isRim = (nx: number, ny: number) => {
            const neighbor = cellMap.get(`${nx},${ny}`);
            return !neighbor || neighbor.terrain !== 'chasm';
          };
          const rimColor = 0x94a3b8;
          if (isRim(x, y - 1)) {
            this.tilesGraphics
              .moveTo(px + 1, py + 1.5)
              .lineTo(px + cellSize - 1, py + 1.5)
              .stroke({ color: rimColor, width: 2, alpha: 0.9 });
          }
          if (isRim(x, y + 1)) {
            this.tilesGraphics
              .moveTo(px + 1, py + cellSize - 1.5)
              .lineTo(px + cellSize - 1, py + cellSize - 1.5)
              .stroke({ color: rimColor, width: 2, alpha: 0.9 });
          }
          if (isRim(x - 1, y)) {
            this.tilesGraphics
              .moveTo(px + 1.5, py + 1)
              .lineTo(px + 1.5, py + cellSize - 1)
              .stroke({ color: rimColor, width: 2, alpha: 0.9 });
          }
          if (isRim(x + 1, y)) {
            this.tilesGraphics
              .moveTo(px + cellSize - 1.5, py + 1)
              .lineTo(px + cellSize - 1.5, py + cellSize - 1)
              .stroke({ color: rimColor, width: 2, alpha: 0.9 });
          }
        } else if (terrain === 'water_shallow') {
          // Subtle wave ripple
          this.tilesGraphics
            .moveTo(px + 6, py + cellSize / 2)
            .lineTo(px + cellSize - 6, py + cellSize / 2)
            .stroke({ color: 0x38bdf8, width: 1.5, alpha: 0.6 });
        } else if (terrain === 'rubble') {
          // Debris markings
          this.tilesGraphics
            .rect(px + 8, py + 8, 6, 6)
            .fill(0x1e293b);
          this.tilesGraphics
            .rect(px + cellSize - 14, py + cellSize - 14, 5, 5)
            .fill(0x1e293b);
        } else if (terrain === 'lava') {
          // Molten core with bright ember veins and a hot rim
          this.tilesGraphics
            .rect(px + 4, py + 4, cellSize - 8, cellSize - 8)
            .fill(0xf97316);
          this.tilesGraphics
            .moveTo(px + 6, py + 8 + (hash % 10))
            .lineTo(px + cellSize - 6, py + cellSize - 8 - (hash % 10))
            .stroke({ color: 0xfde047, width: 1.5, alpha: 0.9 });
          this.tilesGraphics
            .moveTo(px + 8 + ((hash >> 2) % 10), py + 5)
            .lineTo(px + cellSize - 8 - ((hash >> 2) % 10), py + cellSize - 5)
            .stroke({ color: 0xfde047, width: 1, alpha: 0.7 });
        }

        // Difficult terrain diagonal hatching
        if (cell?.difficultTerrain) {
          this.tilesGraphics
            .moveTo(px + 4, py + cellSize - 4)
            .lineTo(px + cellSize - 4, py + 4)
            .stroke({ color: 0xf59e0b, width: 1.5, alpha: 0.5 });
        }
      }
    }
  }

  /**
   * Draws the 5-ft tactical grid lines overlay across the map.
   */
  public drawGridLines(
    width: number,
    height: number,
    cellSize: number,
    showGridLines: boolean,
  ): void {
    this.gridLinesGraphics.clear();
    if (!showGridLines) return;

    const totalW = width * cellSize;
    const totalH = height * cellSize;

    // Vertical lines
    for (let x = 0; x <= width; x++) {
      const px = x * cellSize;
      this.gridLinesGraphics
        .moveTo(px, 0)
        .lineTo(px, totalH)
        .stroke({ color: 0x94a3b8, width: 1, alpha: 0.22 });
    }

    // Horizontal lines
    for (let y = 0; y <= height; y++) {
      const py = y * cellSize;
      this.gridLinesGraphics
        .moveTo(0, py)
        .lineTo(totalW, py)
        .stroke({ color: 0x94a3b8, width: 1, alpha: 0.22 });
    }
  }

  /**
   * Draws coordinate labels on each cell when enabled.
   */
  public drawCoordinates(
    width: number,
    height: number,
    cellSize: number,
    showCoordinates: boolean,
  ): void {
    this.coordsContainer.removeChildren();
    if (!showCoordinates) return;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const text = new Text({
          text: `${x},${y}`,
          style: {
            fontSize: 9,
            fill: 0x94a3b8,
            fontFamily: 'monospace',
          },
        });
        text.position.set(x * cellSize + 3, y * cellSize + 3);
        text.alpha = 0.6;
        this.coordsContainer.addChild(text);
      }
    }
  }

  /**
   * Draws hover and selection highlight frames over the grid.
   */
  public drawHighlights(
    width: number,
    height: number,
    cellSize: number,
    hoveredCell?: Point | null,
    selectedCell?: Point | null,
  ): void {
    this.highlightsGraphics.clear();

    // Hovered cell highlight (cyan glow)
    if (
      hoveredCell &&
      hoveredCell.x >= 0 &&
      hoveredCell.x < width &&
      hoveredCell.y >= 0 &&
      hoveredCell.y < height
    ) {
      const px = hoveredCell.x * cellSize;
      const py = hoveredCell.y * cellSize;

      this.highlightsGraphics
        .rect(px, py, cellSize, cellSize)
        .fill({ color: 0x38bdf8, alpha: 0.22 });

      this.highlightsGraphics
        .rect(px, py, cellSize, cellSize)
        .stroke({ color: 0x38bdf8, width: 2, alpha: 0.85 });
    }

    // Selected cell highlight (golden ring)
    if (
      selectedCell &&
      selectedCell.x >= 0 &&
      selectedCell.x < width &&
      selectedCell.y >= 0 &&
      selectedCell.y < height
    ) {
      const px = selectedCell.x * cellSize;
      const py = selectedCell.y * cellSize;

      this.highlightsGraphics
        .rect(px, py, cellSize, cellSize)
        .fill({ color: 0xfacc15, alpha: 0.25 });

      this.highlightsGraphics
        .rect(px, py, cellSize, cellSize)
        .stroke({ color: 0xfacc15, width: 3, alpha: 0.95 });
    }
  }

  public destroy(): void {
    this.container.destroy({ children: true });
  }
}
