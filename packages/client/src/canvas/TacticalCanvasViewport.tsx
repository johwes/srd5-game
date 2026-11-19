import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Application } from 'pixi.js';
import { ViewportCamera } from './camera.js';
import { createSceneGraph } from './layers/SceneGraph.js';
import { TerrainTileRenderer } from './layers/TerrainTileLayer.js';
import { CreatureTokenRenderer } from './layers/CreatureTokenLayer.js';
import { FloatingTextRenderer } from './layers/FloatingTextLayer.js';
import { HazardZoneRenderer } from './layers/HazardZoneLayer.js';
import { PropRenderer } from './layers/PropLayer.js';
import { PathAndAoeRenderer } from './layers/PathAndAoeLayer.js';
import { LightingAndFogRenderer } from './layers/LightingAndFogLayer.js';
import { assetRegistry } from './assets/index.js';
import {
  DEFAULT_CELL_SIZE,
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
  type CameraState,
  type Point,
  type TacticalCanvasViewportProps,
  type TacticalSceneGraph,
} from './types.js';

/**
 * PixiJS v8 2D Tactical Canvas Viewport with pan/zoom camera,
 * 5-ft grid overlay, terrain rendering, and interactive cell inspection.
 */
export function TacticalCanvasViewport({
  grid,
  cellSize = DEFAULT_CELL_SIZE,
  className = '',
  showGridLines: initialShowGridLines = true,
  showCoordinates: initialShowCoordinates = false,
  selectedCell = null,
  hoveredCell: controlledHoveredCell,
  combatants,
  selectedCombatantId = null,
  activeCombatantId = null,
  hoveredCombatantId = null,
  showTokenHpArcs = true,
  showConditionBadges = true,
  showTokenFacing = true,
  showTokenNames = true,
  hazardZones = [],
  props = [],
  pathPreview = null,
  enableHoverPathPreview = true,
  activeAoeTemplate = null,
  targetingRay = null,
  attackBonus,
  targetingMode = 'none',
  fogOfWar = null,
  enableFogOfWar = true,
  onCellHover,
  onCellClick,
  onCombatantHover,
  onCombatantClick,
  onCameraChange,
  cameraRef,
  initialCamera,
  interactive = true,
  width = '100%',
  height = '100%',
  testId = 'tactical-canvas-viewport',
  events = [],
}: TacticalCanvasViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [showGridLines, setShowGridLines] = useState(initialShowGridLines);
  const [showCoordinates, setShowCoordinates] = useState(initialShowCoordinates);
  const [localHoveredCell, setLocalHoveredCell] = useState<Point | null>(null);
  const [currentZoom, setCurrentZoom] = useState<number>(initialCamera?.zoom ?? DEFAULT_ZOOM);
  const [pixiReady, setPixiReady] = useState(false);
  const [atlasLoaded, setAtlasLoaded] = useState(() => assetRegistry.isLoaded);

  // Active hovered cell: controlled prop takes precedence over local state
  const activeHoveredCell = controlledHoveredCell !== undefined ? controlledHoveredCell : localHoveredCell;

  // Viewport camera instance
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

  // Expose camera controls to parent ref if provided
  useEffect(() => {
    if (cameraRef) {
      cameraRef.current = camera;
    }
  }, [camera, cameraRef]);

  // Pixi application and scene graph references
  const appRef = useRef<Application | null>(null);
  const initPromiseRef = useRef<Promise<void> | null>(null);
  const destroyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDisposedRef = useRef(false);
  const hasUserAdjustedCameraRef = useRef(false);
  const sceneGraphRef = useRef<TacticalSceneGraph | null>(null);
  const terrainRendererRef = useRef<TerrainTileRenderer | null>(null);
  const tokenRendererRef = useRef<CreatureTokenRenderer | null>(null);
  const hazardZoneRendererRef = useRef<HazardZoneRenderer | null>(null);
  const propRendererRef = useRef<PropRenderer | null>(null);
  const floatingTextRendererRef = useRef<FloatingTextRenderer | null>(null);
  const pathAndAoeRendererRef = useRef<PathAndAoeRenderer | null>(null);
  const fogRendererRef = useRef<LightingAndFogRenderer | null>(null);

  // Drag pan tracking
  const dragRef = useRef<{
    isDragging: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    startCamX: number;
    startCamY: number;
    totalMoved: number;
  }>({
    isDragging: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    startCamX: 0,
    startCamY: 0,
    totalMoved: 0,
  });

  // Sync camera transform to Pixi viewport container
  const updateSceneTransform = useCallback(() => {
    if (sceneGraphRef.current) {
      camera.applyToContainer(sceneGraphRef.current.viewport);
    }
    const state = camera.getCamera();
    setCurrentZoom(state.zoom);
    onCameraChange?.(state);
  }, [camera, onCameraChange]);

  // Mutable refs to decouple PixiJS lifecycle from transient prop reference changes
  const gridRef = useRef(grid);
  gridRef.current = grid;

  const cellSizeRef = useRef(cellSize);
  cellSizeRef.current = cellSize;

  const onCombatantClickRef = useRef(onCombatantClick);
  onCombatantClickRef.current = onCombatantClick;

  const onCombatantHoverRef = useRef(onCombatantHover);
  onCombatantHoverRef.current = onCombatantHover;

  const tokenClickAtRef = useRef<number>(0);

  // Initialize PixiJS Application
  useEffect(() => {
    isDisposedRef.current = false;

    // If a destruction was queued by transient React StrictMode unmount, cancel it immediately!
    if (destroyTimeoutRef.current) {
      clearTimeout(destroyTimeoutRef.current);
      destroyTimeoutRef.current = null;
    }

    // If app is already initialized, simply mark ready and return
    if (appRef.current && sceneGraphRef.current) {
      setPixiReady(true);
      return;
    }

    // If initialization is in progress, wait for it to finish and activate
    if (initPromiseRef.current) {
      initPromiseRef.current
        .then(() => {
          if (!isDisposedRef.current && sceneGraphRef.current) {
            setPixiReady(true);
          }
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

        if (isDisposedRef.current) {
          return;
        }

        // Try loading spritesheet atlas once if not yet loaded
        if (!assetRegistry.isLoaded) {
          void assetRegistry
            .loadAtlas()
            .then((loaded) => {
              if (loaded && !isDisposedRef.current) {
                setAtlasLoaded(true);
              }
            })
            .catch(() => {});
        }

        const sceneGraph = createSceneGraph(app.stage);
        sceneGraphRef.current = sceneGraph;

        const terrainRenderer = new TerrainTileRenderer(sceneGraph.terrainLayer);
        terrainRendererRef.current = terrainRenderer;

        const tokenRenderer = new CreatureTokenRenderer(sceneGraph.tokenLayer);
        tokenRendererRef.current = tokenRenderer;

        const hazardZoneRenderer = new HazardZoneRenderer(sceneGraph.hazardLayer);
        hazardZoneRendererRef.current = hazardZoneRenderer;

        const propRenderer = new PropRenderer(sceneGraph.propLayer);
        propRendererRef.current = propRenderer;

        const floatingTextRenderer = new FloatingTextRenderer(sceneGraph.floatingTextLayer);
        floatingTextRendererRef.current = floatingTextRenderer;

        const pathAndAoeRenderer = new PathAndAoeRenderer(sceneGraph.pathAoeLayer);
        pathAndAoeRendererRef.current = pathAndAoeRenderer;

        const fogRenderer = new LightingAndFogRenderer(sceneGraph.fogLayer);
        fogRendererRef.current = fogRenderer;

        tokenRenderer.onTokenClick = (tokenId) => {
          tokenClickAtRef.current = Date.now();
          onCombatantClickRef.current?.(tokenId);
        };
        tokenRenderer.onTokenHover = (tokenId) => {
          onCombatantHoverRef.current?.(tokenId);
        };

        // Continuous ticker animation
        app.ticker.add((ticker) => {
          tokenRenderer.update(ticker.deltaMS, cellSizeRef.current);
          floatingTextRenderer.update(ticker.deltaMS);
        });

        // Apply initial camera transform centered and fitted on the grid
        camera.fitGrid(gridRef.current.width, gridRef.current.height, initWidth, initHeight, 32);
        camera.applyToContainer(sceneGraph.viewport);
        const camState = camera.getCamera();
        setCurrentZoom(camState.zoom);
        setPixiReady(true);
      } catch (err) {
        // Fallback for headless environments (e.g. JSDOM without WebGL)
        // Allows tests and non-WebGL environments to operate cleanly
        console.error('TacticalCanvasViewport: PixiJS init failed:', err);
        setPixiReady(true);
      } finally {
        initPromiseRef.current = null;
      }
    }

    initPromiseRef.current = initPixi();

    return () => {
      // Delay destruction to survive React StrictMode transient mount-unmount-remount cycles
      destroyTimeoutRef.current = setTimeout(() => {
        isDisposedRef.current = true;
        if (fogRendererRef.current) {
          fogRendererRef.current.destroy();
          fogRendererRef.current = null;
        }
        if (pathAndAoeRendererRef.current) {
          pathAndAoeRendererRef.current.destroy();
          pathAndAoeRendererRef.current = null;
        }
        if (tokenRendererRef.current) {
          tokenRendererRef.current.destroy();
          tokenRendererRef.current = null;
        }
        if (floatingTextRendererRef.current) {
          floatingTextRendererRef.current.destroy();
          floatingTextRendererRef.current = null;
        }
        if (hazardZoneRendererRef.current) {
          hazardZoneRendererRef.current.destroy();
          hazardZoneRendererRef.current = null;
        }
        if (propRendererRef.current) {
          propRendererRef.current.destroy();
          propRendererRef.current = null;
        }
        if (terrainRendererRef.current) {
          terrainRendererRef.current.destroy();
          terrainRendererRef.current = null;
        }
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
  }, []);

  // Update Terrain Rendering whenever grid, highlights, or visibility toggles change
  useEffect(() => {
    if (terrainRendererRef.current) {
      terrainRendererRef.current.render({
        grid,
        cellSize,
        showGridLines,
        showCoordinates,
        hoveredCell: activeHoveredCell,
        selectedCell,
        ignoreVisibility: enableFogOfWar === false,
      });
    }
  }, [grid, cellSize, showGridLines, showCoordinates, activeHoveredCell, selectedCell, enableFogOfWar, pixiReady]);

  // Sync token click and hover listeners
  useEffect(() => {
    if (tokenRendererRef.current) {
      tokenRendererRef.current.onTokenClick = (tokenId) => {
        tokenClickAtRef.current = Date.now();
        onCombatantClick?.(tokenId);
      };
      tokenRendererRef.current.onTokenHover = (tokenId) => {
        onCombatantHover?.(tokenId);
      };
    }
  }, [onCombatantClick, onCombatantHover]);

  // Update Creature Token rendering whenever combatants or highlights change
  useEffect(() => {
    if (tokenRendererRef.current && combatants) {
      tokenRendererRef.current.render({
        combatants,
        cellSize,
        selectedId: selectedCombatantId,
        activeId: activeCombatantId,
        hoveredId: hoveredCombatantId,
        showHpArc: showTokenHpArcs,
        showConditionBadges,
        showFacing: showTokenFacing,
        showNameTags: showTokenNames,
      });
    }
  }, [
    combatants,
    cellSize,
    selectedCombatantId,
    activeCombatantId,
    hoveredCombatantId,
    showTokenHpArcs,
    showConditionBadges,
    showTokenFacing,
    showTokenNames,
    pixiReady,
    atlasLoaded,
  ]);

  // Feed new GameEvents into the floating combat text layer (BG3-style
  // MISS / CRITICAL / CONCENTRATION BROKEN callouts). Tracks the last
  // processed event count so re-renders never replay old callouts.
  const processedEventCountRef = useRef(0);
  useEffect(() => {
    const renderer = floatingTextRendererRef.current;
    if (!renderer || !combatants) return;
    if (events.length < processedEventCountRef.current) {
      processedEventCountRef.current = 0;
    }
    const fresh = events.slice(processedEventCountRef.current);
    processedEventCountRef.current = events.length;
    if (fresh.length === 0) return;

    const combatantList = Array.isArray(combatants)
      ? combatants
      : Object.values(combatants);
    const getEntityPos = (id: string) => {
      const c = combatantList.find((entry) => entry.id === id);
      if (!c) return undefined;
      const sizeCells = c.size === 'large' ? 2 : c.size === 'huge' ? 3 : c.size === 'gargantuan' ? 4 : 1;
      return { x: c.position.x + sizeCells / 2 - 0.5, y: c.position.y };
    };
    for (const event of fresh) {
      try {
        renderer.handleGameEvent(event, getEntityPos, cellSize);
      } catch {
        // Never let a cosmetic callout break the render loop.
      }
    }
  }, [events, combatants, cellSize, pixiReady]);

  // Update Hazard Zone ground overlays (Grease, Web, Spike Growth, …)
  useEffect(() => {
    if (hazardZoneRendererRef.current) {
      hazardZoneRendererRef.current.render({
        zones: hazardZones,
        cellSize,
      });
    }
  }, [hazardZones, cellSize, pixiReady]);

  // Update Interactive Prop markers (doors, chests, traps, stairs, shrines).
  // Props arrive fog-projected from the transport view; the renderer also
  // skips undiscovered traps/secret doors for direct GameState usage.
  useEffect(() => {
    if (propRendererRef.current) {
      propRendererRef.current.render({
        props,
        cellSize,
      });
    }
  }, [props, cellSize, pixiReady, atlasLoaded]);

  // Update Interactive Overlays (Path preview, AOE templates, Targeting rays)
  useEffect(() => {
    if (!pathAndAoeRendererRef.current) return;
    const renderer = pathAndAoeRendererRef.current;

    // 1. Path Preview: Explicit prop or dynamic hover path preview
    let effectivePathPreview = pathPreview;
    if (
      !effectivePathPreview &&
      enableHoverPathPreview &&
      activeCombatantId &&
      activeHoveredCell &&
      combatants
    ) {
      const combatantList = Array.isArray(combatants)
        ? combatants
        : Object.values(combatants);
      const activeCombatant = combatantList.find((c) => c.id === activeCombatantId);
      if (
        activeCombatant &&
        (activeCombatant.position.x !== activeHoveredCell.x ||
          activeCombatant.position.y !== activeHoveredCell.y)
      ) {
        effectivePathPreview = {
          mover: activeCombatant,
          destination: activeHoveredCell,
          grid,
          creatures: combatantList,
        };
      }
    }

    if (effectivePathPreview) {
      renderer.renderPath(effectivePathPreview, cellSize);
    } else {
      renderer.clearPath();
    }

    // 2. AOE Template
    let effectiveAoe = activeAoeTemplate;
    if (effectiveAoe && !effectiveAoe.cursor && activeHoveredCell) {
      effectiveAoe = {
        ...effectiveAoe,
        cursor: activeHoveredCell,
      };
    }
    if (effectiveAoe) {
      renderer.renderAoe(effectiveAoe, cellSize);
    } else {
      renderer.clearAoe();
    }

    // 3. Targeting Ray & Cover
    let effectiveTargetingRay = targetingRay;
    if (
      !effectiveTargetingRay &&
      targetingMode === 'attack' &&
      selectedCombatantId &&
      hoveredCombatantId &&
      combatants
    ) {
      const combatantList = Array.isArray(combatants)
        ? combatants
        : Object.values(combatants);
      const attacker = combatantList.find((c) => c.id === selectedCombatantId);
      const target = combatantList.find((c) => c.id === hoveredCombatantId);
      if (attacker && target && attacker.id !== target.id) {
        effectiveTargetingRay = {
          attacker,
          target,
          grid,
          obstacles: combatantList,
          attackBonus,
        };
      }
    }

    if (effectiveTargetingRay) {
      renderer.renderTargetingRay(effectiveTargetingRay, cellSize);
    } else {
      renderer.clearTargetingRay();
    }
  }, [
    pathPreview,
    enableHoverPathPreview,
    activeAoeTemplate,
    targetingRay,
    attackBonus,
    targetingMode,
    activeCombatantId,
    selectedCombatantId,
    hoveredCombatantId,
    activeHoveredCell,
    combatants,
    grid,
    cellSize,
    pixiReady,
    atlasLoaded,
  ]);

  // Update Dynamic Lighting & Fog-of-War Layer
  useEffect(() => {
    if (!fogRendererRef.current) return;
    const renderer = fogRendererRef.current;

    if (enableFogOfWar === false) {
      renderer.clear();
      return;
    }

    const combatantList = combatants
      ? Array.isArray(combatants)
        ? combatants
        : Object.values(combatants)
      : undefined;

    renderer.render({
      grid,
      cellSize,
      combatants: combatantList,
      ...fogOfWar,
      enabled: fogOfWar?.enabled ?? enableFogOfWar ?? true,
    });
  }, [grid, cellSize, fogOfWar, enableFogOfWar, combatants, pixiReady]);

  // Container resize observer
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
              camera.fitGrid(gridRef.current.width, gridRef.current.height, w, h, 32);
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

  // Last event type to prevent duplicate pointer + mouse events in browsers
  const lastEventType = useRef<string>('');

  // Unified event handlers for pan and hover (supporting both PointerEvent and MouseEvent)
  const handlePointerDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    if (e.type === 'mousedown' && lastEventType.current === 'pointerdown') return;
    lastEventType.current = e.type;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Pan with left click (button 0) or middle click (button 1)
    if (e.button === 0 || e.button === 1) {
      const pointerId = 'pointerId' in e ? (e as unknown as { pointerId: number }).pointerId : 1;
      dragRef.current = {
        isDragging: true,
        pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startCamX: camera.getCamera().x,
        startCamY: camera.getCamera().y,
        totalMoved: 0,
      };
      if ('setPointerCapture' in canvas && 'pointerId' in e) {
        try {
          (canvas as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture(pointerId);
        } catch {
          // Fallback for environments lacking pointer capture
        }
      }
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

    // If currently dragging, pan the camera
    if (dragRef.current.isDragging) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      dragRef.current.totalMoved += Math.hypot(dx, dy);
      if (dragRef.current.totalMoved > 4) {
        hasUserAdjustedCameraRef.current = true;
      }

      camera.setCamera({
        x: dragRef.current.startCamX + dx,
        y: dragRef.current.startCamY + dy,
      });
      updateSceneTransform();
    }

    // Determine cell under pointer
    const cell = camera.screenToCell(screenX, screenY);
    const inBounds =
      cell.x >= 0 && cell.x < grid.width && cell.y >= 0 && cell.y < grid.height;

    const nextCell = inBounds ? cell : null;

    if (
      (!activeHoveredCell && nextCell) ||
      (activeHoveredCell && !nextCell) ||
      (activeHoveredCell && nextCell && (activeHoveredCell.x !== nextCell.x || activeHoveredCell.y !== nextCell.y))
    ) {
      setLocalHoveredCell(nextCell);
      onCellHover?.(nextCell);
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
      dragRef.current.pointerId = null;

      if (canvas && 'releasePointerCapture' in canvas && 'pointerId' in e) {
        try {
          const pointerId = (e as unknown as { pointerId: number }).pointerId;
          (canvas as unknown as { releasePointerCapture: (id: number) => void }).releasePointerCapture(pointerId);
        } catch {
          // Safe fallback
        }
      }

      // If moved < 6px, treat as click (unless a token click already consumed this pointerdown)
      if (moved < 6) {
        if (Date.now() - tokenClickAtRef.current < 400) {
          tokenClickAtRef.current = 0;
          return;
        }
        const rect = canvas?.getBoundingClientRect();
        if (rect) {
          const screenX = e.clientX - rect.left;
          const screenY = e.clientY - rect.top;
          const cell = camera.screenToCell(screenX, screenY);
          if (cell.x >= 0 && cell.x < grid.width && cell.y >= 0 && cell.y < grid.height) {
            onCellClick?.(cell, e.button);
          }
        }
      }
    }
  };

  const handlePointerLeave = () => {
    if (activeHoveredCell !== null) {
      setLocalHoveredCell(null);
      onCellHover?.(null);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    hasUserAdjustedCameraRef.current = true;
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    camera.zoomAt(screenX, screenY, delta);
    updateSceneTransform();
  };

  // Camera toolbar helpers
  const handleZoomIn = () => {
    hasUserAdjustedCameraRef.current = true;
    const rect = containerRef.current?.getBoundingClientRect();
    const cx = (rect?.width || 800) / 2;
    const cy = (rect?.height || 600) / 2;
    camera.zoomAt(cx, cy, ZOOM_STEP);
    updateSceneTransform();
  };

  const handleZoomOut = () => {
    hasUserAdjustedCameraRef.current = true;
    const rect = containerRef.current?.getBoundingClientRect();
    const cx = (rect?.width || 800) / 2;
    const cy = (rect?.height || 600) / 2;
    camera.zoomAt(cx, cy, -ZOOM_STEP);
    updateSceneTransform();
  };

  const handleResetCamera = () => {
    hasUserAdjustedCameraRef.current = false;
    const rect = containerRef.current?.getBoundingClientRect();
    const w = rect?.width || 800;
    const h = rect?.height || 600;
    camera.setCamera({ zoom: DEFAULT_ZOOM });
    camera.centerOnCell(Math.floor(grid.width / 2), Math.floor(grid.height / 2), w, h);
    updateSceneTransform();
  };

  const handleFitGrid = () => {
    hasUserAdjustedCameraRef.current = false;
    const rect = containerRef.current?.getBoundingClientRect();
    const w = rect?.width || 800;
    const h = rect?.height || 600;
    camera.fitGrid(grid.width, grid.height, w, h);
    updateSceneTransform();
  };

  return (
    <div
      ref={containerRef}
      data-testid={testId}
      className={`relative overflow-hidden select-none bg-slate-950 font-sans ${className}`}
      style={{ width, height, minHeight: 300 }}
    >
      {/* PixiJS Viewport Canvas */}
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

      {/* Floating Tactical Camera & Overlay Toolbar */}
      <div
        data-testid={`${testId}-toolbar`}
        className="absolute top-1/2 -translate-y-1/2 right-3 z-10 flex flex-col items-center gap-1.5 p-1.5 bg-slate-900/90 backdrop-blur border border-slate-800 rounded-lg shadow-lg text-xs text-slate-200"
      >
        <button
          type="button"
          onClick={handleZoomIn}
          title="Zoom In (+)"
          aria-label="Zoom In"
          className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded font-semibold transition"
        >
          +
        </button>
        <button
          type="button"
          onClick={handleZoomOut}
          title="Zoom Out (-)"
          aria-label="Zoom Out"
          className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded font-semibold transition"
        >
          &minus;
        </button>
        <button
          type="button"
          onClick={handleResetCamera}
          title="Center Map (⊙)"
          aria-label="Center Map"
          className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded font-semibold transition"
        >
          ⊙
        </button>
        <button
          type="button"
          onClick={handleFitGrid}
          title="Fit Map to Viewport"
          aria-label="Fit Map"
          className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded font-semibold transition"
        >
          ⛶
        </button>

        <div className="w-4 h-px bg-slate-700 my-0.5" />

        <button
          type="button"
          onClick={() => setShowGridLines((prev) => !prev)}
          title="Toggle 5-ft Grid Lines"
          aria-label="Toggle Grid"
          className={`px-2 py-1 rounded transition font-medium ${
            showGridLines
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
              : 'bg-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          Grid
        </button>

        <button
          type="button"
          onClick={() => setShowCoordinates((prev) => !prev)}
          title="Toggle Coordinates"
          aria-label="Toggle Coordinates"
          className={`px-2 py-1 rounded transition font-medium ${
            showCoordinates
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
              : 'bg-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          (X,Y)
        </button>

        <div className="w-4 h-px bg-slate-700 my-0.5" />

        <span
          data-testid={`${testId}-zoom-indicator`}
          className="px-1.5 py-0.5 text-[11px] font-mono text-slate-400"
        >
          {Math.round(currentZoom * 100)}%
        </span>
      </div>

      {/* Coordinate & Grid Information Ribbon */}
      <div
        data-testid={`${testId}-info-ribbon`}
        className="absolute bottom-3 right-3 z-10 flex items-center gap-2 px-2.5 py-1 bg-slate-900/90 backdrop-blur border border-slate-800 rounded-md text-[11px] font-mono text-slate-300 shadow"
      >
        <span>
          Grid: {grid.width}&times;{grid.height} ({grid.width * 5}ft &times; {grid.height * 5}ft)
        </span>
        {activeHoveredCell ? (
          <span
            data-testid={`${testId}-hovered-coords`}
            className="text-amber-300 font-semibold"
          >
            [X: {activeHoveredCell.x}, Y: {activeHoveredCell.y}]
          </span>
        ) : (
          <span className="text-slate-500">[Hover Cell]</span>
        )}
      </div>
    </div>
  );
}
