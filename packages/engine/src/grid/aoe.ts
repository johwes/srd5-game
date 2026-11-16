import { z } from 'zod';
import { CELL_SIZE_FEET, type GridPoint } from './model.js';

/**
 * AOE template rasterization (spec 03 §3.4).
 *
 * Geometry is computed in continuous feet. Cell (x, y) has its center at
 * ((x + 0.5) * 5, (y + 0.5) * 5); grid intersection (ix, iy) lies at (ix * 5, iy * 5).
 * A cell is included when its center falls within the template shape.
 */

export const AOE_SHAPES = ['sphere', 'cylinder', 'cube', 'cone', 'line'] as const;
export const AoeShapeSchema = z.enum(AOE_SHAPES);
export type AoeShape = z.infer<typeof AoeShapeSchema>;

export const CARDINAL_FACINGS = ['n', 'e', 's', 'w'] as const;
export type CardinalFacing = (typeof CARDINAL_FACINGS)[number];

/** Continuous point in feet. */
export interface FeetPoint {
  x: number;
  y: number;
}

const EPS = 1e-9;

export function cellCenterFeet(cell: GridPoint): FeetPoint {
  return { x: (cell.x + 0.5) * CELL_SIZE_FEET, y: (cell.y + 0.5) * CELL_SIZE_FEET };
}

export function intersectionFeet(ix: number, iy: number): FeetPoint {
  return { x: ix * CELL_SIZE_FEET, y: iy * CELL_SIZE_FEET };
}

function normalize(v: FeetPoint): FeetPoint {
  const len = Math.hypot(v.x, v.y);
  if (len < EPS) throw new Error('AOE direction vector must be non-zero');
  return { x: v.x / len, y: v.y / len };
}

/** Bounding cell range helper: iterates candidate cells and keeps those satisfying `test`. */
function collect(
  minFeet: FeetPoint,
  maxFeet: FeetPoint,
  test: (center: FeetPoint) => boolean,
): GridPoint[] {
  const out: GridPoint[] = [];
  const x0 = Math.floor(minFeet.x / CELL_SIZE_FEET) - 1;
  const x1 = Math.ceil(maxFeet.x / CELL_SIZE_FEET) + 1;
  const y0 = Math.floor(minFeet.y / CELL_SIZE_FEET) - 1;
  const y1 = Math.ceil(maxFeet.y / CELL_SIZE_FEET) + 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (test(cellCenterFeet({ x, y }))) out.push({ x, y });
    }
  }
  return out;
}

/** Sphere (and cylinder footprint): cells whose center distance from the origin is <= radius. */
export function rasterizeSphere(origin: FeetPoint, radiusFeet: number): GridPoint[] {
  return collect(
    { x: origin.x - radiusFeet, y: origin.y - radiusFeet },
    { x: origin.x + radiusFeet, y: origin.y + radiusFeet },
    (c) => Math.hypot(c.x - origin.x, c.y - origin.y) <= radiusFeet + EPS,
  );
}

/** Cylinder: same footprint as a sphere; `heightFeet` is returned for 3D-aware consumers. */
export function rasterizeCylinder(
  origin: FeetPoint,
  radiusFeet: number,
  heightFeet = 0,
): { cells: GridPoint[]; heightFeet: number } {
  return { cells: rasterizeSphere(origin, radiusFeet), heightFeet };
}

const FACING_VECTORS: Record<CardinalFacing, FeetPoint> = {
  n: { x: 0, y: -1 },
  e: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
};

/**
 * Cube anchored on a grid intersection, extending `sideFeet` forward along a cardinal facing and
 * centered laterally on the anchor (half-open lateral interval so a side of N cells covers N cells).
 */
export function rasterizeCube(
  anchor: FeetPoint,
  sideFeet: number,
  facing: CardinalFacing,
): GridPoint[] {
  const f = FACING_VECTORS[facing];
  const lat = { x: -f.y, y: f.x };
  const half = sideFeet / 2;
  return collect(
    { x: anchor.x - sideFeet, y: anchor.y - sideFeet },
    { x: anchor.x + sideFeet, y: anchor.y + sideFeet },
    (c) => {
      const dx = c.x - anchor.x;
      const dy = c.y - anchor.y;
      const fwd = dx * f.x + dy * f.y;
      const side = dx * lat.x + dy * lat.y;
      return fwd > 0 && fwd < sideFeet && side >= -half - EPS && side < half - EPS;
    },
  );
}

/**
 * Cone: width at distance d from the origin equals d; total length `lengthFeet`.
 * `direction` is any non-zero vector.
 */
export function rasterizeCone(
  origin: FeetPoint,
  direction: FeetPoint,
  lengthFeet: number,
): GridPoint[] {
  const v = normalize(direction);
  return collect(
    { x: origin.x - lengthFeet, y: origin.y - lengthFeet },
    { x: origin.x + lengthFeet, y: origin.y + lengthFeet },
    (c) => {
      const dx = c.x - origin.x;
      const dy = c.y - origin.y;
      const t = dx * v.x + dy * v.y;
      const p = Math.abs(dx * -v.y + dy * v.x);
      return t > 0 && t <= lengthFeet + EPS && p <= t / 2 + EPS;
    },
  );
}

