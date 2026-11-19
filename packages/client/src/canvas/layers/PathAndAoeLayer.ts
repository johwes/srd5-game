import { Container, Graphics, Text } from 'pixi.js';
import type { ConditionId, CreatureSize } from '@srd5/data';
import {
  type AoeShape,
  type AoeTemplate,
  type CardinalFacing,
  type CoverLevel,
  type CoverResult,
  COVER_AC_BONUS,
  type FeetPoint,
  type GridCell,
  type GridCreature,
  type GridPoint,
  type PathfindingResult,
  type PathStep,
  type TacticalGrid,
  type VisionCreature,
  computeCover,
  findPath,
  footprintBoundaryOrigin,
  getFootprintCells,
  intersectionFeet,
  rasterizeAoe,
  segmentCrossesCell,
} from '@srd5/engine';
import type { PlayerViewCombatant } from '@srd5/transport';
import {
  type AoeOverlayOptions,
  type CanvasGridInput,
  type CreatureTokenData,
  DEFAULT_CELL_SIZE,
  type InteractiveOverlayOptions,
  type PathPreviewOptions,
  type Point,
  type TargetingRayOptions,
} from '../types.js';
import { CREATURE_SIZE_CELLS } from './CreatureTokenLayer.js';

/**
 * Standard palette colors for movement path preview segments and markers.
 */
export const PATH_COLORS = {
  normal: 0x22c55e, // Green-500: within remaining movement
  dash: 0xf59e0b, // Amber-500: reachable with Dash action
  unreachable: 0x94a3b8, // Slate-400: exceeds budget / unreachable
  oaWarning: 0xef4444, // Red-500: Opportunity Attack warning
  destination: 0x38bdf8, // Sky-400: destination ring and label
} as const;

/**
 * Default color configurations for AOE shapes.
 */
export const AOE_DEFAULT_COLORS: Record<AoeShape, { fill: number; border: number }> = {
  sphere: { fill: 0xef4444, border: 0xf87171 },
  cone: { fill: 0xf97316, border: 0xfb923c },
  line: { fill: 0x38bdf8, border: 0x7dd3fc },
  cube: { fill: 0xa855f7, border: 0xc084fc },
  cylinder: { fill: 0x10b981, border: 0x34d399 },
};

/**
 * Color configuration for Line of Sight and Cover visualization.
 */
export const COVER_COLORS: Record<CoverLevel, { ray: number; badgeBorder: number }> = {
  none: { ray: 0x22c55e, badgeBorder: 0x4ade80 },
  half: { ray: 0xeab308, badgeBorder: 0xfacc15 },
  three_quarters: { ray: 0xf97316, badgeBorder: 0xfb923c },
  total: { ray: 0xef4444, badgeBorder: 0xf87171 },
};

/**
 * Normalizes any CanvasGridInput into a strict TacticalGrid representation.
 */
export function ensureTacticalGrid(input: CanvasGridInput): TacticalGrid {
  if ('cells' in input && Array.isArray(input.cells)) {
    const cells: GridCell[] = input.cells.map((c) => ({
      x: c.x,
      y: c.y,
      terrain: c.terrain ?? 'floor_stone',
      elevationFeet: c.elevationFeet ?? 0,
      baseLight:
        'baseLight' in c && c.baseLight
          ? c.baseLight
          : 'effectiveLight' in c && c.effectiveLight
            ? c.effectiveLight
            : 'bright',
      difficultTerrain: c.difficultTerrain ?? false,
      blocksMovement: c.blocksMovement ?? false,
      blocksSight: c.blocksSight ?? false,
    }));
    return {
      width: input.width,
      height: input.height,
      cells,
    };
  }
  return input as TacticalGrid;
}

/**
 * Converts a CreatureTokenData, PlayerViewCombatant, or GridCreature into a standard GridCreature.
 */
export function toGridCreature(
  c: GridCreature | CreatureTokenData | PlayerViewCombatant,
  defaultFaction: 'party' | 'enemy' | 'neutral' = 'party',
): GridCreature {
  const x = 'position' in c ? c.position.x : c.x;
  const y = 'position' in c ? c.position.y : c.y;
  const faction: 'party' | 'enemy' | 'neutral' =
    'faction' in c && c.faction
      ? c.faction
      : 'side' in c
        ? c.side === 'monster'
          ? 'enemy'
          : c.side === 'party'
            ? 'party'
            : 'neutral'
        : defaultFaction;

  const isDead = 'isDead' in c ? c.isDead : false;
  const conditions = 'conditions' in c && Array.isArray(c.conditions) ? c.conditions : [];
  const isIncapacitated =
    isDead ||
    conditions.includes('incapacitated') ||
    conditions.includes('unconscious') ||
    conditions.includes('paralyzed') ||
    conditions.includes('stunned') ||
    conditions.includes('petrified');

  return {
    id: c.id,
    x,
    y,
    size: c.size,
    faction,
    isHostile: 'isHostile' in c ? c.isHostile : undefined,
    reachFeet: 'reachFeet' in c ? c.reachFeet : 5,
    canMakeOpportunityAttack:
      'canMakeOpportunityAttack' in c
        ? c.canMakeOpportunityAttack
        : !isIncapacitated,
    isProne: conditions.includes('prone'),
    speedFeet: 'speedFeet' in c ? c.speedFeet : 30,
  };
}

