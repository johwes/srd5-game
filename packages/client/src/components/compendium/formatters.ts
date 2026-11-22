import type {
  AbilityBonusMap,
  AbilityId,
  ChallengeRating,
  SpellComponents,
  SpellDuration,
  SpellLevel,
  SpellTargetSpec,
} from '@srd5/data';

const ABILITY_LABELS: Readonly<Record<AbilityId, string>> = {
  str: 'STR',
  dex: 'DEX',
  con: 'CON',
  int: 'INT',
  wis: 'WIS',
  cha: 'CHA',
};

const ABILITY_FULL_NAMES: Readonly<Record<AbilityId, string>> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};

export function formatAbilityAbbrev(ability: AbilityId): string {
  return ABILITY_LABELS[ability] ?? ability.toUpperCase();
}

export function formatAbilityFullName(ability: AbilityId): string {
  return ABILITY_FULL_NAMES[ability] ?? ability;
}

export function computeAbilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function formatSignedNumber(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

export function formatAbilityScoreWithMod(score: number): string {
  const mod = computeAbilityModifier(score);
  return `${score} (${formatSignedNumber(mod)})`;
}

export function formatAbilityBonuses(bonuses: AbilityBonusMap): string {
  const entries = (Object.entries(bonuses) as Array<[AbilityId, number | undefined]>).filter(
    (entry): entry is [AbilityId, number] => typeof entry[1] === 'number' && entry[1] !== 0,
  );
  if (entries.length === 0) return 'None';
  return entries
    .map(([ability, bonus]) => `${formatAbilityAbbrev(ability)} ${formatSignedNumber(bonus)}`)
    .join(', ');
}

export function formatChallengeRating(cr: ChallengeRating | number): string {
  if (cr === 0.125) return '1/8';
  if (cr === 0.25) return '1/4';
  if (cr === 0.5) return '1/2';
  return String(cr);
}

export function formatSpellLevel(level: SpellLevel): string {
  if (level === 0) return 'Cantrip';
  if (level === 1) return '1st Level';
  if (level === 2) return '2nd Level';
  if (level === 3) return '3rd Level';
  return `${level}th Level`;
}

export function formatCopperCost(costCopper: number): string {
  if (costCopper <= 0) return '0 cp';
  if (costCopper % 100 === 0) {
    return `${costCopper / 100} gp`;
  }
  if (costCopper % 10 === 0) {
    const gp = Math.floor(costCopper / 100);
    const sp = (costCopper % 100) / 10;
    if (gp > 0 && sp > 0) return `${gp} gp, ${sp} sp`;
    return `${costCopper / 10} sp`;
  }
  const gp = Math.floor(costCopper / 100);
  const sp = Math.floor((costCopper % 100) / 10);
  const cp = costCopper % 10;
  const parts: string[] = [];
  if (gp > 0) parts.push(`${gp} gp`);
  if (sp > 0) parts.push(`${sp} sp`);
  if (cp > 0) parts.push(`${cp} cp`);
  return parts.join(', ');
}

/**
 * Gold-only economy price tag for game-economy surfaces (loot tooltips,
 * backpack cells, shop/builder rows). SRD catalog costs stay copper-denoted
 * in the data; the purse only holds whole gold, so sub-gold prices read as
 * trimmed-decimal gold (e.g. 50cp → "0.5 gp", 200cp → "2 gp").
 */
export function formatGoldCost(costCopper: number): string {
  if (costCopper <= 0) return '0 gp';
  const gp = costCopper / 100;
  const text = Number.isInteger(gp)
    ? String(gp)
    : gp.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${text} gp`;
}

export function formatTitleCase(slug: string): string {
  return slug
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatSpellDuration(duration: SpellDuration, concentration: boolean): string {
  let base: string;
  switch (duration.type) {
    case 'instantaneous':
      base = 'Instantaneous';
      break;
    case 'rounds':
      base = `${duration.rounds} ${duration.rounds === 1 ? 'round' : 'rounds'}`;
      break;
    case 'minutes':
      base = `${duration.amount} ${duration.amount === 1 ? 'minute' : 'minutes'}`;
      break;
    case 'hours':
      base = `${duration.amount} ${duration.amount === 1 ? 'hour' : 'hours'}`;
      break;
    case 'days':
      base = `${duration.amount} ${duration.amount === 1 ? 'day' : 'days'}`;
      break;
    case 'until_dispelled':
      base = 'Until dispelled';
      break;
    case 'special':
      base = 'Special';
      break;
  }
  return concentration ? `Concentration, up to ${base}` : base;
}

export function formatSpellComponents(components: SpellComponents): string {
  const letters: string[] = [];
  if (components.verbal) letters.push('V');
  if (components.somatic) letters.push('S');
  if (components.material) {
    if (components.materialDescription) {
      letters.push(`M (${components.materialDescription})`);
    } else {
      letters.push('M');
    }
  }
  return letters.length > 0 ? letters.join(', ') : 'None';
}

export function formatSpellRange(targeting: SpellTargetSpec): string {
  const rangeStr =
    targeting.rangeFeet === 0
      ? targeting.type === 'self' || targeting.type === 'self_aoe'
        ? 'Self'
        : 'Touch'
      : `${targeting.rangeFeet} ft`;

  if (targeting.aoe) {
    return `${rangeStr} (${targeting.aoe.sizeFeet}-ft ${targeting.aoe.shape})`;
  }
  return rangeStr;
}