/** Line: ray of `lengthFeet` and `widthFeet` (default 5) from the origin toward `target`. */
export function rasterizeLine(
  origin: FeetPoint,
  target: FeetPoint,
  lengthFeet: number,
  widthFeet = 5,
): GridPoint[] {
  const v = normalize({ x: target.x - origin.x, y: target.y - origin.y });
  const hw = widthFeet / 2;
  return collect(
    { x: origin.x - lengthFeet, y: origin.y - lengthFeet },
    { x: origin.x + lengthFeet, y: origin.y + lengthFeet },
    (c) => {
      const dx = c.x - origin.x;
      const dy = c.y - origin.y;
      const t = dx * v.x + dy * v.y;
      const p = Math.abs(dx * -v.y + dy * v.x);
      return t > 0 && t <= lengthFeet + EPS && p <= hw + EPS;
    },
  );
}

/**
 * Shared point-targeted AOE geometry (preview overlay, spell execution, and
 * hazard zone creation MUST agree exactly, or the board shows the effect
 * somewhere other than where the player aimed).
 *
 * Standard 5e "choose an intersection" behavior: the clicked cell snaps to
 * its nearest grid intersection, and cube facing / cone direction derive
 * from the caster toward the target when not explicitly given.
 */
export interface PointAoeGeometry {
  /** Snapped anchor intersection, in feet. */
  anchor: FeetPoint;
  /** Cube facing derived from caster toward target. */
  facing: CardinalFacing;
  /** Cone/line origin on the caster's footprint boundary toward the target. */
  coneOrigin: FeetPoint;
  /** Normalized cone/line direction toward the target. */
  direction: FeetPoint;
  /** Target cell center, in feet. */
  targetCenter: FeetPoint;
}

export function pointAoeGeometry(
  targetCell: GridPoint,
  casterPos?: GridPoint,
  casterSizeCells = 1,
  defaultFacing: CardinalFacing = 'e',
): PointAoeGeometry {
  const targetCenter = cellCenterFeet(targetCell);
  const anchor = intersectionFeet(
    Math.round(targetCenter.x / CELL_SIZE_FEET),
    Math.round(targetCenter.y / CELL_SIZE_FEET),
  );
  let facing = defaultFacing;
  if (casterPos) {
    const casterCenter = cellCenterFeet(casterPos);
    const dx = targetCenter.x - casterCenter.x;
    const dy = targetCenter.y - casterCenter.y;
    facing = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'e' : 'w') : dy >= 0 ? 's' : 'n';
  }
  const coneOrigin =
    casterPos &&
    Math.hypot(targetCenter.x - cellCenterFeet(casterPos).x, targetCenter.y - cellCenterFeet(casterPos).y) >=
      1e-4
      ? footprintBoundaryOrigin(casterPos, casterSizeCells, targetCenter)
      : targetCenter;
  let direction = {
    x: targetCenter.x - coneOrigin.x,
    y: targetCenter.y - coneOrigin.y,
  };
  if (Math.hypot(direction.x, direction.y) < 1e-4) {
    direction = { x: 1, y: 0 };
  }
  return { anchor, facing, coneOrigin, direction, targetCenter };
}

/**
 * Point on the boundary of a creature footprint (top-left cell + size in cells) where a ray from the
 * footprint center in direction `toward` exits. Used as the origin for cones and lines.
 */
export function footprintBoundaryOrigin(
  topLeft: GridPoint,
  sizeCells: number,
  toward: FeetPoint,
): FeetPoint {
  const half = (sizeCells * CELL_SIZE_FEET) / 2;
  const center = {
    x: topLeft.x * CELL_SIZE_FEET + half,
    y: topLeft.y * CELL_SIZE_FEET + half,
  };
  const v = normalize({ x: toward.x - center.x, y: toward.y - center.y });
  const s = half / Math.max(Math.abs(v.x), Math.abs(v.y));
  return { x: center.x + v.x * s, y: center.y + v.y * s };
}

export type AoeTemplate =
  | { shape: 'sphere'; origin: FeetPoint; radiusFeet: number }
  | { shape: 'cylinder'; origin: FeetPoint; radiusFeet: number; heightFeet?: number }
  | { shape: 'cube'; origin: FeetPoint; sideFeet: number; facing: CardinalFacing }
  | { shape: 'cone'; origin: FeetPoint; direction: FeetPoint; lengthFeet: number }
  | {
      shape: 'line';
      origin: FeetPoint;
      target: FeetPoint;
      lengthFeet: number;
      widthFeet?: number;
    };

/** Rasterize any AOE template to affected grid cells (sorted row-major). */
export function rasterizeAoe(t: AoeTemplate): GridPoint[] {
  switch (t.shape) {
    case 'sphere':
      return rasterizeSphere(t.origin, t.radiusFeet);
    case 'cylinder':
      return rasterizeCylinder(t.origin, t.radiusFeet, t.heightFeet).cells;
    case 'cube':
      return rasterizeCube(t.origin, t.sideFeet, t.facing);
    case 'cone':
      return rasterizeCone(t.origin, t.direction, t.lengthFeet);
    case 'line':
      return rasterizeLine(t.origin, t.target, t.lengthFeet, t.widthFeet);
  }
}
