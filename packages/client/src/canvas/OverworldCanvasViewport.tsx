import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Application } from 'pixi.js';
import type { OverworldCoord, OverworldMap, TimeOfDay } from '@srd5/engine';
import { getOverworldTile, getPoiAt } from '@srd5/engine';
import { ViewportCamera } from './camera.js';
import {
  OVERWORLD_CELL_SIZE,
  OverworldMapRenderer,
  createOverworldSceneGraph,
  type OverworldSceneGraph,
} from './layers/OverworldMapLayer.js';
import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
  type CameraState,
  type ViewportCameraControls,
} from './types.js';

/**
 * PixiJS v8 strategic overworld viewport (SRD-805).
 *
 * Full-bleed macro world map with pan/zoom camera, biome terrain, rivers,
 * roads, faction marks, POI labels, travel path preview, party token pulse,
 * and day/night tint. Follows the same StrictMode-safe async init lifecycle
 * as `TacticalCanvasViewport` and degrades gracefully in headless environments
 * (camera math + DOM overlays keep working when WebGL is unavailable).
 */

export interface OverworldCanvasViewportProps {
  map: OverworldMap;
  partyPosition: OverworldCoord;
  travelPath?: readonly OverworldCoord[] | null;
  hoveredTile?: OverworldCoord | null;
  timeOfDay?: TimeOfDay;
  clearedPoiIds?: readonly string[];
  cellSize?: number;
  className?: string;
  interactive?: boolean;
  width?: number | string;
  height?: number | string;
  cameraRef?: React.MutableRefObject<ViewportCameraControls | null>;
  initialCamera?: Partial<CameraState>;
  onTileHover?: (tile: OverworldCoord | null) => void;
  onTileClick?: (tile: OverworldCoord, button: number) => void;
  onCameraChange?: (camera: CameraState) => void;
  testId?: string;
}

