import { z } from 'zod';
import {
  bearerCanUnderstand,
  hasComprehensionMagic,
  isBearerConscious,
  partyCanUnderstand,
  speaksLanguage,
  TONGUES_BUFF_ID,
  type LanguageBearer,
  type PartyComprehensionResult,
} from './comprehension.js';

/**
 * SRD-1202: Language-gated encounters (Spec 11 §2.2) + Orc-tribe reference
 * quest (Spec 11 §2.3).
 *
 * Resolution is party-level: if any conscious party member in the scene
 * speaks the required tongue — or is under `comprehend-languages` /
 * `tongues` — the gate opens. Otherwise the caller maps the closed gate to
 * its declared `fallback`, which never soft-locks (gesture trade, bribe,
 * stealth, or combat always remain).
 */

// ---------------------------------------------------------------------------
// Generic language gate spec
// ---------------------------------------------------------------------------

export const LANGUAGE_GATE_FALLBACKS = ['gesture', 'hostile', 'fetch_translator'] as const;
export const LanguageGateFallbackSchema = z.enum(LANGUAGE_GATE_FALLBACKS);
export type LanguageGateFallback = z.infer<typeof LanguageGateFallbackSchema>;

export const LanguageGateSpecSchema = z.object({
  requiredLanguage: z.string().min(1),
  fallback: LanguageGateFallbackSchema,
});
export type LanguageGateSpec = z.infer<typeof LanguageGateSpecSchema>;

export interface LanguageGateResolution {
  /** True when a conscious party member speaks the tongue or holds magic. */
  opened: boolean;
  /** How the gate opened (`none` when closed). */
  via: PartyComprehensionResult['via'];
  /** Index of the party member that opened the gate (-1 when closed). */
  understoodByIndex: number;
  /** Declared fallback to play when closed (undefined when opened). */
  fallback: LanguageGateFallback | undefined;
  /** Intent cues the DM layer surfaces when the gate is closed. */
  intentCue: LanguageBarrierIntentCue;
}

export interface LanguageBarrierIntentCue {
  /** Counterparty attitude readable without words (Insight-readable). */
  attitude: 'friendly' | 'neutral' | 'unfriendly' | 'hostile';
  /** Non-verbal cues (posture, gestures, demands) — never a soft-lock. */
  cues: string[];
  /** Verbs that always remain available behind the barrier. */
  alwaysAvailable: Array<'gesture_trade' | 'bribe' | 'stealth' | 'combat' | 'fetch_translator'>;
}

const FALLBACK_CUES: Record<LanguageGateFallback, LanguageBarrierIntentCue> = {
  gesture: {
    attitude: 'neutral',
    cues: ['intent-only gestures', 'attitude readable via Insight', 'trade at penalty'],
    alwaysAvailable: ['gesture_trade', 'bribe', 'stealth', 'combat'],
  },
  hostile: {
    attitude: 'unfriendly',
    cues: ['guards raise weapons', 'demands readable via Insight', 'parley refused'],
    alwaysAvailable: ['bribe', 'stealth', 'combat'],
  },
  fetch_translator: {
    attitude: 'neutral',
    cues: ['clerks point at a sealed writ', 'quest redirects to a translator NPC'],
    alwaysAvailable: ['fetch_translator', 'bribe', 'stealth', 'combat'],
  },
};

/** Intent cues for a closed gate (attitude + non-verbal reads, never a block). */
export function getLanguageBarrierIntentCue(fallback: LanguageGateFallback): LanguageBarrierIntentCue {
  const cue = FALLBACK_CUES[fallback];
  return { attitude: cue.attitude, cues: [...cue.cues], alwaysAvailable: [...cue.alwaysAvailable] };
}

/**
 * Resolves a language gate against a conscious party. Validates the spec,
 * never throws on a closed gate — the fallback carries the next verb.
 */
