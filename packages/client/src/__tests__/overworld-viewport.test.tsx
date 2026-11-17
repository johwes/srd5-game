import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Container } from 'pixi.js';
import { ViewportCamera } from '../canvas/camera.js';
import {
  OVERWORLD_CELL_SIZE,
  OVERWORLD_TERRAIN_COLORS,
  OverworldMapRenderer,
  createOverworldSceneGraph,
} from '../canvas/layers/OverworldMapLayer.js';
import { OverworldCanvasViewport } from '../canvas/OverworldCanvasViewport.js';
import { createRealmSession } from '../components/realm/realmEngine.js';

/**
 * SRD-805: PixiJS Overworld Viewport tests — scene graph layout, map renderer
 * (terrain / POI markers / party token / caching), camera math, and headless
 * DOM interaction (hover / click / toolbar).
 */

const session = createRealmSession({ seed: 805, width: 48, height: 48 });
const map = session.map;

describe('SRD-805: Overworld Canvas Viewport', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeAll(() => {
    // Stub getContext for clean JSDOM headless testing (Pixi init falls back).
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  afterEach(() => {
    cleanup();
  });

  describe('Scene graph', () => {
    it('creates the overworld layers in bottom-to-top order', () => {
      const stage = new Container();
      const scene = createOverworldSceneGraph(stage);
      expect(scene.viewport.label).toBe('OverworldViewportContainer');
      const labels = scene.viewport.children.map((c) => c.label);
      expect(labels).toEqual([
        'OverworldTerrainLayer',
        'OverworldOverlayLayer',
        'OverworldPoiLayer',
        'OverworldTokenLayer',
        'OverworldTintLayer',
      ]);
      expect(stage.children).toContain(scene.viewport);
    });
  });

  describe('OverworldMapRenderer', () => {
    it('renders terrain, POI markers with labels, and the party token', () => {
      const stage = new Container();
      const scene = createOverworldSceneGraph(stage);
      const renderer = new OverworldMapRenderer(scene);

      renderer.render({
        map,
        cellSize: OVERWORLD_CELL_SIZE,
        partyPosition: session.travel.partyPosition,
        timeOfDay: 'noon',
      });

      // Terrain graphics present.
      expect(scene.terrainLayer.children.length).toBeGreaterThanOrEqual(4);

      // One marker per POI, each with a name label.
      const markers = scene.poiLayer.children[0]!.children;
      expect(markers.length).toBe(Object.keys(map.pois).length);
      for (const poi of Object.values(map.pois)) {
        const marker = markers.find((m) => m.label === `PoiMarker_${poi.id}`);
        expect(marker).toBeDefined();
        expect(marker!.children.some((c) => c.label === `PoiLabel_${poi.id}`)).toBe(true);
      }

      // Party token positioned at the party tile center.
      const token = scene.tokenLayer.children[0]!;
      const half = OVERWORLD_CELL_SIZE / 2;
      expect(token.position.x).toBe(
        session.travel.partyPosition.q * OVERWORLD_CELL_SIZE + half,
      );
      expect(token.position.y).toBe(
        session.travel.partyPosition.r * OVERWORLD_CELL_SIZE + half,
      );
      renderer.destroy();
    });

    it('caches static terrain draws and only redraws when the map changes', () => {
      const stage = new Container();
      const scene = createOverworldSceneGraph(stage);
      const renderer = new OverworldMapRenderer(scene);
      const drawSpy = vi.spyOn(
        renderer as unknown as { drawTerrain: (...args: unknown[]) => void },
        'drawTerrain',
      );

      const options = {
        map,
        cellSize: OVERWORLD_CELL_SIZE,
        partyPosition: session.travel.partyPosition,
        timeOfDay: 'noon' as const,
      };
      renderer.render(options);
      renderer.render(options);
      expect(drawSpy).toHaveBeenCalledTimes(1);

      // Moving the party only redraws dynamic overlays.
      renderer.render({ ...options, partyPosition: { q: 1, r: 1 } });
      expect(drawSpy).toHaveBeenCalledTimes(1);

      // A new map object (e.g. reputation change) redraws terrain.
      renderer.render({ ...options, map: { ...map } });
      expect(drawSpy).toHaveBeenCalledTimes(2);
      renderer.destroy();
    });

    it('marks cleared POIs and exposes the full biome palette', () => {
      expect(Object.keys(OVERWORLD_TERRAIN_COLORS)).toEqual([
        'plains',
        'forest',
        'hills',
        'mountains',
        'swamp',
        'desert',
        'tundra',
        'coast',
        'ocean',
      ]);
      const stage = new Container();
      const scene = createOverworldSceneGraph(stage);
      const renderer = new OverworldMapRenderer(scene);
      const poiId = Object.keys(map.pois)[0]!;
      renderer.render({
        map,
        cellSize: OVERWORLD_CELL_SIZE,
        partyPosition: session.travel.partyPosition,
        clearedPoiIds: [poiId],
      });
      const markers = scene.poiLayer.children[0]!.children;
      expect(markers.find((m) => m.label === `PoiMarker_${poiId}`)).toBeDefined();
      renderer.destroy();
    });
  });

  describe('Camera integration', () => {
    it('fits the macro world grid with the overworld cell size', () => {
      const camera = new ViewportCamera({
        x: 0,
        y: 0,
        zoom: 1,
        cellSize: OVERWORLD_CELL_SIZE,
        minZoom: 0.25,
        maxZoom: 3,
      });
      camera.fitGrid(map.width, map.height, 800, 600, 16);
      const state = camera.getCamera();
      expect(state.zoom).toBeGreaterThan(0);
      // Whole world fits inside the viewport.
      expect(map.width * OVERWORLD_CELL_SIZE * state.zoom).toBeLessThanOrEqual(800);
      expect(map.height * OVERWORLD_CELL_SIZE * state.zoom).toBeLessThanOrEqual(600);
      // Screen -> tile mapping round-trips.
      const cell = camera.screenToCell(
        ...(() => {
          const p = camera.cellToScreen(5, 7);
          return [p.x + 1, p.y + 1] as [number, number];
        })(),
      );
      expect(cell).toEqual({ x: 5, y: 7 });
    });
  });

  describe('Headless DOM interaction', () => {
    it('renders the canvas, toolbar and info ribbon', () => {
      render(
        <OverworldCanvasViewport
          map={map}
          partyPosition={session.travel.partyPosition}
          testId="test-overworld"
        />,
      );
      expect(screen.getByTestId('test-overworld')).toBeDefined();
      expect(screen.getByTestId('test-overworld-canvas')).toBeDefined();
      expect(screen.getByTestId('test-overworld-toolbar')).toBeDefined();
      expect(screen.getByTestId('test-overworld-info-ribbon')).toBeDefined();
      expect(screen.getByTestId('test-overworld-zoom-indicator').textContent).toContain('%');
    });

    it('emits tile hover and click callbacks from mouse events', () => {
      const onTileHover = vi.fn();
      const onTileClick = vi.fn();
      render(
        <OverworldCanvasViewport
          map={map}
          partyPosition={session.travel.partyPosition}
          onTileHover={onTileHover}
          onTileClick={onTileClick}
          testId="test-overworld"
        />,
      );
      const canvas = screen.getByTestId('test-overworld-canvas');
      vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      // Default headless camera: zoom 1, offset (0,0) → tile = floor(px / 24).
      fireEvent.mouseMove(canvas, { clientX: 50, clientY: 74 });
      expect(onTileHover).toHaveBeenCalledWith({ q: 2, r: 3 });

      fireEvent.mouseDown(canvas, { clientX: 50, clientY: 74, button: 0 });
      fireEvent.mouseUp(canvas, { clientX: 50, clientY: 74, button: 0 });
      expect(onTileClick).toHaveBeenCalledWith({ q: 2, r: 3 }, 0);
    });

    it('does not emit click after a drag pan', () => {
      const onTileClick = vi.fn();
      render(
        <OverworldCanvasViewport
          map={map}
          partyPosition={session.travel.partyPosition}
          onTileClick={onTileClick}
          testId="test-overworld"
        />,
      );
      const canvas = screen.getByTestId('test-overworld-canvas');
      vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => {},
      });
      fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100, button: 0 });
      fireEvent.mouseMove(canvas, { clientX: 180, clientY: 140 });
      fireEvent.mouseUp(canvas, { clientX: 180, clientY: 140, button: 0 });
      expect(onTileClick).not.toHaveBeenCalled();
    });

    it('zoom toolbar buttons update the zoom indicator', () => {
      render(
        <OverworldCanvasViewport
          map={map}
          partyPosition={session.travel.partyPosition}
          testId="test-overworld"
        />,
      );
      const indicator = screen.getByTestId('test-overworld-zoom-indicator');
      const before = indicator.textContent;
      fireEvent.click(screen.getByTestId('test-overworld-zoom-in-btn'));
      expect(indicator.textContent).not.toBe(before);
      fireEvent.click(screen.getByTestId('test-overworld-fit-world-btn'));
      expect(screen.getByTestId('test-overworld-center-party-btn')).toBeDefined();
    });
  });
});
