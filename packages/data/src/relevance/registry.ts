/**
 * SRD-1212: Relevance integrity gate — canonical registry.
 *
 * Spec 11 §1 (Relevance contract) + §7 (Acceptance & Test Plan):
 * every language, skill, and spell offered in the builder (or cast by AI)
 * must have at least one implemented mechanical path — a gate, check,
 * bonus, or effect that changes an outcome. Pure display text is not enough.
 *
 * This module is the single source of truth for that contract inside
 * `@srd5/data`. The dataset validator (`validation/validate.ts`) calls
 * `validateRelevanceCoverage()` so the integrity suite fails on new
 * dangling offered content. `@srd5/engine` (`tabletop/relevance-gate.ts`)
 * layers engine consumer verification on top, and `@srd5/client`
 * (`components/builder/relevance.ts`) renders badges from these tables so
 * UI and gate can never drift apart.
 *
 * Items that genuinely have no mechanical home yet are NOT silently
 * dropped: they must be listed in one of the `TRACKED_UNSUPPORTED_*`
 * maps with an explicit tracking ticket (default `SRD-1212`). The gate
 * passes explicitly-tracked items but surfaces them as `unsupported`
 * badges in the builder.
 */

import { SKILL_IDS, type SkillId } from '../schemas/enums.js';
import type { SrdIngestionInput } from '../ingestion/pipeline.js';

/** Tracking ticket used when offered content has no mechanical path yet. */
export const RELEVANCE_TRACKING_TICKET = 'SRD-1212' as const;

export type RelevanceStatus = 'supported' | 'unsupported';

export interface LanguageRelevanceInfo {
  id: string;
  status: RelevanceStatus;
  badge: string;
  uses: string[];
  /** Engine/data consumers that implement the path (audit trail). */
  consumers: string[];
  trackingTicket?: string;
}

export interface SkillRelevanceInfo {
  id: SkillId;
  status: RelevanceStatus;
  badge: string;
  uses: string[];
  consumers: string[];
  trackingTicket?: string;
}

export interface SpellRelevanceInfo {
  id: string;
  status: RelevanceStatus;
  paths: string[];
  badge: string;
  detail: string;
  trackingTicket?: string;
}

