import { Container, Graphics } from 'pixi.js';
import type { CreatureSize } from '@srd5/data';
import {
  type GridCell,
  type GridPoint,
  type LightLevel,
  type LightSource,
  type TacticalGrid,
  type VisionCreature,
  applyDarkvision,
  getCellDistanceFeet,
  getCellLightLevel,
  hasLineOfSight,
} from '@srd5/engine';
import type { CellVisibility, PlayerViewCombatant } from '@srd5/transport';
import type {
  CanvasCellInput,
  CanvasGridInput,
  CellLightingInfo,
  CreatureTokenData,
  FogOfWarOptions,
  FogOfWarRenderOptions,
  Point,
} from '../types.js';
import { ensureTacticalGrid } from './PathAndAoeLayer.js';

/**
 * Standard palette colors for Lighting & Fog-of-War rendering.
 */
export const FOG_COLORS = {
  unexplored: 0x000000, // Pitch black: completely obscuring unexplored areas
  remembered: 0x090d16, // Dark slate/charcoal shroud for remembered cells
  rememberedBorder: 0x1e293b, // Subtle border highlight for remembered walls/edges
  dimLight: 0x0f172a, // Translucent shadowy tint for dim lighting
  darkness: 0x020617, // Heavy darkness tint for unlit areas
  darkvision: 0x1e293b, // Cool desaturated night-vision tint for darkness seen via darkvision
  lightSourceBright: 0xfef08a, // Soft warm golden glow for bright radius
  lightSourceDim: 0xf59e0b, // Warm amber glow for dim light halo
  lightSourceCore: 0xffedd5, // Central torch/light pip
} as const;

/**
 * Default opacity / alpha values for Lighting & Fog-of-War overlays.
 */
export const FOG_ALPHAS = {
  unexplored: 1.0, // Solid opaque black
  remembered: 0.72, // Dim shroud allowing terrain to show faintly
  dimLight: 0.35, // Light shadowy tint
  darkness: 0.90, // Near-opaque shadow for pitch darkness
  darkvision: 0.28, // Cool night-vision overlay for darkness seen via darkvision
  bright: 0.0, // Fully clear
  lightSourceBrightGlow: 0.18,
  lightSourceDimGlow: 0.08,
} as const;

const LIGHT_RANKS: Record<LightLevel, number> = {
  darkness: 0,
  dim: 1,
  bright: 2,
};

const RANK_TO_LIGHT: LightLevel[] = ['darkness', 'dim', 'bright'];

/**
 * Derives observer vision configuration from either explicit observers or combatants.
 */
export function extractVisionObservers(
  options: FogOfWarOptions,
): Array<VisionCreature & { darkvisionFeet: number }> {
  if (options.observers && options.observers.length > 0) {
    return options.observers.map((obs) => ({
      id: obs.id,
      x: obs.x,
      y: obs.y,
      size: obs.size,
      darkvisionFeet: obs.darkvisionFeet ?? 0,
    }));
  }

  if (options.combatants && options.combatants.length > 0) {
    const list = Array.isArray(options.combatants)
      ? options.combatants
      : Object.values(options.combatants);

    const partyObservers = list.filter((c) => {
      // Observers are conscious party / allied team members
      const isParty =
        c.side === 'party' ||
        c.teamId === 'party' ||
        c.teamId === 'team_red' ||
        c.teamId === 'team_a';
      const isConscious = !c.isDead && !c.conditions?.includes('unconscious');
      return isParty && isConscious;
    });

    const activeList =
      partyObservers.length > 0
        ? partyObservers
        : list.filter((c) => !c.isDead && !c.conditions?.includes('unconscious'));

    return activeList.map((c) => {
      const darkvisionFeet =
        (c as any).characterSheet?.darkvisionFeet ??
        (c as any).monsterData?.darkvisionFeet ??
        (c as any).darkvisionFeet ??
        0;
      return {
        id: c.id,
        x: c.position.x,
        y: c.position.y,
        size: (c.size as CreatureSize) ?? 'medium',
        darkvisionFeet,
      };
    });
  }

  return [];
}

/**
 * Pure function to compute cell visibility and lighting info across a tactical grid.
 */
