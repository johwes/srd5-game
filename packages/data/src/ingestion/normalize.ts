import type {
  AbilityId,
  ActionCost,
  AoeShapeType,
  ChallengeRating,
  DamageType,
  EffectStepSpec,
  MonsterAbilities,
  MonsterActionRecharge,
  MonsterActionSpec,
  SkillId,
  SpellCastingTime,
  SpellComponents,
  SpellDuration,
  SpellTargetSpec,
  SrdSubclassId,
  AiArchetype,
} from '../schemas/index.js';
import {
  ABILITY_IDS,
  CHALLENGE_RATINGS,
  DAMAGE_TYPES,
  SKILL_IDS,
} from '../schemas/index.js';
import {
  containsProductIdentityProperName,
  SRD_SPELL_RENAME_MAP,
} from './allowlist.js';

/**
 * Converts any raw SRD name or index into a canonical lowercase kebab-case identifier.
 * Examples:
 * - "Sleight of Hand" -> "sleight-of-hand"
 * - "Thieves' Tools" -> "thieves-tools"
 * - "Half-Orc" -> "half-orc"
 * - "Potion of Healing (Greater)" -> "potion-of-healing-greater"
 */
export function toCanonicalId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/&/g, 'and')
    .replace(/\+/g, 'plus-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const ABILITY_ALIAS_MAP: Readonly<Record<string, AbilityId>> = {
  str: 'str',
  strength: 'str',
  'saving-throw-str': 'str',
  dex: 'dex',
  dexterity: 'dex',
  'saving-throw-dex': 'dex',
  con: 'con',
  constitution: 'con',
  'saving-throw-con': 'con',
  int: 'int',
  intelligence: 'int',
  'saving-throw-int': 'int',
  wis: 'wis',
  wisdom: 'wis',
  'saving-throw-wis': 'wis',
  cha: 'cha',
  charisma: 'cha',
  'saving-throw-cha': 'cha',
};

/**
 * Normalizes an ability score name, abbreviation, or saving throw index into a canonical `AbilityId`.
 */
export function toCanonicalAbilityId(raw: string): AbilityId {
  const key = toCanonicalId(raw);
  const mapped = ABILITY_ALIAS_MAP[key];
  if (!mapped) {
    throw new Error(`Unknown SRD 5.1 Ability identifier: "${raw}"`);
  }
  return mapped;
}

const SKILL_SET: ReadonlySet<string> = new Set(SKILL_IDS);

/**
 * Normalizes a skill name or `skill-*` proficiency index into a canonical `SkillId`.
 */
export function toCanonicalSkillId(raw: string): SkillId {
  const key = toCanonicalId(raw).replace(/^skill-/, '');
  if (!SKILL_SET.has(key)) {
    throw new Error(`Unknown SRD 5.1 Skill identifier: "${raw}"`);
  }
  return key as SkillId;
}

const SUBCLASS_ALIAS_MAP: Readonly<Record<string, SrdSubclassId>> = {
  berserker: 'berserker',
  'path-of-the-berserker': 'berserker',
  lore: 'lore',
  'college-of-lore': 'lore',
  life: 'life',
  'life-domain': 'life',
  land: 'land',
  'circle-of-the-land': 'land',
  champion: 'champion',
  'open-hand': 'open-hand',
  'way-of-the-open-hand': 'open-hand',
  devotion: 'devotion',
  'oath-of-devotion': 'devotion',
  hunter: 'hunter',
  thief: 'thief',
  draconic: 'draconic',
  'draconic-bloodline': 'draconic',
  fiend: 'fiend',
  'the-fiend': 'fiend',
  evocation: 'evocation',
  'school-of-evocation': 'evocation',
};

/**
 * Normalizes a raw subclass name or index into a canonical `SrdSubclassId`.
 */
export function toCanonicalSubclassId(raw: string): SrdSubclassId {
  const key = toCanonicalId(raw);
  const mapped = SUBCLASS_ALIAS_MAP[key];
  if (!mapped) {
    throw new Error(`Non-SRD or unknown Subclass identifier: "${raw}"`);
  }
  return mapped;
}

/**
 * Normalizes a spell's ID and display name, automatically converting PHB Product Identity
 * wizard-named spells (e.g. "Melf's Acid Arrow") into their official SRD 5.1 open-content names ("Acid Arrow").
 * Throws if the spell still contains non-SRD Product Identity proper names.
 */
