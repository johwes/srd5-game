/**
 * SRD-1212: Engine-side relevance integrity gate.
 *
 * Spec 11 §1 + §7: every offered spell/skill/language must resolve or carry
 * an explicit tracking ticket. `@srd5/data` (`relevance/registry.ts`) owns
 * the canonical tables and the dataset validator wiring; this module layers
 * engine consumer verification on top:
 *
 * - every one of the 18 skills maps to at least one real, imported engine
 *   verb (theft, recall, opposed Insight, stabilize, diplomacy, hide, …);
 * - every bundled language opens the party-level gate
 *   (`resolveLanguageGate` / `partyCanUnderstand`);
 * - every bundled spell resolves to an executable relevance path;
 * - draft-party generation never emits a dangling spell id.
 *
 * The imports below are intentional: referencing the real functions means
 * the gate breaks at typecheck time if a verb is renamed or deleted,
 * not just at test time.
 */

import {
  BUNDLED_SRD_DATASET,
  RELEVANCE_TRACKING_TICKET,
  SKILL_IDS,
  TRACKED_UNSUPPORTED_LANGUAGES,
  TRACKED_UNSUPPORTED_SKILLS,
  TRACKED_UNSUPPORTED_SPELLS,
  defaultCompendium,
  getLanguageRelevanceInfo,
  getSkillRelevanceInfo,
  getSpellRelevanceInfo,
  validateRelevanceCoverage,
  type SkillId,
} from '@srd5/data';
import { executeGrapple, executeShove } from '../combat/attack.js';
import { executeOutOfCombatSpellCast } from '../combat/out-of-combat-casting.js';
import { resolveSleepHpPool, resolveSanctuaryWardAttack } from '../combat/marker-spells.js';
import { resolveWishBoon, rollTimeStopTurns } from '../combat/capstones.js';
import { stabilizeCreature } from '../combat/damage.js';
import { resolveTheftAttempt } from '../dungeon/theft.js';
import {
  resolveRecallAttempt,
  resolveArcanaSpellIdentification,
} from '../dungeon/recall.js';
import {
  checkPassivePerceptionForProps,
  listenAtDoor,
  resolvePropInteraction,
} from '../dungeon/props.js';
import {
  resolveInsightContest,
  resolveStabilizeAttempt,
  resolveIntimidationAttempt,
  resolveAnimalHandlingAttempt,
  resolveNatureLoreAttempt,
  resolvePerformanceAttempt,
  resolveCombatHide,
} from '../social/contests.js';
import { resolveDiplomaticParley } from '../social/diplomacy.js';
import { resolveLanguageGate, resolveOrcTribeParley } from '../language/gates.js';
import { partyCanUnderstand } from '../language/comprehension.js';
import { resolvePatrolEncounter } from '../overworld/war-patrols.js';
import {
  generateDispatchIntercept,
  getWarNationLanguageProfile,
  hireInterpreter,
  resolveWarLanguageDealTier,
  rollDispatchInterceptDrop,
  tryReadDispatchIntercept,
} from '../overworld/war-languages.js';
import { negotiateTruce } from '../overworld/war-contracts.js';
import { resolveMissionApproach } from '../overworld/war-missions.js';
import {
  getSkillPassiveTier,
  getReligionHealingReceivedBonusFor,
  getMedicineHitDieBonusPerDieFor,
  getPartyNatureForageBonus,
  summarizePartyPassives,
} from '../skills/skill-passives.js';
import { generateDraftParty } from '../remix/draft-party.js';

export interface EngineRelevanceError {
  category: 'relevance';
  collection: string;
  entityId?: string;
  message: string;
}

/**
 * Engine verbs backing every SRD skill. Each entry names the imported
 * function(s) above so a deleted verb fails typecheck first.
 */
