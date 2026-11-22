import type { GridPoint, TacticalGrid } from '../grid/model.js';
import { getFootprintDistanceFeet } from '../grid/footprints.js';
import { findPath, type GridCreature, type PathfindingResult } from '../grid/pathfinding.js';
import type { Combatant, CombatState, HazardZone } from '../combat/types.js';
import type { DispositionMatrix } from '../combat/allegiance.js';
import { areAllied, areHostile } from '../combat/allegiance.js';
import type { GameCommand } from '../state/types.js';
import type { AiPlan } from './types.js';
import { truncatePathToExecutionBudget, getAdjacentCells } from './planner.js';

/**
 * SRD-1102 — Class-kit tactical AI (Spec 10 §4.1).
 *
 * `planAiTurn` delegates here when the actor is a real SRD 5.1 classed NPC
 * (`fighter` | `wizard` | `cleric` | `rogue` via `characterSheet.classes`).
 * Each kit spends real resources through valid `GameCommand`s:
 * - Warrior: Second Wind <50% HP (bonus action), Action Surge in melee.
 * - Mage: Fireball vs 2+ clustered hostiles, else Magic Missile / Fire Bolt.
 * - Cleric: Healing Word / Cure Wounds <60% HP ally, Bless early, else
 *   Guiding Bolt / Sacred Flame.
 * - Thief: Cunning Action disengage to kite + Sneak Attack focus (ally-adjacent).
 */

export type WarSquadKitClass = 'fighter' | 'wizard' | 'cleric' | 'rogue';

export function getWarSquadKitClass(actor: Combatant): WarSquadKitClass | null {
  const classId = actor.characterSheet?.classes?.[0]?.classId;
  if (classId === 'fighter' || classId === 'wizard' || classId === 'cleric' || classId === 'rogue') {
    return classId;
  }
  return null;
}

function getResourceAvailable(actor: Combatant, ...ids: string[]): boolean {
  const resources = actor.characterSheet?.resources as Record<string, { available?: number }> | undefined;
  if (!resources) return false;
  return ids.some((id) => (resources[id]?.available ?? 0) > 0);
}

function hasActivatedAbility(actor: Combatant, ...ids: string[]): boolean {
  const abilities = actor.characterSheet?.activatedAbilities ?? [];
  return abilities.some((a) => ids.includes(a.id));
}

function knowsSpell(actor: Combatant, spellId: string): boolean {
  const sc = actor.characterSheet?.spellcasting;
  if (!sc) return false;
  const lowered = spellId.toLowerCase();
  const lists: Array<string[] | undefined> = [
    sc.preparedOrKnownSpellIds as string[] | undefined,
    sc.cantripIds as string[] | undefined,
    (sc as { preparedSpellIds?: string[] }).preparedSpellIds,
    (sc as { knownSpellIds?: string[] }).knownSpellIds,
    (sc as { spellbookSpellIds?: string[] }).spellbookSpellIds,
  ];
  return lists.some((list) => list?.some((s) => s.toLowerCase() === lowered));
}

function slotAvailable(actor: Combatant, level: number): boolean {
  if (level <= 0) return true;
  const pool = actor.spellSlots?.[String(level)];
  if (pool) return pool.available > 0;
  // Fall back to the derived sheet slots when the combatant mirror is stale.
  const sheetSlots = actor.characterSheet?.spellcasting?.spellSlots as
    | Record<string, { available?: number }>
    | undefined;
  const sheetPool = sheetSlots?.[String(level)];
  if (sheetPool) return (sheetPool.available ?? 0) > 0;
  return false;
}

