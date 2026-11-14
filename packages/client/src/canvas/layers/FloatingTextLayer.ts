import { Container, Text } from 'pixi.js';
import type { GameEvent } from '@srd5/transport';
import {
  type FloatingTextOptions,
  type FloatingTextType,
  type Point,
} from '../types.js';

/**
 * Styling definitions for categories of floating combat text.
 */
export const FLOATING_TEXT_STYLES: Record<
  FloatingTextType,
  { fill: number; stroke: number; strokeWidth: number; fontSize: number; fontWeight: 'normal' | 'bold' }
> = {
  damage: {
    fill: 0xef4444,
    stroke: 0x000000,
    strokeWidth: 3,
    fontSize: 14,
    fontWeight: 'bold',
  },
  heal: {
    fill: 0x22c55e,
    stroke: 0x000000,
    strokeWidth: 3,
    fontSize: 14,
    fontWeight: 'bold',
  },
  crit: {
    fill: 0xfbbf24,
    stroke: 0x78350f,
    strokeWidth: 3.5,
    fontSize: 16,
    fontWeight: 'bold',
  },
  miss: {
    fill: 0x94a3b8,
    stroke: 0x000000,
    strokeWidth: 2.5,
    fontSize: 13,
    fontWeight: 'bold',
  },
  condition: {
    fill: 0xa855f7,
    stroke: 0x000000,
    strokeWidth: 2.5,
    fontSize: 12,
    fontWeight: 'bold',
  },
  info: {
    fill: 0xf8fafc,
    stroke: 0x0f172a,
    strokeWidth: 2,
    fontSize: 12,
    fontWeight: 'normal',
  },
};

/**
 * Single active floating text item.
 */
export interface FloatingTextItem {
  id: string;
  textNode: Text;
  initialX: number;
  initialY: number;
  driftY: number;
  durationMs: number;
  elapsedMs: number;
}

/**
 * Manages floating combat text, damage numbers, healing, status banners,
 * and hit/miss indicators on Layer 7 (FloatingTextLayer).
 */
export class FloatingTextRenderer {
  public readonly container: Container;
  private activeTexts: FloatingTextItem[] = [];
  private nextId = 1;

  constructor(parent?: Container) {
    this.container = new Container();
    this.container.label = 'FloatingTextRenderer';

    if (parent) {
      parent.addChild(this.container);
    }
  }

  /**
   * Spawns an animated floating text entry at world coordinates.
   */
  public spawnText(options: FloatingTextOptions): FloatingTextItem {
    const {
      text,
      worldX,
      worldY,
      type = 'info',
      color,
      durationMs = 1200,
      driftY = -35,
      fontSize,
    } = options;

    const styleConfig = FLOATING_TEXT_STYLES[type] ?? FLOATING_TEXT_STYLES.info;

    const textNode = new Text({
      text,
      style: {
        fontFamily: 'sans-serif',
        fontSize: fontSize ?? styleConfig.fontSize,
        fontWeight: styleConfig.fontWeight,
        fill: color ?? styleConfig.fill,
        stroke: { color: styleConfig.stroke, width: styleConfig.strokeWidth },
        align: 'center',
      },
    });

    textNode.anchor.set(0.5, 0.5);
    textNode.position.set(worldX, worldY);
    textNode.scale.set(1.25); // Slight initial punch
    this.container.addChild(textNode);

    const item: FloatingTextItem = {
      id: options.id ?? `ftext_${this.nextId++}`,
      textNode,
      initialX: worldX,
      initialY: worldY,
      driftY,
      durationMs,
      elapsedMs: 0,
    };

    this.activeTexts.push(item);
    return item;
  }

  /**
   * Spawns floating text centered on a grid cell.
   */
  public spawnAtCell(
    cell: Point,
    cellSize: number,
    text: string,
    type: FloatingTextType = 'info',
    options?: Partial<FloatingTextOptions>,
  ): FloatingTextItem {
    const worldX = (cell.x + 0.5) * cellSize;
    const worldY = (cell.y + 0.3) * cellSize;
    return this.spawnText({
      text,
      worldX,
      worldY,
      type,
      ...options,
    });
  }