export function canonicalizeSpellIdentity(
  rawIdOrName: string,
  rawDisplayName?: string,
): { id: string; name: string } {
  const candidateId = toCanonicalId(rawIdOrName);
  const renameEntry = SRD_SPELL_RENAME_MAP[candidateId];
  if (renameEntry) {
    return { ...renameEntry };
  }

  if (rawDisplayName) {
    const displayKey = toCanonicalId(rawDisplayName);
    const displayRename = SRD_SPELL_RENAME_MAP[displayKey];
    if (displayRename) {
      return { ...displayRename };
    }
  }

  const finalName = (rawDisplayName ?? rawIdOrName).trim();
  if (
    containsProductIdentityProperName(candidateId) ||
    containsProductIdentityProperName(finalName)
  ) {
    throw new Error(
      `Prohibited non-SRD Product Identity spell detected: "${finalName}" (${candidateId})`,
    );
  }

  return {
    id: candidateId,
    name: finalName,
  };
}

const CURRENCY_TO_COPPER: Readonly<Record<string, number>> = {
  cp: 1,
  copper: 1,
  sp: 10,
  silver: 10,
  ep: 50,
  electrum: 50,
  gp: 100,
  gold: 100,
  pp: 1000,
  platinum: 1000,
};

/**
 * Normalizes a currency amount (`{ quantity, unit }`, `"15 gp"`, `"5 sp"`, or raw copper number)
 * into an integer count of copper pieces (`cp`).
 */
export function normalizeCostToCopper(
  cost: { quantity: number; unit: string } | string | number,
): number {
  if (typeof cost === 'number') {
    if (!Number.isFinite(cost) || cost < 0) {
      throw new Error(`Invalid negative or non-finite cost: ${cost}`);
    }
    return Math.round(cost);
  }

  if (typeof cost === 'string') {
    const trimmed = cost.trim().toLowerCase();
    if (trimmed === '0' || trimmed === '0 cp' || trimmed === 'none' || trimmed === '-') {
      return 0;
    }
    const match = /^(\d+(?:\.\d+)?)\s*(cp|sp|ep|gp|pp|copper|silver|electrum|gold|platinum)$/.exec(
      trimmed,
    );
    if (!match) {
      throw new Error(`Cannot parse currency string: "${cost}"`);
    }
    const amount = Number(match[1]);
    const unit = match[2]!;
    const multiplier = CURRENCY_TO_COPPER[unit];
    if (!multiplier) {
      throw new Error(`Unknown currency unit: "${unit}"`);
    }
    return Math.round(amount * multiplier);
  }

  const unitKey = cost.unit.trim().toLowerCase();
  const multiplier = CURRENCY_TO_COPPER[unitKey];
  if (!multiplier) {
    throw new Error(`Unknown currency unit: "${cost.unit}"`);
  }
  if (!Number.isFinite(cost.quantity) || cost.quantity < 0) {
    throw new Error(`Invalid currency quantity: ${cost.quantity}`);
  }
  return Math.round(cost.quantity * multiplier);
}

/**
 * Canonical SRD 5.1 Challenge Rating to XP table.
 */
export const SRD_CR_TO_XP: Readonly<Record<ChallengeRating, number>> = {
  0: 10,
  0.125: 25,
  0.25: 50,
  0.5: 100,
  1: 200,
  2: 450,
  3: 700,
  4: 1100,
  5: 1800,
  6: 2300,
  7: 2900,
  8: 3900,
  9: 5000,
  10: 5900,
  11: 7200,
  12: 8400,
  13: 10000,
  14: 11500,
  15: 13000,
  16: 15000,
  17: 18000,
  18: 20000,
  19: 22000,
  20: 25000,
  21: 33000,
  22: 41000,
  23: 50000,
  24: 62000,
  25: 75000,
  26: 90000,
  27: 105000,
  28: 120000,
  29: 135000,
  30: 155000,
};

const VALID_CR_SET: ReadonlySet<number> = new Set(CHALLENGE_RATINGS);

/**
 * Normalizes a Challenge Rating (`"1/8"`, `"1/4"`, `"1/2"`, `0.25`, `1..30`) into a typed `ChallengeRating`.
 */
