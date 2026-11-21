import {
  z,
} from 'zod';
import {
  normalizeSeed,
  nextRandomFloat,
} from '../dice/prng.js';
import {
  rollD20,
} from '../dice/evaluator.js';
import type { DerivedCharacterSheet } from '../character/schemas.js';
import {
  type WarState,
  WarStateSchema,
  isTruceActive,
} from './war.js';
import {
  type WarDiplomacyState,
  WAR_THREAT_BRIBE_GAIN,
  WAR_THREAT_KILL_PATROL_GAIN,
  WarDiplomacyStateSchema,
  addNationThreat,
  getNationThreat,
  getWarThreatTier,
  type WarThreatTier,
  isPursuitActiveForThreat,
} from './war-threat.js';
import {
  bestBonusOf,
  deductSlot,
  findSpellCaster,
} from './war-negotiation-utils.js';
import {
  hasPartyLanguageInfo,
  resolveWarLanguageDealTier,
} from './war-languages.js';
import {
  buildWarSquad,
  type BuiltWarSquad,
} from './war-squads.js';

/**
 * SRD-1104 — Enemy territory patrols (Spec 10 Section 7).
 *
 * Road vs off-road encounter rates mitigated by Survival/Stealth, Bluff /
 * Evade / Bribe / Fight options, per-nation Threat (`0..100`, pursuit at
 * `>= 55`) and Hunter-Killer pursuit squads. Pure and deterministic; the
 * seeded Mulberry32 PRNG (`rngState`) threads every roll.
 */

// ---------------------------------------------------------------------------
// Enemy territory patrols (Spec 10 Section 7)
// ---------------------------------------------------------------------------

export const PATROL_ENCOUNTER_ROAD_CHANCE = 0.35;
export const PATROL_ENCOUNTER_OFFROAD_CHANCE = 0.12;
export const PATROL_MITIGATION_PER_BONUS = 0.015;
export const PATROL_MIN_CHANCE = 0.02;
export const PATROL_BLUFF_DC = 13;
export const PATROL_EVADE_DC = 13;
export const PATROL_BRIBE_COST_GOLD = 50;
/** SRD-1214: gesture bluff DC penalty without a shared tongue/magic/interpreter. */
export const PATROL_GESTURE_BLUFF_DC_MODIFIER = 2;
/** SRD-1214: gesture bluffs never come clean — a passed gesture bluff banks Threat. */
export const PATROL_GESTURE_BLUFF_THREAT = 5;
/** SRD-1214: small tourist-price surcharge on bribes without patter. */
export const PATROL_TOURIST_SURCHARGE_GOLD = 15;

export const RollPatrolEncounterOptionsSchema = z.object({
  rngState: z.number().int().default(0),
  /** True on enemy roads (fast but watched); false off-road (slow but quiet). */
  onRoad: z.boolean(),
  nationId: z.string().min(1),
  party: z.array(z.any()).min(1).max(6),
  /** When given, an active truce suppresses the patrol entirely. */
  war: WarStateSchema.optional(),
  day: z.number().int().min(1).optional(),
  /** Blessing / guide bonuses applied to the Survival/Stealth mitigation. */
  trailBonus: z.number().int().default(0),
});
export type RollPatrolEncounterOptions = z.input<typeof RollPatrolEncounterOptionsSchema>;

export interface RolledPatrolEncounter {
  encountered: boolean;
  reason: 'truce' | 'clear' | 'patrol';
  chance: number;
  mitigationBonus: number;
  nextRngState: number;
}

/**
 * Rolls one enemy-territory patrol check. Roads carry a substantially higher
 * encounter rate; the party's best Survival/Stealth bonus (plus trail bonuses)
 * mitigates off-road and on-road checks alike. Truced nations never patrol.
 */