/**
 * Converts an entity representation into a VisionCreature for cover and sight calculations.
 */
export function toVisionCreature(
  c: VisionCreature | CreatureTokenData | PlayerViewCombatant | GridCreature,
): VisionCreature {
  return {
    id: c.id,
    x: 'position' in c ? c.position.x : c.x,
    y: 'position' in c ? c.position.y : c.y,
    size: c.size,
  };
}

/**
 * Calculates SRD 5.1 d20 attack roll hit probability taking target AC, cover bonus, and attack bonus into account.
 * (Natural 1 is always a miss: max 95%, Natural 20 is always a hit: min 5%).
 */
export function calculateHitChance(
  attackBonus: number,
  targetAc: number,
  cover: CoverLevel,
  hasLoS: boolean = true,
): number {
  if (!hasLoS || cover === 'total') {
    return 0;
  }
  const effectiveAc = targetAc + (COVER_AC_BONUS[cover] ?? 0);
  const targetRoll = effectiveAc - attackBonus;
  if (targetRoll <= 1) return 0.95;
  if (targetRoll >= 20) return 0.05;
  return Number(((21 - targetRoll) / 20).toFixed(2));
}

/**
 * Formats a human-readable cover description badge label.
 */
export function getCoverDescription(cover: CoverLevel, hasLoS: boolean = true): string {
  if (!hasLoS || cover === 'total') return 'Blocked (Total Cover)';
  switch (cover) {
    case 'none':
      return 'No Cover (+0 AC)';
    case 'half':
      return 'Half Cover (+2 AC)';
    case 'three_quarters':
      return '3/4 Cover (+5 AC)';
  }
}

/**
 * Computes AOE template geometry, rasterized cells, and affected creature IDs.
 */
export function computeAoeOverlay(
  options: AoeOverlayOptions,
  cellSize: number = DEFAULT_CELL_SIZE,
): {
  cells: GridPoint[];
  template: AoeTemplate;
  affectedCreatureIds: string[];
} {
  const cursorFeet: FeetPoint = options.cursorIsWorldCoords
    ? { x: (options.cursor.x / cellSize) * 5, y: (options.cursor.y / cellSize) * 5 }
    : { x: (options.cursor.x + 0.5) * 5, y: (options.cursor.y + 0.5) * 5 };

  let template: AoeTemplate;

  switch (options.shape) {
    case 'sphere': {
      const radiusFeet = options.radiusFeet ?? 20;
      const origin = intersectionFeet(
        Math.round(cursorFeet.x / 5),
        Math.round(cursorFeet.y / 5),
      );
      template = { shape: 'sphere', origin, radiusFeet };
      break;
    }
    case 'cylinder': {
      const radiusFeet = options.radiusFeet ?? 10;
      const origin = intersectionFeet(
        Math.round(cursorFeet.x / 5),
        Math.round(cursorFeet.y / 5),
      );
      template = { shape: 'cylinder', origin, radiusFeet, heightFeet: 40 };
      break;
    }
    case 'cone': {
      const lengthFeet = options.lengthFeet ?? 15;
      const casterPos = options.casterPosition ?? { x: 0, y: 0 };
      const casterSizeCells = CREATURE_SIZE_CELLS[options.casterSize ?? 'medium'] ?? 1;
      const origin = footprintBoundaryOrigin(casterPos, casterSizeCells, cursorFeet);
      let dx = cursorFeet.x - origin.x;
      let dy = cursorFeet.y - origin.y;
      if (Math.hypot(dx, dy) < 1e-4) {
        dx = 1;
        dy = 0;
      }
      template = { shape: 'cone', origin, direction: { x: dx, y: dy }, lengthFeet };
      break;
    }
    case 'line': {
      const lengthFeet = options.lengthFeet ?? 30;
      const widthFeet = options.widthFeet ?? 5;
      const casterPos = options.casterPosition ?? { x: 0, y: 0 };
      const casterSizeCells = CREATURE_SIZE_CELLS[options.casterSize ?? 'medium'] ?? 1;
      const origin = footprintBoundaryOrigin(casterPos, casterSizeCells, cursorFeet);
      template = { shape: 'line', origin, target: cursorFeet, lengthFeet, widthFeet };
      break;
    }
    case 'cube': {
      const sideFeet = options.sideFeet ?? 15;
      let facing: CardinalFacing = options.facing ?? 'e';
      if (!options.facing && options.casterPosition) {
        const casterCenterFeet = {
          x: (options.casterPosition.x + 0.5) * 5,
          y: (options.casterPosition.y + 0.5) * 5,
        };
        const dx = cursorFeet.x - casterCenterFeet.x;
        const dy = cursorFeet.y - casterCenterFeet.y;
        facing = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'e' : 'w') : dy >= 0 ? 's' : 'n';
      }
      const cellX = Math.floor(cursorFeet.x / 5);
      const cellY = Math.floor(cursorFeet.y / 5);
      const origin = intersectionFeet(
        facing === 'e' ? cellX : cellX + 1,
        facing === 's' ? cellY : cellY + 1,
      );
      template = { shape: 'cube', origin, sideFeet, facing };
      break;
    }
  }

  const cells = rasterizeAoe(template);

  const affectedCreatureIds: string[] = [];
  if (options.creatures && options.creatures.length > 0) {
    for (const c of options.creatures) {
      const x = 'position' in c ? c.position.x : c.x;
      const y = 'position' in c ? c.position.y : c.y;
      const footprint = getFootprintCells({ x, y }, c.size);
      const isAffected = footprint.some((fc) =>
        cells.some((ac) => ac.x === fc.x && ac.y === fc.y),
      );
      if (isAffected) {
        affectedCreatureIds.push(c.id);
      }
    }
  }

  return { cells, template, affectedCreatureIds };
}

