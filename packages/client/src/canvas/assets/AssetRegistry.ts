import { Rectangle, Texture } from 'pixi.js';
import type { ConditionId, CreatureSize } from '@srd5/data';
import type { CombatantSide, TileTerrainType } from '@srd5/engine';
import {
  ACTION_ICON_MAP,
  CONDITION_ICON_MAP,
  ITEM_ICON_MAP,
  KENNEY_ATLAS_META,
  KENNEY_SPRITE_FRAMES,
  SPELL_SCHOOL_ICON_MAP,
  TERRAIN_SPRITE_MAP,
} from './manifest.js';
import type {
  CreatureTokenResolutionInput,
  ResolvedIconAsset,
  ResolvedTerrainAsset,
  ResolvedTokenAsset,
  TileFrame,
} from './types.js';

/**
 * Standard palette colors for procedural tabletop tokens.
 */
export const TEAM_COLORS = {
  party: { base: 0x0f291e, border: 0x22c55e, glow: 0x10b981 }, // Emerald Green
  monster: { base: 0x2a0808, border: 0xef4444, glow: 0xdc2626 }, // Crimson Red
  neutral: { base: 0x291a08, border: 0xf59e0b, glow: 0xd97706 }, // Amber Gold
  team_red: { base: 0x2a0808, border: 0xef4444, glow: 0xdc2626 },
  team_blue: { base: 0x081b2a, border: 0x38bdf8, glow: 0x0284c7 }, // Sapphire Blue
  team_green: { base: 0x0f291e, border: 0x22c55e, glow: 0x16a34a },
  boss: { base: 0x291f08, border: 0xeab308, glow: 0xca8a04 }, // Burnished Gold
};

/**
 * Fallback palette for terrain when textures are disabled or unavailable.
 */
export const TERRAIN_PALETTE_FALLBACK: Record<
  TileTerrainType,
  { fill: number; border?: number }
> = {
  void: { fill: 0x020617 },
  floor_stone: { fill: 0x334155, border: 0x1e293b },
  floor_wood: { fill: 0x78350f, border: 0x451a03 },
  wall_solid: { fill: 0x0f172a, border: 0x020617 },
  chasm: { fill: 0x020617, border: 0x334155 },
  water_shallow: { fill: 0x0284c7, border: 0x0369a1 },
  water_deep: { fill: 0x1e3a8a, border: 0x172554 },
  rubble: { fill: 0x475569, border: 0x334155 },
  lava: { fill: 0xdc2626, border: 0xb91c1c },
};

/**
 * Known monster name / subtype to Kenney sprite frame mapping.
 */
const MONSTER_NAME_TO_SPRITE: Record<string, string> = {
  goblin: 'monster_goblin',
  'goblin boss': 'monster_goblin',
  orc: 'monster_orc',
  'orc war chief': 'monster_orc',
  skeleton: 'monster_skeleton',
  zombie: 'monster_zombie',
  ghoul: 'monster_ghoul',
  spider: 'monster_spider',
  'giant spider': 'monster_spider',
  bat: 'monster_bat',
  'giant bat': 'monster_bat',
  rat: 'monster_rat',
  'giant rat': 'monster_rat',
  wolf: 'monster_wolf',
  'dire wolf': 'monster_wolf',
  cultist: 'monster_cultist',
  'cult fanatic': 'monster_cultist',
  ogre: 'monster_ogre',
  troll: 'monster_ogre',
  hobgoblin: 'monster_hobgoblin',
  bugbear: 'monster_bugbear',
  slime: 'monster_slime',
  'gray ooze': 'monster_slime',
  'ochre jelly': 'monster_slime',
  'black pudding': 'monster_slime',
  'gelatinous cube': 'monster_slime',
  dragon: 'monster_dragon',
  'young red dragon': 'monster_dragon',
  'adult red dragon': 'monster_dragon',
  demon: 'monster_demon',
  fiend: 'monster_demon',
  ghost: 'monster_ghost',
  specter: 'monster_ghost',
  wraith: 'monster_ghost',
};

/**
 * Hero class to Kenney sprite frame mapping.
 */
const CLASS_TO_SPRITE: Record<string, string> = {
  fighter: 'hero_fighter',
  wizard: 'hero_wizard',
  rogue: 'hero_rogue',
  cleric: 'hero_cleric',
  ranger: 'hero_ranger',
  paladin: 'hero_paladin',
  barbarian: 'hero_barbarian',
  bard: 'hero_bard',
  druid: 'hero_druid',
  monk: 'hero_monk',
  sorcerer: 'hero_sorcerer',
  warlock: 'hero_warlock',
};

/**
 * 3-Tier Open Game Asset Registry:
 * Tier 1: PixiJS Spritesheet Atlas (Kenney CC0 Tiny Dungeon with NEAREST scaling).
 * Tier 2: Vector Icon Library (game-icons.net SVGs for actions, conditions, spells, items).
 * Tier 3: Procedural Tabletop Token Fallback (crisp circular token, team colors, monogram).
 */
