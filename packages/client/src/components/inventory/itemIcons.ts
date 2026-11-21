/**
 * SRD-1301: Licensed item-icon registry (BG3-style inventory, Phase 1).
 *
 * Single client-side seam mapping every canonical equipment / magic-item id
 * to a licensed icon. Primary system is RPG Awesome (`rpg-awesome` npm,
 * SIL OFL 1.1 font + MIT CSS, bundled offline via Vite — no CDN at runtime).
 * Gap filler is the already-vendored game-icons.net SVG set
 * (`public/assets/game-icons/*.svg`, CC BY 3.0) for items where a 1:1 vector
 * pictogram exists (potions, chests, scrolls, keys, shields, swords).
 *
 * Callers must use `getItemIcon()` / `<ItemIcon />` — never raw `ra-` classes.
 * Unknown ids fall back to the category glyph and warn once (never a broken
 * `<img>` / tofu box in the UI).
 *
 * Spec: docs/spec/12-graphical-inventory.md §2–§3.
 */

/** Category fallback glyph used when an id has no explicit entry. */
export type ItemIconFallback = 'weapon' | 'armor' | 'potion' | 'gear' | 'tool';

export interface ItemIconRef {
  /**
   * RPG Awesome icon suffix, e.g. `'broadsword'` renders as
   * `<i class="ra ra-broadsword">`. Must exist in
   * `rpg-awesome/css/rpg-awesome.min.css` (bundled offline).
   */
  ra?: string;
  /**
   * Vendored game-icons.net SVG filename under `/assets/game-icons/`,
   * e.g. `'health-potion.svg'`. Optional — RA is the primary system.
   */
  svg?: string;
  /** Fallback category glyph for unknown ids / load failures. */
  fallback: ItemIconFallback;
}

/** Generic glyph per fallback category (RA suffix + SVG both verified). */
export const FALLBACK_ICONS: Record<ItemIconFallback, Required<Pick<ItemIconRef, 'ra' | 'svg'>> & { fallback: ItemIconFallback }> = {
  weapon: { ra: 'sword', svg: 'broadsword.svg', fallback: 'weapon' },
  armor: { ra: 'shield', svg: 'shield.svg', fallback: 'armor' },
  potion: { ra: 'potion', svg: 'health-potion.svg', fallback: 'potion' },
  gear: { ra: 'ammo-bag', svg: 'chest.svg', fallback: 'gear' },
  tool: { ra: 'hammer', svg: 'monkey-wrench.svg', fallback: 'tool' },
};

/**
 * Explicit per-id registry. Covers 100% of `equipment.json` + `magic-items.json`
 * ids (verified by `itemIcons.test.ts` exhaustiveness test against
 * `defaultCompendium`). RA suffixes verified against the bundled
 * `rpg-awesome` CSS; SVG filenames verified against
 * `public/assets/game-icons/`.
 */