/**
 * Manages rendering of interactive tactical overlays on the PixiJS PathAndAoeLayer:
 * 1. A* path preview with normal / dash / unreachable budget coloring and Opportunity Attack warnings.
 * 2. Translucent AOE targeting templates (spheres, cones, lines, cubes) with cell rasterization and affected target rings.
 * 3. Line of Sight & Cover rays showing hit probability and cover badges.
 */
export class PathAndAoeRenderer {
  public readonly container: Container;

  // Path sub-containers
  public readonly pathContainer: Container;
  private pathGraphics: Graphics;
  private oaContainer: Container;
  private destContainer: Container;

  // AOE sub-containers
  public readonly aoeContainer: Container;
  private aoeHighlightGraphics: Graphics;
  private aoeShapeGraphics: Graphics;
  private aoeTargetRingsContainer: Container;

  // Targeting ray sub-containers
  public readonly targetingRayContainer: Container;
  private rayGraphics: Graphics;
  private coverBadgeContainer: Container;

  // Cached results for external inspection & testing
  private currentPathResult: PathfindingResult | null = null;
  private currentAoeResult: {
    cells: GridPoint[];
    template: AoeTemplate;
    affectedCreatureIds: string[];
  } | null = null;
  private currentCoverResult: {
    cover: CoverResult;
    hitChance: number;
    targetAc: number;
  } | null = null;

  constructor(parent?: Container) {
    this.container = new Container();
    this.container.label = 'PathAndAoeRenderer';

    // 1. Path preview branch
    this.pathContainer = new Container();
    this.pathContainer.label = 'PathPreviewContainer';
    this.pathGraphics = new Graphics();
    this.pathGraphics.label = 'PathGraphics';
    this.oaContainer = new Container();
    this.oaContainer.label = 'OpportunityAttackContainer';
    this.destContainer = new Container();
    this.destContainer.label = 'DestinationMarkerContainer';
    this.pathContainer.addChild(this.pathGraphics);
    this.pathContainer.addChild(this.oaContainer);
    this.pathContainer.addChild(this.destContainer);

    // 2. AOE targeting branch
    this.aoeContainer = new Container();
    this.aoeContainer.label = 'AoeTargetingContainer';
    this.aoeHighlightGraphics = new Graphics();
    this.aoeHighlightGraphics.label = 'AoeHighlightGraphics';
    this.aoeShapeGraphics = new Graphics();
    this.aoeShapeGraphics.label = 'AoeShapeGraphics';
    this.aoeTargetRingsContainer = new Container();
    this.aoeTargetRingsContainer.label = 'AoeTargetRingsContainer';
    this.aoeContainer.addChild(this.aoeHighlightGraphics);
    this.aoeContainer.addChild(this.aoeShapeGraphics);
    this.aoeContainer.addChild(this.aoeTargetRingsContainer);

    // 3. Targeting ray branch
    this.targetingRayContainer = new Container();
    this.targetingRayContainer.label = 'TargetingRayContainer';
    this.rayGraphics = new Graphics();
    this.rayGraphics.label = 'RayGraphics';
    this.coverBadgeContainer = new Container();
    this.coverBadgeContainer.label = 'CoverBadgeContainer';
    this.targetingRayContainer.addChild(this.rayGraphics);
    this.targetingRayContainer.addChild(this.coverBadgeContainer);

    // Mount all three branches in z-order
    this.container.addChild(this.pathContainer);
    this.container.addChild(this.aoeContainer);
    this.container.addChild(this.targetingRayContainer);

    if (parent) {
      parent.addChild(this.container);
    }
  }

