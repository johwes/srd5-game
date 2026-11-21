import { z } from 'zod';
import { normalizeSeed, nextRandomFloat } from '../dice/prng.js';
import {
  partyCanUnderstand,
  type LanguageBearer,
  type PartyComprehensionResult,
} from '../language/comprehension.js';
import type { DerivedCharacterSheet } from '../character/schemas.js';
import {
  WarDiplomacyStateSchema,
  type WarDiplomacyState,
} from './war-threat.js';
import { RealmError } from './realm-error.js';

/**
 * SRD-1214 — War languages phase 1 (Spec 11 §2.4).
 *
 * Every war nation speaks a command tongue from the existing 18-language
 * list — no new languages, no ninth faction. Planar flavor (celestial /
 * infernal / abyssal / draconic assets) enters as officers, intercepts, and
 * loot, never as new nations.
 *
 * Phase 1 ships independently:
 * - **Nation language profiles**: 8 rows (`commandLanguage`,
 *   `liturgicalLanguage?`, `battleLanguage?`). Resolution reuses the §2.2
 *   party-level gate (`partyCanUnderstand`).
 * - **Dispatch intercepts**: patrols, couriers, and dead drops yield sealed
 *   orders (attack warnings, patrol routes, tribute schedules) as loot. Right
 *   tongue (or Comprehend/Tongues/translator) → read and act (ambush the
 *   ambush, evacuate the POI). Wrong tongue → sealed prop until translated.
 * - **Patrol interaction matrix**: evasion never gates on language. Bluff
 *   requires a shared tongue, magic, or interpreter — without it, gesture
 *   caps at pass-with-Threat, never clean. Bribe carries a small
 *   tourist-price surcharge without patter. Stealth/Survival evade and combat
 *   work exactly as today.
 * - **Deal tiers**: direct parley in their tongue `+2` and unlocks the top
 *   deal tier; via magic = baseline; via interpreter = baseline +
 *   gold-per-parley fee; gestures/broken Common `−2`, top tier locked.
 * - **Interpreter hirelings**: one War Room row (gold hire cost +
 *   per-parley fee). Compromise/double-agent behavior is a data hook only
 *   (deferred — never set in phase 1).
 *
 * All functions are pure and deterministic. Inputs are never mutated.
 */

// ---------------------------------------------------------------------------
// Nation language profiles (Spec 11 §2.4 table)
// ---------------------------------------------------------------------------

export interface WarNationLanguageProfile {
  /** War nation / archetype id (matches `WAR_NATION_ARCHETYPES` ids). */
  nationId: string;
  /** Primary command tongue (orders, patrol chatter, seals). */
  commandLanguage: string;
  /** Liturgical / writ tongue when the nation seals writs apart (e.g. Celestial). */
  liturgicalLanguage?: string;
  /** Battlefield tongue when callouts differ from orders (Ashen Draconic). */
  battleLanguage?: string;
  /** Design note (original lore, zero SRD Product Identity). */
  notes: string;
}

export const WAR_NATION_LANGUAGE_PROFILES: readonly WarNationLanguageProfile[] = [
  {
    nationId: 'bloodtusk-horde',
    commandLanguage: 'orc',
    notes: 'Orders, war-chants; broken Common for threats.',
  },
  {
    nationId: 'iron-covenant',
    commandLanguage: 'dwarvish',
    notes: 'Clan cant in mine/forge traffic.',
  },
  {
    nationId: 'emerald-circle',
    commandLanguage: 'elvish',
    liturgicalLanguage: 'sylvan',
    notes: 'Court speech is Elvish; rites unintelligible without Sylvan.',
  },
  {
    nationId: 'ashen-spire',
    commandLanguage: 'infernal',
    battleLanguage: 'draconic',
    notes: 'Orders naturally encrypted in Infernal; battle-cast callouts in Draconic.',
  },
  {
    nationId: 'dawn-crown',
    commandLanguage: 'common',
    liturgicalLanguage: 'celestial',
    notes: 'Common deliberately; Celestial seals on writs and shrine orders.',
  },
  {
    nationId: 'silver-bastion',
    commandLanguage: 'common',
    liturgicalLanguage: 'celestial',
    notes: 'Common deliberately; Celestial seals on writs and shrine orders.',
  },
  {
    nationId: 'gilded-league',
    commandLanguage: 'common',
    notes: 'Merchants speak everything — itself a tell.',
  },
  {
    nationId: 'frostbound-clan',
    commandLanguage: 'giant',
    notes: 'Saga-tongue among raiders; giant-kin auxiliaries.',
  },
];

