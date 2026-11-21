import {
  SKILL_IDS,
  type SkillId,
  type SrdCompendium,
  defaultCompendium,
} from '@srd5/data';

/**
 * SRD-1211: Builder mechanical-status badging + party-aware hints.
 *
 * Spec 11 §6 — "No silent dead picks": every language / skill / spell offered
 * in the builder must show its mechanical status (where it matters: quest
 * tag, gate, verb) via the same tooltip pattern as the spell cards, plus
 * party-aware hints when queued content gates on missing coverage.
 *
 * This module is the single source of truth for those badges. It is
 * intentionally data-driven and headless-testable: the UI layers
 * (`ChoiceSpecSelector`, `SpellsStep`, `ReviewStep`, campfire assembly) only
 * render what these helpers return.
 *
 * Relevance grounding (all implemented engine paths, no display-only text):
 * - Languages: party-level gate resolution (`partyCanUnderstand`,
 *   SRD-1202 `resolveLanguageGate` / `resolveOrcTribeParley`), comprehension
 *   magic (`comprehend-languages` / `tongues`, SRD-1201), shared-language
 *   preconditions on enchantments (`command`, `suggestion`, `charm-person`,
 *   `hideous-laughter`, `vicious-mockery`, `divine-word`), and war dispatch /
 *   patrol bluff tiers (Spec 11 §2.4 Phase 1).
 * - Skills: every one of the 18 skills has an engine verb after
 *   SRD-1206..1208 (theft, recall passives, opposed Insight, stabilize,
 *   intimidation, animal handling, nature lore, performance, combat hide,
 *   grapple/shove contests, trap/secret-door detection, travel/forage).
 * - Spells: every compendium id resolves (SRD-1201 dangling-ref fix); paths
 *   derive from spell data (combat, out-of-combat healing/buff, ritual,
 *   detection/utility, social enchantment gate, capstone menu).
 */

export type MechanicalStatus = 'supported' | 'unsupported';

export interface LanguageMechanicalInfo {
  id: string;
  status: MechanicalStatus;
  /** Short badge label, e.g. "Gate: Orc tribe". */
  badge: string;
  /** Mechanical paths (rendered in tooltips). */
  uses: string[];
  /** Tracking ticket when explicitly unsupported (SRD-1212 gate). */
  trackingTicket?: string;
}

export interface SkillMechanicalInfo {
  id: SkillId;
  status: MechanicalStatus;
  badge: string;
  uses: string[];
  trackingTicket?: string;
}

export interface SpellMechanicalInfo {
  id: string;
  status: MechanicalStatus;
  /** Executable paths, e.g. combat / out-of-combat / ritual / social. */
  paths: string[];
  badge: string;
  detail: string;
  trackingTicket?: string;
}

export interface PartyCoverageHint {
  id: string;
  severity: 'missing' | 'suggestion';
  message: string;
  remedy: string;
}

// ---------------------------------------------------------------------------
// Language mechanics (all 18 SRD languages — every one opens a real gate)
// ---------------------------------------------------------------------------

