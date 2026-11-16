import { describe, expect, it } from 'vitest';
import {
  type Combatant,
  type CombatState,
  executeMoveCombatant,
} from '../index.js';

function makeCombatant(overrides: Partial<Combatant> = {}): Combatant {
  return {
    id: 'hero-1',
    name: 'Hero',
    side: 'party',
    size: 'medium',
    position: { x: 5, y: 12 },
    speedFeet: 30,
    currentHp: 25,
    maxHp: 25,
    tempHp: 0,
    armorClass: 15,
    dexterityScore: 14,
    dexterityModifier: 2,
    initiativeBonus: 2,
    initiativeRollMode: 'normal',
    passivePerception: 12,
    stealthModifier: 2,
    isSurprised: false,
    conditions: [],
    deathSaves: { successes: 0, failures: 0 },
    isDead: false,
    isStable: false,
    attacksPerAction: 1,
    reactionAvailable: true,
    damageResistances: [],
    damageImmunities: [],
    damageVulnerabilities: [],
    conditionImmunities: [],
    ...overrides,
  };
}

function makeCombatState(mover: Combatant): CombatState {
  return {
    encounterId: 'enc-move-repro',
    round: 1,
    phase: 'active_turn',
    initiativeOrder: [
      { entityId: mover.id, initiative: 20, naturalRoll: 10, dexterityScore: 10, tieBreaker: 0 },
    ],
    activeCombatantIndex: 0,
    activeCombatantId: mover.id,
    turnBudget: {
      action: 1,
      bonusAction: 1,
      reactionAvailable: true,
      movementRemainingFeet: 30,
      freeObjectInteraction: 1,
      bonusActionSpellCast: false,
      leveledActionSpellCast: false,
      attackActionTaken: false,
      extraAttacksRemaining: 0,
      disengaged: false,
      dodging: false,
    },
    combatants: { [mover.id]: mover },
    surprisedCombatantIds: [],
    outcome: 'in_progress',
    rngState: 42,
  };
}

describe('SRD-410 movement repro: start-inclusive path must not overcharge', () => {
  it('moves 6 straight cells (30 ft preview) on a 30 ft budget', () => {
    const hero = makeCombatant({ position: { x: 5, y: 12 } });
    const state = makeCombatState(hero);
    // Start-inclusive path as produced by findPath/truncatePathToBudget.
    const res = executeMoveCombatant(state, {
      actorId: hero.id,
      path: [
        { x: 5, y: 12 },
        { x: 5, y: 11 },
        { x: 5, y: 10 },
        { x: 5, y: 9 },
        { x: 5, y: 8 },
        { x: 5, y: 7 },
        { x: 5, y: 6 },
      ],
    });
    expect(res.state.combatants[hero.id]!.position).toEqual({ x: 5, y: 6 });
    expect(res.state.turnBudget!.movementRemainingFeet).toBe(0);
  });

  it('still accepts start-exclusive paths (existing caller convention)', () => {
    const hero = makeCombatant({ position: { x: 5, y: 12 } });
    const state = makeCombatState(hero);
    const res = executeMoveCombatant(state, {
      actorId: hero.id,
      path: [{ x: 5, y: 11 }],
    });
    expect(res.state.combatants[hero.id]!.position).toEqual({ x: 5, y: 11 });
    expect(res.state.turnBudget!.movementRemainingFeet).toBe(25);
  });
});
