import type { CreatureSize } from '@srd5/data';
import {
  doFootprintsOverlap,
  getCellDistanceCells,
  getCreatureSizeDifference,
  getCreatureSizeRank,
  getFootprintCells,
  isFootprintInBounds,
  isWithinMeleeReach,
} from './footprints.js';
import {
  CELL_SIZE_FEET,
  type DiagonalMetric,
  type GridPoint,
  type MovementMode,
  type TacticalGrid,
  getGridCell,
  isCellDifficultTerrain,
  isCellPassable,
} from './model.js';

/**
 * Standard tactical allegiances on the board.
 */
export type CreatureFaction = 'party' | 'enemy' | 'neutral';

/**
 * Lightweight creature representation on the tactical grid for footprint,
 * occupancy, traversal, and Opportunity Attack reach calculations.
 */
export interface GridCreature {
  id: string;
  x: number;
  y: number;
  size: CreatureSize;
  faction?: CreatureFaction;
  /** Optional explicit hostility override relative to the active mover */
  isHostile?: boolean;
  /** Melee reach in feet for Opportunity Attacks (default 5 ft, or 10 ft with reach weapons) */
  reachFeet?: number;
  /** Whether this creature can currently make an Opportunity Attack (default true for hostiles) */
  canMakeOpportunityAttack?: boolean;
  /** Whether this creature has the Halfling Nimbleness trait (can move through creatures larger than itself) */
  halflingNimbleness?: boolean;
  /** Whether this creature is currently prone (crawling costs +5 extra ft per cell) */
  isProne?: boolean;
  /** Creature's maximum speed in feet (e.g., 30) */
  speedFeet?: number;
}

/**
 * Details of an Opportunity Attack provoked when a step exits a hostile creature's melee reach.
 */
export interface OpportunityAttackTrigger {
  enemyId: string;
  /** Cell anchor the mover occupies right before leaving reach (where the OA is resolved) */
  from: GridPoint;
  /** Cell anchor the mover steps into that exits reach */
  to: GridPoint;
  /** The hostile creature's melee reach in feet */
  enemyReachFeet: number;
}

/**
 * Detailed breakdown for a single cell-to-cell transition along a movement path.
 */
export interface PathStep {
  from: GridPoint;
  to: GridPoint;
  /** Movement cost in feet for this single step */
  stepCostFeet: number;
  /** Cumulative movement cost in feet from the start of the path through this step */
  cumulativeCostFeet: number;
  /** True if entering `to` incurred difficult terrain cost (terrain or another creature's space) */
  difficultTerrain: boolean;
  /** Budget classification for UI path preview ('normal' | 'dash' | 'unreachable') */
  budgetStatus: 'normal' | 'dash' | 'unreachable';
  /** Hostile creature IDs whose melee reach is exited on this step */
  provokedEnemyIds: string[];
  /** Detailed Opportunity Attack triggers for this step */
  opportunityAttacks: OpportunityAttackTrigger[];
}

/**
 * Configuration options for A* pathfinding on the 5-ft tactical grid.
 */
export interface PathfindingOptions {
  grid: TacticalGrid;
  mover: GridCreature;
  goal: GridPoint;
  /** Other creatures on the grid (if `mover` is included in the array, it is ignored by `id`) */
  creatures?: ReadonlyArray<GridCreature>;
  /** Diagonal cost metric: 'standard' (5-5-5, default) or 'alternating' (5-10-5 variant) */
  diagonalMetric?: DiagonalMetric;
  /** Locomotion mode: 'walk' (default), 'fly', or 'swim' */
  movementMode?: MovementMode;
  /** Remaining movement in feet for normal move classification */
  movementRemainingFeet?: number;
  /** Extra movement in feet available if taking the Dash action (defaults to `mover.speedFeet ?? movementRemainingFeet ?? 0`) */
  dashBonusFeet?: number;
  /** Hard cap on total movement cost in feet; paths exceeding this cost are rejected */
  maxCostFeet?: number;
  /** Whether the mover has taken the Disengage action (suppresses Opportunity Attacks) */
  isDisengaged?: boolean;
  /** Whether tie-breaking among equal-cost paths should prefer avoiding Opportunity Attacks (default true) */
  avoidOpportunityAttacks?: boolean;
  /** Whether up to 4 non-hostile Tiny creatures can share a single cell (Spec 3.1, default true) */
  allowTinyCellSharing?: boolean;
  /** If true, blocks diagonal movement around a single wall corner in addition to diagonal wall seams */
  strictCornerCutting?: boolean;
}

