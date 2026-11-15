import type { Texture } from 'pixi.js';
import type { ConditionId, CreatureSize } from '@srd5/data';
import type { CombatantSide, TileTerrainType } from '@srd5/engine';

/**
 * 3-Tier Resolution Strategy as defined in Spec 05 Section 3.3.
 */
export type AssetTier = 'spritesheet' | 'svg' | 'procedural';

/**
 * 2D Frame rectangle inside a spritesheet atlas.
 */
export interface TileFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Metadata for a spritesheet atlas.
 */
export interface SpritesheetAtlasMeta {
  id: string;
  imagePath: string;
  tileWidth: number;
  tileHeight: number;
  cols: number;
  rows: number;
  scaleMode: 'nearest' | 'linear';
}

/**
 * Result of resolving a creature token via the 3-tier pipeline.
 */
export interface ResolvedTokenAsset {
  tier: 'spritesheet' | 'procedural';
  spriteKey?: string;
  frame?: TileFrame;
  texture?: Texture;
  monogram: string;
  baseColor: number;
  borderColor: number;
  glowColor: number;
  creatureType?: string;
  isBoss?: boolean;
}

/**
 * Result of resolving a terrain tile via the 3-tier pipeline.
 */
export interface ResolvedTerrainAsset {
  tier: 'spritesheet' | 'procedural';
  spriteKey?: string;
  frame?: TileFrame;
  fillColor: number;
  borderColor?: number;
}

/**
 * Result of resolving an SVG icon (actions, conditions, spells, items).
 */
export interface ResolvedIconAsset {
  tier: 'svg';
  key: string;
  url: string;
  altText: string;
}

/**
 * Input for creature token asset resolution.
 */
export interface CreatureTokenResolutionInput {
  id: string;
  name: string;
  size?: CreatureSize;
  side?: CombatantSide;
  teamId?: string;
  tokenSpriteId?: string;
  monsterType?: string;
  classId?: string;
  challengeRating?: number;
  isBoss?: boolean;
  color?: number;
  label?: string;
}
