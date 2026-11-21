import type { AiArchetype } from '@srd5/data';
import type { GridPoint, TacticalGrid } from '../grid/model.js';
import { getFootprintDistanceFeet, isWithinMeleeReach } from '../grid/footprints.js';
import { computeCover, hasLineOfSight } from '../grid/vision.js';
import { rasterizeSphere, rasterizeCone, rasterizeLine } from '../grid/aoe.js';
import { findPath, canEndMoveAt, isFootprintStepDifficultTerrain, computeStepCostFeet, type GridCreature, type PathfindingResult } from '../grid/pathfinding.js';
import { isCellInHazardDifficultTerrain } from '../combat/hazard-zone.js';
import type { Combatant, CombatState, HazardZone } from '../combat/types.js';
import { areAllied, areHostile, type DispositionMatrix } from '../combat/allegiance.js';
import { isIncapacitated } from '../combat/conditions.js';
import type { GameCommand, GameEvent, GameState } from '../state/types.js';
import { reduceGame } from '../state/reducer.js';
import type { AiPlan, PlanAiTurnOptions } from './types.js';
import { planClassKitTurn } from './class-kits.js';
import {
  estimateAverageDamage,
  estimateHitProbability,
  evaluateTargetPriority,
  getDamageMultiplier,
  scoreCandidatePosition,
} from './scoring.js';

export function getAdjacentCells(pt: GridPoint): GridPoint[] {
  return [
    { x: pt.x + 1, y: pt.y },
    { x: pt.x - 1, y: pt.y },
    { x: pt.x, y: pt.y + 1 },
    { x: pt.x, y: pt.y - 1 },
    { x: pt.x + 1, y: pt.y + 1 },
    { x: pt.x - 1, y: pt.y - 1 },
    { x: pt.x + 1, y: pt.y - 1 },
    { x: pt.x - 1, y: pt.y + 1 },
  ];
}

/**
 * Truncates an A* path so its cumulative movement cost does not exceed budgetFeet.
 * Also steps backward along the path if the end position cannot be legally occupied.
 */
export function truncatePathToBudget(
  grid: TacticalGrid,
  mover: GridCreature,
  pathResult: PathfindingResult,
  budgetFeet: number,
  creatures: ReadonlyArray<GridCreature> = [],
): { path: GridPoint[]; costFeet: number } | null {
  if (!pathResult.found || pathResult.path.length <= 1 || budgetFeet <= 0) {
    return null;
  }

  // If already within budget and end cell can be occupied
  if (pathResult.totalCostFeet <= budgetFeet) {
    const endPt = pathResult.path[pathResult.path.length - 1]!;
    if (
      canEndMoveAt(grid, mover, endPt, creatures, {
        movementMode: 'walk',
        allowTinyCellSharing: true,
      })
    ) {
      return { path: pathResult.path, costFeet: pathResult.totalCostFeet };
    }
  }

  let cost = 0;
  let validIndex = 0;

  for (let i = 0; i < pathResult.steps.length; i++) {
    const step = pathResult.steps[i]!;
    if (cost + step.stepCostFeet > budgetFeet) {
      break;
    }
    cost += step.stepCostFeet;
    validIndex = i + 1;
  }

  // Step backwards if the end cell cannot be legally occupied
  while (validIndex > 0) {
    const endPt = pathResult.path[validIndex]!;
    if (
      canEndMoveAt(grid, mover, endPt, creatures, {
        movementMode: 'walk',
        allowTinyCellSharing: true,
      })
    ) {
      break;
    }
    validIndex--;
  }

  if (validIndex === 0) {
    return null;
  }

  const finalPath = pathResult.path.slice(0, validIndex + 1);
  const actualCost = pathResult.steps
    .slice(0, validIndex)
    .reduce((sum, s) => sum + s.stepCostFeet, 0);
  return { path: finalPath, costFeet: actualCost };
}

/**
 * Hazard/prone-aware truncation that mirrors `executeMoveCombatant` cost
 * semantics exactly (grid difficult + creature overlap + hazard-zone
 * difficult + prone crawl). `truncatePathToBudget` trusts the A* step costs,
 * which ignore hazard zones and prone — a 6-step path with one hazard cell
 * plans as 30 ft but executes as 35 ft and throws
 * "Not enough movement remaining". AI planning must use this variant so
 * generated COMBAT_MOVE paths never exceed the turn budget at execution.
 */