const WAR_NATION_LANGUAGE_MAP: ReadonlyMap<string, WarNationLanguageProfile> = new Map(
  WAR_NATION_LANGUAGE_PROFILES.map((p) => [p.nationId, p]),
);

export function getWarNationLanguageProfile(nationId: string): WarNationLanguageProfile {
  const profile = WAR_NATION_LANGUAGE_MAP.get(nationId);
  if (!profile) throw new RealmError(`Unknown war nation '${nationId}' (no language profile)`);
  return profile;
}

/** Every tongue that opens a native parley with the nation (command + rite/battle). */
export function getWarNationAcceptedTongues(nationId: string): string[] {
  const profile = getWarNationLanguageProfile(nationId);
  const tongues = [profile.commandLanguage];
  if (profile.liturgicalLanguage) tongues.push(profile.liturgicalLanguage);
  if (profile.battleLanguage) tongues.push(profile.battleLanguage);
  return tongues;
}

// ---------------------------------------------------------------------------
// Party bearer helpers (Derived sheets → LanguageBearer)
// ---------------------------------------------------------------------------

export function sheetToLanguageBearer(sheet: DerivedCharacterSheet): LanguageBearer {
  const profs = (sheet as unknown as { proficiencies?: { languages?: readonly string[] } })
    .proficiencies;
  const activeEffects = (sheet as unknown as { activeEffects?: readonly { effectId: string }[] })
    .activeEffects;
  return {
    ...(profs?.languages ? { languages: profs.languages } : {}),
    ...(activeEffects ? { activeEffects } : {}),
  };
}

export function sheetsToLanguageBearers(party: readonly DerivedCharacterSheet[]): LanguageBearer[] {
  return party.map(sheetToLanguageBearer);
}

/**
 * True when at least one sheet carries explicit language data. Legacy /
 * minimal test fixtures without `proficiencies` fall back to the baseline
 * tier so pre-1214 behavior is preserved.
 */
export function hasPartyLanguageInfo(party: readonly DerivedCharacterSheet[]): boolean {
  return party.some(
    (sheet) =>
      (sheet as unknown as { proficiencies?: { languages?: unknown } }).proficiencies?.languages !==
      undefined,
  );
}

// ---------------------------------------------------------------------------
// Deal tiers (patrol bluff + truce/deal parley)
// ---------------------------------------------------------------------------

export const WAR_LANGUAGE_DEAL_TIERS = ['native', 'magic', 'interpreter', 'gesture'] as const;
export const WarLanguageDealTierSchema = z.enum(WAR_LANGUAGE_DEAL_TIERS);
export type WarLanguageDealTier = z.infer<typeof WarLanguageDealTierSchema>;

/** Direct parley in their tongue: +2. Gestures/broken Common: −2. */
export const WAR_TONGUE_NATIVE_BONUS = 2;
export const WAR_TONGUE_GESTURE_PENALTY = -2;

export interface WarLanguageDealTierResolution {
  tier: WarLanguageDealTier;
  /** How the gate opened (`none` when sealed behind gesture). */
  via: PartyComprehensionResult['via'];
  /** Check modifier: +2 native, 0 magic/interpreter, −2 gesture. */
  bonus: number;
  /** Gesture path locks the top deal tier (best tribute, longest truce). */
  topTierLocked: boolean;
  /** Per-parley interpreter fee (0 unless the interpreter path is used). */
  perParleyFee: number;
  /** Tongue(s) that open the native tier. */
  acceptedTongues: string[];
  headline: string;
}

export const ResolveWarLanguageDealTierOptionsSchema = z.object({
  nationId: z.string().min(1),
  party: z.array(z.any()).min(0).max(6),
  hasInterpreter: z.boolean().default(false),
});
export type ResolveWarLanguageDealTierOptions = z.input<
  typeof ResolveWarLanguageDealTierOptionsSchema
>;

/**
 * Resolves the Spec 11 §2.4 deal tier for a war parley (patrol bluff or
 * truce/deal negotiation) against the nation's command tongue(s).
 *
 * - Native speaker in the scene → `native` (+2, top tier unlocked).
 * - Comprehension magic (`comprehend-languages`/`tongues`) → `magic` (baseline).
 * - Retained interpreter → `interpreter` (baseline + per-parley fee).
 * - Otherwise → `gesture` (−2, top tier locked; patrol bluffs additionally
 *   cap at pass-with-Threat — enforced by the patrol resolver).
 *
 * Parties without explicit language data (legacy fixtures) resolve to the
 * baseline `magic`-equivalent tier so pre-1214 callers are unaffected; pass
 * real derived sheets to exercise the gate.
 */
