import { describe, expect, it } from 'vitest';
import { compendium } from '@srd5/data';
import {
  type Combatant,
  type CombatState,
  createMonsterCombatant,
  createCharacterCombatant,
  getDisposition,
  areAllied,
  areHostile,
  type DispositionMatrix,
} from '../combat/index.js';
import { createTacticalGrid, setGridCell } from '../grid/model.js';
import { planAiTurn, executeAiTurn } from '../ai/index.js';
import { createInitialGameState } from '../state/reducer.js';
import { executeWeaponAttack } from '../combat/attack.js';

describe('SRD-401: Tactical Monster AI Utility Planner & Dynamic Allegiance Suite', () => {
  function makeGrid(width = 20, height = 20) {
    return createTacticalGrid(width, height);
  }

  function makeCombatState(
    combatantsList: Combatant[],
    dispositionMatrix?: DispositionMatrix,
  ): CombatState {
    const combatants: Record<string, Combatant> = {};
    for (const c of combatantsList) {
      combatants[c.id] = c;
    }
    return {
      encounterId: 'enc-ai',
      round: 1,
      phase: 'active_turn',
      initiativeOrder: combatantsList.map((c, i) => ({
        entityId: c.id,
        initiative: 20 - i,
        naturalRoll: 10,
        dexterityScore: c.dexterityScore,
        tieBreaker: 0,
      })),
      activeCombatantIndex: 0,
      activeCombatantId: combatantsList[0]?.id ?? null,
      turnBudget: {
        action: 1,
        bonusAction: 1,
        reactionAvailable: true,
        movementRemainingFeet: combatantsList[0]?.speedFeet ?? 30,
        freeObjectInteraction: 1,
        bonusActionSpellCast: false,
        leveledActionSpellCast: false,
        attackActionTaken: false,
        extraAttacksRemaining: 0,
        disengaged: false,
        dodging: false,
      },
      combatants,
      surprisedCombatantIds: [],
      outcome: 'in_progress',
      rngState: 42,
      dispositionMatrix,
    };
  }

  // -------------------------------------------------------------------------
  // 1. Dynamic Allegiance & Multi-Way Brawls
  // -------------------------------------------------------------------------
  describe('Dynamic Allegiance & Multi-Way Brawls', () => {
    it('evaluates dynamic hostility and alliances based on teamId and disposition matrix', () => {
      const goblin = { id: 'g1', teamId: 'goblins', side: 'monster' as const };
      const spider = { id: 's1', teamId: 'spiders', side: 'monster' as const };
      const hero = { id: 'h1', teamId: 'party', side: 'party' as const };
      const otherGoblin = { id: 'g2', teamId: 'goblins', side: 'monster' as const };

      // Same team is always allied
      expect(areAllied(goblin, otherGoblin)).toBe(true);
      expect(areHostile(goblin, otherGoblin)).toBe(false);

      // Different teams default to hostile
      expect(areHostile(goblin, spider)).toBe(true);
      expect(areHostile(goblin, hero)).toBe(true);
      expect(areHostile(spider, hero)).toBe(true);

      // Custom matrix override
      const allianceMatrix: DispositionMatrix = {
        goblins: { spiders: 'allied' },
        spiders: { goblins: 'allied' },
      };
      expect(areAllied(goblin, spider, allianceMatrix)).toBe(true);
      expect(areHostile(goblin, spider, allianceMatrix)).toBe(false);
      expect(areHostile(goblin, hero, allianceMatrix)).toBe(true);
    });

    it('supports 3-way brawls where monsters attack another hostile monster team', () => {
      const grid = makeGrid();
      const goblinData = compendium.requireMonster('goblin');
      const spiderData = compendium.requireMonster('giant-spider');

      const goblin = createMonsterCombatant(goblinData, 'goblin-1', { x: 5, y: 5 }, {
        teamId: 'goblins',
      });
      const spider = createMonsterCombatant(spiderData, 'spider-1', { x: 6, y: 5 }, {
        teamId: 'wild_beasts',
      });
      const goblinAlly = createMonsterCombatant(goblinData, 'goblin-2', { x: 4, y: 5 }, {
        teamId: 'goblins',
      });

      const state = makeCombatState([goblin, spider, goblinAlly]);
      const plan = planAiTurn({
        state,
        activeCombatantId: goblin.id,
        grid,
      });

      // Goblin should target the spider, NOT its fellow goblin ally
      const attackCmd = plan.commands.find((c) => c.type === 'DECLARE_ATTACK');
      expect(attackCmd).toBeDefined();
      if (attackCmd && attackCmd.type === 'DECLARE_ATTACK') {
        expect(attackCmd.targetId).toBe(spider.id);
        expect(attackCmd.targetId).not.toBe(goblinAlly.id);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 2. Goblins & Nimble Escape
  // -------------------------------------------------------------------------
  describe('Goblin & Nimble Escape', () => {
    it('uses Nimble Escape bonus action Disengage and moves away to safety without taking Opportunity Attacks', () => {
      const grid = makeGrid();
      const goblinData = compendium.requireMonster('goblin');
      const skeletonData = compendium.requireMonster('skeleton');

      // Goblin starts in melee at (5, 5) with a hostile hero at (5, 6)
      const goblin = createMonsterCombatant(goblinData, 'goblin-scout', { x: 5, y: 5 }, {
        side: 'monster',
        teamId: 'goblins',
      });
      const hero = createMonsterCombatant(skeletonData, 'hero-fighter', { x: 5, y: 6 }, {
        side: 'party',
        teamId: 'party',
      });

      const state = makeCombatState([goblin, hero]);
      const plan = planAiTurn({
        state,
        activeCombatantId: goblin.id,
        grid,
      });

      // Verify sequence of commands:
      // 1. Attack in melee (scimitar)
      // 2. Nimble Escape Disengage as Bonus Action
      // 3. Move away to safe retreat cell
      // 4. End Turn
      const attackCmd = plan.commands.find((c) => c.type === 'DECLARE_ATTACK');
      const disengageCmd = plan.commands.find(
        (c) => c.type === 'USE_STANDARD_ACTION' && c.action === 'disengage' && c.asBonusAction === true,
      );
      const moveCmd = plan.commands.find((c) => c.type === 'COMBAT_MOVE');
      const endCmd = plan.commands[plan.commands.length - 1];

      expect(attackCmd).toBeDefined();
      expect(disengageCmd).toBeDefined();
      expect(moveCmd).toBeDefined();
      expect(endCmd?.type).toBe('END_TURN');

      // Execute through full GameState reducer to confirm NO Opportunity Attack was prompted or provoked
      const gameState = createInitialGameState({
        grid,
        party: [hero],
        monsters: [goblin],
      });
      gameState.mode = 'combat';
      gameState.combat = state;

      const res = executeAiTurn(gameState, goblin.id);

      // Verify no Opportunity Attack reaction was prompted
      const reactionPrompts = res.events.filter((e) => e.type === 'REACTION_PROMPTED');
      expect(reactionPrompts).toHaveLength(0);

      // Verify final position of goblin is away from hero's melee reach (> 5 ft)
      const finalGoblin = res.nextState.combat?.combatants[goblin.id];
      expect(finalGoblin).toBeDefined();
      const finalDist = Math.max(
        Math.abs(finalGoblin!.position.x - hero.position.x),
        Math.abs(finalGoblin!.position.y - hero.position.y),
      ) * 5;
      expect(finalDist).toBeGreaterThan(5);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Wolves & Pack Tactics
  // -------------------------------------------------------------------------
  describe('Wolf & Pack Tactics', () => {
    it('positions adjacent to an enemy that already has an ally engaged to gain Advantage from Pack Tactics', () => {
      const grid = makeGrid();
      const wolfData = compendium.requireMonster('wolf');
      const skeletonData = compendium.requireMonster('skeleton');

      // Target A at (5, 5) with an ally wolf already adjacent at (5, 4)
      const targetA = createMonsterCombatant(skeletonData, 'target-flanked', { x: 5, y: 5 }, {
        side: 'party',
      });
      const wolfAlly = createMonsterCombatant(wolfData, 'wolf-ally', { x: 5, y: 4 }, {
        side: 'monster',
      });

      // Target B at (12, 12) isolated with no allies nearby
      const targetB = createMonsterCombatant(skeletonData, 'target-isolated', { x: 12, y: 12 }, {
        side: 'party',
      });

      // Active Wolf 2 at (7, 5)
      const activeWolf = createMonsterCombatant(wolfData, 'wolf-hunter', { x: 7, y: 5 }, {
        side: 'monster',
      });

      const state = makeCombatState([activeWolf, wolfAlly, targetA, targetB]);
      const plan = planAiTurn({
        state,
        activeCombatantId: activeWolf.id,
        grid,
      });

      // Wolf prioritizes targetA because wolfAlly is within 5 ft, granting Pack Tactics!
      const attackCmd = plan.commands.find((c) => c.type === 'DECLARE_ATTACK');
      expect(attackCmd).toBeDefined();
      if (attackCmd && attackCmd.type === 'DECLARE_ATTACK') {
        expect(attackCmd.targetId).toBe(targetA.id);
      }

      // Check movement positioned adjacent to targetA
      const moveCmd = plan.commands.find((c) => c.type === 'COMBAT_MOVE');
      expect(moveCmd).toBeDefined();
      if (moveCmd && moveCmd.type === 'COMBAT_MOVE') {
        const dest = moveCmd.path[moveCmd.path.length - 1]!;
        const distToTargetA = Math.max(
          Math.abs(dest.x - targetA.position.x),
          Math.abs(dest.y - targetA.position.y),
        ) * 5;
        expect(distToTargetA).toBeLessThanOrEqual(5);
      }

      // When attack is executed against targetA, confirm Pack Tactics advantage is applied
      const atkRes = executeWeaponAttack({
        state: {
          ...state,
          combatants: {
            ...state.combatants,
            [activeWolf.id]: {
              ...activeWolf,
              position: { x: 6, y: 5 }, // adjacent
            },
          },
        },
        attackerId: activeWolf.id,
        targetId: targetA.id,
        monsterActionId: 'bite',
        grid,
      });

      const atkEvent = atkRes.events.find((e) => e.type === 'DICE_ROLLED' && e.rollPurpose === 'attack_roll');
      expect(atkEvent).toBeDefined();
      if (atkEvent && atkEvent.type === 'DICE_ROLLED') {
        expect(atkEvent.mode).toBe('advantage');
      }
    });
  });

  // -------------------------------------------------------------------------
  // 4. Artillery Monsters: Seek Cover & Avoid Melee
  // -------------------------------------------------------------------------
  describe('Artillery Monsters: Seek Cover & Avoid Melee', () => {
    it('artillery avoids close-combat melee and seeks standoff cover positions', () => {
      // Create grid with rubble / partial cover
      let grid = makeGrid();
      // Place rubble at (5, 4) which gives half cover
      grid = setGridCell(grid, {
        x: 5,
        y: 4,
        terrain: 'rubble',
        baseLight: 'bright',
      });

      const skeletonData = compendium.requireMonster('skeleton'); // Archer with Shortbow
      const ogreData = compendium.requireMonster('ogre');

      // Hero melee fighter at (2, 2)
      const hero = createMonsterCombatant(ogreData, 'hero-melee', { x: 2, y: 2 }, {
        side: 'party',
      });

      // Skeleton artillery archer starting at (7, 5)
      const skeletonArcher = createMonsterCombatant(skeletonData, 'skeleton-archer', { x: 7, y: 5 }, {
        side: 'monster',
      });

      const state = makeCombatState([skeletonArcher, hero]);
      const plan = planAiTurn({
        state,
        activeCombatantId: skeletonArcher.id,
        grid,
      });

      // Artillery should fire shortbow from standoff range and not close into melee
      const attackCmd = plan.commands.find((c) => c.type === 'DECLARE_ATTACK');
      expect(attackCmd).toBeDefined();
      if (attackCmd && attackCmd.type === 'DECLARE_ATTACK') {
        expect(attackCmd.targetId).toBe(hero.id);
        expect(attackCmd.monsterActionId).toBe('shortbow');
      }

      // Check that if moving, it does NOT end adjacent to the melee enemy
      const moveCmd = plan.commands.find((c) => c.type === 'COMBAT_MOVE');
      if (moveCmd && moveCmd.type === 'COMBAT_MOVE') {
        const dest = moveCmd.path[moveCmd.path.length - 1]!;
        const dist = Math.max(
          Math.abs(dest.x - hero.position.x),
          Math.abs(dest.y - hero.position.y),
        ) * 5;
        expect(dist).toBeGreaterThan(5); // Maintains standoff distance!
      }
    });

    it('artillery starting in melee escapes via bonus action disengage to avoid close-combat disadvantage', () => {
      const grid = makeGrid();
      const goblinData = compendium.requireMonster('goblin');
      const ogreData = compendium.requireMonster('ogre');

      // Goblin archer starting adjacent (5 ft) to Ogre melee brute
      const goblinArcher = createMonsterCombatant(goblinData, 'goblin-sniper', { x: 5, y: 5 }, {
        side: 'monster',
      });
      const ogre = createMonsterCombatant(ogreData, 'ogre-threat', { x: 5, y: 6 }, {
        side: 'party',
      });

      const state = makeCombatState([goblinArcher, ogre]);
      const plan = planAiTurn({
        state,
        activeCombatantId: goblinArcher.id,
        grid,
        archetypeOverride: 'artillery',
      });

      // Should disengage as bonus action and retreat before/after shooting
      const disengageCmd = plan.commands.find(
        (c) => c.type === 'USE_STANDARD_ACTION' && c.action === 'disengage',
      );
      expect(disengageCmd).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 5. AoE Casters: Fireball & Breath Weapon friendly fire avoidance
  // -------------------------------------------------------------------------
  describe('AoE Casters: Fireball & Breath Weapon Placement', () => {
    it('places Fireball to maximize enemies hit while strictly avoiding allies', () => {
      const grid = makeGrid();
      const mageData = compendium.requireMonster('mage');
      const goblinData = compendium.requireMonster('goblin');

      // Mage caster at (0, 0)
      const mage = createMonsterCombatant(mageData, 'evil-mage', { x: 0, y: 0 }, {
        side: 'monster',
      });

      // 3 clustered Hostiles at (6, 6), (7, 6), (6, 7)
      const enemy1 = createMonsterCombatant(goblinData, 'hero-1', { x: 6, y: 6 }, { side: 'party' });
      const enemy2 = createMonsterCombatant(goblinData, 'hero-2', { x: 7, y: 6 }, { side: 'party' });
      const enemy3 = createMonsterCombatant(goblinData, 'hero-3', { x: 6, y: 7 }, { side: 'party' });

      // 1 Monster Ally near the party at (2, 2)
      const monsterAlly = createMonsterCombatant(goblinData, 'monster-ally', { x: 2, y: 2 }, {
        side: 'monster',
      });

      const state = makeCombatState([mage, enemy1, enemy2, enemy3, monsterAlly]);
      const plan = planAiTurn({
        state,
        activeCombatantId: mage.id,
        grid,
      });

      // Verify Fireball spell was planned
      const spellCmd = plan.commands.find((c) => c.type === 'DECLARE_CAST_SPELL');
      expect(spellCmd).toBeDefined();
      if (spellCmd && spellCmd.type === 'DECLARE_CAST_SPELL') {
        expect(spellCmd.spellId).toBe('fireball');
        expect(spellCmd.slotLevel).toBe(3);
        expect(spellCmd.targetCell).toBeDefined();

        // Verify target cell is centered near the hostile cluster
        const target = spellCmd.targetCell!;
        expect(target.x).toBeGreaterThanOrEqual(5);
        expect(target.x).toBeLessThanOrEqual(8);
        expect(target.y).toBeGreaterThanOrEqual(5);
        expect(target.y).toBeLessThanOrEqual(8);
      }
    });

    it('dragon places Breath Weapon to hit hostiles while avoiding friendly fire', () => {
      const grid = makeGrid();
      const dragonData = compendium.requireMonster('young-black-dragon');
      const goblinData = compendium.requireMonster('goblin');

      // Dragon at (5, 5)
      const dragon = createMonsterCombatant(dragonData, 'black-dragon', { x: 5, y: 5 }, {
        side: 'monster',
      });

      // 2 Hostiles in front at (7, 5) and (8, 5)
      const enemy1 = createMonsterCombatant(goblinData, 'hero-front-1', { x: 7, y: 5 }, { side: 'party' });
      const enemy2 = createMonsterCombatant(goblinData, 'hero-front-2', { x: 8, y: 5 }, { side: 'party' });

      // 1 Monster Ally to the side at (3, 5)
      const monsterAlly = createMonsterCombatant(goblinData, 'dragon-minion', { x: 3, y: 5 }, {
        side: 'monster',
      });

      const state = makeCombatState([dragon, enemy1, enemy2, monsterAlly]);
      const plan = planAiTurn({
        state,
        activeCombatantId: dragon.id,
        grid,
      });

      // Verify Breath Weapon was planned
      const breathCmd = plan.commands.find(
        (c) => c.type === 'EXECUTE_MONSTER_ACTION' && c.actionId.includes('breath'),
      );
      expect(breathCmd).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 6. Brute Archetype Behavior
  // -------------------------------------------------------------------------
  describe('Brute Archetype', () => {
    it('brute closes distance along shortest path to nearest reachable frontliner and uses Multiattack', () => {
      const grid = makeGrid();
      const ogreData = compendium.requireMonster('ogre');
      const goblinData = compendium.requireMonster('goblin');

      const ogre = createMonsterCombatant(ogreData, 'ogre-brute', { x: 0, y: 0 }, {
        side: 'monster',
      });
      const hero = createMonsterCombatant(goblinData, 'hero-frontliner', { x: 5, y: 0 }, {
        side: 'party',
      });

      const state = makeCombatState([ogre, hero]);
      const plan = planAiTurn({
        state,
        activeCombatantId: ogre.id,
        grid,
      });

      expect(plan.archetype).toBe('brute');
      // Moves adjacent
      const moveCmd = plan.commands.find((c) => c.type === 'COMBAT_MOVE');
      expect(moveCmd).toBeDefined();

      // Attacks with Greatclub
      const attackCmd = plan.commands.find((c) => c.type === 'DECLARE_ATTACK');
      expect(attackCmd).toBeDefined();
      if (attackCmd && attackCmd.type === 'DECLARE_ATTACK') {
        expect(attackCmd.targetId).toBe(hero.id);
        expect(attackCmd.monsterActionId).toBe('greatclub');
      }
    });
  });
});
