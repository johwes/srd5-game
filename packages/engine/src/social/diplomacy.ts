import { z } from 'zod';
import { normalizeSeed, rollDie } from '../dice/prng.js';
import { rollD20 } from '../dice/evaluator.js';
import type { DerivedCharacterSheet } from '../character/schemas.js';
import { bestBonusOf } from '../overworld/war-negotiation-utils.js';
import { INSIGHT_CUE_TEXT } from './contests.js';

/**
 * SRD-1209: Diplomacy template — History unlocks → Insight reads →
 * triple-approach resolve, fail-forward (Spec 11 §5).
 *
 * Reference flow for tribe / envoy / truce missions (extends Spec 10 §5–6
 * approach dialogue and the SRD-1202 Orc-tribe parley):
 *
 * 1. **History unlocks** the engagement (treaty knowledge, insult to avoid,
 *    artifact leverage). Best party History vs `historyDc`; success lowers
 *    the final DC by `HISTORY_DC_RELIEF` and unlocks the top `alliance`
 *    tier on the persuasion path.
 * 2. **Insight reads** the room (opposed vs Deception; passive as floor).
 *    Best party Insight passive meeting the speaker's Deception total always
 *    surfaces the "something feels off" cue; an active Insight roll that
 *    meets it grants `INSIGHT_READ_BONUS` on the final check.
 * 3. **Persuasion / Deception / Intimidation resolve** with distinct
 *    outcomes: alliance + fair terms / trick + later fallout / compliance +
 *    attitude cost.
 * 4. **Fail-forward**: failure degrades the deal (tribute, short ceasefire,
 *    Threat) — never a dead end. `progresses` is always `true`.
 *
 * Pure + deterministic: every roll threads the seeded Mulberry32 PRNG.
 * Inputs are never mutated. Operates on `DerivedCharacterSheet[]` like the
 * SRD-1104 war negotiators (no `GameState` needed).
 */

// ---------------------------------------------------------------------------
// Encounter kinds & approaches
// ---------------------------------------------------------------------------

export const DIPLOMACY_ENCOUNTER_KINDS = ['tribe', 'envoy', 'truce'] as const;
export const DiplomacyEncounterKindSchema = z.enum(DIPLOMACY_ENCOUNTER_KINDS);
export type DiplomacyEncounterKind = z.infer<typeof DiplomacyEncounterKindSchema>;

export const DIPLOMACY_APPROACHES = ['persuasion', 'deception', 'intimidation'] as const;
export const DiplomacyApproachSchema = z.enum(DIPLOMACY_APPROACHES);
export type DiplomacyApproach = z.infer<typeof DiplomacyApproachSchema>;

export const DIPLOMACY_OUTCOMES = [
  'alliance',
  'fair_terms',
  'trick',
  'compliance',
  'degraded',
  'backlash',
] as const;
export const DiplomacyOutcomeSchema = z.enum(DIPLOMACY_OUTCOMES);
export type DiplomacyOutcome = z.infer<typeof DiplomacyOutcomeSchema>;

/** History success lowers the final DC by this much (treaty leverage). */
export const HISTORY_DC_RELIEF = 2;
/** Active Insight read success grants this bonus on the final check. */
export const INSIGHT_READ_BONUS = 2;
/** Gesture-path / no-shared-tongue penalty (matches the SRD-1202 Orc gate). */
export const DIPLOMACY_GESTURE_DC_PENALTY = 2;
/** Miss margin (or natural 1) that escalates failure → backlash. */
export const DIPLOMACY_BACKLASH_MARGIN = 5;

/** Fail-forward truce lengths: full parley rolls 1d7+11 (12–18 days). */
export const TRUCE_FULL_MIN_DAYS = 12;
export const TRUCE_FULL_SPREAD = 7;
/** Failed parleys still cool the war: degraded 3 days, backlash 1 day. */
export const TRUCE_DEGRADED_DAYS = 3;
export const TRUCE_BACKLASH_DAYS = 1;

/** Per-kind table stakes (Spec 11 §5 + Spec 10 §6 norms). */
export const DIPLOMACY_DEFAULTS: Record<
  DiplomacyEncounterKind,
  { baseDc: number; historyDc: number; speakerDeceptionTotal: number; baseTributeGold: number }
> = {
  tribe: { baseDc: 13, historyDc: 15, speakerDeceptionTotal: 12, baseTributeGold: 100 },
  envoy: { baseDc: 14, historyDc: 13, speakerDeceptionTotal: 14, baseTributeGold: 100 },
  truce: { baseDc: 14, historyDc: 12, speakerDeceptionTotal: 13, baseTributeGold: 100 },
};

