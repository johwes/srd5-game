import { Container, Graphics, Text } from 'pixi.js';
import type { ConditionId, CreatureSize } from '@srd5/data';
import type { CombatantSide } from '@srd5/engine';
import type { PlayerViewCombatant } from '@srd5/transport';
import {
  type CreatureFacing,
  type CreatureTokenData,
  type Point,
  type TokenMoveAnimationOptions,
  type TokenRenderOptions,
} from '../types.js';

/**
 * Footprint width in grid cells for each creature size.
 */
export const CREATURE_SIZE_CELLS: Record<CreatureSize, number> = {
  tiny: 1,
  small: 1,
  medium: 1,
  large: 2,
  huge: 3,
  gargantuan: 4,
};

/**
 * Standard side-specific token frame colors.
 */
export const TOKEN_SIDE_COLORS: Record<CombatantSide, { stroke: number; fill: number; glow: number }> = {
  party: { stroke: 0x38bdf8, fill: 0x0f172a, glow: 0x0ea5e9 },
  monster: { stroke: 0xef4444, fill: 0x1a0606, glow: 0xdc2626 },
  neutral: { stroke: 0xf59e0b, fill: 0x1a1306, glow: 0xd97706 },
};

/**
 * Condition badge metadata: color and 2-letter abbreviation.
 */
export const CONDITION_BADGE_CONFIG: Record<
  ConditionId,
  { label: string; color: number; border: number }
> = {
  blinded: { label: 'BL', color: 0x475569, border: 0x94a3b8 },
  charmed: { label: 'CH', color: 0xc026d3, border: 0xf0abfc },
  deafened: { label: 'DF', color: 0x64748b, border: 0x94a3b8 },
  exhaustion: { label: 'EX', color: 0x881337, border: 0xfb7185 },
  frightened: { label: 'FR', color: 0x9333ea, border: 0xd8b4fe },
  grappled: { label: 'GR', color: 0xd97706, border: 0xfcd34d },
  incapacitated: { label: 'IC', color: 0xbe123c, border: 0xf43f5e },
  invisible: { label: 'IN', color: 0x0284c7, border: 0x7dd3fc },
  paralyzed: { label: 'PA', color: 0xdc2626, border: 0xfca5a5 },
  petrified: { label: 'PT', color: 0x57534e, border: 0xa8a29e },
  poisoned: { label: 'PO', color: 0x16a34a, border: 0x86efac },
  prone: { label: 'PR', color: 0x4b5563, border: 0xd1d5db },
  restrained: { label: 'RE', color: 0xb45309, border: 0xfde047 },
  stunned: { label: 'ST', color: 0xe11d48, border: 0xfda4af },
  unconscious: { label: 'ZZ', color: 0x312e81, border: 0xa5b4fc },
};

/**
 * Converts a CreatureFacing direction into an angle in radians (0 = East, +pi/2 = South).
 */
export function facingToAngleRad(facing: CreatureFacing): number {
  switch (facing) {
    case 'n':
      return -Math.PI / 2;
    case 'ne':
      return -Math.PI / 4;
    case 'e':
      return 0;
    case 'se':
      return Math.PI / 4;
    case 's':
      return Math.PI / 2;
    case 'sw':
      return (3 * Math.PI) / 4;
    case 'w':
      return Math.PI;
    case 'nw':
      return (-3 * Math.PI) / 4;
  }
}

/**
 * Determines the closest CreatureFacing from a 2D delta vector (dx, dy).
 */
export function vectorToFacing(dx: number, dy: number): CreatureFacing {
  if (dx === 0 && dy === 0) return 'e';
  const angle = Math.atan2(dy, dx); // range -PI to +PI
  // 8 sectors: each is 45 deg (PI / 4)
  const normalized = (angle + Math.PI * 2) % (Math.PI * 2);
  const sector = Math.round(normalized / (Math.PI / 4)) % 8;
  const facings: CreatureFacing[] = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];
  return facings[sector] ?? 'e';
}

/**
 * Internal record for an active creature token on the canvas.
 */
