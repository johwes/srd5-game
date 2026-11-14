import type { CombatantSide } from './types.js';

/**
 * Tactical disposition between two combatants or factions (Spec 06 Section 2.3).
 */
export type Disposition = 'allied' | 'hostile' | 'neutral';

/**
 * 2D map of relationship overrides between teams or factions.
 * Example: `matrix['crown_loyalists']['player_guild'] === 'allied'`
 */
export type DispositionMatrix = Record<string, Record<string, Disposition>>;

/**
 * Identification fields used to evaluate allegiance.
 */
export interface CombatantAllegiance {
  id?: string;
  teamId?: string;
  side?: CombatantSide;
  factionId?: string;
}

/**
 * Resolves the dynamic disposition ('allied' | 'hostile' | 'neutral') between two entities
 * based on their IDs, teams, factions, and an optional disposition matrix (Spec 06 Section 2.3).
 */
export function getDisposition(
  a: CombatantAllegiance,
  b: CombatantAllegiance,
  matrix?: DispositionMatrix,
): Disposition {
  // Same entity is always allied to itself
  if (a.id && b.id && a.id === b.id) {
    return 'allied';
  }

  const teamA = a.teamId ?? a.side ?? 'party';
  const teamB = b.teamId ?? b.side ?? 'party';

  // Same tactical team is always allied
  if (teamA === teamB) {
    return 'allied';
  }

  // Check explicit matrix if provided (first by factionId, then by teamId)
  if (matrix) {
    if (a.factionId && b.factionId && matrix[a.factionId]?.[b.factionId]) {
      return matrix[a.factionId][b.factionId]!;
    }
    if (matrix[teamA]?.[teamB]) {
      return matrix[teamA][teamB]!;
    }
  }

  // If either side is designated neutral and no override is present, treat as neutral
  if (a.side === 'neutral' || b.side === 'neutral' || teamA === 'neutral' || teamB === 'neutral') {
    return 'neutral';
  }

  // Default: Different teams in active combat are hostile
  return 'hostile';
}

/**
 * Returns true if entity A and entity B are allied.
 */
export function areAllied(
  a: CombatantAllegiance,
  b: CombatantAllegiance,
  matrix?: DispositionMatrix,
): boolean {
  return getDisposition(a, b, matrix) === 'allied';
}

/**
 * Returns true if entity A and entity B are hostile.
 */
export function areHostile(
  a: CombatantAllegiance,
  b: CombatantAllegiance,
  matrix?: DispositionMatrix,
): boolean {
  return getDisposition(a, b, matrix) === 'hostile';
}
