import React, { createRef } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Container } from 'pixi.js';
import { createTacticalGrid } from '@srd5/engine';
import {
  TacticalCanvasViewport,
  ViewportCamera,
  createSceneGraph,
  TerrainTileRenderer,
  DEFAULT_CELL_SIZE,
  DEFAULT_ZOOM,
  MIN_ZOOM,
  MAX_ZOOM,
  type ViewportCameraControls,
} from '../canvas/index.js';

describe('Tactical Canvas & Viewport', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeAll(() => {
    // Stub getContext for clean JSDOM headless testing
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  describe('ViewportCamera & Coordinate Math', () => {
  it('initializes with default options and clamps zoom', () => {
    const cam = new ViewportCamera();
    expect(cam.getCamera()).toEqual({ x: 0, y: 0, zoom: DEFAULT_ZOOM });
    expect(cam.cellSize).toBe(DEFAULT_CELL_SIZE);
    expect(cam.minZoom).toBe(MIN_ZOOM);
    expect(cam.maxZoom).toBe(MAX_ZOOM);

    const clampedCam = new ViewportCamera({ zoom: 10.0 });
    expect(clampedCam.getCamera().zoom).toBe(MAX_ZOOM);

    const minClamped = new ViewportCamera({ zoom: 0.05 });
    expect(minClamped.getCamera().zoom).toBe(MIN_ZOOM);
  });

  it('pans camera correctly', () => {
    const cam = new ViewportCamera({ x: 10, y: 20 });
    cam.pan(15, -5);
    expect(cam.getCamera()).toEqual({ x: 25, y: 15, zoom: 1.0 });
  });

  it('converts between screen, world, and cell coordinates', () => {
    const cam = new ViewportCamera({ x: 100, y: 50, zoom: 2.0, cellSize: 40 });

    // World point (10, 20): screen = 10 * 2 + 100 = 120, screen = 20 * 2 + 50 = 90
    expect(cam.worldToScreen(10, 20)).toEqual({ x: 120, y: 90 });
    expect(cam.screenToWorld(120, 90)).toEqual({ x: 10, y: 20 });

    // Cell (2, 3) at cellSize 40 -> top-left world (80, 120) -> screen (260, 290)
    expect(cam.cellToScreen(2, 3)).toEqual({ x: 260, y: 290 });

    // Screen (265, 295) -> world (82.5, 122.5) -> cell (2, 3)
    expect(cam.screenToCell(265, 295)).toEqual({ x: 2, y: 3 });
  });

  it('keeps world position anchored under mouse cursor when zooming', () => {
    const cam = new ViewportCamera({ x: 0, y: 0, zoom: 1.0, cellSize: 48 });
    const screenX = 300;
    const screenY = 200;

    const worldBefore = cam.screenToWorld(screenX, screenY);
    cam.zoomAt(screenX, screenY, 0.5); // Zoom to 1.5
    const worldAfter = cam.screenToWorld(screenX, screenY);

    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 4);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 4);
  });

  it('centers camera on specified cell', () => {
    const cam = new ViewportCamera({ zoom: 1.0, cellSize: 40 });
    // Cell (4, 4), cell center is (4.5 * 40, 4.5 * 40) = (180, 180)
    // Viewport 800x600 -> center at (400, 300) -> x = 400 - 180 = 220, y = 300 - 180 = 120
    cam.centerOnCell(4, 4, 800, 600);
    expect(cam.getCamera()).toEqual({ x: 220, y: 120, zoom: 1.0 });
  });

  it('fits entire grid into viewport with padding', () => {
    const cam = new ViewportCamera({ cellSize: 40 });
    // 10x10 cells = 400x400 px
    // Viewport 800x600, padding 0 -> avail 800x600 -> scale = min(800/400, 600/400) = 1.5
    cam.fitGrid(10, 10, 800, 600, 0);
    expect(cam.getCamera().zoom).toBe(1.5);
    // Center of 800 is 400, grid width 400 * 1.5 = 600 -> offset (800 - 600) / 2 = 100
    expect(cam.getCamera().x).toBe(100);
    // Center of 600 is 300, grid height 400 * 1.5 = 600 -> offset (600 - 600) / 2 = 0
    expect(cam.getCamera().y).toBe(0);
  });

  it('applies transform to Pixi container', () => {
    const cam = new ViewportCamera({ x: 50, y: 75, zoom: 1.25 });
    const container = new Container();
    cam.applyToContainer(container);
    expect(container.position.x).toBe(50);
    expect(container.position.y).toBe(75);
    expect(container.scale.x).toBe(1.25);
    expect(container.scale.y).toBe(1.25);
  });
});

describe('PixiJS 7-Layer Scene Graph Hierarchy', () => {
  it('creates the 7 layers under ViewportContainer in exact bottom-to-top order', () => {
    const stage = new Container();
    const sceneGraph = createSceneGraph(stage);

    expect(sceneGraph.viewport.label).toBe('ViewportContainer');
    expect(stage.children).toContain(sceneGraph.viewport);

    // Verify exact layer order and labels
    const layerLabels = sceneGraph.viewport.children.map((c) => c.label);
    expect(layerLabels).toEqual([
      'TerrainTileLayer',
      'HazardZoneLayer',
      'PropLayer',
      'PathAndAoeLayer',
      'CreatureTokenLayer',
      'LightingAndFogLayer',
      'FloatingTextLayer',
    ]);
  });
});

describe('TerrainTileRenderer', () => {
  it('renders diverse terrain tiles, difficult terrain, and grid overlays', () => {
    const parent = new Container();
    const renderer = new TerrainTileRenderer(parent);

    const grid = createTacticalGrid(6, 6, 'floor_stone');
    // Set up various terrain types
    grid.cells[1].terrain = 'wall_solid';
    grid.cells[2].terrain = 'water_shallow';
    grid.cells[3].terrain = 'lava';
    grid.cells[4].terrain = 'rubble';
    grid.cells[5].terrain = 'chasm';
    grid.cells[6].terrain = 'floor_wood';
    grid.cells[7].difficultTerrain = true;

    // Render tiles and overlays
    renderer.render({
      grid,
      cellSize: 48,
      showGridLines: true,
      showCoordinates: true,
      hoveredCell: { x: 2, y: 2 },
      selectedCell: { x: 3, y: 3 },
    });

    expect(renderer.container.children.length).toBe(4); // tiles, gridLines, coords, highlights
    expect(renderer.container.label).toBe('TerrainTileRenderer');

    // Toggle grid lines and coordinates off
    renderer.render({
      grid,
      cellSize: 48,
      showGridLines: false,
      showCoordinates: false,
    });

    renderer.destroy();
  });
});

describe('<TacticalCanvasViewport /> Component', () => {
  it('renders viewport canvas, toolbar controls, and grid dimensions', () => {
    const grid = createTacticalGrid(8, 8, 'floor_stone');

    render(
      <TacticalCanvasViewport
        grid={grid}
        cellSize={48}
        width={600}
        height={500}
        testId="test-viewport"
      />,
    );

    expect(screen.getByTestId('test-viewport')).toBeDefined();
    expect(screen.getByTestId('test-viewport-canvas')).toBeDefined();
    expect(screen.getByTestId('test-viewport-toolbar')).toBeDefined();
    expect(screen.getByTestId('test-viewport-info-ribbon').textContent).toContain(
      'Grid: 8×8 (40ft × 40ft)',
    );
    expect(screen.getByTestId('test-viewport-zoom-indicator').textContent).toBe('100%');
  });

  it('supports zoom in, zoom out, fit, and toggle controls via HUD buttons', () => {
    const grid = createTacticalGrid(10, 10, 'floor_stone');
    const onCameraChange = vi.fn();

    render(
      <TacticalCanvasViewport
        grid={grid}
        onCameraChange={onCameraChange}
        testId="test-viewport"
      />,
    );

    const zoomInBtn = screen.getByRole('button', { name: /Zoom In/i });
    const zoomOutBtn = screen.getByRole('button', { name: /Zoom Out/i });
    const gridToggleBtn = screen.getByRole('button', { name: /Toggle Grid/i });
    const coordsToggleBtn = screen.getByRole('button', { name: /Toggle Coordinates/i });
    const fitBtn = screen.getByRole('button', { name: /Fit Map/i });

    // Zoom in
    fireEvent.click(zoomInBtn);
    expect(screen.getByTestId('test-viewport-zoom-indicator').textContent).toBe('115%');
    expect(onCameraChange).toHaveBeenCalled();

    // Zoom out twice
    fireEvent.click(zoomOutBtn);
    fireEvent.click(zoomOutBtn);
    expect(screen.getByTestId('test-viewport-zoom-indicator').textContent).toBe('85%');

    // Toggle grid
    expect(gridToggleBtn.textContent).toBe('Grid');
    fireEvent.click(gridToggleBtn);

    // Toggle coords
    expect(coordsToggleBtn.textContent).toBe('(X,Y)');
    fireEvent.click(coordsToggleBtn);

    // Fit map
    fireEvent.click(fitBtn);
  });

  it('handles cell hover, pointer clicks, and coordinate display', () => {
    const grid = createTacticalGrid(10, 10, 'floor_stone');
    const onCellHover = vi.fn();
    const onCellClick = vi.fn();
    const cameraRef = createRef<ViewportCameraControls | null>();

    render(
      <TacticalCanvasViewport
        grid={grid}
        cellSize={40}
        onCellHover={onCellHover}
        onCellClick={onCellClick}
        cameraRef={cameraRef}
        testId="test-viewport"
      />,
    );

    expect(cameraRef.current).not.toBeNull();
    const canvas = screen.getByTestId('test-viewport-canvas');

    // Mock getBoundingClientRect on canvas
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 400,
      height: 400,
      right: 400,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Move over cell (3, 2): at cellSize 40, x = 130, y = 90
    fireEvent.mouseMove(canvas, { clientX: 130, clientY: 90 });
    expect(onCellHover).toHaveBeenCalledWith({ x: 3, y: 2 });
    expect(screen.getByTestId('test-viewport-hovered-coords').textContent).toBe(
      '[X: 3, Y: 2]',
    );

    // Mouse leave resets hover
    fireEvent.mouseLeave(canvas);
    expect(onCellHover).toHaveBeenCalledWith(null);

    // Click on cell (4, 5): x = 170, y = 210
    fireEvent.mouseDown(canvas, { clientX: 170, clientY: 210, button: 0 });
    fireEvent.mouseUp(canvas, { clientX: 170, clientY: 210, button: 0 });
    expect(onCellClick).toHaveBeenCalledWith({ x: 4, y: 5 }, 0);
  });

  it('supports dragging to pan the camera', () => {
    const grid = createTacticalGrid(10, 10, 'floor_stone');
    const onCameraChange = vi.fn();

    render(
      <TacticalCanvasViewport
        grid={grid}
        cellSize={40}
        onCameraChange={onCameraChange}
        testId="test-viewport"
      />,
    );

    const canvas = screen.getByTestId('test-viewport-canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 400,
      height: 400,
      right: 400,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Start drag at (100, 100)
    fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100, button: 0 });
    // Drag to (150, 130) -> delta +50, +30
    fireEvent.mouseMove(canvas, { clientX: 150, clientY: 130, button: 0 });
    fireEvent.mouseUp(canvas, { clientX: 150, clientY: 130, button: 0 });

    expect(onCameraChange).toHaveBeenCalledWith(
      expect.objectContaining({ x: 50, y: 30 }),
    );
  });
});
});