export function computeDynamicFog(
  grid: CanvasGridInput,
  options: FogOfWarOptions = {},
): Map<string, CellLightingInfo> {
  const result = new Map<string, CellLightingInfo>();
  const showAll = options.showAll === true || options.enabled === false;
  const exploredCells = options.exploredCells ?? {};
  const lightSources = options.lightSources ?? [];
  const observers = extractVisionObservers(options);

  // Check if grid already carries projected PlayerViewCell visibilities
  const hasPrecomputedVisibility =
    observers.length === 0 &&
    grid.cells.some(
      (c) => 'visibility' in c && typeof (c as any).visibility === 'string',
    );

  if (hasPrecomputedVisibility && !showAll) {
    for (const cell of grid.cells) {
      const pCell = cell as CanvasCellInput & {
        visibility?: CellVisibility;
        effectiveLight?: LightLevel;
        seenViaDarkvision?: boolean;
      };
      const visibility: CellVisibility = pCell.visibility ?? 'unexplored';
      const effectiveLight: LightLevel = pCell.effectiveLight ?? 'bright';
      const seenViaDarkvision = pCell.seenViaDarkvision ?? false;

      result.set(`${cell.x},${cell.y}`, {
        x: cell.x,
        y: cell.y,
        visibility,
        baseLight: effectiveLight,
        effectiveLight,
        seenViaDarkvision,
      });
    }
    return result;
  }

  // Convert to tactical grid for geometric Line of Sight checks
  const tactical = ensureTacticalGrid(grid);

  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const key = `${x},${y}`;
      const targetPoint: GridPoint = { x, y };

      if (showAll) {
        const baseLight = getCellLightLevel(tactical, targetPoint, lightSources);
        result.set(key, {
          x,
          y,
          visibility: 'visible',
          baseLight,
          effectiveLight: baseLight,
          seenViaDarkvision: false,
        });
        continue;
      }

      const baseLight = getCellLightLevel(tactical, targetPoint, lightSources);
      let isVisible = false;
      let bestRank = -1;
      let seenViaDarkvision = false;

      for (const obs of observers) {
        const distFeet = getCellDistanceFeet(obs, targetPoint);
        // Standard maximum visual distance limit (120 ft)
        if (distFeet > 120) continue;

        if (
          hasLineOfSight(
            tactical,
            obs,
            { x, y, size: 'medium' },
          )
        ) {
          const effLight = applyDarkvision(baseLight, distFeet, obs.darkvisionFeet);

          // Visible if lit or darkvision penetrates darkness
          if (effLight !== 'darkness' || baseLight !== 'darkness') {
            isVisible = true;
            const rank = LIGHT_RANKS[effLight];
            if (rank > bestRank) {
              bestRank = rank;
            }
            if (baseLight === 'darkness' && effLight !== 'darkness') {
              seenViaDarkvision = true;
            }
          }
        }
      }

      if (isVisible) {
        const effectiveLight = RANK_TO_LIGHT[Math.max(0, bestRank)] ?? 'bright';
        result.set(key, {
          x,
          y,
          visibility: 'visible',
          baseLight,
          effectiveLight,
          seenViaDarkvision,
        });
      } else if (exploredCells[key]) {
        result.set(key, {
          x,
          y,
          visibility: 'remembered',
          baseLight,
          effectiveLight: baseLight,
          seenViaDarkvision: false,
        });
      } else {
        result.set(key, {
          x,
          y,
          visibility: 'unexplored',
          baseLight,
          effectiveLight: baseLight,
          seenViaDarkvision: false,
        });
      }
    }
  }

  return result;
}

/**
 * PixiJS Renderer for Dynamic Lighting & Fog-of-War (Scene Graph Layer 6).
 * Handles unexplored darkness mask, remembered shrouded fog, dim/bright lighting,
 * darkvision monochrome styling, and torch/light source halos.
 */
export class LightingAndFogRenderer {
  public readonly container: Container;

  private fogGraphics: Graphics;
  private lightingGraphics: Graphics;
  private lightSourcesGraphics: Graphics;
  private bordersGraphics: Graphics;

  private lastCellMap: Map<string, CellLightingInfo> | null = null;
  private lastGridWidth = 0;
  private lastGridHeight = 0;

  constructor(parent?: Container) {
    this.container = new Container();
    this.container.label = 'LightingAndFogRenderer';

    this.fogGraphics = new Graphics();
    this.fogGraphics.label = 'FogMaskGraphics';

    this.lightingGraphics = new Graphics();
    this.lightingGraphics.label = 'LightingGraphics';

    this.lightSourcesGraphics = new Graphics();
    this.lightSourcesGraphics.label = 'LightSourcesGraphics';

    this.bordersGraphics = new Graphics();
    this.bordersGraphics.label = 'FogBordersGraphics';

    // Layer order: Fog mask -> lighting tint -> borders -> light source halos
    this.container.addChild(this.fogGraphics);
    this.container.addChild(this.lightingGraphics);
    this.container.addChild(this.bordersGraphics);
    this.container.addChild(this.lightSourcesGraphics);

    if (parent) {
      parent.addChild(this.container);
    }
  }