export function normalizeChallengeRating(rawCr: number | string): ChallengeRating {
  if (typeof rawCr === 'string') {
    const trimmed = rawCr.trim();
    if (trimmed === '1/8') return 0.125;
    if (trimmed === '1/4') return 0.25;
    if (trimmed === '1/2') return 0.5;
    const parsed = Number(trimmed);
    if (VALID_CR_SET.has(parsed)) {
      return parsed as ChallengeRating;
    }
    throw new Error(`Invalid SRD 5.1 Challenge Rating string: "${rawCr}"`);
  }

  if (VALID_CR_SET.has(rawCr)) {
    return rawCr as ChallengeRating;
  }
  throw new Error(`Invalid SRD 5.1 Challenge Rating number: ${rawCr}`);
}

/**
 * Returns the canonical SRD 5.1 XP award for a given Challenge Rating.
 */
export function getXpForChallengeRating(cr: ChallengeRating): number {
  return SRD_CR_TO_XP[cr];
}

/**
 * Normalizes an alignment string (e.g. `"Lawful Good"`, `"neutral"`, `"Any Non-Good Alignment"`)
 * into canonical snake_case (`"lawful_good"`, `"true_neutral"`, `"unaligned"`, etc.).
 */
export function normalizeAlignment(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (cleaned === 'neutral') {
    return 'true_neutral';
  }
  return cleaned || 'unaligned';
}

/**
 * Normalizes a dice or formula string into canonical spacing (e.g. `"2d6+3"` -> `"2d6 + 3"`).
 */
export function normalizeDiceFormula(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed) {
    throw new Error('Dice formula cannot be empty');
  }
  return trimmed
    .replace(/(\d+d\d+|\@[a-zA-Z]+|\d+)\s*\+\s*(\d+d\d+|\@[a-zA-Z]+|\d+)/g, '$1 + $2')
    .replace(/(\d+d\d+|\@[a-zA-Z]+|\d+)\s*-\s*(\d+d\d+|\@[a-zA-Z]+|\d+)/g, '$1 - $2');
}

/**
 * Normalizes an SRD 5.1 spell casting time string (e.g. `"1 action"`, `"1 bonus action"`, `"10 minutes"`).
 */
export function normalizeSpellCastingTime(raw: string): SpellCastingTime {
  const lower = raw.trim().toLowerCase();
  if (lower.startsWith('1 action') || lower === 'action') return 'action';
  if (lower.startsWith('1 bonus action') || lower === 'bonus_action' || lower === 'bonus action') {
    return 'bonus_action';
  }
  if (lower.startsWith('1 reaction') || lower === 'reaction') return 'reaction';
  if (lower === '1 minute' || lower === '1_minute') return '1_minute';
  if (lower === '10 minutes' || lower === '10_minutes') return '10_minutes';
  if (lower === '1 hour' || lower === '1_hour') return '1_hour';
  if (lower === '8 hours' || lower === '8_hours') return '8_hours';
  if (lower === '12 hours' || lower === '12_hours') return '12_hours';
  if (lower === '24 hours' || lower === '24_hours') return '24_hours';
  return 'special';
}

/**
 * Normalizes an SRD 5.1 spell duration string into a structured `SpellDuration`.
 * Combat-scale durations of 1 minute (10 rounds) or 1 round are normalized into `rounds`
 * for direct turn-counter tracking in `@srd5/engine`.
 */
export function normalizeSpellDuration(raw: string): SpellDuration {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^concentration,\s*/i, '')
    .replace(/^up to\s+/i, '');

  if (cleaned === 'instantaneous') {
    return { type: 'instantaneous' };
  }
  if (cleaned === 'until dispelled' || cleaned === 'until dispelled or triggered') {
    return { type: 'until_dispelled' };
  }
  if (cleaned === 'special') {
    return { type: 'special' };
  }

  const roundMatch = /^(\d+)\s*rounds?$/.exec(cleaned);
  if (roundMatch) {
    return { type: 'rounds', rounds: Number(roundMatch[1]) };
  }

  const minuteMatch = /^(\d+)\s*minutes?$/.exec(cleaned);
  if (minuteMatch) {
    const minutes = Number(minuteMatch[1]);
    if (minutes === 1) {
      return { type: 'rounds', rounds: 10 };
    }
    return { type: 'minutes', amount: minutes };
  }

  const hourMatch = /^(\d+)\s*hours?$/.exec(cleaned);
  if (hourMatch) {
    return { type: 'hours', amount: Number(hourMatch[1]) };
  }

  const dayMatch = /^(\d+)\s*days?$/.exec(cleaned);
  if (dayMatch) {
    return { type: 'days', amount: Number(dayMatch[1]) };
  }

  return { type: 'special' };
}