export function resolveLanguageGate(
  rawSpec: LanguageGateSpec,
  party: readonly LanguageBearer[],
): LanguageGateResolution {
  const spec = LanguageGateSpecSchema.parse(rawSpec);
  const gate = partyCanUnderstand(spec.requiredLanguage, party);
  if (gate.understood) {
    return {
      opened: true,
      via: gate.via,
      understoodByIndex: gate.understoodByIndex,
      fallback: undefined,
      intentCue: { attitude: 'friendly', cues: ['full dialogue available'], alwaysAvailable: [] },
    };
  }
  return {
    opened: false,
    via: 'none',
    understoodByIndex: -1,
    fallback: spec.fallback,
    intentCue: getLanguageBarrierIntentCue(spec.fallback),
  };
}

// ---------------------------------------------------------------------------
// Shared-language precondition for language-dependent enchantments (Spec 11 §2.2)
// ---------------------------------------------------------------------------

/** SRD enchantments that require the target to understand the caster. */
export const LANGUAGE_DEPENDENT_ENCHANTMENT_IDS = [
  'command',
  'suggestion',
  'charm-person',
  'hideous-laughter',
  'vicious-mockery',
  'divine-word',
] as const;

export type LanguageDependentEnchantmentId = (typeof LANGUAGE_DEPENDENT_ENCHANTMENT_IDS)[number];

const LANGUAGE_DEPENDENT_SET: ReadonlySet<string> = new Set(LANGUAGE_DEPENDENT_ENCHANTMENT_IDS);

/** True when the spell id carries the SRD shared-language precondition. */
export function requiresSharedLanguage(spellId: string): boolean {
  return LANGUAGE_DEPENDENT_SET.has(spellId.trim().toLowerCase());
}

function normalizeLanguages(languages: readonly string[] | undefined): string[] {
  return (languages ?? []).map((l) => l.trim().toLowerCase()).filter(Boolean);
}

function bearerHasTongues(bearer: LanguageBearer): boolean {
  return (bearer.activeEffects ?? []).some((e) => e.effectId === TONGUES_BUFF_ID);
}

/**
 * SRD shared-language check for enchantments: the target must be able to
 * understand the caster *before* any save is rolled.
 *
 * Understood when:
 * - caster and target share at least one spoken language, OR
 * - the caster speaks via `tongues` (understood by any listener), OR
 * - the target holds comprehension magic (`comprehend-languages`/`tongues`).
 *
 * Note the asymmetry is deliberate: `comprehend-languages` on the *caster*
 * lets the caster understand the target, but does not make the caster
 * understood — so it never satisfies this direction.
 */
export function casterCanBeUnderstoodByTarget(
  caster: LanguageBearer,
  target: LanguageBearer,
): boolean {
  if (!isBearerConscious(caster) || !isBearerConscious(target)) return false;
  if (bearerHasTongues(caster)) return true;
  const casterTongues = new Set(normalizeLanguages(caster.languages));
  const targetTongues = normalizeLanguages(target.languages);
  if (targetTongues.some((l) => casterTongues.has(l))) return true;
  // Target-side magic lets the listener follow the caster.
  if (hasComprehensionMagic(target)) return true;
  return false;
}

/**
 * Convenience wrapper: `false` for spells without the precondition, so
 * call sites only branch on the six gated enchantments.
 */
export function isTargetUnaffectedByLanguage(
  spellId: string,
  caster: LanguageBearer,
  target: LanguageBearer,
): boolean {
  if (!requiresSharedLanguage(spellId)) return false;
  return !casterCanBeUnderstoodByTarget(caster, target);
}

/** Single-bearer variant kept for symmetry with comprehension.ts. */
export function bearerUnderstandsCaster(caster: LanguageBearer, listener: LanguageBearer): boolean {
  return casterCanBeUnderstoodByTarget(caster, listener);
}

export { bearerCanUnderstand, speaksLanguage };

// ---------------------------------------------------------------------------
// Reference quest: Local Orc Tribe parley (Spec 11 §2.3)
// ---------------------------------------------------------------------------

/** Command tongue of the Local Orc Tribe (existing language id, no new data). */
export const ORC_TRIBE_LANGUAGE = 'orc' as const;

export const ORC_TRIBE_GATE_SPEC: LanguageGateSpec = {
  requiredLanguage: ORC_TRIBE_LANGUAGE,
  fallback: 'gesture',
};