export interface TokenNode {
  container: Container;
  auraGraphics: Graphics;
  baseDiscGraphics: Graphics;
  hpArcGraphics: Graphics;
  facingGraphics: Graphics;
  initialText: Text;
  conditionsContainer: Container;
  nameText: Text;
  data: CreatureTokenData;
  targetPos: Point;
  currentFacing: CreatureFacing;
}

/**
 * Active movement animation tracking.
 */
interface ActiveMoveAnimation {
  tokenId: string;
  path: Point[];
  currentStepIndex: number;
  totalSteps: number;
  stepElapsedMs: number;
  stepDurationMs: number;
  onStep?: (currentPos: Point, stepIndex: number) => void;
  resolve: () => void;
}

/**
 * Manages rendering of creature tokens on the PixiJS CreatureTokenLayer.
 * Supports token discs, HP perimeter arcs, condition badges, directional facing,
 * active turn auras, selection outlines, and waypoint movement animations.
 */
export class CreatureTokenRenderer {
  public readonly container: Container;
  private tokenNodes = new Map<string, TokenNode>();
  private activeAnimations = new Map<string, ActiveMoveAnimation>();

  public onTokenClick?: (tokenId: string) => void;
  public onTokenHover?: (tokenId: string | null) => void;

  constructor(parent?: Container) {
    this.container = new Container();
    this.container.label = 'CreatureTokenRenderer';

    if (parent) {
      parent.addChild(this.container);
    }
  }

  /**
   * Renders or updates tokens from the given options.
   */
  public render(options: TokenRenderOptions): void {
    const {
      combatants,
      cellSize,
      selectedId = null,
      activeId = null,
      hoveredId = null,
      showHpArc = true,
      showConditionBadges = true,
      showFacing = true,
      showNameTags = true,
    } = options;

    const list: CreatureTokenData[] = Array.isArray(combatants)
      ? (combatants as CreatureTokenData[])
      : Object.values(combatants as Record<string, CreatureTokenData>);

    const presentIds = new Set<string>();

    for (const c of list) {
      presentIds.add(c.id);
      this.updateOrCreateToken(c, {
        cellSize,
        isSelected: selectedId === c.id,
        isActive: activeId === c.id,
        isHovered: hoveredId === c.id,
        showHpArc,
        showConditionBadges,
        showFacing,
        showNameTags,
      });
    }

    // Clean up removed tokens
    for (const [id, node] of this.tokenNodes.entries()) {
      if (!presentIds.has(id)) {
        this.container.removeChild(node.container);
        node.container.destroy({ children: true });
        this.tokenNodes.delete(id);
        this.activeAnimations.delete(id);
      }
    }
  }