  /**
   * Renders composite interactive overlays.
   */
  public render(options: InteractiveOverlayOptions): void {
    const { cellSize = DEFAULT_CELL_SIZE, pathPreview, aoeTemplate, targetingRay } = options;

    if (pathPreview) {
      this.renderPath(pathPreview, cellSize);
    } else {
      this.clearPath();
    }

    if (aoeTemplate) {
      this.renderAoe(aoeTemplate, cellSize);
    } else {
      this.clearAoe();
    }

    if (targetingRay) {
      this.renderTargetingRay(targetingRay, cellSize);
    } else {
      this.clearTargetingRay();
    }
  }

  /**
   * Renders an A* movement path preview with Opportunity Attack warnings and destination badge.
   */
  public renderPath(options: PathPreviewOptions | null, cellSize: number = DEFAULT_CELL_SIZE): void {
    this.clearPath();
    if (!options) return;

    const {
      mover,
      destination,
      grid,
      creatures = [],
      movementRemainingFeet = 30,
      dashBonusFeet = 30,
      isDisengaged = false,
      precomputedResult,
      showOpportunityAttacks = true,
      showDestinationBadge = true,
    } = options;

    const tacticalGrid = ensureTacticalGrid(grid);
    const moverGrid = toGridCreature(mover, 'party');
    const otherCreatures = creatures
      .filter((c) => c.id !== moverGrid.id)
      .map((c) => toGridCreature(c, 'enemy'));

    const result: PathfindingResult =
      precomputedResult ??
      findPath({
        grid: tacticalGrid,
        mover: moverGrid,
        goal: destination,
        creatures: otherCreatures,
        movementRemainingFeet,
        dashBonusFeet,
        isDisengaged,
      });

    this.currentPathResult = result;

    if (!result.found || result.steps.length === 0) {
      return;
    }

    // 1. Draw segmented path polyline
    this.pathGraphics.clear();

    for (const step of result.steps) {
      const fromPx = {
        x: (step.from.x + 0.5) * cellSize,
        y: (step.from.y + 0.5) * cellSize,
      };
      const toPx = {
        x: (step.to.x + 0.5) * cellSize,
        y: (step.to.y + 0.5) * cellSize,
      };

      const color =
        step.budgetStatus === 'normal'
          ? PATH_COLORS.normal
          : step.budgetStatus === 'dash'
            ? PATH_COLORS.dash
            : PATH_COLORS.unreachable;

      // Dark background casing for high contrast on dungeon floors
      this.pathGraphics
        .moveTo(fromPx.x, fromPx.y)
        .lineTo(toPx.x, toPx.y)
        .stroke({ color: 0x020617, width: 6, alpha: 0.8 });

      // Core colored movement segment
      this.pathGraphics
        .moveTo(fromPx.x, fromPx.y)
        .lineTo(toPx.x, toPx.y)
        .stroke({ color, width: 3.5, alpha: 0.95 });

      // Waypoint dot at step.to
      this.pathGraphics.circle(toPx.x, toPx.y, 3).fill({ color, alpha: 0.95 });

      // 2. Opportunity Attack warning chevrons
      const stepHasOa =
        showOpportunityAttacks &&
        (step.opportunityAttacks.length > 0 || step.provokedEnemyIds.length > 0);

      if (stepHasOa) {
        this.renderOaChevron(step, fromPx, toPx, cellSize);
      }
    }

    // Waypoint circle at start
    const startPx = {
      x: (result.steps[0]!.from.x + 0.5) * cellSize,
      y: (result.steps[0]!.from.y + 0.5) * cellSize,
    };
    this.pathGraphics.circle(startPx.x, startPx.y, 4).fill({ color: PATH_COLORS.normal, alpha: 0.9 });

    // 3. Destination marker
    if (showDestinationBadge) {
      const finalStep = result.steps[result.steps.length - 1]!;
      const destPx = {
        x: (finalStep.to.x + 0.5) * cellSize,
        y: (finalStep.to.y + 0.5) * cellSize,
      };
      this.renderDestinationMarker(destPx, result, cellSize);
    }
  }