/**
 * Result returned by `findPath()`.
 */
export interface PathfindingResult {
  /** True if a valid path from `(mover.x, mover.y)` to `goal` was found */
  found: boolean;
  /** Ordered sequence of anchor coordinates from start (inclusive) to goal (inclusive), or `[]` if not found */
  path: GridPoint[];
  /** Step-by-step breakdown for each transition `path[i] -> path[i + 1]` */
  steps: PathStep[];
  /** Total movement cost in feet for the entire path */
  totalCostFeet: number;
  /** Chronological list of all Opportunity Attacks provoked along the path */
  opportunityAttacks: OpportunityAttackTrigger[];
  /** Reason why pathfinding failed when `found === false` */
  blockedReason?:
    | 'out_of_bounds'
    | 'goal_impassable'
    | 'goal_occupied'
    | 'no_path'
    | 'exceeds_max_cost';
}

/**
 * Summary of a reachable destination cell from `getReachableCells()`.
 */
export interface ReachableCellResult {
  cell: GridPoint;
  totalCostFeet: number;
  path: GridPoint[];
  steps: PathStep[];
  opportunityAttacks: OpportunityAttackTrigger[];
}

/**
 * Determines whether `other` is hostile to `mover`.
 */
export function areCreaturesHostile(mover: GridCreature, other: GridCreature): boolean {
  if (mover.id === other.id) {
    return false;
  }
  if (other.isHostile !== undefined) {
    return other.isHostile;
  }
  if (mover.isHostile !== undefined) {
    return mover.isHostile;
  }
  if (mover.faction && other.faction) {
    if (mover.faction === 'neutral' || other.faction === 'neutral') {
      return false;
    }
    return mover.faction !== other.faction;
  }
  return false;
}

/**
 * Checks whether `mover` is allowed to move THROUGH `other`'s space per SRD 5.1 rules:
 * - Nonhostile creatures: Always allowed (counts as difficult terrain).
 * - Hostile creatures: Allowed ONLY if:
 *   1. `other` is at least 2 size categories larger or smaller than `mover`, OR
 *   2. `mover` has `halflingNimbleness` and `other` is at least 1 size category larger than `mover`.
 */
export function canTraverseCreatureSpace(mover: GridCreature, other: GridCreature): boolean {
  if (mover.id === other.id) {
    return true;
  }
  if (!areCreaturesHostile(mover, other)) {
    return true;
  }
  if (getCreatureSizeDifference(mover.size, other.size) >= 2) {
    return true;
  }
  if (mover.halflingNimbleness && getCreatureSizeRank(other.size) > getCreatureSizeRank(mover.size)) {
    return true;
  }
  return false;
}

/**
 * Checks whether all grid cells covered by a creature footprint at `anchor` are within bounds
 * and have passable terrain for `movementMode`.
 */
export function isFootprintPassableTerrain(
  grid: TacticalGrid,
  anchor: GridPoint,
  size: CreatureSize,
  movementMode: MovementMode = 'walk',
): boolean {
  if (!isFootprintInBounds(grid, anchor, size)) {
    return false;
  }
  const footprintCells = getFootprintCells(anchor, size);
  for (const pt of footprintCells) {
    const cell = getGridCell(grid, pt.x, pt.y);
    if (!cell || !isCellPassable(cell, movementMode)) {
      return false;
    }
  }
  return true;
}

/**
 * Checks whether `mover` can pass through `anchor` (either as an intermediate or final step),
 * checking both terrain passability and creature traversal rules.
 */
