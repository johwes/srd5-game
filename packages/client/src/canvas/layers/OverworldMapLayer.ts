import { Container, Graphics, Text } from 'pixi.js';
import type {
  OverworldCoord,
  OverworldMap,
  OverworldPOI,
  OverworldTerrainType,
  TimeOfDay,
} from '@srd5/engine';

/**
 * PixiJS v8 strategic overworld map layer (SRD-805, Spec 06 Section 4).
 *
 * Renders the macro tile grid (biome palette + elevation shading), rivers,
 * roads, faction control marks, POI markers with name labels, the travel path
 * preview, the party token, and a day/night tint — all with signature-based
 * caching so the 64×64 world only redraws when something actually changes.
 */

export const OVERWORLD_CELL_SIZE = 24;

export const OVERWORLD_TERRAIN_COLORS: Record<OverworldTerrainType, number> = {
  plains: 0x6d8f4e,
  forest: 0x3f6b35,
  hills: 0x8a7a4a,
  mountains: 0x8d8d99,
  swamp: 0x4e5e3a,
  desert: 0xd6bd7a,
  tundra: 0xb9c4c9,
  coast: 0xc9b98a,
  ocean: 0x2a5d8f,
};

export const OVERWORLD_POI_COLORS: Record<string, number> = {
  capital: 0xf59e0b,
  town: 0xfbbf24,
  village: 0xd9a441,
  dungeon_entrance: 0xa855f7,
  ancient_shrine: 0x22d3ee,
  monster_lair: 0xef4444,
};

/**
 * Strategic war POI palette (SRD-1105, Spec 10 Section 3): fortresses square
 * and iron-grey, mines/bridges/depots amber-brown, prison keeps slate, and
 * sub-faction camps green.
 */
export const OVERWORLD_STRATEGIC_POI_COLORS: Record<string, number> = {
  fortress: 0x94a3b8,
  mine: 0xd97706,
  bridge: 0xb45309,
  supply_depot: 0xca8a04,
  prison_keep: 0x475569,
  subfaction_camp: 0x16a34a,
};

export const STRATEGIC_POI_KINDS: readonly string[] = [
  'fortress',
  'mine',
  'bridge',
  'supply_depot',
  'prison_keep',
  'subfaction_camp',
];

export function isStrategicPoiKind(kind: string): boolean {
  return STRATEGIC_POI_KINDS.includes(kind);
}

/**
 * Status badges for living-war POIs (SRD-1105): `intact` POIs render no
 * badge; every other `strategicStatus` renders a glyph + dark pill behind
 * the POI name label so cursed/destroyed/sabotaged/contested/under-attack
 * holdings read at a glance on the 64×64 world map.
 */
export const STRATEGIC_STATUS_BADGES: Record<string, { glyph: string; color: number }> = {
  cursed: { glyph: '💀 cursed', color: 0x7c3aed },
  destroyed: { glyph: '💥 destroyed', color: 0x7f1d1d },
  sabotaged: { glyph: '🛠️ sabotaged', color: 0xb45309 },
  contested: { glyph: '🟡 contested', color: 0x854d0e },
  under_attack: { glyph: '⚔️ under attack', color: 0xdc2626 },
};

export function getStrategicPoiBadge(poi: Pick<OverworldPOI, 'kind' | 'strategicStatus'>): string | null {
  if (!isStrategicPoiKind(poi.kind)) return null;
  const status = poi.strategicStatus ?? 'intact';
  if (status === 'intact') return null;
  return STRATEGIC_STATUS_BADGES[status]?.glyph ?? status;
}

const TIME_TINTS: Record<TimeOfDay, { color: number; alpha: number }> = {
  dawn: { color: 0xff9a5a, alpha: 0.06 },
  noon: { color: 0x000000, alpha: 0 },
  dusk: { color: 0x4a3a7a, alpha: 0.16 },
  night: { color: 0x0a1030, alpha: 0.38 },
};

export interface OverworldSceneGraph {
  stage: Container;
  viewport: Container;
  terrainLayer: Container;
  overlayLayer: Container;
  poiLayer: Container;
  tokenLayer: Container;
  tintLayer: Container;
}

