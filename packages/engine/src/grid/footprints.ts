import type { CreatureSize } from '@srd5/data';
import { CELL_SIZE_FEET, type GridPoint, isWithinGridBounds } from './model.js';

/**
 * Numeric rank (0..5) for SRD 5.1 creature sizes, used to compute size category differences.
 */
export const CREATURE_SIZE_RANK: Readonly<Record<CreatureSize, number>> = {
  tiny: 0,
  small: 1,
  medium: 2,
  large: 3,
  huge: 4,
  gargantuan: 5,
};

/**
 * Footprint width/height in 5-ft grid cells for each SRD 5.1 creature size.
 * - tiny, small, medium: 1x1 cell
 * - large: 2x2 cells
 * - huge: 3x3 cells
 * - gargantuan: 4x4 cells
 */
export const CREATURE_FOOTPRINT_CELLS: Readonly<Record<CreatureSize, 1 | 2 | 3 | 4>> = {
  tiny: 1,
  small: 1,
  medium: 1,
  large: 2,
  huge: 3,
  gargantuan: 4,
};

/**
 * Space controlled in feet for each SRD 5.1 creature size (Spec 3.1).
 */
export const CREATURE_SPACE_FEET: Readonly<Record<CreatureSize, number>> = {
  tiny: 2.5,
  small: 5,
  medium: 5,
  large: 10,
  huge: 15,
  gargantuan: 20,
};

/**
 * Returns the side length in grid cells (`1`..`4`) of a creature's square footprint.
 */
export function getCreatureFootprintWidth(size: CreatureSize): 1 | 2 | 3 | 4 {
  return CREATURE_FOOTPRINT_CELLS[size];
}

/**
 * Returns the integer size rank (`0` for `tiny` through `5` for `gargantuan`).
 */
export function getCreatureSizeRank(size: CreatureSize): number {
  return CREATURE_SIZE_RANK[size];
}

/**
 * Returns the absolute number of size categories separating two creature sizes.
 */
export function getCreatureSizeDifference(sizeA: CreatureSize, sizeB: CreatureSize): number {
  return Math.abs(CREATURE_SIZE_RANK[sizeA] - CREATURE_SIZE_RANK[sizeB]);
}

/**
 * Returns the space in feet controlled by a creature of the given size (`2.5`..`20`).
 */
export function getCreatureSpaceFeet(size: CreatureSize): number {
  return CREATURE_SPACE_FEET[size];
}

/**
 * Returns all grid cells occupied by a creature anchored at top-left `anchor` with `size`.
 */
export function getFootprintCells(anchor: GridPoint, size: CreatureSize): GridPoint[] {
  const width = CREATURE_FOOTPRINT_CELLS[size];
  const cells: GridPoint[] = [];
  for (let dy = 0; dy < width; dy++) {
    for (let dx = 0; dx < width; dx++) {
      cells.push({ x: anchor.x + dx, y: anchor.y + dy });
    }
  }
  return cells;
}

/**
 * Checks whether a creature's footprint anchored at `anchor` with `size` contains `cell`.
 */
export function doesFootprintContainCell(
  anchor: GridPoint,
  size: CreatureSize,
  cell: GridPoint,
): boolean {
  const width = CREATURE_FOOTPRINT_CELLS[size];
  return (
    cell.x >= anchor.x &&
    cell.x < anchor.x + width &&
    cell.y >= anchor.y &&
    cell.y < anchor.y + width
  );
}

/**
 * Checks whether two creature footprints overlap on at least one grid cell.
 */
export function doFootprintsOverlap(
  anchorA: GridPoint,
  sizeA: CreatureSize,
  anchorB: GridPoint,
  sizeB: CreatureSize,
): boolean {
  const widthA = CREATURE_FOOTPRINT_CELLS[sizeA];
  const widthB = CREATURE_FOOTPRINT_CELLS[sizeB];
  return (
    anchorA.x < anchorB.x + widthB &&
    anchorA.x + widthA > anchorB.x &&
    anchorA.y < anchorB.y + widthB &&
    anchorA.y + widthA > anchorB.y
  );
}

/**
 * Checks whether all cells of a creature's footprint lie within the grid boundaries.
 */
export function isFootprintInBounds(
  grid: { width: number; height: number },
  anchor: GridPoint,
  size: CreatureSize,
): boolean {
  const width = CREATURE_FOOTPRINT_CELLS[size];
  return (
    isWithinGridBounds(grid, anchor.x, anchor.y) &&
    isWithinGridBounds(grid, anchor.x + width - 1, anchor.y + width - 1)
  );
}

/**
 * Computes the standard 5e Chebyshev grid distance in cells between two single grid cells:
 * `max(|a.x - b.x|, |a.y - b.y|)`.
 */
export function getCellDistanceCells(a: GridPoint, b: GridPoint): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * Computes the standard 5e grid distance in feet between two single grid cells (5 ft per cell).
 */
export function getCellDistanceFeet(a: GridPoint, b: GridPoint): number {
  return getCellDistanceCells(a, b) * CELL_SIZE_FEET;
}

/**
 * Computes the minimum grid distance in cells between two creature footprints (`1x1`..`4x4`).
 * Returns `0` if the footprints overlap, `1` if adjacent (including diagonally), etc.
 */
export function getFootprintDistanceCells(
  anchorA: GridPoint,
  sizeA: CreatureSize,
  anchorB: GridPoint,
  sizeB: CreatureSize,
): number {
  const widthA = CREATURE_FOOTPRINT_CELLS[sizeA];
  const widthB = CREATURE_FOOTPRINT_CELLS[sizeB];

  const minAx = anchorA.x;
  const maxAx = anchorA.x + widthA - 1;
  const minAy = anchorA.y;
  const maxAy = anchorA.y + widthA - 1;

  const minBx = anchorB.x;
  const maxBx = anchorB.x + widthB - 1;
  const minBy = anchorB.y;
  const maxBy = anchorB.y + widthB - 1;

  const dx = minAx > maxBx ? minAx - maxBx : minBx > maxAx ? minBx - maxAx : 0;
  const dy = minAy > maxBy ? minAy - maxBy : minBy > maxAy ? minBy - maxAy : 0;

  return Math.max(dx, dy);
}

/**
 * Computes the minimum grid distance in feet between two creature footprints (`1x1`..`4x4`).
 */
export function getFootprintDistanceFeet(
  anchorA: GridPoint,
  sizeA: CreatureSize,
  anchorB: GridPoint,
  sizeB: CreatureSize,
): number {
  return getFootprintDistanceCells(anchorA, sizeA, anchorB, sizeB) * CELL_SIZE_FEET;
}

/**
 * Checks whether a target creature's footprint is within `reachFeet` (default 5 ft) of an attacker's footprint.
 */
export function isWithinMeleeReach(
  attackerAnchor: GridPoint,
  attackerSize: CreatureSize,
  targetAnchor: GridPoint,
  targetSize: CreatureSize,
  reachFeet: number = CELL_SIZE_FEET,
): boolean {
  return (
    getFootprintDistanceFeet(attackerAnchor, attackerSize, targetAnchor, targetSize) <= reachFeet
  );
}