  /**
   * Draws a red warning chevron and alert badge for an Opportunity Attack trigger along a movement step.
   */
  private renderOaChevron(
    step: PathStep,
    fromPx: Point,
    toPx: Point,
    cellSize: number,
  ): void {
    const midX = (fromPx.x + toPx.x) / 2;
    const midY = (fromPx.y + toPx.y) / 2;
    const angle = Math.atan2(toPx.y - fromPx.y, toPx.x - fromPx.x);

    // Chevron pointing along movement direction
    const chevronLen = Math.min(10, cellSize * 0.22);
    const leftAngle = angle + Math.PI * 0.75;
    const rightAngle = angle - Math.PI * 0.75;

    this.pathGraphics
      .moveTo(midX + Math.cos(leftAngle) * chevronLen, midY + Math.sin(leftAngle) * chevronLen)
      .lineTo(midX, midY)
      .lineTo(midX + Math.cos(rightAngle) * chevronLen, midY + Math.sin(rightAngle) * chevronLen)
      .stroke({ color: PATH_COLORS.oaWarning, width: 3.5, alpha: 1.0 });

    // Opportunity Attack warning badge container
    const badgeContainer = new Container();
    badgeContainer.label = `OABadge_${step.from.x}_${step.from.y}`;
    badgeContainer.position.set(midX, midY - 12);

    const diamond = new Graphics();
    diamond.label = 'OADiamond';
    const s = 7;
    diamond
      .poly([0, -s, s, 0, 0, s, -s, 0])
      .fill({ color: PATH_COLORS.oaWarning, alpha: 0.95 })
      .stroke({ color: 0xffffff, width: 1.5 });

    const oaCount = Math.max(step.opportunityAttacks.length, step.provokedEnemyIds.length, 1);
    const text = new Text({
      text: oaCount > 1 ? `!${oaCount}` : '!',
      style: {
        fontSize: 9,
        fontWeight: 'bold',
        fill: 0xffffff,
        fontFamily: 'sans-serif',
      },
    });
    text.anchor.set(0.5);

    badgeContainer.addChild(diamond);
    badgeContainer.addChild(text);
    this.oaContainer.addChild(badgeContainer);
  }

  /**
   * Draws a destination indicator ring and distance pill at the final step.
   */
  private renderDestinationMarker(
    destPx: Point,
    result: PathfindingResult,
    cellSize: number,
  ): void {
    const finalStep = result.steps[result.steps.length - 1]!;
    const statusColor =
      finalStep.budgetStatus === 'normal'
        ? PATH_COLORS.normal
        : finalStep.budgetStatus === 'dash'
          ? PATH_COLORS.dash
          : PATH_COLORS.unreachable;

    const ring = new Graphics();
    ring.label = 'DestinationRing';
    ring
      .circle(destPx.x, destPx.y, cellSize * 0.35)
      .stroke({ color: statusColor, width: 2, alpha: 0.9 });
    ring
      .circle(destPx.x, destPx.y, cellSize * 0.44)
      .stroke({ color: statusColor, width: 1, alpha: 0.5 });
    this.destContainer.addChild(ring);

    // Distance badge pill below destination cell
    const badge = new Container();
    badge.label = 'DestinationDistanceBadge';
    badge.position.set(destPx.x, destPx.y + cellSize * 0.45);

    const suffix =
      finalStep.budgetStatus === 'dash'
        ? ' (Dash)'
        : finalStep.budgetStatus === 'unreachable'
          ? ' (Unreachable)'
          : '';
    const labelText = `${result.totalCostFeet} ft${suffix}`;

    const text = new Text({
      text: labelText,
      style: {
        fontSize: 10,
        fontWeight: 'bold',
        fill: statusColor,
        fontFamily: 'sans-serif',
      },
    });
    text.anchor.set(0.5);

    const padX = 6;
    const padY = 2;
    const bw = Math.max(28, labelText.length * 6.5 + padX * 2);
    const bh = 16;

    const bg = new Graphics();
    bg.roundRect(-bw / 2, -bh / 2, bw, bh, 4)
      .fill({ color: 0x0f172a, alpha: 0.9 })
      .stroke({ color: statusColor, width: 1 });

    badge.addChild(bg);
    badge.addChild(text);
    this.destContainer.addChild(badge);
  }

