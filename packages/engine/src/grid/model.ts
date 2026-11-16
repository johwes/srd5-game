import { z } from 'zod';

/**
 * Standard SRD 5.1 tactical square size in feet (1 cell = 5 ft x 5 ft).
 */
export const CELL_SIZE_FEET = 5 as const;

/**
 * 2D Cartesian grid coordinate (0-indexed from top-left).
 */
export const GridPointSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
});
export type GridPoint = z.infer<typeof GridPointSchema>;

/**
 * Diagonal movement distance metric:
 * - 'standard': 5 ft per diagonal step (SRD 5.1 default grid rule)
 * - 'alternating': 5-10-5 ft alternating diagonal cost (tactical variant)
 */
export const DIAGONAL_METRICS = ['standard', 'alternating'] as const;
export const DiagonalMetricSchema = z.enum(DIAGONAL_METRICS);
export type DiagonalMetric = z.infer<typeof DiagonalMetricSchema>;

/**
 * Creature movement locomotion modes.
 */
export const MOVEMENT_MODES = ['walk', 'fly', 'swim'] as const;
export const MovementModeSchema = z.enum(MOVEMENT_MODES);
export type MovementMode = z.infer<typeof MovementModeSchema>;

/**
 * Dungeon & tactical map terrain tile types (aligned with 04-dungeon-and-ai.md).
 */
export const TILE_TERRAIN_TYPES = [
  'void',
  'floor_stone',
  'floor_wood',
  'floor_sand', // Walkable desert floor (no cover, no difficult terrain)
  'floor_basalt', // Walkable volcanic rock floor (no cover, no difficult terrain)
  'wall_solid',
  'chasm', // Blocks walking, allows flying & Line of Sight
  'water_shallow', // Difficult terrain
  'water_deep', // Requires swimming (difficult terrain without swim speed)
  'rubble', // Difficult terrain + Half Cover
  'lava', // Hazard damage on enter / start of turn
] as const;
export const TileTerrainTypeSchema = z.enum(TILE_TERRAIN_TYPES);
export type TileTerrainType = z.infer<typeof TileTerrainTypeSchema>;

/**
 * Illumination levels per SRD 5.1 lighting rules.
 */
export const LIGHT_LEVELS = ['bright', 'dim', 'darkness'] as const;
export const LightLevelSchema = z.enum(LIGHT_LEVELS);
export type LightLevel = z.infer<typeof LightLevelSchema>;

/**
 * A single 5-ft square cell on the tactical grid.
 */
export const GridCellSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  roomId: z.string().optional(),
  terrain: TileTerrainTypeSchema,
  baseLight: LightLevelSchema.optional(),
  elevationFeet: z.number().optional(),
  /** Optional explicit difficult terrain flag (e.g., Web, Entangle, Grease hazard zone) */
  difficultTerrain: z.boolean().optional(),
  /** Optional movement blocker from interactive props (e.g., closed/locked door) */
  blocksMovement: z.boolean().optional(),
  /** Optional line-of-sight blocker from interactive props (e.g., closed door, opaque curtain) */
  blocksSight: z.boolean().optional(),
});
export type GridCell = z.infer<typeof GridCellSchema>;

/**
 * Complete 2D tactical grid state.
 */
export const TacticalGridSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  cells: z.array(GridCellSchema),
});
export type TacticalGrid = z.infer<typeof TacticalGridSchema>;

/**
 * Creates a rectangular tactical grid initialized with a default terrain and light level.
 */
export function createTacticalGrid(
  width: number,
  height: number,
  defaultTerrain: TileTerrainType = 'floor_stone',
  defaultLight: LightLevel = 'bright',
): TacticalGrid {
  if (width <= 0 || height <= 0 || !Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error(`Invalid grid dimensions: ${width}x${height}`);
  }
  const cells: GridCell[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      cells.push({
        x,
        y,
        terrain: defaultTerrain,
        baseLight: defaultLight,
        elevationFeet: 0,
      });
    }
  }
  return { width, height, cells };
}

/**
 * Checks whether cell coordinates `(x, y)` lie within `[0, width) x [0, height)`.
 */
export function isWithinGridBounds(
  grid: { width: number; height: number },
  x: number,
  y: number,
): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    x < grid.width &&
    y >= 0 &&
    y < grid.height
  );
}