const LANGUAGE_USES: Record<string, { badge: string; uses: string[] }> = {
  common: {
    badge: 'Trade tongue',
    uses: [
      'Baseline parley tongue (no penalty)',
      'Shared-language precondition for enchantments vs Common speakers',
      'Patrol bluff without magic when patrol speaks Common',
    ],
  },
  dwarvish: {
    badge: 'Gate: Iron Covenant',
    uses: [
      'War command tongue: Iron Covenant orders & mine/forge traffic',
      'Dispatch intercepts readable with Dwarvish (act on ambush/tribute)',
      'Patrol bluff +2 in tongue, top deal tier unlocked',
    ],
  },
  elvish: {
    badge: 'Gate: Emerald Circle',
    uses: [
      'War command tongue: Emerald Circle court speech',
      'Dispatch intercepts readable with Elvish',
      'Shared-language enchantments vs Elvish speakers',
    ],
  },
  giant: {
    badge: 'Gate: Frostbound Clan',
    uses: [
      'War command tongue: Frostbound Clan saga-tongue & giant-kin auxiliaries',
      'Dispatch intercepts readable with Giant',
      'Intimidation leverage when raiders hear their saga-tongue',
    ],
  },
  gnomish: {
    badge: 'Gate: wards & caches',
    uses: [
      'Party-level gate when counterparty speaks Gnomish (burrow-caches, tinker NPCs)',
      'Comprehend Languages / Tongues bypass when missing',
      'Shared-language enchantments vs Gnomish speakers',
    ],
  },
  goblin: {
    badge: 'Gate: goblinoids',
    uses: [
      'Party-level gate vs goblinoid bands (sentries, parley-or-ambush reads)',
      'Gesture fallback caps at pass-with-Threat without it',
      'Shared-language enchantments vs Goblin speakers',
    ],
  },
  halfling: {
    badge: 'Gate: riverfolk',
    uses: [
      'Party-level gate with Halfling riverfolk, scouts & tavern informants',
      'Performance/rumor takes pay full coin instead of tourist surcharge',
      'Shared-language enchantments vs Halfling speakers',
    ],
  },
  orc: {
    badge: 'Gate: Orc tribe',
    uses: [
      'Local Orc Tribe parley: full negotiation (History unlocks apply)',
      'Without Orcish: gesture path only (trade +25 gp, checks +2 DC)',
      'War command tongue: Bloodtusk Horde orders & war-chants',
    ],
  },
  abyssal: {
    badge: 'Gate: fiend assets',
    uses: [
      'Planar officer intercepts readable with Abyssal (cult auxiliaries)',
      'Shared-language precondition: command/suggestion vs Abyssal speakers',
      'Comprehend Languages / Tongues bypass when missing',
    ],
  },
  celestial: {
    badge: 'Gate: writs & shrines',
    uses: [
      'Liturgical Celestial seals on Dawn Crown writs & shrine orders',
      'Religion ward identification pairs with Celestial rites text',
      'Shared-language enchantments vs Celestial speakers',
    ],
  },
  'deep-speech': {
    badge: 'Gate: aberrations',
    uses: [
      'Party-level gate vs aberration minds (intent cues via Insight otherwise)',
      'Ward/decipher tags on aberrant seals',
      'Shared-language enchantments vs Deep Speech speakers',
    ],
  },
  draconic: {
    badge: 'Gate: Ashen Spire',
    uses: [
      'War battle-cast callouts: Ashen Spire officers speak Draconic',
      'Acolyte/custom background pick that covers dragon parley',
      'Shared-language enchantments vs Draconic speakers',
    ],
  },
  druidic: {
    badge: 'Gate: Druid Circle',
    uses: [
      'Local Druid Circle sub-faction rites (alliance chain)',
      'Nature recall tags on wilds floors pair with Druidic markers',
      'Druid-only gate: non-Druids need Comprehend Languages or a guide',
    ],
  },
  infernal: {
    badge: 'Gate: Ashen Spire',
    uses: [
      'War command tongue: Ashen Spire officers (orders encrypted in Infernal)',
      'Dispatch intercepts readable with Infernal (attack warnings, tribute routes)',
      'Shared-language enchantments vs Infernal speakers',
    ],
  },
  primordial: {
    badge: 'Gate: elementals',
    uses: [
      'Party-level gate vs elemental vessels & primordial shrines',
      'Ward identification on primordial seals (Arcana/Religion)',
      'Shared-language enchantments vs Primordial speakers',
    ],
  },
  sylvan: {
    badge: 'Gate: Emerald rites',
    uses: [
      'Emerald Circle rites unintelligible without Sylvan (court speech is Elvish)',
      'Fey parley & shrine outcomes gate on Sylvan',
      'Shared-language enchantments vs Sylvan speakers',
    ],
  },
  'thieves-cant': {
    badge: 'Gate: underworld',
    uses: [
      'Rogue underworld marks, dead drops & fence parley',
      'Sleight-of-Hand theft planning cues in cities',
      'Thieves’ Guild covert-asset deals (War Room hire row)',
    ],
  },
  undercommon: {
    badge: 'Gate: Underdark',
    uses: [
      'Underdark trader parley & sealed writs (fetch_translator fallback)',
      'Deep-delver dispatch intercepts in Delve loot',
      'Shared-language enchantments vs Undercommon speakers',
    ],
  },
};