  /**
   * Updates an existing token or constructs a new one.
   */
  private updateOrCreateToken(
    data: CreatureTokenData,
    opts: {
      cellSize: number;
      isSelected: boolean;
      isActive: boolean;
      isHovered: boolean;
      showHpArc: boolean;
      showConditionBadges: boolean;
      showFacing: boolean;
      showNameTags: boolean;
    },
  ): TokenNode {
    let node = this.tokenNodes.get(data.id);

    if (!node) {
      const container = new Container();
      container.label = `Token_${data.id}`;
      container.eventMode = 'static';
      container.cursor = 'pointer';

      container.on('pointerdown', (e) => {
        e.stopPropagation();
        this.onTokenClick?.(data.id);
      });
      container.on('pointerover', () => {
        this.onTokenHover?.(data.id);
      });
      container.on('pointerout', () => {
        this.onTokenHover?.(null);
      });

      const auraGraphics = new Graphics();
      auraGraphics.label = 'AuraGraphics';

      const baseDiscGraphics = new Graphics();
      baseDiscGraphics.label = 'BaseDiscGraphics';

      const hpArcGraphics = new Graphics();
      hpArcGraphics.label = 'HpArcGraphics';

      const facingGraphics = new Graphics();
      facingGraphics.label = 'FacingGraphics';

      const initialText = new Text({
        text: '',
        style: {
          fontFamily: 'sans-serif',
          fontWeight: 'bold',
          fontSize: 14,
          fill: 0xffffff,
          align: 'center',
        },
      });
      initialText.label = 'InitialText';
      initialText.anchor.set(0.5, 0.5);

      const conditionsContainer = new Container();
      conditionsContainer.label = 'ConditionsContainer';

      const nameText = new Text({
        text: '',
        style: {
          fontFamily: 'sans-serif',
          fontSize: 10,
          fill: 0xe2e8f0,
          stroke: { color: 0x000000, width: 2 },
          align: 'center',
        },
      });
      nameText.label = 'NameText';
      nameText.anchor.set(0.5, 0);

      container.addChild(auraGraphics);
      container.addChild(baseDiscGraphics);
      container.addChild(hpArcGraphics);
      container.addChild(facingGraphics);
      container.addChild(initialText);
      container.addChild(conditionsContainer);
      container.addChild(nameText);

      this.container.addChild(container);

      node = {
        container,
        auraGraphics,
        baseDiscGraphics,
        hpArcGraphics,
        facingGraphics,
        initialText,
        conditionsContainer,
        nameText,
        data,
        targetPos: { ...data.position },
        currentFacing: data.facing ?? 'e',
      };
      this.tokenNodes.set(data.id, node);
    }

    node.data = data;
    if (data.facing) {
      node.currentFacing = data.facing;
    }

    const sizeCells = CREATURE_SIZE_CELLS[data.size] ?? 1;
    const footprintPx = sizeCells * opts.cellSize;
    const radius = Math.max(12, footprintPx * 0.44);

    // If no active move animation, position container directly at grid center
    if (!this.activeAnimations.has(data.id)) {
      const worldX = (data.position.x + sizeCells / 2) * opts.cellSize;
      const worldY = (data.position.y + sizeCells / 2) * opts.cellSize;
      node.container.position.set(worldX, worldY);
      node.targetPos = { ...data.position };
    }

    // 1. Aura / Selection / Hover Ring
    this.drawAura(node.auraGraphics, radius, opts);

    // 2. Base Disc & Frame
    this.drawBaseDisc(node.baseDiscGraphics, radius, data);

    // 3. HP Perimeter Arc
    if (opts.showHpArc) {
      this.drawHpArc(node.hpArcGraphics, radius, data);
      node.hpArcGraphics.visible = true;
    } else {
      node.hpArcGraphics.visible = false;
    }

    // 4. Directional Facing Pointer
    if (opts.showFacing) {
      this.drawFacing(node.facingGraphics, radius, node.currentFacing);
      node.facingGraphics.visible = true;
    } else {
      node.facingGraphics.visible = false;
    }

    // 5. Initial / Label Text
    this.updateInitialText(node.initialText, radius, data);

    // 6. Condition Badges
    if (opts.showConditionBadges && data.conditions && data.conditions.length > 0) {
      this.drawConditionBadges(node.conditionsContainer, radius, data.conditions);
      node.conditionsContainer.visible = true;
    } else {
      node.conditionsContainer.removeChildren().forEach((c) => c.destroy());
      node.conditionsContainer.visible = false;
    }

    // 7. Name Tag
    if (opts.showNameTags) {
      node.nameText.text = data.name;
      node.nameText.position.set(0, radius + 4);
      node.nameText.visible = true;
    } else {
      node.nameText.visible = false;
    }

    return node;
  }

  /**
   * Draws selection glow, active turn gold ring, and hover ring.
   */
  private drawAura(
    g: Graphics,
    radius: number,
    opts: { isSelected: boolean; isActive: boolean; isHovered: boolean },
  ): void {
    g.clear();

    if (opts.isActive) {
      // Golden turn pulse ring
      g.circle(0, 0, radius + 4).stroke({ color: 0xf59e0b, width: 3, alpha: 0.85 });
      g.circle(0, 0, radius + 7).stroke({ color: 0xfbbf24, width: 1.5, alpha: 0.4 });
    }

    if (opts.isSelected) {
      // Cyan selection ring
      g.circle(0, 0, radius + 5).stroke({ color: 0x06b6d4, width: 2.5, alpha: 0.95 });
    } else if (opts.isHovered && !opts.isActive) {
      // Subtle white hover ring
      g.circle(0, 0, radius + 3).stroke({ color: 0xffffff, width: 1.5, alpha: 0.6 });
    }
  }