/** Gesture-path trade surcharge applied without a shared tongue. */
export const ORC_GESTURE_TRADE_PENALTY_GOLD = 25;
/** Gesture-path Persuasion/Intimidation DC modifier (harder without words). */
export const ORC_GESTURE_CHECK_DC_MODIFIER = 2;

export type OrcTribeParleyMode = 'full' | 'gesture';

export interface OrcTribeParleyOptions {
  /** Party members present for the parley (consciousness-aware). */
  party: readonly LanguageBearer[];
  /**
   * History check passed (DC 15): unlocks the treaty/insult leverage.
   * Only meaningful on the `full` path — gesture parleys cannot present it.
   */
  historyCheckPassed?: boolean;
  /** Base tribute asked by the tribe before penalties. */
  baseTributeGold?: number;
}

export interface OrcTribeParleyResolution {
  mode: OrcTribeParleyMode;
  /** Gate path that produced the mode (`native` speaker or `magic`). */
  via: PartyComprehensionResult['via'];
  understoodByIndex: number;
  /** Full negotiation with History leverage available. */
  fullNegotiation: boolean;
  /** History leverage applies (full path + passed check). */
  historyUnlocked: boolean;
  /** Social skills that can resolve the parley on this path. */
  allowedSkills: Array<'persuasion' | 'intimidation'>;
  /** Gesture-path surcharge (0 on the full path). */
  tradePenaltyGold: number;
  /** Total tribute asked on this path. */
  tributeGold: number;
  /** Intent cues shown when negotiating by gesture. */
  intentCue: LanguageBarrierIntentCue;
  headline: string;
}

const ORC_TRIBE_HISTORY_DC = 15;
export { ORC_TRIBE_HISTORY_DC };

/**
 * Resolves the Local Orc Tribe parley through the party-level language gate.
 *
 * - Orcish speaker (or `comprehend-languages`/`tongues`) → full negotiation;
 *   a passed History (DC 15) check unlocks treaty/insult leverage.
 * - Otherwise → gesture/intent path: trade at a fixed gold penalty, and only
 *   Persuasion/Intimidation alternatives (never a soft-lock — stealth and
 *   combat remain via the intent cue).
 *
 * The alliance itself still seals through `completeSubFactionQuest()` exactly
 * as today; this function only grades *how* the table gets there.
 */
export function resolveOrcTribeParley(options: OrcTribeParleyOptions): OrcTribeParleyResolution {
  const party = options.party ?? [];
  const baseTributeGold = options.baseTributeGold ?? 100;
  const historyCheckPassed = options.historyCheckPassed ?? false;
  const gate = partyCanUnderstand(ORC_TRIBE_LANGUAGE, party);

  if (gate.understood) {
    const historyUnlocked = historyCheckPassed;
    return {
      mode: 'full',
      via: gate.via,
      understoodByIndex: gate.understoodByIndex,
      fullNegotiation: true,
      historyUnlocked,
      allowedSkills: ['persuasion', 'intimidation'],
      tradePenaltyGold: 0,
      tributeGold: baseTributeGold,
      intentCue: { attitude: 'friendly', cues: ['full negotiation available'], alwaysAvailable: [] },
      headline:
        gate.via === 'native'
          ? 'The warchief hears your Orcish and waves you to the fire — full parley.'
          : 'Your comprehension magic renders the warchief\u2019s Orcish plain — full parley.',
    };
  }

  return {
    mode: 'gesture',
    via: 'none',
    understoodByIndex: -1,
    fullNegotiation: false,
    historyUnlocked: false,
    allowedSkills: ['persuasion', 'intimidation'],
    tradePenaltyGold: ORC_GESTURE_TRADE_PENALTY_GOLD,
    tributeGold: baseTributeGold + ORC_GESTURE_TRADE_PENALTY_GOLD,
    intentCue: getLanguageBarrierIntentCue('gesture'),
    headline:
      'No shared tongue — the parley proceeds by gesture and Insight reads (trade at penalty).',
  };
}
