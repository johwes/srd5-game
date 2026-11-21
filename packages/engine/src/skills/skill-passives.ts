import type { SkillId } from '@srd5/data';
import type { Combatant } from '../combat/types.js';

/**
 * SRD-1213: Standing skill passives (Spec 11 §3.4).
 *
 * Every skill below grants a flat, domain-locked standing bonus. Rules:
 * proficiency-gated, not rank-scaled (untrained = nothing, proficient =
 * half bonus, expert = full); bonuses are small, typed, same-type never
 * stacks (take the highest), and domain-locked (never a global +X).
 *
 * Tier mapping from the derived sheet (`none` / `half` for Jack of All
 * Trades / `proficient` / `expertise`):
 * - `none` + `half` → `'none'` (untrained: no dividend)
 * - `proficient` → `'proficient'` (half bonus)
 * - `expertise` → `'expert'` (full bonus)
 *
 * All helpers are pure (no RNG) so they are trivially deterministic.
 */

export type SkillPassiveTier = 'none' | 'proficient' | 'expert';

export type PassiveSkillId =
  | 'religion'
  | 'history'
  | 'nature'
  | 'animal-handling'
  | 'medicine'
  | 'intimidation'
  | 'insight'
  | 'performance';

export const PASSIVE_SKILL_IDS: readonly PassiveSkillId[] = [
  'religion',
  'history',
  'nature',
  'animal-handling',
  'medicine',
  'intimidation',
  'insight',
  'performance',
] as const;

type ProficiencyLike = {
  proficiencyLevel?: string;
  proficiencies?: { skills?: string[]; expertise?: string[] };
} | undefined;

function readProficiencyLevel(combatant: Combatant, skill: string): string | undefined {
  const sheet = combatant.characterSheet as unknown as {
    skills?: Record<string, { proficiencyLevel?: string } | undefined>;
    proficiencies?: { skills?: string[]; expertise?: string[] };
  } | undefined;
  const level = sheet?.skills?.[skill]?.proficiencyLevel;
  if (typeof level === 'string') return level;
  // Fallback for sheets/mocks that only carry the consolidated lists.
  const prof = (sheet?.proficiencies ?? (combatant as unknown as ProficiencyLike)?.proficiencies) as
    | { skills?: string[]; expertise?: string[] }
    | undefined;
  if (prof?.expertise?.includes(skill)) return 'expertise';
  if (prof?.skills?.includes(skill)) return 'proficient';
  return undefined;
}

/**
 * Resolves the standing-passive tier for a combatant + skill.
 * Monsters (no sheet skills) resolve via `monsterData.skills` presence:
 * a listed skill counts as proficient (never expert).
 */
export function getSkillPassiveTier(combatant: Combatant, skill: PassiveSkillId | SkillId): SkillPassiveTier {
  const level = readProficiencyLevel(combatant, skill);
  if (level === 'expertise') return 'expert';
  if (level === 'proficient') return 'proficient';
  if (level === 'none' || level === 'half' || level === undefined) {
    // Monster skill map fallback: listed → proficient.
    const monsterSkills = (combatant.monsterData as unknown as { skills?: Record<string, number> } | undefined)?.skills;
    if (monsterSkills && typeof monsterSkills[skill] === 'number') return 'proficient';
    return 'none';
  }
  return 'none';
}

export function isPassiveTierAtLeast(tier: SkillPassiveTier, minimum: Exclude<SkillPassiveTier, 'none'>): boolean {
  if (minimum === 'proficient') return tier === 'proficient' || tier === 'expert';
  return tier === 'expert';
}

// ---------------------------------------------------------------------------
// Religion — the chaplain's dividend
// ---------------------------------------------------------------------------

/** Bonus HP whenever the combatant *receives* magical healing or quaffs a potion: 0 / +1 / +2. */
export function getReligionHealingReceivedBonus(tier: SkillPassiveTier): number {
  if (tier === 'expert') return 2;
  if (tier === 'proficient') return 1;
  return 0;
}

export function getReligionHealingReceivedBonusFor(combatant: Combatant): number {
  return getReligionHealingReceivedBonus(getSkillPassiveTier(combatant, 'religion'));
}

/** Save bonus vs undead-channeled effects on consecrated ground: 0 / 0 / +1. */
export function getReligionConsecratedSaveBonus(tier: SkillPassiveTier): number {
  return tier === 'expert' ? 1 : 0;
}

/** Extra rests a shrine blessing persists: 0 / 0 / +1. */
export function getReligionShrineBlessingExtraRests(tier: SkillPassiveTier): number {
  return tier === 'expert' ? 1 : 0;
}

// ---------------------------------------------------------------------------
// History — the loremaster's dividend
// ---------------------------------------------------------------------------