/**
 * Normalizes SRD 5.1 spell components (`["V", "S", "M"]` + optional material text)
 * into a structured `SpellComponents` object, extracting GP cost and consumption flags.
 */
export function normalizeSpellComponents(
  rawComponents: readonly string[],
  materialDescription?: string,
): SpellComponents {
  const upperSet = new Set(rawComponents.map((c) => c.trim().toUpperCase()));
  const verbal = upperSet.has('V');
  const somatic = upperSet.has('S');
  const material = upperSet.has('M') || Boolean(materialDescription?.trim());

  const result: SpellComponents = {
    verbal,
    somatic,
    material,
  };

  if (material && materialDescription?.trim()) {
    const cleanMaterial = materialDescription.trim().replace(/^\(|\)$/g, '');
    result.materialDescription = cleanMaterial;

    const gpMatch = /(\d[\d,]*)\s*gp/i.exec(cleanMaterial);
    if (gpMatch?.[1]) {
      const gpValue = Number(gpMatch[1].replace(/,/g, ''));
      if (Number.isFinite(gpValue) && gpValue > 0) {
        result.materialCostGold = gpValue;
      }
    }

    if (/consumes|consumed/i.test(cleanMaterial)) {
      result.materialConsumed = true;
    }
  }

  return result;
}

/**
 * Normalizes a raw SRD spell range string (e.g. `"Self"`, `"Touch"`, `"150 feet"`, `"Self (15-foot cone)"`)
 * into a baseline `SpellTargetSpec`.
 */
export function normalizeSpellTargeting(
  rawRange: string,
  aoeOverride?: { shape: AoeShapeType; sizeFeet: number; widthFeet?: number },
): SpellTargetSpec {
  const lower = rawRange.trim().toLowerCase();

  const selfAoeMatch =
    /^self\s*\((\d+)-foot(?:-radius)?\s*(cone|cube|line|sphere|cylinder|radius)\)/.exec(lower);
  if (selfAoeMatch) {
    const sizeFeet = Number(selfAoeMatch[1]);
    const rawShape = selfAoeMatch[2]!;
    const shape: AoeShapeType = rawShape === 'radius' ? 'sphere' : (rawShape as AoeShapeType);
    return {
      type: 'self_aoe',
      rangeFeet: 0,
      aoe: aoeOverride ?? { shape, sizeFeet },
    };
  }

  if (lower === 'self') {
    if (aoeOverride) {
      return {
        type: 'self_aoe',
        rangeFeet: 0,
        aoe: aoeOverride,
      };
    }
    return { type: 'self', rangeFeet: 0 };
  }

  if (lower === 'touch') {
    return { type: 'touch', rangeFeet: 5 };
  }

  let rangeFeet = 30;
  const feetMatch = /(\d+)\s*(?:feet|ft\.?)/.exec(lower);
  const mileMatch = /(\d+)\s*miles?/.exec(lower);
  if (feetMatch) {
    rangeFeet = Number(feetMatch[1]);
  } else if (mileMatch) {
    rangeFeet = Number(mileMatch[1]) * 5280;
  } else if (lower === 'sight' || lower === 'unlimited' || lower === 'special') {
    rangeFeet = 500;
  }

  if (aoeOverride) {
    return {
      type: rangeFeet === 0 ? 'self_aoe' : 'point_aoe',
      rangeFeet,
      aoe: aoeOverride,
    };
  }

  return {
    type: 'single',
    rangeFeet,
  };
}

/**
 * Deterministically infers a tactical `AiArchetype` (`brute`, `skirmisher`, `artillery`, `controller`, `support`)
 * for an SRD monster when not explicitly specified by an overlay.
 */
