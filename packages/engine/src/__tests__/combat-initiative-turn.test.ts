import { describe, expect, it } from 'vitest';
import {
  compendium,
  requirePregenCharacter,
} from '@srd5/data';
import { computeDerivedCharacter } from '../character/derived.js';
import {
  applyActionSurge,
  applyDash,
  applyDisengage,
  applyDodge,
  applyStandUp,
  canCastSpell,
  compareInitiativeEntries,
  createCharacterCombatant,
  createMonsterCombatant,
  createTurnBudget,
  determineSurprise,
  endTurn,
  executeActionSurge,
  executeDash,
  executeDisengage,
  executeDodge,
  findNextActiveCombatantIndex,
  isCombatantEligibleForTurn,
  recordSpellCast,
  rollInitiativeForCombatants,
  spendAction,
  spendBonusAction,
  spendMovement,
  spendReaction,
  startCombatEncounter,
  startTurn,
  type Combatant,
  type InitiativeEntry,
} from '../combat/index.js';

describe('SRD-304: Initiative Tracker & Tiebreaking', () => {
  it('correctly compares initiative entries using SRD 5.1 tiebreaker rules', () => {
    const higherRoll: InitiativeEntry = {
      entityId: 'a',
      initiative: 18,
      naturalRoll: 16,
      dexterityScore: 14,
      tieBreaker: 10,
    };
    const lowerRoll: InitiativeEntry = {
      entityId: 'b',
      initiative: 15,
      naturalRoll: 13,
      dexterityScore: 14,
      tieBreaker: 10,
    };
    expect(compareInitiativeEntries(higherRoll, lowerRoll)).toBeLessThan(0);
    expect(compareInitiativeEntries(lowerRoll, higherRoll)).toBeGreaterThan(0);

    // Tie on roll, broken by DEX score
    const tiedRollHigherDex: InitiativeEntry = {
      entityId: 'c',
      initiative: 15,
      naturalRoll: 13,
      dexterityScore: 16,
      tieBreaker: 5,
    };
    expect(compareInitiativeEntries(tiedRollHigherDex, lowerRoll)).toBeLessThan(0);

    // Tie on roll and DEX, broken by secondary tiebreaker roll
    const tiedRollSameDexHigherTie: InitiativeEntry = {
      entityId: 'd',
      initiative: 15,
      naturalRoll: 13,
      dexterityScore: 14,
      tieBreaker: 15,
    };
    expect(compareInitiativeEntries(tiedRollSameDexHigherTie, lowerRoll)).toBeLessThan(0);
  });

  it('rolls initiative deterministically with PRNG and applies modifiers', () => {
    const fighterSheet = computeDerivedCharacter(requirePregenCharacter('pregen-fighter'), compendium);
    const goblinData = compendium.requireMonster('goblin');

    const fighter = createCharacterCombatant(fighterSheet, { x: 0, y: 0 });
    const goblin = createMonsterCombatant(goblinData, 'goblin-1', { x: 2, y: 2 });

    const seed = 12345;
    const res1 = rollInitiativeForCombatants([fighter, goblin], seed);
    const res2 = rollInitiativeForCombatants([fighter, goblin], seed);

    expect(res1.entries.length).toBe(2);
    expect(res1.entries).toEqual(res2.entries);
    expect(res1.nextRngState).toBe(res2.nextRngState);

    // DICE_ROLLED events recorded
    expect(res1.events.filter((e) => e.type === 'DICE_ROLLED').length).toBe(2);
  });

  it('skips dead combatants when finding the next eligible turn', () => {
    const fighterSheet = computeDerivedCharacter(requirePregenCharacter('pregen-fighter'), compendium);
    const goblinData = compendium.requireMonster('goblin');

    const hero1 = createCharacterCombatant(fighterSheet, { x: 0, y: 0 });
    const hero2 = createCharacterCombatant(
      {
        ...fighterSheet,
        id: 'h2',
        deathSaves: { successes: 0, failures: 3 },
      },
      { x: 1, y: 0 },
    );
    const monster1 = createMonsterCombatant(goblinData, 'm1', { x: 2, y: 0 });
    monster1.currentHp = 0; // dead monster

    const combatants = { [hero1.id]: hero1, [hero2.id]: hero2, [monster1.id]: monster1 };
    const order: InitiativeEntry[] = [
      { entityId: hero1.id, initiative: 20, naturalRoll: 18, dexterityScore: 14, tieBreaker: 1 },
      { entityId: 'h2', initiative: 15, naturalRoll: 13, dexterityScore: 14, tieBreaker: 1 },
      { entityId: 'm1', initiative: 10, naturalRoll: 8, dexterityScore: 14, tieBreaker: 1 },
    ];

    expect(isCombatantEligibleForTurn(hero1)).toBe(true);
    expect(isCombatantEligibleForTurn(hero2)).toBe(false); // 3 death fails
    expect(isCombatantEligibleForTurn(monster1)).toBe(false); // 0 HP monster

    // After hero 1 finishes turn (index 0), it should skip h2 and m1 and wrap back to hero 1
    const next = findNextActiveCombatantIndex(order, combatants, 0);
    expect(next).toEqual({ nextIndex: 0, wrapped: true });
  });
});