export function truncatePathToExecutionBudget(
  grid: TacticalGrid,
  mover: GridCreature,
  pathResult: PathfindingResult,
  budgetFeet: number,
  creatures: ReadonlyArray<GridCreature> = [],
  hazardZones?: Record<string, HazardZone> | undefined,
  isProne = false,
): { path: GridPoint[]; costFeet: number } | null {
  if (!pathResult.found || pathResult.path.length <= 1 || budgetFeet <= 0) {
    return null;
  }

  // Recompute execution-equivalent costs step by step (start-inclusive skip).
  const execCosts: number[] = [];
  let currentPos = pathResult.path[0]!;
  let total = 0;
  for (let i = 1; i < pathResult.path.length; i++) {
    const step = pathResult.path[i]!;
    if (step.x === currentPos.x && step.y === currentPos.y) {
      execCosts.push(0);
      continue;
    }
    const moverAtCurrent: GridCreature = {
      id: mover.id,
      x: currentPos.x,
      y: currentPos.y,
      size: mover.size,
      isProne: isProne || mover.isProne,
    };
    const difficult =
      isFootprintStepDifficultTerrain(grid, moverAtCurrent, step, creatures) ||
      isCellInHazardDifficultTerrain(hazardZones, step);
    const { stepCostFeet } = computeStepCostFeet({
      from: currentPos,
      to: step,
      difficultTerrain: difficult,
      isProne: isProne || mover.isProne,
    });
    execCosts.push(stepCostFeet);
    total += stepCostFeet;
    currentPos = step;
  }

  // Fast path: whole path fits and end cell is occupiable.
  if (total <= budgetFeet) {
    const endPt = pathResult.path[pathResult.path.length - 1]!;
    if (
      canEndMoveAt(grid, mover, endPt, creatures, {
        movementMode: 'walk',
        allowTinyCellSharing: true,
      })
    ) {
      return { path: pathResult.path, costFeet: total };
    }
  }

  // Walk forward until budget exhausted (execution semantics).
  let cost = 0;
  let validIndex = 0;
  currentPos = pathResult.path[0]!;
  for (let i = 1; i < pathResult.path.length; i++) {
    const stepCost = execCosts[i - 1]!;
    const step = pathResult.path[i]!;
    // Zero-cost no-op (duplicate start) never consumes budget.
    if (step.x === currentPos.x && step.y === currentPos.y) {
      validIndex = i;
      continue;
    }
    if (cost + stepCost > budgetFeet) {
      break;
    }
    cost += stepCost;
    validIndex = i;
    currentPos = step;
  }

  // Step backwards if the end cell cannot be legally occupied.
  // Recompute cost from the surviving prefix so backing off occupiable
  // cells also refunds their execution cost.
  while (validIndex > 0) {
    const endPt = pathResult.path[validIndex]!;
    if (
      canEndMoveAt(grid, mover, endPt, creatures, {
        movementMode: 'walk',
        allowTinyCellSharing: true,
      })
    ) {
      break;
    }
    const steppedCost = execCosts[validIndex - 1] ?? 0;
    cost = Math.max(0, cost - steppedCost);
    validIndex--;
  }

  if (validIndex === 0) {
    return null;
  }

  return { path: pathResult.path.slice(0, validIndex + 1), costFeet: cost };
}

function getMonsterActionReachFeet(action: { description?: string }): number {
  if (action.description) {
    const reachMatch = action.description.match(/reach\s+(\d+)\s*ft/i);
    if (reachMatch && reachMatch[1]) {
      return parseInt(reachMatch[1], 10);
    }
  }
  return 5;
}

function getMonsterActionMaxRangeFeet(action: {
  description?: string;
  targeting?: unknown;
}): number {
  const targeting = action.targeting as { range?: { distanceFeet?: number } } | undefined;
  if (targeting?.range?.distanceFeet) {
    return targeting.range.distanceFeet;
  }
  if (action.description) {
    const rangeMatch = action.description.match(/range\s+(\d+)\/(\d+)\s*ft/i);
    if (rangeMatch && rangeMatch[2]) {
      return parseInt(rangeMatch[2], 10);
    }
  }
  return 120;
}

/**
 * Plans a tactical monster turn deterministically based on archetype, utility scoring,
 * and dynamic team/faction hostility (Spec 04 Section 5 / Spec 06 Section 2.3).
 */