export function canTraverseFootprintAt(
  grid: TacticalGrid,
  mover: GridCreature,
  anchor: GridPoint,
  creatures: ReadonlyArray<GridCreature> = [],
  movementMode: MovementMode = 'walk',
): boolean {
  if (!isFootprintPassableTerrain(grid, anchor, mover.size, movementMode)) {
    return false;
  }
  for (const other of creatures) {
    if (other.id === mover.id) continue;
    if (doFootprintsOverlap(anchor, mover.size, other, other.size)) {
      if (!canTraverseCreatureSpace(mover, other)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Checks whether `mover` can legally END its movement at `anchor`.
 * Per SRD 5.1: A creature cannot willingly end its move in another creature's space
 * (whether friend or foe), with the Spec 3.1 exception that up to 4 non-hostile Tiny
 * creatures can share a 1x1 cell when `allowTinyCellSharing` is enabled.
 */
export function canEndMoveAt(
  grid: TacticalGrid,
  mover: GridCreature,
  anchor: GridPoint,
  creatures: ReadonlyArray<GridCreature> = [],
  options?: {
    movementMode?: MovementMode;
    allowTinyCellSharing?: boolean;
  },
): boolean {
  const movementMode = options?.movementMode ?? 'walk';
  const allowTinyCellSharing = options?.allowTinyCellSharing ?? true;

  if (!isFootprintPassableTerrain(grid, anchor, mover.size, movementMode)) {
    return false;
  }

  const overlapping = creatures.filter(
    (other) => other.id !== mover.id && doFootprintsOverlap(anchor, mover.size, other, other.size),
  );

  if (overlapping.length === 0) {
    return true;
  }

  if (
    allowTinyCellSharing &&
    mover.size === 'tiny' &&
    overlapping.length < 4 &&
    overlapping.every((other) => other.size === 'tiny' && !areCreaturesHostile(mover, other))
  ) {
    return true;
  }

  return false;
}

/**
 * Checks whether stepping into `toAnchor` counts as entering difficult terrain for `mover`
 * (either because of cell terrain/hazards or because `toAnchor` overlaps another creature's space).
 */
export function isFootprintStepDifficultTerrain(
  grid: TacticalGrid,
  mover: GridCreature,
  toAnchor: GridPoint,
  creatures: ReadonlyArray<GridCreature> = [],
  movementMode: MovementMode = 'walk',
): boolean {
  const footprintCells = getFootprintCells(toAnchor, mover.size);
  for (const pt of footprintCells) {
    const cell = getGridCell(grid, pt.x, pt.y);
    if (cell && isCellDifficultTerrain(cell, movementMode)) {
      return true;
    }
  }

  for (const other of creatures) {
    if (other.id === mover.id) continue;
    if (doFootprintsOverlap(toAnchor, mover.size, other, other.size)) {
      return true;
    }
  }

  return false;
}

/**
 * Computes the movement cost in feet for a single adjacent step `from -> to`.
 */
export function computeStepCostFeet(params: {
  from: GridPoint;
  to: GridPoint;
  difficultTerrain: boolean;
  isProne?: boolean;
  diagonalMetric?: DiagonalMetric;
  priorDiagonalSteps?: number;
}): { stepCostFeet: number; isDiagonal: boolean } {
  const dx = Math.abs(params.to.x - params.from.x);
  const dy = Math.abs(params.to.y - params.from.y);
  const isDiagonal = dx === 1 && dy === 1;

  let baseCost: number = CELL_SIZE_FEET;
  if (isDiagonal && params.diagonalMetric === 'alternating') {
    const priorDiagonals = params.priorDiagonalSteps ?? 0;
    baseCost = priorDiagonals % 2 === 1 ? CELL_SIZE_FEET * 2 : CELL_SIZE_FEET;
  }

  const difficultPenalty = params.difficultTerrain ? CELL_SIZE_FEET : 0;
  const crawlPenalty = params.isProne ? CELL_SIZE_FEET : 0;

  return {
    stepCostFeet: baseCost + difficultPenalty + crawlPenalty,
    isDiagonal,
  };
}

/**
 * Detects all Opportunity Attacks provoked by a single adjacent step `from -> to`.
 * Per SRD 5.1: Moving out of a hostile creature's melee reach provokes an Opportunity Attack
 * unless the mover has taken the Disengage action. Moving *within* reach does not provoke.
 */
export function detectStepOpportunityAttacks(
  mover: GridCreature,
  from: GridPoint,
  to: GridPoint,
  creatures: ReadonlyArray<GridCreature> = [],
  isDisengaged: boolean = false,
): OpportunityAttackTrigger[] {
  if (isDisengaged || (from.x === to.x && from.y === to.y)) {
    return [];
  }

  const triggers: OpportunityAttackTrigger[] = [];
  for (const other of creatures) {
    if (other.id === mover.id) continue;
    if (!areCreaturesHostile(mover, other)) continue;
    if (other.canMakeOpportunityAttack === false) continue;

    const reachFeet = other.reachFeet ?? CELL_SIZE_FEET;
    const wasInReach = isWithinMeleeReach(other, other.size, from, mover.size, reachFeet);
    const isNowInReach = isWithinMeleeReach(other, other.size, to, mover.size, reachFeet);

    if (wasInReach && !isNowInReach) {
      triggers.push({
        enemyId: other.id,
        from: { x: from.x, y: from.y },
        to: { x: to.x, y: to.y },
        enemyReachFeet: reachFeet,
      });
    }
  }

  return triggers;
}

/**
 * Evaluates a given sequence of grid coordinates (`path`) and produces step-by-step costs,
 * budget classifications, and Opportunity Attack triggers.
 */
export function evaluatePath(
  grid: TacticalGrid,
  mover: GridCreature,
  path: ReadonlyArray<GridPoint>,
  options?: {
    creatures?: ReadonlyArray<GridCreature>;
    diagonalMetric?: DiagonalMetric;
    movementMode?: MovementMode;
    movementRemainingFeet?: number;
    dashBonusFeet?: number;
    isDisengaged?: boolean;
  },
): {
  steps: PathStep[];
  totalCostFeet: number;
  opportunityAttacks: OpportunityAttackTrigger[];
} {
  const creatures = options?.creatures ?? [];
  const diagonalMetric = options?.diagonalMetric ?? 'standard';
  const movementMode = options?.movementMode ?? 'walk';
  const isDisengaged = options?.isDisengaged ?? false;
  const normalBudget = options?.movementRemainingFeet;
  const dashBudget =
    normalBudget !== undefined
      ? normalBudget + (options?.dashBonusFeet ?? mover.speedFeet ?? normalBudget)
      : undefined;

  const steps: PathStep[] = [];
  const allOpportunityAttacks: OpportunityAttackTrigger[] = [];
  let cumulativeCostFeet = 0;
  let diagonalCount = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i]!;
    const to = path[i + 1]!;
    const difficultTerrain = isFootprintStepDifficultTerrain(
      grid,
      mover,
      to,
      creatures,
      movementMode,
    );
    const { stepCostFeet, isDiagonal } = computeStepCostFeet({
      from,
      to,
      difficultTerrain,
      isProne: mover.isProne,
      diagonalMetric,
      priorDiagonalSteps: diagonalCount,
    });
    if (isDiagonal) {
      diagonalCount += 1;
    }

    cumulativeCostFeet += stepCostFeet;

    const opportunityAttacks = detectStepOpportunityAttacks(
      mover,
      from,
      to,
      creatures,
      isDisengaged,
    );
    allOpportunityAttacks.push(...opportunityAttacks);

    let budgetStatus: 'normal' | 'dash' | 'unreachable' = 'normal';
    if (normalBudget !== undefined) {
      if (cumulativeCostFeet <= normalBudget) {
        budgetStatus = 'normal';
      } else if (dashBudget !== undefined && cumulativeCostFeet <= dashBudget) {
        budgetStatus = 'dash';
      } else {
        budgetStatus = 'unreachable';
      }
    }

    steps.push({
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      stepCostFeet,
      cumulativeCostFeet,
      difficultTerrain,
      budgetStatus,
      provokedEnemyIds: opportunityAttacks.map((oa) => oa.enemyId),
      opportunityAttacks,
    });
  }

  return {
    steps,
    totalCostFeet: cumulativeCostFeet,
    opportunityAttacks: allOpportunityAttacks,
  };
}

/**
 * Convenience helper to return only the Opportunity Attack triggers along a path.
 */
export function detectPathOpportunityAttacks(
  mover: GridCreature,
  path: ReadonlyArray<GridPoint>,
  creatures: ReadonlyArray<GridCreature> = [],
  isDisengaged: boolean = false,
): OpportunityAttackTrigger[] {
  const triggers: OpportunityAttackTrigger[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    triggers.push(
      ...detectStepOpportunityAttacks(mover, path[i]!, path[i + 1]!, creatures, isDisengaged),
    );
  }
  return triggers;
}

/**
 * 8-directional neighbor offsets (orthogonal first, then diagonal for natural tie-breaking).
 */
const NEIGHBOR_DIRECTIONS: ReadonlyArray<GridPoint> = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

/**
 * Checks whether a diagonal step `from -> to` is blocked by terrain walls on the orthogonal corners.
 * - By default (`strictCornerCutting = false`), blocks diagonal movement through a closed diagonal wall seam
 *   where BOTH orthogonal neighbors are impassable terrain.
 * - When `strictCornerCutting = true`, blocks diagonal movement if EITHER orthogonal neighbor is impassable terrain.
 */
function isDiagonalBlockedByWallCorner(
  grid: TacticalGrid,
  from: GridPoint,
  to: GridPoint,
  size: CreatureSize,
  movementMode: MovementMode,
  strictCornerCutting: boolean,
): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 || dy === 0) {
    return false;
  }

  const orthoXPassable = isFootprintPassableTerrain(
    grid,
    { x: from.x + dx, y: from.y },
    size,
    movementMode,
  );
  const orthoYPassable = isFootprintPassableTerrain(
    grid,
    { x: from.x, y: from.y + dy },
    size,
    movementMode,
  );

  if (strictCornerCutting) {
    return !orthoXPassable || !orthoYPassable;
  }
  return !orthoXPassable && !orthoYPassable;
}