  /**
   * Clears all graphics across fog, lighting, and light source sublayers.
   */
  public clear(): void {
    this.fogGraphics.clear();
    this.lightingGraphics.clear();
    this.lightSourcesGraphics.clear();
    this.bordersGraphics.clear();
    this.lastCellMap = null;
  }

  /**
   * Renders the dynamic lighting & fog-of-war layer.
   */
  public render(options: FogOfWarRenderOptions): void {
    const {
      grid,
      cellSize,
      enabled = true,
      showAll = false,
      showLightSources = true,
      showDarkvisionTint = true,
      showFogBorders = true,
      unexploredColor = FOG_COLORS.unexplored,
      unexploredAlpha = FOG_ALPHAS.unexplored,
      rememberedColor = FOG_COLORS.remembered,
      rememberedAlpha = FOG_ALPHAS.remembered,
      dimColor = FOG_COLORS.dimLight,
      dimAlpha = FOG_ALPHAS.dimLight,
      darknessColor = FOG_COLORS.darkness,
      darknessAlpha = FOG_ALPHAS.darkness,
      darkvisionColor = FOG_COLORS.darkvision,
      darkvisionAlpha = FOG_ALPHAS.darkvision,
      lightSources = [],
    } = options;

    this.clear();

    if (!enabled) {
      return;
    }

    this.lastGridWidth = grid.width;
    this.lastGridHeight = grid.height;

    // Compute cell visibility and lighting
    const cellMap = computeDynamicFog(grid, options);
    this.lastCellMap = cellMap;

    // 1. Draw Fog & Lighting Masks
    for (const info of cellMap.values()) {
      const px = info.x * cellSize;
      const py = info.y * cellSize;

      if (info.visibility === 'unexplored') {
        // Pitch black opaque mask covering unexplored cells
        this.fogGraphics
          .rect(px, py, cellSize, cellSize)
          .fill({ color: unexploredColor, alpha: unexploredAlpha });
      } else if (info.visibility === 'remembered') {
        // Darkened shroud for remembered terrain
        this.fogGraphics
          .rect(px, py, cellSize, cellSize)
          .fill({ color: rememberedColor, alpha: rememberedAlpha });

        // Subtle cross-hatch stippling or inner border to distinguish remembered fog
        this.fogGraphics
          .rect(px + 1, py + 1, cellSize - 2, cellSize - 2)
          .stroke({ color: FOG_COLORS.rememberedBorder, width: 1, alpha: 0.35 });
      } else if (info.visibility === 'visible') {
        // Visible cell: render lighting tint
        if (showDarkvisionTint && info.seenViaDarkvision) {
          // Darkvision: creature sees in darkness as dim light in shades of gray
          this.lightingGraphics
            .rect(px, py, cellSize, cellSize)
            .fill({ color: darkvisionColor, alpha: darkvisionAlpha });

          // Subtle night-vision corner pip
          this.lightingGraphics
            .circle(px + cellSize - 6, py + 6, 2)
            .fill({ color: 0x94a3b8, alpha: 0.5 });
        } else if (info.effectiveLight === 'darkness') {
          // Unlit cell in darkness
          this.lightingGraphics
            .rect(px, py, cellSize, cellSize)
            .fill({ color: darknessColor, alpha: darknessAlpha });
        } else if (info.effectiveLight === 'dim') {
          // Dim light shadow
          this.lightingGraphics
            .rect(px, py, cellSize, cellSize)
            .fill({ color: dimColor, alpha: dimAlpha });
        }
        // 'bright': fully illuminated, 0 overlay alpha
      }
    }

    // 2. Draw Soft Fog Boundary Borders (between explored and unexplored cells)
    if (showFogBorders && !showAll) {
      for (const info of cellMap.values()) {
        if (info.visibility === 'unexplored') continue;
        const px = info.x * cellSize;
        const py = info.y * cellSize;

        // Check North
        const north = cellMap.get(`${info.x},${info.y - 1}`);
        if (!north || north.visibility === 'unexplored') {
          this.bordersGraphics
            .moveTo(px, py)
            .lineTo(px + cellSize, py)
            .stroke({ color: 0x000000, width: 2, alpha: 0.8 });
        }
        // Check South
        const south = cellMap.get(`${info.x},${info.y + 1}`);
        if (!south || south.visibility === 'unexplored') {
          this.bordersGraphics
            .moveTo(px, py + cellSize)
            .lineTo(px + cellSize, py + cellSize)
            .stroke({ color: 0x000000, width: 2, alpha: 0.8 });
        }
        // Check West
        const west = cellMap.get(`${info.x - 1},${info.y}`);
        if (!west || west.visibility === 'unexplored') {
          this.bordersGraphics
            .moveTo(px, py)
            .lineTo(px, py + cellSize)
            .stroke({ color: 0x000000, width: 2, alpha: 0.8 });
        }
        // Check East
        const east = cellMap.get(`${info.x + 1},${info.y}`);
        if (!east || east.visibility === 'unexplored') {
          this.bordersGraphics
            .moveTo(px + cellSize, py)
            .lineTo(px + cellSize, py + cellSize)
            .stroke({ color: 0x000000, width: 2, alpha: 0.8 });
        }
      }
    }

    // 3. Draw Light Source Halos and Glows
    if (showLightSources && lightSources.length > 0) {
      for (const light of lightSources) {
        // Skip rendering light sources if in unexplored fog
        const sourceCell = cellMap.get(`${light.x},${light.y}`);
        if (!showAll && sourceCell && sourceCell.visibility === 'unexplored') {
          continue;
        }

        const cx = (light.x + 0.5) * cellSize;
        const cy = (light.y + 0.5) * cellSize;

        const brightRadiusPx = (light.brightFeet / 5) * cellSize;
        const dimRadiusPx = ((light.brightFeet + light.dimFeet) / 5) * cellSize;

        // Outer dim halo
        if (light.dimFeet > 0) {
          this.lightSourcesGraphics
            .circle(cx, cy, dimRadiusPx)
            .fill({
              color: light.color ?? FOG_COLORS.lightSourceDim,
              alpha: FOG_ALPHAS.lightSourceDimGlow,
            });
        }

        // Inner bright halo
        if (light.brightFeet > 0) {
          this.lightSourcesGraphics
            .circle(cx, cy, brightRadiusPx)
            .fill({
              color: light.color ?? FOG_COLORS.lightSourceBright,
              alpha: FOG_ALPHAS.lightSourceBrightGlow,
            });
        }

        // Central light core pip
        this.lightSourcesGraphics
          .circle(cx, cy, 3)
          .fill({ color: FOG_COLORS.lightSourceCore, alpha: 0.85 });
      }
    }
  }