export class AssetRegistry {
  private textures = new Map<string, Texture>();
  private _isLoaded = false;
  private baseTexture: Texture | null = null;

  public get isLoaded(): boolean {
    return this._isLoaded;
  }

  /**
   * Resolves a creature token using the 3-tier strategy.
   * Ensures zero broken textures across all SRD monsters.
   */
  public resolveCreatureToken(input: CreatureTokenResolutionInput): ResolvedTokenAsset {
    const isBoss =
      input.isBoss === true || (typeof input.challengeRating === 'number' && input.challengeRating >= 5);

    // Determine colors
    const colors = this.resolveTeamColors(input.side, input.teamId, isBoss, input.color);

    // Compute monogram (2 characters)
    const monogram = this.computeMonogram(input.label ?? input.name);

    // 1. Try explicit tokenSpriteId
    if (input.tokenSpriteId && KENNEY_SPRITE_FRAMES[input.tokenSpriteId]) {
      const frame = KENNEY_SPRITE_FRAMES[input.tokenSpriteId]!;
      return {
        tier: 'spritesheet',
        spriteKey: input.tokenSpriteId,
        frame,
        texture: this.textures.get(input.tokenSpriteId),
        monogram,
        baseColor: colors.base,
        borderColor: colors.border,
        glowColor: colors.glow,
        creatureType: input.monsterType,
        isBoss,
      };
    }

    // 2. Try monster name / subtype lookup
    const normalizedName = input.name.trim().toLowerCase();
    const monsterSpriteKey =
      MONSTER_NAME_TO_SPRITE[normalizedName] ??
      (input.monsterType ? MONSTER_NAME_TO_SPRITE[input.monsterType.toLowerCase()] : undefined);

    if (monsterSpriteKey && KENNEY_SPRITE_FRAMES[monsterSpriteKey]) {
      const frame = KENNEY_SPRITE_FRAMES[monsterSpriteKey]!;
      return {
        tier: 'spritesheet',
        spriteKey: monsterSpriteKey,
        frame,
        texture: this.textures.get(monsterSpriteKey),
        monogram,
        baseColor: colors.base,
        borderColor: colors.border,
        glowColor: colors.glow,
        creatureType: input.monsterType,
        isBoss,
      };
    }

    // 3. Try hero class archetype lookup
    const classSpriteKey = CLASS_TO_SPRITE[normalizedName];
    if (classSpriteKey && KENNEY_SPRITE_FRAMES[classSpriteKey]) {
      const frame = KENNEY_SPRITE_FRAMES[classSpriteKey]!;
      return {
        tier: 'spritesheet',
        spriteKey: classSpriteKey,
        frame,
        texture: this.textures.get(classSpriteKey),
        monogram,
        baseColor: colors.base,
        borderColor: colors.border,
        glowColor: colors.glow,
        creatureType: 'humanoid',
        isBoss,
      };
    }

    // Tier 3: Procedural Tabletop Token Fallback
    return {
      tier: 'procedural',
      monogram,
      baseColor: colors.base,
      borderColor: colors.border,
      glowColor: colors.glow,
      creatureType: input.monsterType,
      isBoss,
    };
  }

  /**
   * Resolves a terrain tile via Tier 1 spritesheet or procedural palette.
   */
  public resolveTerrain(terrain: TileTerrainType): ResolvedTerrainAsset {
    const spriteKey = TERRAIN_SPRITE_MAP[terrain] ?? 'floor_stone';
    const frame = KENNEY_SPRITE_FRAMES[spriteKey];
    const fallback = TERRAIN_PALETTE_FALLBACK[terrain] ?? TERRAIN_PALETTE_FALLBACK.floor_stone;

    if (this._isLoaded && this.textures.has(spriteKey) && frame) {
      return {
        tier: 'spritesheet',
        spriteKey,
        frame,
        fillColor: fallback.fill,
        borderColor: fallback.border,
      };
    }

    return {
      tier: 'procedural',
      spriteKey,
      frame,
      fillColor: fallback.fill,
      borderColor: fallback.border,
    };
  }

  /**
   * Resolves a condition to its Tier 2 SVG icon asset.
   */
  public resolveConditionIcon(conditionId: ConditionId): ResolvedIconAsset {
    const filename = CONDITION_ICON_MAP[conditionId] ?? 'cursed-star.svg';
    return {
      tier: 'svg',
      key: conditionId,
      url: `/assets/game-icons/${filename}`,
      altText: `Condition: ${conditionId}`,
    };
  }

  /**
   * Resolves a standard action to its Tier 2 SVG icon asset.
   */
  public resolveActionIcon(actionId: string): ResolvedIconAsset {
    const filename = ACTION_ICON_MAP[actionId.toLowerCase()] ?? 'crossed-swords.svg';
    return {
      tier: 'svg',
      key: actionId,
      url: `/assets/game-icons/${filename}`,
      altText: `Action: ${actionId}`,
    };
  }