/** Free recall attempts granted per delve (hint card per KnowledgeRecallSpec): 0 / 1 / 1. */
export function getHistoryFreeRecallsPerDelve(tier: SkillPassiveTier): number {
  return tier === 'none' ? 0 : 1;
}

export function getHistoryFreeRecallsPerDelveFor(combatant: Combatant): number {
  return getHistoryFreeRecallsPerDelve(getSkillPassiveTier(combatant, 'history'));
}

/** Expert historians also reveal the boss's damage resistances pre-fight. */
export function hasHistoryBossResistanceReveal(tier: SkillPassiveTier): boolean {
  return tier === 'expert';
}

// ---------------------------------------------------------------------------
// Nature — the forager's dividend
// ---------------------------------------------------------------------------

/** Extra rations yielded on a successful forage: 0 / +1 / +1. */
export function getNatureForageRationBonus(tier: SkillPassiveTier): number {
  return tier === 'none' ? 0 : 1;
}

export function getNatureForageRationBonusFor(combatant: Combatant): number {
  return getNatureForageRationBonus(getSkillPassiveTier(combatant, 'nature'));
}

/** Best Nature forage bonus across a conscious party (same-type never stacks). */
export function getPartyNatureForageBonus(party: Record<string, Combatant> | Combatant[]): number {
  const members = Array.isArray(party) ? party : Object.values(party);
  let best = 0;
  for (const member of members) {
    if (member.isDead || member.currentHp <= 0) continue;
    best = Math.max(best, getNatureForageRationBonusFor(member));
  }
  return best;
}

/** Advantage vs natural (non-magical) poison/disease: untrained no, prof+ yes. */
export function hasNatureAdvantageVsNaturalAffliction(tier: SkillPassiveTier): boolean {
  return tier !== 'none';
}

/** Wilderness camps count this many steps safer for ambush rolls (expert only). */
export function getNatureCampSafetySteps(tier: SkillPassiveTier): number {
  return tier === 'expert' ? 1 : 0;
}

export function getPartyNatureCampSafetySteps(party: Record<string, Combatant> | Combatant[]): number {
  const members = Array.isArray(party) ? party : Object.values(party);
  let best = 0;
  for (const member of members) {
    if (member.isDead || member.currentHp <= 0) continue;
    best = Math.max(best, getNatureCampSafetySteps(getSkillPassiveTier(member, 'nature')));
  }
  return best;
}

// ---------------------------------------------------------------------------
// Animal Handling — the beast-friend's dividend
// ---------------------------------------------------------------------------

/** Beasts start this many attitude steps friendlier (buys the parley round). */
export function getAnimalHandlingAttitudeShift(tier: SkillPassiveTier): number {
  return tier === 'none' ? 0 : 1;
}

/** Off-road travel discount in movement points (mounts/beasts, expert only). */
export function getAnimalHandlingOffRoadDiscount(tier: SkillPassiveTier): number {
  return tier === 'expert' ? 1 : 0;
}