export function getLanguageMechanicalInfo(
  languageId: string,
  compendium: SrdCompendium = defaultCompendium,
): LanguageMechanicalInfo {
  const norm = languageId.trim().toLowerCase();
  const entry = LANGUAGE_USES[norm];
  const def = compendium.getLanguage(norm);
  if (entry) {
    return { id: norm, status: 'supported', badge: entry.badge, uses: entry.uses };
  }
  if (def) {
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
    };
  }
  return {
    id: norm,
    status: 'unsupported',
    badge: 'Unknown tongue',
    uses: [],
    trackingTicket: 'SRD-1212',
  };
}

// ---------------------------------------------------------------------------
// Skill mechanics (all 18 SRD skills — every one has an engine verb)
// ---------------------------------------------------------------------------

const SKILL_USES: Record<SkillId, { badge: string; uses: string[] }> = {
  acrobatics: {
    badge: 'Grapple defense',
    uses: [
      'Defend vs Grapple/Shove (Acrobatics or Athletics, target picks)',
      'Balance & narrow-ledge traversal in dungeon exploration',
    ],
  },
  'animal-handling': {
    badge: 'Beast verb',
    uses: [
      'Calm / befriend / command beasts (WIS check; befriend buys the parley round)',
      'Mounts & pack animals: camp perception, off-road travel discount',
    ],
  },
  arcana: {
    badge: 'Recall + identify',
    uses: [
      'Recall: ward_info on wizard-lair tags before trigger',
      'Counterspell identification (pass sees name/level; fail still counters blind)',
      'Decipher arcane seals & spell loot',
    ],
  },
  athletics: {
    badge: 'Grapple / Shove',
    uses: [
      'Grapple & Shove contests (STR vs Athletics/Acrobatics)',
      'Climb, swim, forced-entry assist (Athletics + rope on fortress approaches)',
    ],
  },
  deception: {
    badge: 'Social leg',
    uses: [
      'Diplomacy triple-approach: trick (later fallout)',
      'Patrol bluff & envoy parley (opposed by Insight; passive is the floor)',
    ],
  },
  history: {
    badge: 'Recall unlocks',
    uses: [
      'Recall: reveal_quest (battlefields, caches) & trap_bonus (+2 detection)',
      'Diplomacy History stage: success lowers final DC by 2, unlocks alliance tier',
      'Free recall per delve (proficient) via delve recall tags',
    ],
  },
  insight: {
    badge: 'Opposed read',
    uses: [
      'Opposed vs Deception (passive is the floor; “something feels off” cue)',
      'Tribe/envoy/truce reads & language-barrier intent cues',
    ],
  },
  intimidation: {
    badge: 'Social leg',
    uses: [
      'Diplomacy triple-approach: compliance (frightened + attitude cost)',
      'Bloodied enemies check morale earlier; failed bluffs fall back at +2 DC',
    ],
  },
  investigation: {
    badge: 'Trap verb',
    uses: [
      'Detect & disarm traps, find secret doors (pairs with Perception)',
      'Recall trap_bonus applies to Investigation as well as Perception',
    ],
  },
  medicine: {
    badge: 'Stabilize DC 10',
    uses: [
      'Stabilize dying creature (DC 10; healer’s kit grants advantage)',
      'Diagnose poison/disease → correct cure path (antitoxin / lesser restoration)',
    ],
  },
  nature: {
    badge: 'Recall: wilds',
    uses: [
      'Recall: beast/plant/terrain lore (what it is / is it safe)',
      'Forage split with Survival (Nature knows, Survival gathers; +1 ration yield)',
    ],
  },
  perception: {
    badge: 'Trap verb',
    uses: [
      'Passive Perception spots traps, secret doors & ambushes',
      'Listen at door (WIS Perception vs listenDc → tiered occupant hints)',
      'Opposed vs Stealth (hiding, surprise, theft-adjacent sneaking)',
    ],
  },
  performance: {
    badge: 'Tavern verb',
    uses: [
      'Earn coin + rumors on one roll (fail-forward: half coin, no rumor)',
      'Distract (Help-equivalent from 30 ft) & cover identity (blend-in advantage hook)',
    ],
  },
  persuasion: {
    badge: 'Social leg',
    uses: [
      'Diplomacy triple-approach: alliance / fair terms (History unlocks top tier)',
      'Tribe parley, envoy missions, truce & tribute negotiation',
    ],
  },
  religion: {
    badge: 'Recall: wards',
    uses: [
      'Recall: ward_info on undead-crypt tags; consecration/shrine outcomes',
      'Cleanse-cursed-mine dungeon verb; +1 HP when receiving magical healing (proficient)',
    ],
  },
  'sleight-of-hand': {
    badge: 'Theft verb',
    uses: [
      'Pickpocket / plant / lift key / snip pouch (DEX vs passive Perception)',
      'Thieves’ tools grant advantage; Fast Hands (Thief 3) theft as bonus action',
    ],
  },
  stealth: {
    badge: 'Hide & surprise',
    uses: [
      'Combat hide (DEX Stealth vs hostile passive Perception → hidden/unseen attacker)',
      'Exploration stealth & surprise checks; Cunning Action bonus-action hide',
    ],
  },
  survival: {
    badge: 'Travel verb',
    uses: [
      'Forage & track; wilderness camp safety & ambush-roll mitigation',
      'Expedition patrol evasion (Stealth/Survival) & forced-march endurance',
    ],
  },
};