  /**
   * Draws the circular body disc, side frame, and dead status indicators.
   */
  private drawBaseDisc(g: Graphics, radius: number, data: CreatureTokenData): void {
    g.clear();

    const isDead = data.isDead || data.currentHp <= 0;
    const sideTheme = TOKEN_SIDE_COLORS[data.side] ?? TOKEN_SIDE_COLORS.neutral;
    const strokeColor = data.color ?? sideTheme.stroke;

    if (isDead) {
      // Dead/unconscious token styling: dark grey disc with cross marker
      g.circle(0, 0, radius).fill(0x0f172a);
      g.circle(0, 0, radius).stroke({ color: 0x475569, width: 2, alpha: 0.7 });

      // Cross / skull mark
      const d = radius * 0.4;
      g.moveTo(-d, -d).lineTo(d, d).stroke({ color: 0xef4444, width: 3, alpha: 0.8 });
      g.moveTo(d, -d).lineTo(-d, d).stroke({ color: 0xef4444, width: 3, alpha: 0.8 });
    } else {
      // Normal living creature token
      g.circle(0, 0, radius).fill(sideTheme.fill);
      g.circle(0, 0, radius).stroke({ color: strokeColor, width: 2.5, alpha: 0.95 });
    }
  }

  /**
   * Draws a circular perimeter HP gauge (from 135 deg to 405 deg = 270 deg arc).
   * Green (>50%), Amber (20-50%), Red (<=20%), with cyan overlay for Temp HP.
   */
  private drawHpArc(g: Graphics, radius: number, data: CreatureTokenData): void {
    g.clear();

    const maxHp = Math.max(1, data.maxHp);
    const currentHp = Math.max(0, data.currentHp);
    const hpRatio = Math.min(1.0, currentHp / maxHp);

    const startAngle = (3 * Math.PI) / 4; // 135 deg (bottom-left)
    const arcLength = (3 * Math.PI) / 2; // 270 deg span (over top to bottom-right)
    const arcRadius = radius + 1.5;

    // 1. Background groove
    g.arc(0, 0, arcRadius, startAngle, startAngle + arcLength).stroke({
      color: 0x1e293b,
      width: 3.5,
      alpha: 0.7,
    });

    if (hpRatio > 0 && !data.isDead) {
      // Color coded by vitality ratio
      let hpColor = 0x22c55e; // Green
      if (hpRatio <= 0.2) {
        hpColor = 0xef4444; // Red
      } else if (hpRatio <= 0.5) {
        hpColor = 0xf59e0b; // Amber
      }

      const currentEndAngle = startAngle + arcLength * hpRatio;
      g.arc(0, 0, arcRadius, startAngle, currentEndAngle).stroke({
        color: hpColor,
        width: 3.5,
        alpha: 0.95,
      });
    }

    // 2. Temp HP gauge (if any, drawn just outside or on top in bright cyan)
    if (data.tempHp && data.tempHp > 0 && !data.isDead) {
      const tempRatio = Math.min(1.0, data.tempHp / maxHp);
      const tempEndAngle = startAngle + arcLength * tempRatio;
      g.arc(0, 0, arcRadius + 2.5, startAngle, tempEndAngle).stroke({
        color: 0x38bdf8,
        width: 2.5,
        alpha: 0.9,
      });
    }
  }

  /**
   * Draws a directional facing chevron/pointer outward on the perimeter.
   */
  private drawFacing(g: Graphics, radius: number, facing: CreatureFacing): void {
    g.clear();

    const angle = facingToAngleRad(facing);
    const tipDist = radius + 6;
    const baseDist = radius - 1;
    const spread = 0.22; // radians

    const tipX = Math.cos(angle) * tipDist;
    const tipY = Math.sin(angle) * tipDist;

    const leftX = Math.cos(angle - spread) * baseDist;
    const leftY = Math.sin(angle - spread) * baseDist;

    const rightX = Math.cos(angle + spread) * baseDist;
    const rightY = Math.sin(angle + spread) * baseDist;

    g.poly([tipX, tipY, leftX, leftY, rightX, rightY]).fill(0xfbbf24);
    g.poly([tipX, tipY, leftX, leftY, rightX, rightY]).stroke({
      color: 0x78350f,
      width: 1,
    });
  }

