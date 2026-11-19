import React from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Container } from 'pixi.js';
import {
  createTacticalGrid,
  type GridCell,
  type GridPoint,
  type TacticalGrid,
} from '@srd5/engine';
import type { PlayerViewGrid } from '@srd5/transport';
import {
  PathAndAoeRenderer,
  TacticalCanvasViewport,
  calculateHitChance,
  computeAoeOverlay,
  ensureTacticalGrid,
  getCoverDescription,
  toGridCreature,
  toVisionCreature,
  PATH_COLORS,
  AOE_DEFAULT_COLORS,
  COVER_COLORS,
  type CreatureTokenData,
} from '../canvas/index.js';

describe('SRD-404: PixiJS Interactive Overlays (A* Path Preview, OA Warnings, AOE Templates, LoS/Cover Rays)', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  describe('Math & Helper Functions', () => {
    it('normalizes PlayerViewGrid to TacticalGrid correctly', () => {
      const pvg: PlayerViewGrid = {
        width: 4,
        height: 4,
        cells: [
          {
            x: 0,
            y: 0,
            visibility: 'visible',
            terrain: 'floor_stone',
            blocksMovement: false,
            blocksSight: false,
          },
          {
            x: 1,
            y: 0,
            visibility: 'visible',
            terrain: 'wall_solid',
            blocksMovement: true,
            blocksSight: true,
          },
        ],
      };

      const tactical = ensureTacticalGrid(pvg);
      expect(tactical.width).toBe(4);
      expect(tactical.height).toBe(4);
      expect(tactical.cells[0]?.terrain).toBe('floor_stone');
      expect(tactical.cells[0]?.blocksMovement).toBe(false);
      expect(tactical.cells[1]?.blocksSight).toBe(true);
    });

    it('converts token to GridCreature and derives OA capability based on conditions', () => {
      const activeFighter: CreatureTokenData = {
        id: 'hero-1',
        name: 'Fighter',
        side: 'party',
        size: 'medium',
        position: { x: 2, y: 2 },
        currentHp: 20,
        maxHp: 20,
      };

      const gcActive = toGridCreature(activeFighter);
      expect(gcActive.id).toBe('hero-1');
      expect(gcActive.x).toBe(2);
      expect(gcActive.y).toBe(2);
      expect(gcActive.canMakeOpportunityAttack).toBe(true);

      const unconsciousGoblin: CreatureTokenData = {
        id: 'goblin-1',
        name: 'Goblin',
        side: 'monster',
        size: 'small',
        position: { x: 3, y: 3 },
        currentHp: 0,
        maxHp: 7,
        conditions: ['unconscious'],
      };

      const gcUnconscious = toGridCreature(unconsciousGoblin);
      expect(gcUnconscious.canMakeOpportunityAttack).toBe(false);
      expect(gcUnconscious.faction).toBe('enemy');
    });

    it('calculates exact SRD 5.1 d20 hit probability accounting for AC and cover bonuses', () => {
      // Attack Bonus +5 vs AC 15:
      // No cover: AC 15 -> Target roll 15 - 5 = 10 -> (21 - 10) / 20 = 55%
      expect(calculateHitChance(5, 15, 'none')).toBe(0.55);

      // Half Cover (+2 AC): effective AC 17 -> Target roll 17 - 5 = 12 -> (21 - 12) / 20 = 45%
      expect(calculateHitChance(5, 15, 'half')).toBe(0.45);

      // Three-Quarters Cover (+5 AC): effective AC 20 -> Target roll 20 - 5 = 15 -> (21 - 15) / 20 = 30%
      expect(calculateHitChance(5, 15, 'three_quarters')).toBe(0.3);

      // Total Cover: direct attacks impossible -> 0%
      expect(calculateHitChance(5, 15, 'total')).toBe(0);

      // Blocked LoS: 0%
      expect(calculateHitChance(5, 15, 'none', false)).toBe(0);

      // Natural 1 floor / Natural 20 cap:
      // Huge bonus (+20 vs AC 10): 95% (natural 1 is auto-miss)
      expect(calculateHitChance(20, 10, 'none')).toBe(0.95);
      // Terrible bonus (-10 vs AC 25): 5% (natural 20 is auto-hit)
      expect(calculateHitChance(-10, 25, 'none')).toBe(0.05);
    });

    it('provides clear cover description labels', () => {
      expect(getCoverDescription('none')).toBe('No Cover (+0 AC)');
      expect(getCoverDescription('half')).toBe('Half Cover (+2 AC)');
      expect(getCoverDescription('three_quarters')).toBe('3/4 Cover (+5 AC)');
      expect(getCoverDescription('total')).toBe('Blocked (Total Cover)');
      expect(getCoverDescription('none', false)).toBe('Blocked (Total Cover)');
    });
  });

  describe('AOE Overlay Geometry & Rasterization', () => {
    it('computes 20-ft sphere AOE snapped to grid intersection and identifies affected creatures', () => {
      const creatures: CreatureTokenData[] = [
        {
          id: 'goblin-1',
          name: 'Goblin',
          side: 'monster',
          size: 'small',
          position: { x: 4, y: 4 },
          currentHp: 7,
          maxHp: 7,
        },
        {
          id: 'goblin-far',
          name: 'Far Goblin',
          side: 'monster',
          size: 'small',
          position: { x: 12, y: 12 },
          currentHp: 7,
          maxHp: 7,
        },
      ];

      const result = computeAoeOverlay(
        {
          shape: 'sphere',
          cursor: { x: 4, y: 4 },
          radiusFeet: 20,
          creatures,
        },
        48,
      );

      expect(result.template.shape).toBe('sphere');
      expect(result.cells.length).toBeGreaterThan(0);
      // Goblin at (4, 4) is inside the 20-ft sphere
      expect(result.affectedCreatureIds).toContain('goblin-1');
      // Goblin at (12, 12) is far outside
      expect(result.affectedCreatureIds).not.toContain('goblin-far');
    });

    it('computes 15-ft cone AOE originating from caster boundary towards cursor', () => {
      const creatures: CreatureTokenData[] = [
        {
          id: 'target-in-front',
          name: 'Orc',
          side: 'monster',
          size: 'medium',
          position: { x: 4, y: 3 },
          currentHp: 15,
          maxHp: 15,
        },
        {
          id: 'target-behind',
          name: 'Skeleton',
          side: 'monster',
          size: 'medium',
          position: { x: 1, y: 3 },
          currentHp: 13,
          maxHp: 13,
        },
      ];

      const result = computeAoeOverlay(
        {
          shape: 'cone',
          casterPosition: { x: 3, y: 3 },
          casterSize: 'medium',
          cursor: { x: 6, y: 3 }, // Facing East
          lengthFeet: 15,
          creatures,
        },
        48,
      );

      expect(result.template.shape).toBe('cone');
      expect(result.affectedCreatureIds).toContain('target-in-front');
      expect(result.affectedCreatureIds).not.toContain('target-behind');
    });

    it('computes 30-ft line AOE and 15-ft cube AOE', () => {
      const lineRes = computeAoeOverlay({
        shape: 'line',
        casterPosition: { x: 1, y: 1 },
        cursor: { x: 7, y: 1 },
        lengthFeet: 30,
        widthFeet: 5,
      });
      expect(lineRes.template.shape).toBe('line');
      expect(lineRes.cells.length).toBeGreaterThan(0);

      const cubeRes = computeAoeOverlay({
        shape: 'cube',
        casterPosition: { x: 5, y: 5 },
        cursor: { x: 7, y: 5 },
        sideFeet: 15,
      });
      expect(cubeRes.template.shape).toBe('cube');
      expect(cubeRes.cells.length).toBeGreaterThan(0);
      expect(cubeRes.cells).toContainEqual({ x: 7, y: 5 });

      // 10-ft Grease cube aimed south from (15, 5) to hovered cell (14, 7) must include (14, 7)
      const greaseSouth = computeAoeOverlay({
        shape: 'cube',
        casterPosition: { x: 15, y: 5 },
        cursor: { x: 14, y: 7 },
        sideFeet: 10,
      });
      expect(greaseSouth.cells).toHaveLength(4);
      expect(greaseSouth.cells).toContainEqual({ x: 14, y: 7 });
    });
  });

  describe('PathAndAoeRenderer Layer Management', () => {
    function makeTestGrid(width = 12, height = 12): TacticalGrid {
      return createTacticalGrid(width, height, 'floor_stone');
    }

    it('renders segmented path with normal and dash budget coloring', () => {
      const grid = makeTestGrid();
      const parent = new Container();
      const renderer = new PathAndAoeRenderer(parent);

      const mover: CreatureTokenData = {
        id: 'hero',
        name: 'Hero',
        side: 'party',
        size: 'medium',
        position: { x: 1, y: 1 },
        currentHp: 20,
        maxHp: 20,
      };

      // Path from (1, 1) to (6, 1): 5 steps = 25 ft.
      // With movementRemainingFeet = 15, first 3 steps are normal, next 2 are dash.
      renderer.renderPath({
        mover,
        destination: { x: 6, y: 1 },
        grid,
        movementRemainingFeet: 15,
        dashBonusFeet: 30,
      });

      const pathResult = renderer.getPathResult();
      expect(pathResult).toBeDefined();
      expect(pathResult?.found).toBe(true);
      expect(pathResult?.steps.length).toBe(5);
      expect(pathResult?.steps[0]?.budgetStatus).toBe('normal');
      expect(pathResult?.steps[1]?.budgetStatus).toBe('normal');
      expect(pathResult?.steps[2]?.budgetStatus).toBe('normal');
      expect(pathResult?.steps[3]?.budgetStatus).toBe('dash');
      expect(pathResult?.steps[4]?.budgetStatus).toBe('dash');

      // Check destination marker container
      expect(renderer.pathContainer.children.length).toBe(3);
    });

    it('detects Opportunity Attack triggers along path and renders warning badges', () => {
      const grid = makeTestGrid();
      const parent = new Container();
      const renderer = new PathAndAoeRenderer(parent);

      const mover: CreatureTokenData = {
        id: 'hero',
        name: 'Hero',
        side: 'party',
        size: 'medium',
        position: { x: 2, y: 2 },
        currentHp: 20,
        maxHp: 20,
      };

      // Enemy at (3, 2). Melee reach 5 ft covers (2, 2).
      // Moving from (2, 2) to (1, 2) exits reach and provokes OA!
      const enemy: CreatureTokenData = {
        id: 'enemy-goblin',
        name: 'Goblin',
        side: 'monster',
        size: 'medium',
        position: { x: 3, y: 2 },
        currentHp: 7,
        maxHp: 7,
      };

      renderer.renderPath({
        mover,
        destination: { x: 0, y: 2 },
        grid,
        creatures: [enemy],
        movementRemainingFeet: 30,
        isDisengaged: false,
      });

      const pathResult = renderer.getPathResult();
      expect(pathResult).toBeDefined();
      expect(pathResult?.found).toBe(true);

      const stepLeavingReach = pathResult?.steps.find(
        (s) => s.opportunityAttacks.length > 0 || s.provokedEnemyIds.length > 0,
      );
      expect(stepLeavingReach).toBeDefined();
      expect(stepLeavingReach?.provokedEnemyIds).toContain('enemy-goblin');

      // Opportunity attack container has warning badges
      const oaContainer = renderer.pathContainer.children[1] as Container;
      expect(oaContainer.children.length).toBeGreaterThan(0);
    });

    it('suppresses Opportunity Attacks when the mover has taken the Disengage action', () => {
      const grid = makeTestGrid();
      const parent = new Container();
      const renderer = new PathAndAoeRenderer(parent);

      const mover: CreatureTokenData = {
        id: 'hero',
        name: 'Hero',
        side: 'party',
        size: 'medium',
        position: { x: 2, y: 2 },
        currentHp: 20,
        maxHp: 20,
      };

      const enemy: CreatureTokenData = {
        id: 'enemy-goblin',
        name: 'Goblin',
        side: 'monster',
        size: 'medium',
        position: { x: 3, y: 2 },
        currentHp: 7,
        maxHp: 7,
      };

      renderer.renderPath({
        mover,
        destination: { x: 0, y: 2 },
        grid,
        creatures: [enemy],
        movementRemainingFeet: 30,
        isDisengaged: true,
      });

      const pathResult = renderer.getPathResult();
      expect(pathResult?.opportunityAttacks).toHaveLength(0);
      const oaContainer = renderer.pathContainer.children[1] as Container;
      expect(oaContainer.children.length).toBe(0);
    });

    it('renders AOE template and highlights affected creatures with target reticles', () => {
      const grid = makeTestGrid();
      const parent = new Container();
      const renderer = new PathAndAoeRenderer(parent);

      const targetOrc: CreatureTokenData = {
        id: 'orc-1',
        name: 'Orc',
        side: 'monster',
        size: 'medium',
        position: { x: 5, y: 5 },
        currentHp: 15,
        maxHp: 15,
      };

      renderer.renderAoe({
        shape: 'sphere',
        cursor: { x: 5, y: 5 },
        radiusFeet: 20,
        grid,
        creatures: [targetOrc],
      });

      const aoeResult = renderer.getAoeResult();
      expect(aoeResult).toBeDefined();
      expect(aoeResult?.cells.length).toBeGreaterThan(0);
      expect(aoeResult?.affectedCreatureIds).toContain('orc-1');

      // Check reticle container has target child
      const reticleContainer = renderer.aoeContainer.children[2] as Container;
      expect(reticleContainer.children.length).toBe(1);
    });

    it('renders Line of Sight and Cover rays with hit probability and cover badge', () => {
      const grid = makeTestGrid();
      const parent = new Container();
      const renderer = new PathAndAoeRenderer(parent);

      const attacker: CreatureTokenData = {
        id: 'ranger',
        name: 'Ranger',
        side: 'party',
        size: 'medium',
        position: { x: 1, y: 1 },
        currentHp: 18,
        maxHp: 18,
      };

      const target: CreatureTokenData = {
        id: 'hobgoblin',
        name: 'Hobgoblin',
        side: 'monster',
        size: 'medium',
        position: { x: 6, y: 1 },
        currentHp: 11,
        maxHp: 11,
        armorClass: 16,
      };

      // Clear line of sight
      renderer.renderTargetingRay({
        attacker,
        target,
        grid,
        attackBonus: 5,
        targetAc: 16,
        showAllRays: true,
      });

      const coverRes = renderer.getCoverResult();
      expect(coverRes).toBeDefined();
      expect(coverRes?.cover.hasLineOfSight).toBe(true);
      expect(coverRes?.cover.cover).toBe('none');
      // Hit chance: 16 - 5 = 11 -> (21 - 11) / 20 = 50%
      expect(coverRes?.hitChance).toBe(0.5);

      // Check cover badge container has badge child
      const badgeContainer = renderer.targetingRayContainer.children[1] as Container;
      expect(badgeContainer.children.length).toBe(1);
    });

    it('detects wall blockage and renders 0% hit chance Blocked ray', () => {
      const grid = makeTestGrid();
      // Place solid wall line at x = 3 dividing the two creatures
      for (const cell of grid.cells) {
        if (cell.x === 3) {
          cell.terrain = 'wall_solid';
          cell.blocksSight = true;
          cell.blocksMovement = true;
        }
      }

      const parent = new Container();
      const renderer = new PathAndAoeRenderer(parent);

      const attacker: CreatureTokenData = {
        id: 'ranger',
        name: 'Ranger',
        side: 'party',
        size: 'medium',
        position: { x: 1, y: 1 },
        currentHp: 18,
        maxHp: 18,
      };

      const target: CreatureTokenData = {
        id: 'hobgoblin',
        name: 'Hobgoblin',
        side: 'monster',
        size: 'medium',
        position: { x: 6, y: 1 },
        currentHp: 11,
        maxHp: 11,
        armorClass: 16,
      };

      renderer.renderTargetingRay({
        attacker,
        target,
        grid,
        attackBonus: 5,
        targetAc: 16,
      });

      const coverRes = renderer.getCoverResult();
      expect(coverRes?.cover.hasLineOfSight).toBe(false);
      expect(coverRes?.hitChance).toBe(0);
    });

    it('clears and destroys all sub-containers cleanly', () => {
      const grid = makeTestGrid();
      const parent = new Container();
      const renderer = new PathAndAoeRenderer(parent);

      renderer.renderPath({
        mover: {
          id: 'hero',
          name: 'Hero',
          side: 'party',
          size: 'medium',
          position: { x: 1, y: 1 },
          currentHp: 20,
          maxHp: 20,
        },
        destination: { x: 3, y: 1 },
        grid,
      });

      expect(renderer.getPathResult()).not.toBeNull();
      renderer.clearPath();
      expect(renderer.getPathResult()).toBeNull();

      renderer.clear();
      expect(renderer.getPathResult()).toBeNull();
      expect(renderer.getAoeResult()).toBeNull();
      expect(renderer.getCoverResult()).toBeNull();

      expect(() => renderer.destroy()).not.toThrow();
    });
  });

  describe('TacticalCanvasViewport Overlay Integration', () => {
    it('renders with declarative overlay props without crashing', () => {
      const grid = createTacticalGrid(10, 10);
      const combatants: CreatureTokenData[] = [
        {
          id: 'hero',
          name: 'Hero',
          side: 'party',
          size: 'medium',
          position: { x: 2, y: 2 },
          currentHp: 20,
          maxHp: 20,
        },
        {
          id: 'enemy',
          name: 'Enemy',
          side: 'monster',
          size: 'medium',
          position: { x: 6, y: 2 },
          currentHp: 12,
          maxHp: 12,
        },
      ];

      const { container } = render(
        <TacticalCanvasViewport
          grid={grid}
          combatants={combatants}
          activeCombatantId="hero"
          selectedCombatantId="hero"
          hoveredCombatantId="enemy"
          targetingMode="attack"
          attackBonus={6}
          enableHoverPathPreview={true}
          activeAoeTemplate={{
            shape: 'sphere',
            cursor: { x: 5, y: 5 },
            radiusFeet: 20,
          }}
        />,
      );

      expect(container.querySelector('[data-testid="tactical-canvas-viewport"]')).toBeDefined();
    });
  });
});