export function inferMonsterAiArchetype(monster: {
  abilities: MonsterAbilities;
  traits?: ReadonlyArray<{ id: string; name: string; description?: string }>;
  actions?: ReadonlyArray<{ id?: string; name: string; description: string }>;
  spellIds?: readonly string[];
}): AiArchetype {
  const spellSet = new Set((monster.spellIds ?? []).map(toCanonicalId));
  const traitIds = new Set((monster.traits ?? []).map((t) => toCanonicalId(t.id || t.name)));

  // 1. Support: healers & buffers
  const supportSpells = [
    'cure-wounds',
    'healing-word',
    'mass-cure-wounds',
    'bless',
    'shield-of-faith',
    'sanctuary',
    'aid',
    'revivify',
  ];
  if (supportSpells.some((s) => spellSet.has(s))) {
    return 'support';
  }

  // 2. Controller: battlefield control / debilitating conditions
  const controlSpells = [
    'web',
    'entangle',
    'hold-person',
    'hold-monster',
    'sleep',
    'hypnotic-pattern',
    'fear',
    'confusion',
    'dominate-person',
    'black-tentacles',
  ];
  if (controlSpells.some((s) => spellSet.has(s))) {
    return 'controller';
  }

  // 3. Skirmisher: Nimble Escape, Pack Tactics, Flyby, Sneak Attack, or high-DEX ambusher
  const skirmisherTraits = [
    'nimble-escape',
    'pack-tactics',
    'flyby',
    'sneak-attack',
    'ambusher',
    'shadow-stealth',
    'cunning-action',
  ];
  if (skirmisherTraits.some((t) => traitIds.has(t))) {
    return 'skirmisher';
  }

  // 4. Artillery: offensive blaster spells, breath weapons, or dedicated ranged attackers
  const artillerySpells = [
    'fireball',
    'lightning-bolt',
    'magic-missile',
    'scorching-ray',
    'cone-of-cold',
    'guiding-bolt',
    'flame-strike',
  ];
  if (artillerySpells.some((s) => spellSet.has(s))) {
    return 'artillery';
  }

  const actions = monster.actions ?? [];
  const hasBreathOrLongRanged = actions.some(
    (a) =>
      /breath/i.test(a.name) ||
      /ranged\s+(?:weapon|spell)\s+attack/i.test(a.description),
  );
  const hasMelee = actions.some((a) => /melee\s+(?:weapon|spell)\s+attack/i.test(a.description));

  if (hasBreathOrLongRanged && (!hasMelee || monster.abilities.dex > monster.abilities.str)) {
    return 'artillery';
  }

  if (monster.abilities.dex >= monster.abilities.str + 3) {
    return 'skirmisher';
  }

  return 'brute';
}

const DAMAGE_TYPE_SET: ReadonlySet<string> = new Set(DAMAGE_TYPES);

function parseDamageType(raw: string): DamageType {
  const lower = raw.trim().toLowerCase();
  if (DAMAGE_TYPE_SET.has(lower)) {
    return lower as DamageType;
  }
  return 'bludgeoning';
}

/**
 * Extracts a `MonsterActionRecharge` specification from an action title such as
 * `"Fire Breath (Recharge 5–6)"`, `"Acid Breath (Recharge 6)"`, or `"Teleport (3/Day)"`.
 */
export function parseMonsterActionRecharge(name: string): MonsterActionRecharge | undefined {
  const rechargeRollMatch = /\(recharge\s*([456])(?:\s*[-–]\s*6)?\)/i.exec(name);
  if (rechargeRollMatch?.[1]) {
    const minRoll = Number(rechargeRollMatch[1]) as 4 | 5 | 6;
    return { minRoll, die: 6 };
  }

  const perDayMatch = /\((\d+)\s*\/\s*day\)/i.exec(name);
  if (perDayMatch?.[1]) {
    return { perDay: Number(perDayMatch[1]) };
  }

  if (/\(recharges after a short or long rest\)/i.test(name)) {
    return { restType: 'short_rest', uses: 1 };
  }

  return undefined;
}

/**
 * Parses a raw SRD 5.1 Monster Action description into a structured `MonsterActionSpec`
 * with `targeting`, `recharge`, and `effects` (`attack_roll`, `saving_throw`, `deal_damage`).
 */
