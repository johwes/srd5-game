import { Container, Graphics, Text } from 'pixi.js';
import type { HazardZone } from '@srd5/engine';
import type { Point } from '../types.js';

export interface HazardZoneRenderOptions {
  zones: readonly HazardZone[];
  cellSize: number;
}

type HazardVisualFamily =
  | 'slick'
  | 'webs'
  | 'thorns'
  | 'fog'
  | 'flames'
  | 'radiant'
  | 'frost'
  | 'mind'
  | 'arcane';

interface HazardFamilyStyle {
  fill: number;
  fillAlpha: number;
  edge: number;
}

const HAZARD_FAMILY_STYLES: Record<HazardVisualFamily, HazardFamilyStyle> = {
  slick: { fill: 0x4d4425, fillAlpha: 0.72, edge: 0xa89b5c },
  webs: { fill: 0x3f3f46, fillAlpha: 0.6, edge: 0xd4d4d8 },
  thorns: { fill: 0x3f6212, fillAlpha: 0.55, edge: 0x84cc16 },
  fog: { fill: 0x71717a, fillAlpha: 0.4, edge: 0xe4e4e7 },
  flames: { fill: 0xea580c, fillAlpha: 0.62, edge: 0xfde047 },
  radiant: { fill: 0xfbbf24, fillAlpha: 0.34, edge: 0xfef3c7 },
  frost: { fill: 0x7dd3fc, fillAlpha: 0.42, edge: 0xe0f2fe },
  mind: { fill: 0xa855f7, fillAlpha: 0.3, edge: 0xd8b4fe },
  arcane: { fill: 0x8b5cf6, fillAlpha: 0.42, edge: 0xc4b5fd },
};

const FOG_TINT_BY_ZONE: Array<{ match: string; fill: number }> = [
  { match: 'cloudkill', fill: 0xa3a32a },
  { match: 'stink', fill: 0x6b7c2a },
  { match: 'darkness', fill: 0x000000 },
  { match: 'silence', fill: 0x93c5fd },
];

/**
 * Maps an engine zoneId (e.g. "grease-zone", "web-zone", "spike-growth-zone")
 * to a canvas visual family.
 */
export function hazardVisualFamilyOf(zoneId: string): HazardVisualFamily {
  const id = zoneId.toLowerCase();
  if (id.includes('grease')) return 'slick';
  if (id.includes('web') || id.includes('entangle') || id.includes('tentacle')) return 'webs';
  if (id.includes('spike') || id.includes('thorn')) return 'thorns';
  if (id.includes('cloud') || id.includes('darkness') || id.includes('silence') || id.includes('stink'))
    return 'fog';
  if (id.includes('fire') || id.includes('flam')) return 'flames';
  if (id.includes('spirit') || id.includes('guardian') || id.includes('hallow')) return 'radiant';
  if (id.includes('ice') || id.includes('frost') || id.includes('freez') || id.includes('sleet'))
    return 'frost';
  if (id.includes('confus') || id.includes('fear') || id.includes('hypnot')) return 'mind';
  return 'arcane';
}

/**
 * Renders persistent spell hazard zones (Grease, Web, Spike Growth, Cloudkill,
 * Wall of Fire, Darkness, …) as canvas ground overlays so ongoing effects are
 * visible on the board instead of living only in the combat log.
 */
export class HazardZoneRenderer {
  public readonly container: Container;

  constructor(parent?: Container) {
    this.container = new Container();
    this.container.label = 'HazardZoneRenderer';
    if (parent) {
      parent.addChild(this.container);
    }
  }

  public render(options: HazardZoneRenderOptions): void {
    const { zones, cellSize } = options;
    this.container.removeChildren().forEach((c) => c.destroy({ children: true }));

    for (const zone of zones) {
      this.drawZone(zone, cellSize);
    }
  }