export const ITEM_ICON_REGISTRY: Record<string, ItemIconRef> = {
  // ── Consumables & ammunition (gear/consumable) ──
  'acid-vial': { ra: 'acid', svg: 'poison-bottle.svg', fallback: 'potion' },
  'alchemists-fire': { ra: 'fire-bomb', svg: 'fireball.svg', fallback: 'potion' },
  'antitoxin': { ra: 'vial', svg: 'poison-bottle.svg', fallback: 'potion' },
  'holy-water': { ra: 'vial', svg: 'standing-potion.svg', fallback: 'potion' },
  'oil-flask': { ra: 'flask', svg: 'round-potion.svg', fallback: 'potion' },
  'potion-of-healing': { ra: 'potion', svg: 'health-potion.svg', fallback: 'potion' },
  'rations-1-day': { ra: 'meat', fallback: 'gear' },
  arrow: { ra: 'barbed-arrow', svg: 'bow-arrow.svg', fallback: 'weapon' },
  'crossbow-bolt': { ra: 'broadhead-arrow', svg: 'crossbow.svg', fallback: 'weapon' },
  'sling-bullet': { ra: 'bullets', fallback: 'weapon' },

  // ── Simple weapons ──
  club: { ra: 'large-hammer', svg: 'broadsword.svg', fallback: 'weapon' },
  dagger: { ra: 'plain-dagger', svg: 'broad-dagger.svg', fallback: 'weapon' },
  dart: { ra: 'thorn-arrow', svg: 'flying-dagger.svg', fallback: 'weapon' },
  greatclub: { ra: 'large-hammer', fallback: 'weapon' },
  handaxe: { ra: 'axe', svg: 'battle-axe.svg', fallback: 'weapon' },
  javelin: { ra: 'spear-head', fallback: 'weapon' },
  'light-crossbow': { ra: 'crossbow', svg: 'crossbow.svg', fallback: 'weapon' },
  'light-hammer': { ra: 'hammer', fallback: 'weapon' },
  mace: { ra: 'spiked-mace', fallback: 'weapon' },
  quarterstaff: { ra: 'shovel', svg: 'wizard-staff.svg', fallback: 'weapon' },
  shortbow: { ra: 'archer', svg: 'bow-arrow.svg', fallback: 'weapon' },
  sickle: { ra: 'sickle', fallback: 'weapon' },
  sling: { ra: 'target-arrows', fallback: 'weapon' },
  spear: { ra: 'spear-head', fallback: 'weapon' },

  // ── Martial weapons ──
  battleaxe: { ra: 'axe', svg: 'battle-axe.svg', fallback: 'weapon' },
  blowgun: { ra: 'bottled-bolt', svg: 'crossbow.svg', fallback: 'weapon' },
  flail: { ra: 'spikeball', fallback: 'weapon' },
  glaive: { ra: 'halberd', fallback: 'weapon' },
  greataxe: { ra: 'axe-swing', svg: 'battle-axe.svg', fallback: 'weapon' },
  greatsword: { ra: 'broadsword', svg: 'two-handed-sword.svg', fallback: 'weapon' },
  halberd: { ra: 'halberd', fallback: 'weapon' },
  'hand-crossbow': { ra: 'crossbow', svg: 'crossbow.svg', fallback: 'weapon' },
  'heavy-crossbow': { ra: 'crossbow', svg: 'crossbow.svg', fallback: 'weapon' },
  lance: { ra: 'spear-head', fallback: 'weapon' },
  longbow: { ra: 'archer', svg: 'bow-arrow.svg', fallback: 'weapon' },
  longsword: { ra: 'sword', svg: 'broadsword.svg', fallback: 'weapon' },
  maul: { ra: 'large-hammer', fallback: 'weapon' },
  morningstar: { ra: 'spiked-mace', fallback: 'weapon' },
  net: { ra: 'spider-face', svg: 'box-trap.svg', fallback: 'weapon' },
  pike: { ra: 'spear-head', fallback: 'weapon' },
  rapier: { ra: 'sword', svg: 'piercing-sword.svg', fallback: 'weapon' },
  scimitar: { ra: 'croc-sword', svg: 'croc-sword.svg', fallback: 'weapon' },
  shortsword: { ra: 'sword', svg: 'broadsword.svg', fallback: 'weapon' },
  trident: { ra: 'trident', svg: 'magic-trident.svg', fallback: 'weapon' },
  'war-pick': { ra: 'kunai', fallback: 'weapon' },
  warhammer: { ra: 'hammer', fallback: 'weapon' },
  whip: { ra: 'vine-whip', fallback: 'weapon' },

  // ── Armor & shields ──
  'breastplate': { ra: 'vest', svg: 'chest-armor.svg', fallback: 'armor' },
  'chain-mail': { ra: 'chain', svg: 'chest-armor.svg', fallback: 'armor' },
  'chain-shirt': { ra: 'chain', svg: 'chest-armor.svg', fallback: 'armor' },
  'half-plate': { ra: 'knight-helmet', svg: 'chest-armor.svg', fallback: 'armor' },
  'hide-armor': { ra: 'vest', svg: 'chest-armor.svg', fallback: 'armor' },
  'leather-armor': { ra: 'vest', svg: 'chest-armor.svg', fallback: 'armor' },
  'padded-armor': { ra: 'hood', svg: 'chest-armor.svg', fallback: 'armor' },
  'plate-armor': { ra: 'knight-helmet', svg: 'chest-armor.svg', fallback: 'armor' },
  'ring-mail': { ra: 'chain', svg: 'chest-armor.svg', fallback: 'armor' },
  'scale-mail': { ra: 'vest', svg: 'chest-armor.svg', fallback: 'armor' },
  shield: { ra: 'shield', svg: 'shield.svg', fallback: 'armor' },
  'splint-armor': { ra: 'knight-helmet', svg: 'chest-armor.svg', fallback: 'armor' },
  'studded-leather-armor': { ra: 'vest', svg: 'chest-armor.svg', fallback: 'armor' },

  // ── Adventuring gear: containers, light, survival ──
  backpack: { ra: 'ammo-bag', svg: 'chest.svg', fallback: 'gear' },
  'map-or-scroll-case': { ra: 'scroll-unfurled', svg: 'tied-scroll.svg', fallback: 'gear' },
  pouch: { ra: 'ammo-bag', svg: 'chest.svg', fallback: 'gear' },
  quiver: { ra: 'arrow-cluster', svg: 'bow-arrow.svg', fallback: 'gear' },
  vial: { ra: 'vial', svg: 'round-potion.svg', fallback: 'gear' },
  waterskin: { ra: 'water-drop', fallback: 'gear' },
  chest: { ra: 'locked-fortress', svg: 'locked-chest.svg', fallback: 'gear' },
  'alms-box': { ra: 'gold-bar', svg: 'chest.svg', fallback: 'gear' },
  'ball-bearings': { ra: 'ball', svg: 'coins.svg', fallback: 'gear' },
  bedroll: { ra: 'campfire', svg: 'sleeping-bag.svg', fallback: 'gear' },
  bell: { ra: 'bell', fallback: 'gear' },
  blanket: { ra: 'cloak-and-dagger', svg: 'sleeping-bag.svg', fallback: 'gear' },
  book: { ra: 'book', svg: 'spell-book.svg', fallback: 'gear' },
  caltrops: { ra: 'spikeball', svg: 'wolf-trap.svg', fallback: 'gear' },
  candle: { ra: 'candle', fallback: 'gear' },
  censer: { ra: 'incense', fallback: 'gear' },
  'chain-10ft': { ra: 'chain', fallback: 'gear' },
  'climbers-kit': { ra: 'grappling-hook', fallback: 'gear' },
  'component-pouch': { ra: 'ammo-bag', svg: 'chest.svg', fallback: 'gear' },
  crowbar: { ra: 'gear-hammer', svg: 'monkey-wrench.svg', fallback: 'tool' },
  hammer: { ra: 'hammer', svg: 'monkey-wrench.svg', fallback: 'tool' },
  'healers-kit': { ra: 'medical-pack', svg: 'healing.svg', fallback: 'tool' },
  'grappling-hook': { ra: 'grappling-hook', fallback: 'gear' },
  'hempen-rope-50ft': { ra: 'chain', fallback: 'gear' },
  'hooded-lantern': { ra: 'lantern-flame', svg: 'magic-lamp.svg', fallback: 'gear' },
  'hunting-trap': { ra: 'bear-trap', svg: 'wolf-trap.svg', fallback: 'gear' },
  'incense-block': { ra: 'incense', fallback: 'gear' },
  'ink-bottle': { ra: 'bottle-vapors', svg: 'poison-bottle.svg', fallback: 'gear' },
  'ink-pen': { ra: 'quill-ink', svg: 'scroll-quill.svg', fallback: 'gear' },
  'iron-pot': { ra: 'coffee-mug', fallback: 'gear' },
  'iron-spikes': { ra: 'spikeball', fallback: 'gear' },
  lamp: { ra: 'lantern-flame', svg: 'magic-lamp.svg', fallback: 'gear' },
  lock: { ra: 'key', svg: 'key.svg', fallback: 'gear' },
  'magnifying-glass': { ra: 'eyeball', fallback: 'gear' },
  manacles: { ra: 'chain', fallback: 'gear' },
  'mess-kit': { ra: 'coffee-mug', fallback: 'gear' },
  'mirror-steel': { ra: 'mirror', fallback: 'gear' },
  'paper-sheet': { ra: 'scroll-unfurled', svg: 'scroll-unfurled.svg', fallback: 'gear' },
  'parchment-sheet': { ra: 'scroll-unfurled', svg: 'scroll-quill.svg', fallback: 'gear' },
  'perfume-vial': { ra: 'heart-bottle', svg: 'round-potion.svg', fallback: 'gear' },
  piton: { ra: 'spikeball', fallback: 'gear' },
  'sand-bag': { ra: 'ammo-bag', fallback: 'gear' },
  'scale-merchants': { ra: 'gold-bar', svg: 'coins.svg', fallback: 'gear' },
  'sealing-wax': { ra: 'candle-fire', fallback: 'gear' },
  shovel: { ra: 'shovel', fallback: 'tool' },
  'signet-ring': { ra: 'diamond', svg: 'skull-signet.svg', fallback: 'gear' },
  'silk-rope-50ft': { ra: 'chain', fallback: 'gear' },
  'small-knife': { ra: 'knife', svg: 'broad-dagger.svg', fallback: 'tool' },
  soap: { ra: 'droplet', fallback: 'gear' },
  spellbook: { ra: 'book', svg: 'spell-book.svg', fallback: 'gear' },
  spyglass: { ra: 'telescope', fallback: 'gear' },
  'string-10ft': { ra: 'chain', fallback: 'gear' },
  tinderbox: { ra: 'match', svg: 'fireball.svg', fallback: 'gear' },
  torch: { ra: 'torch', svg: 'fireball.svg', fallback: 'gear' },
  'two-person-tent': { ra: 'campfire', fallback: 'gear' },
  whistle: { ra: 'bell', fallback: 'gear' },

  // ── Clothing & packs ──
  'common-clothes': { ra: 'vest', fallback: 'gear' },
  'costume-clothes': { ra: 'hood', svg: 'cloak-dagger.svg', fallback: 'gear' },
  'fine-clothes': { ra: 'crown', svg: 'cloak-dagger.svg', fallback: 'gear' },
  'travelers-clothes': { ra: 'cloak-and-dagger', svg: 'cloak-dagger.svg', fallback: 'gear' },
  vestments: { ra: 'hood', svg: 'cloak-dagger.svg', fallback: 'gear' },
  'burglars-pack': { ra: 'ammo-bag', svg: 'chest.svg', fallback: 'gear' },
  'diplomats-pack': { ra: 'ammo-bag', svg: 'chest.svg', fallback: 'gear' },
  'dungeoneers-pack': { ra: 'ammo-bag', svg: 'chest.svg', fallback: 'gear' },
  'entertainers-pack': { ra: 'ammo-bag', svg: 'chest.svg', fallback: 'gear' },
  'explorers-pack': { ra: 'ammo-bag', svg: 'chest.svg', fallback: 'gear' },
  'priests-pack': { ra: 'ammo-bag', svg: 'chest.svg', fallback: 'gear' },
  'scholars-pack': { ra: 'book', svg: 'spell-book.svg', fallback: 'gear' },

  // ── Holy symbols, foci & druidic totems ──
  amulet: { ra: 'ankh', svg: 'shield.svg', fallback: 'gear' },
  emblem: { ra: 'ankh', svg: 'shield.svg', fallback: 'gear' },
  reliquary: { ra: 'ankh', svg: 'locked-chest.svg', fallback: 'gear' },
  crystal: { ra: 'crystal-ball', svg: 'dragon-orb.svg', fallback: 'gear' },
  orb: { ra: 'crystal-ball', svg: 'dragon-orb.svg', fallback: 'gear' },
  rod: { ra: 'crystal-wand', svg: 'wizard-staff.svg', fallback: 'gear' },
  staff: { ra: 'crystal-wand', svg: 'wizard-staff.svg', fallback: 'gear' },
  wand: { ra: 'fairy-wand', svg: 'wizard-staff.svg', fallback: 'gear' },
  'sprig-of-mistletoe': { ra: 'leaf', fallback: 'gear' },
  totem: { ra: 'wolf-head', fallback: 'gear' },
  'wooden-staff': { ra: 'shovel', svg: 'wizard-staff.svg', fallback: 'gear' },
  'yew-wand': { ra: 'fairy-wand', svg: 'wizard-staff.svg', fallback: 'gear' },

  // ── Artisan's tools ──
  'alchemists-supplies': { ra: 'fizzing-flask', svg: 'magic-potion.svg', fallback: 'tool' },
  'brewers-supplies': { ra: 'beer', fallback: 'tool' },
  'calligraphers-supplies': { ra: 'quill-ink', svg: 'scroll-quill.svg', fallback: 'tool' },
  'carpenters-tools': { ra: 'hand-saw', svg: 'monkey-wrench.svg', fallback: 'tool' },
  'cartographers-tools': { ra: 'compass', fallback: 'tool' },
  'cobblers-tools': { ra: 'boot-stomp', fallback: 'tool' },
  'cooks-utensils': { ra: 'coffee-mug', fallback: 'tool' },
  'glassblowers-tools': { ra: 'fizzing-flask', svg: 'round-potion.svg', fallback: 'tool' },
  'jewelers-tools': { ra: 'gem', svg: 'crown-coin.svg', fallback: 'tool' },
  'leatherworkers-tools': { ra: 'vest', fallback: 'tool' },
  'masons-tools': { ra: 'guarded-tower', fallback: 'tool' },
  'painters-supplies': { ra: 'flower', fallback: 'tool' },
  'potters-tools': { ra: 'vase', fallback: 'tool' },
  'smiths-tools': { ra: 'anvil', fallback: 'tool' },
  'tinkers-tools': { ra: 'gears', svg: 'monkey-wrench.svg', fallback: 'tool' },
  'weavers-tools': { ra: 'spider-face', fallback: 'tool' },
  'woodcarvers-tools': { ra: 'axe', svg: 'battle-axe.svg', fallback: 'tool' },
  'disguise-kit': { ra: 'arcane-mask', fallback: 'tool' },
  'forgery-kit': { ra: 'quill-ink', svg: 'scroll-quill.svg', fallback: 'tool' },
  'herbalism-kit': { ra: 'leaf', fallback: 'tool' },
  'navigators-tools': { ra: 'telescope', fallback: 'tool' },
  'poisoners-kit': { ra: 'poison-cloud', svg: 'poison-bottle.svg', fallback: 'tool' },
  'thieves-tools': { ra: 'key', svg: 'key.svg', fallback: 'tool' },

  // ── Musical instruments ──
  bagpipes: { ra: 'horn-call', svg: 'music-spell.svg', fallback: 'tool' },
  drum: { ra: 'ringing-bell', svg: 'music-spell.svg', fallback: 'tool' },
  dulcimer: { ra: 'ocarina', svg: 'musical-keyboard.svg', fallback: 'tool' },
  flute: { ra: 'ocarina', svg: 'music-spell.svg', fallback: 'tool' },
  horn: { ra: 'horn-call', svg: 'music-spell.svg', fallback: 'tool' },
  lute: { ra: 'ocarina', svg: 'musical-keyboard.svg', fallback: 'tool' },
  lyre: { ra: 'ocarina', svg: 'musical-keyboard.svg', fallback: 'tool' },
  'pan-flute': { ra: 'ocarina', svg: 'music-spell.svg', fallback: 'tool' },
  shawm: { ra: 'horn-call', svg: 'music-spell.svg', fallback: 'tool' },
  viol: { ra: 'ocarina', svg: 'musical-keyboard.svg', fallback: 'tool' },

  // ── Gaming sets & misc kits ──
  'dice-set': { ra: 'dice-six', fallback: 'tool' },
  'playing-card-set': { ra: 'spades-card', fallback: 'tool' },

  // ── SRD magic items (26) ──
  'amulet-of-health': { ra: 'heart-bottle', svg: 'heart-necklace.svg', fallback: 'gear' },
  'armor-plus-1': { ra: 'heavy-shield', svg: 'chest-armor.svg', fallback: 'armor' },
  'armor-plus-2': { ra: 'heavy-shield', svg: 'chest-armor.svg', fallback: 'armor' },
  'armor-plus-3': { ra: 'heavy-shield', svg: 'chest-armor.svg', fallback: 'armor' },
  'bag-of-holding': { ra: 'ammo-bag', svg: 'chest.svg', fallback: 'gear' },
  'belt-of-hill-giant-strength': { ra: 'muscle-up', svg: 'chest-armor.svg', fallback: 'gear' },
  'boots-of-elvenkind': { ra: 'boot-stomp', fallback: 'gear' },
  'bracers-of-defense': { ra: 'round-shield', svg: 'shield.svg', fallback: 'armor' },
  'cloak-of-elvenkind': { ra: 'hood', svg: 'cloak-dagger.svg', fallback: 'gear' },
  'cloak-of-protection': { ra: 'cloak-and-dagger', svg: 'cloak-dagger.svg', fallback: 'gear' },
  'flame-tongue': { ra: 'fireball-sword', svg: 'fireball.svg', fallback: 'weapon' },
  'gauntlets-of-ogre-power': { ra: 'hand', svg: 'shield.svg', fallback: 'gear' },
  'longsword-plus-1': { ra: 'sword', svg: 'broadsword.svg', fallback: 'weapon' },
  'periapt-of-wound-closure': { ra: 'gem-pendant', svg: 'healing.svg', fallback: 'gear' },
  'potion-of-greater-healing': { ra: 'potion', svg: 'health-potion.svg', fallback: 'potion' },
  'potion-of-superior-healing': { ra: 'heart-bottle', svg: 'magic-potion.svg', fallback: 'potion' },
  'potion-of-supreme-healing': { ra: 'bubbling-potion', svg: 'magic-potion.svg', fallback: 'potion' },
  'ring-of-protection': { ra: 'diamond', svg: 'shield.svg', fallback: 'gear' },
  'scroll-of-fireball': { ra: 'scroll-unfurled', svg: 'scroll-unfurled.svg', fallback: 'gear' },
  'shield-plus-1': { ra: 'shield', svg: 'shield.svg', fallback: 'armor' },
  'shield-plus-2': { ra: 'round-shield', svg: 'shield.svg', fallback: 'armor' },
  'shield-plus-3': { ra: 'heavy-shield', svg: 'shield.svg', fallback: 'armor' },
  'wand-of-magic-missiles': { ra: 'crystal-wand', svg: 'wizard-staff.svg', fallback: 'gear' },
  'weapon-plus-1': { ra: 'sword', svg: 'crossed-swords.svg', fallback: 'weapon' },
  'weapon-plus-2': { ra: 'broadsword', svg: 'crossed-swords.svg', fallback: 'weapon' },
  'weapon-plus-3': { ra: 'relic-blade', svg: 'crossed-swords.svg', fallback: 'weapon' },
};

