import { Container, Graphics, Sprite } from 'pixi.js';
import type { PropKind, PropState } from '@srd5/engine';
import type { PlayerViewProp } from '@srd5/transport';
import { assetRegistry } from '../assets/index.js';
import type { CanvasPropInput, PropRenderOptions } from '../types.js';

type PropRecord = CanvasPropInput | PlayerViewProp;

/**
 * Maps an interactive prop kind + state to a Kenney Tiny Dungeon atlas frame
 * key. Returns `null` for kinds with no verified atlas tile (lever) — those
 * always render procedurally.
 */
export function resolvePropFrameKey(kind: PropKind, state: PropState): string | null {
  switch (kind) {
    case 'door':
      if (state === 'open') return 'door_open';
      if (state === 'locked') return 'door_locked';
      if (state === 'destroyed') return 'door_open';
      return 'door_closed';
    case 'secret_door':
      return 'door_closed';
    case 'chest':
      return state === 'open' ? 'chest_open' : 'chest_closed';
    case 'trap':
      return 'trap_spikes';
    case 'stairs_down':
      return 'stairs_down';
    case 'stairs_up':
      return 'stairs_up';
    case 'shrine':
      return 'shrine';
    case 'furniture':
      // Procedural per-type glyphs (no single atlas tile covers all kinds).
      return null;
    case 'lever':
    default:
      return null;
  }
}

/**
 * Renders interactive dungeon props (doors, chests, traps, stairs, shrines,
 * levers) into the scene graph `propLayer` — the layer that previously had a
 * container but no renderer, so props were invisible on the tactical canvas.
 *
 * Follows the 3-tier asset strategy: Kenney atlas sprite when the texture is
 * loaded and valid, otherwise a procedural vector icon (always drawn, so a
 * prop can never be invisible again). Fog projection already strips
 * unexplored props and undiscovered traps/secret doors from the player view;
 * the renderer additionally skips trap/secret_door records that are
 * explicitly undiscovered so direct `GameState` usage never leaks them.
 */
export class PropRenderer {
  public readonly container: Container;
  private lastSignature: string | null = null;

  constructor(parent?: Container) {
    this.container = new Container();
    this.container.label = 'PropRenderer';

    if (parent) {
      parent.addChild(this.container);
    }
  }

  public render(options: PropRenderOptions): void {
    const { props, cellSize } = options;
    const getTexture =
      options.getTexture ?? ((key: string) => assetRegistry.getTexture(key));

    const visible = props.filter((p) => {
      if ((p.kind === 'trap' || p.kind === 'secret_door') && p.discovered !== true) {
        return false;
      }
      return true;
    });

    const signature = [
      cellSize,
      visible
        .map((p) => `${p.id}:${p.x},${p.y}:${p.kind}:${p.state}:${p.discovered === true ? 'd' : ''}`)
        .join(','),
    ].join('|');

    if (this.lastSignature === signature) return;
    this.lastSignature = signature;

    this.container.removeChildren().forEach((c) => c.destroy());

    for (const prop of visible) {
      const node = new Container();
      node.label = `PropNode:${prop.id}`;
      node.position.set((prop.x + 0.5) * cellSize, (prop.y + 0.5) * cellSize);
      // Visual only: cell clicks keep flowing to the canvas handlers in DungeonView.
      node.eventMode = 'none';

      const frameKey = resolvePropFrameKey(prop.kind, prop.state);
      const texture = frameKey ? getTexture(frameKey) : undefined;
      const hasValidTexture =
        Boolean(texture) &&
        Boolean(texture?.orig && texture.orig.width > 0 && texture.orig.height > 0);

      if (hasValidTexture && texture) {
        const sprite = new Sprite(texture);
        sprite.label = 'PropSprite';
        sprite.anchor.set(0.5, 0.5);
        const size = cellSize * 0.94;
        sprite.width = size;
        sprite.height = size;
        if (prop.kind === 'secret_door') sprite.alpha = 0.6;
        node.addChild(sprite);
      } else {
        const fallback = this.drawProceduralIcon(prop.kind, prop.state, cellSize, prop.furnitureType);
        if (prop.kind === 'secret_door') fallback.alpha = 0.6;
        node.addChild(fallback);
      }

      // Locked overlay reads on top of either tier.
      if (prop.state === 'locked') {
        node.addChild(this.drawLockBadge(cellSize));
      }

      this.container.addChild(node);
    }
  }