  /**
   * Renders an AOE spell or ability targeting template.
   */
  public renderAoe(options: AoeOverlayOptions | null, cellSize: number = DEFAULT_CELL_SIZE): void {
    this.clearAoe();
    if (!options) return;

    const computed = computeAoeOverlay(options, cellSize);
    this.currentAoeResult = computed;

    const palette = AOE_DEFAULT_COLORS[options.shape] ?? AOE_DEFAULT_COLORS.sphere;
    const fillColor = options.color ?? palette.fill;
    const borderColor = palette.border;
    const alpha = options.alpha ?? 0.25;

    // 1. Highlight all rasterized grid squares
    this.aoeHighlightGraphics.clear();
    for (const cell of computed.cells) {
      const px = cell.x * cellSize;
      const py = cell.y * cellSize;

      this.aoeHighlightGraphics
        .rect(px, py, cellSize, cellSize)
        .fill({ color: fillColor, alpha: alpha * 1.2 })
        .stroke({ color: borderColor, width: 1.5, alpha: 0.65 });
    }

    // 2. Render smooth continuous geometric shape overlay
    this.renderAoeShape(computed.template, fillColor, borderColor, alpha, cellSize);

    // 3. Highlight affected creature tokens with glowing targeting reticles
    if (options.creatures && computed.affectedCreatureIds.length > 0) {
      for (const creature of options.creatures) {
        if (!computed.affectedCreatureIds.includes(creature.id)) continue;

        const sizeCells = CREATURE_SIZE_CELLS[creature.size] ?? 1;
        const posX = 'position' in creature ? creature.position.x : creature.x;
        const posY = 'position' in creature ? creature.position.y : creature.y;
        const cx = (posX + sizeCells / 2) * cellSize;
        const cy = (posY + sizeCells / 2) * cellSize;
        const radius = (sizeCells * cellSize) / 2 + 5;

        const ring = new Graphics();
        ring.label = `TargetReticle_${creature.id}`;
        ring
          .circle(cx, cy, radius)
          .stroke({ color: 0xef4444, width: 2.5, alpha: 0.95 });

        // Reticle crosshairs
        const tick = 5;
        ring
          .moveTo(cx - radius - tick, cy)
          .lineTo(cx - radius + tick, cy)
          .stroke({ color: 0xef4444, width: 2, alpha: 0.95 });
        ring
          .moveTo(cx + radius - tick, cy)
          .lineTo(cx + radius + tick, cy)
          .stroke({ color: 0xef4444, width: 2, alpha: 0.95 });
        ring
          .moveTo(cx, cy - radius - tick)
          .lineTo(cx, cy - radius + tick)
          .stroke({ color: 0xef4444, width: 2, alpha: 0.95 });
        ring
          .moveTo(cx, cy + radius - tick)
          .lineTo(cx, cy + radius + tick)
          .stroke({ color: 0xef4444, width: 2, alpha: 0.95 });

        this.aoeTargetRingsContainer.addChild(ring);
      }
    }
  }

  /**
   * Draws the continuous geometric shape for an AOE template.
   */
  private renderAoeShape(
    template: AoeTemplate,
    fillColor: number,
    borderColor: number,
    alpha: number,
    cellSize: number,
  ): void {
    this.aoeShapeGraphics.clear();

    switch (template.shape) {
      case 'sphere':
      case 'cylinder': {
        const cx = (template.origin.x / 5) * cellSize;
        const cy = (template.origin.y / 5) * cellSize;
        const r = (template.radiusFeet / 5) * cellSize;
        this.aoeShapeGraphics
          .circle(cx, cy, r)
          .fill({ color: fillColor, alpha })
          .stroke({ color: borderColor, width: 2, alpha: 0.85 });
        break;
      }
      case 'cone': {
        const ox = (template.origin.x / 5) * cellSize;
        const oy = (template.origin.y / 5) * cellSize;
        const lenPx = (template.lengthFeet / 5) * cellSize;
        const baseAngle = Math.atan2(template.direction.y, template.direction.x);
        const halfAngle = Math.atan(0.5); // SRD 5.1: cone width equals length at distance

        const points: number[] = [ox, oy];
        const segments = 16;
        for (let i = -segments / 2; i <= segments / 2; i++) {
          const a = baseAngle + (i / (segments / 2)) * halfAngle;
          points.push(ox + Math.cos(a) * lenPx, oy + Math.sin(a) * lenPx);
        }
        points.push(ox, oy);

        this.aoeShapeGraphics
          .poly(points)
          .fill({ color: fillColor, alpha })
          .stroke({ color: borderColor, width: 2, alpha: 0.85 });
        break;
      }
      case 'line': {
        const ox = (template.origin.x / 5) * cellSize;
        const oy = (template.origin.y / 5) * cellSize;
        const lenPx = (template.lengthFeet / 5) * cellSize;
        const widthPx = ((template.widthFeet ?? 5) / 5) * cellSize;
        const hw = widthPx / 2;

        const dx = (template.target.x - template.origin.x) / 5;
        const dy = (template.target.y - template.origin.y) / 5;
        const dist = Math.hypot(dx, dy);
        const vx = dist > 1e-4 ? dx / dist : 1;
        const vy = dist > 1e-4 ? dy / dist : 0;
        const px = -vy;
        const py = vx;

        const p0x = ox + px * hw;
        const p0y = oy + py * hw;
        const p1x = ox - px * hw;
        const p1y = oy - py * hw;
        const p2x = ox + vx * lenPx - px * hw;
        const p2y = oy + vy * lenPx - py * hw;
        const p3x = ox + vx * lenPx + px * hw;
        const p3y = oy + vy * lenPx + py * hw;

        this.aoeShapeGraphics
          .poly([p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y])
          .fill({ color: fillColor, alpha })
          .stroke({ color: borderColor, width: 2, alpha: 0.85 });
        break;
      }
      case 'cube': {
        const ox = (template.origin.x / 5) * cellSize;
        const oy = (template.origin.y / 5) * cellSize;
        const sidePx = (template.sideFeet / 5) * cellSize;

        let rx = ox;
        let ry = oy;
        switch (template.facing) {
          case 'e':
            ry = oy - sidePx / 2;
            break;
          case 'w':
            rx = ox - sidePx;
            ry = oy - sidePx / 2;
            break;
          case 's':
            rx = ox - sidePx / 2;
            break;
          case 'n':
            rx = ox - sidePx / 2;
            ry = oy - sidePx;
            break;
        }

        this.aoeShapeGraphics
          .rect(rx, ry, sidePx, sidePx)
          .fill({ color: fillColor, alpha })
          .stroke({ color: borderColor, width: 2, alpha: 0.85 });
        break;
      }
    }
  }