export const ENGINE_SKILL_CONSUMERS: Record<SkillId, string[]> = {
  acrobatics: ['combat/attack.ts:executeGrapple', 'combat/attack.ts:executeShove'],
  'animal-handling': ['social/contests.ts:resolveAnimalHandlingAttempt', 'skills/skill-passives.ts:attitude-shift+off-road+camp-perception'],
  arcana: [
    'dungeon/recall.ts:resolveRecallAttempt(arcana)',
    'dungeon/recall.ts:resolveArcanaSpellIdentification',
  ],
  athletics: [
    'combat/attack.ts:executeGrapple',
    'combat/attack.ts:executeShove',
    'overworld/war-missions.ts:resolveMissionApproach',
  ],
  deception: ['social/diplomacy.ts:resolveDiplomaticParley', 'social/contests.ts:resolveInsightContest', 'skills/skill-passives.ts:intimidation-fallback'],
  history: ['dungeon/recall.ts:resolveRecallAttempt(history)', 'social/diplomacy.ts:history unlock', 'skills/skill-passives.ts:free-recall+boss-reveal'],
  insight: ['social/contests.ts:resolveInsightContest', 'language/gates.ts:intent cues', 'skills/skill-passives.ts:passive-cue+intent-band'],
  intimidation: ['social/contests.ts:resolveIntimidationAttempt', 'social/diplomacy.ts:resolveDiplomaticParley', 'skills/skill-passives.ts:morale-threshold+deception-fallback'],
  investigation: ['dungeon/props.ts:checkPassivePerceptionForProps', 'dungeon/props.ts:resolvePropInteraction'],
  medicine: ['combat/damage.ts:stabilizeCreature', 'social/contests.ts:resolveStabilizeAttempt', 'skills/skill-passives.ts:hit-die-bonus+diagnosis+stabilize-advantage'],
  nature: ['social/contests.ts:resolveNatureLoreAttempt', 'dungeon/recall.ts:resolveRecallAttempt(nature)', 'skills/skill-passives.ts:forage-bonus+affliction-advantage+camp-safety'],
  perception: [
    'dungeon/props.ts:checkPassivePerceptionForProps',
    'dungeon/props.ts:listenAtDoor',
  ],
  performance: ['social/contests.ts:resolvePerformanceAttempt', 'skills/skill-passives.ts:tavern-rewards+distract-help'],
  persuasion: ['social/diplomacy.ts:resolveDiplomaticParley', 'overworld/war-patrols.ts:resolvePatrolEncounter'],
  religion: ['dungeon/recall.ts:resolveRecallAttempt(religion)', 'skills/skill-passives.ts:healing-bonus+consecrated-save+shrine-extension'],
  'sleight-of-hand': ['dungeon/theft.ts:resolveTheftAttempt'],
  stealth: ['social/contests.ts:resolveCombatHide', 'overworld/war-patrols.ts:evasion'],
  survival: ['overworld/travel+expeditions:forage/evasion'],
};

/** Languages open the party-level gate; war tongues additionally feed patrols/deals. */
export const ENGINE_LANGUAGE_CONSUMERS: Record<string, string[]> = {
  '*': ['language/gates.ts:resolveLanguageGate', 'language/comprehension.ts:partyCanUnderstand'],
  orc: ['language/gates.ts:resolveOrcTribeParley', 'social/diplomacy.ts:resolveDiplomaticParley', 'overworld/war-languages.ts:resolveWarLanguageDealTier'],
  dwarvish: ['overworld/war-patrols.ts:resolvePatrolEncounter', 'overworld/war-languages.ts:resolveWarLanguageDealTier'],
  elvish: ['overworld/war-patrols.ts:resolvePatrolEncounter', 'overworld/war-languages.ts:resolveWarLanguageDealTier'],
  infernal: ['overworld/war-patrols.ts:resolvePatrolEncounter', 'overworld/war-languages.ts:resolveWarLanguageDealTier'],
  draconic: ['overworld/war-patrols.ts:resolvePatrolEncounter', 'overworld/war-languages.ts:resolveWarLanguageDealTier'],
  giant: ['overworld/war-patrols.ts:resolvePatrolEncounter', 'overworld/war-languages.ts:resolveWarLanguageDealTier'],
  common: ['overworld/war-patrols.ts:resolvePatrolEncounter', 'overworld/war-languages.ts:resolveWarLanguageDealTier'],
  sylvan: ['overworld/war-languages.ts:resolveWarLanguageDealTier'],
  celestial: ['overworld/war-languages.ts:generateDispatchIntercept'],
};