export function getSkillMechanicalInfo(skillId: string): SkillMechanicalInfo {
  const norm = skillId.trim().toLowerCase() as SkillId;
  const entry = (SKILL_IDS as readonly string[]).includes(norm)
    ? SKILL_USES[norm as SkillId]
    : undefined;
  if (entry) {
    return { id: norm as SkillId, status: 'supported', badge: entry.badge, uses: entry.uses };
  }
  return {
    id: norm as SkillId,
    status: 'unsupported',
    badge: 'No verb yet',
    uses: [],
    trackingTicket: 'SRD-1212',
  };
}

// ---------------------------------------------------------------------------
// Spell mechanics (derived from spell data; every compendium id resolves)
// ---------------------------------------------------------------------------

const LANGUAGE_DEPENDENT_ENCHANTMENTS = new Set([
  'command',
  'suggestion',
  'charm-person',
  'hideous-laughter',
  'vicious-mockery',
  'divine-word',
]);

const UTILITY_SPOTLIGHT: Record<string, string[]> = {
  'comprehend-languages': ['Out-of-combat comprehension (opens any tongue gate)', 'Ritual (10 min, no slot when ritual-cast)'],
  tongues: ['Out-of-combat comprehension (caster understood by any listener)', 'Opens any tongue gate incl. war dispatches'],
  'detect-magic': ['Sense active magical effects & wards in range', 'Out-of-combat + ritual value'],
  knock: ['Prop hook: unlock + loud report (adjacent-room alert tradeoff)', 'Out-of-combat alongside tools/Athletics'],
  sanctuary: ['Ward: attackers must pass WIS save or redirect', 'Protects parley VIPs & downed allies'],
  sleep: ['HP-pool resolution (lowest-HP creatures fall unconscious first)', 'Bypasses saves; ends Bloodied standoffs'],
  shield: ['Reaction +5 AC (live buff id reconciled)', 'Turns hits into misses; negates magic missile'],
  wish: ['Bounded capstone: fixed boon menu (restore, resistance, supply, rest, heal, resurrection)', 'Stress: non-duplication risks never casting Wish again'],
  'time-stop': ['Bounded capstone: 1d4+1 solo turns, others frozen', 'Ends early if the caster affects another creature'],
  'cure-wounds': ['Out-of-combat healing (required acceptance path)', 'Combat heal with slot scaling'],
  'healing-word': ['Bonus-action ranged heal (Bonus Action spell rule applies)', 'Revives downed allies at range'],
  'fireball': ['AOE template with foe/ally preview (friendly-fire toggle)', 'Dex save for half; cover applies'],
  counterspell: ['Reaction interrupt (Arcana identification gates what you see)', 'Blind counterspell still offered on failed ID'],
  'speak-with-animals': ['Parley with beasts (approach-dialogue hook)', 'Out-of-combat social path'],
  'disguise-self': ['Cover-identity approach (Performance/Deception pairing)', 'Out-of-combat infiltration'],
};

