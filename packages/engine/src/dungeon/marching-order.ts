import {
  type Combatant,
} from '../combat/types.js';
import {
  type GridPoint,
  type TacticalGrid,
  getGridCell,
  isCellPassable,
} from '../grid/model.js';
import {
  type GridCreature,
  findPath,
} from '../grid/pathfinding.js';
import {
  type MarchingFormation,
  type MarchingOrderConfig,
} from './schemas.js';

/**
 * Resulting movement path for a party follower.
 */
export interface FollowerMovement {
  actorId: string;
  from: GridPoint;
  to: GridPoint;
  path: GridPoint[];
}

/**
 * Coordinated party movement plan for Marching Order exploration.
 */
export interface MarchingMovementPlan {
  leadActualPath: GridPoint[];
  followerMovements: FollowerMovement[];
}

/**
 * Searches for the nearest passable, unoccupied cell around a center point using BFS.
 */
export function findNearestPassableCell(
  grid: TacticalGrid,
  target: GridPoint,
  occupied: Set<string>,
  maxRadius = 3,
): GridPoint | null {
  const targetKey = `${target.x},${target.y}`;
  const targetCell = getGridCell(grid, target.x, target.y);
  if (targetCell && isCellPassable(targetCell) && !occupied.has(targetKey)) {
    return target;
  }

  // BFS search queue
  const visited = new Set<string>([targetKey]);
  const queue: Array<{ pt: GridPoint; dist: number }> = [{ pt: target, dist: 0 }];

  // 8 directions (cardinals first, then diagonals)
  const neighbors: GridPoint[] = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 1, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
    { x: -1, y: -1 },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.dist >= maxRadius) continue;

    for (const d of neighbors) {
      const nextX = current.pt.x + d.x;
      const nextY = current.pt.y + d.y;
      const key = `${nextX},${nextY}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const cell = getGridCell(grid, nextX, nextY);
      if (cell && isCellPassable(cell) && !occupied.has(key)) {
        return { x: nextX, y: nextY };
      }

      queue.push({ pt: { x: nextX, y: nextY }, dist: current.dist + 1 });
    }
  }

  return null;
}

/**
 * Computes destination formation slots for followers relative to the leader's final position and movement trail.
 */
export function computeFormationTargetSlots(options: {
  grid: TacticalGrid;
  leadPos: GridPoint;
  direction: GridPoint;
  leadTrail: GridPoint[];
  formation: MarchingFormation;
  followerCount: number;
  initialOccupied?: Set<string>;
}): GridPoint[] {
  const { grid, leadPos, direction, leadTrail, formation, followerCount } = options;
  if (followerCount <= 0) return [];

  const occupied = new Set<string>(options.initialOccupied ?? []);
  occupied.add(`${leadPos.x},${leadPos.y}`);

  let dx = Math.sign(direction.x);
  let dy = Math.sign(direction.y);
  if (dx === 0 && dy === 0) {
    dy = 1; // Default south
  }

  // Behind vector (opposite of movement direction)
  const bx = -dx;
  const by = -dy;

  // Right perpendicular vector (clockwise)
  const rx = -dy;
  const ry = dx;

  const results: GridPoint[] = [];

  if (formation === 'single_file') {
    // Single file: followers follow along the leader's historic trail
    for (let i = 0; i < followerCount; i++) {
      const rank = i + 1; // 1, 2, 3...
      let candidate: GridPoint | undefined;

      // Check if trail has enough history for this rank
      const trailIndex = leadTrail.length - 1 - rank;
      if (trailIndex >= 0 && trailIndex < leadTrail.length) {
        candidate = leadTrail[trailIndex];
      } else {
        // Fallback: step behind the earliest trail point or leadPos
        const anchor = leadTrail[0] ?? leadPos;
        const stepsBehind = rank - Math.max(0, leadTrail.length - 1);
        candidate = {
          x: anchor.x + bx * stepsBehind,
          y: anchor.y + by * stepsBehind,
        };
      }

      const validCell = candidate
        ? findNearestPassableCell(grid, candidate, occupied)
        : null;

      if (validCell) {
        results.push(validCell);
        occupied.add(`${validCell.x},${validCell.y}`);
      } else {
        // Fallback: find any available cell near leader
        const nearLead = findNearestPassableCell(grid, leadPos, occupied, 4);
        if (nearLead) {
          results.push(nearLead);
          occupied.add(`${nearLead.x},${nearLead.y}`);
        } else {
          results.push(leadPos);
        }
      }
    }
  } else {
    // 2x2 Box formation:
    // Slot 0 (Rank 0): Leader at leadPos
    // Slot 1 (Rank 1): Flank at leadPos + right
    // Slot 2 (Rank 2): Rear Left at leadPos + behind
    // Slot 3 (Rank 3): Rear Right at leadPos + behind + right
    const rawOffsets: GridPoint[] = [
      { x: rx, y: ry },
      { x: bx, y: by },
      { x: bx + rx, y: by + ry },
    ];

    for (let i = 0; i < followerCount; i++) {
      const offset = rawOffsets[i] ?? { x: bx * (i + 1), y: by * (i + 1) };
      const candidate: GridPoint = {
        x: leadPos.x + offset.x,
        y: leadPos.y + offset.y,
      };

      const validCell = findNearestPassableCell(grid, candidate, occupied);
      if (validCell) {
        results.push(validCell);
        occupied.add(`${validCell.x},${validCell.y}`);
      } else {
        const nearLead = findNearestPassableCell(grid, leadPos, occupied, 4);
        if (nearLead) {
          results.push(nearLead);
          occupied.add(`${nearLead.x},${nearLead.y}`);
        } else {
          results.push(leadPos);
        }
      }
    }
  }

  return results;
}

/**
 * Calculates marching order movements for followers when the party leader moves along leadPath.
 */
export function calculateMarchingMovements(options: {
  grid: TacticalGrid;
  party: Record<string, Combatant>;
  marchingOrder: MarchingOrderConfig;
  leadStartPos: GridPoint;
  leadActualPath: GridPoint[];
}): MarchingMovementPlan {
  const { grid, party, marchingOrder, leadStartPos, leadActualPath } = options;

  if (leadActualPath.length === 0) {
    return {
      leadActualPath: [],
      followerMovements: [],
    };
  }

  const finalLeadPos = leadActualPath[leadActualPath.length - 1]!;

  // Determine movement direction vector from path
  let dirX = 0;
  let dirY = 0;
  if (leadActualPath.length >= 2) {
    const prev = leadActualPath[leadActualPath.length - 2]!;
    dirX = finalLeadPos.x - prev.x;
    dirY = finalLeadPos.y - prev.y;
  } else {
    dirX = finalLeadPos.x - leadStartPos.x;
    dirY = finalLeadPos.y - leadStartPos.y;
  }

  // Full trail traversed by the leader: [startPos, ...leadActualPath]
  const fullTrail: GridPoint[] = [leadStartPos, ...leadActualPath];

  // Identify followers in marching order
  const followerIds = marchingOrder.order.filter(
    (id) => id !== marchingOrder.leadExplorerId && party[id] && !party[id]?.isDead,
  );

  if (followerIds.length === 0) {
    return {
      leadActualPath,
      followerMovements: [],
    };
  }

  // Compute target slots for each follower
  const targetSlots = computeFormationTargetSlots({
    grid,
    leadPos: finalLeadPos,
    direction: { x: dirX, y: dirY },
    leadTrail: fullTrail,
    formation: marchingOrder.formation,
    followerCount: followerIds.length,
  });

  // Prepare non-hostile ally creatures list for A* pathfinding
  const allyCreatures: GridCreature[] = Object.values(party).map((p) => ({
    id: p.id,
    x: p.position.x,
    y: p.position.y,
    size: p.size,
    faction: 'party',
    isHostile: false,
  }));

  const followerMovements: FollowerMovement[] = [];

  for (let i = 0; i < followerIds.length; i++) {
    const followerId = followerIds[i]!;
    const follower = party[followerId];
    if (!follower) continue;

    const targetSlot = targetSlots[i];
    if (!targetSlot) continue;

    if (follower.position.x === targetSlot.x && follower.position.y === targetSlot.y) {
      // Already at target slot
      continue;
    }

    const pathResult = findPath({
      grid,
      mover: {
        id: follower.id,
        x: follower.position.x,
        y: follower.position.y,
        size: follower.size,
        speedFeet: 120, // Generous budget for exploration marching
      },
      goal: targetSlot,
      creatures: [],
    });

    if (pathResult.found && pathResult.path.length > 0) {
      followerMovements.push({
        actorId: follower.id,
        from: { x: follower.position.x, y: follower.position.y },
        to: targetSlot,
        path: pathResult.path,
      });

      // Update position in allyCreatures for subsequent followers
      const foundCreature = allyCreatures.find((c) => c.id === follower.id);
      if (foundCreature) {
        foundCreature.x = targetSlot.x;
        foundCreature.y = targetSlot.y;
      }
    }
  }

  return {
    leadActualPath,
    followerMovements,
  };
}