export const ResolveDiplomaticParleyOptionsSchema = z.object({
  encounterKind: DiplomacyEncounterKindSchema,
  /** Counterparty label for headlines (e.g. nation or tribe name). */
  counterparty: z.string().min(1).default('the counterparty'),
  party: z.array(z.any()).min(1).max(6),
  approach: DiplomacyApproachSchema,
  rngState: z.number().int().default(0),
  baseDc: z.number().int().min(1).max(30).optional(),
  historyDc: z.number().int().min(1).max(30).optional(),
  /** Opposed Insight target; the speaker's Deception total. */
  speakerDeceptionTotal: z.number().int().min(1).max(40).optional(),
  /** Extra DC modifier (e.g. +2 gesture-path penalty without a shared tongue). */
  dcModifier: z.number().int().min(-10).max(10).default(0),
  /** Tribute on the table (spent/owed per the outcome below). */
  baseTributeGold: z.number().int().min(0).default(100),
  /**
   * SRD-1214: gesture path locks the top deal tier — a persuasion parley
   * that would close as `alliance` degrades to `fair_terms`. Native, magic,
   * and interpreter paths leave the top tier unlocked.
   */
  topTierLocked: z.boolean().default(false),
});
export type ResolveDiplomaticParleyOptions = z.input<typeof ResolveDiplomaticParleyOptionsSchema>;

export interface DiplomaticParleyHistoryStage {
  actorId: string;
  actorName: string;
  bonus: number;
  dc: number;
  naturalRoll: number;
  total: number;
  unlocked: boolean;
  dcRelief: number;
}

export interface DiplomaticParleyInsightStage {
  actorId: string;
  actorName: string;
  bonus: number;
  passive: number;
  speakerTotal: number;
  passiveBeatsLie: boolean;
  cue?: string;
  naturalRoll: number;
  total: number;
  readSuccess: boolean;
  readBonus: number;
}

export interface ResolvedDiplomaticParley {
  encounterKind: DiplomacyEncounterKind;
  counterparty: string;
  approach: DiplomacyApproach;
  outcome: DiplomacyOutcome;
  /** Fail-forward: the table always moves forward, never dead-ends. */
  success: boolean;
  progresses: true;
  history: DiplomaticParleyHistoryStage;
  insight: DiplomaticParleyInsightStage;
  actorId: string;
  actorName: string;
  bonus: number;
  dc: number;
  naturalRoll: number;
  total: number;
  /** Truce/ceasefire length in days (0 for non-truce kinds). */
  durationDays: number;
  /** Gold the deal costs on this outcome (0 when the house wins clean). */
  tributeDue: number;
  /** Attitude cost (intimidation compliance) / fallout (deception trick). */
  attitudeCost: boolean;
  fallout: boolean;
  /** Threat nudge for the war ledger (intimidation +5, backlash +5). */
  threatDelta: number;
  headline: string;
  nextRngState: number;
}

/**
 * Resolves one diplomatic parley through the full Spec 11 §5 template.
 * Never throws on a failed check — failure degrades the deal (tribute,
 * short ceasefire, Threat) instead of blocking progression.
 */