  /**
   * Updates initial / abbreviation text inside the token disc.
   */
  private updateInitialText(textNode: Text, radius: number, data: CreatureTokenData): void {
    if (data.isDead || data.currentHp <= 0) {
      textNode.text = '';
      return;
    }

    let initial = data.label;
    if (!initial) {
      const parts = data.name.trim().split(/\s+/);
      if (parts.length >= 2) {
        initial = (parts[0][0] + parts[1][0]).toUpperCase();
      } else {
        initial = data.name.slice(0, 2).toUpperCase();
      }
    }

    textNode.text = initial;
    textNode.style.fontSize = Math.max(10, Math.round(radius * 0.55));
    textNode.position.set(0, 0);
  }

  /**
   * Renders condition badges along the bottom edge of the token.
   */
  private drawConditionBadges(
    container: Container,
    radius: number,
    conditions: ConditionId[],
  ): void {
    container.removeChildren().forEach((c) => c.destroy());

    const maxBadgesToShow = 3;
    const visibleConditions = conditions.slice(0, maxBadgesToShow);
    const extraCount = conditions.length - maxBadgesToShow;

    const badgeRadius = 7.5;
    const badgeSpacing = 16;
    const totalBadges = visibleConditions.length + (extraCount > 0 ? 1 : 0);
    const startX = -((totalBadges - 1) * badgeSpacing) / 2;
    const badgeY = radius * 0.72;

    visibleConditions.forEach((condId, index) => {
      const badge = new Container();
      badge.label = `Badge_${condId}`;

      const config = CONDITION_BADGE_CONFIG[condId] ?? {
        label: condId.slice(0, 2).toUpperCase(),
        color: 0x475569,
        border: 0x94a3b8,
      };

      const bg = new Graphics();
      bg.circle(0, 0, badgeRadius).fill(config.color);
      bg.circle(0, 0, badgeRadius).stroke({ color: config.border, width: 1.5 });

      const label = new Text({
        text: config.label,
        style: {
          fontFamily: 'monospace',
          fontSize: 7.5,
          fontWeight: 'bold',
          fill: 0xffffff,
          align: 'center',
        },
      });
      label.anchor.set(0.5, 0.5);

      badge.addChild(bg);
      badge.addChild(label);
      badge.position.set(startX + index * badgeSpacing, badgeY);

      container.addChild(badge);
    });

    if (extraCount > 0) {
      const extraBadge = new Container();
      extraBadge.label = 'Badge_More';

      const bg = new Graphics();
      bg.circle(0, 0, badgeRadius).fill(0x334155);
      bg.circle(0, 0, badgeRadius).stroke({ color: 0x94a3b8, width: 1.5 });

      const label = new Text({
        text: `+${extraCount}`,
        style: {
          fontFamily: 'sans-serif',
          fontSize: 7.5,
          fontWeight: 'bold',
          fill: 0xf8fafc,
          align: 'center',
        },
      });
      label.anchor.set(0.5, 0.5);

      extraBadge.addChild(bg);
      extraBadge.addChild(label);
      extraBadge.position.set(startX + visibleConditions.length * badgeSpacing, badgeY);

      container.addChild(extraBadge);
    }
  }

  /**
   * Animates a token smoothly along a waypoint path.
   * Updates facing to point along each movement segment.
   */
  public animateMove(
    tokenId: string,
    path: Point[],
    options: TokenMoveAnimationOptions = {},
  ): Promise<void> {
    return new Promise((resolve) => {
      const node = this.tokenNodes.get(tokenId);
      if (!node || path.length <= 1) {
        if (node && path.length === 1) {
          node.targetPos = { ...path[0] };
        }
        resolve();
        return;
      }

      const totalSteps = path.length - 1;
      const defaultDuration = totalSteps * 180; // 180ms per step
      const totalDuration = options.durationMs ?? defaultDuration;
      const stepDurationMs = totalDuration / totalSteps;

      const anim: ActiveMoveAnimation = {
        tokenId,
        path,
        currentStepIndex: 0,
        totalSteps,
        stepElapsedMs: 0,
        stepDurationMs,
        onStep: options.onStep,
        resolve,
      };

      this.activeAnimations.set(tokenId, anim);

      // Immediately orient towards first destination
      const p0 = path[0];
      const p1 = path[1];
      const facing = vectorToFacing(p1.x - p0.x, p1.y - p0.y);
      node.currentFacing = facing;
      const sizeCells = CREATURE_SIZE_CELLS[node.data.size] ?? 1;
      const radius = Math.max(12, sizeCells * 48 * 0.44);
      this.drawFacing(node.facingGraphics, radius, facing);
    });
  }

