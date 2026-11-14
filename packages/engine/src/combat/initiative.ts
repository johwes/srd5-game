import { rollD20 } from '../dice/evaluator.js';
import type { CombatEvent, Combatant, InitiativeEntry } from './types.js';

export interface RollInitiativeResult {
  entries: InitiativeEntry[];
  events: CombatEvent[];
  nextRngState: number;
}

/**
 * Compares two Initiative entries using the SRD 5.1 tiebreaker hierarchy:
 * 1. Higher total initiative acts first.
 * 2. Higher Dexterity score acts first.
 * 3. Higher secondary tiebreaker roll acts first.
 * 4. Deterministic string comparison of entityId.
 */
export function compareInitiativeEntries(a: InitiativeEntry, b: InitiativeEntry): number {
  if (b.initiative !== a.initiative) {
    return b.initiative - a.initiative;
  }
  if (b.dexterityScore !== a.dexterityScore) {
    return b.dexterityScore - a.dexterityScore;
  }
  if (b.tieBreaker !== a.tieBreaker) {
    return b.tieBreaker - a.tieBreaker;
  }
  return a.entityId.localeCompare(b.entityId);
}

/**
 * Purely rolls initiative for all participating combatants using the seeded PRNG.
 * Records DICE_ROLLED events and returns sorted initiative order.
 */
export function rollInitiativeForCombatants(
  combatants: Combatant[],
  rngState: number,
): RollInitiativeResult {
  let currentState = rngState;
  const entries: InitiativeEntry[] = [];
  const events: CombatEvent[] = [];

  for (const combatant of combatants) {
    const d20Res = rollD20(currentState, {
      modifier: combatant.initiativeBonus,
      mode: combatant.initiativeRollMode,
    });
    currentState = d20Res.nextState;

    // Roll a secondary d20 for tertiary tiebreaking
    const tieRes = rollD20(currentState);
    currentState = tieRes.nextState;

    entries.push({
      entityId: combatant.id,
      initiative: d20Res.total,
      naturalRoll: d20Res.naturalRoll,
      dexterityScore: combatant.dexterityScore,
      tieBreaker: tieRes.total,
    });

    events.push({
      type: 'DICE_ROLLED',
      actorId: combatant.id,
      rollPurpose: 'initiative',
      notation: d20Res.record.resolvedNotation,
      rolls: d20Res.record.rolls,
      kept: d20Res.record.kept,
      modifier: d20Res.record.modifier,
      total: d20Res.total,
      mode: combatant.initiativeRollMode,
      naturalCrit: d20Res.isCrit,
      naturalFumble: d20Res.isFumble,
    });
  }

  // Sort descending
  entries.sort(compareInitiativeEntries);

  return {
    entries,
    events,
    nextRngState: currentState,
  };
}

/**
 * Checks whether a combatant is eligible to take turns (alive and not permanently removed).
 * Characters at 0 HP with < 3 death failures are eligible (they roll death saves on their turn).
 * Dead characters (3 failures or instant death) and dead monsters (0 HP) are skipped.
 */
export function isCombatantEligibleForTurn(combatant: Combatant | undefined): boolean {
  if (!combatant) return false;
  if (combatant.isDead) return false;

  // Monsters at 0 HP die immediately in SRD 5.1
  if (combatant.side === 'monster' && combatant.currentHp <= 0) {
    return false;
  }

  // Player characters die at 3 death save failures
  if (combatant.deathSaves.failures >= 3) {
    return false;
  }

  return true;
}

/**
 * Finds the index of the next eligible combatant in initiative order, wrapping around if needed.
 * Returns null if no eligible combatant exists.
 */
export function findNextActiveCombatantIndex(
  order: InitiativeEntry[],
  combatants: Record<string, Combatant>,
  startIndex: number,
): { nextIndex: number; wrapped: boolean } | null {
  if (order.length === 0) return null;

  const total = order.length;
  for (let offset = 1; offset <= total; offset++) {
    const rawIndex = startIndex + offset;
    const candidateIndex = rawIndex % total;
    const wrapped = rawIndex >= total;

    const entry = order[candidateIndex];
    if (entry && isCombatantEligibleForTurn(combatants[entry.entityId])) {
      return { nextIndex: candidateIndex, wrapped };
    }
  }

  return null;
}