export function rollPatrolEncounter(rawOptions: RollPatrolEncounterOptions): RolledPatrolEncounter {
  const options = RollPatrolEncounterOptionsSchema.parse(rawOptions);
  const party = options.party as DerivedCharacterSheet[];
  let rngState = normalizeSeed(options.rngState);

  if (options.war) {
    const war = WarStateSchema.parse(options.war);
    if (isTruceActive(war, war.playerNationId, options.nationId, options.day ?? war.currentDay)) {
      return { encountered: false, reason: 'truce', chance: 0, mitigationBonus: 0, nextRngState: rngState };
    }
  }

  const { bonus } = bestBonusOf(party, 'survival', 'stealth');
  const mitigationBonus = Math.max(0, bonus) + Math.max(0, options.trailBonus);
  const base = options.onRoad ? PATROL_ENCOUNTER_ROAD_CHANCE : PATROL_ENCOUNTER_OFFROAD_CHANCE;
  const chance = Math.max(PATROL_MIN_CHANCE, base - PATROL_MITIGATION_PER_BONUS * mitigationBonus);
  const draw = nextRandomFloat(rngState);
  rngState = draw.nextState;
  const encountered = draw.value < chance;
  return {
    encountered,
    reason: encountered ? 'patrol' : 'clear',
    chance,
    mitigationBonus,
    nextRngState: rngState,
  };
}

export const WAR_PATROL_APPROACHES = ['bluff', 'evade', 'bribe', 'fight'] as const;
export const WarPatrolApproachSchema = z.enum(WAR_PATROL_APPROACHES);
export type WarPatrolApproach = z.infer<typeof WarPatrolApproachSchema>;

export const ResolvePatrolEncounterOptionsSchema = z.object({
  diplomacy: WarDiplomacyStateSchema,
  war: WarStateSchema.optional(),
  party: z.array(z.any()).min(1).max(6),
  nationId: z.string().min(1),
  approach: WarPatrolApproachSchema,
  rngState: z.number().int().default(0),
  goldAvailable: z.number().int().min(0).default(0),
  day: z.number().int().min(1).optional(),
  /** SRD-1214: retained interpreter carries bluffs/bribes at baseline + fee. */
  hasInterpreter: z.boolean().default(false),
});
export type ResolvePatrolEncounterOptions = z.input<typeof ResolvePatrolEncounterOptionsSchema>;

export const PatrolEncounterOutcomeSchema = z.enum(['passed', 'tactical_battle']);
export type PatrolEncounterOutcome = z.infer<typeof PatrolEncounterOutcomeSchema>;

export interface ResolvedPatrolEncounter {
  diplomacy: WarDiplomacyState;
  /** Party sheets with any expended *Disguise Self* slot deducted. */
  updatedParty: DerivedCharacterSheet[];
  outcome: PatrolEncounterOutcome;
  success: boolean;
  actorId: string;
  actorName: string;
  bonus: number;
  dc: number | null;
  naturalRoll: number | null;
  total: number | null;
  threatDelta: number;
  goldSpent: number;
  remainingGold: number;
  headline: string;
  nextRngState: number;
  /** SRD-1214: war-tongue tier that graded the approach (`baseline` for legacy sheets). */
  languageTier: 'native' | 'magic' | 'interpreter' | 'gesture' | 'baseline';
  /** SRD-1214: interpreter per-parley fee included in `goldSpent` (0 unless carried). */
  interpreterFee: number;
}

/**
 * Resolves the patrol encounter dialogue (Spec 10 §7 + Spec 11 §2.4):
 * - **Bluff** (Persuasion/Deception, or *Disguise Self* for an automatic
 *   pass that expends a 1st-level+ slot): pass with `+0` Threat in tongue /
 *   magic / interpreter hands; gesture bluffs (no shared tongue, magic, or
 *   interpreter) roll at `+2` DC and cap at pass-with-Threat (`+5`).
 * - **Evade** (Stealth/Survival): slip off the road with `+0` Threat —
 *   never gated on language.
 * - **Bribe** (50gp, `+15gp` tourist surcharge without patter): pass with
 *   `+5` Threat. Interpreter hands pay baseline + per-parley fee.
 * - **Fight**: a tactical battle — Threat only rises once the patrol is
 *   reported killed via `reportPatrolKill()` (`+20`, pursuit at `>= 55`).
 */