  /**
   * Renders a Line of Sight & Cover ray with hit probability breakdown and cover badge.
   */
  public renderTargetingRay(
    options: TargetingRayOptions | null,
    cellSize: number = DEFAULT_CELL_SIZE,
  ): void {
    this.clearTargetingRay();
    if (!options) return;

    const {
      attacker,
      target,
      grid,
      obstacles = [],
      attackBonus,
      targetAc = 'armorClass' in target && typeof target.armorClass === 'number'
        ? target.armorClass
        : 10,
      showAllRays = true,
      precomputedCover,
    } = options;

    const tacticalGrid = ensureTacticalGrid(grid);
    const attackerVis = toVisionCreature(attacker);
    const targetVis = toVisionCreature(target);
    const obstaclesVis = obstacles.map((o) => toVisionCreature(o));

    const coverResult =
      precomputedCover ?? computeCover(tacticalGrid, attackerVis, targetVis, obstaclesVis);

    const hitChance =
      attackBonus !== undefined
        ? calculateHitChance(attackBonus, targetAc, coverResult.cover, coverResult.hasLineOfSight)
        : 0;

    this.currentCoverResult = {
      cover: coverResult,
      hitChance,
      targetAc,
    };

    const attackerSizeCells = CREATURE_SIZE_CELLS[attackerVis.size] ?? 1;
    const targetSizeCells = CREATURE_SIZE_CELLS[targetVis.size] ?? 1;

    const attackerCenterPx = {
      x: (attackerVis.x + attackerSizeCells / 2) * cellSize,
      y: (attackerVis.y + attackerSizeCells / 2) * cellSize,
    };
    const targetCenterPx = {
      x: (targetVis.x + targetSizeCells / 2) * cellSize,
      y: (targetVis.y + targetSizeCells / 2) * cellSize,
    };

    const palette = COVER_COLORS[coverResult.cover] ?? COVER_COLORS.none;
    this.rayGraphics.clear();

    // 1. Detailed corner rays (attacker origin corner to 4 target corners)
    if (showAllRays && coverResult.originCorner) {
      const originCornerPx = {
        x: coverResult.originCorner.x * cellSize,
        y: coverResult.originCorner.y * cellSize,
      };

      const targetCorners: Point[] = [
        { x: targetVis.x * cellSize, y: targetVis.y * cellSize },
        { x: (targetVis.x + targetSizeCells) * cellSize, y: targetVis.y * cellSize },
        { x: targetVis.x * cellSize, y: (targetVis.y + targetSizeCells) * cellSize },
        {
          x: (targetVis.x + targetSizeCells) * cellSize,
          y: (targetVis.y + targetSizeCells) * cellSize,
        },
      ];

      for (const tc of targetCorners) {
        // Trace line from origin corner to target corner
        const ptA: readonly [number, number] = [
          coverResult.originCorner.x,
          coverResult.originCorner.y,
        ];
        const ptB: readonly [number, number] = [tc.x / cellSize, tc.y / cellSize];

        // Check if segment is blocked by solid terrain
        let isBlocked = false;
        for (const cell of tacticalGrid.cells) {
          if (cell.blocksSight || cell.terrain === 'wall_solid' || cell.terrain === 'void') {
            if (segmentCrossesCell(ptA, ptB, cell.x, cell.y)) {
              isBlocked = true;
              break;
            }
          }
        }

        const rayColor = isBlocked ? 0xef4444 : 0x38bdf8;
        const rayAlpha = isBlocked ? 0.35 : 0.6;

        this.rayGraphics
          .moveTo(originCornerPx.x, originCornerPx.y)
          .lineTo(tc.x, tc.y)
          .stroke({ color: rayColor, width: 1.5, alpha: rayAlpha });
      }
    }

    // 2. Primary targeting ray from attacker center to target center
    // Dark outline casing
    this.rayGraphics
      .moveTo(attackerCenterPx.x, attackerCenterPx.y)
      .lineTo(targetCenterPx.x, targetCenterPx.y)
      .stroke({ color: 0x020617, width: 5, alpha: 0.8 });

    // Inner ray
    this.rayGraphics
      .moveTo(attackerCenterPx.x, attackerCenterPx.y)
      .lineTo(targetCenterPx.x, targetCenterPx.y)
      .stroke({ color: palette.ray, width: 3, alpha: 0.95 });

    // Target reticle ring
    const targetRadius = (targetSizeCells * cellSize) / 2;
    this.rayGraphics
      .circle(targetCenterPx.x, targetCenterPx.y, targetRadius + 4)
      .stroke({ color: palette.ray, width: 2, alpha: 0.9 });

    // 3. Floating Cover Badge and Hit Chance Tooltip
    this.renderCoverBadge(targetCenterPx, targetRadius, coverResult, hitChance, attackBonus, targetAc);
  }