/** Keep imported verbs referenced so typecheck fails if any are deleted. */
const ENGINE_VERB_PROOF: Record<string, unknown> = {
  executeGrapple,
  executeShove,
  executeOutOfCombatSpellCast,
  resolveSleepHpPool,
  resolveSanctuaryWardAttack,
  resolveWishBoon,
  rollTimeStopTurns,
  stabilizeCreature,
  resolveTheftAttempt,
  resolveRecallAttempt,
  resolveArcanaSpellIdentification,
  checkPassivePerceptionForProps,
  listenAtDoor,
  resolvePropInteraction,
  resolveInsightContest,
  resolveStabilizeAttempt,
  resolveIntimidationAttempt,
  resolveAnimalHandlingAttempt,
  resolveNatureLoreAttempt,
  resolvePerformanceAttempt,
  resolveCombatHide,
  resolveDiplomaticParley,
  resolveLanguageGate,
  resolveOrcTribeParley,
  partyCanUnderstand,
  resolvePatrolEncounter,
  resolveMissionApproach,
  generateDraftParty,
  getWarNationLanguageProfile,
  resolveWarLanguageDealTier,
  generateDispatchIntercept,
  rollDispatchInterceptDrop,
  tryReadDispatchIntercept,
  hireInterpreter,
  negotiateTruce,
  getSkillPassiveTier,
  getReligionHealingReceivedBonusFor,
  getMedicineHitDieBonusPerDieFor,
  getPartyNatureForageBonus,
  summarizePartyPassives,
};

export function getEngineVerbProof(): Record<string, unknown> {
  return ENGINE_VERB_PROOF;
}

export function getEngineSkillConsumers(skillId: string): string[] {
  const norm = skillId.trim().toLowerCase() as SkillId;
  return ENGINE_SKILL_CONSUMERS[norm] ? [...ENGINE_SKILL_CONSUMERS[norm]!] : [];
}

export function getEngineLanguageConsumers(languageId: string): string[] {
  const norm = languageId.trim().toLowerCase();
  return [
    ...(ENGINE_LANGUAGE_CONSUMERS['*'] ?? []),
    ...(ENGINE_LANGUAGE_CONSUMERS[norm] ?? []),
  ];
}

/**
 * Runs the full engine-side relevance gate. Returns an empty array when
 * the contract holds; each entry describes a new dangling offering that
 * must either gain a verb or an explicit tracking ticket.
 */