export function resolveWarLanguageDealTier(
  rawOptions: ResolveWarLanguageDealTierOptions,
): WarLanguageDealTierResolution {
  const options = ResolveWarLanguageDealTierOptionsSchema.parse(rawOptions);
  const party = options.party as DerivedCharacterSheet[];
  const acceptedTongues = getWarNationAcceptedTongues(options.nationId);

  if (!hasPartyLanguageInfo(party)) {
    return {
      tier: 'magic',
      via: 'magic',
      bonus: 0,
      topTierLocked: false,
      perParleyFee: 0,
      acceptedTongues,
      headline: `No tongue manifest — baseline parley with ${options.nationId} (legacy sheets).`,
    };
  }

  const bearers = sheetsToLanguageBearers(party);
  for (const tongue of acceptedTongues) {
    const gate = partyCanUnderstand(tongue, bearers);
    if (gate.understood && gate.via === 'native') {
      return {
        tier: 'native',
        via: 'native',
        bonus: WAR_TONGUE_NATIVE_BONUS,
        topTierLocked: false,
        perParleyFee: 0,
        acceptedTongues,
        headline: `Direct parley in ${tongue} (+2) — top deal tier unlocked.`,
      };
    }
  }
  for (const tongue of acceptedTongues) {
    const gate = partyCanUnderstand(tongue, bearers);
    if (gate.understood && gate.via === 'magic') {
      return {
        tier: 'magic',
        via: 'magic',
        bonus: 0,
        topTierLocked: false,
        perParleyFee: 0,
        acceptedTongues,
        headline: `Comprehension magic carries the ${options.nationId} parley — baseline terms.`,
      };
    }
  }
  if (options.hasInterpreter) {
    return {
      tier: 'interpreter',
      via: 'none',
      bonus: 0,
      topTierLocked: false,
      perParleyFee: INTERPRETER_PER_PARLEY_FEE_GOLD,
      acceptedTongues,
      headline: `The retained interpreter carries the ${options.nationId} parley — baseline terms (+${INTERPRETER_PER_PARLEY_FEE_GOLD} gp per parley).`,
    };
  }
  return {
    tier: 'gesture',
    via: 'none',
    bonus: WAR_TONGUE_GESTURE_PENALTY,
    topTierLocked: true,
    perParleyFee: 0,
    acceptedTongues,
    headline: `No shared tongue with ${options.nationId} — gestures and broken Common (−2, top tier locked).`,
  };
}

// ---------------------------------------------------------------------------
// Interpreter hirelings (one War Room row; double-agent hook deferred)
// ---------------------------------------------------------------------------

/** One-time retainer for the party linguist (covers every war command tongue). */
export const INTERPRETER_HIRE_COST_GOLD = 100;
/** Per-parley fee when the interpreter carries a bluff or negotiation. */
export const INTERPRETER_PER_PARLEY_FEE_GOLD = 10;

export const HireInterpreterOptionsSchema = z.object({
  diplomacy: z.any(),
  goldAvailable: z.number().int().min(0),
  rngState: z.number().int().default(0),
  day: z.number().int().min(1).optional(),
});
export type HireInterpreterOptions = z.input<typeof HireInterpreterOptionsSchema>;

export interface HiredInterpreter {
  diplomacy: WarDiplomacyState;
  success: boolean;
  cost: number;
  goldSpent: number;
  remainingGold: number;
  headline: string;
  nextRngState: number;
}

/**
 * Retains the party interpreter (War Room row): `100 gp` secures a linguist
 * covering every war command tongue; each subsequent bluff/truce carried by
 * the interpreter costs `10 gp` per parley (charged by the patrol/truce
 * resolvers, success-only like tribute). Hiring twice is rejected; an empty
 * war chest is turned away without touching diplomacy.
 */