export function planAiTurn(options: PlanAiTurnOptions): AiPlan {
  const { state, activeCombatantId, grid, dispositionMatrix, archetypeOverride } = options;
  const actor = state.combatants[activeCombatantId];

  if (!actor || actor.isDead || actor.currentHp <= 0 || isIncapacitated(actor)) {
    return {
      actorId: activeCombatantId,
      archetype: archetypeOverride ?? 'brute',
      commands: [{ type: 'END_TURN', actorId: activeCombatantId }],
      reasoning: 'Actor is dead, at 0 HP, or incapacitated.',
    };
  }

  const archetype: AiArchetype =
    archetypeOverride ?? actor.monsterData?.aiArchetype ?? 'brute';

  // 1. Filter conscious Hostiles and Allies using dynamic allegiance evaluation
  const allHostiles = Object.values(state.combatants).filter(
    (c) => areHostile(actor, c, dispositionMatrix) && !c.isDead && c.currentHp > 0,
  );
  const allAllies = Object.values(state.combatants).filter(
    (c) => areAllied(actor, c, dispositionMatrix) && !c.isDead && c.currentHp > 0,
  );

  if (allHostiles.length === 0) {
    return {
      actorId: activeCombatantId,
      archetype,
      commands: [{ type: 'END_TURN', actorId: activeCombatantId }],
      reasoning: 'No conscious hostile targets remaining.',
    };
  }

  // 2. Creature Grid mapping for A* pathfinding
  const gridCreatures: GridCreature[] = Object.values(state.combatants)
    .filter((c) => !c.isDead && c.currentHp > 0)
    .map((c) => ({
      id: c.id,
      x: c.position.x,
      y: c.position.y,
      size: c.size,
      isHostile: areHostile(actor, c, dispositionMatrix),
      reachFeet: 5,
      canMakeOpportunityAttack: !isIncapacitated(c),
    }));

  const availableMovement = state.turnBudget
    ? state.turnBudget.movementRemainingFeet
    : (actor.speedFeet ?? 30);
  let remainingMovement = availableMovement;
  let currentActorPos: GridPoint = { x: actor.position.x, y: actor.position.y };
  // Execution-parity costs: prone crawl and hazard-zone difficult terrain.
  const aiIsProne = actor.conditions.includes('prone');
  const aiHazardZones = state.hazardZones;

  const hasNimbleEscape = Boolean(
    actor.monsterData?.traits?.some(
      (t) => t.id === 'nimble-escape' || t.name.toLowerCase().includes('nimble escape'),
    ) ||
      actor.characterSheet?.featureIds?.includes('cunning-action') ||
      actor.characterSheet?.traitIds?.includes('nimble-escape'),
  );
  const hasPackTactics = Boolean(
    actor.monsterData?.traits?.some(
      (t) => t.id === 'pack-tactics' || t.name.toLowerCase().includes('pack tactics'),
    ) ||
      actor.characterSheet?.featureIds?.includes('pack-tactics') ||
      actor.characterSheet?.traitIds?.includes('pack-tactics'),
  );

  // SRD-1102 — Class-kit tactical AI (Spec 10 §4.1): war-squad classed NPCs
  // (fighter/wizard/cleric/rogue) use real 5e features & spells. An explicit
  // archetypeOverride still wins so scripted encounters can force a role.
  if (!archetypeOverride && actor.characterSheet) {
    const kitPlan = planClassKitTurn({
      actor,
      state,
      grid,
      hostiles: allHostiles,
      allies: allAllies,
      gridCreatures,
      remainingMovement,
      dispositionMatrix,
    });
    if (kitPlan) return kitPlan;
  }

  // =========================================================================
  // ARCHETYPE: ARTILLERY / AOE CASTER
  // =========================================================================
  if (archetype === 'artillery') {
    // Check for AoE Spells / Actions (Fireball, Burning Hands, Breath Weapon)
    const aoePlan = planAoeAttack({
      actor,
      state,
      grid,
      hostiles: allHostiles,
      allies: allAllies,
      dispositionMatrix,
    });
    if (aoePlan) {
      return aoePlan;
    }

    // Check if starting turn engaged in melee (threatened by hostile)
    const adjacentHostile = allHostiles.find(
      (h) => getFootprintDistanceFeet(currentActorPos, actor.size, h.position, h.size) <= 5,
    );

    // If threatened in melee and has Nimble Escape / Disengage, disengage and retreat to standoff cover
    if (adjacentHostile && hasNimbleEscape) {
      // Find best retreat cell 20–40 ft away with cover
      const retreatGoal = findBestRangedPosition({
        actor,
        target: adjacentHostile,
        grid,
        gridCreatures,
        maxFeet: remainingMovement,
        archetype: 'artillery',
        allCombatants: state.combatants,
        dispositionMatrix,
      });

      const rangedAction = findBestRangedAction(actor);
      const commands: GameCommand[] = [
        { type: 'USE_STANDARD_ACTION', actorId: actor.id, action: 'disengage', asBonusAction: true },
      ];

      if (retreatGoal && (retreatGoal.x !== currentActorPos.x || retreatGoal.y !== currentActorPos.y)) {
        const pathRes = findPath({
          grid,
          mover: { id: actor.id, x: currentActorPos.x, y: currentActorPos.y, size: actor.size, isProne: aiIsProne },
          goal: retreatGoal,
          creatures: gridCreatures,
        });
        const truncated = truncatePathToExecutionBudget(
          grid,
          { id: actor.id, x: currentActorPos.x, y: currentActorPos.y, size: actor.size, isProne: aiIsProne },
          pathRes,
          remainingMovement,
          gridCreatures,
          aiHazardZones,
          aiIsProne,
        );
        if (truncated && truncated.path.length > 1) {
          commands.push({ type: 'COMBAT_MOVE', actorId: actor.id, path: truncated.path });
          currentActorPos = truncated.path[truncated.path.length - 1]!;
          remainingMovement = Math.max(0, remainingMovement - truncated.costFeet);
        }
      }

      if (rangedAction) {
        const dist = getFootprintDistanceFeet(currentActorPos, actor.size, adjacentHostile.position, adjacentHostile.size);
        const maxRange = getMonsterActionMaxRangeFeet(rangedAction);
        if (dist <= maxRange) {
          commands.push({
            type: 'DECLARE_ATTACK',
            actorId: actor.id,
            targetId: adjacentHostile.id,
            monsterActionId: rangedAction.id,
          });
        }
      }

      commands.push({ type: 'END_TURN', actorId: actor.id });
      return {
        actorId: actor.id,
        archetype,
        commands,
        reasoning: 'Artillery used Nimble Escape bonus action disengage to escape melee and shoot from standoff range.',
      };
    }

    // Normal artillery behavior: seek cover and attack from standoff range (avoiding melee)
    const bestTarget = selectBestTarget(actor, allHostiles);
    const coverPos = findBestRangedPosition({
      actor,
      target: bestTarget,
      grid,
      gridCreatures,
      maxFeet: remainingMovement,
      archetype: 'artillery',
      allCombatants: state.combatants,
      dispositionMatrix,
    });

    const commands: GameCommand[] = [];
    if (coverPos && (coverPos.x !== currentActorPos.x || coverPos.y !== currentActorPos.y)) {
      const pathRes = findPath({
        grid,
        mover: { id: actor.id, x: currentActorPos.x, y: currentActorPos.y, size: actor.size, isProne: aiIsProne },
        goal: coverPos,
        creatures: gridCreatures,
      });
      const truncated = truncatePathToExecutionBudget(
        grid,
        { id: actor.id, x: currentActorPos.x, y: currentActorPos.y, size: actor.size, isProne: aiIsProne },
        pathRes,
        remainingMovement,
        gridCreatures,
        aiHazardZones,
        aiIsProne,
      );
      if (truncated && truncated.path.length > 1) {
        commands.push({ type: 'COMBAT_MOVE', actorId: actor.id, path: truncated.path });
        currentActorPos = truncated.path[truncated.path.length - 1]!;
        remainingMovement = Math.max(0, remainingMovement - truncated.costFeet);
      }
    }

    const chosenAction = findBestRangedAction(actor) ?? findBestMeleeAction(actor);
    if (chosenAction) {
      const dist = getFootprintDistanceFeet(currentActorPos, actor.size, bestTarget.position, bestTarget.size);
      const isMelee = chosenAction.effects.some((e) => e.step === 'attack_roll' && e.attackType === 'melee_weapon');
      const reachOrRange = isMelee
        ? getMonsterActionReachFeet(chosenAction)
        : getMonsterActionMaxRangeFeet(chosenAction);
      if (dist <= reachOrRange) {
        commands.push({
          type: 'DECLARE_ATTACK',
          actorId: actor.id,
          targetId: bestTarget.id,
          monsterActionId: chosenAction.id,
        });
      }
    }

    commands.push({ type: 'END_TURN', actorId: actor.id });
    return {
      actorId: actor.id,
      archetype,
      commands,
      reasoning: 'Artillery moved into cover and fired ranged attack at target.',
    };
  }

  // =========================================================================
  // ARCHETYPE: SKIRMISHER (Wolves with Pack Tactics / Goblins with Nimble Escape)
  // =========================================================================
  if (archetype === 'skirmisher') {
    // 1. Pack Tactics prioritization (e.g. Wolf)
    if (hasPackTactics) {
      // Find a hostile that already has an ally within 5 ft
      const packTacticsTarget = allHostiles.find((h) =>
        allAllies.some(
          (a) =>
            a.id !== actor.id &&
            !isIncapacitated(a) &&
            getFootprintDistanceFeet(a.position, a.size, h.position, h.size) <= 5,
        ),
      );

      const target = packTacticsTarget ?? selectBestTarget(actor, allHostiles);
      const attackAction = findBestMeleeAction(actor) ?? actor.monsterData?.actions[0];

      // Find an adjacent cell to target
      const adjCells = getAdjacentCells(target.position).filter((cell) =>
        grid.cells.some((c) => c.x === cell.x && c.y === cell.y && c.terrain !== 'wall_solid'),
      );

      // Find shortest path to an adjacent cell
      let bestPathRes: PathfindingResult | null = null;
      let minCost = Infinity;

      for (const adj of adjCells) {
        if (adj.x === currentActorPos.x && adj.y === currentActorPos.y) {
          bestPathRes = null;
          minCost = 0;
          break;
        }
        const pRes = findPath({
          grid,
          mover: { id: actor.id, x: currentActorPos.x, y: currentActorPos.y, size: actor.size, isProne: aiIsProne },
          goal: adj,
          creatures: gridCreatures,
        });
        if (pRes.found && pRes.path.length > 1 && pRes.totalCostFeet < minCost) {
          minCost = pRes.totalCostFeet;
          bestPathRes = pRes;
        }
      }

      const commands: GameCommand[] = [];
      if (bestPathRes) {
        const truncated = truncatePathToExecutionBudget(
          grid,
          { id: actor.id, x: currentActorPos.x, y: currentActorPos.y, size: actor.size, isProne: aiIsProne },
          bestPathRes,
          remainingMovement,
          gridCreatures,
          aiHazardZones,
          aiIsProne,
        );
        if (truncated && truncated.path.length > 1) {
          commands.push({ type: 'COMBAT_MOVE', actorId: actor.id, path: truncated.path });
          currentActorPos = truncated.path[truncated.path.length - 1]!;
          remainingMovement = Math.max(0, remainingMovement - truncated.costFeet);
        }
      }

      if (attackAction) {
        const dist = getFootprintDistanceFeet(currentActorPos, actor.size, target.position, target.size);
        const reach = getMonsterActionReachFeet(attackAction);
        if (dist <= reach) {
          commands.push({
            type: 'DECLARE_ATTACK',
            actorId: actor.id,
            targetId: target.id,
            monsterActionId: attackAction.id,
          });
        }
      }

      commands.push({ type: 'END_TURN', actorId: actor.id });
      return {
        actorId: actor.id,
        archetype,
        commands,
        reasoning: packTacticsTarget
          ? `Wolf positioned adjacent to ally for Pack Tactics advantage against ${target.name}.`
          : `Wolf closed distance and attacked ${target.name}.`,
      };
    }

    // 2. Nimble Escape hit-and-run (e.g. Goblin)
    if (hasNimbleEscape) {
      const target = selectBestTarget(actor, allHostiles);
      const isAlreadyInMelee =
        getFootprintDistanceFeet(currentActorPos, actor.size, target.position, target.size) <= 5;
      const meleeAction = findBestMeleeAction(actor);
      const rangedAction = findBestRangedAction(actor);

      // If Goblin has ranged weapon and is not in melee, shoot from range and move to cover
      if (rangedAction && !isAlreadyInMelee) {
        const coverPos = findBestRangedPosition({
          actor,
          target,
          grid,
          gridCreatures,
          maxFeet: remainingMovement,
          archetype: 'skirmisher',
          allCombatants: state.combatants,
          dispositionMatrix,
        });

        const commands: GameCommand[] = [];
        if (coverPos && (coverPos.x !== currentActorPos.x || coverPos.y !== currentActorPos.y)) {
          const pathRes = findPath({
            grid,
            mover: { id: actor.id, x: currentActorPos.x, y: currentActorPos.y, size: actor.size, isProne: aiIsProne },
            goal: coverPos,
            creatures: gridCreatures,
          });
          const truncated = truncatePathToExecutionBudget(
            grid,
            { id: actor.id, x: currentActorPos.x, y: currentActorPos.y, size: actor.size, isProne: aiIsProne },
            pathRes,
            remainingMovement,
            gridCreatures,
            aiHazardZones,
            aiIsProne,
          );
          if (truncated && truncated.path.length > 1) {
            commands.push({ type: 'COMBAT_MOVE', actorId: actor.id, path: truncated.path });
            currentActorPos = truncated.path[truncated.path.length - 1]!;
            remainingMovement = Math.max(0, remainingMovement - truncated.costFeet);
          }
        }
        const dist = getFootprintDistanceFeet(currentActorPos, actor.size, target.position, target.size);
        const maxRange = getMonsterActionMaxRangeFeet(rangedAction);
        if (dist <= maxRange) {
          commands.push({
            type: 'DECLARE_ATTACK',
            actorId: actor.id,
            targetId: target.id,
            monsterActionId: rangedAction.id,
          });
        }
        commands.push({ type: 'END_TURN', actorId: actor.id });
        return {
          actorId: actor.id,
          archetype,
          commands,
          reasoning: 'Goblin skirmisher attacked from range and used cover.',
        };
      }

      // If in melee or closing into melee: Hit and Run!
      // Step 1: Move into melee if not already
      const commands: GameCommand[] = [];
      if (!isAlreadyInMelee) {
        const adjCells = getAdjacentCells(target.position);
        let bestPathRes: PathfindingResult | null = null;
        for (const adj of adjCells) {
          const pRes = findPath({
            grid,
            mover: { id: actor.id, x: currentActorPos.x, y: currentActorPos.y, size: actor.size, isProne: aiIsProne },
            goal: adj,
            creatures: gridCreatures,
          });
          if (pRes.found && pRes.path.length > 1 && (!bestPathRes || pRes.totalCostFeet < bestPathRes.totalCostFeet)) {
            bestPathRes = pRes;
          }
        }
        if (bestPathRes) {
          const truncated = truncatePathToExecutionBudget(
            grid,
            { id: actor.id, x: currentActorPos.x, y: currentActorPos.y, size: actor.size, isProne: aiIsProne },
            bestPathRes,
            remainingMovement,
            gridCreatures,
            aiHazardZones,
            aiIsProne,
          );
          if (truncated && truncated.path.length > 1) {
            commands.push({ type: 'COMBAT_MOVE', actorId: actor.id, path: truncated.path });
            currentActorPos = truncated.path[truncated.path.length - 1]!;
            remainingMovement = Math.max(0, remainingMovement - truncated.costFeet);
          }
        }
      }

      // Step 2: Melee Attack (only if in reach!)
      const actionToUse = meleeAction ?? actor.monsterData?.actions[0];
      if (actionToUse) {
        const dist = getFootprintDistanceFeet(currentActorPos, actor.size, target.position, target.size);
        const reach = getMonsterActionReachFeet(actionToUse);
        if (dist <= reach) {
          commands.push({
            type: 'DECLARE_ATTACK',
            actorId: actor.id,
            targetId: target.id,
            monsterActionId: actionToUse.id,
          });
        }
      }

      // Step 3: Nimble Escape Disengage as Bonus Action!
      commands.push({
        type: 'USE_STANDARD_ACTION',
        actorId: actor.id,
        action: 'disengage',
        asBonusAction: true,
      });

      // Step 4: Move away from enemy melee reach to a safe retreat cell
      if (remainingMovement > 0) {
        const retreatGoal = findRetreatPosition({
          actor: { ...actor, position: currentActorPos },
          threat: target,
          grid,
          gridCreatures,
          maxFeet: remainingMovement,
        });

        if (retreatGoal && (retreatGoal.x !== currentActorPos.x || retreatGoal.y !== currentActorPos.y)) {
          const pathRes = findPath({
            grid,
            mover: { id: actor.id, x: currentActorPos.x, y: currentActorPos.y, size: actor.size, isProne: aiIsProne },
            goal: retreatGoal,
            creatures: gridCreatures,
          });
          const truncated = truncatePathToExecutionBudget(
            grid,
            { id: actor.id, x: currentActorPos.x, y: currentActorPos.y, size: actor.size, isProne: aiIsProne },
            pathRes,
            remainingMovement,
            gridCreatures,
            aiHazardZones,
            aiIsProne,
          );
          if (truncated && truncated.path.length > 1) {
            commands.push({ type: 'COMBAT_MOVE', actorId: actor.id, path: truncated.path });
            currentActorPos = truncated.path[truncated.path.length - 1]!;
            remainingMovement = Math.max(0, remainingMovement - truncated.costFeet);
          }
        }
      }

      commands.push({ type: 'END_TURN', actorId: actor.id });
      return {
        actorId: actor.id,
        archetype,
        commands,
        reasoning: 'Goblin used Nimble Escape bonus action disengage to hit and run safely without opportunity attacks.',
      };
    }
  }

  // =========================================================================
  // ARCHETYPE: BRUTE (Ogre, Owlbear, Zombie, etc.)
  // =========================================================================
  if (archetype === 'brute') {
    const target = selectBestTarget(actor, allHostiles);
    const multiattack = actor.monsterData?.actions?.find(
      (a) => a.multiattack && a.multiattack.sequence.length > 0,
    );
    const attackAction = multiattack ?? findBestMeleeAction(actor) ?? actor.monsterData?.actions[0];

    const isAlreadyInMelee =
      getFootprintDistanceFeet(currentActorPos, actor.size, target.position, target.size) <= 5;

    const commands: GameCommand[] = [];

    if (!isAlreadyInMelee) {
      const adjCells = getAdjacentCells(target.position);
      let bestPathRes: PathfindingResult | null = null;
      let minCost = Infinity;

      for (const adj of adjCells) {
        const pRes = findPath({
          grid,
          mover: { id: actor.id, x: currentActorPos.x, y: currentActorPos.y, size: actor.size, isProne: aiIsProne },
          goal: adj,
          creatures: gridCreatures,
        });
        if (pRes.found && pRes.path.length > 1 && pRes.totalCostFeet < minCost) {
          minCost = pRes.totalCostFeet;
          bestPathRes = pRes;
        }
      }

      if (bestPathRes) {
        const truncated = truncatePathToExecutionBudget(
          grid,
          { id: actor.id, x: currentActorPos.x, y: currentActorPos.y, size: actor.size, isProne: aiIsProne },
          bestPathRes,
          remainingMovement,
          gridCreatures,
          aiHazardZones,
          aiIsProne,
        );
        if (truncated && truncated.path.length > 1) {
          commands.push({ type: 'COMBAT_MOVE', actorId: actor.id, path: truncated.path });
          currentActorPos = truncated.path[truncated.path.length - 1]!;
          remainingMovement = Math.max(0, remainingMovement - truncated.costFeet);
        }
      }
    }

    if (attackAction) {
      const dist = getFootprintDistanceFeet(currentActorPos, actor.size, target.position, target.size);
      const reach = getMonsterActionReachFeet(attackAction);
      if (dist <= reach) {
        commands.push({
          type: 'DECLARE_ATTACK',
          actorId: actor.id,
          targetId: target.id,
          monsterActionId: attackAction.id,
        });
      }
    }

    commands.push({ type: 'END_TURN', actorId: actor.id });
    return {
      actorId: actor.id,
      archetype,
      commands,
      reasoning: `Brute closed into melee reach and attacked ${target.name}.`,
    };
  }

  // =========================================================================
  // ARCHETYPE: CONTROLLER & SUPPORT FALLBACK
  // =========================================================================
  const target = selectBestTarget(actor, allHostiles);
  const actionToUse =
    actor.monsterData?.actions?.find((a) => a.multiattack && a.multiattack.sequence.length > 0) ??
    findBestMeleeAction(actor) ??
    findBestRangedAction(actor) ??
    actor.monsterData?.actions[0];

  const commands: GameCommand[] = [];
  const dist = getFootprintDistanceFeet(currentActorPos, actor.size, target.position, target.size);

  if (dist > 5) {
    const adjCells = getAdjacentCells(target.position);
    let bestPathRes: PathfindingResult | null = null;
    for (const adj of adjCells) {
      const pRes = findPath({
        grid,
        mover: { id: actor.id, x: currentActorPos.x, y: currentActorPos.y, size: actor.size, isProne: aiIsProne },
        goal: adj,
        creatures: gridCreatures,
      });
      if (pRes.found && pRes.path.length > 1 && (!bestPathRes || pRes.totalCostFeet < bestPathRes.totalCostFeet)) {
        bestPathRes = pRes;
      }
    }
    if (bestPathRes) {
      const truncated = truncatePathToExecutionBudget(
        grid,
        { id: actor.id, x: currentActorPos.x, y: currentActorPos.y, size: actor.size, isProne: aiIsProne },
        bestPathRes,
        remainingMovement,
        gridCreatures,
        aiHazardZones,
        aiIsProne,
      );
      if (truncated && truncated.path.length > 1) {
        commands.push({ type: 'COMBAT_MOVE', actorId: actor.id, path: truncated.path });
        currentActorPos = truncated.path[truncated.path.length - 1]!;
        remainingMovement = Math.max(0, remainingMovement - truncated.costFeet);
      }
    }
  }

  if (actionToUse) {
    const distToTarget = getFootprintDistanceFeet(currentActorPos, actor.size, target.position, target.size);
    const isMelee = actionToUse.effects.some((e) => e.step === 'attack_roll' && e.attackType === 'melee_weapon');
    const reachOrRange = isMelee
      ? getMonsterActionReachFeet(actionToUse)
      : getMonsterActionMaxRangeFeet(actionToUse);
    if (distToTarget <= reachOrRange) {
      commands.push({
        type: 'DECLARE_ATTACK',
        actorId: actor.id,
        targetId: target.id,
        monsterActionId: actionToUse.id,
      });
    }
  }

  commands.push({ type: 'END_TURN', actorId: actor.id });
  return {
    actorId: actor.id,
    archetype,
    commands,
    reasoning: `${archetype} executed action against ${target.name}.`,
  };
}