describe('SRD-304: Surprise Round Handling', () => {
  it('surprises monsters when party stealth exceeds monster passive perception', () => {
    const rogueSheet = computeDerivedCharacter(requirePregenCharacter('pregen-rogue'), compendium);
    const goblinData = compendium.requireMonster('goblin');

    const rogue = createCharacterCombatant(rogueSheet, { x: 0, y: 0 });
    const goblin = createMonsterCombatant(goblinData, 'goblin-1', { x: 5, y: 5 });

    const res = determineSurprise({
      combatants: [rogue, goblin],
      rngState: 42,
      partyStealth: {
        partyInStealth: true,
        partyStealthRolls: { [rogue.id]: 18 }, // Rogue rolled 18 vs Goblin's passive 9
      },
    });

    expect(res.surprisedEntityIds).toContain('goblin-1');
    expect(res.surprisedEntityIds).not.toContain(rogue.id);
  });

  it('does not surprise monster if any party member fails the stealth check', () => {
    const fighterSheet = computeDerivedCharacter(requirePregenCharacter('pregen-fighter'), compendium);
    const goblinData = compendium.requireMonster('goblin');

    const fighter = createCharacterCombatant(fighterSheet, { x: 0, y: 0 });
    const goblin = createMonsterCombatant(goblinData, 'goblin-1', { x: 5, y: 5 });

    const res = determineSurprise({
      combatants: [fighter, goblin],
      rngState: 42,
      partyStealth: {
        partyInStealth: true,
        partyStealthRolls: { [fighter.id]: 7 }, // 7 is lower than goblin passive perception 9
      },
    });

    expect(res.surprisedEntityIds).not.toContain('goblin-1');
  });

  it('surprises party members when monsters ambush with high stealth DC', () => {
    const fighterSheet = computeDerivedCharacter(requirePregenCharacter('pregen-fighter'), compendium);
    const clericSheet = computeDerivedCharacter(requirePregenCharacter('pregen-cleric'), compendium);
    const goblinData = compendium.requireMonster('goblin');

    const fighter = createCharacterCombatant(fighterSheet, { x: 0, y: 0 });
    const cleric = createCharacterCombatant(clericSheet, { x: 1, y: 0 });
    const goblin = createMonsterCombatant(goblinData, 'goblin-1', { x: 5, y: 5 });

    // Set Cleric passive to 15 and Fighter to 11
    fighter.passivePerception = 11;
    cleric.passivePerception = 15;

    const res = determineSurprise({
      combatants: [fighter, cleric, goblin],
      rngState: 100,
      monsterAmbush: {
        monstersAmbushing: true,
        monsterStealthDc: 14,
      },
    });

    // Fighter (PP 11 < 14) is surprised; Cleric (PP 15 >= 14) is not surprised!
    expect(res.surprisedEntityIds).toContain(fighter.id);
    expect(res.surprisedEntityIds).not.toContain(cleric.id);
  });

  it('clears surprise at the end of the surprised creature’s first turn', () => {
    const fighterSheet = computeDerivedCharacter(requirePregenCharacter('pregen-fighter'), compendium);
    const goblinData = compendium.requireMonster('goblin');

    const fighter = createCharacterCombatant(fighterSheet, { x: 0, y: 0 });
    const goblin = createMonsterCombatant(goblinData, 'goblin-1', { x: 5, y: 5 });

    const startRes = startCombatEncounter({
      encounterId: 'test-encounter',
      combatants: [fighter, goblin],
      rngState: 999,
      explicitSurprisedEntityIds: [fighter.id],
    });

    let state = startRes.state;
    expect(state.combatants[fighter.id]?.isSurprised).toBe(true);

    if (state.activeCombatantId === fighter.id) {
      expect(state.turnBudget?.action).toBe(0);
      expect(state.turnBudget?.bonusAction).toBe(0);
      expect(state.turnBudget?.movementRemainingFeet).toBe(0);
      expect(state.turnBudget?.reactionAvailable).toBe(false);

      const endRes = endTurn(state);
      expect(endRes.state.combatants[fighter.id]?.isSurprised).toBe(false);
      expect(endRes.events.some((e) => e.type === 'SURPRISE_ENDED' && e.entityId === fighter.id)).toBe(
        true,
      );
    }
  });
});

