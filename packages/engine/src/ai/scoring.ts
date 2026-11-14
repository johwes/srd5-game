import type { AiArchetype, DamageType } from '@srd5/data';
import type { GridPoint, TacticalGrid } from '../grid/model.js';
import { computeCover, hasLineOfSight } from '../grid/vision.js';
import { getFootprintDistanceFeet } from '../grid/footprints.js';
import type { Combatant } from '../combat/types.js';
import { areAllied, areHostile, type DispositionMatrix } from '../combat/allegiance.js';
import { isIncapacitated } from '../combat/conditions.js';

/**
 * Calculates estimated d20 hit probability accounting for Advantage / Disadvantage (Spec 04 Section 5.1).
 */
export function estimateHitProbability(
  toHitBonus: number,
  targetAc: number,
  rollMode: 'normal' | 'advantage' | 'disadvantage' = 'normal',
): number {
  const needed = targetAc - toHitBonus;
  // Natural 1 is always miss (5%), Natural 20 is always hit (5%)
  const clampedRollNeeded = Math.max(2, Math.min(20, needed));
  const baseP = (21 - clampedRollNeeded) / 20;

  if (rollMode === 'advantage') {
    return 1 - Math.pow(1 - baseP, 2);
  }
  if (rollMode === 'disadvantage') {
    return Math.pow(baseP, 2);
  }
  return baseP;
}

/**
 * Estimates average damage from a dice formula string like "1d6 + 2", "2d8", "8d6".
 */
export function estimateAverageDamage(diceFormula: string): number {
  let total = 0;
  // Match terms like "2d6", "+ 3", "- 1"
  const clean = diceFormula.replace(/\s+/g, '');
  const diceMatches = clean.matchAll(/([+-]?\d*)d(\d+)/gi);

  for (const m of diceMatches) {
    const countStr = m[1];
    const count = countStr === '' || countStr === '+' ? 1 : countStr === '-' ? -1 : parseInt(countStr, 10);
    const dieSides = parseInt(m[2], 10);
    const avgPerDie = (dieSides + 1) / 2;
    total += count * avgPerDie;
  }

  // Flat modifiers: numbers without 'd'
  // Remove matched dice terms first
  const withoutDice = clean.replace(/([+-]?\d*)d\d+/gi, '');
  const flatMatches = withoutDice.matchAll(/([+-]?\d+)/g);
  for (const fm of flatMatches) {
    total += parseInt(fm[1], 10);
  }

  return Math.max(0, total);
}

/**
 * Computes defensive multiplier against damage based on target resistances/immunities.
 */
export function getDamageMultiplier(target: Combatant, damageType?: DamageType): number {
  if (!damageType) return 1;
  if (target.damageImmunities?.includes(damageType)) return 0;
  if (target.damageResistances?.includes(damageType)) return 0.5;
  if (target.damageVulnerabilities?.includes(damageType)) return 2;
  return 1;
}

/**
 * Evaluates target priority score:
 * Down target (+30), Concentration break (+15), Squishy target bonus.
 */
export function evaluateTargetPriority(
  actor: Combatant,
  target: Combatant,
  estimatedDmg: number,
): number {
  let score = 0;

  // Action economy: Downing a conscious hostile removes their turn
  if (estimatedDmg >= target.currentHp) {
    score += 35;
  }

  // Disrupting active Concentration
  if (target.concentratingOn) {
    score += 20;
  }

  // Squishier / lower AC targets are more reliably damaged
  score += Math.max(0, (18 - target.armorClass) * 1.5);

  return score;
}

/**
 * Evaluates a candidate position on the tactical grid based on archetype preferences.
 */
export function scoreCandidatePosition(options: {
  actor: Combatant;
  position: GridPoint;
  target: Combatant;
  archetype: AiArchetype;
  grid: TacticalGrid;
  allCombatants: Record<string, Combatant>;
  dispositionMatrix?: DispositionMatrix;
  hasNimbleEscape?: boolean;
}): number {
  const { actor, position, target, archetype, grid, allCombatants, dispositionMatrix } = options;
  let score = 0;

  const distanceFeet = getFootprintDistanceFeet(position, actor.size, target.position, target.size);
  const hasLoS = hasLineOfSight(
    grid,
    { id: actor.id, x: position.x, y: position.y, size: actor.size },
    { id: target.id, x: target.position.x, y: target.position.y, size: target.size },
  );

  if (!hasLoS) {
    return -100; // Cannot attack without Line of Sight
  }

  const cover = computeCover(
    grid,
    { id: target.id, x: target.position.x, y: target.position.y, size: target.size },
    { id: actor.id, x: position.x, y: position.y, size: actor.size },
  );

  switch (archetype) {
    case 'artillery': {
      // Artillery wants 20–60 ft standoff distance, avoids melee <= 5 ft
      if (distanceFeet <= 5) {
        score -= 40; // Avoid close combat disadvantage
      } else if (distanceFeet >= 20 && distanceFeet <= 60) {
        score += 25;
      } else if (distanceFeet > 60) {
        score += 10;
      }

      // Seeks Half Cover (+2 AC) or Three-Quarters Cover (+5 AC) against target
      if (cover.cover === 'three_quarters') {
        score += 35;
      } else if (cover.cover === 'half') {
        score += 20;
      }
      break;
    }

    case 'skirmisher': {
      // Pack Tactics: Check if target has an ally of actor within 5 ft
      const hasAdjacentAlly = Object.values(allCombatants).some((c) => {
        if (c.id === actor.id || c.id === target.id) return false;
        if (!areAllied(actor, c, dispositionMatrix)) return false;
        if (c.isDead || c.currentHp <= 0 || isIncapacitated(c)) return false;
        return getFootprintDistanceFeet(c.position, c.size, target.position, target.size) <= 5;
      });

      if (hasAdjacentAlly && distanceFeet <= 5) {
        score += 30; // Positioned in melee adjacent to an ally's engagement for Pack Tactics!
      }

      // Hit-and-run / Nimble Escape: prefers ending turn out of melee reach if safe
      if (options.hasNimbleEscape && distanceFeet >= 15 && distanceFeet <= 35) {
        score += 25;
      }
      break;
    }

    case 'brute': {
      // Brutes close into melee reach
      if (distanceFeet <= 5) {
        score += 30;
      } else {
        score -= distanceFeet * 0.5;
      }
      break;
    }

    case 'controller': {
      // Controllers like moderate standoff (15–35 ft) with clear sight
      if (distanceFeet <= 5) {
        score -= 15;
      } else if (distanceFeet >= 15 && distanceFeet <= 40) {
        score += 20;
      }
      break;
    }

    case 'support': {
      // Support stays close to wounded allies but out of hostile frontline
      if (distanceFeet <= 5) {
        score -= 20;
      }
      break;
    }
  }

  return score;
}