// ---------------------------------------------------------------------------
// Helper Subroutines
// ---------------------------------------------------------------------------

function selectBestTarget(actor: Combatant, hostiles: Combatant[]): Combatant {
  let bestTarget = hostiles[0]!;
  let bestScore = -Infinity;

  for (const h of hostiles) {
    const estDmg = 8;
    const score = evaluateTargetPriority(actor, h, estDmg);
    if (score > bestScore) {
      bestScore = score;
      bestTarget = h;
    }
  }

  return bestTarget;
}

function findBestMeleeAction(actor: Combatant) {
  if (!actor.monsterData?.actions) return undefined;
  return actor.monsterData.actions.find(
    (a) =>
      !a.multiattack &&
      a.effects.some((e) => e.step === 'attack_roll' && e.attackType === 'melee_weapon'),
  );
}

function findBestRangedAction(actor: Combatant) {
  if (!actor.monsterData?.actions) return undefined;
  return actor.monsterData.actions.find(
    (a) =>
      !a.multiattack &&
      a.effects.some(
        (e) =>
          e.step === 'attack_roll' &&
          (e.attackType === 'ranged_weapon' || e.attackType === 'ranged_spell'),
      ),
  );
}

function findBestRangedPosition(options: {
  actor: Combatant;
  target: Combatant;
  grid: TacticalGrid;
  gridCreatures: GridCreature[];
  maxFeet: number;
  archetype: AiArchetype;
  allCombatants: Record<string, Combatant>;
  dispositionMatrix?: DispositionMatrix;
}): GridPoint | null {
  const { actor, target, grid, gridCreatures, maxFeet, archetype, allCombatants, dispositionMatrix } =
    options;
  let bestPos: GridPoint | null = null;
  let bestScore = -Infinity;

  // Search reachable cells around current position
  for (const cell of grid.cells) {
    if (cell.terrain === 'wall_solid' || cell.terrain === 'void') continue;

    const distFromStart = Math.max(
      Math.abs(cell.x - actor.position.x),
      Math.abs(cell.y - actor.position.y),
    ) * 5;
    if (distFromStart > maxFeet) continue;

    // Check pathability
    if (cell.x !== actor.position.x || cell.y !== actor.position.y) {
      const pRes = findPath({
        grid,
        mover: { id: actor.id, x: actor.position.x, y: actor.position.y, size: actor.size, isProne: actor.conditions.includes("prone") },
        goal: { x: cell.x, y: cell.y },
        creatures: gridCreatures,
      });
      if (!pRes.found || pRes.path.length <= 1 || pRes.totalCostFeet > maxFeet) continue;
    }

    const posScore = scoreCandidatePosition({
      actor,
      position: { x: cell.x, y: cell.y },
      target,
      archetype,
      grid,
      allCombatants,
      dispositionMatrix,
    });

    if (posScore > bestScore) {
      bestScore = posScore;
      bestPos = { x: cell.x, y: cell.y };
    }
  }

  return bestPos;
}