function selectBestTarget(actor: Combatant, hostiles: Combatant[]): Combatant {
  let best = hostiles[0]!;
  let bestScore = -Infinity;
  for (const h of hostiles) {
    const score = (h.maxHp - h.currentHp) - getFootprintDistanceFeet(actor.position, actor.size, h.position, h.size) * 0.1 + (h.currentHp <= 0 ? -1000 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best;
}

function moveAdjacent(
  actor: Combatant,
  currentPos: GridPoint,
  target: Combatant,
  grid: TacticalGrid,
  gridCreatures: GridCreature[],
  remainingMovement: number,
  hazardZones?: Record<string, HazardZone> | undefined,
): { commands: GameCommand[]; currentPos: GridPoint; remaining: number } {
  const commands: GameCommand[] = [];
  if (getFootprintDistanceFeet(currentPos, actor.size, target.position, target.size) <= 5) {
    return { commands, currentPos, remaining: remainingMovement };
  }
  const isProne = actor.conditions.includes('prone');
  let bestPath: PathfindingResult | null = null;
  for (const adj of getAdjacentCells(target.position)) {
    if (adj.x === currentPos.x && adj.y === currentPos.y) return { commands, currentPos, remaining: remainingMovement };
    const pRes = findPath({
      grid,
      mover: { id: actor.id, x: currentPos.x, y: currentPos.y, size: actor.size, isProne },
      goal: adj,
      creatures: gridCreatures,
    });
    if (pRes.found && pRes.path.length > 1 && (!bestPath || pRes.totalCostFeet < bestPath.totalCostFeet)) {
      bestPath = pRes;
    }
  }
  if (bestPath) {
    const truncated = truncatePathToExecutionBudget(
      grid,
      { id: actor.id, x: currentPos.x, y: currentPos.y, size: actor.size, isProne },
      bestPath,
      remainingMovement,
      gridCreatures,
      hazardZones,
      isProne,
    );
    if (truncated && truncated.path.length > 1) {
      commands.push({ type: 'COMBAT_MOVE', actorId: actor.id, path: truncated.path });
      const dest = truncated.path[truncated.path.length - 1]!;
      return { commands, currentPos: dest, remaining: Math.max(0, remainingMovement - truncated.costFeet) };
    }
  }
  return { commands, currentPos, remaining: remainingMovement };
}

// ---------------------------------------------------------------------------
// Kit planners
// ---------------------------------------------------------------------------

function planFighter(
  actor: Combatant,
  state: CombatState,
  grid: TacticalGrid,
  hostiles: Combatant[],
  gridCreatures: GridCreature[],
  remainingMovement: number,
): AiPlan {
  const commands: GameCommand[] = [];
  let currentPos = { ...actor.position };
  let remaining = remainingMovement;
  const parts: string[] = [];

  const hpFraction = actor.maxHp > 0 ? actor.currentHp / actor.maxHp : 1;
  const bonusAvailable = (state.turnBudget?.bonusAction ?? 1) > 0;
  const canSecondWind =
    bonusAvailable &&
    hasActivatedAbility(actor, 'use-second-wind') &&
    getResourceAvailable(actor, 'second_wind', 'second-wind');
  if (hpFraction < 0.5 && canSecondWind) {
    commands.push({ type: 'USE_CLASS_FEATURE', actorId: actor.id, featureId: 'use-second-wind' });
    parts.push('Second Wind (<50% HP)');
  }

  const target = selectBestTarget(actor, hostiles);
  const moved = moveAdjacent(actor, currentPos, target, grid, gridCreatures, remaining, state.hazardZones);
  commands.push(...moved.commands);
  currentPos = moved.currentPos;
  remaining = moved.remaining;

  const engaged =
    getFootprintDistanceFeet(currentPos, actor.size, target.position, target.size) <= 5;
  const canSurge =
    engaged &&
    (state.turnBudget?.action ?? 1) > 0 &&
    hasActivatedAbility(actor, 'use-action-surge') &&
    getResourceAvailable(actor, 'action_surge', 'action-surge');
  if (canSurge) {
    commands.push({ type: 'USE_CLASS_FEATURE', actorId: actor.id, featureId: 'use-action-surge' });
    parts.push('Action Surge (engaged)');
  }

  if (engaged) {
    commands.push({ type: 'DECLARE_ATTACK', actorId: actor.id, targetId: target.id });
    // Action Surge grants a second action: a surging warrior presses the attack.
    if (canSurge) {
      commands.push({ type: 'DECLARE_ATTACK', actorId: actor.id, targetId: target.id });
    }
  }
  commands.push({ type: 'END_TURN', actorId: actor.id });
  return {
    actorId: actor.id,
    archetype: 'brute',
    commands,
    reasoning: `Warrior ${parts.length > 0 ? parts.join(' + ') + ' + ' : ''}attacked ${target.name}.`,
  };
}

function planMage(
  actor: Combatant,
  state: CombatState,
  grid: TacticalGrid,
  hostiles: Combatant[],
  allies: Combatant[],
  gridCreatures: GridCreature[],
  remainingMovement: number,
  dispositionMatrix?: DispositionMatrix,
): AiPlan {
  void state;
  void gridCreatures;
  void remainingMovement;
  void dispositionMatrix;
  const commands: GameCommand[] = [];

  // AOE when 2+ hostiles cluster within a 20-ft Fireball: reuse the
  // artillery footprint check (pairwise Chebyshev distance ≤ 4 cells).
  const clustered = hostiles.some((a) =>
    hostiles.some((b) => b.id !== a.id && Math.max(Math.abs(a.position.x - b.position.x), Math.abs(a.position.y - b.position.y)) <= 4),
  );
  const allyNearCluster = (cell: GridPoint): boolean =>
    allies.some((ally) => Math.max(Math.abs(ally.position.x - cell.x), Math.abs(ally.position.y - cell.y)) <= 4);

  if (clustered && knowsSpell(actor, 'fireball') && slotAvailable(actor, 3)) {
    // Aim at the hostile with the most neighbors, skipping friendly-fire cells.
    let best: GridPoint | null = null;
    let bestHits = 0;
    for (const h of hostiles) {
      if (allyNearCluster(h.position)) continue;
      const hits = hostiles.filter(
        (o) => Math.max(Math.abs(o.position.x - h.position.x), Math.abs(o.position.y - h.position.y)) <= 4,
      ).length;
      if (hits >= 2 && hits > bestHits) {
        bestHits = hits;
        best = h.position;
      }
    }
    if (best) {
      commands.push({ type: 'DECLARE_CAST_SPELL', actorId: actor.id, spellId: 'fireball', slotLevel: 3, targetCell: best });
      commands.push({ type: 'END_TURN', actorId: actor.id });
      return {
        actorId: actor.id,
        archetype: 'artillery',
        commands,
        reasoning: `Battle Mage cast Fireball on ${bestHits} clustered hostiles, avoiding allies.`,
      };
    }
  }

  const target = selectBestTarget(actor, hostiles);
  if (knowsSpell(actor, 'magic-missile') && slotAvailable(actor, 1)) {
    commands.push({
      type: 'DECLARE_CAST_SPELL',
      actorId: actor.id,
      spellId: 'magic-missile',
      slotLevel: 1,
      targetIds: [target.id],
    });
    commands.push({ type: 'END_TURN', actorId: actor.id });
    return {
      actorId: actor.id,
      archetype: 'artillery',
      commands,
      reasoning: `Battle Mage cast Magic Missile at ${target.name} from cover.`,
    };
  }
  if (knowsSpell(actor, 'fire-bolt')) {
    commands.push({
      type: 'DECLARE_CAST_SPELL',
      actorId: actor.id,
      spellId: 'fire-bolt',
      slotLevel: 0,
      targetIds: [target.id],
    });
    commands.push({ type: 'END_TURN', actorId: actor.id });
    return {
      actorId: actor.id,
      archetype: 'artillery',
      commands,
      reasoning: `Battle Mage cast Fire Bolt at ${target.name} from cover.`,
    };
  }
  commands.push({ type: 'DECLARE_ATTACK', actorId: actor.id, targetId: target.id });
  commands.push({ type: 'END_TURN', actorId: actor.id });
  return {
    actorId: actor.id,
    archetype: 'artillery',
    commands,
    reasoning: `Battle Mage attacked ${target.name} (no spell slots).`,
  };
}

function planCleric(
  actor: Combatant,
  state: CombatState,
  grid: TacticalGrid,
  hostiles: Combatant[],
  allies: Combatant[],
  gridCreatures: GridCreature[],
  remainingMovement: number,
): AiPlan {
  const commands: GameCommand[] = [];
  const injured = allies
    .filter((a) => !a.isDead && a.currentHp > 0 && a.currentHp < a.maxHp)
    .sort((a, b) => a.currentHp / a.maxHp - b.currentHp / b.maxHp)[0];
  const injuredFraction = injured ? injured.currentHp / injured.maxHp : 1;

  if (injured && injuredFraction < 0.6) {
    // Healing Word (60-ft, bonus action) preferred; Cure Wounds when adjacent.
    if (knowsSpell(actor, 'healing-word') && slotAvailable(actor, 1)) {
      commands.push({
        type: 'DECLARE_CAST_SPELL',
        actorId: actor.id,
        spellId: 'healing-word',
        slotLevel: 1,
        targetIds: [injured.id],
      });
      commands.push({ type: 'END_TURN', actorId: actor.id });
      return {
        actorId: actor.id,
        archetype: 'support',
        commands,
        reasoning: `War Priest cast Healing Word on ${injured.name} (<60% HP).`,
      };
    }
    const adjacent =
      getFootprintDistanceFeet(actor.position, actor.size, injured.position, injured.size) <= 5;
    if (knowsSpell(actor, 'cure-wounds') && slotAvailable(actor, 1) && adjacent) {
      commands.push({
        type: 'DECLARE_CAST_SPELL',
        actorId: actor.id,
        spellId: 'cure-wounds',
        slotLevel: 1,
        targetIds: [injured.id],
      });
      commands.push({ type: 'END_TURN', actorId: actor.id });
      return {
        actorId: actor.id,
        archetype: 'support',
        commands,
        reasoning: `War Priest cast Cure Wounds on adjacent ${injured.name} (<60% HP).`,
      };
    }
    if (knowsSpell(actor, 'cure-wounds') && slotAvailable(actor, 1)) {
      const moved = moveAdjacent(actor, { ...actor.position }, injured, grid, gridCreatures, remainingMovement, state.hazardZones);
      commands.push(...moved.commands);
      const nowAdjacent =
        getFootprintDistanceFeet(moved.currentPos, actor.size, injured.position, injured.size) <= 5;
      if (nowAdjacent) {
        commands.push({
          type: 'DECLARE_CAST_SPELL',
          actorId: actor.id,
          spellId: 'cure-wounds',
          slotLevel: 1,
          targetIds: [injured.id],
        });
        commands.push({ type: 'END_TURN', actorId: actor.id });
        return {
          actorId: actor.id,
          archetype: 'support',
          commands,
          reasoning: `War Priest closed to cast Cure Wounds on ${injured.name}.`,
        };
      }
    }
  }

  // Bless early (round 1, allies unblessed, slot free).
  // NOTE: the applied effect id is 'bless-buff' (spell-overlays), not 'bless' —
  // guard on the real id or the priest re-casts every round, breaking its own
  // concentration and stripping the war band's buffs.
  if (
    state.round <= 1 &&
    knowsSpell(actor, 'bless') &&
    slotAvailable(actor, 1) &&
    !allies.some((a) => a.activeEffects?.some((e) => e.effectId === 'bless-buff'))
  ) {
    // `allies` includes the actor itself: exclude + dedupe so the cast fans
    // out to 3 distinct targets instead of double-counting the priest.
    const others = allies.filter((a) => a.id !== actor.id).slice(0, 2);
    const blessTargets = [...new Set([actor.id, ...others.map((a) => a.id)])];
    commands.push({
      type: 'DECLARE_CAST_SPELL',
      actorId: actor.id,
      spellId: 'bless',
      slotLevel: 1,
      targetIds: blessTargets,
    });
    commands.push({ type: 'END_TURN', actorId: actor.id });
    return {
      actorId: actor.id,
      archetype: 'support',
      commands,
      reasoning: 'War Priest cast Bless on the war band.',
    };
  }

  const target = selectBestTarget(actor, hostiles);
  if (knowsSpell(actor, 'guiding-bolt') && slotAvailable(actor, 1)) {
    commands.push({
      type: 'DECLARE_CAST_SPELL',
      actorId: actor.id,
      spellId: 'guiding-bolt',
      slotLevel: 1,
      targetIds: [target.id],
    });
    commands.push({ type: 'END_TURN', actorId: actor.id });
    return {
      actorId: actor.id,
      archetype: 'support',
      commands,
      reasoning: `War Priest cast Guiding Bolt at ${target.name}.`,
    };
  }
  if (knowsSpell(actor, 'sacred-flame')) {
    commands.push({
      type: 'DECLARE_CAST_SPELL',
      actorId: actor.id,
      spellId: 'sacred-flame',
      slotLevel: 0,
      targetIds: [target.id],
    });
    commands.push({ type: 'END_TURN', actorId: actor.id });
    return {
      actorId: actor.id,
      archetype: 'support',
      commands,
      reasoning: `War Priest cast Sacred Flame at ${target.name}.`,
    };
  }
  commands.push({ type: 'DECLARE_ATTACK', actorId: actor.id, targetId: target.id });
  commands.push({ type: 'END_TURN', actorId: actor.id });
  return {
    actorId: actor.id,
    archetype: 'support',
    commands,
    reasoning: `War Priest attacked ${target.name}.`,
  };
}

function planRogue(
  actor: Combatant,
  state: CombatState,
  grid: TacticalGrid,
  hostiles: Combatant[],
  allies: Combatant[],
  gridCreatures: GridCreature[],
  remainingMovement: number,
): AiPlan {
  const commands: GameCommand[] = [];
  let currentPos = { ...actor.position };
  let remaining = remainingMovement;
  const rogueIsProne = actor.conditions.includes('prone');
  const rogueHazards = state.hazardZones;

  // Sneak Attack focus: prefer a hostile adjacent to one of our allies.
  const flanked =
    hostiles.find((h) =>
      allies.some(
        (a) =>
          a.id !== actor.id &&
          !a.isDead &&
          getFootprintDistanceFeet(a.position, a.size, h.position, h.size) <= 5,
      ),
    ) ?? selectBestTarget(actor, hostiles);

  const hasCunning =
    actor.characterSheet?.featureIds?.includes('cunning-action') ||
    hasActivatedAbility(actor, 'use-cunning-action', 'cunning-action-disengage', 'cunning-action-dash');
  const engaged = hostiles.some(
    (h) => getFootprintDistanceFeet(currentPos, actor.size, h.position, h.size) <= 5,
  );

  // Already in melee with our mark: strike, then Cunning Action away.
  if (engaged && getFootprintDistanceFeet(currentPos, actor.size, flanked.position, flanked.size) <= 5) {
    commands.push({ type: 'DECLARE_ATTACK', actorId: actor.id, targetId: flanked.id });
    if (hasCunning && remaining > 0) {
      commands.push({ type: 'USE_STANDARD_ACTION', actorId: actor.id, action: 'disengage', asBonusAction: true });
      // Kite to the farthest reachable cell from the mark.
      let bestCell: GridPoint | null = null;
      let bestDist = -1;
      for (const cell of grid.cells) {
        if (cell.terrain === 'wall_solid' || cell.terrain === 'void') continue;
        const fromStart = Math.max(Math.abs(cell.x - currentPos.x), Math.abs(cell.y - currentPos.y)) * 5;
        if (fromStart > remaining) continue;
        const d = getFootprintDistanceFeet(cell, actor.size, flanked.position, flanked.size);
        if (d > bestDist) {
          bestDist = d;
          bestCell = { x: cell.x, y: cell.y };
        }
      }
      if (bestCell && (bestCell.x !== currentPos.x || bestCell.y !== currentPos.y)) {
        const pRes = findPath({
          grid,
          mover: { id: actor.id, x: currentPos.x, y: currentPos.y, size: actor.size, isProne: rogueIsProne },
          goal: bestCell,
          creatures: gridCreatures,
        });
        const truncated = truncatePathToExecutionBudget(
          grid,
          { id: actor.id, x: currentPos.x, y: currentPos.y, size: actor.size, isProne: rogueIsProne },
          pRes,
          remaining,
          gridCreatures,
          rogueHazards,
          rogueIsProne,
        );
        if (truncated && truncated.path.length > 1) {
          commands.push({ type: 'COMBAT_MOVE', actorId: actor.id, path: truncated.path });
        }
      }
    }
    commands.push({ type: 'END_TURN', actorId: actor.id });
    return {
      actorId: actor.id,
      archetype: 'skirmisher',
      commands,
      reasoning: `Shadow Knife Sneak Attacked ${flanked.name} then Cunning Action disengaged.`,
    };
  }

  // Close to the flanked mark, strike, then disengage if still threatened.
  const moved = moveAdjacent(actor, currentPos, flanked, grid, gridCreatures, remaining, state.hazardZones);
  commands.push(...moved.commands);
  currentPos = moved.currentPos;
  remaining = moved.remaining;
  if (getFootprintDistanceFeet(currentPos, actor.size, flanked.position, flanked.size) <= 5) {
    commands.push({ type: 'DECLARE_ATTACK', actorId: actor.id, targetId: flanked.id });
    if (hasCunning) {
      commands.push({ type: 'USE_STANDARD_ACTION', actorId: actor.id, action: 'disengage', asBonusAction: true });
    }
  }
  commands.push({ type: 'END_TURN', actorId: actor.id });
  return {
    actorId: actor.id,
    archetype: 'skirmisher',
    commands,
    reasoning: `Shadow Knife closed for Sneak Attack on ${flanked.name} with Cunning Action escape.`,
  };
}

/**
 * Entry point consulted by `planAiTurn`: returns a class-kit plan when the
 * actor is a war-squad classed NPC, otherwise `null` (fall through to the
 * archetype planner).
 */
export function planClassKitTurn(options: {
  actor: Combatant;
  state: CombatState;
  grid: TacticalGrid;
  hostiles: Combatant[];
  allies: Combatant[];
  gridCreatures: GridCreature[];
  remainingMovement: number;
  dispositionMatrix?: DispositionMatrix;
}): AiPlan | null {
  const kit = getWarSquadKitClass(options.actor);
  if (!kit) return null;
  switch (kit) {
    case 'fighter':
      return planFighter(options.actor, options.state, options.grid, options.hostiles, options.gridCreatures, options.remainingMovement);
    case 'wizard':
      return planMage(options.actor, options.state, options.grid, options.hostiles, options.allies, options.gridCreatures, options.remainingMovement, options.dispositionMatrix);
    case 'cleric':
      return planCleric(options.actor, options.state, options.grid, options.hostiles, options.allies, options.gridCreatures, options.remainingMovement);
    case 'rogue':
      return planRogue(options.actor, options.state, options.grid, options.hostiles, options.allies, options.gridCreatures, options.remainingMovement);
    default:
      return null;
  }
}

export function isWarSquadCombatant(actor: Combatant): boolean {
  return getWarSquadKitClass(actor) !== null;
}