export function createOverworldSceneGraph(stage: Container): OverworldSceneGraph {
  const viewport = new Container();
  viewport.label = 'OverworldViewportContainer';

  const terrainLayer = new Container();
  terrainLayer.label = 'OverworldTerrainLayer';
  const overlayLayer = new Container();
  overlayLayer.label = 'OverworldOverlayLayer';
  const poiLayer = new Container();
  poiLayer.label = 'OverworldPoiLayer';
  const tokenLayer = new Container();
  tokenLayer.label = 'OverworldTokenLayer';
  const tintLayer = new Container();
  tintLayer.label = 'OverworldTintLayer';

  viewport.addChild(terrainLayer);
  viewport.addChild(overlayLayer);
  viewport.addChild(poiLayer);
  viewport.addChild(tokenLayer);
  viewport.addChild(tintLayer);
  stage.addChild(viewport);

  return { stage, viewport, terrainLayer, overlayLayer, poiLayer, tokenLayer, tintLayer };
}

export interface OverworldRenderOptions {
  map: OverworldMap;
  cellSize: number;
  partyPosition: OverworldCoord;
  timeOfDay?: TimeOfDay;
  hoveredTile?: OverworldCoord | null;
  travelPath?: readonly OverworldCoord[] | null;
  clearedPoiIds?: readonly string[];
}

function shadeColor(color: number, factor: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((color >> 16) & 0xff) * factor)));
  const g = Math.min(255, Math.max(0, Math.round(((color >> 8) & 0xff) * factor)));
  const b = Math.min(255, Math.max(0, Math.round((color & 0xff) * factor)));
  return (r << 16) | (g << 8) | b;
}

function parseBannerColor(raw: string): number {
  const hex = raw.replace('#', '');
  const parsed = Number.parseInt(hex, 16);
  return Number.isFinite(parsed) ? parsed : 0x94a3b8;
}

export class OverworldMapRenderer {
  public readonly container: Container;

  private terrainGraphics: Graphics;
  private riverGraphics: Graphics;
  private roadGraphics: Graphics;
  private factionGraphics: Graphics;
  private overlayGraphics: Graphics;
  private poiContainer: Container;
  private tokenContainer: Container;
  private partyRing: Graphics;
  private tintGraphics: Graphics;

  private lastMap: OverworldMap | null = null;
  private lastStaticSignature: string | null = null;
  private lastDynamicSignature: string | null = null;
  private pulseElapsed = 0;

  constructor(scene: OverworldSceneGraph) {
    this.container = scene.viewport;

    this.terrainGraphics = new Graphics();
    this.terrainGraphics.label = 'OverworldTerrainGraphics';
    this.riverGraphics = new Graphics();
    this.riverGraphics.label = 'OverworldRiverGraphics';
    this.roadGraphics = new Graphics();
    this.roadGraphics.label = 'OverworldRoadGraphics';
    this.factionGraphics = new Graphics();
    this.factionGraphics.label = 'OverworldFactionGraphics';
    scene.terrainLayer.addChild(
      this.terrainGraphics,
      this.riverGraphics,
      this.roadGraphics,
      this.factionGraphics,
    );

    this.overlayGraphics = new Graphics();
    this.overlayGraphics.label = 'OverworldPathGraphics';
    scene.overlayLayer.addChild(this.overlayGraphics);

    this.poiContainer = new Container();
    this.poiContainer.label = 'OverworldPoiMarkers';
    scene.poiLayer.addChild(this.poiContainer);

    this.tokenContainer = new Container();
    this.tokenContainer.label = 'OverworldPartyToken';
    this.partyRing = new Graphics();
    this.partyRing.label = 'PartyPulseRing';
    this.tokenContainer.addChild(this.partyRing);
    scene.tokenLayer.addChild(this.tokenContainer);

    this.tintGraphics = new Graphics();
    this.tintGraphics.label = 'OverworldDayNightTint';
    scene.tintLayer.addChild(this.tintGraphics);
  }