describe('SRD-304: Turn Budget State Machine', () => {
  it('creates full turn budget for a normal active combatant', () => {
    const fighterSheet = computeDerivedCharacter(requirePregenCharacter('pregen-fighter'), compendium);
    const fighter = createCharacterCombatant(fighterSheet, { x: 0, y: 0 });
    const budget = createTurnBudget(fighter);

    expect(budget.action).toBe(1);
    expect(budget.bonusAction).toBe(1);
    expect(budget.reactionAvailable).toBe(true);
    expect(budget.movementRemainingFeet).toBe(30);
    expect(budget.freeObjectInteraction).toBe(1);
    expect(budget.bonusActionSpellCast).toBe(false);
    expect(budget.disengaged).toBe(false);
    expect(budget.dodging).toBe(false);
  });

  it('restricts actions and movement when incapacitated or immobilized', () => {
    const fighterSheet = computeDerivedCharacter(requirePregenCharacter('pregen-fighter'), compendium);
    const fighter = createCharacterCombatant(fighterSheet, { x: 0, y: 0 });
    fighter.conditions = ['paralyzed'];
    const paralyzedBudget = createTurnBudget(fighter);

    expect(paralyzedBudget.action).toBe(0);
    expect(paralyzedBudget.bonusAction).toBe(0);
    expect(paralyzedBudget.reactionAvailable).toBe(false);
    expect(paralyzedBudget.movementRemainingFeet).toBe(0);

    // Grappled: speed is 0, but actions are intact
    fighter.conditions = ['grappled'];
    const grappledBudget = createTurnBudget(fighter);
    expect(grappledBudget.movementRemainingFeet).toBe(0);
    expect(grappledBudget.action).toBe(1);
    expect(grappledBudget.bonusAction).toBe(1);
    expect(grappledBudget.reactionAvailable).toBe(true);
  });

  it('correctly spends budget and rejects over-spending', () => {
    const fighterSheet = computeDerivedCharacter(requirePregenCharacter('pregen-fighter'), compendium);
    const fighter = createCharacterCombatant(fighterSheet, { x: 0, y: 0 });
    let budget = createTurnBudget(fighter);

    budget = spendAction(budget);
    expect(budget.action).toBe(0);
    expect(() => spendAction(budget)).toThrowError(/No actions remaining/);

    budget = spendBonusAction(budget);
    expect(budget.bonusAction).toBe(0);
    expect(() => spendBonusAction(budget)).toThrowError(/No bonus actions remaining/);

    budget = spendReaction(budget);
    expect(budget.reactionAvailable).toBe(false);
    expect(() => spendReaction(budget)).toThrowError(/already spent/);

    budget = spendMovement(budget, 20);
    expect(budget.movementRemainingFeet).toBe(10);
    expect(() => spendMovement(budget, 15)).toThrowError(/Not enough movement remaining/);
  });

  it('handles Fighter Action Surge, Dash, Disengage, and Dodge', () => {
    const fighterSheet = computeDerivedCharacter(requirePregenCharacter('pregen-fighter'), compendium);
    const fighter = createCharacterCombatant(fighterSheet, { x: 0, y: 0 });
    let budget = createTurnBudget(fighter);

    // Action Surge
    budget = applyActionSurge(budget);
    expect(budget.action).toBe(2);

    // Dash as Action
    budget = applyDash(budget, 30);
    expect(budget.action).toBe(1);
    expect(budget.movementRemainingFeet).toBe(60);

    // Disengage as Bonus Action (e.g. Rogue Cunning Action)
    budget = applyDisengage(budget, true);
    expect(budget.bonusAction).toBe(0);
    expect(budget.disengaged).toBe(true);

    // Dodge as Action
    budget = applyDodge(budget);
    expect(budget.action).toBe(0);
    expect(budget.dodging).toBe(true);
  });

  it('handles standing up from prone with half movement cost', () => {
    const fighterSheet = computeDerivedCharacter(requirePregenCharacter('pregen-fighter'), compendium);
    const fighter = createCharacterCombatant(fighterSheet, { x: 0, y: 0 });
    let budget = createTurnBudget(fighter);

    // Speed 30: standing up costs 15 ft
    budget = applyStandUp(budget, 30);
    expect(budget.movementRemainingFeet).toBe(15);

    // Another stand up should fail because 15 remaining < 15 cost
    budget = spendMovement(budget, 5); // remaining 10
    expect(() => applyStandUp(budget, 30)).toThrowError(/requires 15 ft of movement/);
  });

  it('enforces SRD 5.1 Bonus Action Spellcasting restrictions', () => {
    const wizardSheet = computeDerivedCharacter(requirePregenCharacter('pregen-wizard'), compendium);
    const wizard = createCharacterCombatant(wizardSheet, { x: 0, y: 0 });
    let budget = createTurnBudget(wizard);

    // Casting a bonus action spell (e.g. Misty Step)
    budget = recordSpellCast(budget, 'bonus_action', false);
    expect(budget.bonusAction).toBe(0);
    expect(budget.bonusActionSpellCast).toBe(true);

    // Cannot cast a leveled 1-action spell after bonus action spell
    const leveledActionCheck = canCastSpell(budget, 'action', false);
    expect(leveledActionCheck.allowed).toBe(false);
    expect(leveledActionCheck.reason).toContain('Bonus Action Rule');

    // CAN cast a 1-action cantrip (e.g. Fire Bolt)
    const cantripActionCheck = canCastSpell(budget, 'action', true);
    expect(cantripActionCheck.allowed).toBe(true);

    // Cannot cast another bonus action spell
    const bonusCheck = canCastSpell(budget, 'bonus_action', true);
    expect(bonusCheck.allowed).toBe(false);

    // Reverse scenario: if a leveled 1-action spell is cast first, bonus action spells are disallowed
    let freshBudget = createTurnBudget(wizard);
    freshBudget = recordSpellCast(freshBudget, 'action', false); // e.g. Fireball
    expect(freshBudget.leveledActionSpellCast).toBe(true);

    const postActionBonusCheck = canCastSpell(freshBudget, 'bonus_action', false);
    expect(postActionBonusCheck.allowed).toBe(false);
    expect(postActionBonusCheck.reason).toContain('Cannot cast a bonus action spell');
  });
});

