import type { CreatureSize } from '@srd5/data';
import { CREATURE_FOOTPRINT_CELLS, getCellDistanceFeet, getFootprintDistanceFeet } from './footprints.js';
import {
  CELL_SIZE_FEET,
  type GridCell,
  type GridPoint,
  type LightLevel,
  type TacticalGrid,
  getGridCell,
} from './model.js';

/** SRD 5.1 cover tiers. */
export type CoverLevel = 'none' | 'half' | 'three_quarters' | 'total';

export const COVER_AC_BONUS: Readonly<Record<CoverLevel, number>> = {
  none: 0,
  half: 2,
  three_quarters: 5,
  total: 0, // Total cover cannot be targeted directly; no numeric bonus applies.
};
/** DEX saving throw bonus granted by cover (same values as AC bonus). */
export const COVER_DEX_SAVE_BONUS = COVER_AC_BONUS;

export interface VisionCreature {
  id?: string;
  x: number;
  y: number;
  size: CreatureSize;
}

type Pt = readonly [number, number];
const EPS = 1e-6;

/** Terrain/prop that fully blocks sight (walls, void, closed doors, opaque props). */
export function isCellSightBlocking(cell: GridCell | undefined): boolean {
  if (!cell) return true;
  return cell.blocksSight === true || cell.terrain === 'wall_solid' || cell.terrain === 'void';
}

/** Terrain that grants partial (half) cover without blocking sight entirely. */
export function isCellPartialCover(cell: GridCell | undefined): boolean {
  return !!cell && cell.terrain === 'rubble' && !isCellSightBlocking(cell);
}

/**
 * Does segment a->b pass through the open interior of the unit square for cell (cx, cy)?
 * Grazing along edges/corners does not count. (Liang–Barsky on a slightly shrunk square.)
 */
export function segmentCrossesCell(a: Pt, b: Pt, cx: number, cy: number): boolean {
  const minX = cx + EPS;
  const maxX = cx + 1 - EPS;
  const minY = cy + EPS;
  const maxY = cy + 1 - EPS;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return (
    clip(-dx, a[0] - minX) &&
    clip(dx, maxX - a[0]) &&
    clip(-dy, a[1] - minY) &&
    clip(dy, maxY - a[1]) &&
    t0 <= t1
  );
}

/**
 * Ray blocked by any of `cells`: it crosses an interior, or it runs along an edge shared by
 * obstacles on both sides (detected by nudging the ray to either side). Grazing a single
 * obstacle's edge or corner does not block.
 */
function isRayBlocked(a: Pt, b: Pt, cells: ReadonlyArray<GridPoint>): boolean {
  if (cells.length === 0) return false;
  if (cells.some((c) => segmentCrossesCell(a, b, c.x, c.y))) return true;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return false;
  const nx = (-dy / len) * 1e-4;
  const ny = (dx / len) * 1e-4;
  const side = (sgn: number) =>
    cells.some((c) =>
      segmentCrossesCell([a[0] + sgn * nx, a[1] + sgn * ny], [b[0] + sgn * nx, b[1] + sgn * ny], c.x, c.y),
    );
  return side(1) && side(-1);
}

function bounds(c: VisionCreature) {
  const w = CREATURE_FOOTPRINT_CELLS[c.size];
  return { x0: c.x, y0: c.y, x1: c.x + w, y1: c.y + w };
}

function corners(c: VisionCreature): Pt[] {
  const b = bounds(c);
  return [
    [b.x0, b.y0],
    [b.x1, b.y0],
    [b.x0, b.y1],
    [b.x1, b.y1],
  ];
}

function insideCreature(c: VisionCreature, cx: number, cy: number): boolean {
  const b = bounds(c);
  return cx >= b.x0 && cx < b.x1 && cy >= b.y0 && cy < b.y1;
}