export function resolvePatrolEncounter(rawOptions: ResolvePatrolEncounterOptions): ResolvedPatrolEncounter {
  const options = ResolvePatrolEncounterOptionsSchema.parse(rawOptions);
  const diplomacy = WarDiplomacyStateSchema.parse(options.diplomacy);
  const party = options.party as DerivedCharacterSheet[];
  let rngState = normalizeSeed(options.rngState);
  const failThrough = (headline: string): ResolvedPatrolEncounter => ({
    diplomacy,
    updatedParty: structuredClone(party),
    outcome: 'tactical_battle',
    success: false,
    actorId: party[0]!.id,
    actorName: party[0]!.name,
    bonus: 0,
    dc: null,
    naturalRoll: null,
    total: null,
    threatDelta: 0,
    goldSpent: 0,
    remainingGold: options.goldAvailable,
    headline,
    nextRngState: rngState,
    languageTier: 'baseline',
    interpreterFee: 0,
  });

  // SRD-1214: war-tongue tier for bluff/bribe. Legacy sheets without explicit
  // language data (or unknown nations) resolve to `baseline` — pre-1214
  // behavior preserved. Real derived sheets gate through the deal tier.
  const resolveTier = (): {
    tier: ResolvedPatrolEncounter['languageTier'];
    dcModifier: number;
    interpreterFee: number;
  } => {
    try {
      if (!hasPartyLanguageInfo(party)) return { tier: 'baseline', dcModifier: 0, interpreterFee: 0 };
      const resolved = resolveWarLanguageDealTier({
        nationId: options.nationId,
        party,
        hasInterpreter: options.hasInterpreter,
      });
      if (resolved.tier === 'gesture') {
        return { tier: 'gesture', dcModifier: PATROL_GESTURE_BLUFF_DC_MODIFIER, interpreterFee: 0 };
      }
      if (resolved.tier === 'interpreter') {
        return { tier: 'interpreter', dcModifier: 0, interpreterFee: resolved.perParleyFee };
      }
      return { tier: resolved.tier, dcModifier: 0, interpreterFee: 0 };
    } catch {
      return { tier: 'baseline', dcModifier: 0, interpreterFee: 0 };
    }
  };

  if (options.approach === 'bribe') {
    const tierInfo = resolveTier();
    const surcharge =
      tierInfo.tier === 'gesture' ? PATROL_TOURIST_SURCHARGE_GOLD : 0;
    const fee = tierInfo.tier === 'interpreter' ? tierInfo.interpreterFee : 0;
    const cost = PATROL_BRIBE_COST_GOLD + surcharge + fee;
    if (options.goldAvailable < cost) {
      return {
        ...failThrough(
          `The patrol captain names ${cost}gp${surcharge ? ` (includes ${surcharge}gp tourist surcharge — no shared tongue)` : ''}${fee ? ` (includes ${fee}gp interpreter fee)` : ''} — the party cannot pay, and steel is drawn.`,
        ),
        languageTier: tierInfo.tier,
        interpreterFee: fee,
      };
    }
    const surchargeNote = surcharge
      ? ` (+${surcharge}gp tourist surcharge — no shared tongue)`
      : '';
    const feeNote = fee ? ` (+${fee}gp interpreter fee)` : '';
    return {
      diplomacy: addNationThreat(diplomacy, options.nationId, WAR_THREAT_BRIBE_GAIN),
      updatedParty: structuredClone(party),
      outcome: 'passed',
      success: true,
      actorId: party[0]!.id,
      actorName: party[0]!.name,
      bonus: 0,
      dc: null,
      naturalRoll: null,
      total: null,
      threatDelta: WAR_THREAT_BRIBE_GAIN,
      goldSpent: cost,
      remainingGold: options.goldAvailable - cost,
      headline: `The captain pockets ${cost}gp${surchargeNote}${feeNote} and waves the party through (+${WAR_THREAT_BRIBE_GAIN} Threat).`,
      nextRngState: rngState,
      languageTier: tierInfo.tier,
      interpreterFee: fee,
    };
  }

  if (options.approach === 'fight') {
    return {
      ...failThrough(`The party sets for battle — kill the patrol and the territory will remember it.`),
      actorId: party[0]!.id,
      actorName: party[0]!.name,
    };
  }

  if (options.approach === 'bluff') {
    // *Disguise Self* veils the whole band: automatic pass, slot expended.
    const veiled = findSpellCaster(party, 'disguise-self', 1);
    if (veiled) {
      const index = party.findIndex((sheet) => sheet.id === veiled.id);
      const deducted = deductSlot(party[index]!, 1);
      const updatedParty = structuredClone(party);
      updatedParty[index] = deducted.updated;
      return {
        diplomacy,
        updatedParty,
        outcome: 'passed',
        success: true,
        actorId: veiled.id,
        actorName: veiled.name,
        bonus: 0,
        dc: PATROL_BLUFF_DC,
        naturalRoll: null,
        total: null,
        threatDelta: 0,
        goldSpent: 0,
        remainingGold: options.goldAvailable,
        headline: `${veiled.name}'s Disguise Self veil fools the patrol — the band passes as traveling merchants (+0 Threat).`,
        nextRngState: rngState,
        languageTier: 'baseline',
        interpreterFee: 0,
      };
    }
    const tierInfo = resolveTier();
    // Interpreter hands need their fee covered, else the parley falls back to gesture.
    if (tierInfo.tier === 'interpreter' && options.goldAvailable < tierInfo.interpreterFee) {
      const dc = PATROL_BLUFF_DC + PATROL_GESTURE_BLUFF_DC_MODIFIER;
      const { bonus, sheet } = bestBonusOf(party, 'persuasion', 'deception');
      const roll = rollD20(rngState, { modifier: bonus });
      rngState = roll.nextState;
      if (roll.total >= dc) {
        const gestureDiplomacy = addNationThreat(diplomacy, options.nationId, PATROL_GESTURE_BLUFF_THREAT);
        return {
          diplomacy: gestureDiplomacy,
          updatedParty: structuredClone(party),
          outcome: 'passed',
          success: true,
          actorId: sheet.id,
          actorName: sheet.name,
          bonus,
          dc,
          naturalRoll: roll.naturalRoll,
          total: roll.total,
          threatDelta: PATROL_GESTURE_BLUFF_THREAT,
          goldSpent: 0,
          remainingGold: options.goldAvailable,
          headline: `${sheet.name} mimes the patrol past (${roll.total} vs DC ${dc}) — gesture pass, but the patrol notes the strangers (+${PATROL_GESTURE_BLUFF_THREAT} Threat; interpreter fee unpaid).`,
          nextRngState: rngState,
          languageTier: 'gesture',
          interpreterFee: 0,
        };
      }
      return {
        diplomacy,
        updatedParty: structuredClone(party),
        outcome: 'tactical_battle',
        success: false,
        actorId: sheet.id,
        actorName: sheet.name,
        bonus,
        dc,
        naturalRoll: roll.naturalRoll,
        total: roll.total,
        threatDelta: 0,
        goldSpent: 0,
        remainingGold: options.goldAvailable,
        headline: `${sheet.name}'s gestures fail (${roll.total} vs DC ${dc}) — the patrol attacks (interpreter fee unpaid).`,
        nextRngState: rngState,
        languageTier: 'gesture',
        interpreterFee: 0,
      };
    }
    const dc = PATROL_BLUFF_DC + tierInfo.dcModifier;
    const { bonus, sheet } = bestBonusOf(party, 'persuasion', 'deception');
    const roll = rollD20(rngState, { modifier: bonus });
    rngState = roll.nextState;
    const fee = tierInfo.tier === 'interpreter' ? tierInfo.interpreterFee : 0;
    if (roll.total >= dc) {
      if (tierInfo.tier === 'gesture') {
        const gestureDiplomacy = addNationThreat(diplomacy, options.nationId, PATROL_GESTURE_BLUFF_THREAT);
        return {
          diplomacy: gestureDiplomacy,
          updatedParty: structuredClone(party),
          outcome: 'passed',
          success: true,
          actorId: sheet.id,
          actorName: sheet.name,
          bonus,
          dc,
          naturalRoll: roll.naturalRoll,
          total: roll.total,
          threatDelta: PATROL_GESTURE_BLUFF_THREAT,
          goldSpent: 0,
          remainingGold: options.goldAvailable,
          headline: `${sheet.name} mimes the patrol past (${roll.total} vs DC ${dc}) — gesture pass, but the patrol notes the strangers (+${PATROL_GESTURE_BLUFF_THREAT} Threat, never clean).`,
          nextRngState: rngState,
          languageTier: 'gesture',
          interpreterFee: 0,
        };
      }
      const feeNote = fee ? ` (−${fee}gp interpreter fee)` : '';
      const tongueNote =
        tierInfo.tier === 'native'
          ? ' in their own tongue'
          : tierInfo.tier === 'interpreter'
            ? ' through the interpreter'
            : '';
      return {
        diplomacy,
        updatedParty: structuredClone(party),
        outcome: 'passed',
        success: true,
        actorId: sheet.id,
        actorName: sheet.name,
        bonus,
        dc,
        naturalRoll: roll.naturalRoll,
        total: roll.total,
        threatDelta: 0,
        goldSpent: fee,
        remainingGold: options.goldAvailable - fee,
        headline: `${sheet.name} talks the patrol down${tongueNote} (${roll.total} vs DC ${dc}) — waved through (+0 Threat)${feeNote}.`,
        nextRngState: rngState,
        languageTier: tierInfo.tier,
        interpreterFee: fee,
      };
    }
    return {
      diplomacy,
      updatedParty: structuredClone(party),
      outcome: 'tactical_battle',
      success: false,
      actorId: sheet.id,
      actorName: sheet.name,
      bonus,
      dc,
      naturalRoll: roll.naturalRoll,
      total: roll.total,
      threatDelta: 0,
      goldSpent: 0,
      remainingGold: options.goldAvailable,
      headline: `${sheet.name}'s cover story collapses (${roll.total} vs DC ${dc}) — the patrol attacks.`,
      nextRngState: rngState,
      languageTier: tierInfo.tier,
      interpreterFee: 0,
    };
  }

  // 'evade': slip off the road under Survival/Stealth.
  const { bonus, sheet } = bestBonusOf(party, 'stealth', 'survival');
  const roll = rollD20(rngState, { modifier: bonus });
  rngState = roll.nextState;
  if (roll.total >= PATROL_EVADE_DC) {
    return {
      diplomacy,
      updatedParty: structuredClone(party),
      outcome: 'passed',
      success: true,
      actorId: sheet.id,
      actorName: sheet.name,
      bonus,
      dc: PATROL_EVADE_DC,
      naturalRoll: roll.naturalRoll,
      total: roll.total,
      threatDelta: 0,
      goldSpent: 0,
      remainingGold: options.goldAvailable,
      headline: `${sheet.name} ghosts the patrol into the treeline (${roll.total} vs DC ${PATROL_EVADE_DC}) — unseen (+0 Threat).`,
      nextRngState: rngState,
      languageTier: 'baseline',
      interpreterFee: 0,
    };
  }
  return {
    diplomacy,
    updatedParty: structuredClone(party),
    outcome: 'tactical_battle',
    success: false,
    actorId: sheet.id,
    actorName: sheet.name,
    bonus,
    dc: PATROL_EVADE_DC,
    naturalRoll: roll.naturalRoll,
    total: roll.total,
    threatDelta: 0,
    goldSpent: 0,
    remainingGold: options.goldAvailable,
    headline: `${sheet.name} snaps a branch at the wrong moment (${roll.total} vs DC ${PATROL_EVADE_DC}) — the patrol gives chase.`,
    nextRngState: rngState,
    languageTier: 'baseline',
    interpreterFee: 0,
  };
}