  /**
   * Resolves a magic school or specific spell to its Tier 2 SVG icon asset.
   */
  public resolveSpellIcon(spell: {
    id?: string;
    school?: string;
    name?: string;
  }): ResolvedIconAsset {
    const nameLower = (spell.name ?? spell.id ?? '').toLowerCase();

    // Specific famous spells
    if (nameLower.includes('fireball')) {
      return {
        tier: 'svg',
        key: 'fireball',
        url: '/assets/game-icons/fireball.svg',
        altText: 'Fireball',
      };
    }
    if (nameLower.includes('lightning')) {
      return {
        tier: 'svg',
        key: 'lightning',
        url: '/assets/game-icons/chain-lightning.svg',
        altText: 'Lightning',
      };
    }
    if (nameLower.includes('heal') || nameLower.includes('cure')) {
      return {
        tier: 'svg',
        key: 'healing',
        url: '/assets/game-icons/healing.svg',
        altText: 'Healing',
      };
    }
    if (nameLower.includes('shield')) {
      return {
        tier: 'svg',
        key: 'shield',
        url: '/assets/game-icons/shield.svg',
        altText: 'Shield',
      };
    }

    // Default by magic school
    const schoolLower = (spell.school ?? 'evocation').toLowerCase();
    const filename = SPELL_SCHOOL_ICON_MAP[schoolLower] ?? 'spell-book.svg';

    return {
      tier: 'svg',
      key: schoolLower,
      url: `/assets/game-icons/${filename}`,
      altText: `School: ${schoolLower}`,
    };
  }

  /**
   * Resolves an item or interactive prop to its Tier 2 SVG icon asset.
   */
  public resolveItemIcon(key: string): ResolvedIconAsset {
    const keyLower = key.toLowerCase();
    const filename = ITEM_ICON_MAP[keyLower] ?? 'chest.svg';
    return {
      tier: 'svg',
      key: keyLower,
      url: `/assets/game-icons/${filename}`,
      altText: `Item: ${keyLower}`,
    };
  }

  /**
   * Initializes or loads the Kenney Tiny Dungeon spritesheet atlas with NEAREST scaling.
   * Can be supplied with an existing PixiJS Texture, or creates subtextures from a loaded source.
   */
  public async loadAtlas(customSource?: Texture | string): Promise<boolean> {
    try {
      let base: Texture;

      if (customSource instanceof Texture) {
        base = customSource;
      } else if (typeof customSource === 'string') {
        base = Texture.from(customSource);
      } else {
        base = Texture.from(KENNEY_ATLAS_META.imagePath);
      }

      this.baseTexture = base;

      // Enforce NEAREST scaling for crisp pixel art on high-DPI displays
      if (base.source) {
        base.source.scaleMode = 'nearest';
      }

      // Slice sub-textures for each packed frame
      for (const [key, frame] of Object.entries(KENNEY_SPRITE_FRAMES)) {
        const sub = new Texture({
          source: base.source,
          frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
        });
        if (sub.source) {
          sub.source.scaleMode = 'nearest';
        }
        this.textures.set(key, sub);
      }

      this._isLoaded = true;
      return true;
    } catch {
      // Gracefully fall back to procedural resolution in headless or test environments
      this._isLoaded = false;
      return false;
    }
  }

  /**
   * Returns a cached subtexture if available.
   */
  public getTexture(key: string): Texture | undefined {
    return this.textures.get(key);
  }

  /**
   * Returns whether a texture exists in the registry.
   */
  public hasTexture(key: string): boolean {
    return this.textures.has(key);
  }

  /**
   * Clears all cached textures.
   */
  public clear(): void {
    this.textures.clear();
    this.baseTexture = null;
    this._isLoaded = false;
  }

  /**
   * Calculates a crisp 2-letter uppercase monogram from a creature name.
   */
  public computeMonogram(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) return '??';

    const words = trimmed.split(/\s+/);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return trimmed.slice(0, 2).toUpperCase();
  }

  /**
   * Resolves team/allegiance frame and base colors.
   */
  public resolveTeamColors(
    side?: CombatantSide,
    teamId?: string,
    isBoss?: boolean,
    customColor?: number,
  ): { base: number; border: number; glow: number } {
    if (isBoss && side === 'monster') {
      return TEAM_COLORS.boss;
    }

    if (teamId === 'team_red') return TEAM_COLORS.team_red;
    if (teamId === 'team_blue') return TEAM_COLORS.team_blue;
    if (teamId === 'team_green') return TEAM_COLORS.team_green;

    if (side === 'party') return TEAM_COLORS.party;
    if (side === 'monster') return TEAM_COLORS.monster;
    if (side === 'neutral') return TEAM_COLORS.neutral;

    if (typeof customColor === 'number') {
      return {
        base: 0x0f172a,
        border: customColor,
        glow: customColor,
      };
    }

    return TEAM_COLORS.party;
  }
}

/**
 * Global singleton instance of AssetRegistry.
 */
export const assetRegistry = new AssetRegistry();