  public render(options: OverworldRenderOptions): void {
    const {
      map,
      cellSize,
      partyPosition,
      timeOfDay = 'noon',
      hoveredTile,
      travelPath,
      clearedPoiIds = [],
    } = options;

    const staticSignature = [
      map.worldSeed,
      map.width,
      map.height,
      cellSize,
      clearedPoiIds.join(','),
      Object.values(map.pois)
        .map((p) => `${p.id}:${p.kind}:${p.strategicStatus ?? '-'}`)
        .join(','),
      Object.values(map.factions)
        .map((f) => `${f.id}:${f.relationshipWithParty}`)
        .join(','),
    ].join('|');

    if (this.lastMap !== map || this.lastStaticSignature !== staticSignature) {
      this.lastMap = map;
      this.lastStaticSignature = staticSignature;
      this.drawTerrain(map, cellSize);
      this.drawRivers(map, cellSize);
      this.drawRoads(map, cellSize);
      this.drawFactionControl(map, cellSize);
      this.drawPois(map, cellSize, clearedPoiIds);
      this.drawTint(map, cellSize, timeOfDay);
    } else if (this.lastTimeOfDay !== timeOfDay) {
      this.drawTint(map, cellSize, timeOfDay);
    }
    this.lastTimeOfDay = timeOfDay;

    const dynamicSignature = [
      partyPosition.q,
      partyPosition.r,
      hoveredTile ? `${hoveredTile.q},${hoveredTile.r}` : '-',
      travelPath ? travelPath.map((p) => `${p.q},${p.r}`).join('>') : '-',
      cellSize,
    ].join('|');
    if (this.lastDynamicSignature !== dynamicSignature) {
      this.lastDynamicSignature = dynamicSignature;
      this.drawOverlay(map, cellSize, partyPosition, hoveredTile, travelPath);
      this.drawPartyToken(cellSize, partyPosition);
    }
  }

  private lastTimeOfDay: TimeOfDay | null = null;

  private drawTerrain(map: OverworldMap, cellSize: number): void {
    this.terrainGraphics.clear();
    for (let r = 0; r < map.height; r++) {
      for (let q = 0; q < map.width; q++) {
        const tile = map.tiles[`${q},${r}`];
        if (!tile) continue;
        const base = OVERWORLD_TERRAIN_COLORS[tile.terrain];
        // Elevation shading: peaks brighten, ocean depths darken.
        const factor =
          tile.terrain === 'ocean'
            ? 0.7 + tile.elevation * 0.6
            : 0.85 + tile.elevation * 0.35;
        this.terrainGraphics
          .rect(q * cellSize, r * cellSize, cellSize, cellSize)
          .fill(shadeColor(base, factor));
      }
    }
  }

  private drawRivers(map: OverworldMap, cellSize: number): void {
    this.riverGraphics.clear();
    const half = cellSize / 2;
    const bankWidth = Math.max(4, cellSize * 0.24);
    const coreWidth = Math.max(2, cellSize * 0.13);

    // Two-pass smooth waterways: darker riverbanks underneath + brighter water core
    for (const tile of Object.values(map.tiles)) {
      if (!tile.riverEdges || tile.riverEdges.length === 0) continue;
      const cx = tile.q * cellSize + half;
      const cy = tile.r * cellSize + half;
      for (const edge of tile.riverEdges) {
        // 0 = N, 1 = E, 2 = S, 3 = W
        const ex = edge === 1 ? cx + half : edge === 3 ? cx - half : cx;
        const ey = edge === 0 ? cy - half : edge === 2 ? cy + half : cy;
        this.riverGraphics
          .moveTo(cx, cy)
          .lineTo(ex, ey)
          .stroke({ width: bankWidth, color: 0x1e40af, alpha: 0.78, cap: 'round', join: 'round' });
      }
    }
    for (const tile of Object.values(map.tiles)) {
      if (!tile.riverEdges || tile.riverEdges.length === 0) continue;
      const cx = tile.q * cellSize + half;
      const cy = tile.r * cellSize + half;
      for (const edge of tile.riverEdges) {
        const ex = edge === 1 ? cx + half : edge === 3 ? cx - half : cx;
        const ey = edge === 0 ? cy - half : edge === 2 ? cy + half : cy;
        this.riverGraphics
          .moveTo(cx, cy)
          .lineTo(ex, ey)
          .stroke({ width: coreWidth, color: 0x60a5fa, alpha: 0.95, cap: 'round', join: 'round' });
      }
    }
  }

