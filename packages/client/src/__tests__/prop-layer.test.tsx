import React from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { PropKind, PropState } from '@srd5/engine';
import {
  KENNEY_SPRITE_FRAMES,
  PropRenderer,
  TacticalCanvasViewport,
  resolvePropFrameKey,
  type CanvasPropInput,
} from '../canvas/index.js';

function makeProp(
  id: string,
  kind: PropKind,
  x: number,
  y: number,
  state: PropState = 'closed',
  discovered?: boolean,
): CanvasPropInput {
  return {
    id,
    x,
    y,
    kind,
    state,
    ...(discovered === undefined ? {} : { discovered }),
  };
}

describe('SRD-502: PixiJS Interactive Prop Layer (doors, chests, traps, stairs)', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  describe('resolvePropFrameKey', () => {
    it('maps door states to distinct open/closed frames', () => {
      expect(resolvePropFrameKey('door', 'closed')).toBe('door_closed');
      expect(resolvePropFrameKey('door', 'locked')).toBe('door_locked');
      expect(resolvePropFrameKey('door', 'open')).toBe('door_open');
      expect(resolvePropFrameKey('door', 'destroyed')).toBe('door_open');
    });

    it('maps chest open/closed, stairs, shrine, and trap frames', () => {
      expect(resolvePropFrameKey('chest', 'closed')).toBe('chest_closed');
      expect(resolvePropFrameKey('chest', 'open')).toBe('chest_open');
      expect(resolvePropFrameKey('trap', 'closed')).toBe('trap_spikes');
      expect(resolvePropFrameKey('stairs_down', 'open')).toBe('stairs_down');
      expect(resolvePropFrameKey('stairs_up', 'closed')).toBe('stairs_up');
      expect(resolvePropFrameKey('shrine', 'open')).toBe('shrine');
    });

    it('resolves secret doors to the closed frame and levers to procedural-only', () => {
      expect(resolvePropFrameKey('secret_door', 'closed')).toBe('door_closed');
      expect(resolvePropFrameKey('lever', 'closed')).toBeNull();
    });
  });

  describe('atlas frame regression (tilemap_packed.png)', () => {
    it('points door_open at the dark archway tile, distinct from closed doors', () => {
      expect(KENNEY_SPRITE_FRAMES.door_open).toEqual({ x: 9 * 16, y: 3 * 16, width: 16, height: 16 });
      expect(KENNEY_SPRITE_FRAMES.door_closed).toEqual({ x: 10 * 16, y: 3 * 16, width: 16, height: 16 });
      expect(KENNEY_SPRITE_FRAMES.door_open).not.toEqual(KENNEY_SPRITE_FRAMES.door_closed);
    });
  });

  describe('PropRenderer', () => {
    it('renders one node per visible prop with kind/state-distinct icons', () => {
      const parent = new Container();
      const renderer = new PropRenderer(parent);

      const props: CanvasPropInput[] = [
        makeProp('door-1', 'door', 6, 3, 'closed'),
        makeProp('door-2', 'door', 9, 7, 'locked'),
        makeProp('door-3', 'door', 12, 4, 'open'),
        makeProp('chest-1', 'chest', 8, 13, 'closed'),
        makeProp('trap-1', 'trap', 14, 4, 'closed', true),
        makeProp('stairs-1', 'stairs_down', 1, 12, 'open'),
        makeProp('stairs-2', 'stairs_up', 2, 2, 'open'),
        makeProp('shrine-1', 'shrine', 5, 5, 'open'),
        makeProp('lever-1', 'lever', 3, 3, 'closed'),
      ];
      renderer.render({ props, cellSize: 48 });

      expect(renderer.container.children.length).toBe(props.length);
      for (const prop of props) {
        const node = renderer.container.children.find((c) => c.label === `PropNode:${prop.id}`);
        expect(node).toBeDefined();
        // Procedural fallback (atlas not loaded in tests): first child is Graphics.
        expect((node as Container).children[0]).toBeInstanceOf(Graphics);
      }

      renderer.destroy();
    });

    it('hides undiscovered traps and secret doors but shows discovered ones', () => {
      const parent = new Container();
      const renderer = new PropRenderer(parent);

      renderer.render({
        props: [
          makeProp('trap-hidden', 'trap', 1, 1, 'closed'),
          makeProp('trap-hidden-false', 'trap', 1, 2, 'closed', false),
          makeProp('trap-found', 'trap', 1, 3, 'closed', true),
          makeProp('sdoor-hidden', 'secret_door', 2, 1, 'closed'),
          makeProp('sdoor-found', 'secret_door', 2, 2, 'closed', true),
          makeProp('door-plain', 'door', 2, 3, 'closed'),
        ],
        cellSize: 48,
      });

      const labels = renderer.container.children.map((c) => c.label);
      expect(labels).not.toContain('PropNode:trap-hidden');
      expect(labels).not.toContain('PropNode:trap-hidden-false');
      expect(labels).toContain('PropNode:trap-found');
      expect(labels).not.toContain('PropNode:sdoor-hidden');
      expect(labels).toContain('PropNode:sdoor-found');
      expect(labels).toContain('PropNode:door-plain');

      renderer.destroy();
    });

    it('adds a lock badge for locked props and dims discovered secret doors', () => {
      const parent = new Container();
      const renderer = new PropRenderer(parent);

      renderer.render({
        props: [
          makeProp('door-locked', 'door', 0, 0, 'locked'),
          makeProp('sdoor', 'secret_door', 1, 0, 'closed', true),
        ],
        cellSize: 48,
      });

      const locked = renderer.container.children.find((c) => c.label === 'PropNode:door-locked') as Container;
      expect(locked.children.some((c) => c.label === 'PropLockBadge')).toBe(true);

      const sdoor = renderer.container.children.find((c) => c.label === 'PropNode:sdoor') as Container;
      expect(sdoor.children[0].alpha).toBeLessThan(1);

      renderer.destroy();
    });

    it('uses atlas sprites when textures are available', () => {
      const parent = new Container();
      const renderer = new PropRenderer(parent);

      renderer.render({
        props: [makeProp('door-1', 'door', 0, 0, 'closed')],
        cellSize: 48,
        getTexture: () => Texture.WHITE,
      });

      const node = renderer.container.children.find((c) => c.label === 'PropNode:door-1') as Container;
      expect(node.children[0]).toBeInstanceOf(Sprite);

      renderer.destroy();
    });

    it('caches identical renders and rebuilds on state change', () => {
      const parent = new Container();
      const renderer = new PropRenderer(parent);
      const props = [makeProp('door-1', 'door', 6, 3, 'closed')];

      renderer.render({ props, cellSize: 48 });
      const firstNode = renderer.container.children[0];
      const firstChildCount = renderer.container.children.length;

      renderer.render({ props, cellSize: 48 });
      expect(renderer.container.children.length).toBe(firstChildCount);
      expect(renderer.container.children[0]).toBe(firstNode);

      renderer.render({ props: [makeProp('door-1', 'door', 6, 3, 'open')], cellSize: 48 });
      expect(renderer.container.children.length).toBe(1);
      expect(renderer.container.children[0]).not.toBe(firstNode);

      renderer.destroy();
    });
  });

  describe('<TacticalCanvasViewport /> with props', () => {
    it('accepts interactive props without crashing', () => {
      render(
        <TacticalCanvasViewport
          grid={{ width: 18, height: 16, cells: [] } as never}
          props={[
            { id: 'door-1', x: 6, y: 3, kind: 'door', state: 'closed', blocksMovement: true, blocksSight: true },
          ]}
          testId="prop-viewport"
        />,
      );

      expect(screen.getByTestId('prop-viewport')).toBeDefined();
      expect(screen.getByTestId('prop-viewport-canvas')).toBeDefined();
    });
  });
});