export function parseMonsterActionFromDescription(raw: {
  id?: string;
  name: string;
  description: string;
  actionCost?: ActionCost;
}): MonsterActionSpec {
  const cleanName = raw.name.replace(/\s*\((?:recharge|recharges|\d+\/day)[^)]*\)/i, '').trim();
  const id = raw.id ?? toCanonicalId(cleanName || raw.name);
  const actionCost: ActionCost = raw.actionCost ?? 'action';
  const recharge = parseMonsterActionRecharge(raw.name);
  const desc = raw.description.trim();

  // Case 1: Weapon or Spell Attack Roll in SRD format
  // e.g. "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage."
  const attackMatch =
    /(Melee|Ranged)\s+(?:Weapon|Spell)\s+Attack:\s*([+-]?\d+)\s*to hit,\s*(?:reach\s*(\d+)\s*ft\.|range\s*(\d+)(?:\/\d+)?\s*ft\.)/i.exec(
      desc,
    );

  if (attackMatch) {
    const rangeKind = attackMatch[1]!.toLowerCase();
    const isSpell = /spell\s+attack/i.test(attackMatch[0]);
    const attackType =
      rangeKind === 'melee'
        ? isSpell
          ? 'melee_spell'
          : 'melee_weapon'
        : isSpell
          ? 'ranged_spell'
          : 'ranged_weapon';
    const attackBonusOverride = Number(attackMatch[2]);
    const rangeFeet = Number(attackMatch[3] ?? attackMatch[4] ?? 5);

    const onHit: EffectStepSpec[] = [];
    // Primary damage: "Hit: 5 (1d6 + 2) slashing damage" or "Hit: 1 slashing damage"
    const hitDamageRegex =
      /(?:Hit:\s*\d+\s*\(([^)]+)\)|plus\s*\d+\s*\(([^)]+)\)|Hit:\s*(\d+))\s*([a-z]+)\s+damage/gi;
    let dmgMatch: RegExpExecArray | null = null;
    while ((dmgMatch = hitDamageRegex.exec(desc)) !== null) {
      const rawFormula = dmgMatch[1] ?? dmgMatch[2] ?? dmgMatch[3]!;
      const rawDamageType = dmgMatch[4]!;
      onHit.push({
        step: 'deal_damage',
        diceFormula: normalizeDiceFormula(rawFormula),
        damageType: parseDamageType(rawDamageType),
      });
    }

    if (onHit.length === 0) {
      onHit.push({
        step: 'deal_damage',
        diceFormula: '1',
        damageType: 'bludgeoning',
      });
    }

    return {
      id,
      name: raw.name,
      description: desc,
      actionCost,
      ...(recharge ? { recharge } : {}),
      targeting: {
        type: 'single',
        rangeFeet,
        targetFilter: 'enemy',
      },
      effects: [
        {
          step: 'attack_roll',
          attackType,
          attackBonusOverride,
          onHit,
        },
      ],
    };
  }

  // Case 2: Saving Throw effect in SRD format
  // e.g. "Each creature in a 15-foot cone must make a DC 13 Dexterity saving throw, taking 24 (7d6) fire damage on a failed save, or half as much damage on a successful one."
  const saveMatch =
    /DC\s*(\d+)\s*(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving throw/i.exec(
      desc,
    );
  if (saveMatch) {
    const dc = saveMatch[1]!;
    const ability = toCanonicalAbilityId(saveMatch[2]!);
    const halfOnSaveSuccess = /half as much damage on a successful/i.test(desc);

    const onFail: EffectStepSpec[] = [];
    const saveDmgMatch = /taking\s*\d+\s*\(([^)]+)\)\s*([a-z]+)\s+damage/i.exec(desc);
    if (saveDmgMatch) {
      onFail.push({
        step: 'deal_damage',
        diceFormula: normalizeDiceFormula(saveDmgMatch[1]!),
        damageType: parseDamageType(saveDmgMatch[2]!),
        ...(halfOnSaveSuccess ? { halfOnSaveSuccess: true } : {}),
      });
    }

    let targeting: SpellTargetSpec = {
      type: 'single',
      rangeFeet: 30,
      targetFilter: 'enemy',
    };

    const coneMatch = /(\d+)-foot\s+cone/i.exec(desc);
    const lineMatch = /(\d+)-foot\s+line\s+that\s+is\s+(\d+)\s+feet\s+wide/i.exec(desc);
    if (coneMatch) {
      targeting = {
        type: 'self_aoe',
        rangeFeet: 0,
        aoe: { shape: 'cone', sizeFeet: Number(coneMatch[1]) },
      };
    } else if (lineMatch) {
      targeting = {
        type: 'self_aoe',
        rangeFeet: 0,
        aoe: {
          shape: 'line',
          sizeFeet: Number(lineMatch[1]),
          widthFeet: Number(lineMatch[2]),
        },
      };
    }

    if (onFail.length > 0) {
      return {
        id,
        name: raw.name,
        description: desc,
        actionCost,
        ...(recharge ? { recharge } : {}),
        targeting,
        effects: [
          {
            step: 'saving_throw',
            ability,
            dcFormula: dc,
            onFail,
          },
        ],
      };
    }
  }

  return {
    id,
    name: raw.name,
    description: desc,
    actionCost,
    ...(recharge ? { recharge } : {}),
    effects: [],
  };
}

export { ABILITY_IDS };