/** Ids warned about once (unknown-id fallback path). Test hook resets this. */
const warnedUnknownIds = new Set<string>();

/** Reset the once-only unknown-id warning cache (tests only). */
export function resetItemIconWarnings(): void {
  warnedUnknownIds.clear();
}

/**
 * Resolve the icon for any canonical item id. Unknown ids return the
 * category fallback (`gear` when the category is unknown) and warn once —
 * never a broken image.
 */
export function getItemIcon(itemId: string): ItemIconRef {
  const direct = ITEM_ICON_REGISTRY[itemId];
  if (direct) return direct;
  if (!warnedUnknownIds.has(itemId)) {
    warnedUnknownIds.add(itemId);
    // eslint-disable-next-line no-console
    console.warn(`[itemIcons] unknown item id "${itemId}" — using gear fallback`);
  }
  return FALLBACK_ICONS.gear;
}

/** CSS class for the RPG Awesome font glyph, e.g. `"ra ra-broadsword"`. */
export function getItemIconClass(itemId: string): string {
  const ref = getItemIcon(itemId);
  const suffix = ref.ra ?? FALLBACK_ICONS[ref.fallback].ra;
  return `ra ra-${suffix}`;
}

/** Public URL for the vendored SVG side of the icon (gap-filler art). */
export function resolveItemIconUrl(itemId: string): string {
  const ref = getItemIcon(itemId);
  const file = ref.svg ?? FALLBACK_ICONS[ref.fallback].svg;
  return `/assets/game-icons/${file}`;
}

/** True when the id has an explicit registry entry (not a fallback). */
export function isItemIconRegistered(itemId: string): boolean {
  return Object.prototype.hasOwnProperty.call(ITEM_ICON_REGISTRY, itemId);
}
