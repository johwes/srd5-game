import type { ActivatedAbilitySpec, EffectStepSpec, ModifierSpec } from '@srd5/data';

/**
 * SRD-1302: Item-specific effect summarizer (Spec 12 §4).
 *
 * Human "game effect" lines for `modifiers[]` / `activatedAbilities[]` shown
 * in the emerald box of `ItemTooltipCard` and the compendium magic-item view.
 * Defensive against template leakage: any `@variable` left in a formula is
 * rendered as its bare name (never a raw `@` token) so tooltips carry
 * "no raw template vars" per the Epic 13 acceptance criteria.
 */

function sanitizeFormula(formula: string | number): string {
  const raw = String(formula);
  // `@spellMod` -> `spellMod`, `{@x}` -> `x`, `{{y}}` -> `y`.
  return raw
    .replace(/\{+/g, '')
    .replace(/\}+/g, '')
    .replace(/@([a-zA-Z0-9_]+)/g, '$1')
    .trim();
}

function formatTargetLabel(target: string): string {
  const map: Record<string, string> = {
    ac: 'AC',
    initiative: 'initiative',
    speed: 'speed',
    melee_attack: 'melee attacks',
    ranged_attack: 'ranged attacks',
    spell_attack: 'spell attacks',
    spell_save_dc: 'spell save DC',
    melee_damage: 'melee damage',
    ranged_damage: 'ranged damage',
    all_saving_throws: 'all saving throws',
    hp_per_level: 'HP per level',
    attack_rolls: 'attack rolls',
    attacks_against_self: 'attacks against you',
    concentration_saves: 'Concentration saves',
    death_saves: 'death saves',
    all_ability_checks: 'ability checks',
  };
  if (map[target]) return map[target];
  if (target.startsWith('save:')) return `${target.slice('save:'.length).toUpperCase()} saves`;
  if (target.startsWith('skill:')) {
    const skill = target.slice('skill:'.length).replace(/_/g, ' ');
    return `${skill} checks`;
  }
  return target.replace(/_/g, ' ');
}

function formatSigned(value: string | number): string {
  if (typeof value === 'number') return value >= 0 ? `+${value}` : `${value}`;
  const t = sanitizeFormula(value);
  return /^[+-]/.test(t) ? t : `+${t}`;
}

/** One-line human summary for a single modifier. */
export function summarizeItemModifier(mod: ModifierSpec): string {
  switch (mod.type) {
    case 'flat_bonus': {
      const target = formatTargetLabel(String(mod.target));
      return `${formatSigned(mod.value as string | number)} to ${target}`;
    }
    case 'ability_score':
      return `${formatSigned(mod.bonus)} ${String(mod.ability).toUpperCase()}`;
    case 'set_ability_minimum':
      return `${String(mod.ability).toUpperCase()} set to ${mod.minimum} while attuned/worn`;
    case 'roll_mode': {
      const target = formatTargetLabel(String(mod.target));
      const mode = mod.mode === 'advantage' ? 'Advantage' : 'Disadvantage';
      return `${mode} on ${target}`;
    }
    case 'damage_mitigation': {
      const kinds = mod.damageTypes.join(', ');
      const label =
        mod.mitigation === 'resistance'
          ? 'Resistance'
          : mod.mitigation === 'immunity'
            ? 'Immunity'
            : 'Vulnerability';
      return `${label} to ${kinds} damage`;
    }
    case 'condition_immunity':
      return `Immunity to ${mod.conditions.join(', ')}`;
    case 'ac_calculation':
      return `AC formula: ${sanitizeFormula(mod.formula)}${mod.allowsShield ? ' (+shield)' : ''}`;
    case 'die_manipulation':
      return `Die rule: ${String(mod.rule).replace(/_/g, ' ')}`;
    case 'extra_attack':
      return `Extra attacks: ${mod.attacksPerAction} per action`;
    case 'grant_resource':
      return `Grants ${mod.name} (${sanitizeFormula(mod.maxFormula)}, ${mod.recovery})`;
    default:
      return 'Special magical effect';
  }
}

function summarizeEffectStep(step: EffectStepSpec): string | null {
  switch (step.step) {
    case 'heal':
      return `Restore ${sanitizeFormula(step.diceFormula)} hit points`;
    case 'grant_temp_hp':
      return `Grant ${sanitizeFormula(step.amountFormula)} temporary hit points`;
    case 'deal_damage':
      return `Deal ${sanitizeFormula(step.diceFormula)} ${step.damageType} damage${step.halfOnSaveSuccess ? ' (half on save)' : ''}`;
    case 'apply_condition':
      return `Inflict ${String(step.conditionId).replace(/-/g, ' ')}`;
    case 'apply_active_effect':
      return `Apply ${step.name}`;
    case 'attack_roll':
      return `Attack roll (${step.attackType.replace(/_/g, ' ')})`;
    case 'saving_throw':
      return `Save: ${step.ability.toUpperCase()} vs ${sanitizeFormula(step.dcFormula)}`;
    case 'forced_movement':
      return `${step.direction === 'push_from_actor' ? 'Push' : 'Pull'} ${step.distanceFeet} ft.`;
    case 'teleport':
      return `Teleport up to ${step.maxDistanceFeet} ft.`;
    case 'create_hazard_zone':
      return `Create ${step.sizeFeet} ft ${step.shape} hazard zone`;
    case 'spend_resource':
      return `Spend ${step.amount} ${step.resourceId}`;
    case 'summon_creature':
      return `Summon ${step.name}`;
    case 'manual_adjudication':
      return step.title;
    default:
      return null;
  }
}

function collectAbilityLines(ability: ActivatedAbilitySpec): string[] {
  const lines: string[] = [];
  for (const step of ability.effects ?? []) {
    const line = summarizeEffectStep(step);
    if (line && !lines.includes(line)) lines.push(line);
    if (lines.length >= 2) break;
  }
  return lines;
}

/** One-line summary for a single activated ability. */
export function summarizeItemAbility(ability: ActivatedAbilitySpec): string {
  const detail = collectAbilityLines(ability);
  if (detail.length === 0) return ability.name;
  return `${ability.name}: ${detail.join('; ')}`;
}

/**
 * Full "game effect" box lines for an item: one per modifier plus one per
 * activated ability (capped for tooltip density).
 */
export function summarizeItemMechanics(
  modifiers?: readonly ModifierSpec[] | null,
  activatedAbilities?: readonly ActivatedAbilitySpec[] | null,
): string[] {
  const lines: string[] = [];
  for (const mod of modifiers ?? []) {
    lines.push(summarizeItemModifier(mod));
    if (lines.length >= 6) break;
  }
  if (lines.length < 6) {
    for (const ability of activatedAbilities ?? []) {
      lines.push(summarizeItemAbility(ability));
      if (lines.length >= 6) break;
    }
  }
  return lines;
}

/** True when a rendered line still leaks a raw template token. */
export function hasRawTemplateVars(line: string): boolean {
  return /@\{|@\w|\{\{/.test(line);
}