function findRetreatPosition(options: {
  actor: Combatant;
  threat: Combatant;
  grid: TacticalGrid;
  gridCreatures: GridCreature[];
  maxFeet: number;
}): GridPoint | null {
  const { actor, threat, grid, gridCreatures, maxFeet } = options;
  let bestCell: GridPoint | null = null;
  let maxDistance = -1;

  for (const cell of grid.cells) {
    if (cell.terrain === 'wall_solid') continue;
    const distFromStart = Math.max(
      Math.abs(cell.x - actor.position.x),
      Math.abs(cell.y - actor.position.y),
    ) * 5;
    if (distFromStart > maxFeet) continue;

    const distFromThreat = getFootprintDistanceFeet(
      { x: cell.x, y: cell.y },
      actor.size,
      threat.position,
      threat.size,
    );

    const pRes = findPath({
      grid,
      mover: { id: actor.id, x: actor.position.x, y: actor.position.y, size: actor.size, isProne: actor.conditions.includes("prone") },
      goal: { x: cell.x, y: cell.y },
      creatures: gridCreatures,
    });
    if (!pRes.found || pRes.path.length <= 1 || pRes.totalCostFeet > maxFeet) continue;

    if (distFromThreat > maxDistance) {
      maxDistance = distFromThreat;
      bestCell = { x: cell.x, y: cell.y };
    }
  }

  return bestCell;
}