  /**
   * Returns visibility and lighting info for a given cell coordinate.
   */
  public getCellLightingInfo(x: number, y: number): CellLightingInfo | undefined {
    return this.lastCellMap?.get(`${x},${y}`);
  }

  /**
   * Returns whether a cell is currently in active Line of Sight.
   */
  public isCellVisible(x: number, y: number): boolean {
    return this.getCellLightingInfo(x, y)?.visibility === 'visible';
  }

  /**
   * Returns whether a cell has been explored (either visible or remembered).
   */
  public isCellExplored(x: number, y: number): boolean {
    const info = this.getCellLightingInfo(x, y);
    return info?.visibility === 'visible' || info?.visibility === 'remembered';
  }

  /**
   * Returns count of currently visible cells.
   */
  public getVisibleCellCount(): number {
    if (!this.lastCellMap) return 0;
    let count = 0;
    for (const info of this.lastCellMap.values()) {
      if (info.visibility === 'visible') count++;
    }
    return count;
  }

  /**
   * Returns count of explored cells (visible + remembered).
   */
  public getExploredCellCount(): number {
    if (!this.lastCellMap) return 0;
    let count = 0;
    for (const info of this.lastCellMap.values()) {
      if (info.visibility === 'visible' || info.visibility === 'remembered') count++;
    }
    return count;
  }

  /**
   * Returns count of unexplored cells.
   */
  public getUnexploredCellCount(): number {
    if (!this.lastCellMap) return 0;
    let count = 0;
    for (const info of this.lastCellMap.values()) {
      if (info.visibility === 'unexplored') count++;
    }
    return count;
  }

  /**
   * Returns the cached cell map from the most recent render pass.
   */
  public getLastCellMap(): ReadonlyMap<string, CellLightingInfo> | null {
    return this.lastCellMap;
  }

  /**
   * Cleans up PixiJS graphics objects.
   */
  public destroy(): void {
    this.clear();
    this.fogGraphics.destroy();
    this.lightingGraphics.destroy();
    this.bordersGraphics.destroy();
    this.lightSourcesGraphics.destroy();
    this.container.destroy({ children: true });
  }
}