export function getSpellMechanicalInfo(
  spellId: string,
  compendium: SrdCompendium = defaultCompendium,
): SpellMechanicalInfo {
  const norm = spellId.trim().toLowerCase();
  const spell = compendium.getSpell(norm);
  if (!spell) {
    return {
      id: norm,
      status: 'unsupported',
      paths: [],
      badge: 'Missing compendium entry',
      detail: `Spell id "${norm}" does not resolve in the compendium.`,
      trackingTicket: 'SRD-1212',
    };
  }
  const paths: string[] = [];
  if (spell.level === 0) paths.push('Cantrip (at-will combat)');
  else paths.push(`L${spell.level} ${spell.school}`);
  if (spell.ritual) paths.push('Ritual (out-of-combat, time cost)');
  if (spell.concentration) paths.push('Concentration');
  if (LANGUAGE_DEPENDENT_ENCHANTMENTS.has(norm)) {
    paths.push('Social (requires shared tongue — gate or magic)');
  } else if (spell.school === 'enchantment' || spell.school === 'illusion') {
    paths.push('Social / control');
  }
  const spotlight = UTILITY_SPOTLIGHT[norm];
  if (spotlight) paths.push(...spotlight);
  else if (spell.level >= 1 && /heal|restore|reviv|cure/i.test(`${spell.name} ${spell.description}`)) {
    paths.push('Out-of-combat healing');
  } else if (/damage|save|attack/i.test(spell.description)) {
    paths.push('Combat (save / attack)');
  } else {
    paths.push('Executable Effect DSL (combat + out-of-combat)');
  }
  return {
    id: norm,
    status: 'supported',
    paths,
    badge: spell.ritual ? 'Ritual + executable' : 'Executable',
    detail: paths.join(' · '),
  };
}

// ---------------------------------------------------------------------------
// Party coverage (party-aware hints — Spec 11 §6)
// ---------------------------------------------------------------------------

export interface PartyCoverageInput {
  languages: string[];
  skillProficiencies: string[];
  toolProficiencies?: string[];
  spellIds?: string[];
}

function normalizeList(list: readonly string[] | undefined): Set<string> {
  return new Set((list ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean));
}

function buildStateToCoverageInput(
  buildState: { backgroundChoices?: Record<string, string[]> },
  derived: {
    proficiencies: { languages: string[]; skills: string[]; tools: string[] };
    spellcasting: { cantripIds: string[]; preparedOrKnownSpellIds: string[] };
  },
): PartyCoverageInput {
  return {
    languages: derived.proficiencies.languages,
    skillProficiencies: derived.proficiencies.skills,
    toolProficiencies: derived.proficiencies.tools,
    spellIds: [
      ...derived.spellcasting.cantripIds,
      ...derived.spellcasting.preparedOrKnownSpellIds,
    ],
  };
}

export { buildStateToCoverageInput as toCoverageInput };

/**
 * Computes party-aware tabletop hints for a 1–4 hero party.
 *
 * Inputs are already-normalized coverage shapes (languages / proficient
 * skills / known-or-prepared spells). Checks use substring-tolerant matching
 * so `orc` matches `Orc` / `orcish` variants without false negatives.
 */