  /**
   * Draws the floating cover badge showing cover level and hit probability breakdown.
   */
  private renderCoverBadge(
    targetCenterPx: Point,
    targetRadius: number,
    coverResult: CoverResult,
    hitChance: number,
    attackBonus: number | undefined,
    targetAc: number,
  ): void {
    const badge = new Container();
    badge.label = 'CoverBadge';
    badge.position.set(targetCenterPx.x, targetCenterPx.y - targetRadius - 16);

    const desc = getCoverDescription(coverResult.cover, coverResult.hasLineOfSight);
    const hitText =
      attackBonus !== undefined && coverResult.hasLineOfSight && coverResult.cover !== 'total'
        ? ` • ${Math.round(hitChance * 100)}% to hit`
        : !coverResult.hasLineOfSight || coverResult.cover === 'total'
          ? ' • 0% to hit'
          : '';

    const labelText = `${desc}${hitText}`;
    const palette = COVER_COLORS[coverResult.cover] ?? COVER_COLORS.none;

    const text = new Text({
      text: labelText,
      style: {
        fontSize: 10,
        fontWeight: 'bold',
        fill: 0xffffff,
        fontFamily: 'sans-serif',
      },
    });
    text.anchor.set(0.5);

    const padX = 8;
    const padY = 3;
    const bw = Math.max(36, labelText.length * 6.5 + padX * 2);
    const bh = 18;

    const bg = new Graphics();
    bg.roundRect(-bw / 2, -bh / 2, bw, bh, 5)
      .fill({ color: 0x0f172a, alpha: 0.95 })
      .stroke({ color: palette.badgeBorder, width: 1.5 });

    badge.addChild(bg);
    badge.addChild(text);
    this.coverBadgeContainer.addChild(badge);
  }

  /**
   * Clears the movement path overlay.
   */
  public clearPath(): void {
    this.pathGraphics.clear();
    this.oaContainer.removeChildren();
    this.destContainer.removeChildren();
    this.currentPathResult = null;
  }

  /**
   * Clears the AOE targeting template overlay.
   */
  public clearAoe(): void {
    this.aoeHighlightGraphics.clear();
    this.aoeShapeGraphics.clear();
    this.aoeTargetRingsContainer.removeChildren();
    this.currentAoeResult = null;
  }

  /**
   * Clears the Line of Sight & Cover ray overlay.
   */
  public clearTargetingRay(): void {
    this.rayGraphics.clear();
    this.coverBadgeContainer.removeChildren();
    this.currentCoverResult = null;
  }

  /**
   * Clears all overlay sub-branches.
   */
  public clear(): void {
    this.clearPath();
    this.clearAoe();
    this.clearTargetingRay();
  }

  /**
   * Returns the most recent pathfinding result.
   */
  public getPathResult(): PathfindingResult | null {
    return this.currentPathResult;
  }

  /**
   * Returns the most recent AOE calculation result.
   */
  public getAoeResult(): {
    cells: GridPoint[];
    template: AoeTemplate;
    affectedCreatureIds: string[];
  } | null {
    return this.currentAoeResult;
  }

  /**
   * Returns the most recent Cover calculation result.
   */
  public getCoverResult(): {
    cover: CoverResult;
    hitChance: number;
    targetAc: number;
  } | null {
    return this.currentCoverResult;
  }

  /**
   * Destroys all sub-containers and graphics.
   */
  public destroy(): void {
    this.clear();
    this.container.destroy({ children: true });
  }
}