export interface CoverResult {
  cover: CoverLevel;
  /** True if at least one ray is not blocked by sight-blocking terrain. */
  hasLineOfSight: boolean;
  acBonus: number;
  dexSaveBonus: number;
  /** Chosen attacker corner (grid-corner coordinates). */
  originCorner: GridPoint;
  blockedRays: number;
}

/**
 * SRD 5.1 corner-to-corner cover. Picks the attacker corner giving the best (least-covered)
 * result, traces rays to the 4 target corners. Walls/closed doors block fully; rubble and
 * intervening creatures (any allegiance) block as partial cover.
 */
export function computeCover(
  grid: TacticalGrid,
  attacker: VisionCreature,
  target: VisionCreature,
  obstacles: ReadonlyArray<VisionCreature> = [],
): CoverResult {
  const blockers = obstacles.filter(
    (o) =>
      !(o.id !== undefined && (o.id === attacker.id || o.id === target.id)) &&
      !(o.x === attacker.x && o.y === attacker.y && o.size === attacker.size) &&
      !(o.x === target.x && o.y === target.y && o.size === target.size),
  );

  // Candidate cells along the bounding box of both creatures (plus a 1-cell margin for edge-hugging rays).
  const ab = bounds(attacker);
  const tb = bounds(target);
  const minX = Math.min(ab.x0, tb.x0) - 1;
  const maxX = Math.max(ab.x1, tb.x1) + 1;
  const minY = Math.min(ab.y0, tb.y0) - 1;
  const maxY = Math.max(ab.y1, tb.y1) + 1;

  const solidCells: GridPoint[] = [];
  const partialCells: GridPoint[] = [];
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      if (insideCreature(attacker, x, y) || insideCreature(target, x, y)) continue;
      const cell = getGridCell(grid, x, y);
      if (isCellSightBlocking(cell)) solidCells.push({ x, y });
      else if (isCellPartialCover(cell) || blockers.some((o) => insideCreature(o, x, y))) {
        partialCells.push({ x, y });
      }
    }
  }

  const tCorners = corners(target);
  let best: { solid: number; blocked: number; origin: Pt } | undefined;
  for (const origin of corners(attacker)) {
    let solid = 0;
    let blocked = 0;
    for (const tc of tCorners) {
      const isSolid = isRayBlocked(origin, tc, solidCells);
      if (isSolid) {
        solid++;
        blocked++;
      } else if (isRayBlocked(origin, tc, partialCells)) {
        blocked++;
      }
    }
    if (
      !best ||
      solid < best.solid ||
      (solid === best.solid && blocked < best.blocked)
    ) {
      best = { solid, blocked, origin };
    }
  }

  const { solid, blocked, origin } = best!;
  let cover: CoverLevel;
  if (solid === 4) cover = 'total';
  else if (blocked >= 3) cover = 'three_quarters';
  else if (blocked >= 1) cover = 'half';
  else cover = 'none';

  return {
    cover,
    hasLineOfSight: solid < 4,
    acBonus: COVER_AC_BONUS[cover],
    dexSaveBonus: COVER_DEX_SAVE_BONUS[cover],
    originCorner: { x: origin[0], y: origin[1] },
    blockedRays: blocked,
  };
}

/** True if the attacker has any unobstructed line of sight to the target. */
export function hasLineOfSight(
  grid: TacticalGrid,
  from: VisionCreature,
  to: VisionCreature,
): boolean {
  return computeCover(grid, from, to).hasLineOfSight;
}

// ---------------------------------------------------------------------------
// Lighting & vision
// ---------------------------------------------------------------------------

export interface LightSource {
  x: number;
  y: number;
  /** Radius of bright light in feet. */
  brightFeet: number;
  /** Additional radius of dim light beyond bright (feet). */
  dimFeet: number;
}

const LIGHT_RANK: Record<LightLevel, number> = { darkness: 0, dim: 1, bright: 2 };
const RANK_LIGHT: LightLevel[] = ['darkness', 'dim', 'bright'];

