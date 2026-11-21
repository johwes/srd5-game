import type { MagicItemRarity } from '@srd5/data';

/**
 * SRD-1302: Rarity visual language (Spec 12 §5).
 *
 * One mapping, applied everywhere an item renders (loot rows, shop rows,
 * paperdoll slots, backpack cells, compendium). Mundane equipment has no
 * rarity in the dataset and renders as `common`.
 */

export type ItemRarityKey = MagicItemRarity | 'common';

export const ITEM_RARITY_ORDER: readonly ItemRarityKey[] = [
  'common',
  'uncommon',
  'rare',
  'very_rare',
  'legendary',
  'artifact',
] as const;

export const ITEM_RARITY_LABELS: Record<ItemRarityKey, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  very_rare: 'Very Rare',
  legendary: 'Legendary',
  artifact: 'Artifact',
};

export interface ItemRarityStyle {
  /** Border + glow wrapper for the item cell/row. */
  border: string;
  /** Text color for the item name. */
  text: string;
  /** Badge pill (rarity label) classes. */
  badge: string;
  /** Optional extra glow (box-shadow) class; empty for common. */
  glow: string;
}

export const ITEM_RARITY_STYLES: Record<ItemRarityKey, ItemRarityStyle> = {
  common: {
    border: 'border-slate-700',
    text: 'text-slate-300',
    badge: 'bg-slate-800 text-slate-300 border-slate-700',
    glow: '',
  },
  uncommon: {
    border: 'border-emerald-500/60 shadow-[0_0_8px_rgba(16,185,129,0.35)]',
    text: 'text-emerald-300',
    badge: 'bg-emerald-950/60 text-emerald-300 border-emerald-700/60',
    glow: 'shadow-[0_0_8px_rgba(16,185,129,0.35)]',
  },
  rare: {
    border: 'border-sky-400/70 shadow-[0_0_10px_rgba(56,189,248,0.4)]',
    text: 'text-sky-300',
    badge: 'bg-sky-950/60 text-sky-300 border-sky-700/60',
    glow: 'shadow-[0_0_10px_rgba(56,189,248,0.4)]',
  },
  very_rare: {
    border: 'border-purple-400/70 shadow-[0_0_14px_rgba(192,132,252,0.5)]',
    text: 'text-purple-300',
    badge: 'bg-purple-950/60 text-purple-300 border-purple-700/60',
    glow: 'shadow-[0_0_14px_rgba(192,132,252,0.5)]',
  },
  legendary: {
    border: 'border-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.55)]',
    text: 'text-amber-300',
    badge: 'bg-amber-950/60 text-amber-300 border-amber-600/60',
    glow: 'shadow-[0_0_14px_rgba(251,191,36,0.55)]',
  },
  artifact: {
    border: 'border-red-400 shadow-[0_0_16px_rgba(248,113,113,0.6)] animate-pulse',
    text: 'text-red-300',
    badge: 'bg-red-950/60 text-red-300 border-red-600/60',
    glow: 'shadow-[0_0_16px_rgba(248,113,113,0.6)]',
  },
};

/** Normalize any rarity-ish string to a known key (unknown → `common`). */
export function normalizeItemRarity(rarity?: string | null): ItemRarityKey {
  switch ((rarity ?? 'common').trim().toLowerCase()) {
    case 'uncommon':
      return 'uncommon';
    case 'rare':
      return 'rare';
    case 'very_rare':
    case 'very-rare':
    case 'very rare':
      return 'very_rare';
    case 'legendary':
      return 'legendary';
    case 'artifact':
      return 'artifact';
    case 'common':
    default:
      return 'common';
  }
}

/** Rarity of a magic-item record; mundane (no record) → `common`. */
export function getItemRarityForMagicItem(
  magicItem?: { rarity?: string } | null,
): ItemRarityKey {
  if (!magicItem?.rarity) return 'common';
  return normalizeItemRarity(magicItem.rarity);
}

/** Human label, e.g. `"Very Rare"`. */
export function formatRarityLabel(rarity: ItemRarityKey): string {
  return ITEM_RARITY_LABELS[rarity];
}

/** Border (+glow) classes for an item cell/row. */
export function getRarityBorderClass(rarity: ItemRarityKey): string {
  return ITEM_RARITY_STYLES[rarity].border;
}

/** Name text-color classes for an item. */
export function getRarityTextClass(rarity: ItemRarityKey): string {
  return ITEM_RARITY_STYLES[rarity].text;
}

/** Badge pill classes for a rarity label. */
export function getRarityBadgeClass(rarity: ItemRarityKey): string {
  return ITEM_RARITY_STYLES[rarity].badge;
}