export function validateEngineRelevance(): EngineRelevanceError[] {
  const errors: EngineRelevanceError[] = [];
  const err = (collection: string, message: string, entityId?: string): void => {
    errors.push({ category: 'relevance', collection, ...(entityId ? { entityId } : {}), message });
  };

  // 0. Verb proof: every referenced engine verb must still be a function.
  for (const [name, fn] of Object.entries(ENGINE_VERB_PROOF)) {
    if (typeof fn !== 'function') {
      err('engine-verbs', `Engine relevance verb "${name}" is not a function (renamed or deleted)`);
    }
  }

  // 1. Dataset-level gate must be green (single source of truth in @srd5/data).
  for (const dataError of validateRelevanceCoverage(BUNDLED_SRD_DATASET)) {
    errors.push({ ...dataError });
  }

  const knownLanguageIds = BUNDLED_SRD_DATASET.proficienciesAndLanguages.languages.map((l) => l.id);
  const spellLookup = (id: string) => {
    const spell = defaultCompendium.getSpell(id);
    return spell
      ? {
          id: spell.id,
          name: spell.name,
          level: spell.level,
          school: spell.school,
          ritual: spell.ritual,
          concentration: spell.concentration,
          description: spell.description,
        }
      : undefined;
  };

  // 2. Every canonical skill needs ≥1 engine consumer + supported registry entry.
  for (const skillId of SKILL_IDS) {
    const consumers = getEngineSkillConsumers(skillId);
    if (consumers.length === 0) {
      err('engine-skills', `Skill "${skillId}" has no engine consumer (verb missing)`, skillId);
    }
    const info = getSkillRelevanceInfo(skillId);
    if (info.status !== 'supported' && TRACKED_UNSUPPORTED_SKILLS[skillId] === undefined) {
      err('engine-skills', `Skill "${skillId}" has no relevance entry and no tracking ticket`, skillId);
    }
  }

  // 3. Every bundled language must open a gate (supported or tracked).
  for (const lang of defaultCompendium.languages) {
    const info = getLanguageRelevanceInfo(lang.id, knownLanguageIds);
    if (info.status !== 'supported' && TRACKED_UNSUPPORTED_LANGUAGES[lang.id.toLowerCase()] === undefined) {
      err('engine-languages', `Language "${lang.id}" has no gate and no tracking ticket`, lang.id);
    }
    if (getEngineLanguageConsumers(lang.id).length === 0) {
      err('engine-languages', `Language "${lang.id}" has no engine consumer`, lang.id);
    }
  }

  // 4. Every bundled spell must resolve to an executable relevance path.
  for (const spell of defaultCompendium.spells) {
    const norm = spell.id.trim().toLowerCase();
    if (TRACKED_UNSUPPORTED_SPELLS[norm] !== undefined) continue;
    const info = getSpellRelevanceInfo(spell.id, spellLookup);
    if (info.status !== 'supported') {
      err('engine-spells', `Spell "${spell.id}" has no executable path and no tracking ticket`, spell.id);
    } else if (info.paths.length === 0) {
      err('engine-spells', `Spell "${spell.id}" has an empty relevance path list`, spell.id);
    }
  }

  // 5. Draft-party generation must never emit a dangling spell id.
  // Seeds sweep several class/race combos; every emitted spell must resolve.
  for (const seed of [7, 99, 1337, 4242]) {
    let party: ReturnType<typeof generateDraftParty>;
    try {
      party = generateDraftParty({ seed, partySize: 4 });
    } catch (e) {
      err('engine-draft-party', `generateDraftParty(seed ${seed}) threw: ${(e as Error).message}`);
      continue;
    }
    for (const hero of party) {
      const spellIds = [
        ...(hero.spellcasting?.knownCantripIds ?? []),
        ...(hero.spellcasting?.knownSpellIds ?? []),
        ...(hero.spellcasting?.preparedSpellIds ?? []),
        ...(hero.spellcasting?.spellbookSpellIds ?? []),
      ];
      for (const spellId of spellIds) {
        const norm = spellId.trim().toLowerCase();
        if (TRACKED_UNSUPPORTED_SPELLS[norm] !== undefined) continue;
        const info = getSpellRelevanceInfo(spellId, spellLookup);
        if (info.status !== 'supported') {
          err(
            'engine-draft-party',
            `Draft hero "${hero.id}" (seed ${seed}) offers dangling spell "${spellId}" (relevance gate ${RELEVANCE_TRACKING_TICKET})`,
            hero.id,
          );
        }
      }
    }
  }

  return errors;
}

/** Throws when the relevance gate finds dangling offered content. */
export function assertEngineRelevanceGate(): void {
  const errors = validateEngineRelevance();
  if (errors.length > 0) {
    const formatted = errors
      .slice(0, 25)
      .map((e) => `  - [${e.category}] ${e.collection}${e.entityId ? ` (${e.entityId})` : ''}: ${e.message}`)
      .join('\n');
    const extra = errors.length > 25 ? `\n  ...and ${errors.length - 25} more error(s)` : '';
    throw new Error(`SRD-1212 Relevance Gate Failed with ${errors.length} error(s):\n${formatted}${extra}`);
  }
}