  /**
   * Advances active movement animations by deltaMs or wall clock time.
   */
  public update(deltaMs: number, cellSize = 48): void {
    for (const [tokenId, anim] of Array.from(this.activeAnimations.entries())) {
      const node = this.tokenNodes.get(tokenId);
      if (!node) {
        anim.resolve();
        this.activeAnimations.delete(tokenId);
        continue;
      }

      const sizeCells = CREATURE_SIZE_CELLS[node.data.size] ?? 1;
      const radius = Math.max(12, sizeCells * cellSize * 0.44);

      anim.stepElapsedMs += deltaMs;
      const stepProgress = Math.min(1.0, anim.stepElapsedMs / anim.stepDurationMs);

      const pFrom = anim.path[anim.currentStepIndex];
      const pTo = anim.path[anim.currentStepIndex + 1];

      // Interpolate grid coordinates
      const currentGridX = pFrom.x + (pTo.x - pFrom.x) * stepProgress;
      const currentGridY = pFrom.y + (pTo.y - pFrom.y) * stepProgress;

      // Update world position
      const worldX = (currentGridX + sizeCells / 2) * cellSize;
      const worldY = (currentGridY + sizeCells / 2) * cellSize;
      node.container.position.set(worldX, worldY);

      if (stepProgress >= 1.0) {
        anim.currentStepIndex++;
        anim.onStep?.(pTo, anim.currentStepIndex);

        if (anim.currentStepIndex >= anim.totalSteps) {
          // Finished entire path
          node.targetPos = { ...pTo };
          node.data.position = { ...pTo };
          this.activeAnimations.delete(tokenId);
          anim.resolve();
        } else {
          // Advance to next segment
          anim.stepElapsedMs = 0;
          const nextFrom = anim.path[anim.currentStepIndex];
          const nextTo = anim.path[anim.currentStepIndex + 1];
          const nextFacing = vectorToFacing(nextTo.x - nextFrom.x, nextTo.y - nextFrom.y);
          node.currentFacing = nextFacing;
          this.drawFacing(node.facingGraphics, radius, nextFacing);
        }
      }
    }
  }

  /**
   * Immediately finishes all active movement animations, placing tokens at their final destinations.
   */
  public finishAllAnimations(cellSize = 48): void {
    for (const [tokenId, anim] of Array.from(this.activeAnimations.entries())) {
      const node = this.tokenNodes.get(tokenId);
      if (node) {
        const dest = anim.path[anim.path.length - 1];
        const sizeCells = CREATURE_SIZE_CELLS[node.data.size] ?? 1;
        node.targetPos = { ...dest };
        node.data.position = { ...dest };
        node.container.position.set(
          (dest.x + sizeCells / 2) * cellSize,
          (dest.y + sizeCells / 2) * cellSize,
        );
      }
      anim.resolve();
      this.activeAnimations.delete(tokenId);
    }
  }

  /**
   * Retrieves a token node by its ID.
   */
  public getTokenNode(tokenId: string): TokenNode | undefined {
    return this.tokenNodes.get(tokenId);
  }

  /**
   * Returns all active token nodes.
   */
  public getAllTokens(): TokenNode[] {
    return Array.from(this.tokenNodes.values());
  }

  /**
   * Cleans up all token resources.
   */
  public destroy(): void {
    this.finishAllAnimations();
    this.tokenNodes.clear();
    this.container.destroy({ children: true });
  }
}