/**
 * Evaluates candidate AoE spell/breath placements to maximize enemies hit while avoiding friendly fire.
 */
function planAoeAttack(options: {
  actor: Combatant;
  state: CombatState;
  grid: TacticalGrid;
  hostiles: Combatant[];
  allies: Combatant[];
  dispositionMatrix?: DispositionMatrix;
}): AiPlan | null {
  const { actor, state, grid, hostiles, allies, dispositionMatrix } = options;

  // Check for fireball spell or breath weapon action
  const hasFireball =
    actor.characterSheet?.spellcasting?.preparedOrKnownSpellIds?.includes('fireball') ||
    actor.monsterData?.spellcasting?.preparedSpellIds?.some((s: string) => s.toLowerCase() === 'fireball');

  const breathWeapon = actor.monsterData?.actions?.find(
    (a) =>
      a.id.toLowerCase().includes('breath') ||
      a.name.toLowerCase().includes('breath') ||
      a.effects.some((e) => e.step === 'saving_throw' && e.onFail?.some((f) => f.step === 'deal_damage')),
  );

  if (!hasFireball && !breathWeapon) {
    return null;
  }

  if (hasFireball) {
    // 20-ft radius sphere. Evaluate candidate target cells
    let bestCell: GridPoint | null = null;
    let bestScore = -Infinity;

    for (const h of hostiles) {
      // Test targeting hostiles directly or nearby cells
      const candidates = [h.position, ...getAdjacentCells(h.position)];
      for (const cand of candidates) {
        const affected = rasterizeSphere(
          { x: cand.x * 5 + 2.5, y: cand.y * 5 + 2.5 },
          20,
        );

        const hitHostiles = hostiles.filter((hostile) =>
          affected.some((ac) => ac.x === hostile.position.x && ac.y === hostile.position.y),
        );
        const hitAllies = allies.filter((ally) =>
          affected.some((ac) => ac.x === ally.position.x && ac.y === ally.position.y),
        );

        // Friendly fire is heavily penalized
        const score = hitHostiles.length * 35 - hitAllies.length * 200;

        if (hitAllies.length === 0 && hitHostiles.length >= 2 && score > bestScore) {
          bestScore = score;
          bestCell = cand;
        }
      }
    }

    if (bestCell) {
      return {
        actorId: actor.id,
        archetype: 'artillery',
        commands: [
          {
            type: 'DECLARE_CAST_SPELL',
            actorId: actor.id,
            spellId: 'fireball',
            slotLevel: 3,
            targetCell: bestCell,
          },
          { type: 'END_TURN', actorId: actor.id },
        ],
        reasoning: `AoE caster positioned Fireball at (${bestCell.x}, ${bestCell.y}) to maximize hostiles hit while avoiding allies.`,
      };
    }
  }

  if (breathWeapon) {
    // Cone or Line breath weapon
    let bestCell: GridPoint | null = null;
    let bestScore = -Infinity;

    for (const h of hostiles) {
      const originFt = { x: actor.position.x * 5 + 2.5, y: actor.position.y * 5 + 2.5 };
      const targetFt = { x: h.position.x * 5 + 2.5, y: h.position.y * 5 + 2.5 };
      const dirFt = { x: targetFt.x - originFt.x, y: targetFt.y - originFt.y };
      const affected = rasterizeCone(originFt, dirFt, 15);

      const hitHostiles = hostiles.filter((hostile) =>
        affected.some((ac) => ac.x === hostile.position.x && ac.y === hostile.position.y),
      );
      const hitAllies = allies.filter((ally) =>
        affected.some((ac) => ac.x === ally.position.x && ac.y === ally.position.y),
      );

      const score = hitHostiles.length * 30 - hitAllies.length * 200;
      if (hitAllies.length === 0 && hitHostiles.length >= 1 && score > bestScore) {
        bestScore = score;
        bestCell = h.position;
      }
    }

    if (bestCell) {
      return {
        actorId: actor.id,
        archetype: 'artillery',
        commands: [
          {
            type: 'EXECUTE_MONSTER_ACTION',
            actorId: actor.id,
            actionId: breathWeapon.id,
            targetCell: bestCell,
          },
          { type: 'END_TURN', actorId: actor.id },
        ],
        reasoning: `Dragon placed Breath Weapon towards (${bestCell.x}, ${bestCell.y}) hitting hostiles with zero friendly fire.`,
      };
    }
  }

  return null;
}

/**
 * Executes a planned AI turn deterministically through the GameState reducer.
 */
export function executeAiTurn(
  state: GameState,
  actorId: string,
  options?: { dispositionMatrix?: DispositionMatrix; archetypeOverride?: AiArchetype },
): { nextState: GameState; events: GameEvent[]; commands: GameCommand[] } {
  if (!state.combat) {
    throw new Error('Cannot execute AI turn outside active combat');
  }

  const plan = planAiTurn({
    state: state.combat,
    activeCombatantId: actorId,
    grid: state.grid,
    dispositionMatrix: options?.dispositionMatrix ?? state.combat.dispositionMatrix,
    archetypeOverride: options?.archetypeOverride,
  });

  let currentState = state;
  const allEvents: GameEvent[] = [];

  for (const cmd of plan.commands) {
    const res = reduceGame(currentState, cmd);
    currentState = res.nextState;
    allEvents.push(...res.events);
  }

  return { nextState: currentState, events: allEvents, commands: plan.commands };
}