  /**
   * Translates incoming GameEvents into floating combat text.
   */
  public handleGameEvent(
    event: GameEvent,
    getEntityPos: (id: string) => Point | undefined,
    cellSize = 48,
  ): void {
    switch (event.type) {
      case 'DAMAGE_APPLIED': {
        const pos = getEntityPos(event.targetId);
        if (pos) {
          let mod = '';
          if (event.immunityApplied) mod = ' (Immune)';
          else if (event.resistanceApplied) mod = ' (Resist)';
          else if (event.vulnerabilityApplied) mod = ' (Vuln)';
          this.spawnAtCell(
            pos,
            cellSize,
            `-${event.finalAmount} ${event.damageType}${mod}`,
            'damage',
          );
        }
        break;
      }
      case 'HEAL_APPLIED': {
        const pos = getEntityPos(event.targetId);
        if (pos) {
          this.spawnAtCell(pos, cellSize, `+${event.amount} HP`, 'heal');
        }
        break;
      }
      case 'TEMP_HP_APPLIED': {
        const pos = getEntityPos(event.targetId);
        if (pos) {
          this.spawnAtCell(pos, cellSize, `+${event.amount} Temp HP`, 'heal');
        }
        break;
      }
      case 'ATTACK_RESOLVED': {
        const pos = getEntityPos(event.targetId);
        if (pos) {
          if (event.outcome === 'miss') {
            this.spawnAtCell(pos, cellSize, 'MISS', 'miss');
          } else if (event.outcome === 'critical_hit') {
            this.spawnAtCell(pos, cellSize, 'CRITICAL HIT!', 'crit');
          }
        }
        break;
      }
      case 'CONDITION_ADDED': {
        const pos = getEntityPos(event.targetId);
        if (pos) {
          this.spawnAtCell(pos, cellSize, `+${event.conditionId.toUpperCase()}`, 'condition');
        }
        break;
      }
      case 'CONDITION_REMOVED': {
        const pos = getEntityPos(event.targetId);
        if (pos) {
          this.spawnAtCell(pos, cellSize, `-${event.conditionId.toUpperCase()}`, 'info');
        }
        break;
      }
      case 'CONCENTRATION_ENDED': {
        const pos = getEntityPos(event.entityId);
        if (pos) {
          this.spawnAtCell(pos, cellSize, 'CONCENTRATION BROKEN', 'damage');
        }
        break;
      }
      case 'CREATURE_DIED': {
        const pos = getEntityPos(event.entityId);
        if (pos) {
          this.spawnAtCell(pos, cellSize, 'DEFEATED', 'damage');
        }
        break;
      }
    }
  }

  /**
   * Advances animations for all active floating text nodes.
   */
  public update(deltaMs: number): void {
    const remaining: FloatingTextItem[] = [];

    for (const item of this.activeTexts) {
      item.elapsedMs += deltaMs;
      const progress = Math.min(1.0, item.elapsedMs / item.durationMs);

      // 1. Upward vertical drift with ease-out
      const easeOut = 1 - Math.pow(1 - progress, 2);
      item.textNode.position.y = item.initialY + item.driftY * easeOut;

      // 2. Initial scale punch relaxation (1.25 -> 1.0 in first 20% of duration)
      if (progress < 0.2) {
        const scaleProgress = progress / 0.2;
        item.textNode.scale.set(1.25 - 0.25 * scaleProgress);
      } else {
        item.textNode.scale.set(1.0);
      }

      // 3. Alpha fade out in last 40% of duration
      if (progress > 0.6) {
        const fadeProgress = (progress - 0.6) / 0.4;
        item.textNode.alpha = 1.0 - fadeProgress;
      } else {
        item.textNode.alpha = 1.0;
      }

      // Check lifetime
      if (progress >= 1.0) {
        this.container.removeChild(item.textNode);
        item.textNode.destroy();
      } else {
        remaining.push(item);
      }
    }

    this.activeTexts = remaining;
  }

  /**
   * Returns count of currently active floating text items.
   */
  public getActiveCount(): number {
    return this.activeTexts.length;
  }

  /**
   * Immediately clears all active floating texts.
   */
  public clear(): void {
    for (const item of this.activeTexts) {
      this.container.removeChild(item.textNode);
      item.textNode.destroy();
    }
    this.activeTexts = [];
  }

  /**
   * Destroys the container and all children.
   */
  public destroy(): void {
    this.clear();
    this.container.destroy({ children: true });
  }
}