  private drawRoads(map: OverworldMap, cellSize: number): void {
    this.roadGraphics.clear();
    const half = cellSize / 2;
    const roadColor = 0xb08d57;
    const width = Math.max(2, cellSize * 0.16);
    for (const tile of Object.values(map.tiles)) {
      if (!tile.roadThrough) continue;
      const cx = tile.q * cellSize + half;
      const cy = tile.r * cellSize + half;
      const neighbors: Array<[number, number]> = [
        [tile.q, tile.r - 1],
        [tile.q + 1, tile.r],
        [tile.q, tile.r + 1],
        [tile.q - 1, tile.r],
      ];
      let connected = false;
      for (const [nq, nr] of neighbors) {
        const neighbor = map.tiles[`${nq},${nr}`];
        if (neighbor?.roadThrough || neighbor?.poiId) {
          this.roadGraphics
            .moveTo(cx, cy)
            .lineTo(nq * cellSize + half, nr * cellSize + half)
            .stroke({ width, color: roadColor, alpha: 0.95 });
          connected = true;
        }
      }
      if (!connected) {
        this.roadGraphics.circle(cx, cy, width).fill(roadColor);
      }
    }
  }

  private drawFactionControl(map: OverworldMap, cellSize: number): void {
    this.factionGraphics.clear();
    for (const tile of Object.values(map.tiles)) {
      if (!tile.factionControlId) continue;
      const faction = map.factions[tile.factionControlId];
      if (!faction) continue;
      const color = parseBannerColor(faction.bannerColor);
      const x = tile.q * cellSize;
      const y = tile.r * cellSize;
      const s = Math.max(3, cellSize * 0.22);
      this.factionGraphics
        .moveTo(x, y)
        .lineTo(x + s, y)
        .lineTo(x, y + s)
        .closePath()
        .fill({ color, alpha: 0.8 });
    }
  }

