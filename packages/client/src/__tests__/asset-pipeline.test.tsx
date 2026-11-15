import React from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Container, Texture } from 'pixi.js';
import { CONDITION_IDS, type ConditionId, defaultCompendium } from '@srd5/data';
import {
  ACTION_ICON_MAP,
  CONDITION_ICON_MAP,
  CreatureTokenRenderer,
  GameIcon,
  KENNEY_ATLAS_META,
  KENNEY_SPRITE_FRAMES,
  SPELL_SCHOOL_ICON_MAP,
  TerrainTileRenderer,
  assetRegistry,
  getGameIconUrl,
} from '../canvas/index.js';

describe('SRD-409: Open Game Asset Pipeline (Kenney CC0, game-icons.net & 3-Tier AssetRegistry)', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  describe('Tier 1: PixiJS Spritesheet Atlas & Manifest', () => {
    it('defines Kenney Tiny Dungeon atlas metadata with NEAREST scaling', () => {
      expect(KENNEY_ATLAS_META.id).toBe('kenney-tiny-dungeon');
      expect(KENNEY_ATLAS_META.imagePath).toBe('/assets/kenney-tiny-dungeon/tilemap_packed.png');
      expect(KENNEY_ATLAS_META.tileWidth).toBe(16);
      expect(KENNEY_ATLAS_META.tileHeight).toBe(16);
      expect(KENNEY_ATLAS_META.cols).toBe(12);
      expect(KENNEY_ATLAS_META.rows).toBe(11);
      expect(KENNEY_ATLAS_META.scaleMode).toBe('nearest');
    });

    it('defines frame coordinates within 192x176 packed spritesheet bounds', () => {
      const maxX = KENNEY_ATLAS_META.cols * KENNEY_ATLAS_META.tileWidth;
      const maxY = KENNEY_ATLAS_META.rows * KENNEY_ATLAS_META.tileHeight;

      for (const [key, frame] of Object.entries(KENNEY_SPRITE_FRAMES)) {
        expect(frame.width).toBe(16);
        expect(frame.height).toBe(16);
        expect(frame.x).toBeGreaterThanOrEqual(0);
        expect(frame.x + frame.width).toBeLessThanOrEqual(maxX);
        expect(frame.y).toBeGreaterThanOrEqual(0);
        expect(frame.y + frame.height).toBeLessThanOrEqual(maxY);
      }
    });

    it('loads atlas and applies NEAREST scaleMode to subtextures', async () => {
      // Use Texture.WHITE as base texture mock
      const loaded = await assetRegistry.loadAtlas(Texture.WHITE);
      expect(loaded).toBe(true);
      expect(assetRegistry.isLoaded).toBe(true);

      const goblinTex = assetRegistry.getTexture('monster_goblin');
      expect(goblinTex).toBeDefined();
      expect(goblinTex?.source.scaleMode).toBe('nearest');

      const wallTex = assetRegistry.getTexture('wall_solid');
      expect(wallTex).toBeDefined();
      expect(wallTex?.source.scaleMode).toBe('nearest');
    });

    it('resolves explicit tokenSpriteId to Tier 1 spritesheet asset', () => {
      const res = assetRegistry.resolveCreatureToken({
        id: 'c-1',
        name: 'Custom Sprite Goblin',
        tokenSpriteId: 'monster_goblin',
      });

      expect(res.tier).toBe('spritesheet');
      expect(res.spriteKey).toBe('monster_goblin');
      expect(res.frame).toBeDefined();
      expect(res.texture).toBeDefined();
      expect(res.monogram).toBe('CS');
    });

    it('resolves known monster names and hero classes to Tier 1 spritesheet asset', () => {
      const goblinRes = assetRegistry.resolveCreatureToken({
        id: 'c-goblin',
        name: 'Goblin',
        side: 'monster',
      });
      expect(goblinRes.tier).toBe('spritesheet');
      expect(goblinRes.spriteKey).toBe('monster_goblin');

      const fighterRes = assetRegistry.resolveCreatureToken({
        id: 'c-fighter',
        name: 'Fighter',
        side: 'party',
      });
      expect(fighterRes.tier).toBe('spritesheet');
      expect(fighterRes.spriteKey).toBe('hero_fighter');
    });
  });

  describe('Tier 2: Vector Icon Library (game-icons.net SVGs)', () => {
    it('covers all 15 SRD 5.1 conditions with valid SVG icons', () => {
      expect(CONDITION_IDS).toHaveLength(15);

      for (const cond of (CONDITION_IDS as readonly ConditionId[])) {
        expect(CONDITION_ICON_MAP[cond]).toBeDefined();
        const res = assetRegistry.resolveConditionIcon(cond);
        expect(res.tier).toBe('svg');
        expect(res.url).toMatch(/^\/assets\/game-icons\/[a-z0-9-]+\.svg$/);
        expect(res.altText).toContain(cond);
      }
    });

    it('maps all standard combat actions to valid SVG icons', () => {
      const standardActions = [
        'dash',
        'disengage',
        'dodge',
        'help',
        'hide',
        'search',
        'stand_up',
        'drop_concentration',
        'action_surge',
        'attack',
      ];

      for (const act of standardActions) {
        expect(ACTION_ICON_MAP[act]).toBeDefined();
        const res = assetRegistry.resolveActionIcon(act);
        expect(res.tier).toBe('svg');
        expect(res.url).toMatch(/^\/assets\/game-icons\/[a-z0-9-]+\.svg$/);
      }
    });

    it('maps all 8 SRD magic schools and iconic spells to valid SVG icons', () => {
      const schools = [
        'abjuration',
        'conjuration',
        'divination',
        'enchantment',
        'evocation',
        'illusion',
        'necromancy',
        'transmutation',
      ];

      for (const school of schools) {
        expect(SPELL_SCHOOL_ICON_MAP[school]).toBeDefined();
        const res = assetRegistry.resolveSpellIcon({ school });
        expect(res.tier).toBe('svg');
        expect(res.url).toMatch(/^\/assets\/game-icons\/[a-z0-9-]+\.svg$/);
      }

      // Specific iconic spells
      const fireball = assetRegistry.resolveSpellIcon({ name: 'Fireball' });
      expect(fireball.url).toBe('/assets/game-icons/fireball.svg');

      const cureWounds = assetRegistry.resolveSpellIcon({ name: 'Cure Wounds' });
      expect(cureWounds.url).toBe('/assets/game-icons/healing.svg');
    });

    it('renders <GameIcon /> React component with correct attributes and class names', () => {
      const { container } = render(
        <GameIcon name="dash" category="action" size={24} className="test-icon-class" />,
      );

      const img = screen.getByTestId('game-icon-dash');
      expect(img).toBeDefined();
      expect(img.getAttribute('src')).toBe('/assets/game-icons/sprint.svg');
      expect(img.getAttribute('width')).toBe('24');
      expect(img.getAttribute('height')).toBe('24');
      expect(img.className).toContain('test-icon-class');
    });

    it('getGameIconUrl handles condition, spell, item, and raw categories', () => {
      expect(getGameIconUrl('poisoned', 'condition').url).toBe('/assets/game-icons/poison.svg');
      expect(getGameIconUrl('evocation', 'spell').url).toBe('/assets/game-icons/fireball.svg');
      expect(getGameIconUrl('potion', 'item').url).toBe('/assets/game-icons/health-potion.svg');
      expect(getGameIconUrl('custom-icon', 'raw').url).toBe('/assets/game-icons/custom-icon.svg');
    });
  });

  describe('Tier 3: Procedural Tabletop Token Fallback & Allegiance Styling', () => {
    it('computes crisp 2-letter uppercase monograms', () => {
      expect(assetRegistry.computeMonogram('Owlbear')).toBe('OW');
      expect(assetRegistry.computeMonogram('Gelatinous Cube')).toBe('GC');
      expect(assetRegistry.computeMonogram('Young Red Dragon')).toBe('YR');
      expect(assetRegistry.computeMonogram('A')).toBe('A');
      expect(assetRegistry.computeMonogram('')).toBe('??');
    });

    it('assigns allegiance colors based on party, monster, neutral, and teamId', () => {
      const party = assetRegistry.resolveTeamColors('party');
      expect(party.border).toBe(0x22c55e); // Green

      const monster = assetRegistry.resolveTeamColors('monster');
      expect(monster.border).toBe(0xef4444); // Red

      const neutral = assetRegistry.resolveTeamColors('neutral');
      expect(neutral.border).toBe(0xf59e0b); // Amber

      const teamBlue = assetRegistry.resolveTeamColors('party', 'team_blue');
      expect(teamBlue.border).toBe(0x38bdf8); // Blue

      const boss = assetRegistry.resolveTeamColors('monster', undefined, true);
      expect(boss.border).toBe(0xeab308); // Gold
    });

    it('flags high CR monsters as boss with gold styling', () => {
      const res = assetRegistry.resolveCreatureToken({
        id: 'm-boss',
        name: 'Ancient Gold Dragon',
        side: 'monster',
        challengeRating: 24,
      });

      expect(res.isBoss).toBe(true);
      expect(res.borderColor).toBe(0xeab308); // Gold
    });

    it('guarantees zero broken textures across all bundled SRD monsters', () => {
      const compendium = defaultCompendium;
      expect(compendium.monsters.length).toBeGreaterThan(0);

      let spriteHits = 0;
      let proceduralFallbacks = 0;

      for (const monster of compendium.monsters) {
        const res = assetRegistry.resolveCreatureToken({
          id: monster.id,
          name: monster.name,
          side: 'monster',
          challengeRating: monster.challengeRating,
          monsterType: monster.type,
        });

        expect(res).toBeDefined();
        expect(res.monogram).toBeDefined();
        expect(res.monogram.length).toBeGreaterThanOrEqual(1);
        expect(typeof res.baseColor).toBe('number');
        expect(typeof res.borderColor).toBe('number');
        expect(typeof res.glowColor).toBe('number');

        if (res.tier === 'spritesheet') {
          spriteHits++;
          expect(res.frame).toBeDefined();
        } else {
          proceduralFallbacks++;
          expect(res.tier).toBe('procedural');
        }
      }

      expect(spriteHits).toBeGreaterThan(0);
      expect(proceduralFallbacks).toBeGreaterThan(0);
      expect(spriteHits + proceduralFallbacks).toBe(compendium.monsters.length);
    });
  });

  describe('PixiJS Layer Integration', () => {
    it('CreatureTokenRenderer renders both Tier 1 sprites and Tier 3 procedural tokens without error', () => {
      const parent = new Container();
      const renderer = new CreatureTokenRenderer(parent);

      const combatants = [
        {
          id: 'goblin-1',
          name: 'Goblin',
          side: 'monster' as const,
          size: 'small' as const,
          position: { x: 1, y: 1 },
          currentHp: 7,
          maxHp: 7,
          conditions: ['poisoned' as const],
        },
        {
          id: 'owlbear-1',
          name: 'Owlbear',
          side: 'monster' as const,
          size: 'large' as const,
          position: { x: 3, y: 3 },
          currentHp: 59,
          maxHp: 59,
          challengeRating: 3,
        },
      ];

      expect(() => {
        renderer.render({
          combatants,
          cellSize: 48,
          selectedId: 'goblin-1',
          activeId: 'owlbear-1',
        });
      }).not.toThrow();

      expect(parent.children.length).toBeGreaterThan(0);
    });

    it('TerrainTileRenderer renders with assetRegistry without crashing', () => {
      const parent = new Container();
      const renderer = new TerrainTileRenderer(parent);

      expect(() => {
        renderer.render({
          grid: {
            width: 4,
            height: 4,
            cells: [
              { x: 0, y: 0, terrain: 'floor_stone' },
              { x: 1, y: 0, terrain: 'wall_solid' },
              { x: 2, y: 0, terrain: 'water_shallow' },
              { x: 3, y: 0, terrain: 'chasm' },
            ],
          },
          cellSize: 48,
        });
      }).not.toThrow();
    });
  });
});