  private drawZone(zone: HazardZone, cellSize: number): void {
    if (zone.cells.length === 0) return;

    const family = hazardVisualFamilyOf(zone.zoneId);
    const style = { ...HAZARD_FAMILY_STYLES[family] };

    if (family === 'fog') {
      const tint = FOG_TINT_BY_ZONE.find((t) => zone.zoneId.toLowerCase().includes(t.match));
      if (tint) style.fill = tint.fill;
    }

    const inZone = new Set(zone.cells.map((c) => `${c.x},${c.y}`));
    const g = new Graphics();
    g.label = `Hazard_${zone.id}`;

    for (const cell of zone.cells) {
      const px = cell.x * cellSize;
      const py = cell.y * cellSize;
      const hash = Math.abs(cell.x * 7 + cell.y * 13);

      g.rect(px, py, cellSize, cellSize).fill({ color: style.fill, alpha: style.fillAlpha });

      this.drawCellDetail(g, family, hash, px, py, cellSize);

      // Edge outline only where the neighbor cell is outside this zone,
      // so multi-cell zones read as one connected hazard.
      const edge = (nx: number, ny: number) => !inZone.has(`${nx},${ny}`);
      const w = 2;
      if (edge(cell.x, cell.y - 1)) {
        g.moveTo(px, py + 1).lineTo(px + cellSize, py + 1).stroke({ color: style.edge, width: w, alpha: 0.9 });
      }
      if (edge(cell.x, cell.y + 1)) {
        g.moveTo(px, py + cellSize - 1).lineTo(px + cellSize, py + cellSize - 1).stroke({ color: style.edge, width: w, alpha: 0.9 });
      }
      if (edge(cell.x - 1, cell.y)) {
        g.moveTo(px + 1, py).lineTo(px + 1, py + cellSize).stroke({ color: style.edge, width: w, alpha: 0.9 });
      }
      if (edge(cell.x + 1, cell.y)) {
        g.moveTo(px + cellSize - 1, py).lineTo(px + cellSize - 1, py + cellSize).stroke({ color: style.edge, width: w, alpha: 0.9 });
      }
    }

    this.container.addChild(g);

    // Small source label at the zone's top-left cell for identifiability.
    const anchor = zone.cells[0]!;
    const label = new Text({
      text: zone.sourceName,
      style: {
        fontFamily: 'sans-serif',
        fontSize: 9,
        fontWeight: 'bold',
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 3 },
        align: 'left',
      },
    });
    label.label = `HazardLabel_${zone.id}`;
    label.position.set(anchor.x * cellSize + 3, anchor.y * cellSize + 2);
    label.alpha = 0.9;
    this.container.addChild(label);
  }

  private drawCellDetail(
    g: Graphics,
    family: HazardVisualFamily,
    hash: number,
    px: number,
    py: number,
    cellSize: number,
  ): void {
    switch (family) {
      case 'slick': {
        // Grease sheen: diagonal highlight streaks
        g.moveTo(px + 6, py + cellSize - 6)
          .lineTo(px + cellSize - 6, py + 6)
          .stroke({ color: 0xd6c56a, width: 2, alpha: 0.55 });
        g.moveTo(px + 10, py + cellSize - 4)
          .lineTo(px + cellSize - 4, py + 10)
          .stroke({ color: 0x8a7d3c, width: 1, alpha: 0.5 });
        break;
      }
      case 'webs': {
        // Web strands radiating from the cell center to the corners
        const cx = px + cellSize / 2;
        const cy = py + cellSize / 2;
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          g.moveTo(cx, cy)
            .lineTo(cx + dx * (cellSize / 2 - 2), cy + dy * (cellSize / 2 - 2))
            .stroke({ color: 0xe4e4e7, width: 1, alpha: 0.75 });
        }
        g.circle(cx, cy, 2).fill({ color: 0xe4e4e7, alpha: 0.8 });
        break;
      }
      case 'thorns': {
        // Spike Growth barbs: small triangles scattered per cell
        const spikes: Array<[number, number]> = [
          [10 + (hash % 9), 12 + ((hash >> 2) % 9)],
          [cellSize - 12 - (hash % 8), 9 + ((hash >> 3) % 10)],
          [12 + ((hash >> 4) % 8), cellSize - 11 - (hash % 7)],
        ];
        for (const [dx, dy] of spikes) {
          g.moveTo(px + dx - 3, py + dy + 3)
            .lineTo(px + dx, py + dy - 3)
            .lineTo(px + dx + 3, py + dy + 3)
            .closePath()
            .fill({ color: 0x4d7c0f, alpha: 0.9 });
        }
        break;
      }
      case 'fog': {
        // Drifting vapor wisps
        g.moveTo(px + 5, py + cellSize / 2)
          .lineTo(px + cellSize - 5, py + cellSize / 2 - 3 + (hash % 5))
          .stroke({ color: 0xffffff, width: 1.5, alpha: 0.35 });
        g.moveTo(px + 5, py + cellSize / 2 + 7)
          .lineTo(px + cellSize - 5, py + cellSize / 2 + 4 - (hash % 4))
          .stroke({ color: 0xffffff, width: 1, alpha: 0.25 });
        break;
      }
      case 'flames': {
        // Ember veins over the molten fill
        g.moveTo(px + 6, py + 8 + (hash % 10))
          .lineTo(px + cellSize - 6, py + cellSize - 8 - (hash % 10))
          .stroke({ color: 0xfde047, width: 1.5, alpha: 0.9 });
        g.moveTo(px + 8 + ((hash >> 2) % 10), py + 5)
          .lineTo(px + cellSize - 8 - ((hash >> 2) % 10), py + cellSize - 5)
          .stroke({ color: 0xfef9c3, width: 1, alpha: 0.7 });
        break;
      }
      case 'radiant': {
        // Spirit Guardians shimmer: small dotted halo
        g.circle(px + 8 + (hash % 9), py + 8 + ((hash >> 2) % 9), 1.6).fill({ color: 0xfffbeb, alpha: 0.85 });
        g.circle(px + cellSize - 8 - (hash % 8), py + cellSize - 8 - ((hash >> 3) % 8), 1.6).fill({
          color: 0xfffbeb,
          alpha: 0.85,
        });
        break;
      }
      case 'frost': {
        // Ice Storm rubble: pale shards
        g.moveTo(px + 8 + (hash % 10), py + 6)
          .lineTo(px + 12 + (hash % 10), py + cellSize - 6)
          .stroke({ color: 0xe0f2fe, width: 1.5, alpha: 0.8 });
        g.moveTo(px + 5, py + 10 + ((hash >> 2) % 8))
          .lineTo(px + cellSize - 5, py + 14 + ((hash >> 2) % 8))
          .stroke({ color: 0xe0f2fe, width: 1, alpha: 0.6 });
        break;
      }
      case 'mind': {
        // Confusion haze: faint spiral dots
        g.circle(px + cellSize / 2, py + cellSize / 2, 2.5).stroke({ color: 0xd8b4fe, width: 1, alpha: 0.7 });
        g.circle(px + cellSize / 2, py + cellSize / 2, 5).stroke({ color: 0xd8b4fe, width: 1, alpha: 0.4 });
        break;
      }
      case 'arcane': {
        g.circle(px + cellSize / 2, py + cellSize / 2, 3).stroke({ color: 0xc4b5fd, width: 1.5, alpha: 0.8 });
        break;
      }
    }
  }

  public destroy(): void {
    this.container.destroy({ children: true });
  }
}