export function resolveDiplomaticParley(
  rawOptions: ResolveDiplomaticParleyOptions,
): ResolvedDiplomaticParley {
  const options = ResolveDiplomaticParleyOptionsSchema.parse(rawOptions);
  const party = options.party as DerivedCharacterSheet[];
  const defaults = DIPLOMACY_DEFAULTS[options.encounterKind];
  const historyDc = options.historyDc ?? defaults.historyDc;
  const speakerTotal = options.speakerDeceptionTotal ?? defaults.speakerDeceptionTotal;
  let rngState = normalizeSeed(options.rngState);

  // Stage 1 — History unlocks the engagement.
  const historyBest = bestBonusOf(party, 'history');
  const historyRoll = rollD20(rngState, { modifier: historyBest.bonus });
  rngState = historyRoll.nextState;
  const historyUnlocked = historyRoll.total >= historyDc;
  const historyDcRelief = historyUnlocked ? HISTORY_DC_RELIEF : 0;
  const history: DiplomaticParleyHistoryStage = {
    actorId: historyBest.sheet.id,
    actorName: historyBest.sheet.name,
    bonus: historyBest.bonus,
    dc: historyDc,
    naturalRoll: historyRoll.naturalRoll,
    total: historyRoll.total,
    unlocked: historyUnlocked,
    dcRelief: historyDcRelief,
  };

  // Stage 2 — Insight reads the room (passive floor + active opposed read).
  const insightBest = bestBonusOf(party, 'insight');
  const insightSkills = insightBest.sheet.skills as unknown as
    | Record<string, { totalBonus?: number; passiveScore?: number } | undefined>
    | undefined;
  const insightEntry = insightSkills?.['insight'];
  const insightPassive =
    typeof insightEntry?.passiveScore === 'number'
      ? insightEntry.passiveScore
      : 10 + insightBest.bonus;
  const passiveBeatsLie = insightPassive >= speakerTotal;
  const cue = passiveBeatsLie
    ? `${insightBest.sheet.name} senses ${INSIGHT_CUE_TEXT} about ${options.counterparty}'s words.`
    : undefined;
  const insightRoll = rollD20(rngState, { modifier: insightBest.bonus });
  rngState = insightRoll.nextState;
  const readSuccess = insightRoll.total >= speakerTotal;
  const insight: DiplomaticParleyInsightStage = {
    actorId: insightBest.sheet.id,
    actorName: insightBest.sheet.name,
    bonus: insightBest.bonus,
    passive: insightPassive,
    speakerTotal,
    passiveBeatsLie,
    ...(cue ? { cue } : {}),
    naturalRoll: insightRoll.naturalRoll,
    total: insightRoll.total,
    readSuccess,
    readBonus: readSuccess ? INSIGHT_READ_BONUS : 0,
  };

  // Stage 3 — triple-approach resolve with distinct outcomes.
  const approachBest = bestBonusOf(party, options.approach);
  const baseDc = options.baseDc ?? defaults.baseDc;
  const dc = Math.max(5, baseDc - historyDcRelief + options.dcModifier);
  const finalBonus = approachBest.bonus + insight.readBonus;
  const finalRoll = rollD20(rngState, { modifier: finalBonus });
  rngState = finalRoll.nextState;
  const success = finalRoll.total >= dc;
  const backlash =
    !success &&
    (finalRoll.naturalRoll === 1 || finalRoll.total <= dc - DIPLOMACY_BACKLASH_MARGIN);

  let outcome: DiplomacyOutcome;
  if (success) {
    if (options.approach === 'persuasion') {
      // SRD-1214: gesture path locks the top deal tier.
      outcome = historyUnlocked && !options.topTierLocked ? 'alliance' : 'fair_terms';
    } else if (options.approach === 'deception') {
      outcome = 'trick';
    } else {
      outcome = 'compliance';
    }
  } else {
    outcome = backlash ? 'backlash' : 'degraded';
  }

  // Fail-forward consequences (never a dead end).
  const baseTribute = options.baseTributeGold;
  let durationDays = 0;
  let tributeDue = 0;
  let threatDelta = 0;
  let attitudeCost = false;
  let fallout = false;

  if (options.encounterKind === 'truce') {
    if (success) {
      const durationRoll = rollDie(rngState, TRUCE_FULL_SPREAD);
      rngState = durationRoll.nextState;
      durationDays = durationRoll.roll + (TRUCE_FULL_MIN_DAYS - 1);
    } else if (outcome === 'degraded') {
      durationDays = TRUCE_DEGRADED_DAYS;
    } else {
      durationDays = TRUCE_BACKLASH_DAYS;
    }
  }

  if (outcome === 'alliance' || outcome === 'fair_terms') {
    tributeDue = 0;
  } else if (outcome === 'trick') {
    // The lie lands today; the reckoning comes later.
    tributeDue = 0;
    fallout = true;
  } else if (outcome === 'compliance') {
    // Fear works — and is remembered.
    tributeDue = 0;
    attitudeCost = true;
    threatDelta = 5;
  } else if (outcome === 'degraded') {
    tributeDue = baseTribute;
    if (options.encounterKind === 'truce') tributeDue = 0;
  } else {
    tributeDue = baseTribute + 50;
    if (options.encounterKind === 'truce') tributeDue = Math.ceil(baseTribute / 2);
    threatDelta = 5;
  }

  const historyNote = historyUnlocked
    ? ` History leverage lands (${history.total} vs DC ${historyDc}).`
    : ` No leverage (${history.total} vs DC ${historyDc}).`;
  const readNote = readSuccess
    ? ` The read lands (${insight.total} vs ${speakerTotal}).`
    : passiveBeatsLie
      ? ` The read misses (${insight.total} vs ${speakerTotal}), but the room still feels off.`
      : ` The read misses (${insight.total} vs ${speakerTotal}).`;

  let headline: string;
  switch (outcome) {
    case 'alliance':
      headline =
        options.encounterKind === 'truce'
          ? `${approachBest.sheet.name} seals a ${durationDays}-day ${options.counterparty} truce in fair terms (${finalRoll.total} vs DC ${dc}).${historyNote}${readNote}`
          : `${approachBest.sheet.name} wins ${options.counterparty} over outright — alliance on fair terms (${finalRoll.total} vs DC ${dc}).${historyNote}${readNote}`;
      break;
    case 'fair_terms':
      headline =
        options.encounterKind === 'truce'
          ? `${approachBest.sheet.name} seals a ${durationDays}-day ${options.counterparty} truce (${finalRoll.total} vs DC ${dc}).${historyNote}${readNote}`
          : `${approachBest.sheet.name} closes ${options.counterparty} on fair terms (${finalRoll.total} vs DC ${dc}).${historyNote}${readNote}`;
      break;
    case 'trick':
      headline = `${approachBest.sheet.name}'s deception carries the ${options.counterparty} parley (${finalRoll.total} vs DC ${dc}) — but the lie will keep (${historyNote.trim()}${readNote.trim() ? ` ${readNote.trim()}` : ''} Fallout later.)`;
      break;
    case 'compliance':
      headline = `${approachBest.sheet.name} stares ${options.counterparty} down (${finalRoll.total} vs DC ${dc}) — compliance at an attitude cost (+${threatDelta} Threat).`;
      break;
    case 'degraded':
      headline =
        options.encounterKind === 'truce'
          ? `${approachBest.sheet.name} cannot close ${options.counterparty} (${finalRoll.total} vs DC ${dc}) — a ${durationDays}-day cooling holds instead. The deal degrades, it never dies.`
          : `${approachBest.sheet.name} cannot close ${options.counterparty} (${finalRoll.total} vs DC ${dc}) — ${tributeDue}gp tribute keeps the table alive. The deal degrades, it never dies.`;
      break;
    case 'backlash':
      headline =
        options.encounterKind === 'truce'
          ? `${approachBest.sheet.name}'s ${options.approach} enrages ${options.counterparty} (${finalRoll.total} vs DC ${dc}) — only a ${durationDays}-day cooling and ${tributeDue}gp keeps steel sheathed. The deal degrades, it never dies.`
          : `${approachBest.sheet.name}'s ${options.approach} enrages ${options.counterparty} (${finalRoll.total} vs DC ${dc}) — ${tributeDue}gp and +${threatDelta} Threat barely keep the table alive. The deal degrades, it never dies.`;
      break;
  }

  return {
    encounterKind: options.encounterKind,
    counterparty: options.counterparty,
    approach: options.approach,
    outcome,
    success,
    progresses: true,
    history,
    insight,
    actorId: approachBest.sheet.id,
    actorName: approachBest.sheet.name,
    bonus: finalBonus,
    dc,
    naturalRoll: finalRoll.naturalRoll,
    total: finalRoll.total,
    durationDays,
    tributeDue,
    attitudeCost,
    fallout,
    threatDelta,
    headline,
    nextRngState: rngState,
  };
}

