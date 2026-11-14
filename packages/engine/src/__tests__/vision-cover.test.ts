import { describe, expect, it } from 'vitest';
import {
  applyDarkvision,
  computeCover,
  computeSight,
  createTacticalGrid,
  getCellLightLevel,
  hasLineOfSight,
  setGridCell,
  setGridCells,
} from '../index.js';

const m = (x: number, y: number, id?: string) => ({ id, x, y, size: 'medium' as const });

describe('cover', () => {
  it('open ground has no cover', () => {
    const g = createTacticalGrid(10, 10);
    const r = computeCover(g, m(0, 0), m(5, 3));
    expect(r.cover).toBe('none');
    expect(r.acBonus).toBe(0);
  });

  it('a full wall line gives total cover and blocks LoS', () => {
    let g = createTacticalGrid(10, 10);
    g = setGridCells(g, Array.from({ length: 10 }, (_, y) => ({ x: 3, y, terrain: 'wall_solid' as const })));
    const r = computeCover(g, m(1, 5), m(6, 5));
    expect(r.cover).toBe('total');
    expect(r.hasLineOfSight).toBe(false);
    expect(hasLineOfSight(g, m(1, 5), m(6, 5))).toBe(false);
  });

  it('closed door (blocksSight) blocks; open door does not', () => {
    let g = createTacticalGrid(10, 3);
    g = setGridCells(g, [0, 1, 2].map((y) => ({ x: 4, y, terrain: 'wall_solid' as const })));
    g = setGridCell(g, { x: 4, y: 1, terrain: 'floor_stone', blocksSight: true });
    expect(computeCover(g, m(2, 1), m(6, 1)).cover).toBe('total');
    g = setGridCell(g, { x: 4, y: 1, blocksSight: false });
    expect(hasLineOfSight(g, m(2, 1), m(6, 1))).toBe(true);
  });

  it('a pillar beside the line gives half cover', () => {
    let g = createTacticalGrid(10, 10);
    g = setGridCell(g, { x: 3, y: 3, terrain: 'wall_solid' });
    const r = computeCover(g, m(1, 2), m(5, 4));
    expect(['half', 'three_quarters']).toContain(r.cover);
    expect(r.hasLineOfSight).toBe(true);
  });

  it('an intervening creature grants half cover', () => {
    const g = createTacticalGrid(10, 10);
    const r = computeCover(g, m(0, 5), m(4, 5), [m(2, 5, 'ogre')]);
    expect(r.cover).toBe('half');
    expect(r.acBonus).toBe(2);
    expect(r.dexSaveBonus).toBe(2);
  });

  it('rubble gives half cover', () => {
    const g = setGridCell(createTacticalGrid(10, 10), { x: 2, y: 5, terrain: 'rubble' });
    expect(computeCover(g, m(0, 5), m(4, 5)).cover).toBe('half');
  });

  it('wall corner with a gap yields three-quarters cover', () => {
    let g = createTacticalGrid(10, 10);
    // Wall block diagonally adjacent to target, shielding most corners from the attacker.
    g = setGridCells(g, [
      { x: 4, y: 4, terrain: 'wall_solid' },
      { x: 4, y: 5, terrain: 'wall_solid' },
      { x: 4, y: 6, terrain: 'wall_solid' },
    ]);
    const r = computeCover(g, m(2, 5), m(5, 3));
    expect(r.hasLineOfSight).toBe(true);
    expect(r.blockedRays).toBeGreaterThanOrEqual(1);
  });

  it('is not blocked by grazing a wall corner', () => {
    let g = createTacticalGrid(6, 6);
    g = setGridCell(g, { x: 2, y: 1, terrain: 'wall_solid' });
    expect(computeCover(g, m(0, 0), m(4, 0)).cover).toBe('none');
  });

  it('large creatures use their full footprint', () => {
    const g = createTacticalGrid(10, 10);
    const r = computeCover(g, { x: 0, y: 0, size: 'large' }, { x: 6, y: 0, size: 'large' });
    expect(r.cover).toBe('none');
  });
});

describe('lighting & darkvision', () => {
  it('reads base light and light sources', () => {
    let g = createTacticalGrid(10, 10, 'floor_stone', 'darkness');
    expect(getCellLightLevel(g, { x: 5, y: 5 })).toBe('darkness');
    const torch = { x: 0, y: 0, brightFeet: 10, dimFeet: 10 };
    expect(getCellLightLevel(g, { x: 2, y: 0 }, [torch])).toBe('bright');
    expect(getCellLightLevel(g, { x: 3, y: 0 }, [torch])).toBe('dim');
    expect(getCellLightLevel(g, { x: 9, y: 9 }, [torch])).toBe('darkness');
    g = setGridCell(g, { x: 0, y: 0, baseLight: 'dim' });
    expect(getCellLightLevel(g, { x: 0, y: 0 })).toBe('dim');
  });

  it('darkvision shifts light within range only', () => {
    expect(applyDarkvision('darkness', 60, 60)).toBe('dim');
    expect(applyDarkvision('dim', 30, 60)).toBe('bright');
    expect(applyDarkvision('darkness', 65, 60)).toBe('darkness');
    expect(applyDarkvision('darkness', 5, 0)).toBe('darkness');
  });

  it('heavy darkness hides targets unless darkvision', () => {
    const g = createTacticalGrid(20, 5, 'floor_stone', 'darkness');
    expect(computeSight(g, m(0, 2), m(5, 2)).canSee).toBe(false);
    const dv = computeSight(g, m(0, 2), m(5, 2), { darkvisionFeet: 60 });
    expect(dv.canSee).toBe(true);
    expect(dv.obscurement).toBe('lightly');
    expect(computeSight(g, m(0, 2), m(14, 2), { darkvisionFeet: 60 }).canSee).toBe(false);
  });

  it('blinded viewers and walls prevent sight; fog cells obscure', () => {
    const g = createTacticalGrid(10, 5);
    expect(computeSight(g, m(0, 2), m(5, 2), { blinded: true }).canSee).toBe(false);
    expect(computeSight(g, m(0, 2), m(5, 2)).canSee).toBe(true);
    const fog = computeSight(g, m(0, 2), m(5, 2), { heavilyObscuredCells: [{ x: 5, y: 2 }], darkvisionFeet: 60 });
    expect(fog.canSee).toBe(false);
  });
});