  private drawPois(map: OverworldMap, cellSize: number, clearedPoiIds: readonly string[]): void {
    this.poiContainer.removeChildren().forEach((child) => child.destroy({ children: true }));
    const half = cellSize / 2;
    for (const poi of Object.values(map.pois)) {
      const marker = new Container();
      marker.label = `PoiMarker_${poi.id}`;
      const cx = poi.q * cellSize + half;
      const cy = poi.r * cellSize + half;
      marker.position.set(cx, cy);

      const strategic = isStrategicPoiKind(poi.kind);
      const color = strategic
        ? (OVERWORLD_STRATEGIC_POI_COLORS[poi.kind] ?? 0xffffff)
        : (OVERWORLD_POI_COLORS[poi.kind] ?? 0xffffff);
      const cleared = clearedPoiIds.includes(poi.id);
      const g = new Graphics();
      const radius = cellSize * 0.34;
      if (poi.kind === 'dungeon_entrance') {
        g.moveTo(0, -radius)
          .lineTo(radius, 0)
          .lineTo(0, radius)
          .lineTo(-radius, 0)
          .closePath()
          .fill({ color, alpha: cleared ? 0.45 : 1 })
          .stroke({ width: 1.5, color: 0x0f172a });
      } else if (poi.kind === 'monster_lair') {
        g.moveTo(0, -radius)
          .lineTo(radius, radius * 0.8)
          .lineTo(-radius, radius * 0.8)
          .closePath()
          .fill({ color, alpha: cleared ? 0.45 : 1 })
          .stroke({ width: 1.5, color: 0x0f172a });
      } else if (poi.kind === 'ancient_shrine') {
        g.circle(0, 0, radius * 0.8)
          .fill({ color, alpha: 0.95 })
          .stroke({ width: 1.5, color: 0x0f172a });
        g.circle(0, 0, radius * 0.35).fill(0x0f172a);
      } else if (poi.kind === 'fortress' || poi.kind === 'prison_keep') {
        // War strongholds: crenellated square with a banner-color core.
        g.rect(-radius * 0.8, -radius * 0.8, radius * 1.6, radius * 1.6)
          .fill({ color, alpha: 1 })
          .stroke({ width: 2, color: 0x0f172a });
        g.rect(-radius * 0.3, -radius * 0.3, radius * 0.6, radius * 0.6).fill(0x0f172a);
      } else if (poi.kind === 'bridge') {
        // Distinct arched stone/timber bridge deck spanning water.
        const destroyed = poi.strategicStatus === 'destroyed';
        const deckColor = destroyed ? 0x7f1d1d : 0xd97706;
        // Bridge deck bar
        g.rect(-radius * 1.05, -radius * 0.45, radius * 2.1, radius * 0.55)
          .fill({ color: deckColor, alpha: destroyed ? 0.65 : 1 })
          .stroke({ width: 1.5, color: 0x0f172a });
        // Left & right stone abutments
        g.rect(-radius * 1.05, radius * 0.1, radius * 0.5, radius * 0.6)
          .fill({ color: 0x94a3b8, alpha: destroyed ? 0.6 : 1 })
          .stroke({ width: 1.2, color: 0x0f172a });
        g.rect(radius * 0.55, radius * 0.1, radius * 0.5, radius * 0.6)
          .fill({ color: 0x94a3b8, alpha: destroyed ? 0.6 : 1 })
          .stroke({ width: 1.2, color: 0x0f172a });
      } else if (strategic) {
        // Mines, depots, sub-faction camps: diamond with status ring.
        g.moveTo(0, -radius)
          .lineTo(radius * 0.85, 0)
          .lineTo(0, radius)
          .lineTo(-radius * 0.85, 0)
          .closePath()
          .fill({ color, alpha: poi.strategicStatus === 'destroyed' ? 0.5 : 1 })
          .stroke({ width: 1.5, color: 0x0f172a });
      } else {
        // Settlements: framed disc, capitals larger with a star dot.
        const settlementRadius = poi.kind === 'capital' ? radius * 1.15 : radius;
        g.circle(0, 0, settlementRadius)
          .fill(color)
          .stroke({ width: 2, color: 0x0f172a });
        if (poi.kind === 'capital') {
          g.circle(0, 0, settlementRadius * 0.35).fill(0x0f172a);
        }
      }
      if (cleared) {
        g.moveTo(-radius * 0.6, 0)
          .lineTo(-radius * 0.15, radius * 0.45)
          .lineTo(radius * 0.65, -radius * 0.45)
          .stroke({ width: 2, color: 0x22c55e });
      }
      // Living-war status ring: under-attack POIs pulse red, cursed POIs
      // violet, destroyed POIs dark — visible even at 24px cells.
      const statusRing: Record<string, number> = {
        under_attack: 0xdc2626,
        cursed: 0x7c3aed,
        sabotaged: 0xb45309,
        contested: 0xeab308,
        destroyed: 0x450a0a,
      };
      const ringColor = poi.strategicStatus ? statusRing[poi.strategicStatus] : undefined;
      if (strategic && ringColor !== undefined && poi.strategicStatus !== 'intact') {
        g.circle(0, 0, radius * 1.15).stroke({ width: 2, color: ringColor, alpha: 0.95 });
      }
      marker.addChild(g);

      const label = new Text({
        text: poi.name,
        style: {
          fontFamily: 'monospace',
          fontSize: Math.max(8, Math.round(cellSize * 0.4)),
          fill: 0xf8fafc,
          stroke: { color: 0x0f172a, width: 2 },
        },
      });
      label.anchor.set(0.5, 0);
      label.position.set(0, radius + 2);
      label.label = `PoiLabel_${poi.id}`;
      marker.addChild(label);

      // Status badge pill beneath the name (SRD-1105).
      const badge = getStrategicPoiBadge(poi);
      if (badge) {
        const badgeLabel = new Text({
          text: badge,
          style: {
            fontFamily: 'monospace',
            fontSize: Math.max(7, Math.round(cellSize * 0.32)),
            fill: 0xffffff,
            stroke: { color: 0x0f172a, width: 2 },
          },
        });
        badgeLabel.anchor.set(0.5, 0);
        badgeLabel.position.set(0, radius + 2 + Math.max(8, Math.round(cellSize * 0.4)) + 3);
        badgeLabel.label = `PoiBadge_${poi.id}`;
        marker.addChild(badgeLabel);
      }

      this.poiContainer.addChild(marker);
    }
  }