// ---------------------------------------------------------------------------
// Preview helper (odds rows before commit — no dice spent)
// ---------------------------------------------------------------------------

export interface DiplomacyPreviewRow {
  approach: DiplomacyApproach;
  /** Best live party bonus for the approach skill (+ read bonus when known). */
  bonus: number;
  dc: number;
  historyDc: number;
  /** Whether a passed History check would unlock the top tier. */
  historyLeverage: boolean;
}

export const PreviewDiplomacyParleyOptionsSchema = z.object({
  encounterKind: DiplomacyEncounterKindSchema,
  party: z.array(z.any()).min(1).max(6),
  baseDc: z.number().int().min(1).max(30).optional(),
  historyDc: z.number().int().min(1).max(30).optional(),
  dcModifier: z.number().int().min(-10).max(10).default(0),
});
export type PreviewDiplomacyParleyOptions = z.input<typeof PreviewDiplomacyParleyOptionsSchema>;

/**
 * Computes per-approach odds rows without spending RNG: best live bonuses,
 * the adjusted DC (assuming no History leverage yet), and the History DC.
 * The host renders these before the player commits an approach.
 */
export function previewDiplomacyParley(
  rawOptions: PreviewDiplomacyParleyOptions,
): DiplomacyPreviewRow[] {
  const options = PreviewDiplomacyParleyOptionsSchema.parse(rawOptions);
  const party = options.party as DerivedCharacterSheet[];
  const defaults = DIPLOMACY_DEFAULTS[options.encounterKind];
  const baseDc = options.baseDc ?? defaults.baseDc;
  const dc = Math.max(5, baseDc + options.dcModifier);
  const historyDc = options.historyDc ?? defaults.historyDc;
  return DIPLOMACY_APPROACHES.map((approach) => {
    const { bonus } = bestBonusOf(party, approach);
    return { approach, bonus, dc, historyDc, historyLeverage: true };
  });
}