export function hireInterpreter(rawOptions: HireInterpreterOptions): HiredInterpreter {
  const options = HireInterpreterOptionsSchema.parse(rawOptions);
  const diplomacy = WarDiplomacyStateSchema.parse(options.diplomacy) as WarDiplomacyState;
  const rngState = normalizeSeed(options.rngState);
  if (diplomacy.interpreterHired) {
    throw new RealmError('The party has already retained an interpreter');
  }
  const cost = INTERPRETER_HIRE_COST_GOLD;
  if (options.goldAvailable < cost) {
    return {
      diplomacy,
      success: false,
      cost,
      goldSpent: 0,
      remainingGold: options.goldAvailable,
      headline: `The linguist demands ${cost}gp — the war chest holds ${options.goldAvailable}gp. No interpreter.`,
      nextRngState: rngState,
    };
  }
  const next: WarDiplomacyState = { ...structuredClone(diplomacy), interpreterHired: true };
  return {
    diplomacy: WarDiplomacyStateSchema.parse(next),
    success: true,
    cost,
    goldSpent: cost,
    remainingGold: options.goldAvailable - cost,
    headline: `A polyglot linguist joins the column for ${cost}gp (+${INTERPRETER_PER_PARLEY_FEE_GOLD}gp per carried parley).`,
    nextRngState: rngState,
  };
}

// ---------------------------------------------------------------------------
// Dispatch intercepts (sealed orders as loot)
// ---------------------------------------------------------------------------

export const DISPATCH_INTERCEPT_KINDS = ['attack_warning', 'patrol_route', 'tribute_schedule'] as const;
export const DispatchInterceptKindSchema = z.enum(DISPATCH_INTERCEPT_KINDS);
export type DispatchInterceptKind = z.infer<typeof DispatchInterceptKindSchema>;

export const DispatchInterceptSchema = z.object({
  id: z.string().min(1),
  /** Nation whose seal the orders carry (the observed enemy). */
  nationId: z.string().min(1),
  kind: DispatchInterceptKindSchema,
  /** Tongue the orders are sealed in (command tongue; writs in liturgical). */
  language: z.string().min(1),
  /** What the sealed packet appears to be before translation. */
  sealedNote: z.string().min(1),
  /** Actionable content revealed on a successful read. */
  revealedNote: z.string().min(1),
  /** Machine-readable benefit the host can act on (evacuate/ambush/etc.). */
  suggestedAction: z.string().min(1),
});
export type DispatchIntercept = z.infer<typeof DispatchInterceptSchema>;

/** Chance a killed/cleared patrol drops sealed orders. */
export const DISPATCH_INTERCEPT_DROP_CHANCE = 0.35;

function interceptNotes(
  nationId: string,
  kind: DispatchInterceptKind,
): { sealedNote: string; revealedNote: string; suggestedAction: string } {
  switch (kind) {
    case 'attack_warning':
      return {
        sealedNote: `Sealed ${nationId} orders — wax seal unbroken.`,
        revealedNote: `${nationId} columns march within 6 days — evacuate the POI or ambush the ambush.`,
        suggestedAction: 'evacuate_poi_or_ambush',
      };
    case 'patrol_route':
      return {
        sealedNote: `Sealed ${nationId} patrol routes — courier satchel.`,
        revealedNote: `${nationId} patrol rotations mapped — slip the cordon at dawn (+evasion) or bleed Threat by lying low.`,
        suggestedAction: 'evade_with_advantage_or_cool_threat',
      };
    case 'tribute_schedule':
      return {
        sealedNote: `Sealed ${nationId} tribute schedule — ledger cipher.`,
        revealedNote: `${nationId} tribute convoy schedule decoded — intercept the convoy or undercut the tribute.`,
        suggestedAction: 'intercept_convoy_or_undercut_tribute',
      };
  }
}

export const GenerateDispatchInterceptOptionsSchema = z.object({
  nationId: z.string().min(1),
  kind: DispatchInterceptKindSchema.optional(),
  rngState: z.number().int().default(0),
});
export type GenerateDispatchInterceptOptions = z.input<typeof GenerateDispatchInterceptOptionsSchema>;

/**
 * Generates one sealed dispatch intercept for a nation. The sealing tongue
 * is the command tongue — except tribute writs from liturgical nations,
 * which carry the liturgical seal (Celestial writs, Sylvan rites). Kind is
 * rolled deterministically when omitted.
 */