interface AStarNode {
  key: string;
  x: number;
  y: number;
  diagonalCount: number;
  gFeet: number;
  gTieBreak: number;
  fFeet: number;
  fTieBreak: number;
  parentKey: string | null;
}

/**
 * Finds an optimal path on the 5-ft tactical grid using A* search, respecting:
 * - Creature footprints (`1x1` through `4x4`)
 * - Difficult terrain (+5 ft per cell)
 * - Allied creature space traversal (difficult terrain cost)
 * - Hostile creature space blocking (unless >= 2 size categories different or Halfling Nimbleness)
 * - Blocking ending a move on occupied cells
 * - Prone crawling cost (+5 ft per cell)
 * - Exact Opportunity Attack detection on steps that exit hostile melee reach
 */
export function findPath(options: PathfindingOptions): PathfindingResult {
  const {
    grid,
    mover,
    goal,
    creatures = [],
    diagonalMetric = 'standard',
    movementMode = 'walk',
    movementRemainingFeet,
    dashBonusFeet,
    maxCostFeet,
    isDisengaged = false,
    avoidOpportunityAttacks = true,
    allowTinyCellSharing = true,
    strictCornerCutting = false,
  } = options;

  const start: GridPoint = { x: mover.x, y: mover.y };

  // 1. Validate bounds
  if (
    !isFootprintInBounds(grid, start, mover.size) ||
    !isFootprintInBounds(grid, goal, mover.size)
  ) {
    return {
      found: false,
      path: [],
      steps: [],
      totalCostFeet: 0,
      opportunityAttacks: [],
      blockedReason: 'out_of_bounds',
    };
  }

  // 2. Trivial start === goal check
  if (start.x === goal.x && start.y === goal.y) {
    if (!isFootprintPassableTerrain(grid, goal, mover.size, movementMode)) {
      return {
        found: false,
        path: [],
        steps: [],
        totalCostFeet: 0,
        opportunityAttacks: [],
        blockedReason: 'goal_impassable',
      };
    }
    return {
      found: true,
      path: [{ x: start.x, y: start.y }],
      steps: [],
      totalCostFeet: 0,
      opportunityAttacks: [],
    };
  }

  // 3. Check if goal terrain is passable
  if (!isFootprintPassableTerrain(grid, goal, mover.size, movementMode)) {
    return {
      found: false,
      path: [],
      steps: [],
      totalCostFeet: 0,
      opportunityAttacks: [],
      blockedReason: 'goal_impassable',
    };
  }

  // 4. Check if mover can end movement on goal (cannot end on occupied cell)
  if (!canEndMoveAt(grid, mover, goal, creatures, { movementMode, allowTinyCellSharing })) {
    return {
      found: false,
      path: [],
      steps: [],
      totalCostFeet: 0,
      opportunityAttacks: [],
      blockedReason: 'goal_occupied',
    };
  }

  const minStepCost = mover.isProne ? CELL_SIZE_FEET * 2 : CELL_SIZE_FEET;
  const heuristicFeet = (pt: GridPoint): number =>
    getCellDistanceCells(pt, goal) * minStepCost;

  const makeKey = (x: number, y: number, diagCount: number): string =>
    diagonalMetric === 'alternating' ? `${x},${y},${diagCount % 2}` : `${x},${y}`;

  const startKey = makeKey(start.x, start.y, 0);
  const startH = heuristicFeet(start);
  const startNode: AStarNode = {
    key: startKey,
    x: start.x,
    y: start.y,
    diagonalCount: 0,
    gFeet: 0,
    gTieBreak: 0,
    fFeet: startH,
    fTieBreak: 0,
    parentKey: null,
  };

  const openList: AStarNode[] = [startNode];
  const nodesByKey = new Map<string, AStarNode>([[startKey, startNode]]);
  const closedSet = new Set<string>();
  let minExhaustedGoalCost: number | undefined;

  while (openList.length > 0) {
    // Select node with lowest fFeet, breaking ties by fTieBreak
    let bestIdx = 0;
    for (let i = 1; i < openList.length; i++) {
      const candidate = openList[i]!;
      const currentBest = openList[bestIdx]!;
      if (
        candidate.fFeet < currentBest.fFeet ||
        (candidate.fFeet === currentBest.fFeet && candidate.fTieBreak < currentBest.fTieBreak)
      ) {
        bestIdx = i;
      }
    }

    const current = openList[bestIdx]!;
    openList.splice(bestIdx, 1);

    if (closedSet.has(current.key)) {
      continue;
    }
    closedSet.add(current.key);

    if (current.x === goal.x && current.y === goal.y) {
      if (maxCostFeet !== undefined && current.gFeet > maxCostFeet) {
        minExhaustedGoalCost = current.gFeet;
        continue;
      }

      // Reconstruct path
      const rawPath: GridPoint[] = [];
      let cursor: AStarNode | undefined = current;
      while (cursor !== undefined) {
        rawPath.push({ x: cursor.x, y: cursor.y });
        cursor = cursor.parentKey ? nodesByKey.get(cursor.parentKey) : undefined;
      }
      rawPath.reverse();

      const evaluated = evaluatePath(grid, mover, rawPath, {
        creatures,
        diagonalMetric,
        movementMode,
        movementRemainingFeet,
        dashBonusFeet,
        isDisengaged,
      });

      return {
        found: true,
        path: rawPath,
        steps: evaluated.steps,
        totalCostFeet: evaluated.totalCostFeet,
        opportunityAttacks: evaluated.opportunityAttacks,
      };
    }

    const fromPt: GridPoint = { x: current.x, y: current.y };

    for (const dir of NEIGHBOR_DIRECTIONS) {
      const nextPt: GridPoint = { x: current.x + dir.x, y: current.y + dir.y };

      if (!canTraverseFootprintAt(grid, mover, nextPt, creatures, movementMode)) {
        continue;
      }

      if (
        isDiagonalBlockedByWallCorner(
          grid,
          fromPt,
          nextPt,
          mover.size,
          movementMode,
          strictCornerCutting,
        )
      ) {
        continue;
      }

      const difficultTerrain = isFootprintStepDifficultTerrain(
        grid,
        mover,
        nextPt,
        creatures,
        movementMode,
      );
      const { stepCostFeet, isDiagonal } = computeStepCostFeet({
        from: fromPt,
        to: nextPt,
        difficultTerrain,
        isProne: mover.isProne,
        diagonalMetric,
        priorDiagonalSteps: current.diagonalCount,
      });

      const nextDiagCount = current.diagonalCount + (isDiagonal ? 1 : 0);
      const nextKey = makeKey(nextPt.x, nextPt.y, nextDiagCount);

      if (closedSet.has(nextKey)) {
        continue;
      }

      const tentativeGFeet = current.gFeet + stepCostFeet;

      // Secondary tie-breaker: prefer fewer steps, then orthogonal moves over zig-zags,
      // and prefer avoiding Opportunity Attacks when an equal-cost path exists.
      let stepTiePenalty = 0.005 + (isDiagonal ? 0.001 : 0);
      if (avoidOpportunityAttacks && !isDisengaged) {
        const oaTriggers = detectStepOpportunityAttacks(
          mover,
          fromPt,
          nextPt,
          creatures,
          isDisengaged,
        );
        if (oaTriggers.length > 0) {
          stepTiePenalty += oaTriggers.length * 0.1;
        }
      }

      const tentativeGTieBreak = current.gTieBreak + stepTiePenalty;
      const existing = nodesByKey.get(nextKey);

      const isBetter =
        existing === undefined ||
        tentativeGFeet < existing.gFeet ||
        (tentativeGFeet === existing.gFeet && tentativeGTieBreak < existing.gTieBreak);

      if (isBetter) {
        const hFeet = heuristicFeet(nextPt);
        const nextNode: AStarNode = {
          key: nextKey,
          x: nextPt.x,
          y: nextPt.y,
          diagonalCount: nextDiagCount,
          gFeet: tentativeGFeet,
          gTieBreak: tentativeGTieBreak,
          fFeet: tentativeGFeet + hFeet,
          fTieBreak: tentativeGTieBreak,
          parentKey: current.key,
        };
        nodesByKey.set(nextKey, nextNode);
        openList.push(nextNode);
      }
    }
  }

  return {
    found: false,
    path: [],
    steps: [],
    totalCostFeet: 0,
    opportunityAttacks: [],
    blockedReason: minExhaustedGoalCost !== undefined ? 'exceeds_max_cost' : 'no_path',
  };
}