export interface RelevanceCoverageError {
  category: 'relevance';
  collection: string;
  entityId?: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Language relevance (all 18 SRD languages open a real gate)
// ---------------------------------------------------------------------------

interface LanguageRelevanceEntry {
  badge: string;
  uses: string[];
  consumers: string[];
}

export const LANGUAGE_RELEVANCE: Record<string, LanguageRelevanceEntry> = {
  common: {
    badge: 'Trade tongue',
    uses: [
      'Baseline parley tongue (no penalty)',
      'Shared-language precondition for enchantments vs Common speakers',
      'Patrol bluff without magic when patrol speaks Common',
    ],
    consumers: [
      'engine/language/gates.ts:resolveLanguageGate',
      'engine/language/comprehension.ts:partyCanUnderstand',
      'engine/overworld/war-patrols.ts:resolvePatrolEncounter',
    ],
  },
  dwarvish: {
    badge: 'Gate: Iron Covenant',
    uses: [
      'War command tongue: Iron Covenant orders & mine/forge traffic',
      'Dispatch intercepts readable with Dwarvish (act on ambush/tribute)',
      'Patrol bluff +2 in tongue, top deal tier unlocked',
    ],
    consumers: [
      'engine/language/gates.ts:resolveLanguageGate',
      'engine/overworld/war-patrols.ts:resolvePatrolEncounter',
      'engine/overworld/war-languages.ts:resolveWarLanguageDealTier',
    ],
  },
  elvish: {
    badge: 'Gate: Emerald Circle',
    uses: [
      'War command tongue: Emerald Circle court speech',
      'Dispatch intercepts readable with Elvish',
      'Shared-language enchantments vs Elvish speakers',
    ],
    consumers: [
      'engine/language/gates.ts:resolveLanguageGate',
      'engine/overworld/war-patrols.ts:resolvePatrolEncounter',
      'engine/overworld/war-languages.ts:resolveWarLanguageDealTier',
    ],
  },
  giant: {
    badge: 'Gate: Frostbound Clan',
    uses: [
      'War command tongue: Frostbound Clan saga-tongue & giant-kin auxiliaries',
      'Dispatch intercepts readable with Giant',
      'Intimidation leverage when raiders hear their saga-tongue',
    ],
    consumers: [
      'engine/language/gates.ts:resolveLanguageGate',
      'engine/overworld/war-patrols.ts:resolvePatrolEncounter',
      'engine/overworld/war-languages.ts:resolveWarLanguageDealTier',
    ],
  },
  gnomish: {
    badge: 'Gate: wards & caches',
    uses: [
      'Party-level gate when counterparty speaks Gnomish (burrow-caches, tinker NPCs)',
      'Comprehend Languages / Tongues bypass when missing',
      'Shared-language enchantments vs Gnomish speakers',
    ],
    consumers: [
      'engine/language/gates.ts:resolveLanguageGate',
      'engine/language/comprehension.ts:partyCanUnderstand',
    ],
  },
  goblin: {
    badge: 'Gate: goblinoids',
    uses: [
      'Party-level gate vs goblinoid bands (sentries, parley-or-ambush reads)',
      'Gesture fallback caps at pass-with-Threat without it',
      'Shared-language enchantments vs Goblin speakers',
    ],
    consumers: [
      'engine/language/gates.ts:resolveLanguageGate',
      'engine/language/comprehension.ts:partyCanUnderstand',
    ],
  },
  halfling: {
    badge: 'Gate: riverfolk',
    uses: [
      'Party-level gate with Halfling riverfolk, scouts & tavern informants',
      'Performance/rumor takes pay full coin instead of tourist surcharge',
      'Shared-language enchantments vs Halfling speakers',
    ],
    consumers: [
      'engine/language/gates.ts:resolveLanguageGate',
      'engine/overworld/hub.ts:tavern rumors',
    ],
  },
  orc: {
    badge: 'Gate: Orc tribe',
    uses: [
      'Local Orc Tribe parley: full negotiation (History unlocks apply)',
      'Without Orcish: gesture path only (trade +25 gp, checks +2 DC)',
      'War command tongue: Bloodtusk Horde orders & war-chants',
    ],
    consumers: [
      'engine/language/gates.ts:resolveLanguageGate',
      'engine/overworld/war-subfactions.ts:orc tribe chain',
      'engine/social/diplomacy.ts:resolveDiplomacy',
      'engine/overworld/war-languages.ts:resolveWarLanguageDealTier',
    ],
  },
  abyssal: {
    badge: 'Gate: fiend assets',
    uses: [
      'Planar officer intercepts readable with Abyssal (cult auxiliaries)',
      'Shared-language precondition: command/suggestion vs Abyssal speakers',
      'Comprehend Languages / Tongues bypass when missing',
    ],
    consumers: [
      'engine/language/gates.ts:resolveLanguageGate',
      'engine/combat/*:shared-language precondition on enchantments',
    ],
  },
  celestial: {
    badge: 'Gate: writs & shrines',
    uses: [
      'Liturgical Celestial seals on Dawn Crown writs & shrine orders',
      'Religion ward identification pairs with Celestial rites text',
      'Shared-language enchantments vs Celestial speakers',
    ],
    consumers: [
      'engine/language/gates.ts:resolveLanguageGate',
      'engine/dungeon/recall.ts:ward_info (religion)',
    ],
  },
  'deep-speech': {
    badge: 'Gate: aberrations',
    uses: [
      'Party-level gate vs aberration minds (intent cues via Insight otherwise)',
      'Ward/decipher tags on aberrant seals',
      'Shared-language enchantments vs Deep Speech speakers',
    ],
    consumers: [
      'engine/language/gates.ts:resolveLanguageGate',
      'engine/dungeon/recall.ts:ward_info (arcana)',
    ],
  },
  draconic: {
    badge: 'Gate: Ashen Spire',
    uses: [
      'War battle-cast callouts: Ashen Spire officers speak Draconic',
      'Acolyte/custom background pick that covers dragon parley',
      'Shared-language enchantments vs Draconic speakers',
    ],
    consumers: [
      'engine/language/gates.ts:resolveLanguageGate',
      'engine/overworld/war-patrols.ts:resolvePatrolEncounter',
      'engine/overworld/war-languages.ts:resolveWarLanguageDealTier',
    ],
  },
  druidic: {
    badge: 'Gate: Druid Circle',
    uses: [
      'Local Druid Circle sub-faction rites (alliance chain)',
      'Nature recall tags on wilds floors pair with Druidic markers',
      'Druid-only gate: non-Druids need Comprehend Languages or a guide',
    ],
    consumers: [
      'engine/language/gates.ts:resolveLanguageGate',
      'engine/overworld/war-subfactions.ts:druid circle chain',
    ],
  },
  infernal: {
    badge: 'Gate: Ashen Spire',
    uses: [
      'War command tongue: Ashen Spire officers (orders encrypted in Infernal)',
      'Dispatch intercepts readable with Infernal (attack warnings, tribute routes)',
      'Shared-language enchantments vs Infernal speakers',
    ],
    consumers: [
      'engine/language/gates.ts:resolveLanguageGate',
      'engine/overworld/war-patrols.ts:resolvePatrolEncounter',
      'engine/overworld/war-languages.ts:resolveWarLanguageDealTier',
    ],
  },
  primordial: {
    badge: 'Gate: elementals',
    uses: [
      'Party-level gate vs elemental vessels & primordial shrines',
      'Ward identification on primordial seals (Arcana/Religion)',
      'Shared-language enchantments vs Primordial speakers',
    ],
    consumers: [
      'engine/language/gates.ts:resolveLanguageGate',
      'engine/dungeon/recall.ts:ward_info',
    ],
  },
  sylvan: {
    badge: 'Gate: Emerald rites',
    uses: [
      'Emerald Circle rites unintelligible without Sylvan (court speech is Elvish)',
      'Fey parley & shrine outcomes gate on Sylvan',
      'Shared-language enchantments vs Sylvan speakers',
    ],
    consumers: [
      'engine/language/gates.ts:resolveLanguageGate',
      'engine/overworld/settlements.ts:shrine outcomes',
    ],
  },
  'thieves-cant': {
    badge: 'Gate: underworld',
    uses: [
      'Rogue underworld marks, dead drops & fence parley',
      'Sleight-of-Hand theft planning cues in cities',
      'Thieves’ Guild covert-asset deals (War Room hire row)',
    ],
    consumers: [
      'engine/language/gates.ts:resolveLanguageGate',
      'engine/dungeon/theft.ts:resolveTheftAttempt',
      'engine/overworld/war-contracts.ts:hireCovertAsset',
    ],
  },
  undercommon: {
    badge: 'Gate: Underdark',
    uses: [
      'Underdark trader parley & sealed writs (fetch_translator fallback)',
      'Deep-delver dispatch intercepts in Delve loot',
      'Shared-language enchantments vs Undercommon speakers',
    ],
    consumers: [
      'engine/language/gates.ts:resolveLanguageGate',
      'engine/dungeon/roguelite.ts:delve intercepts',
    ],
  },
};

/**
 * Languages with no mechanical path yet. Each entry MUST carry an explicit
 * tracking ticket — this is the escape hatch the gate recognizes instead
 * of failing. Empty today: all 18 bundled languages are supported.
 */
export const TRACKED_UNSUPPORTED_LANGUAGES: Record<string, string> = {};

// ---------------------------------------------------------------------------
// Skill relevance (all 18 SRD skills have an engine verb)
// ---------------------------------------------------------------------------

interface SkillRelevanceEntry {
  badge: string;
  uses: string[];
  consumers: string[];
}

export const SKILL_RELEVANCE: Record<SkillId, SkillRelevanceEntry> = {
  acrobatics: {
    badge: 'Grapple defense',
    uses: [
      'Defend vs Grapple/Shove (Acrobatics or Athletics, target picks)',
      'Balance & narrow-ledge traversal in dungeon exploration',
    ],
    consumers: [
      'engine/combat/attack.ts:grapple/shove contest',
      'engine/dungeon/state.ts:traversal checks',
    ],
  },
  'animal-handling': {
    badge: 'Beast verb',
    uses: [
      'Calm / befriend / command beasts (WIS check; befriend buys the parley round)',
      'Mounts & pack animals: camp perception, off-road travel discount',
    ],
    consumers: [
      'engine/social/contests.ts:animal handling read',
      'engine/overworld/travel.ts:mount handling',
    ],
  },
  arcana: {
    badge: 'Recall + identify',
    uses: [
      'Recall: ward_info on wizard-lair tags before trigger',
      'Counterspell identification (pass sees name/level; fail still counters blind)',
      'Decipher arcane seals & spell loot',
    ],
    consumers: [
      'engine/dungeon/recall.ts:arcana recall',
      'engine/combat/reactions.ts:counterspell identification',
    ],
  },
  athletics: {
    badge: 'Grapple / Shove',
    uses: [
      'Grapple & Shove contests (STR vs Athletics/Acrobatics)',
      'Climb, swim, forced-entry assist (Athletics + rope on fortress approaches)',
    ],
    consumers: [
      'engine/combat/attack.ts:grapple/shove contest',
      'engine/overworld/war-missions.ts:resolveMissionApproach',
    ],
  },
  deception: {
    badge: 'Social leg',
    uses: ['Diplomacy triple-approach: trick (later fallout)', 'Patrol bluff & envoy parley (opposed by Insight; passive is the floor)'],
    consumers: [
      'engine/social/diplomacy.ts:resolveDiplomacy',
      'engine/social/contests.ts:opposed Insight vs Deception',
      'engine/overworld/war-patrols.ts:resolvePatrolEncounter',
    ],
  },
  history: {
    badge: 'Recall unlocks',
    uses: [
      'Recall: reveal_quest (battlefields, caches) & trap_bonus (+2 detection)',
      'Diplomacy History stage: success lowers final DC by 2, unlocks alliance tier',
      'Free recall per delve (proficient) via delve recall tags',
    ],
    consumers: [
      'engine/dungeon/recall.ts:history recall',
      'engine/social/diplomacy.ts:history unlock stage',
    ],
  },
  insight: {
    badge: 'Opposed read',
    uses: ['Opposed vs Deception (passive is the floor; “something feels off” cue)', 'Tribe/envoy/truce reads & language-barrier intent cues'],
    consumers: [
      'engine/social/contests.ts:opposed Insight vs Deception',
      'engine/language/gates.ts:getLanguageBarrierIntentCue',
      'engine/social/diplomacy.ts:insight read stage',
    ],
  },
  intimidation: {
    badge: 'Social leg',
    uses: ['Diplomacy triple-approach: compliance (frightened + attitude cost)', 'Bloodied enemies check morale earlier; failed bluffs fall back at +2 DC'],
    consumers: [
      'engine/social/diplomacy.ts:resolveDiplomacy',
      'engine/ai/planner.ts:morale checks',
    ],
  },
  investigation: {
    badge: 'Trap verb',
    uses: ['Detect & disarm traps, find secret doors (pairs with Perception)', 'Recall trap_bonus applies to Investigation as well as Perception'],
    consumers: ['engine/dungeon/props.ts:trap/secret-door checks', 'engine/dungeon/recall.ts:trap_bonus'],
  },
  medicine: {
    badge: 'Stabilize DC 10',
    uses: ['Stabilize dying creature (DC 10; healer’s kit grants advantage)', 'Diagnose poison/disease → correct cure path (antitoxin / lesser restoration)'],
    consumers: ['engine/combat/damage.ts:stabilizeCreature', 'engine/overworld/hub.ts:temple diagnosis'],
  },
  nature: {
    badge: 'Recall: wilds',
    uses: ['Recall: beast/plant/terrain lore (what it is / is it safe)', 'Forage split with Survival (Nature knows, Survival gathers; +1 ration yield)'],
    consumers: ['engine/dungeon/recall.ts:nature recall', 'engine/overworld/travel.ts:forage identify'],
  },
  perception: {
    badge: 'Trap verb',
    uses: ['Passive Perception spots traps, secret doors & ambushes', 'Listen at door (WIS Perception vs listenDc → tiered occupant hints)', 'Opposed vs Stealth (hiding, surprise, theft-adjacent sneaking)'],
    consumers: [
      'engine/dungeon/props.ts:passive perception traps',
      'engine/dungeon/props.ts:listen at door',
      'engine/combat/surprise.ts:surprise checks',
    ],
  },
  performance: {
    badge: 'Tavern verb',
    uses: ['Earn coin + rumors on one roll (fail-forward: half coin, no rumor)', 'Distract (Help-equivalent from 30 ft) & cover identity (blend-in advantage hook)'],
    consumers: ['engine/overworld/hub.ts:tavern performance', 'engine/combat/*:distract help-equivalent'],
  },
  persuasion: {
    badge: 'Social leg',
    uses: ['Diplomacy triple-approach: alliance / fair terms (History unlocks top tier)', 'Tribe parley, envoy missions, truce & tribute negotiation'],
    consumers: [
      'engine/social/diplomacy.ts:resolveDiplomacy',
      'engine/overworld/war-diplomacy.ts:truce negotiation',
      'engine/overworld/war-patrols.ts:resolvePatrolEncounter',
    ],
  },
  religion: {
    badge: 'Recall: wards',
    uses: ['Recall: ward_info on undead-crypt tags; consecration/shrine outcomes', 'Cleanse-cursed-mine dungeon verb; +1 HP when receiving magical healing (proficient)'],
    consumers: ['engine/dungeon/recall.ts:religion recall', 'engine/overworld/settlements.ts:shrine outcomes'],
  },
  'sleight-of-hand': {
    badge: 'Theft verb',
    uses: ['Pickpocket / plant / lift key / snip pouch (DEX vs passive Perception)', 'Thieves’ tools grant advantage; Fast Hands (Thief 3) theft as bonus action'],
    consumers: ['engine/dungeon/theft.ts:resolveTheftAttempt', 'engine/combat/*:Fast Hands bonus action'],
  },
  stealth: {
    badge: 'Hide & surprise',
    uses: ['Combat hide (DEX Stealth vs hostile passive Perception → hidden/unseen attacker)', 'Exploration stealth & surprise checks; Cunning Action bonus-action hide'],
    consumers: ['engine/combat/*:hide action', 'engine/combat/surprise.ts:surprise checks', 'engine/overworld/war-patrols.ts:evasion'],
  },
  survival: {
    badge: 'Travel verb',
    uses: ['Forage & track; wilderness camp safety & ambush-roll mitigation', 'Expedition patrol evasion (Stealth/Survival) & forced-march endurance'],
    consumers: ['engine/overworld/travel.ts:forage/track', 'engine/overworld/expeditions.ts:patrol evasion'],
  },
};

/**
 * Skills with no mechanical path yet. Each entry MUST carry an explicit
 * tracking ticket. Empty today: all 18 SRD skills are supported.
 */
export const TRACKED_UNSUPPORTED_SKILLS: Record<string, string> = {};

// ---------------------------------------------------------------------------
// Spell relevance (derived from spell data; every compendium id resolves)
// ---------------------------------------------------------------------------

export const LANGUAGE_DEPENDENT_ENCHANTMENT_IDS = [
  'command',
  'suggestion',
  'charm-person',
  'hideous-laughter',
  'vicious-mockery',
  'divine-word',
] as const;

const LANGUAGE_DEPENDENT_SET: ReadonlySet<string> = new Set(
  LANGUAGE_DEPENDENT_ENCHANTMENT_IDS,
);

export const SPELL_UTILITY_SPOTLIGHT: Record<string, string[]> = {
  'comprehend-languages': [
    'Out-of-combat comprehension (opens any tongue gate)',
    'Ritual (10 min, no slot when ritual-cast)',
  ],
  tongues: [
    'Out-of-combat comprehension (caster understood by any listener)',
    'Opens any tongue gate incl. war dispatches',
  ],
  'detect-magic': ['Sense active magical effects & wards in range', 'Out-of-combat + ritual value'],
  knock: ['Prop hook: unlock + loud report (adjacent-room alert tradeoff)', 'Out-of-combat alongside tools/Athletics'],
  sanctuary: ['Ward: attackers must pass WIS save or redirect', 'Protects parley VIPs & downed allies'],
  sleep: ['HP-pool resolution (lowest-HP creatures fall unconscious first)', 'Bypasses saves; ends Bloodied standoffs'],
  shield: ['Reaction +5 AC (live buff id reconciled)', 'Turns hits into misses; negates magic missile'],
  wish: [
    'Bounded capstone: fixed boon menu (restore, resistance, supply, rest, heal, resurrection)',
    'Stress: non-duplication risks never casting Wish again',
  ],
  'time-stop': [
    'Bounded capstone: 1d4+1 solo turns, others frozen',
    'Ends early if the caster affects another creature',
  ],
  'cure-wounds': ['Out-of-combat healing (required acceptance path)', 'Combat heal with slot scaling'],
  'healing-word': ['Bonus-action ranged heal (Bonus Action spell rule applies)', 'Revives downed allies at range'],
  fireball: ['AOE template with foe/ally preview (friendly-fire toggle)', 'Dex save for half; cover applies'],
  counterspell: ['Reaction interrupt (Arcana identification gates what you see)', 'Blind counterspell still offered on failed ID'],
  'speak-with-animals': ['Parley with beasts (approach-dialogue hook)', 'Out-of-combat social path'],
  'disguise-self': ['Cover-identity approach (Performance/Deception pairing)', 'Out-of-combat infiltration'],
};

export interface SpellLike {
  id: string;
  name: string;
  level: number;
  school: string;
  ritual?: boolean;
  concentration?: boolean;
  description: string;
}

/** Derives executable relevance paths for a spell record. Never empty for known spells. */
export function getSpellRelevancePaths(spell: SpellLike): string[] {
  const norm = spell.id.trim().toLowerCase();
  const paths: string[] = [];
  if (spell.level === 0) paths.push('Cantrip (at-will combat)');
  else paths.push(`L${spell.level} ${spell.school}`);
  if (spell.ritual) paths.push('Ritual (out-of-combat, time cost)');
  if (spell.concentration) paths.push('Concentration');
  if (LANGUAGE_DEPENDENT_SET.has(norm)) {
    paths.push('Social (requires shared tongue — gate or magic)');
  } else if (spell.school === 'enchantment' || spell.school === 'illusion') {
    paths.push('Social / control');
  }
  const spotlight = SPELL_UTILITY_SPOTLIGHT[norm];
  if (spotlight) paths.push(...spotlight);
  else if (
    spell.level >= 1 &&
    /heal|restore|reviv|cure/i.test(`${spell.name} ${spell.description}`)
  ) {
    paths.push('Out-of-combat healing');
  } else if (/damage|save|attack/i.test(spell.description)) {
    paths.push('Combat (save / attack)');
  } else {
    paths.push('Executable Effect DSL (combat + out-of-combat)');
  }
  return paths;
}

/**
 * Spells with no mechanical path yet. Each entry MUST carry an explicit
 * tracking ticket. Empty today: every bundled spell has an executable path.
 */
export const TRACKED_UNSUPPORTED_SPELLS: Record<string, string> = {};

// ---------------------------------------------------------------------------
// Registry accessors (shared by data validator, engine gate, client badges)
// ---------------------------------------------------------------------------

export function getLanguageRelevanceInfo(
  languageId: string,
  knownLanguageIds?: readonly string[],
): LanguageRelevanceInfo {
  const norm = languageId.trim().toLowerCase();
  const entry = LANGUAGE_RELEVANCE[norm];
  if (entry) {
    return {
      id: norm,
      status: 'supported',
      badge: entry.badge,
      uses: [...entry.uses],
      consumers: [...entry.consumers],
    };
  }
  const tracked = TRACKED_UNSUPPORTED_LANGUAGES[norm];
  if (tracked !== undefined) {
    return {
      id: norm,
      status: 'unsupported',
      badge: 'No verb yet (tracked)',
      uses: [],
      consumers: [],
      trackingTicket: tracked,
    };
  }
  if (knownLanguageIds?.includes(norm)) {
    // Forward-compatible: any compendium language not yet hand-tagged still
    // opens the generic party-level gate (§2.2), so it is never dead.
    return {
      id: norm,
      status: 'supported',
      badge: 'Party gate',
      uses: [
        'Party-level language gate (shared tongue or Comprehend/Tongues)',
        'Shared-language precondition for enchantments',
      ],
      consumers: [
        'engine/language/gates.ts:resolveLanguageGate',
        'engine/language/comprehension.ts:partyCanUnderstand',
      ],
    };
  }
  return {
    id: norm,
    status: 'unsupported',
    badge: 'Unknown tongue',
    uses: [],
    consumers: [],
    trackingTicket: RELEVANCE_TRACKING_TICKET,
  };
}

export function getSkillRelevanceInfo(skillId: string): SkillRelevanceInfo {
  const norm = skillId.trim().toLowerCase() as SkillId;
  const isKnown = (SKILL_IDS as readonly string[]).includes(norm);
  const entry = isKnown ? SKILL_RELEVANCE[norm as SkillId] : undefined;
  if (entry) {
    return {
      id: norm as SkillId,
      status: 'supported',
      badge: entry.badge,
      uses: [...entry.uses],
      consumers: [...entry.consumers],
    };
  }
  const tracked = TRACKED_UNSUPPORTED_SKILLS[norm];
  if (tracked !== undefined) {
    return {
      id: norm as SkillId,
      status: 'unsupported',
      badge: 'No verb yet (tracked)',
      uses: [],
      consumers: [],
      trackingTicket: tracked,
    };
  }
  return {
    id: norm as SkillId,
    status: 'unsupported',
    badge: 'No verb yet',
    uses: [],
    consumers: [],
    trackingTicket: RELEVANCE_TRACKING_TICKET,
  };
}

export function getSpellRelevanceInfo(
  spellId: string,
  spellLookup: (id: string) => SpellLike | undefined,
): SpellRelevanceInfo {
  const norm = spellId.trim().toLowerCase();
  const tracked = TRACKED_UNSUPPORTED_SPELLS[norm];
  if (tracked !== undefined) {
    return {
      id: norm,
      status: 'unsupported',
      paths: [],
      badge: 'No executable path yet (tracked)',
      detail: `Spell "${norm}" is explicitly tracked as unsupported (ticket ${tracked}).`,
      trackingTicket: tracked,
    };
  }
  const spell = spellLookup(norm);
  if (!spell) {
    return {
      id: norm,
      status: 'unsupported',
      paths: [],
      badge: 'Missing compendium entry',
      detail: `Spell id "${norm}" does not resolve in the compendium.`,
      trackingTicket: RELEVANCE_TRACKING_TICKET,
    };
  }
  const paths = getSpellRelevancePaths(spell);
  return {
    id: norm,
    status: 'supported',
    paths,
    badge: spell.ritual ? 'Ritual + executable' : 'Executable',
    detail: paths.join(' · '),
  };
}

// ---------------------------------------------------------------------------
// Offered-content collectors (everything the builder/AI can offer)
// ---------------------------------------------------------------------------

function collectChoiceSkillOptions(dataset: SrdIngestionInput): Array<{ collection: string; entityId: string; choiceId: string; option: string }> {
  const out: Array<{ collection: string; entityId: string; choiceId: string; option: string }> = [];
  const pushChoices = (
    collection: string,
    entityId: string,
    choices: readonly { id: string; type: string; from?: { mode: string; options?: readonly string[] } }[] | undefined,
  ): void => {
    if (!choices) return;
    for (const choice of choices) {
      if (choice.type === 'skill' && choice.from?.mode === 'explicit') {
        for (const opt of choice.from.options ?? []) {
          out.push({ collection, entityId, choiceId: choice.id, option: opt });
        }
      }
    }
  };
  for (const cls of dataset.classes) {
    pushChoices('classes', cls.id, [cls.skillChoices, ...(cls.toolChoices ?? [])]);
  }
  for (const bg of dataset.backgrounds) {
    pushChoices('backgrounds', bg.id, bg.choices);
    for (const s of bg.skillProficiencies ?? []) {
      out.push({ collection: 'backgrounds', entityId: bg.id, choiceId: '(direct)', option: s });
    }
  }
  for (const race of dataset.races) {
    for (const trait of race.traits ?? []) pushChoices('races', race.id, trait.choices);
    pushChoices('races', race.id, race.choices);
  }
  for (const subrace of dataset.subraces) {
    for (const trait of subrace.traits ?? []) pushChoices('subraces', subrace.id, trait.choices);
    pushChoices('subraces', subrace.id, subrace.choices);
  }
  for (const feat of dataset.feats) pushChoices('feats', feat.id, feat.choices);
  for (const feature of dataset.features) pushChoices('features', feature.id, feature.choices);
  return out;
}

function collectChoiceLanguageOptions(dataset: SrdIngestionInput): Array<{ collection: string; entityId: string; choiceId: string; option: string }> {
  const out: Array<{ collection: string; entityId: string; choiceId: string; option: string }> = [];
  const pushChoices = (
    collection: string,
    entityId: string,
    choices: readonly { id: string; type: string; from?: { mode: string; options?: readonly string[] } }[] | undefined,
  ): void => {
    if (!choices) return;
    for (const choice of choices) {
      if (choice.type === 'language' && choice.from?.mode === 'explicit') {
        for (const opt of choice.from.options ?? []) {
          out.push({ collection, entityId, choiceId: choice.id, option: opt });
        }
      }
    }
  };
  for (const race of dataset.races) {
    for (const lang of race.languages ?? []) {
      out.push({ collection: 'races', entityId: race.id, choiceId: '(direct)', option: lang });
    }
    for (const trait of race.traits ?? []) pushChoices('races', race.id, trait.choices);
    pushChoices('races', race.id, race.choices);
  }
  for (const subrace of dataset.subraces) {
    for (const lang of subrace.languages ?? []) {
      out.push({ collection: 'subraces', entityId: subrace.id, choiceId: '(direct)', option: lang });
    }
    pushChoices('subraces', subrace.id, subrace.choices);
  }
  for (const bg of dataset.backgrounds) {
    for (const lang of bg.languages ?? []) {
      out.push({ collection: 'backgrounds', entityId: bg.id, choiceId: '(direct)', option: lang });
    }
    pushChoices('backgrounds', bg.id, bg.choices);
  }
  for (const feat of dataset.feats) pushChoices('feats', feat.id, feat.choices);
  for (const feature of dataset.features) pushChoices('features', feature.id, feature.choices);
  for (const cls of dataset.classes) {
    pushChoices('classes', cls.id, [cls.skillChoices, ...(cls.toolChoices ?? [])]);
  }
  return out;
}

export interface OfferedSpellRef {
  collection: string;
  entityId: string;
  context: string;
  spellId: string;
}

/** Every spell id referenced anywhere offerable (innate, grants, monster casting). */
export function collectOfferedSpellRefs(dataset: SrdIngestionInput): OfferedSpellRef[] {
  const refs: OfferedSpellRef[] = [];
  for (const race of dataset.races) {
    for (const trait of race.traits ?? []) {
      for (const grant of trait.innateSpells ?? []) {
        refs.push({
          collection: 'races',
          entityId: race.id,
          context: `trait(${trait.id}).innateSpells`,
          spellId: grant.spellId,
        });
      }
    }
  }
  for (const subrace of dataset.subraces) {
    for (const trait of subrace.traits ?? []) {
      for (const grant of trait.innateSpells ?? []) {
        refs.push({
          collection: 'subraces',
          entityId: subrace.id,
          context: `trait(${trait.id}).innateSpells`,
          spellId: grant.spellId,
        });
      }
    }
  }
  for (const sc of dataset.subclasses) {
    for (const grant of sc.spells ?? []) {
      for (const spellId of grant.spellIds ?? []) {
        refs.push({
          collection: 'subclasses',
          entityId: sc.id,
          context: `spell grant (level ${grant.classLevel})`,
          spellId,
        });
      }
    }
  }
  const pushMonsterSpellcasting = (
    monsterId: string,
    context: string,
    sc: { atWillSpellIds?: readonly string[]; preparedSpellIds?: readonly string[]; perDaySpells?: readonly { spellIds: readonly string[] }[] } | undefined,
  ): void => {
    if (!sc) return;
    for (const id of sc.atWillSpellIds ?? []) {
      refs.push({ collection: 'monsters', entityId: monsterId, context: `${context}.atWill`, spellId: id });
    }
    for (const id of sc.preparedSpellIds ?? []) {
      refs.push({ collection: 'monsters', entityId: monsterId, context: `${context}.prepared`, spellId: id });
    }
    for (const group of sc.perDaySpells ?? []) {
      for (const id of group.spellIds ?? []) {
        refs.push({ collection: 'monsters', entityId: monsterId, context: `${context}.perDay`, spellId: id });
      }
    }
  };
  for (const monster of dataset.monsters) {
    pushMonsterSpellcasting(monster.id, 'spellcasting', monster.spellcasting);
    for (const trait of monster.traits ?? []) {
      pushMonsterSpellcasting(monster.id, `trait(${trait.id}).spellcasting`, trait.spellcasting);
    }
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Coverage validator (wired into validateSrdDataset as `relevance` errors)
// ---------------------------------------------------------------------------

/**
 * Validates the Spec 11 §1 relevance contract against a dataset.
 *
 * Fails on any new dangling offered content:
 * - a builder-offered spell id that does not resolve in the compendium
 *   (or a spell ChoiceSpec classList with zero spells);
 * - an offered skill/language with neither a supported registry entry nor
 *   an explicit tracking ticket.
 */
export function validateRelevanceCoverage(dataset: SrdIngestionInput): RelevanceCoverageError[] {
  const errors: RelevanceCoverageError[] = [];
  const err = (collection: string, message: string, entityId?: string): void => {
    errors.push({ category: 'relevance', collection, ...(entityId ? { entityId } : {}), message });
  };

  const knownLanguageIds = dataset.proficienciesAndLanguages.languages.map((l) => l.id);
  const knownLanguageSet = new Set(knownLanguageIds.map((s) => s.toLowerCase()));
  const spellMap = new Map(dataset.spells.map((s) => [s.id.toLowerCase(), s]));
  const spellLookup = (id: string): SpellLike | undefined => {
    const found = spellMap.get(id.trim().toLowerCase());
    return found
      ? {
          id: found.id,
          name: found.name,
          level: found.level,
          school: found.school,
          ritual: found.ritual,
          concentration: found.concentration,
          description: found.description,
        }
      : undefined;
  };

  // 1. Every canonical skill must have a supported entry or tracked ticket.
  // NOTE: only entries in TRACKED_UNSUPPORTED_SKILLS count as explicit
  // tracking — the generic SRD-1212 fallback ticket on unknown ids does not
  // satisfy the gate (otherwise new dangling content would pass silently).
  for (const skill of dataset.abilitiesAndSkills.skills) {
    const norm = skill.id.trim().toLowerCase();
    const info = getSkillRelevanceInfo(skill.id);
    if (info.status !== 'supported') {
      if (TRACKED_UNSUPPORTED_SKILLS[norm] === undefined) {
        err('abilities-and-skills', `Skill "${skill.id}" has no relevance entry and no tracking ticket`, skill.id);
      }
    } else if (info.uses.length === 0 || info.consumers.length === 0) {
      err('abilities-and-skills', `Skill "${skill.id}" has a supported entry with no uses/consumers`, skill.id);
    }
  }

  // 2. Every bundled language must have a supported entry or tracked ticket.
  for (const lang of dataset.proficienciesAndLanguages.languages) {
    const norm = lang.id.trim().toLowerCase();
    const info = getLanguageRelevanceInfo(lang.id, knownLanguageIds);
    if (info.status !== 'supported') {
      if (TRACKED_UNSUPPORTED_LANGUAGES[norm] === undefined) {
        err('languages', `Language "${lang.id}" has no relevance entry and no tracking ticket`, lang.id);
      }
    } else if (info.uses.length === 0 || info.consumers.length === 0) {
      err('languages', `Language "${lang.id}" has a supported entry with no uses/consumers`, lang.id);
    }
  }

  // 3. Every bundled spell must resolve to an executable relevance path.
  for (const spell of dataset.spells) {
    const norm = spell.id.trim().toLowerCase();
    const info = getSpellRelevanceInfo(spell.id, spellLookup);
    if (info.status !== 'supported') {
      if (TRACKED_UNSUPPORTED_SPELLS[norm] === undefined) {
        err('spells', `Spell "${spell.id}" has no executable relevance path and no tracking ticket`, spell.id);
      }
    } else if (info.paths.length === 0) {
      err('spells', `Spell "${spell.id}" has a supported entry with no relevance paths`, spell.id);
    }
  }

  // 4. Every offered (referenced) spell id must resolve + carry a path.
  // Only TRACKED_UNSUPPORTED_SPELLS counts as explicit tracking; a missing
  // compendium entry always fails the gate.
  for (const ref of collectOfferedSpellRefs(dataset)) {
    const norm = ref.spellId.trim().toLowerCase();
    if (TRACKED_UNSUPPORTED_SPELLS[norm] !== undefined) continue;
    if (!spellMap.has(norm)) {
      err(
        ref.collection,
        `Offered spell "${ref.spellId}" in ${ref.context} does not resolve in the compendium (relevance gate ${RELEVANCE_TRACKING_TICKET})`,
        ref.entityId,
      );
      continue;
    }
    const info = getSpellRelevanceInfo(ref.spellId, spellLookup);
    if (info.status !== 'supported') {
      err(
        ref.collection,
        `Offered spell "${ref.spellId}" in ${ref.context} has no executable path and no tracking ticket`,
        ref.entityId,
      );
    }
  }

  // 5. Spell ChoiceSpec classLists must offer at least one resolvable spell.
  const checkSpellChoices = (
    collection: string,
    entityId: string,
    choices: readonly { id: string; type: string; classList?: string }[] | undefined,
  ): void => {
    if (!choices) return;
    for (const choice of choices) {
      if (choice.type === 'spell' && choice.classList) {
        const offered = dataset.spells.filter((s) =>
          s.classes.map((c) => c.toLowerCase()).includes(choice.classList!.toLowerCase()),
        );
        if (offered.length === 0 && TRACKED_UNSUPPORTED_SPELLS[choice.classList.toLowerCase()] === undefined) {
          err(
            collection,
            `Spell choice "${choice.id}" offers classList "${choice.classList}" with zero resolvable spells (dangling offering)`,
            entityId,
          );
        }
      }
    }
  };
  for (const cls of dataset.classes) {
    checkSpellChoices('classes', cls.id, [cls.skillChoices] as never);
  }
  for (const bg of dataset.backgrounds) checkSpellChoices('backgrounds', bg.id, bg.choices as never);
  for (const feat of dataset.feats) checkSpellChoices('feats', feat.id, feat.choices as never);
  for (const feature of dataset.features) checkSpellChoices('features', feature.id, feature.choices as never);

  // 6. Every offered skill option must resolve + carry a verb (or ticket).
  for (const offered of collectChoiceSkillOptions(dataset)) {
    const normSkill = offered.option.trim().toLowerCase();
    const info = getSkillRelevanceInfo(offered.option);
    if (info.status !== 'supported' && TRACKED_UNSUPPORTED_SKILLS[normSkill] === undefined) {
      err(
        offered.collection,
        `Offered skill "${offered.option}" in choice "${offered.choiceId}" has no mechanical verb and no tracking ticket`,
        offered.entityId,
      );
    }
    if (!(SKILL_IDS as readonly string[]).includes(offered.option.trim().toLowerCase())) {
      err(
        offered.collection,
        `Offered skill "${offered.option}" in choice "${offered.choiceId}" does not resolve to a canonical skill`,
        offered.entityId,
      );
    }
  }

  // 7. Every offered language must resolve + open a gate (or ticket).
  for (const offered of collectChoiceLanguageOptions(dataset)) {
    const norm = offered.option.trim().toLowerCase();
    const info = getLanguageRelevanceInfo(offered.option, knownLanguageIds);
    if (info.status !== 'supported' && TRACKED_UNSUPPORTED_LANGUAGES[norm] === undefined) {
      err(
        offered.collection,
        `Offered language "${offered.option}" in "${offered.choiceId}" has no gate and no tracking ticket`,
        offered.entityId,
      );
    }
    if (!knownLanguageSet.has(norm) && TRACKED_UNSUPPORTED_LANGUAGES[norm] === undefined) {
      err(
        offered.collection,
        `Offered language "${offered.option}" in "${offered.choiceId}" does not resolve in proficiencies-and-languages`,
        offered.entityId,
      );
    }
  }

  // 8. SRD-1304: every magic item must carry executable mechanics — a
  // non-empty `modifiers` array or at least one activated ability. Dead
  // entries (empty modifiers + no abilities) fail the gate.
  for (const item of dataset.magicItems) {
    const hasModifiers = (item.modifiers?.length ?? 0) > 0;
    const hasAbilities = (item.activatedAbilities?.length ?? 0) > 0;
    if (!hasModifiers && !hasAbilities) {
      err(
        'magic-items',
        `Magic item "${item.id}" has empty modifiers and no activated abilities (dead entry)`,
        item.id,
      );
    }
  }

  return errors;
}