  private drawOverlay(
    map: OverworldMap,
    cellSize: number,
    partyPosition: OverworldCoord,
    hoveredTile?: OverworldCoord | null,
    travelPath?: readonly OverworldCoord[] | null,
  ): void {
    this.overlayGraphics.clear();
    const half = cellSize / 2;

    if (travelPath && travelPath.length > 1) {
      for (let i = 0; i < travelPath.length - 1; i++) {
        const a = travelPath[i]!;
        const b = travelPath[i + 1]!;
        this.overlayGraphics
          .moveTo(a.q * cellSize + half, a.r * cellSize + half)
          .lineTo(b.q * cellSize + half, b.r * cellSize + half)
          .stroke({ width: Math.max(2, cellSize * 0.12), color: 0xfbbf24, alpha: 0.85 });
      }
      const dest = travelPath[travelPath.length - 1]!;
      this.overlayGraphics
        .circle(dest.q * cellSize + half, dest.r * cellSize + half, cellSize * 0.3)
        .stroke({ width: 2, color: 0xfbbf24, alpha: 0.9 });
    }

    if (
      hoveredTile &&
      hoveredTile.q >= 0 &&
      hoveredTile.r >= 0 &&
      hoveredTile.q < map.width &&
      hoveredTile.r < map.height
    ) {
      this.overlayGraphics
        .rect(hoveredTile.q * cellSize, hoveredTile.r * cellSize, cellSize, cellSize)
        .stroke({ width: 2, color: 0xf8fafc, alpha: 0.85 });
    }

    // Party origin highlight (under the token).
    this.overlayGraphics
      .rect(partyPosition.q * cellSize, partyPosition.r * cellSize, cellSize, cellSize)
      .stroke({ width: 1.5, color: 0xf59e0b, alpha: 0.6 });
  }

  private drawPartyToken(cellSize: number, partyPosition: OverworldCoord): void {
    const half = cellSize / 2;
    this.tokenContainer.position.set(
      partyPosition.q * cellSize + half,
      partyPosition.r * cellSize + half,
    );
    this.tokenContainer.removeChildren().forEach((child) => child.destroy({ children: true }));

    this.partyRing = new Graphics();
    this.partyRing.label = 'PartyPulseRing';
    this.partyRing
      .circle(0, 0, cellSize * 0.55)
      .stroke({ width: 2, color: 0xf59e0b, alpha: 0.7 });
    this.tokenContainer.addChild(this.partyRing);

    const body = new Graphics();
    body.label = 'PartyTokenBody';
    body
      .circle(0, 0, cellSize * 0.36)
      .fill(0xf59e0b)
      .stroke({ width: 2, color: 0x0f172a });
    body.circle(0, 0, cellSize * 0.14).fill(0x0f172a);
    this.tokenContainer.addChild(body);
  }

  private drawTint(map: OverworldMap, cellSize: number, timeOfDay: TimeOfDay): void {
    this.tintGraphics.clear();
    const tint = TIME_TINTS[timeOfDay];
    if (tint.alpha <= 0) return;
    this.tintGraphics
      .rect(0, 0, map.width * cellSize, map.height * cellSize)
      .fill({ color: tint.color, alpha: tint.alpha });
  }

  /** Ticker-driven party ring pulse (call with deltaMS each frame). */
  public update(deltaMS: number): void {
    this.pulseElapsed += deltaMS;
    const scale = 1 + 0.12 * Math.sin(this.pulseElapsed / 400);
    this.partyRing.scale.set(scale, scale);
    this.partyRing.alpha = 0.55 + 0.3 * Math.abs(Math.sin(this.pulseElapsed / 600));
  }

  public destroy(): void {
    this.container.destroy({ children: true });
    this.lastMap = null;
    this.lastStaticSignature = null;
    this.lastDynamicSignature = null;
  }
}
