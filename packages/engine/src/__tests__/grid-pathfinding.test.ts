import { describe, expect, it } from 'vitest';
import {
  CELL_SIZE_FEET,
  CREATURE_FOOTPRINT_CELLS,
  CREATURE_SPACE_FEET,
  type GridCreature,
   canEndMoveAt,
  canStandUpFromProne,
  canTraverseCreatureSpace,
  createTacticalGrid,
  detectPathOpportunityAttacks,
  doFootprintsOverlap,
  doesFootprintContainCell,
  findPath,
  getCreatureFootprintWidth,
  getCreatureSizeDifference,
  getCreatureSpaceFeet,
  getFootprintCells,
  getFootprintDistanceCells,
  getFootprintDistanceFeet,
  getGridCell,
  getReachableCells,
  getStandUpCostFeet,
  isCellDifficultTerrain,
  isCellPassable,
  isFootprintInBounds,
  isWithinGridBounds,
  isWithinMeleeReach,
  setGridCell,
  setGridCells,
} from '../index.js';

describe('SRD-301: 5-ft Grid Model, Creature Footprints, and A* Pathfinding', () => {
  describe('5-ft Grid Model & Terrain Helpers', () => {
    it('creates a rectangular grid with 5-ft cells and supports immutable cell updates', () => {
      expect(CELL_SIZE_FEET).toBe(5);
      const grid = createTacticalGrid(6, 4);
      expect(grid.width).toBe(6);
      expect(grid.height).toBe(4);
      expect(grid.cells).toHaveLength(24);

      expect(isWithinGridBounds(grid, 0, 0)).toBe(true);
      expect(isWithinGridBounds(grid, 5, 3)).toBe(true);
      expect(isWithinGridBounds(grid, 6, 0)).toBe(false);
      expect(isWithinGridBounds(grid, -1, 0)).toBe(false);

      const updated = setGridCell(grid, {
        x: 2,
        y: 1,
        terrain: 'rubble',
        baseLight: 'dim',
      });
      expect(getGridCell(grid, 2, 1)?.terrain).toBe('floor_stone');
      expect(getGridCell(updated, 2, 1)?.terrain).toBe('rubble');
      expect(getGridCell(updated, 2, 1)?.baseLight).toBe('dim');
    });

    it('correctly classifies passable terrain and difficult terrain across movement modes', () => {
      const grid = setGridCells(createTacticalGrid(5, 5), [
        { x: 1, y: 0, terrain: 'wall_solid' },
        { x: 2, y: 0, terrain: 'chasm' },
        { x: 3, y: 0, terrain: 'water_shallow' },
        { x: 4, y: 0, terrain: 'rubble' },
        { x: 0, y: 1, terrain: 'water_deep' },
        { x: 1, y: 1, terrain: 'floor_stone', blocksMovement: true },
        { x: 2, y: 1, terrain: 'floor_stone', difficultTerrain: true },
      ]);

      expect(isCellPassable(getGridCell(grid, 0, 0)!)).toBe(true);
      expect(isCellPassable(getGridCell(grid, 1, 0)!)).toBe(false);
      expect(isCellPassable(getGridCell(grid, 2, 0)!, 'walk')).toBe(false);
      expect(isCellPassable(getGridCell(grid, 2, 0)!, 'fly')).toBe(true);
      expect(isCellPassable(getGridCell(grid, 1, 1)!)).toBe(false);

      expect(isCellDifficultTerrain(getGridCell(grid, 0, 0)!)).toBe(false);
      expect(isCellDifficultTerrain(getGridCell(grid, 3, 0)!)).toBe(true);
      expect(isCellDifficultTerrain(getGridCell(grid, 4, 0)!)).toBe(true);
      expect(isCellDifficultTerrain(getGridCell(grid, 4, 0)!, 'fly')).toBe(false);
      expect(isCellDifficultTerrain(getGridCell(grid, 0, 1)!, 'walk')).toBe(true);
      expect(isCellDifficultTerrain(getGridCell(grid, 0, 1)!, 'swim')).toBe(false);
      expect(isCellDifficultTerrain(getGridCell(grid, 2, 1)!, 'fly')).toBe(true);
    });
  });

  describe('Creature Footprints (1x1..4x4) & Grid Distances', () => {
    it('maps all 6 SRD creature sizes to exact footprint dimensions and controlled space', () => {
      expect(CREATURE_FOOTPRINT_CELLS).toEqual({
        tiny: 1,
        small: 1,
        medium: 1,
        large: 2,
        huge: 3,
        gargantuan: 4,
      });
      expect(CREATURE_SPACE_FEET).toEqual({
        tiny: 2.5,
        small: 5,
        medium: 5,
        large: 10,
        huge: 15,
        gargantuan: 20,
      });

      expect(getCreatureFootprintWidth('medium')).toBe(1);
      expect(getCreatureFootprintWidth('large')).toBe(2);
      expect(getCreatureFootprintWidth('huge')).toBe(3);
      expect(getCreatureFootprintWidth('gargantuan')).toBe(4);
      expect(getCreatureSpaceFeet('tiny')).toBe(2.5);
      expect(getCreatureSpaceFeet('gargantuan')).toBe(20);
      expect(getCreatureSizeDifference('small', 'large')).toBe(2);
      expect(getCreatureSizeDifference('medium', 'large')).toBe(1);
    });

    it('expands footprints from top-left anchor and checks overlaps and bounds', () => {
      const largeCells = getFootprintCells({ x: 2, y: 3 }, 'large');
      expect(largeCells).toEqual([
        { x: 2, y: 3 },
        { x: 3, y: 3 },
        { x: 2, y: 4 },
        { x: 3, y: 4 },
      ]);

      const gargantuanCells = getFootprintCells({ x: 0, y: 0 }, 'gargantuan');
      expect(gargantuanCells).toHaveLength(16);
      expect(doesFootprintContainCell({ x: 0, y: 0 }, 'gargantuan', { x: 3, y: 3 })).toBe(true);
      expect(doesFootprintContainCell({ x: 0, y: 0 }, 'gargantuan', { x: 4, y: 3 })).toBe(false);

      expect(doFootprintsOverlap({ x: 1, y: 1 }, 'large', { x: 2, y: 2 }, 'medium')).toBe(true);
      expect(doFootprintsOverlap({ x: 1, y: 1 }, 'large', { x: 3, y: 2 }, 'medium')).toBe(false);

      const grid = createTacticalGrid(5, 5);
      expect(isFootprintInBounds(grid, { x: 3, y: 3 }, 'large')).toBe(true);
      expect(isFootprintInBounds(grid, { x: 4, y: 3 }, 'large')).toBe(false);
    });

    it('computes minimum Chebyshev distance and melee reach between multi-cell footprints', () => {
      // Large creature at (1, 1) occupies (1..2, 1..2). Medium creature at (3, 2) is 1 cell (5 ft) away.
      expect(getFootprintDistanceCells({ x: 1, y: 1 }, 'large', { x: 3, y: 2 }, 'medium')).toBe(1);
      expect(getFootprintDistanceFeet({ x: 1, y: 1 }, 'large', { x: 3, y: 2 }, 'medium')).toBe(5);
      expect(isWithinMeleeReach({ x: 1, y: 1 }, 'large', { x: 3, y: 2 }, 'medium', 5)).toBe(true);

      // Medium creature at (4, 2) is 2 cells (10 ft) away: out of 5-ft reach, within 10-ft reach.
      expect(getFootprintDistanceFeet({ x: 1, y: 1 }, 'large', { x: 4, y: 2 }, 'medium')).toBe(10);
      expect(isWithinMeleeReach({ x: 1, y: 1 }, 'large', { x: 4, y: 2 }, 'medium', 5)).toBe(false);
      expect(isWithinMeleeReach({ x: 1, y: 1 }, 'large', { x: 4, y: 2 }, 'medium', 10)).toBe(true);
    });
  });

  describe('A* Pathfinding: Standard vs Alternating Metric & Difficult Terrain', () => {
    it('computes 5-ft orthogonal and diagonal costs under standard 5e metric and 5-10-5 under alternating metric', () => {
      const grid = createTacticalGrid(8, 8);
      const mover: GridCreature = { id: 'hero', x: 0, y: 0, size: 'medium', faction: 'party' };

      // 4 diagonal steps from (0,0) to (4,4)
      const standardRes = findPath({
        grid,
        mover,
        goal: { x: 4, y: 4 },
        diagonalMetric: 'standard',
      });
      expect(standardRes.found).toBe(true);
      expect(standardRes.totalCostFeet).toBe(20); // 4 * 5 ft

      const altRes = findPath({
        grid,
        mover,
        goal: { x: 4, y: 4 },
        diagonalMetric: 'alternating',
      });
      expect(altRes.found).toBe(true);
      expect(altRes.totalCostFeet).toBe(30); // 5 + 10 + 5 + 10 = 30 ft
      expect(altRes.steps.map((s) => s.stepCostFeet)).toEqual([5, 10, 5, 10]);
    });

    it('adds +5 ft per difficult terrain cell and routes around difficult terrain when cheaper', () => {
      // 5x3 corridor where (1,1) and (2,1) are rubble (difficult terrain)
      let grid = createTacticalGrid(5, 3);
      grid = setGridCells(grid, [
        { x: 1, y: 1, terrain: 'rubble' },
        { x: 2, y: 1, terrain: 'rubble' },
      ]);

      const mover: GridCreature = { id: 'hero', x: 0, y: 1, size: 'medium', faction: 'party' };

      // Going straight through (1,1) and (2,1) to (3,1) would cost 10 + 10 + 5 = 25 ft.
      // Stepping diagonally around via y=0 or y=2 costs 5 + 5 + 5 = 15 ft!
      const detourResult = findPath({
        grid,
        mover,
        goal: { x: 3, y: 1 },
      });
      expect(detourResult.found).toBe(true);
      expect(detourResult.totalCostFeet).toBe(15);

      // Now wall off y=0 and y=2 so the mover must walk through the difficult terrain
      const walledGrid = setGridCells(grid, [
        { x: 1, y: 0, terrain: 'wall_solid' },
        { x: 2, y: 0, terrain: 'wall_solid' },
        { x: 1, y: 2, terrain: 'wall_solid' },
        { x: 2, y: 2, terrain: 'wall_solid' },
      ]);

      const forcedResult = findPath({
        grid: walledGrid,
        mover,
        goal: { x: 3, y: 1 },
      });
      expect(forcedResult.found).toBe(true);
      expect(forcedResult.totalCostFeet).toBe(25);
      expect(forcedResult.steps.map((s) => s.stepCostFeet)).toEqual([10, 10, 5]);
      expect(forcedResult.steps.map((s) => s.difficultTerrain)).toEqual([true, true, false]);
    });
  });

  describe('Creature Space Traversal & Occupancy Rules', () => {
    it('allows moving through allied spaces as difficult terrain (+5 ft) but blocks ending a move on an allied cell', () => {
      // 1-cell wide hallway of length 4 (4x1)
      const grid = createTacticalGrid(4, 1);
      const mover: GridCreature = { id: 'fighter', x: 0, y: 0, size: 'medium', faction: 'party' };
      const ally: GridCreature = { id: 'cleric', x: 1, y: 0, size: 'medium', faction: 'party' };

      // Cannot end movement on (1, 0) where ally stands
      const endOnAlly = findPath({
        grid,
        mover,
        goal: { x: 1, y: 0 },
        creatures: [ally],
      });
      expect(endOnAlly.found).toBe(false);
      expect(endOnAlly.blockedReason).toBe('goal_occupied');

      // Can move THROUGH ally at (1, 0) to reach (2, 0), paying +5 ft difficult terrain on step 1
      const throughAlly = findPath({
        grid,
        mover,
        goal: { x: 2, y: 0 },
        creatures: [ally],
      });
      expect(throughAlly.found).toBe(true);
      expect(throughAlly.path).toEqual([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ]);
      expect(throughAlly.totalCostFeet).toBe(15); // 10 ft into ally cell + 5 ft into (2,0)
      expect(throughAlly.steps[0]?.difficultTerrain).toBe(true);
      expect(throughAlly.steps[0]?.stepCostFeet).toBe(10);
    });

    it('blocks moving through hostile spaces unless at least 2 size categories different or Halfling Nimbleness', () => {
      const grid = createTacticalGrid(4, 1);
      const mediumHero: GridCreature = {
        id: 'fighter',
        x: 0,
        y: 0,
        size: 'medium',
        faction: 'party',
      };
      const mediumEnemy: GridCreature = {
        id: 'hobgoblin',
        x: 1,
        y: 0,
        size: 'medium',
        faction: 'enemy',
      };
      const smallEnemy: GridCreature = {
        id: 'goblin',
        x: 1,
        y: 0,
        size: 'small',
        faction: 'enemy',
      };
      const tinyEnemy: GridCreature = {
        id: 'rat',
        x: 1,
        y: 0,
        size: 'tiny',
        faction: 'enemy',
      };

      // Medium vs Medium (0 size diff) -> Blocked
      expect(canTraverseCreatureSpace(mediumHero, mediumEnemy)).toBe(false);
      expect(
        findPath({ grid, mover: mediumHero, goal: { x: 2, y: 0 }, creatures: [mediumEnemy] }).found,
      ).toBe(false);

      // Medium vs Small (1 size diff) -> Blocked
      expect(canTraverseCreatureSpace(mediumHero, smallEnemy)).toBe(false);
      expect(
        findPath({ grid, mover: mediumHero, goal: { x: 2, y: 0 }, creatures: [smallEnemy] }).found,
      ).toBe(false);

      // Medium vs Tiny (2 size diff) -> Allowed (costs difficult terrain)
      expect(canTraverseCreatureSpace(mediumHero, tinyEnemy)).toBe(true);
      const vsTiny = findPath({
        grid,
        mover: mediumHero,
        goal: { x: 2, y: 0 },
        creatures: [tinyEnemy],
      });
      expect(vsTiny.found).toBe(true);
      expect(vsTiny.totalCostFeet).toBe(15);

      // Halfling Nimbleness: Small Halfling can move through Medium/Large hostile creatures, but NOT Small hostiles
      const halfling: GridCreature = {
        id: 'halfling-rogue',
        x: 0,
        y: 0,
        size: 'small',
        faction: 'party',
        halflingNimbleness: true,
      };
      expect(canTraverseCreatureSpace(halfling, mediumEnemy)).toBe(true);
      expect(canTraverseCreatureSpace(halfling, smallEnemy)).toBe(false);

      const halflingThroughMedium = findPath({
        grid,
        mover: halfling,
        goal: { x: 2, y: 0 },
        creatures: [mediumEnemy],
      });
      expect(halflingThroughMedium.found).toBe(true);
      expect(halflingThroughMedium.totalCostFeet).toBe(15);
    });

    it('supports up to 4 non-hostile Tiny creatures sharing a 1x1 cell while blocking the 5th or hostile Tiny', () => {
      const grid = createTacticalGrid(3, 3);
      const mover: GridCreature = { id: 'owl-1', x: 0, y: 0, size: 'tiny', faction: 'party' };
      const tinyAllies: GridCreature[] = [
        { id: 'owl-2', x: 1, y: 0, size: 'tiny', faction: 'party' },
        { id: 'owl-3', x: 1, y: 0, size: 'tiny', faction: 'party' },
        { id: 'owl-4', x: 1, y: 0, size: 'tiny', faction: 'party' },
      ];

      // 3 Tiny allies already at (1,0) -> 4th Tiny ally can end move at (1,0)
      expect(canEndMoveAt(grid, mover, { x: 1, y: 0 }, tinyAllies)).toBe(true);

      // 4 Tiny allies already at (1,0) -> 5th Tiny ally cannot end move at (1,0)
      const fourTinyAllies = [
        ...tinyAllies,
        { id: 'owl-5', x: 1, y: 0, size: 'tiny' as const, faction: 'party' as const },
      ];
      expect(canEndMoveAt(grid, mover, { x: 1, y: 0 }, fourTinyAllies)).toBe(false);

      // Hostile Tiny creature at (1,0) -> cannot end move at (1,0)
      const hostileTiny: GridCreature = {
        id: 'enemy-sprite',
        x: 1,
        y: 0,
        size: 'tiny',
        faction: 'enemy',
      };
      expect(canEndMoveAt(grid, mover, { x: 1, y: 0 }, [hostileTiny])).toBe(false);
    });

    it('correctly paths multi-cell Large (2x2) creatures around narrow 1-cell gaps', () => {
      // 6x5 room with a wall column at x=2 that has a 1-cell gap at y=0 and a 2-cell gap at y=3..4
      let grid = createTacticalGrid(6, 5);
      grid = setGridCells(grid, [
        { x: 2, y: 1, terrain: 'wall_solid' },
        { x: 2, y: 2, terrain: 'wall_solid' },
      ]);

      const ogre: GridCreature = { id: 'ogre', x: 0, y: 0, size: 'large', faction: 'enemy' };

      // The 1-cell gap at (2,0) cannot fit a 2x2 Large creature; it must route down through y=3..4
      const result = findPath({
        grid,
        mover: ogre,
        goal: { x: 4, y: 0 },
      });
      expect(result.found).toBe(true);
      // Every step in the path must have its 2x2 footprint avoid (2,1) and (2,2)
      for (const anchor of result.path) {
        const cells = getFootprintCells(anchor, 'large');
        for (const c of cells) {
          expect(c.x === 2 && (c.y === 1 || c.y === 2)).toBe(false);
        }
      }
    });
  });

  describe('Prone Movement & Crawling Costs', () => {
    it('calculates standing up cost (half max speed) and crawling costs (+5 ft normal, +10 ft difficult)', () => {
      expect(getStandUpCostFeet(30)).toBe(15);
      expect(getStandUpCostFeet(25)).toBe(12);
      expect(canStandUpFromProne(30, 15)).toBe(true);
      expect(canStandUpFromProne(30, 14)).toBe(false);
      expect(canStandUpFromProne(0, 0)).toBe(false);

      let grid = createTacticalGrid(4, 1);
      grid = setGridCell(grid, { x: 1, y: 0, terrain: 'rubble' }); // difficult terrain

      const proneMover: GridCreature = {
        id: 'prone-hero',
        x: 0,
        y: 0,
        size: 'medium',
        faction: 'party',
        isProne: true,
      };

      const res = findPath({
        grid,
        mover: proneMover,
        goal: { x: 2, y: 0 },
      });
      expect(res.found).toBe(true);
      // Step 1 into difficult terrain while prone: 5 base + 5 difficult + 5 crawl = 15 ft
      // Step 2 into normal terrain while prone: 5 base + 5 crawl = 10 ft
      expect(res.steps.map((s) => s.stepCostFeet)).toEqual([15, 10]);
      expect(res.totalCostFeet).toBe(25);
    });
  });

  describe('Opportunity Attack Reach Exit Detection & Reachable Cells', () => {
    it('detects exact steps that exit enemy melee reach (5 ft and 10 ft) and ignores steps that stay within reach', () => {
      const grid = createTacticalGrid(6, 4);
      const hero: GridCreature = {
        id: 'hero',
        x: 1,
        y: 1,
        size: 'medium',
        faction: 'party',
        speedFeet: 30,
      };
      const goblin: GridCreature = {
        id: 'goblin-1',
        x: 1,
        y: 0,
        size: 'small',
        faction: 'enemy',
        reachFeet: 5,
      };
      const pikeGuard: GridCreature = {
        id: 'pike-guard',
        x: 0,
        y: 1,
        size: 'medium',
        faction: 'enemy',
        reachFeet: 10,
      };

      // Custom path: (1,1) -> (2,1) -> (3,1) -> (4,1)
      // At (1,1): distance to goblin(1,0) is 5 ft; distance to pikeGuard(0,1) is 5 ft.
      // Step 1: (1,1) -> (2,1): distance to goblin(1,0) is STILL 5 ft (diagonal)! Distance to pikeGuard(0,1) is 10 ft (still within 10-ft reach!).
      //   -> NO Opportunity Attack on Step 1!
      // Step 2: (2,1) -> (3,1): distance to goblin(1,0) becomes 10 ft (> 5 ft) -> Provokes goblin-1!
      //   Distance to pikeGuard(0,1) becomes 15 ft (> 10 ft) -> Provokes pike-guard!
      const manualPath = [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 3, y: 1 },
        { x: 4, y: 1 },
      ];
      const triggers = detectPathOpportunityAttacks(hero, manualPath, [goblin, pikeGuard], false);
      expect(triggers).toEqual([
        {
          enemyId: 'goblin-1',
          from: { x: 2, y: 1 },
          to: { x: 3, y: 1 },
          enemyReachFeet: 5,
        },
        {
          enemyId: 'pike-guard',
          from: { x: 2, y: 1 },
          to: { x: 3, y: 1 },
          enemyReachFeet: 10,
        },
      ]);

      // When Disengaged, no Opportunity Attacks are triggered
      expect(detectPathOpportunityAttacks(hero, manualPath, [goblin, pikeGuard], true)).toEqual([]);
    });

    it('classifies path steps into normal, dash, and unreachable budget segments and computes reachable cells', () => {
      const grid = createTacticalGrid(10, 2);
      const hero: GridCreature = {
        id: 'hero',
        x: 0,
        y: 0,
        size: 'medium',
        faction: 'party',
        speedFeet: 15,
      };
      const ally: GridCreature = {
        id: 'ally',
        x: 1,
        y: 0,
        size: 'medium',
        faction: 'party',
      };

      const res = findPath({
        grid,
        mover: hero,
        goal: { x: 7, y: 0 },
        movementRemainingFeet: 15,
        dashBonusFeet: 15,
      });
      expect(res.found).toBe(true);
      expect(res.steps.map((s) => s.budgetStatus)).toEqual([
        'normal', // 5 ft
        'normal', // 10 ft
        'normal', // 15 ft
        'dash', // 20 ft
        'dash', // 25 ft
        'dash', // 30 ft
        'unreachable', // 35 ft
      ]);

      // Reachable cells within 10 ft must NOT include (1,0) where ally stands
      const reachable = getReachableCells({
        grid,
        mover: hero,
        maxMovementFeet: 10,
        creatures: [ally],
      });
      const reachableCoords = reachable.map((r) => `${r.cell.x},${r.cell.y}`);
      expect(reachableCoords).not.toContain('1,0');
      expect(reachableCoords).toContain('0,1');
      expect(reachableCoords).toContain('1,1');
      expect(reachableCoords).toContain('2,0');
    });
  });
});