export function getPartyCoverageHints(party: PartyCoverageInput[]): PartyCoverageHint[] {
  const hints: PartyCoverageHint[] = [];
  if (party.length === 0) return hints;

  const partyLangs = new Set<string>();
  const partySkills = new Set<string>();
  const partySpells = new Set<string>();
  for (const member of party) {
    for (const l of normalizeList(member.languages)) partyLangs.add(l);
    for (const s of normalizeList(member.skillProficiencies)) partySkills.add(s);
    for (const sp of normalizeList(member.spellIds)) partySpells.add(sp);
  }
  const hasLang = (...ids: string[]) =>
    ids.some((id) => partyLangs.has(id) || [...partyLangs].some((l) => l.includes(id) || id.includes(l)));
  const hasSkill = (id: string) => partySkills.has(id);
  const hasSpell = (...ids: string[]) => ids.some((id) => partySpells.has(id));

  // --- Languages: Orc-tribe reference quest (Spec 11 §2.3) ----------------
  if (!hasLang('orc')) {
    const hasComprehension = hasSpell('comprehend-languages', 'tongues');
    hints.push({
      id: 'missing-orcish',
      severity: 'missing',
      message:
        'No party member speaks Orcish — the Local Orc Tribe parley falls back to gesture (trade +25 gp, checks +2 DC).',
      remedy: hasComprehension
        ? 'Comprehension magic prepared — cast it before the parley for full negotiation.'
        : 'Comprehend Languages (L1 ritual) or Tongues (L3) recommended.',
    });
  }

  // --- War command tongues (Spec 11 §2.4 Phase 1 table stakes) ------------
  const warTongues = ['dwarvish', 'elvish', 'infernal', 'draconic', 'giant', 'celestial'];
  const coveredWarTongues = warTongues.filter((t) => hasLang(t));
  if (!hasLang('common') && !hasLang('orc') && coveredWarTongues.length === 0 && !hasSpell('comprehend-languages', 'tongues')) {
    hints.push({
      id: 'missing-war-tongues',
      severity: 'suggestion',
      message:
        'No war command tongue covered — dispatch intercepts stay sealed and patrol bluffs cap at pass-with-Threat.',
      remedy: 'Cover Dwarvish, Elvish, Infernal, or Draconic — or prepare Comprehend Languages.',
    });
  }

  // --- Trap verbs (Perception / Investigation) -----------------------------
  if (!hasSkill('perception') && !hasSkill('investigation')) {
    hints.push({
      id: 'missing-trap-senses',
      severity: 'missing',
      message:
        'No Perception or Investigation proficiency — trap detection and secret-door searches roll flat.',
      remedy: 'Add Perception or Investigation on one hero; History recall trap bonuses stack with it.',
    });
  }

  // --- Knowledge recall (History / Religion / Arcana / Nature) --------------
  const recallSkills: SkillId[] = ['history', 'religion', 'arcana', 'nature'];
  const missingRecall = recallSkills.filter((s) => !hasSkill(s));
  if (missingRecall.length >= 3) {
    hints.push({
      id: 'missing-recall',
      severity: 'missing',
      message: `Recall coverage thin (${recallSkills.length - missingRecall.length}/4) — quest unlocks, ward identification, and trap bonuses will be missed.`,
      remedy: 'Cover History (quest unlocks) and Religion or Arcana (ward identification) first.',
    });
  } else if (missingRecall.length > 0) {
    hints.push({
      id: 'thin-recall',
      severity: 'suggestion',
      message: `Recall gap: ${missingRecall.join(', ')} uncovered — some delve tags grant no bonus.`,
      remedy: 'Fail-forward: no blocks, only missed bonuses. Cover on level-up if convenient.',
    });
  }

  // --- Social triple leg + Insight ------------------------------------------
  if (!hasSkill('persuasion') && !hasSkill('deception') && !hasSkill('intimidation')) {
    hints.push({
      id: 'missing-social',
      severity: 'missing',
      message: 'No Persuasion, Deception, or Intimidation — diplomacy degrades to tribute/Threat outcomes.',
      remedy: 'Cover at least one social leg; Insight pairs with whichever you pick.',
    });
  }
  if (!hasSkill('insight')) {
    hints.push({
      id: 'missing-insight',
      severity: 'suggestion',
      message: 'No Insight proficiency — opposed Deception reads miss the “something feels off” cue.',
      remedy: 'Insight is the passive floor for every social prompt; cover it on the party face.',
    });
  }

  // --- Theft / Medicine / Stealth -------------------------------------------
  if (!hasSkill('sleight-of-hand') && !hasSkill('sleight_of_hand')) {
    hints.push({
      id: 'missing-theft',
      severity: 'suggestion',
      message: 'No Sleight of Hand — pickpocket / plant / lift-key verbs roll flat.',
      remedy: 'Rogue or Urchin-style custom background covers it; thieves’ tools add advantage.',
    });
  }
  if (!hasSkill('medicine')) {
    hints.push({
      id: 'missing-medicine',
      severity: 'suggestion',
      message: 'No Medicine — stabilize checks (DC 10) roll flat and diagnoses miss the cure path.',
      remedy: 'A healer’s kit grants advantage; cover Medicine on the support hero.',
    });
  }
  if (!hasSkill('stealth')) {
    hints.push({
      id: 'missing-stealth',
      severity: 'suggestion',
      message: 'No Stealth proficiency — combat hide and surprise checks roll flat.',
      remedy: 'Scout heroes (rogue/ranger/monk) cover surprise for the whole party.',
    });
  }
  if (!hasSkill('survival') && !hasSkill('nature')) {
    hints.push({
      id: 'missing-wilds',
      severity: 'suggestion',
      message: 'No Nature or Survival — forage yields and wilds recall tags grant no bonus.',
      remedy: 'Nature identifies (safe or not); Survival gathers. One of the two suffices.',
    });
  }

  // --- Comprehension magic ----------------------------------------------------
  if (!hasSpell('comprehend-languages', 'tongues') && !hasLang('orc')) {
    // Already nudged via missing-orcish; keep this as the spell-side pointer.
    hints.push({
      id: 'suggest-comprehension-magic',
      severity: 'suggestion',
      message: 'No comprehension magic prepared — every sealed dispatch stays sealed without the tongue.',
      remedy: 'Wizards/clerics: prepare Comprehend Languages (ritual) for delve/parley days.',
    });
  }

  return hints;
}