/**
 * Computes all valid destination cells that `mover` can reach and end its movement on
 * within `maxMovementFeet` using Dijkstra's algorithm.
 */
export function getReachableCells(options: {
  grid: TacticalGrid;
  mover: GridCreature;
  maxMovementFeet: number;
  creatures?: ReadonlyArray<GridCreature>;
  diagonalMetric?: DiagonalMetric;
  movementMode?: MovementMode;
  isDisengaged?: boolean;
  avoidOpportunityAttacks?: boolean;
  allowTinyCellSharing?: boolean;
  strictCornerCutting?: boolean;
}): ReachableCellResult[] {
  const {
    grid,
    mover,
    maxMovementFeet,
    creatures = [],
    diagonalMetric = 'standard',
    movementMode = 'walk',
    isDisengaged = false,
    avoidOpportunityAttacks = true,
    allowTinyCellSharing = true,
    strictCornerCutting = false,
  } = options;

  const start: GridPoint = { x: mover.x, y: mover.y };
  if (!isFootprintInBounds(grid, start, mover.size)) {
    return [];
  }

  const makeKey = (x: number, y: number, diagCount: number): string =>
    diagonalMetric === 'alternating' ? `${x},${y},${diagCount % 2}` : `${x},${y}`;

  const startKey = makeKey(start.x, start.y, 0);
  const startNode: AStarNode = {
    key: startKey,
    x: start.x,
    y: start.y,
    diagonalCount: 0,
    gFeet: 0,
    gTieBreak: 0,
    fFeet: 0,
    fTieBreak: 0,
    parentKey: null,
  };

  const openList: AStarNode[] = [startNode];
  const nodesByKey = new Map<string, AStarNode>([[startKey, startNode]]);
  const closedSet = new Set<string>();
  const bestAtCoord = new Map<string, AStarNode>();

  while (openList.length > 0) {
    let bestIdx = 0;
    for (let i = 1; i < openList.length; i++) {
      const candidate = openList[i]!;
      const currentBest = openList[bestIdx]!;
      if (
        candidate.gFeet < currentBest.gFeet ||
        (candidate.gFeet === currentBest.gFeet && candidate.gTieBreak < currentBest.gTieBreak)
      ) {
        bestIdx = i;
      }
    }

    const current = openList[bestIdx]!;
    openList.splice(bestIdx, 1);

    if (closedSet.has(current.key)) {
      continue;
    }
    closedSet.add(current.key);

    const coordKey = `${current.x},${current.y}`;
    const prevCoordBest = bestAtCoord.get(coordKey);
    if (
      !prevCoordBest ||
      current.gFeet < prevCoordBest.gFeet ||
      (current.gFeet === prevCoordBest.gFeet && current.gTieBreak < prevCoordBest.gTieBreak)
    ) {
      bestAtCoord.set(coordKey, current);
    }

    const fromPt: GridPoint = { x: current.x, y: current.y };

    for (const dir of NEIGHBOR_DIRECTIONS) {
      const nextPt: GridPoint = { x: current.x + dir.x, y: current.y + dir.y };

      if (!canTraverseFootprintAt(grid, mover, nextPt, creatures, movementMode)) {
        continue;
      }

      if (
        isDiagonalBlockedByWallCorner(
          grid,
          fromPt,
          nextPt,
          mover.size,
          movementMode,
          strictCornerCutting,
        )
      ) {
        continue;
      }

      const difficultTerrain = isFootprintStepDifficultTerrain(
        grid,
        mover,
        nextPt,
        creatures,
        movementMode,
      );
      const { stepCostFeet, isDiagonal } = computeStepCostFeet({
        from: fromPt,
        to: nextPt,
        difficultTerrain,
        isProne: mover.isProne,
        diagonalMetric,
        priorDiagonalSteps: current.diagonalCount,
      });

      const tentativeGFeet = current.gFeet + stepCostFeet;
      if (tentativeGFeet > maxMovementFeet) {
        continue;
      }

      const nextDiagCount = current.diagonalCount + (isDiagonal ? 1 : 0);
      const nextKey = makeKey(nextPt.x, nextPt.y, nextDiagCount);

      if (closedSet.has(nextKey)) {
        continue;
      }

      let stepTiePenalty = 0.005 + (isDiagonal ? 0.001 : 0);
      if (avoidOpportunityAttacks && !isDisengaged) {
        const oaTriggers = detectStepOpportunityAttacks(
          mover,
          fromPt,
          nextPt,
          creatures,
          isDisengaged,
        );
        if (oaTriggers.length > 0) {
          stepTiePenalty += oaTriggers.length * 0.1;
        }
      }

      const tentativeGTieBreak = current.gTieBreak + stepTiePenalty;
      const existing = nodesByKey.get(nextKey);

      const isBetter =
        existing === undefined ||
        tentativeGFeet < existing.gFeet ||
        (tentativeGFeet === existing.gFeet && tentativeGTieBreak < existing.gTieBreak);

      if (isBetter) {
        const nextNode: AStarNode = {
          key: nextKey,
          x: nextPt.x,
          y: nextPt.y,
          diagonalCount: nextDiagCount,
          gFeet: tentativeGFeet,
          gTieBreak: tentativeGTieBreak,
          fFeet: tentativeGFeet,
          fTieBreak: tentativeGTieBreak,
          parentKey: current.key,
        };
        nodesByKey.set(nextKey, nextNode);
        openList.push(nextNode);
      }
    }
  }

  const results: ReachableCellResult[] = [];
  for (const node of bestAtCoord.values()) {
    const dest: GridPoint = { x: node.x, y: node.y };
    const isStart = dest.x === start.x && dest.y === start.y;
    if (
      !isStart &&
      !canEndMoveAt(grid, mover, dest, creatures, { movementMode, allowTinyCellSharing })
    ) {
      continue;
    }

    const rawPath: GridPoint[] = [];
    let cursor: AStarNode | undefined = node;
    while (cursor !== undefined) {
      rawPath.push({ x: cursor.x, y: cursor.y });
      cursor = cursor.parentKey ? nodesByKey.get(cursor.parentKey) : undefined;
    }
    rawPath.reverse();

    const evaluated = evaluatePath(grid, mover, rawPath, {
      creatures,
      diagonalMetric,
      movementMode,
      movementRemainingFeet: maxMovementFeet,
      isDisengaged,
    });

    results.push({
      cell: dest,
      totalCostFeet: evaluated.totalCostFeet,
      path: rawPath,
      steps: evaluated.steps,
      opportunityAttacks: evaluated.opportunityAttacks,
    });
  }

  results.sort((a, b) => a.totalCostFeet - b.totalCostFeet || a.cell.y - b.cell.y || a.cell.x - b.cell.x);
  return results;
}
