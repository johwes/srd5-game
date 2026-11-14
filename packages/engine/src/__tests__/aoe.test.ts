import { describe, expect, it } from 'vitest';
import {
  footprintBoundaryOrigin,
  intersectionFeet,
  rasterizeAoe,
  rasterizeCone,
  rasterizeCube,
  rasterizeCylinder,
  rasterizeLine,
  rasterizeSphere,
} from '../grid/index.js';

describe('AOE rasterizers', () => {
  it('20-ft radius sphere (Fireball) on an intersection covers 8x8 minus corners = 52 cells', () => {
    const cells = rasterizeSphere(intersectionFeet(10, 10), 20);
    // centers at odd multiples of 2.5; count of (i,j) half-integers with hypot<=4 cells
    expect(cells.length).toBe(52);
    expect(cells).toContainEqual({ x: 10, y: 10 });
    expect(cells).not.toContainEqual({ x: 6, y: 6 });
  });

  it('5-ft radius sphere on an intersection covers the 4 adjacent cells', () => {
    expect(rasterizeSphere(intersectionFeet(3, 3), 5)).toHaveLength(4);
  });

  it('cylinder has sphere footprint and keeps height', () => {
    const r = rasterizeCylinder(intersectionFeet(0, 0), 10, 40);
    expect(r.cells).toEqual(rasterizeSphere(intersectionFeet(0, 0), 10));
    expect(r.heightFeet).toBe(40);
  });

  it('15-ft cube covers 3x3 = 9 cells in each cardinal facing', () => {
    for (const f of ['n', 'e', 's', 'w'] as const) {
      const cells = rasterizeCube(intersectionFeet(10, 10), 15, f);
      expect(cells).toHaveLength(9);
    }
    const east = rasterizeCube(intersectionFeet(10, 10), 15, 'e');
    expect(Math.min(...east.map((c) => c.x))).toBe(10);
    expect(Math.max(...east.map((c) => c.x))).toBe(12);
    const north = rasterizeCube(intersectionFeet(10, 10), 10, 'n');
    expect(north).toHaveLength(4);
    expect(Math.max(...north.map((c) => c.y))).toBe(9);
  });

  it('cone widens with distance and respects length', () => {
    const origin = footprintBoundaryOrigin({ x: 0, y: 0 }, 1, { x: 100, y: 2.5 });
    expect(origin).toEqual({ x: 5, y: 2.5 });
    const cells = rasterizeCone(origin, { x: 1, y: 0 }, 15);
    const perCol = (x: number) => cells.filter((c) => c.x === x).length;
    expect(perCol(1)).toBe(1);
    expect(perCol(2)).toBe(1);
    expect(perCol(3)).toBe(3);
    expect(cells.some((c) => c.x >= 4)).toBe(false);
  });

  it('cone is symmetric under 90-degree rotation of direction', () => {
    const e = rasterizeCone({ x: 0, y: 0 }, { x: 1, y: 0 }, 30);
    const s = rasterizeCone({ x: 0, y: 0 }, { x: 0, y: 1 }, 30);
    expect(e.length).toBe(s.length);
  });

  it('line of 30 ft x 5 ft along an axis covers 6 cells', () => {
    const cells = rasterizeLine({ x: 5, y: 2.5 }, { x: 50, y: 2.5 }, 30, 5);
    expect(cells).toHaveLength(6);
    expect(cells.every((c) => c.y === 0)).toBe(true);
  });

  it('wider line (10 ft) covers 2 rows', () => {
    const cells = rasterizeLine({ x: 0, y: 5 }, { x: 100, y: 5 }, 20, 10);
    expect(cells).toHaveLength(8);
  });

  it('rasterizeAoe dispatches by shape', () => {
    const o = intersectionFeet(5, 5);
    expect(rasterizeAoe({ shape: 'sphere', origin: o, radiusFeet: 5 })).toHaveLength(4);
    expect(() =>
      rasterizeAoe({ shape: 'cone', origin: o, direction: { x: 0, y: 0 }, lengthFeet: 15 }),
    ).toThrow();
  });
});