describe('SRD-304: Combat State Machine & Encounter Lifecycle', () => {
  it('executes full round progression, death saves, and encounter victory', () => {
    const fighterSheet = computeDerivedCharacter(requirePregenCharacter('pregen-fighter'), compendium);
    const goblinData = compendium.requireMonster('goblin');

    const hero1 = createCharacterCombatant(fighterSheet, { x: 0, y: 0 });
    const goblin1 = createMonsterCombatant(goblinData, 'gob-1', { x: 4, y: 4 });

    const initRes = startCombatEncounter({
      encounterId: 'test-run-1',
      combatants: [hero1, goblin1],
      rngState: 777,
    });

    let state = initRes.state;
    expect(state.phase).toBe('active_turn');
    expect(state.round).toBe(1);
    expect(initRes.events.some((e) => e.type === 'COMBAT_STARTED')).toBe(true);
    expect(initRes.events.some((e) => e.type === 'ROUND_STARTED' && e.round === 1)).toBe(true);

    // Execute Dash and Disengage on active hero turn
    if (state.activeCombatantId === hero1.id) {
      const dashRes = executeDash(state, hero1.id);
      state = dashRes.state;
      expect(state.turnBudget?.movementRemainingFeet).toBe(60);

      const disengageRes = executeDisengage(state, hero1.id, true);
      state = disengageRes.state;
      expect(state.turnBudget?.disengaged).toBe(true);

      const surgeRes = executeActionSurge(state, hero1.id);
      state = surgeRes.state;
      expect(state.turnBudget?.action).toBe(1);

      const dodgeRes = executeDodge(state, hero1.id);
      state = dodgeRes.state;
      expect(state.turnBudget?.dodging).toBe(true);
    }

    // End turn 1
    const endTurn1 = endTurn(state);
    state = endTurn1.state;

    // After both finish round 1, round 2 begins
    const endTurn2 = endTurn(state);
    state = endTurn2.state;
    expect(state.round).toBe(2);
    expect(endTurn2.events.some((e) => e.type === 'ROUND_STARTED' && e.round === 2)).toBe(true);

    // Defeat the goblin: set HP to 0 and end turn -> party victory!
    state.combatants['gob-1']!.currentHp = 0;
    const victoryRes = endTurn(state);
    expect(victoryRes.state.phase).toBe('combat_ended');
    expect(victoryRes.state.outcome).toBe('party_victory');
    expect(victoryRes.events.some((e) => e.type === 'ENCOUNTER_VICTORY')).toBe(true);
  });

  it('handles start-of-turn Death Saving Throw mechanics', () => {
    const fighterSheet = computeDerivedCharacter(requirePregenCharacter('pregen-fighter'), compendium);
    const goblinData = compendium.requireMonster('goblin');

    const dyingHero = createCharacterCombatant(
      {
        ...fighterSheet,
        id: 'dying-hero',
        currentHp: 0,
        activeConditions: [{ conditionId: 'unconscious', sourceId: '0_hp' }],
      },
      { x: 0, y: 0 },
    );
    const goblin = createMonsterCombatant(goblinData, 'gob-1', { x: 5, y: 5 });

    const combatants = {
      [dyingHero.id]: dyingHero,
      [goblin.id]: goblin,
    };

    const state = {
      encounterId: 'enc-death-saves',
      round: 1,
      phase: 'active_turn' as const,
      initiativeOrder: [
        { entityId: dyingHero.id, initiative: 20, naturalRoll: 18, dexterityScore: 14, tieBreaker: 1 },
        { entityId: goblin.id, initiative: 10, naturalRoll: 8, dexterityScore: 14, tieBreaker: 1 },
      ],
      activeCombatantIndex: 0,
      activeCombatantId: dyingHero.id,
      turnBudget: null,
      combatants,
      surprisedCombatantIds: [],
      outcome: 'in_progress' as const,
      rngState: 42,
    };

    // Calling startTurn on a 0-HP hero triggers a Death Save
    const res = startTurn(state, dyingHero.id);
    expect(res.events.some((e) => e.type === 'DEATH_SAVE_ROLLED')).toBe(true);
    const deathSaveEvent = res.events.find((e) => e.type === 'DEATH_SAVE_ROLLED');
    expect(deathSaveEvent).toBeDefined();

    // Verify death save outcome structure
    const updatedHero = res.state.combatants[dyingHero.id]!;
    expect(
      updatedHero.deathSaves.successes + updatedHero.deathSaves.failures,
    ).toBeGreaterThanOrEqual(1);
  });
});