export const ReportPatrolKillOptionsSchema = z.object({
  diplomacy: WarDiplomacyStateSchema,
  war: WarStateSchema.optional(),
  nationId: z.string().min(1),
  day: z.number().int().min(1).optional(),
});
export type ReportPatrolKillOptions = z.input<typeof ReportPatrolKillOptionsSchema>;

export interface ReportedPatrolKill {
  diplomacy: WarDiplomacyState;
  war?: WarState;
  threat: number;
  tier: WarThreatTier;
  pursuitActive: boolean;
  pursuitStarted: boolean;
  headline: string;
}

/**
 * Records a killed patrol: `+20` Threat in that nation; crossing `>= 55`
 * activates Hunter-Killer pursuit (logged to the War Chronicle when `war` is
 * supplied).
 */
export function reportPatrolKill(rawOptions: ReportPatrolKillOptions): ReportedPatrolKill {
  const options = ReportPatrolKillOptionsSchema.parse(rawOptions);
  const before = getNationThreat(options.diplomacy, options.nationId);
  const diplomacy = addNationThreat(options.diplomacy, options.nationId, WAR_THREAT_KILL_PATROL_GAIN);
  const threat = getNationThreat(diplomacy, options.nationId);
  const pursuitStarted = !isPursuitActiveForThreat(before) && isPursuitActiveForThreat(threat);

  let war = options.war ? WarStateSchema.parse(options.war) : undefined;
  if (war) {
    const day = options.day ?? war.currentDay;
    const nextWar: WarState = structuredClone(war);
    nextWar.chronicle = [
      ...nextWar.chronicle,
      {
        day,
        kind: 'patrol_skirmish',
        headline: `A ${nextWar.nations[options.nationId]?.name ?? options.nationId} patrol vanishes in the wilds (Threat ${threat}).`,
      },
    ];
    if (pursuitStarted) {
      nextWar.chronicle.push({
        day,
        kind: 'pursuit_started',
        headline: `Hunter-killer squads of ${nextWar.nations[options.nationId]?.name ?? options.nationId} hunt the party.`,
      });
    }
    war = WarStateSchema.parse(nextWar);
  }

  return {
    diplomacy,
    war,
    threat,
    tier: getWarThreatTier(threat),
    pursuitActive: isPursuitActiveForThreat(threat),
    pursuitStarted,
    headline: pursuitStarted
      ? `The patrol dies to a soul — Threat ${threat}. Hunter-killer pursuit is active.`
      : `The patrol dies quietly — Threat ${threat} (${getWarThreatTier(threat)}).`,
  };
}

/**
 * Builds the Hunter-Killer pursuit squad that intercepts the party at high
 * Threat: a dynamic-CR Warrior/Mage/Cleric/Thief cell fielded by the hunting
 * nation (Spec 10 §7, SRD-1102 squad machinery).
 */
export function buildHunterKillerSquad(
  partyLevel: number,
  nationId: string,
  seed = 0,
): BuiltWarSquad {
  return buildWarSquad({
    partyLevel,
    nationId,
    seed,
    composition: ['fighter', 'wizard', 'cleric', 'rogue'],
    teamId: 'war_enemies',
    idPrefix: `hunter_killer_${nationId}`,
  });
}