/** Guard-beast camp perception bonus (expert only). */
export function getAnimalHandlingCampPerceptionBonus(tier: SkillPassiveTier): number {
  return tier === 'expert' ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Medicine — the field-surgeon's dividend
// ---------------------------------------------------------------------------

/** Bonus HP per Hit Die spent during rests (administered healing): 0 / +1 / +1. */
export function getMedicineHitDieBonusPerDie(tier: SkillPassiveTier): number {
  return tier === 'none' ? 0 : 1;
}

export function getMedicineHitDieBonusPerDieFor(combatant: Combatant): number {
  return getMedicineHitDieBonusPerDie(getSkillPassiveTier(combatant, 'medicine'));
}

/** Free poison/disease diagnosis (no check): prof+. */
export function hasMedicineFreeDiagnosis(tier: SkillPassiveTier): boolean {
  return tier !== 'none';
}

/** Stabilize with advantage when a healer's kit is on hand (expert only). */
export function hasMedicineStabilizeAdvantage(tier: SkillPassiveTier): boolean {
  return tier === 'expert';
}

// ---------------------------------------------------------------------------
// Intimidation — the enforcer's dividend
// ---------------------------------------------------------------------------

/**
 * HP fraction at/below which enemies check morale against this combatant's
 * side. Bloodied (50%) by default; a proficient intimidator presses the
 * advantage earlier (60%). Expert keeps the same threshold but unlocks the
 * deception fallback below.
 */
export function getIntimidationMoraleThreshold(tier: SkillPassiveTier): number {
  return tier === 'none' ? 0.5 : 0.6;
}

/** Failed Deception bluffs fall back to Intimidation at +2 DC (expert only). */
export function hasIntimidationDeceptionFallback(tier: SkillPassiveTier): boolean {
  return tier === 'expert';
}

export const INTIMIDATION_DECEPTION_FALLBACK_DC_BONUS = 2;

// ---------------------------------------------------------------------------
// Insight — the reader's dividend
// ---------------------------------------------------------------------------

/** "Something feels off" cue when party passive beats the speaker's Deception: prof+. */
export function hasInsightPassiveCue(tier: SkillPassiveTier): boolean {
  return tier !== 'none';
}

/** Opposed reads reveal the intent band (demand / fear / bluff): expert only. */
export function hasInsightIntentBandReveal(tier: SkillPassiveTier): boolean {
  return tier === 'expert';
}

export type IntentBand = 'demand' | 'fear' | 'bluff';

/**
 * Maps an opposed Insight margin (insight total − deception total) to the
 * intent band an expert reader surfaces. Deterministic, no RNG.
 */
export function getIntentBand(insightTotal: number, deceptionTotal: number): IntentBand {
  const margin = insightTotal - deceptionTotal;
  if (margin >= 5) return 'demand';
  if (margin >= 0) return 'fear';
  return 'bluff';
}

// ---------------------------------------------------------------------------
// Performance — the tavern-star's dividend
// ---------------------------------------------------------------------------

/** Tavern rests earn coin + rumors on one roll (fail-forward): prof+. */
export function hasPerformanceTavernRewards(tier: SkillPassiveTier): boolean {
  return tier !== 'none';
}

/** Distract-as-Help uses per combat from 30 ft (expert only). */
export function getPerformanceDistractUsesPerCombat(tier: SkillPassiveTier): number {
  return tier === 'expert' ? 1 : 0;
}

/**
 * Tavern payout table (fail-forward: a failed roll still earns the floor).
 * Returns `{ gp, rumor }` for one Performance check total.
 */
export function getPerformanceTavernPayout(total: number, dc = 12): { gp: number; rumor: boolean } {
  if (total >= dc + 5) return { gp: 1 + Math.floor((total - dc - 5) / 5), rumor: true };
  if (total >= dc) return { gp: 1, rumor: true };
  return { gp: 0, rumor: true };
}

// ---------------------------------------------------------------------------
// Party-level summary (builder hints + integrity consumers)
// ---------------------------------------------------------------------------

export interface PartyPassiveSummary {
  skill: PassiveSkillId;
  bestTier: SkillPassiveTier;
  dividend: string;
}

const DIVIDEND_LABELS: Record<PassiveSkillId, Record<SkillPassiveTier, string>> = {
  religion: {
    none: 'No standing bonus',
    proficient: '+1 HP when receiving magical healing/potions',
    expert: '+2 HP when healed; +1 vs undead on consecrated ground; blessings +1 rest',
  },
  history: {
    none: 'No standing bonus',
    proficient: 'One free recall per delve',
    expert: 'One free recall per delve; boss resistances revealed pre-fight',
  },
  nature: {
    none: 'No standing bonus',
    proficient: '+1 ration when foraging; advantage vs natural poison/disease',
    expert: '+1 ration; advantage vs natural poison/disease; camps one step safer',
  },
  'animal-handling': {
    none: 'No standing bonus',
    proficient: 'Beasts start one attitude friendlier',
    expert: 'Friendlier beasts; off-road discount; guard-beasts +1 camp perception',
  },
  medicine: {
    none: 'No standing bonus',
    proficient: 'Hit-Die healing +1 per die; free poison/disease diagnosis',
    expert: '+1 per die; free diagnosis; stabilize with advantage (healer’s kit)',
  },
  intimidation: {
    none: 'No standing bonus',
    proficient: 'Bloodied enemies check morale earlier (60% HP)',
    expert: 'Earlier morale checks; failed Deception falls back to Intimidation +2 DC',
  },
  insight: {
    none: 'No standing bonus',
    proficient: '“Something feels off” cue when passive beats Deception',
    expert: 'Passive cue; opposed reads reveal intent band',
  },
  performance: {
    none: 'No standing bonus',
    proficient: 'Tavern rests earn coin + rumors on one roll',
    expert: 'Tavern coin + rumors; distract as Help 1/combat from 30 ft',
  },
};

/** Best tier per passive skill across the conscious party (for hints + tests). */
export function summarizePartyPassives(party: Record<string, Combatant> | Combatant[]): PartyPassiveSummary[] {
  const members = Array.isArray(party) ? party : Object.values(party);
  return PASSIVE_SKILL_IDS.map((skill) => {
    let best: SkillPassiveTier = 'none';
    for (const member of members) {
      if (member.isDead || member.currentHp <= 0) continue;
      const tier = getSkillPassiveTier(member, skill);
      if (tier === 'expert') {
        best = 'expert';
        break;
      }
      if (tier === 'proficient') best = 'proficient';
    }
    return { skill, bestTier: best, dividend: DIVIDEND_LABELS[skill][best] };
  });
}