/** Relevance matrix for campaign setup: which skills the shipped content exercises. */
export const RELEVANCE_MATRIX: Array<{ skill: SkillId; exercisedBy: string }> = [
  { skill: 'history', exercisedBy: 'Recall tags (quest unlocks, trap bonuses) · Diplomacy History stage' },
  { skill: 'religion', exercisedBy: 'Undead-crypt ward tags · shrine outcomes · cursed-mine cleanse' },
  { skill: 'arcana', exercisedBy: 'Wizard-lair ward tags · counterspell identification · decipher seals' },
  { skill: 'nature', exercisedBy: 'Wilds recall tags · forage identify (Survival gathers)' },
  { skill: 'insight', exercisedBy: 'Opposed vs Deception · gesture/intent reads · passive cue' },
  { skill: 'perception', exercisedBy: 'Trap/secret-door detection · listen at door · ambush & surprise' },
  { skill: 'investigation', exercisedBy: 'Trap/secret-door detection · disarm · recall trap bonus' },
  { skill: 'stealth', exercisedBy: 'Combat hide (hidden) · surprise · patrol evasion' },
  { skill: 'sleight-of-hand', exercisedBy: 'Theft verbs (pickpocket / plant / lift) · Fast Hands bonus action' },
  { skill: 'medicine', exercisedBy: 'Stabilize DC 10 (kit advantage) · diagnose poison/disease' },
  { skill: 'persuasion', exercisedBy: 'Diplomacy alliance/fair-terms · tribe/envoy/truce parley' },
  { skill: 'deception', exercisedBy: 'Diplomacy trick (later fallout) · patrol bluff' },
  { skill: 'intimidation', exercisedBy: 'Diplomacy compliance (attitude cost) · morale checks' },
  { skill: 'performance', exercisedBy: 'Tavern earn + rumors · distract (Help) · cover identity' },
  { skill: 'animal-handling', exercisedBy: 'Calm / befriend / command beasts · mounts & camp beasts' },
  { skill: 'survival', exercisedBy: 'Forage yield · travel pace · camp safety & patrol evasion' },
  { skill: 'athletics', exercisedBy: 'Grapple/Shove contests · climb/swim · forced entry' },
  { skill: 'acrobatics', exercisedBy: 'Grapple/Shove defense · balance & traversal' },
];

export { SKILL_IDS };
export type { SkillId };
