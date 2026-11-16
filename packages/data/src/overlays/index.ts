import type { SrdOverlayBundle } from '../ingestion/overlay.js';
import { SRD_GEAR_OVERLAYS, SRD_MAGIC_ITEM_OVERLAYS } from './equipment-overlays.js';
import { SRD_FEAT_OVERLAYS, SRD_FEATURE_OVERLAYS } from './feature-overlays.js';
import { SRD_HIGH_TIER_FEATURE_OVERLAYS } from './high-tier-feature-overlays.js';
import { SRD_HIGH_TIER_MONSTER_OVERLAYS } from './high-tier-monster-overlays.js';
import { SRD_HIGH_TIER_SPELL_OVERLAYS } from './high-tier-spell-overlays.js';
import { SRD_MONSTER_OVERLAYS } from './monster-overlays.js';
import { SRD_RACE_OVERLAYS, SRD_SUBRACE_OVERLAYS } from './race-overlays.js';
import { SRD_SPELL_OVERLAYS } from './spell-overlays.js';

export {
  SRD_GEAR_OVERLAYS,
  SRD_MAGIC_ITEM_OVERLAYS,
  SRD_FEAT_OVERLAYS,
  SRD_FEATURE_OVERLAYS,
  SRD_HIGH_TIER_FEATURE_OVERLAYS,
  SRD_HIGH_TIER_MONSTER_OVERLAYS,
  SRD_HIGH_TIER_SPELL_OVERLAYS,
  SRD_MONSTER_OVERLAYS,
  SRD_RACE_OVERLAYS,
  SRD_SUBRACE_OVERLAYS,
  SRD_SPELL_OVERLAYS,
};

/**
 * Default bundled Effect & Modifier DSL overlay registry for SRD 5.1 ingestion.
 * Tier B/C high-level overlays are merged after the Tier A core overlays so
 * that high-tier coverage builds on the existing low-tier definitions.
 */
export const DEFAULT_SRD_OVERLAY_BUNDLE: SrdOverlayBundle = {
  races: SRD_RACE_OVERLAYS,
  subraces: SRD_SUBRACE_OVERLAYS,
  features: { ...SRD_FEATURE_OVERLAYS, ...SRD_HIGH_TIER_FEATURE_OVERLAYS },
  feats: SRD_FEAT_OVERLAYS,
  gear: SRD_GEAR_OVERLAYS,
  magicItems: SRD_MAGIC_ITEM_OVERLAYS,
  spells: { ...SRD_SPELL_OVERLAYS, ...SRD_HIGH_TIER_SPELL_OVERLAYS },
  monsters: { ...SRD_MONSTER_OVERLAYS, ...SRD_HIGH_TIER_MONSTER_OVERLAYS },
};