/**
 * Looks up a cell at `(x, y)` on a `TacticalGrid`.
 * Supports both row-major dense grids (`cells[y * width + x]`) and sparse/reordered cell arrays.
 */
export function getGridCell(grid: TacticalGrid, x: number, y: number): GridCell | undefined {
  if (!isWithinGridBounds(grid, x, y)) {
    return undefined;
  }
  const rowMajorIdx = y * grid.width + x;
  const candidate = grid.cells[rowMajorIdx];
  if (candidate && candidate.x === x && candidate.y === y) {
    return candidate;
  }
  return grid.cells.find((c) => c.x === x && c.y === y);
}

/**
 * Returns a new `TacticalGrid` with the cell at `(update.x, update.y)` merged with `update`.
 */
export function setGridCell(
  grid: TacticalGrid,
  update: Partial<GridCell> & { x: number; y: number },
): TacticalGrid {
  return setGridCells(grid, [update]);
}

/**
 * Returns a new `TacticalGrid` with multiple cell updates applied immutably.
 */
export function setGridCells(
  grid: TacticalGrid,
  updates: ReadonlyArray<Partial<GridCell> & { x: number; y: number }>,
): TacticalGrid {
  const updateMap = new Map<string, Partial<GridCell> & { x: number; y: number }>();
  for (const u of updates) {
    if (!isWithinGridBounds(grid, u.x, u.y)) {
      throw new Error(`Cell update (${u.x}, ${u.y}) is out of grid bounds (${grid.width}x${grid.height})`);
    }
    updateMap.set(`${u.x},${u.y}`, u);
  }

  const nextCells = grid.cells.map((cell) => {
    const u = updateMap.get(`${cell.x},${cell.y}`);
    return u ? { ...cell, ...u } : cell;
  });

  return {
    ...grid,
    cells: nextCells,
  };
}

/**
 * Checks whether a terrain type can be entered using the given movement mode.
 */
export function isTerrainPassable(
  terrain: TileTerrainType,
  movementMode: MovementMode = 'walk',
): boolean {
  switch (terrain) {
    case 'void':
    case 'wall_solid':
      return false;
    case 'chasm':
      return movementMode === 'fly';
    case 'floor_stone':
    case 'floor_wood':
    case 'floor_sand':
    case 'floor_basalt':
    case 'water_shallow':
    case 'water_deep':
    case 'rubble':
    case 'lava':
      return true;
  }
}

/**
 * Checks whether a `GridCell` can be entered (considering both terrain and prop blockers).
 */
export function isCellPassable(cell: GridCell, movementMode: MovementMode = 'walk'): boolean {
  if (cell.blocksMovement) {
    return false;
  }
  return isTerrainPassable(cell.terrain, movementMode);
}

/**
 * Checks whether entering a `GridCell` counts as difficult terrain (+5 ft movement cost)
 * based on terrain type or explicit hazard flags.
 */
export function isCellDifficultTerrain(
  cell: GridCell,
  movementMode: MovementMode = 'walk',
): boolean {
  if (cell.difficultTerrain) {
    return true;
  }
  if (movementMode === 'fly') {
    return false;
  }
  switch (cell.terrain) {
    case 'water_shallow':
    case 'rubble':
      return true;
    case 'water_deep':
      return movementMode !== 'swim';
    default:
      return false;
  }
}

/**
 * Computes the movement cost in feet to stand up from the `prone` condition.
 * Per SRD 5.1 (and Spec 3.2): Standing up costs an amount of movement equal to half
 * of the creature's maximum speed (`floor(speedFeet / 2)`).
 */
export function getStandUpCostFeet(maxSpeedFeet: number): number {
  return Math.max(0, Math.floor(maxSpeedFeet / 2));
}

/**
 * Checks whether a `prone` creature can stand up given its maximum speed and remaining movement.
 * Per SRD 5.1: If remaining movement is less than half speed, or speed is 0, the creature cannot stand up.
 */
export function canStandUpFromProne(
  maxSpeedFeet: number,
  movementRemainingFeet: number,
): boolean {
  if (maxSpeedFeet <= 0) {
    return false;
  }
  const cost = getStandUpCostFeet(maxSpeedFeet);
  return movementRemainingFeet >= cost;
}