export function OverworldCanvasViewport({
  map,
  partyPosition,
  travelPath = null,
  hoveredTile = null,
  timeOfDay = 'noon',
  clearedPoiIds = [],
  cellSize = OVERWORLD_CELL_SIZE,
  className = '',
  interactive = true,
  width = '100%',
  height = '100%',
  cameraRef,
  initialCamera,
  onTileHover,
  onTileClick,
  onCameraChange,
  testId = 'overworld-viewport',
}: OverworldCanvasViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pixiReady, setPixiReady] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(initialCamera?.zoom ?? DEFAULT_ZOOM);
  const [localHoveredTile, setLocalHoveredTile] = useState<OverworldCoord | null>(null);

  const cameraInstanceRef = useRef<ViewportCamera>(
    new ViewportCamera({
      x: initialCamera?.x ?? 0,
      y: initialCamera?.y ?? 0,
      zoom: initialCamera?.zoom ?? DEFAULT_ZOOM,
      cellSize,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
    }),
  );
  const camera = cameraInstanceRef.current;

  const appRef = useRef<Application | null>(null);
  const initPromiseRef = useRef<Promise<void> | null>(null);
  const destroyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDisposedRef = useRef(false);
  const hasUserAdjustedCameraRef = useRef(false);
  const sceneGraphRef = useRef<OverworldSceneGraph | null>(null);
  const rendererRef = useRef<OverworldMapRenderer | null>(null);

  // Mutable prop refs decouple the Pixi lifecycle from prop identity.
  const mapRef = useRef(map);
  mapRef.current = map;
  const cellSizeRef = useRef(cellSize);
  cellSizeRef.current = cellSize;
  const partyPositionRef = useRef(partyPosition);
  partyPositionRef.current = partyPosition;

  const dragRef = useRef<{
    isDragging: boolean;
    startX: number;
    startY: number;
    startCamX: number;
    startCamY: number;
    totalMoved: number;
  }>({ isDragging: false, startX: 0, startY: 0, startCamX: 0, startCamY: 0, totalMoved: 0 });

  useEffect(() => {
    if (cameraRef) cameraRef.current = camera;
  }, [camera, cameraRef]);

  const updateSceneTransform = useCallback(() => {
    if (sceneGraphRef.current) {
      camera.applyToContainer(sceneGraphRef.current.viewport);
    }
    const state = camera.getCamera();
    setCurrentZoom(state.zoom);
    onCameraChange?.(state);
  }, [camera, onCameraChange]);

  // StrictMode-safe async PixiJS init / delayed destroy lifecycle.
  useEffect(() => {
    isDisposedRef.current = false;

    if (destroyTimeoutRef.current) {
      clearTimeout(destroyTimeoutRef.current);
      destroyTimeoutRef.current = null;
    }
    if (appRef.current && sceneGraphRef.current) {
      setPixiReady(true);
      return;
    }
    if (initPromiseRef.current) {
      initPromiseRef.current
        .then(() => {
          if (!isDisposedRef.current && sceneGraphRef.current) setPixiReady(true);
        })
        .catch(() => {});
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;

    async function initPixi() {
      try {
        const app = new Application();
        appRef.current = app;
        const rect = containerRef.current?.getBoundingClientRect();
        const initWidth = Math.max(100, Math.floor(rect?.width || 800));
        const initHeight = Math.max(100, Math.floor(rect?.height || 600));

        await app.init({
          canvas: canvas!,
          width: initWidth,
          height: initHeight,
          backgroundColor: 0x090d16,
          antialias: true,
          autoDensity: true,
          resolution: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
          preference: 'webgl',
        });
        if (isDisposedRef.current) return;

        const sceneGraph = createOverworldSceneGraph(app.stage);
        sceneGraphRef.current = sceneGraph;
        const renderer = new OverworldMapRenderer(sceneGraph);
        rendererRef.current = renderer;

        app.ticker.add((ticker) => {
          renderer.update(ticker.deltaMS);
        });

        camera.fitGrid(mapRef.current.width, mapRef.current.height, initWidth, initHeight, 16);
        camera.applyToContainer(sceneGraph.viewport);
        setCurrentZoom(camera.getCamera().zoom);
        setPixiReady(true);
      } catch (err) {
        // Headless fallback (JSDOM without WebGL): DOM overlays + camera math
        // remain fully functional.
        console.error('OverworldCanvasViewport: PixiJS init failed:', err);
        setPixiReady(true);
      } finally {
        initPromiseRef.current = null;
      }
    }
    initPromiseRef.current = initPixi();

    return () => {
      destroyTimeoutRef.current = setTimeout(() => {
        isDisposedRef.current = true;
        rendererRef.current = null;
        if (appRef.current) {
          try {
            appRef.current.destroy(false);
          } catch {
            // Ignore destruction errors
          }
          appRef.current = null;
        }
        sceneGraphRef.current = null;
        initPromiseRef.current = null;
      }, 150);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render the map whenever session-derived props change.
  useEffect(() => {
    rendererRef.current?.render({
      map,
      cellSize,
      partyPosition,
      timeOfDay,
      hoveredTile: hoveredTile ?? localHoveredTile,
      travelPath,
      clearedPoiIds,
    });
  }, [map, cellSize, partyPosition, timeOfDay, hoveredTile, localHoveredTile, travelPath, clearedPoiIds, pixiReady]);

  // Container resize observer.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        if (appRef.current?.renderer && w > 0 && h > 0) {
          try {
            appRef.current.renderer.resize(w, h);
            if (sceneGraphRef.current && !hasUserAdjustedCameraRef.current) {
              camera.fitGrid(mapRef.current.width, mapRef.current.height, w, h, 16);
              camera.applyToContainer(sceneGraphRef.current.viewport);
              setCurrentZoom(camera.getCamera().zoom);
            }
          } catch {
            // Safe resize fallback
          }
        }
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [camera]);

  const lastEventType = useRef<string>('');

  const handlePointerDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    if (e.type === 'mousedown' && lastEventType.current === 'pointerdown') return;
    lastEventType.current = e.type;
    if (e.button === 0 || e.button === 1) {
      dragRef.current = {
        isDragging: true,
        startX: e.clientX,
        startY: e.clientY,
        startCamX: camera.getCamera().x,
        startCamY: camera.getCamera().y,
        totalMoved: 0,
      };
    }
  };

  const handlePointerMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    if (e.type === 'mousemove' && lastEventType.current === 'pointermove') return;
    lastEventType.current = e.type;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    if (dragRef.current.isDragging) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      dragRef.current.totalMoved += Math.hypot(dx, dy);
      if (dragRef.current.totalMoved > 4) hasUserAdjustedCameraRef.current = true;
      camera.setCamera({
        x: dragRef.current.startCamX + dx,
        y: dragRef.current.startCamY + dy,
      });
      updateSceneTransform();
    }

    const cell = camera.screenToCell(screenX, screenY);
    const inBounds =
      cell.x >= 0 && cell.x < map.width && cell.y >= 0 && cell.y < map.height;
    const nextTile = inBounds ? { q: cell.x, r: cell.y } : null;
    if (
      (!localHoveredTile && nextTile) ||
      (localHoveredTile && !nextTile) ||
      (localHoveredTile &&
        nextTile &&
        (localHoveredTile.q !== nextTile.q || localHoveredTile.r !== nextTile.r))
    ) {
      setLocalHoveredTile(nextTile);
      onTileHover?.(nextTile);
    }
  };

  const handlePointerUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    if (e.type === 'mouseup' && lastEventType.current === 'pointerup') return;
    lastEventType.current = e.type;
    const canvas = canvasRef.current;
    if (dragRef.current.isDragging) {
      const moved = dragRef.current.totalMoved;
      dragRef.current.isDragging = false;
      if (moved < 6 && canvas) {
        const rect = canvas.getBoundingClientRect();
        const cell = camera.screenToCell(e.clientX - rect.left, e.clientY - rect.top);
        if (cell.x >= 0 && cell.x < map.width && cell.y >= 0 && cell.y < map.height) {
          onTileClick?.({ q: cell.x, r: cell.y }, e.button);
        }
      }
    }
  };

  const handlePointerLeave = () => {
    if (localHoveredTile !== null) {
      setLocalHoveredTile(null);
      onTileHover?.(null);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    hasUserAdjustedCameraRef.current = true;
    camera.zoomAt(
      e.clientX - rect.left,
      e.clientY - rect.top,
      e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP,
    );
    updateSceneTransform();
  };

  const handleZoomIn = () => {
    hasUserAdjustedCameraRef.current = true;
    const rect = containerRef.current?.getBoundingClientRect();
    camera.zoomAt((rect?.width || 800) / 2, (rect?.height || 600) / 2, ZOOM_STEP);
    updateSceneTransform();
  };

  const handleZoomOut = () => {
    hasUserAdjustedCameraRef.current = true;
    const rect = containerRef.current?.getBoundingClientRect();
    camera.zoomAt((rect?.width || 800) / 2, (rect?.height || 600) / 2, -ZOOM_STEP);
    updateSceneTransform();
  };

  const handleCenterParty = () => {
    hasUserAdjustedCameraRef.current = true;
    const rect = containerRef.current?.getBoundingClientRect();
    camera.centerOnCell(
      partyPositionRef.current.q,
      partyPositionRef.current.r,
      rect?.width || 800,
      rect?.height || 600,
    );
    updateSceneTransform();
  };

  const handleFitWorld = () => {
    hasUserAdjustedCameraRef.current = false;
    const rect = containerRef.current?.getBoundingClientRect();
    camera.fitGrid(map.width, map.height, rect?.width || 800, rect?.height || 600, 16);
    updateSceneTransform();
  };

  const effectiveHovered = hoveredTile ?? localHoveredTile;
  const hoveredTileData = effectiveHovered
    ? getOverworldTile(map, effectiveHovered.q, effectiveHovered.r)
    : undefined;
  const hoveredPoi = effectiveHovered ? getPoiAt(map, effectiveHovered) : undefined;

  return (
    <div
      ref={containerRef}
      data-testid={testId}
      className={`relative overflow-hidden select-none bg-slate-950 font-sans ${className}`}
      style={{ width, height, minHeight: 300 }}
    >
      <canvas
        ref={canvasRef}
        data-testid={`${testId}-canvas`}
        className="w-full h-full block cursor-grab active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onMouseLeave={handlePointerLeave}
        onWheel={handleWheel}
      />

      {/* Floating camera toolbar */}
      <div
        data-testid={`${testId}-toolbar`}
        className="absolute top-1/2 -translate-y-1/2 right-3 z-10 flex flex-col items-center gap-1.5 p-1.5 bg-slate-900/90 backdrop-blur border border-slate-800 rounded-lg shadow-lg text-xs text-slate-200"
      >
        <button
          type="button"
          data-testid={`${testId}-zoom-in-btn`}
          onClick={handleZoomIn}
          className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 font-bold"
          title="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          data-testid={`${testId}-zoom-out-btn`}
          onClick={handleZoomOut}
          className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 font-bold"
          title="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          data-testid={`${testId}-center-party-btn`}
          onClick={handleCenterParty}
          className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700"
          title="Center on party"
        >
          ⊙
        </button>
        <button
          type="button"
          data-testid={`${testId}-fit-world-btn`}
          onClick={handleFitWorld}
          className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700"
          title="Fit world"
        >
          ⛶
        </button>
        <span
          data-testid={`${testId}-zoom-indicator`}
          className="text-[10px] text-slate-400 font-mono"
        >
          {Math.round(currentZoom * 100)}%
        </span>
      </div>

      {/* Hovered tile info ribbon */}
      <div
        data-testid={`${testId}-info-ribbon`}
        className="absolute bottom-2 right-3 z-10 px-2.5 py-1 rounded-lg bg-slate-950/85 backdrop-blur border border-slate-800 text-[11px] text-slate-300 font-mono pointer-events-none"
      >
        {effectiveHovered && hoveredTileData ? (
          <span data-testid={`${testId}-hovered-tile`}>
            ({effectiveHovered.q}, {effectiveHovered.r}) · {hoveredTileData.terrain}
            {hoveredTileData.roadThrough ? ' · road' : ''}
            {hoveredPoi ? ` · ${hoveredPoi.name}` : ''}
          </span>
        ) : (
          <span>{map.worldName}</span>
        )}
      </div>
    </div>
  );
}