/** Illumination of a cell: the brightest of its base light and any light sources reaching it. */
export function getCellLightLevel(
  grid: TacticalGrid,
  at: GridPoint,
  lightSources: ReadonlyArray<LightSource> = [],
): LightLevel {
  let rank = LIGHT_RANK[getGridCell(grid, at.x, at.y)?.baseLight ?? 'bright'];
  for (const s of lightSources) {
    const d = getCellDistanceFeet(s, at);
    if (d <= s.brightFeet) rank = Math.max(rank, 2);
    else if (d <= s.brightFeet + s.dimFeet) rank = Math.max(rank, 1);
  }
  return RANK_LIGHT[rank]!;
}

/**
 * Darkvision: within radius, darkness is treated as dim and dim as bright.
 */
export function applyDarkvision(
  light: LightLevel,
  distanceFeet: number,
  darkvisionFeet: number,
): LightLevel {
  if (darkvisionFeet <= 0 || distanceFeet > darkvisionFeet) return light;
  return RANK_LIGHT[Math.min(2, LIGHT_RANK[light] + 1)]!;
}

export type ObscurementLevel = 'none' | 'lightly' | 'heavily';

export function lightToObscurement(light: LightLevel): ObscurementLevel {
  return light === 'bright' ? 'none' : light === 'dim' ? 'lightly' : 'heavily';
}

export interface SightResult {
  canSee: boolean;
  hasLineOfSight: boolean;
  /** Effective light for the viewer at the target's position (after darkvision). */
  effectiveLight: LightLevel;
  obscurement: ObscurementLevel;
  cover: CoverResult;
}

export interface SightOptions {
  darkvisionFeet?: number;
  lightSources?: ReadonlyArray<LightSource>;
  obstacles?: ReadonlyArray<VisionCreature>;
  /** Extra cells made heavily obscured (opaque fog, Darkness spell). */
  heavilyObscuredCells?: ReadonlyArray<GridPoint>;
  /** Viewer is blinded, so cannot see anything. */
  blinded?: boolean;
}

/**
 * Whether a viewer can see a target: needs line of sight and the target's cell must not be
 * heavily obscured for that viewer (accounting for darkvision).
 */
export function computeSight(
  grid: TacticalGrid,
  viewer: VisionCreature,
  target: VisionCreature,
  opts: SightOptions = {},
): SightResult {
  const cover = computeCover(grid, viewer, target, opts.obstacles);
  const dist = getFootprintDistanceFeet(viewer, viewer.size, target, target.size);
  const targetCells = [] as GridPoint[];
  const w = CREATURE_FOOTPRINT_CELLS[target.size];
  for (let dy = 0; dy < w; dy++) for (let dx = 0; dx < w; dx++) targetCells.push({ x: target.x + dx, y: target.y + dy });

  // Use the best-lit cell of the target's footprint.
  let bestRank = 0;
  for (const c of targetCells) {
    let light = getCellLightLevel(grid, c, opts.lightSources);
    if (opts.heavilyObscuredCells?.some((h) => h.x === c.x && h.y === c.y)) light = 'darkness';
    const eff = opts.heavilyObscuredCells?.some((h) => h.x === c.x && h.y === c.y)
      ? 'darkness'
      : applyDarkvision(light, dist, opts.darkvisionFeet ?? 0);
    bestRank = Math.max(bestRank, LIGHT_RANK[eff]);
  }
  const effectiveLight = RANK_LIGHT[bestRank]!;
  const obscurement = lightToObscurement(effectiveLight);
  return {
    canSee: !opts.blinded && cover.hasLineOfSight && obscurement !== 'heavily',
    hasLineOfSight: cover.hasLineOfSight,
    effectiveLight,
    obscurement,
    cover,
  };
}

export { CELL_SIZE_FEET as VISION_CELL_SIZE_FEET };
