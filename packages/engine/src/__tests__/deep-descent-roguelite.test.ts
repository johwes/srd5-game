import { describe, it, expect } from 'vitest';
import {
  startRogueliteRun,
  advanceRogueliteFloor,
  resolveRogueliteLongRest,
  activateShrine,
  calculateRogueliteScore,
  checkRogueliteWipe,
  endRogueliteRun,
  recordRunMonstersSlain,
  addRunSupplies,
  STARTING_ROGUELITE_RATIONS,
} from '../dungeon/roguelite.js';
import { getBiomeForDepth } from '../dungeon/generator.js';
import { resolveCombatantAttackProfile } from '../combat/attack.js';
import { type GameState } from '../state/types.js';

describe('SRD-509: The Deep Descent Roguelite Engine', () => {
  describe('1. Run Initialization & Procedural Starting Floor', () => {
    it('initializes a fresh Deep Descent run with 10 rations, Depth 1, and 4 heroes', () => {
      const session = startRogueliteRun({ seed: 42 });

      expect(session.runState.currentDepth).toBe(1);
      expect(session.runState.maxDepthReached).toBe(1);
      expect(session.runState.suppliesRemaining).toBe(STARTING_ROGUELITE_RATIONS);
      expect(session.runState.goldCollected).toBe(0);
      expect(session.runState.monstersSlain).toBe(0);
      expect(session.runState.isComplete).toBe(false);
      expect(session.runState.score).toBeGreaterThan(0);

      // Verify party is created and populated on grid
      const heroes = Object.values(session.gameState.party);
      expect(heroes.length).toBe(4);
      for (const hero of heroes) {
        expect(hero.currentHp).toBeGreaterThan(0);
        expect(hero.maxHp).toBeGreaterThan(0);
      }

      // Verify procedural floor generated
      expect(session.generatedFloor.biome).toBe('catacombs');
      expect(session.generatedFloor.depth).toBe(1);
      expect(session.gameState.grid.cells.length).toBeGreaterThan(100);
      expect(session.gameState.props.length).toBeGreaterThan(0);
    });
  });

  describe('2. Run Scoring Formula (Spec 06 Section 3.2)', () => {
    it('computes exact score according to the canonical formula', () => {
      // Formula: (Depth * 1000) + TotalXP + (Gold * 2) + (UnusedRations * 100) - (LongRests * 200) - (TurnsTaken * 2)
      const score = calculateRogueliteScore({
        depth: 3,
        totalXp: 1500,
        gold: 60,
        unusedRations: 8,
        longRests: 1,
        turnsTaken: 40,
      });

      // 3000 + 1500 + 120 + 800 - 200 - 80 = 5140
      expect(score).toBe(5140);
    });

    it('clamps negative scores to zero', () => {
      const score = calculateRogueliteScore({
        depth: 1,
        totalXp: 0,
        gold: 0,
        unusedRations: 0,
        longRests: 10,
        turnsTaken: 1000,
      });

      expect(score).toBe(0);
    });
  });

  describe('3. Biome Tiers & Depth Scaling (1–13+)', () => {
    it('maps depths to the correct canonical biome tiers', () => {
      expect(getBiomeForDepth(1)).toBe('catacombs');
      expect(getBiomeForDepth(2)).toBe('catacombs');
      expect(getBiomeForDepth(3)).toBe('catacombs');

      expect(getBiomeForDepth(4)).toBe('sunken_tombs');
      expect(getBiomeForDepth(5)).toBe('sunken_tombs');
      expect(getBiomeForDepth(6)).toBe('sunken_tombs');

      expect(getBiomeForDepth(7)).toBe('magma_caverns');
      expect(getBiomeForDepth(8)).toBe('magma_caverns');
      expect(getBiomeForDepth(9)).toBe('magma_caverns');

      expect(getBiomeForDepth(10)).toBe('deep_vaults');
      expect(getBiomeForDepth(11)).toBe('deep_vaults');
      expect(getBiomeForDepth(12)).toBe('deep_vaults');

      expect(getBiomeForDepth(13)).toBe('abyssal_rift');
      expect(getBiomeForDepth(20)).toBe('abyssal_rift');
    });

    it('advances party seamlessly across procedural floors while preserving HP and stats', () => {
      const session = startRogueliteRun({ seed: 100 });
      const hero0 = Object.values(session.gameState.party)[0]!;

      // Simulate hero taking damage
      hero0.currentHp = Math.floor(hero0.maxHp / 2);

      // Advance to Floor 2
      const floor2 = advanceRogueliteFloor(session.runState, session.gameState);

      expect(floor2.runState.currentDepth).toBe(2);
      expect(floor2.runState.maxDepthReached).toBe(2);
      expect(floor2.generatedFloor.depth).toBe(2);

      const updatedHero0 = floor2.gameState.party[hero0.id]!;
      expect(updatedHero0.currentHp).toBe(hero0.currentHp);

      // Advance to Floor 4 (Sunken Tombs)
      const floor3 = advanceRogueliteFloor(floor2.runState, floor2.gameState);
      const floor4 = advanceRogueliteFloor(floor3.runState, floor3.gameState);

      expect(floor4.runState.currentDepth).toBe(4);
      expect(floor4.generatedFloor.biome).toBe('sunken_tombs');
    });
  });

  describe('4. Supply / Exhaustion Tension during Long Rests', () => {
    it('consumes rations on satiated Long Rest and restores full HP/slots', () => {
      const session = startRogueliteRun({ seed: 777 });
      const heroes = Object.values(session.gameState.party);
      const hero = heroes[0]!;
      hero.currentHp = 5;

      // Expend a spell slot on wizard
      const wizard = Object.values(session.gameState.party).find((h) => h.spellSlots?.[1] !== undefined);
      if (wizard && wizard.spellSlots) {
        wizard.spellSlots[1].expended = 1;
        wizard.spellSlots[1].available = wizard.spellSlots[1].max - 1;
      }

      const restRes = resolveRogueliteLongRest(session.runState, session.gameState, {
        forceSafe: true,
      });

      expect(restRes.starved).toBe(false);
      // 10 starting rations - 4 for party = 6 remaining
      expect(restRes.nextRunState.suppliesRemaining).toBe(6);
      expect(restRes.nextRunState.restCount.long).toBe(1);

      // Hero regained full HP
      const restedHero = restRes.nextGameState.party[hero.id]!;
      expect(restedHero.currentHp).toBe(restedHero.maxHp);

      // Wizard regained spell slots
      if (wizard) {
        const restedWizard = restRes.nextGameState.party[wizard.id]!;
        expect(restedWizard.spellSlots?.[1].available).toBe(
          restedWizard.spellSlots?.[1].max,
        );
      }
    });

    it('inflicts 1 level of Exhaustion and prevents HP recovery when starved', () => {
      const session = startRogueliteRun({ seed: 888, startingRations: 2 });
      const hero = Object.values(session.gameState.party)[0]!;
      hero.currentHp = 6;

      const restRes = resolveRogueliteLongRest(session.runState, session.gameState, {
        forceSafe: true,
      });

      expect(restRes.starved).toBe(true);
      expect(restRes.nextRunState.suppliesRemaining).toBe(0);

      // Hero did NOT regain HP
      const starvedHero = restRes.nextGameState.party[hero.id]!;
      expect(starvedHero.currentHp).toBe(6);

      // Hero gained 1 level of Exhaustion
      expect(starvedHero.exhaustionLevel).toBe(1);
      expect(starvedHero.conditions).toContain('exhaustion');

      // Verify event emitted
      const starveEv = restRes.events.find((e) => e.type === 'ROGUELITE_STARVATION');
      expect(starveEv).toBeDefined();
    });

    it('causes lethal party wipe if exhaustion reaches level 6 through chronic starvation', () => {
      const session = startRogueliteRun({ seed: 999, startingRations: 0 });

      let currentRun = session.runState;
      let currentState = session.gameState;

      // Rest 6 times with 0 rations
      for (let i = 0; i < 6; i++) {
        const res = resolveRogueliteLongRest(currentRun, currentState, { forceSafe: true });
        currentRun = res.nextRunState;
        currentState = res.nextGameState;
      }

      // Party wipe detected
      expect(currentRun.isComplete).toBe(true);
      expect(currentRun.deathCause).toContain('Starvation');
      expect(currentRun.graveyardEntry).toBeDefined();
      expect(currentRun.graveyardEntry?.livingPartyCount).toBe(0);
    });
  });

  describe('5. Shrines of Fate (Risk & Reward)', () => {
    it('Shrine of the Blood God: reduces Max HP by 15% and grants +2 attack roll bonus', () => {
      const session = startRogueliteRun({ seed: 555 });
      const hero = Object.values(session.gameState.party)[0]!;
      const initialMaxHp = hero.maxHp;

      // Add a blood god shrine adjacent to hero
      const shrineProp = {
        id: 'test_blood_shrine',
        x: hero.position.x + 1,
        y: hero.position.y,
        kind: 'shrine' as const,
        shrineType: 'shrine_blood_god',
        state: 'closed' as const,
        blocksMovement: false,
        blocksSight: false,
      };
      session.gameState.props.push(shrineProp);

      const res = activateShrine(
        session.runState,
        session.gameState,
        shrineProp.id,
        hero.id,
      );

      const blessedHero = res.nextGameState.party[hero.id]!;
      expect(blessedHero.maxHp).toBeLessThan(initialMaxHp);
      expect(blessedHero.blessings).toContain('shrine_blood_god');
      expect(res.nextRunState.bloodGodFloorsRemaining).toBe(3);

      // Verify attack roll profile gets +2 bonus
      const attack = resolveCombatantAttackProfile(blessedHero, {});
      const unblessedHero = { ...blessedHero, blessings: [] };
      const normalAttack = resolveCombatantAttackProfile(unblessedHero, {});
      expect(attack.toHitBonus).toBe(normalAttack.toHitBonus + 2);
    });

    it('Shrine of the Arcane Weave: restores all spell slots and triggers hostile ambush', () => {
      const session = startRogueliteRun({ seed: 666 });
      const wizard = Object.values(session.gameState.party).find((h) => h.spellSlots?.[1] !== undefined)!;
      if (wizard && wizard.spellSlots) {
        wizard.spellSlots[1].expended = 2;
        wizard.spellSlots[1].available = wizard.spellSlots[1].max - 2;
      }

      const shrineProp = {
        id: 'test_arcane_shrine',
        x: wizard.position.x,
        y: wizard.position.y + 1,
        kind: 'shrine' as const,
        shrineType: 'shrine_arcane_weave',
        state: 'closed' as const,
        blocksMovement: false,
        blocksSight: false,
      };
      session.gameState.props.push(shrineProp);

      const res = activateShrine(
        session.runState,
        session.gameState,
        shrineProp.id,
        wizard.id,
      );

      // Spell slots restored
      const restoredWizard = res.nextGameState.party[wizard.id]!;
      expect(restoredWizard.spellSlots?.[1].available).toBe(
        restoredWizard.spellSlots?.[1].max,
      );

      // Ambush triggered into combat mode
      expect(res.nextGameState.mode).toBe('combat');
      expect(Object.keys(res.nextGameState.monsters).length).toBeGreaterThan(0);
    });

    it('Fountain of Restoration: cleanses all conditions, exhaustion, and restores full HP', () => {
      const session = startRogueliteRun({ seed: 333 });
      const hero = Object.values(session.gameState.party)[0]!;
      hero.currentHp = 2;
      hero.conditions = ['poisoned', 'exhaustion'];
      hero.exhaustionLevel = 2;

      const fountainProp = {
        id: 'test_fountain',
        x: hero.position.x,
        y: hero.position.y - 1,
        kind: 'shrine' as const,
        shrineType: 'fountain_restoration',
        state: 'closed' as const,
        blocksMovement: false,
        blocksSight: false,
      };
      session.gameState.props.push(fountainProp);

      const res = activateShrine(
        session.runState,
        session.gameState,
        fountainProp.id,
        hero.id,
      );

      const cleansedHero = res.nextGameState.party[hero.id]!;
      expect(cleansedHero.currentHp).toBe(cleansedHero.maxHp);
      expect(cleansedHero.exhaustionLevel).toBe(0);
      expect(cleansedHero.conditions).toHaveLength(0);
    });
  });

  describe('6. Run Completion & Graveyard Records', () => {
    it('creates a detailed graveyard record upon ending a run', () => {
      const session = startRogueliteRun({ seed: 123 });
      let run = recordRunMonstersSlain(session.runState, 12, 1800, 75);
      run = addRunSupplies(run, 4);

      const completed = endRogueliteRun(run, session.gameState, 'Fell in glorious battle on Depth 5');

      expect(completed.isComplete).toBe(true);
      expect(completed.deathCause).toBe('Fell in glorious battle on Depth 5');
      expect(completed.graveyardEntry).toBeDefined();
      expect(completed.graveyardEntry?.monstersSlain).toBe(12);
      expect(completed.graveyardEntry?.goldCollected).toBe(75);
      expect(completed.graveyardEntry?.partyNames.length).toBe(4);
      expect(completed.score).toBeGreaterThan(0);
    });
  });
});