export function generateDispatchIntercept(
  rawOptions: GenerateDispatchInterceptOptions,
): { intercept: DispatchIntercept; nextRngState: number } {
  const options = GenerateDispatchInterceptOptionsSchema.parse(rawOptions);
  const profile = getWarNationLanguageProfile(options.nationId);
  let rngState = normalizeSeed(options.rngState);
  let kind = options.kind;
  if (!kind) {
    const draw = nextRandomFloat(rngState);
    rngState = draw.nextState;
    kind = DISPATCH_INTERCEPT_KINDS[Math.floor(draw.value * DISPATCH_INTERCEPT_KINDS.length)]!;
  }
  const language =
    kind === 'tribute_schedule' && profile.liturgicalLanguage
      ? profile.liturgicalLanguage
      : profile.commandLanguage;
  const notes = interceptNotes(options.nationId, kind);
  const intercept = DispatchInterceptSchema.parse({
    id: `dispatch_${options.nationId}_${kind}_${rngState}`,
    nationId: options.nationId,
    kind,
    language,
    sealedNote: notes.sealedNote,
    revealedNote: notes.revealedNote,
    suggestedAction: notes.suggestedAction,
  });
  return { intercept, nextRngState: rngState };
}

export const RollDispatchInterceptDropOptionsSchema = z.object({
  nationId: z.string().min(1),
  rngState: z.number().int().default(0),
});
export type RollDispatchInterceptDropOptions = z.input<typeof RollDispatchInterceptDropOptionsSchema>;

/**
 * Rolls whether a patrol/courier/dead-drop yields sealed orders (`35%`).
 * Deterministic from the seeded PRNG; the dropped intercept is generated
 * from the post-roll state so replays stay bit-exact.
 */
export function rollDispatchInterceptDrop(
  rawOptions: RollDispatchInterceptDropOptions,
): { dropped: boolean; intercept: DispatchIntercept | null; nextRngState: number } {
  const options = RollDispatchInterceptDropOptionsSchema.parse(rawOptions);
  getWarNationLanguageProfile(options.nationId);
  let rngState = normalizeSeed(options.rngState);
  const draw = nextRandomFloat(rngState);
  rngState = draw.nextState;
  if (draw.value >= DISPATCH_INTERCEPT_DROP_CHANCE) {
    return { dropped: false, intercept: null, nextRngState: rngState };
  }
  const generated = generateDispatchIntercept({ nationId: options.nationId, rngState });
  return { dropped: true, intercept: generated.intercept, nextRngState: generated.nextRngState };
}

export const TryReadDispatchInterceptOptionsSchema = z.object({
  intercept: DispatchInterceptSchema,
  party: z.array(z.any()).min(0).max(6),
  hasInterpreter: z.boolean().default(false),
});
export type TryReadDispatchInterceptOptions = z.input<typeof TryReadDispatchInterceptOptionsSchema>;

export interface ReadDispatchInterceptResult {
  readable: boolean;
  /** How the seal opened (`sealed` when the tongue is still missing). */
  via: 'native' | 'magic' | 'interpreter' | 'sealed';
  headline: string;
  /** Present only when readable (the actionable orders). */
  revealedNote: string | null;
  suggestedAction: string | null;
}

/**
 * Attempts to read sealed orders through the party-level gate. Right tongue
 * (or Comprehend/Tongues/translator) → read and act; wrong tongue → the
 * sealed prop stays sealed in inventory until translated (never consumed).
 */
export function tryReadDispatchIntercept(
  rawOptions: TryReadDispatchInterceptOptions,
): ReadDispatchInterceptResult {
  const options = TryReadDispatchInterceptOptionsSchema.parse(rawOptions);
  const intercept = DispatchInterceptSchema.parse(options.intercept);
  const party = options.party as DerivedCharacterSheet[];
  const gate = partyCanUnderstand(intercept.language, sheetsToLanguageBearers(party));
  if (gate.understood && gate.via === 'native') {
    return {
      readable: true,
      via: 'native',
      headline: `The ${intercept.language} orders lie open — ${intercept.revealedNote}`,
      revealedNote: intercept.revealedNote,
      suggestedAction: intercept.suggestedAction,
    };
  }
  if (gate.understood && gate.via === 'magic') {
    return {
      readable: true,
      via: 'magic',
      headline: `Comprehension magic renders the ${intercept.language} orders plain — ${intercept.revealedNote}`,
      revealedNote: intercept.revealedNote,
      suggestedAction: intercept.suggestedAction,
    };
  }
  if (options.hasInterpreter) {
    return {
      readable: true,
      via: 'interpreter',
      headline: `The interpreter renders the ${intercept.language} orders plain — ${intercept.revealedNote}`,
      revealedNote: intercept.revealedNote,
      suggestedAction: intercept.suggestedAction,
    };
  }
  return {
    readable: false,
    via: 'sealed',
    headline: `${intercept.sealedNote} None of the party reads ${intercept.language} — sealed until translated.`,
    revealedNote: null,
    suggestedAction: null,
  };
}
