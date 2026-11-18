import type { ConditionId } from '@srd5/data';
import type { TileTerrainType } from '@srd5/engine';
import type { SpritesheetAtlasMeta, TileFrame } from './types.js';

export const KENNEY_ATLAS_META: SpritesheetAtlasMeta = {
  id: 'kenney-tiny-dungeon',
  imagePath: '/assets/kenney-tiny-dungeon/tilemap_packed.png',
  tileWidth: 16,
  tileHeight: 16,
  cols: 12,
  rows: 11,
  scaleMode: 'nearest',
};

const TILE_PX = 16;
const f = (col: number, row: number): TileFrame => ({
  x: col * TILE_PX,
  y: row * TILE_PX,
  width: TILE_PX,
  height: TILE_PX,
});

/**
 * Packed frame coordinates for Kenney Tiny Dungeon CC0 spritesheet.
 */
export const KENNEY_SPRITE_FRAMES: Record<string, TileFrame> = {
  // Terrain
  floor_stone: f(4, 0),
  floor_stone_alt: f(5, 0),
  floor_wood: f(4, 1),
  wall_solid: f(1, 1),
  wall_top: f(1, 0),
  wall_left: f(0, 1),
  wall_right: f(2, 1),
  wall_bottom: f(1, 2),
  chasm: f(10, 3),
  water_shallow: f(7, 3),
  water_deep: f(8, 3),
  rubble: f(6, 2),
  lava: f(9, 3),
  void: f(0, 3),

  // Interactive Props (verified against tilemap_packed.png: col 9 row 3 is
  // the dark open archway; cols 10-11 row 3 are closed door panels)
  door_closed: f(10, 3),
  door_open: f(9, 3),
  door_locked: f(10, 3),
  stairs_down: f(2, 6),
  stairs_up: f(3, 6),
  chest_closed: f(5, 7),
  chest_open: f(6, 7),
  trap_spikes: f(1, 6),
  shrine: f(5, 5),

  // Heroes / PC Classes
  hero_fighter: f(0, 8),
  hero_wizard: f(0, 7),
  hero_rogue: f(4, 7),
  hero_cleric: f(4, 8),
  hero_ranger: f(3, 8),
  hero_paladin: f(2, 8),
  hero_barbarian: f(1, 8),
  hero_bard: f(1, 7),
  hero_druid: f(4, 9),
  hero_monk: f(1, 7),
  hero_sorcerer: f(0, 7),
  hero_warlock: f(3, 9),

  // Common Monsters
  monster_goblin: f(1, 9),
  monster_orc: f(1, 9),
  monster_skeleton: f(3, 9),
  monster_zombie: f(3, 9),
  monster_spider: f(2, 10),
  monster_bat: f(0, 10),
  monster_slime: f(0, 9),
  monster_dragon: f(2, 9),
  monster_demon: f(2, 9),
  monster_ghost: f(1, 10),
  monster_wolf: f(3, 10),
  monster_rat: f(4, 10),
  monster_cultist: f(3, 9),
  monster_ogre: f(1, 9),
  monster_ghoul: f(3, 9),
  monster_hobgoblin: f(1, 9),
  monster_bugbear: f(1, 9),
};

/**
 * Mapping from engine TileTerrainType to Kenney spritesheet frame key.
 */
export const TERRAIN_SPRITE_MAP: Record<TileTerrainType, string> = {
  floor_stone: 'floor_stone',
  floor_wood: 'floor_wood',
  floor_sand: 'floor_stone',
  floor_basalt: 'void',
  wall_solid: 'wall_solid',
  chasm: 'chasm',
  water_shallow: 'water_shallow',
  water_deep: 'water_deep',
  rubble: 'rubble',
  lava: 'lava',
  void: 'void',
};

/**
 * Mapping of all 15 SRD 5.1 conditions to game-icons.net SVG vector icons.
 */
export const CONDITION_ICON_MAP: Record<ConditionId, string> = {
  blinded: 'blindfold.svg',
  charmed: 'heart-wings.svg',
  deafened: 'shield-disabled.svg',
  exhaustion: 'sleepy.svg',
  frightened: 'dread-skull.svg',
  grappled: 'mantrap.svg',
  incapacitated: 'stoned-skull.svg',
  invisible: 'spider-mask.svg',
  paralyzed: 'bolt-shield.svg',
  petrified: 'stoned-skull.svg',
  poisoned: 'poison.svg',
  prone: 'sword-wound.svg',
  restrained: 'shattered-heart.svg',
  stunned: 'cursed-star.svg',
  unconscious: 'night-sleep.svg',
};

/**
 * Mapping of standard combat actions to game-icons.net SVG vector icons.
 */
export const ACTION_ICON_MAP: Record<string, string> = {
  dash: 'sprint.svg',
  disengage: 'cloak-dagger.svg',
  dodge: 'dodge.svg',
  help: 'healing.svg',
  hide: 'spider-mask.svg',
  search: 'key-lock.svg',
  stand_up: 'sprint.svg',
  drop_concentration: 'broken-heart.svg',
  action_surge: 'power-lightning.svg',
  attack: 'crossed-swords.svg',
  cast_spell: 'spell-book.svg',
};

/**
 * Mapping of the 8 SRD magic schools to game-icons.net SVG vector icons.
 */
export const SPELL_SCHOOL_ICON_MAP: Record<string, string> = {
  abjuration: 'shield.svg',
  conjuration: 'magic-portal.svg',
  divination: 'sparkles.svg',
  enchantment: 'crowned-heart.svg',
  evocation: 'fireball.svg',
  illusion: 'spider-mask.svg',
  necromancy: 'death-skull.svg',
  transmutation: 'standing-potion.svg',
};

/**
 * Mapping of common items / gear to game-icons.net SVG vector icons.
 */
export const ITEM_ICON_MAP: Record<string, string> = {
  potion: 'health-potion.svg',
  sword: 'broadsword.svg',
  axe: 'battle-axe.svg',
  bow: 'bow-arrow.svg',
  dagger: 'broad-dagger.svg',
  shield: 'shield.svg',
  chest: 'chest.svg',
  door: 'wooden-door.svg',
  trap: 'wolf-trap.svg',
  key: 'key.svg',
};