  /**
   * Procedural Tier-3 vector icon. Guaranteed visible with no atlas loaded
   * (headless tests, CDN failure) and the fallback while textures stream in.
   */
  public drawProceduralIcon(
    kind: PropKind,
    state: PropState,
    cellSize: number,
    furnitureType?: string,
  ): Graphics {
    const g = new Graphics();
    g.label = `PropIcon:${kind}:${state}`;
    const h = cellSize / 2;

    switch (kind) {
      case 'door':
      case 'secret_door': {
        if (state === 'open' || state === 'destroyed') {
          // Dark passage opening with a swung leaf edge.
          g.rect(-h + 4, -h + 2, cellSize - 8, cellSize - 4).fill(0x020617);
          g.rect(-h + 4, -h + 2, 6, cellSize - 4).fill(0x7c4a21);
          g.moveTo(-h + 10, -h + 2)
            .lineTo(-h + 22, h - 6)
            .stroke({ color: 0xa16207, width: 3, alpha: 0.95 });
        } else {
          // Closed slab: frame, plank panel, seams, knob.
          g.rect(-h + 3, -h + 2, cellSize - 6, cellSize - 4).fill(0x1c0f08);
          g.rect(-h + 6, -h + 5, cellSize - 12, cellSize - 10).fill(0x7c4a21);
          g.moveTo(-2, -h + 5)
            .lineTo(-2, h - 5)
            .stroke({ color: 0x451a03, width: 2, alpha: 0.9 });
          g.circle(h - 12, 0, 2.6).fill(0xfbbf24);
        }
        if (kind === 'secret_door') {
          // Faint seams mark a found (but still hidden-looking) door.
          g.moveTo(0, -h + 8)
            .lineTo(0, -2)
            .stroke({ color: 0x22d3ee, width: 1.5, alpha: 0.8 });
          g.moveTo(0, 2)
            .lineTo(0, h - 8)
            .stroke({ color: 0x22d3ee, width: 1.5, alpha: 0.8 });
        }
        break;
      }
      case 'chest': {
        const w = cellSize * 0.68;
        const boxH = cellSize * 0.42;
        if (state === 'open') {
          g.rect(-w / 2, -2, w, boxH).fill(0x020617);
          g.rect(-w / 2, -boxH - 2, w, 8).fill(0x92400e);
          g.rect(-w / 2, -2, w, boxH).stroke({ color: 0x451a03, width: 2 });
        } else {
          g.rect(-w / 2, -boxH / 2, w, boxH).fill(0x8a5a2b);
          g.rect(-w / 2, -boxH / 2, w, boxH).stroke({ color: 0x451a03, width: 2 });
          g.rect(-w / 2, -boxH / 2, w, 8).fill(0x92400e);
          g.rect(-3, -3, 6, 7).fill(0xfbbf24);
        }
        break;
      }
      case 'trap': {
        const armed = state !== 'disarmed' && state !== 'triggered';
        const color = armed ? 0xcbd5e1 : 0x64748b;
        const alpha = armed ? 1 : 0.55;
        g.rect(-h + 6, h - 12, cellSize - 12, 7).fill({ color: 0x020617, alpha });
        for (let i = 0; i < 3; i++) {
          const cx = -h + 12 + i * ((cellSize - 24) / 2);
          const spikeH = armed ? cellSize * 0.34 : cellSize * 0.14;
          g.poly([cx - 6, h - 12, cx, h - 12 - spikeH, cx + 6, h - 12]).fill({
            color,
            alpha,
          });
        }
        if (armed) {
          g.rect(-h + 4, -h + 4, cellSize - 8, cellSize - 8).stroke({
            color: 0xef4444,
            width: 1.5,
            alpha: 0.5,
          });
        }
        break;
      }
      case 'stairs_down':
      case 'stairs_up': {
        const up = kind === 'stairs_up';
        const accent = up ? 0x34d399 : 0xfbbf24;
        for (let i = 0; i < 3; i++) {
          const y = -h + 12 + i * ((cellSize - 24) / 2);
          g.rect(-h + 10, y, cellSize - 20, 4).fill(0x94a3b8);
        }
        const cy = up ? -h + 6 : h - 6;
        const dir = up ? -1 : 1;
        g.moveTo(-8, cy - dir * 6)
          .lineTo(0, cy + dir * 4)
          .lineTo(8, cy - dir * 6)
          .stroke({ color: accent, width: 3, alpha: 0.95 });
        g.rect(-h + 4, -h + 4, cellSize - 8, cellSize - 8).stroke({
          color: accent,
          width: 1.5,
          alpha: 0.6,
        });
        break;
      }
      case 'shrine': {
        g.circle(0, 0, cellSize * 0.3).fill({ color: 0x7c3aed, alpha: 0.22 });
        g.poly([0, -12, 9, 0, 0, 12, -9, 0]).fill(0x8b5cf6);
        g.circle(0, 0, 3).fill(0xf5f3ff);
        break;
      }
      case 'lever': {
        g.rect(-10, 2, 20, 6).fill(0x334155);
        g.moveTo(0, 4)
          .lineTo(8, -12)
          .stroke({ color: 0x94a3b8, width: 3 });
        g.circle(9, -13, 3.5).fill(0xef4444);
        break;
      }
      case 'furniture': {
        // SRD-512 per-type glyphs, sized to the 5-ft cell.
        switch (furnitureType) {
          case 'throne': {
            g.rect(-11, -14, 22, 28).fill(0x713f12);
            g.rect(-11, -14, 22, 6).fill(0xfbbf24);
            g.rect(-7, -4, 14, 10).fill(0x7c2d12);
            g.circle(0, 2, 2.5).fill(0xfde68a);
            break;
          }
          case 'bookshelf': {
            g.rect(-14, -12, 28, 26).fill(0x57300f);
            for (const sy of [-6, 1, 8]) {
              g.rect(-12, sy, 24, 2).fill(0x2b1a08);
              g.rect(-12, sy - 4, 5, 4).fill(0xb45309);
              g.rect(-5, sy - 4, 5, 4).fill(0x0369a1);
              g.rect(2, sy - 4, 8, 4).fill(0x15803d);
            }
            break;
          }
          case 'wardrobe':
          case 'curtains':
          case 'alcove': {
            // Hide-capable cover: wardrobe body + concealment chevrons.
            g.rect(-12, -14, 24, 28).fill(0x3f2d1e);
            g.moveTo(-12, 0).lineTo(12, 0).stroke({ color: 0x1c0f08, width: 2 });
            g.moveTo(-6, -14).lineTo(-6, 14).stroke({ color: 0x1c0f08, width: 2 });
            g.moveTo(6, -14).lineTo(6, 14).stroke({ color: 0x1c0f08, width: 2 });
            g.circle(-6, 0, 1.6).fill(0xd6d3d1);
            g.circle(6, 0, 1.6).fill(0xd6d3d1);
            break;
          }
          case 'altar': {
            g.rect(-13, 2, 26, 12).fill(0x44403c);
            g.rect(-13, 2, 26, 3).fill(0xa8a29e);
            g.rect(-2, -10, 4, 10).fill(0xf5f5f4);
            g.circle(0, -12, 3).fill({ color: 0xfbbf24, alpha: 0.9 });
            break;
          }
          case 'bed': {
            g.rect(-14, -8, 28, 18).fill(0x78350f);
            g.rect(-14, -8, 9, 18).fill(0xe7e5e4);
            g.rect(-14, -8, 28, 18).stroke({ color: 0x451a03, width: 2 });
            break;
          }
          case 'crate': {
            g.rect(-11, -11, 22, 22).fill(0x8a5a2b);
            g.rect(-11, -11, 22, 22).stroke({ color: 0x451a03, width: 2 });
            g.moveTo(-11, -11).lineTo(11, 11).stroke({ color: 0x451a03, width: 2 });
            g.moveTo(11, -11).lineTo(-11, 11).stroke({ color: 0x451a03, width: 2 });
            break;
          }
          case 'desk':
          case 'table':
          default: {
            g.rect(-14, -6, 28, 6).fill(0x8a5a2b);
            g.rect(-12, 0, 3, 12).fill(0x57300f);
            g.rect(9, 0, 3, 12).fill(0x57300f);
            g.rect(-14, -6, 28, 6).stroke({ color: 0x451a03, width: 1.5 });
            break;
          }
        }
        break;
      }
      default: {
        g.poly([0, -10, 8, 0, 0, 10, -8, 0]).stroke({
          color: 0xfbbf24,
          width: 2,
        });
        break;
      }
    }

    return g;
  }

  /** Red shackle bar marking locked doors and chests. */
  public drawLockBadge(cellSize: number): Graphics {
    const g = new Graphics();
    g.label = 'PropLockBadge';
    const w = Math.max(12, cellSize * 0.3);
    g.roundRect(-w / 2, cellSize / 2 - 12, w, 10, 3).fill(0xdc2626);
    g.circle(0, cellSize / 2 - 7, 2.4).fill(0xfef2f2);
    return g;
  }

  public destroy(): void {
    this.container.destroy({ children: true });
  }
}
