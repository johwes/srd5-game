import React from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Container } from 'pixi.js';
import {
  createTacticalGrid,
  type LightSource,
  type TacticalGrid,
  type VisionCreature,
} from '@srd5/engine';
import type { PlayerViewGrid } from '@srd5/transport';
import {
  FOG_ALPHAS,
  FOG_COLORS,
  LightingAndFogRenderer,
  TacticalCanvasViewport,
  computeDynamicFog,
  extractVisionObservers,
  type CreatureTokenData,
  type FogOfWarOptions,
} from '../canvas/index.js';

describe('SRD-405: PixiJS Dynamic Lighting & Fog-of-War Mask Layer', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  describe('extractVisionObservers', () => {
    it('extracts explicit observers when provided', () => {
      const explicitObservers: Array<VisionCreature & { darkvisionFeet?: number }> = [
        { id: 'elf-1', x: 2, y: 3, size: 'medium', darkvisionFeet: 60 },
        { id: 'human-1', x: 5, y: 5, size: 'medium', darkvisionFeet: 0 },
      ];

      const result = extractVisionObservers({ observers: explicitObservers });
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'elf-1',
        x: 2,
        y: 3,
        size: 'medium',
        darkvisionFeet: 60,
      });
      expect(result[1]?.darkvisionFeet).toBe(0);
    });

    it('extracts conscious party combatants and ignores monsters or unconscious allies', () => {
      const combatants: CreatureTokenData[] = [
        {
          id: 'hero-dwarf',
          name: 'Dwarf Cleric',
          side: 'party',
          size: 'medium',
          position: { x: 1, y: 1 },
          currentHp: 25,
          maxHp: 25,
          characterSheet: { darkvisionFeet: 60 } as any,
        },
        {
          id: 'hero-human-unconscious',
          name: 'Human Fighter',
          side: 'party',
          size: 'medium',
          position: { x: 2, y: 1 },
          currentHp: 0,
          maxHp: 30,
          conditions: ['unconscious'],
        },
        {
          id: 'hero-dead',
          name: 'Rogue',
          side: 'party',
          size: 'medium',
          position: { x: 3, y: 1 },
          currentHp: 0,
          maxHp: 18,
          isDead: true,
        },
        {
          id: 'goblin-1',
          name: 'Goblin Scout',
          side: 'monster',
          size: 'small',
          position: { x: 10, y: 10 },
          currentHp: 7,
          maxHp: 7,
          monsterData: { darkvisionFeet: 60 } as any,
        },
      ];

      const result = extractVisionObservers({ combatants });
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('hero-dwarf');
      expect(result[0]?.darkvisionFeet).toBe(60);
      expect(result[0]?.x).toBe(1);
      expect(result[0]?.y).toBe(1);
    });
  });

  describe('computeDynamicFog', () => {
    it('preserves precomputed PlayerViewGrid cell visibilities and lighting', () => {
      const pvg: PlayerViewGrid = {
        width: 3,
        height: 2,
        cells: [
          { x: 0, y: 0, visibility: 'visible', effectiveLight: 'bright' },
          { x: 1, y: 0, visibility: 'visible', effectiveLight: 'dim' },
          { x: 2, y: 0, visibility: 'remembered' },
          { x: 0, y: 1, visibility: 'unexplored' },
          { x: 1, y: 1, visibility: 'visible', effectiveLight: 'dim', seenViaDarkvision: true } as any,
          { x: 2, y: 1, visibility: 'unexplored' },
        ],
      };

      const map = computeDynamicFog(pvg);
      expect(map.size).toBe(6);

      const cell00 = map.get('0,0');
      expect(cell00?.visibility).toBe('visible');
      expect(cell00?.effectiveLight).toBe('bright');
      expect(cell00?.seenViaDarkvision).toBe(false);

      const cell10 = map.get('1,0');
      expect(cell10?.visibility).toBe('visible');
      expect(cell10?.effectiveLight).toBe('dim');

      const cell20 = map.get('2,0');
      expect(cell20?.visibility).toBe('remembered');

      const cell01 = map.get('0,1');
      expect(cell01?.visibility).toBe('unexplored');

      const cell11 = map.get('1,1');
      expect(cell11?.visibility).toBe('visible');
      expect(cell11?.seenViaDarkvision).toBe(true);
    });

    it('reveals all cells when showAll is true', () => {
      const grid = createTacticalGrid(4, 4, 'floor_stone', 'darkness');
      const map = computeDynamicFog(grid, { showAll: true });

      expect(map.size).toBe(16);
      for (const info of map.values()) {
        expect(info.visibility).toBe('visible');
        expect(info.baseLight).toBe('darkness');
      }
    });

    it('computes Line of Sight and torch light ranges dynamically on a TacticalGrid', () => {
      // 8x8 grid with darkness as base light
      const grid = createTacticalGrid(8, 8, 'floor_stone', 'darkness');
      // Place a torch at (2, 2) with 10ft bright, 10ft dim (2 cells bright, 2 cells dim)
      const torch: LightSource = { x: 2, y: 2, brightFeet: 10, dimFeet: 10 };
      const humanObserver: VisionCreature & { darkvisionFeet: number } = {
        id: 'human',
        x: 2,
        y: 2,
        size: 'medium',
        darkvisionFeet: 0,
      };

      const map = computeDynamicFog(grid, {
        observers: [humanObserver],
        lightSources: [torch],
      });

      // Observer at (2, 2) with torch: cell (2, 2) is bright
      const center = map.get('2,2');
      expect(center?.visibility).toBe('visible');
      expect(center?.effectiveLight).toBe('bright');
      expect(center?.seenViaDarkvision).toBe(false);

      // Distance 1 cell (5ft) -> (3, 2) is bright
      const near = map.get('3,2');
      expect(near?.visibility).toBe('visible');
      expect(near?.effectiveLight).toBe('bright');

      // Distance 3 cells (15ft) -> (5, 2) is dim
      const mid = map.get('5,2');
      expect(mid?.visibility).toBe('visible');
      expect(mid?.effectiveLight).toBe('dim');

      // Distance 6 cells (30ft) -> (2, 8) exceeds torch bright + dim -> in darkness, unseen without darkvision
      const far = map.get('2,7');
      expect(far?.visibility).toBe('unexplored');
    });

    it('handles darkvision penetrating darkness into dim light', () => {
      // Total darkness grid
      const grid = createTacticalGrid(6, 6, 'floor_stone', 'darkness');
      const elfObserver: VisionCreature & { darkvisionFeet: number } = {
        id: 'elf',
        x: 0,
        y: 0,
        size: 'medium',
        darkvisionFeet: 60,
      };

      const map = computeDynamicFog(grid, {
        observers: [elfObserver],
        lightSources: [], // No torch
      });

      // Observer's cell has baseLight 'darkness' but effectiveLight 'dim' via darkvision
      const cell00 = map.get('0,0');
      expect(cell00?.visibility).toBe('visible');
      expect(cell00?.baseLight).toBe('darkness');
      expect(cell00?.effectiveLight).toBe('dim');
      expect(cell00?.seenViaDarkvision).toBe(true);

      // Adjacent cell within 60ft is also visible in dim light via darkvision
      const cell22 = map.get('2,2');
      expect(cell22?.visibility).toBe('visible');
      expect(cell22?.seenViaDarkvision).toBe(true);
      expect(cell22?.effectiveLight).toBe('dim');
    });

    it('blocks vision behind solid walls and classifies unseen explored cells as remembered', () => {
      const grid = createTacticalGrid(6, 6, 'floor_stone', 'bright');
      // Place solid wall in middle column: (2, 0), (2, 1), (2, 2), (2, 3), (2, 4), (2, 5)
      for (let y = 0; y < 6; y++) {
        const wallCell = grid.cells.find((c) => c.x === 2 && c.y === y);
        if (wallCell) {
          wallCell.terrain = 'wall_solid';
          wallCell.blocksSight = true;
          wallCell.blocksMovement = true;
        }
      }

      const observer: VisionCreature & { darkvisionFeet: number } = {
        id: 'party-lead',
        x: 0,
        y: 2,
        size: 'medium',
        darkvisionFeet: 0,
      };

      // Mark cell (4, 2) as previously explored
      const exploredCells: Record<string, boolean> = {
        '4,2': true,
      };

      const map = computeDynamicFog(grid, {
        observers: [observer],
        exploredCells,
      });

      // (0, 2) is visible to observer
      expect(map.get('0,2')?.visibility).toBe('visible');
      // (1, 2) is visible (in front of wall)
      expect(map.get('1,2')?.visibility).toBe('visible');

      // (4, 2) is blocked by wall at x=2, but was in exploredCells -> remembered
      const behindWall = map.get('4,2');
      expect(behindWall?.visibility).toBe('remembered');

      // (5, 2) is blocked by wall and was never explored -> unexplored
      const neverSeen = map.get('5,2');
      expect(neverSeen?.visibility).toBe('unexplored');
    });
  });

  describe('LightingAndFogRenderer Class', () => {
    it('creates child graphics containers and adheres to scene graph layer ordering', () => {
      const parent = new Container();
      const renderer = new LightingAndFogRenderer(parent);

      expect(renderer.container).toBeDefined();
      expect(renderer.container.label).toBe('LightingAndFogRenderer');
      expect(parent.children).toContain(renderer.container);

      // Verify child containers/graphics exist
      expect(renderer.container.children.length).toBeGreaterThanOrEqual(4);
      renderer.destroy();
    });

    it('renders unexplored, remembered, and visible cells with appropriate counts and queries', () => {
      const renderer = new LightingAndFogRenderer();
      const pvg: PlayerViewGrid = {
        width: 3,
        height: 3,
        cells: [
          { x: 0, y: 0, visibility: 'visible', effectiveLight: 'bright' },
          { x: 1, y: 0, visibility: 'visible', effectiveLight: 'dim' },
          { x: 2, y: 0, visibility: 'visible', effectiveLight: 'darkness' },
          { x: 0, y: 1, visibility: 'remembered' },
          { x: 1, y: 1, visibility: 'remembered' },
          { x: 2, y: 1, visibility: 'unexplored' },
          { x: 0, y: 2, visibility: 'unexplored' },
          { x: 1, y: 2, visibility: 'unexplored' },
          { x: 2, y: 2, visibility: 'unexplored' },
        ],
      };

      renderer.render({
        grid: pvg,
        cellSize: 48,
      });

      expect(renderer.getVisibleCellCount()).toBe(3);
      expect(renderer.getExploredCellCount()).toBe(5); // 3 visible + 2 remembered
      expect(renderer.getUnexploredCellCount()).toBe(4);

      expect(renderer.isCellVisible(0, 0)).toBe(true);
      expect(renderer.isCellVisible(0, 1)).toBe(false);
      expect(renderer.isCellExplored(0, 1)).toBe(true);
      expect(renderer.isCellExplored(2, 2)).toBe(false);

      const info00 = renderer.getCellLightingInfo(0, 0);
      expect(info00?.visibility).toBe('visible');
      expect(info00?.effectiveLight).toBe('bright');

      const info20 = renderer.getCellLightingInfo(2, 0);
      expect(info20?.visibility).toBe('visible');
      expect(info20?.effectiveLight).toBe('darkness');

      renderer.clear();
      expect(renderer.getLastCellMap()).toBeNull();
      expect(renderer.getVisibleCellCount()).toBe(0);

      renderer.destroy();
    });

    it('renders light sources and darkvision tint cleanly', () => {
      const renderer = new LightingAndFogRenderer();
      const grid = createTacticalGrid(5, 5, 'floor_stone', 'darkness');
      const lightSources: LightSource[] = [
        { x: 2, y: 2, brightFeet: 15, dimFeet: 15 },
      ];
      const observers = [
        { id: 'hero-1', x: 2, y: 2, size: 'medium' as const, darkvisionFeet: 60 },
      ];

      renderer.render({
        grid,
        cellSize: 48,
        lightSources,
        observers,
        showLightSources: true,
        showDarkvisionTint: true,
      });

      expect(renderer.getVisibleCellCount()).toBe(25);
      const cellInfo = renderer.getCellLightingInfo(2, 2);
      expect(cellInfo?.visibility).toBe('visible');
      expect(cellInfo?.effectiveLight).toBe('bright');

      renderer.destroy();
    });

    it('clears rendering when enabled is false', () => {
      const renderer = new LightingAndFogRenderer();
      const grid = createTacticalGrid(4, 4, 'floor_stone', 'bright');

      renderer.render({
        grid,
        cellSize: 48,
        enabled: false,
      });

      expect(renderer.getLastCellMap()).toBeNull();
      expect(renderer.getVisibleCellCount()).toBe(0);
      renderer.destroy();
    });
  });

  describe('TacticalCanvasViewport Integration', () => {
    it('mounts TacticalCanvasViewport with Fog-of-War enabled by default on PlayerViewGrid', () => {
      const pvg: PlayerViewGrid = {
        width: 4,
        height: 4,
        cells: [
          { x: 0, y: 0, visibility: 'visible', terrain: 'floor_stone', effectiveLight: 'bright' },
          { x: 1, y: 0, visibility: 'remembered', terrain: 'floor_stone' },
          { x: 2, y: 0, visibility: 'unexplored' },
          { x: 3, y: 0, visibility: 'unexplored' },
        ],
      };

      const { getByTestId, unmount } = render(
        <TacticalCanvasViewport
          grid={pvg}
          cellSize={48}
          enableFogOfWar={true}
          testId="tactical-fog-viewport"
        />,
      );

      const viewport = getByTestId('tactical-fog-viewport');
      expect(viewport).toBeDefined();
      expect(viewport.querySelector('canvas')).toBeDefined();

      unmount();
    });

    it('supports custom fogOfWar options and disabling Fog-of-War', () => {
      const grid = createTacticalGrid(6, 6, 'floor_stone', 'darkness');
      const combatants: CreatureTokenData[] = [
        {
          id: 'ranger-1',
          name: 'Ranger',
          side: 'party',
          size: 'medium',
          position: { x: 1, y: 1 },
          currentHp: 20,
          maxHp: 20,
          characterSheet: { darkvisionFeet: 60 } as any,
        },
      ];

      const customOptions: FogOfWarOptions = {
        enabled: true,
        showDarkvisionTint: true,
        showFogBorders: true,
        lightSources: [{ x: 1, y: 1, brightFeet: 20, dimFeet: 20 }],
      };

      const { getByTestId, rerender, unmount } = render(
        <TacticalCanvasViewport
          grid={grid}
          combatants={combatants}
          fogOfWar={customOptions}
          enableFogOfWar={true}
          testId="fog-custom-viewport"
        />,
      );

      expect(getByTestId('fog-custom-viewport')).toBeDefined();

      // Disable fog of war dynamically
      rerender(
        <TacticalCanvasViewport
          grid={grid}
          combatants={combatants}
          fogOfWar={customOptions}
          enableFogOfWar={false}
          testId="fog-custom-viewport"
        />,
      );

      expect(getByTestId('fog-custom-viewport')).toBeDefined();
      unmount();
    });
  });
});
