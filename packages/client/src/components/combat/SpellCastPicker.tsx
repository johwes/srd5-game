import type { EffectStepSpec, SpellData } from '@srd5/data';
import type { PlayerViewCombatant } from '@srd5/transport';
import { formatSpellRange, formatTitleCase } from '../compendium/formatters.js';
import { resolveSpellFormulaForTooltip } from './ActionHotbar.js';

export interface SpellSlotPool {
  available: number;
  max: number;
}

export interface SpellCastPickerProps {
  spell: SpellData;
  caster?: PlayerViewCombatant | null;
  spellSlots?: Record<number, SpellSlotPool | undefined>;
  selectedSlot: number;
  onSelectSlot: (slot: number) => void;
  bonusActionSpellCast?: boolean;
  testIdPrefix?: string;
}

const ROMAN: Record<number, string> = {
  1: 'I',
  2: 'II',
  3: 'III',
  4: 'IV',
  5: 'V',
  6: 'VI',
  7: 'VII',
  8: 'VIII',
  9: 'IX',
};

export function isCantripSpell(spell: SpellData): boolean {
  return spell.level === 0;
}

/** SRD 5.1 bonus-action casting rule: after a bonus-action spell, only cantrips remain. */
export function isBlockedByBonusActionRule(spell: SpellData, bonusActionSpellCast?: boolean): boolean {
  return Boolean(bonusActionSpellCast) && spell.level > 0;
}

/**
 * Parses an already-resolved dice formula (e.g. `8d6`, `1d8 + 3`, `2d6+1d8+2`)
 * into a min/max range. Returns null when no dice or constants are found.
 */
export function parseDiceRange(formula: string): { min: number; max: number } | null {
  const normalized = formula.replace(/\s+/g, '');
  if (normalized.length === 0) return null;
  // Split into signed tokens: e.g. "2d6+1d8-2" -> ["2d6", "+1d8", "-2"]
  const tokens = normalized.match(/[+-]?[^+-]+/g);
  if (!tokens) return null;
  let min = 0;
  let max = 0;
  let found = false;
  for (const token of tokens) {
    const sign = token.startsWith('-') ? -1 : 1;
    const body = token.replace(/^[+-]/, '');
    const dice = body.match(/^(\d+)d(\d+)$/i);
    if (dice) {
      const count = Number(dice[1]);
      const sides = Number(dice[2]);
      if (!Number.isFinite(count) || !Number.isFinite(sides) || count <= 0 || sides <= 0) continue;
      if (count > 100 || sides > 1000) continue;
      min += sign * count * 1;
      max += sign * count * sides;
      found = true;
      continue;
    }
    if (/^\d+$/.test(body)) {
      min += sign * Number(body);
      max += sign * Number(body);
      found = true;
      continue;
    }
    // Unresolved variable or unknown token — cannot compute an exact range.
    return null;
  }
  if (!found) return null;
  return { min, max };
}

interface DamageStepInfo {
  kind: 'damage' | 'heal' | 'temp';
  diceFormula: string;
  damageType?: string;
  halfOnSaveSuccess?: boolean;
}

function collectDamageSteps(steps: readonly EffectStepSpec[] | undefined, out: DamageStepInfo[]): void {
  if (!steps) return;
  for (const step of steps) {
    if (step.step === 'deal_damage') {
      out.push({
        kind: 'damage',
        diceFormula: step.diceFormula,
        damageType: (step as { damageType?: string }).damageType,
        halfOnSaveSuccess: (step as { halfOnSaveSuccess?: boolean }).halfOnSaveSuccess,
      });
    } else if (step.step === 'heal') {
      out.push({ kind: 'heal', diceFormula: step.diceFormula });
    } else if (step.step === 'grant_temp_hp') {
      out.push({ kind: 'temp', diceFormula: step.amountFormula });
    }
    const nested = step as unknown as Record<string, readonly EffectStepSpec[] | undefined>;
    if (Array.isArray(nested.onFail)) collectDamageSteps(nested.onFail, out);
    if (Array.isArray(nested.onSuccess)) collectDamageSteps(nested.onSuccess, out);
    if (Array.isArray(nested.onHit)) collectDamageSteps(nested.onHit, out);
    if (Array.isArray(nested.onMiss)) collectDamageSteps(nested.onMiss, out);
  }
}

export function getSpellDamageSteps(spell: SpellData): DamageStepInfo[] {
  const out: DamageStepInfo[] = [];
  collectDamageSteps(spell.effects, out);
  return out;
}

export function findSpellSaveAbility(spell: SpellData): string | null {
  const visit = (steps: readonly EffectStepSpec[] | undefined): string | null => {
    if (!steps) return null;
    for (const step of steps) {
      if (step.step === 'saving_throw') {
        return (step as { ability?: string }).ability ?? null;
      }
      const nested = step as unknown as Record<string, readonly EffectStepSpec[] | undefined>;
      for (const key of ['onFail', 'onSuccess', 'onHit', 'onMiss'] as const) {
        const found = visit(nested[key]);
        if (found) return found;
      }
    }
    return null;
  };
  return visit(spell.effects);
}

/**
 * Human-readable upcast preview derived from the spell's structured
 * `higherLevelScaling` (falls back to the author's `higherLevelDescription`).
 * Returns null for cantrips without scaling.
 */
export function getUpcastPreview(spell: SpellData): string | null {
  const scaling = spell.higherLevelScaling;
  if (scaling?.bonusDicePerSlotAboveBase) {
    const firstDamage = getSpellDamageSteps(spell)[0];
    const typeSuffix = firstDamage?.damageType ? ` ${formatTitleCase(firstDamage.damageType)}` : '';
    const verb = firstDamage?.kind === 'heal' ? 'Restores' : firstDamage?.kind === 'temp' ? 'Grants' : 'Deals';
    const noun = firstDamage?.kind === 'heal' ? 'healing' : firstDamage?.kind === 'temp' ? 'temporary hit points' : `damage`;
    return `Upcast: ${verb} an additional ${scaling.bonusDicePerSlotAboveBase}${typeSuffix} ${noun} per slot level above ${spell.level}.`;
  }
  if (scaling?.bonusTargetsPerSlotAboveBase) {
    return `Upcast: Targets ${scaling.bonusTargetsPerSlotAboveBase} additional creature${scaling.bonusTargetsPerSlotAboveBase === 1 ? '' : 's'} per slot level above ${spell.level}.`;
  }
  if (spell.higherLevelDescription) {
    return `Upcast: ${spell.higherLevelDescription}`;
  }
  return null;
}

export interface SpellSlotOption {
  level: number;
  available: number;
  max: number;
  disabled: boolean;
}

/**
 * Effective dice/amount formula at a cast slot: the base step formula plus
 * the spell's per-slot bonus dice (`bonusDicePerSlotAboveBase` × levels above
 * base), mirroring the engine DSL evaluator so the preview range matches
 * resolution math exactly. Cantrip character-tier overrides are keyed by
 * character level (not slot) and do not apply here.
 */
export function getEffectiveCastFormula(
  baseFormula: string,
  spell: SpellData,
  slotLevel: number,
  caster?: PlayerViewCombatant | null,
): string {
  const resolvedBase = resolveSpellFormulaForTooltip(baseFormula, caster, slotLevel);
  if (slotLevel <= spell.level) return resolvedBase;
  const bonus = spell.higherLevelScaling?.bonusDicePerSlotAboveBase;
  if (!bonus) return resolvedBase;
  const levelsAbove = slotLevel - spell.level;
  const resolvedBonus = resolveSpellFormulaForTooltip(bonus, caster, slotLevel).trim();
  const diceMatch = resolvedBonus.match(/^(\d+)d(\d+)(.*)$/i);
  if (diceMatch) {
    const total = Number(diceMatch[1]) * levelsAbove;
    const rest = diceMatch[3] ?? '';
    return `${resolvedBase} + ${total}d${diceMatch[2]}${rest}`;
  }
  const repeated = Array.from({ length: levelsAbove }, () => `(${resolvedBonus})`).join(' + ');
  return `${resolvedBase} + ${repeated}`;
}

/** Slot levels a leveled spell may be cast with (base level → 9, only known pools). */
export function getSpellSlotOptions(
  spell: SpellData,
  spellSlots?: Record<number, SpellSlotPool | undefined>,
): SpellSlotOption[] {
  if (isCantripSpell(spell)) return [];
  const options: SpellSlotOption[] = [];
  for (let level = spell.level; level <= 9; level += 1) {
    const pool = spellSlots?.[level];
    if (!pool || pool.max <= 0) continue;
    options.push({ level, available: pool.available, max: pool.max, disabled: pool.available <= 0 });
  }
  return options;
}

function formatCastingTimeLabel(spell: SpellData): string {
  const raw = spell.castingTime;
  if (raw === 'action') return 'Action';
  if (raw === 'bonus_action') return 'Bonus Action';
  if (raw === 'reaction') return 'Reaction';
  return formatTitleCase(String(raw).replace(/_/g, '-'));
}

/**
 * SRD-1508 cast-flow inspect card + slot picker (Spec 14 §11, beats 2–3).
 *
 * Beat 1 (pick spell) happens in the hotbar card or the spellbook cell; this
 * panel is the arming step: it inspects the spell (damage range, dice + type,
 * save, range, cost) beside a slot picker whose upcast preview is computed
 * from the spell's scaling formula at the selected slot. The parent re-arms
 * the pending target through `onSelectSlot` so preview math (resolved via
 * `resolveSpellFormulaForTooltip`) always matches resolution math exactly.
 *
 * Cantrips skip the picker (no slots); unavailable slots render
 * visible-but-disabled; the Bonus-Action casting restriction stays inline.
 */
export function SpellCastPicker({
  spell,
  caster,
  spellSlots,
  selectedSlot,
  onSelectSlot,
  bonusActionSpellCast,
  testIdPrefix = 'spell-cast',
}: SpellCastPickerProps) {
  const prefix = testIdPrefix;
  const isCantrip = isCantripSpell(spell);
  const blockedByBaRule = isBlockedByBonusActionRule(spell, bonusActionSpellCast);
  const options = getSpellSlotOptions(spell, spellSlots);
  const effectiveSlot = isCantrip ? 0 : selectedSlot;
  const upcastPreview = isCantrip ? null : getUpcastPreview(spell);

  const damageSteps = getSpellDamageSteps(spell);
  const primary = damageSteps[0] ?? null;
  const resolvedFormula = primary
    ? getEffectiveCastFormula(primary.diceFormula, spell, effectiveSlot, caster)
    : null;
  const range = resolvedFormula ? parseDiceRange(resolvedFormula) : null;
  const saveAbility = findSpellSaveAbility(spell);
  const saveDc =
    caster?.characterSheet?.spellcasting?.primarySpellSaveDc ??
    caster?.characterSheet?.spellcasting?.classes?.[0]?.spellSaveDc;
  const castingAbility =
    caster?.characterSheet?.spellcasting?.primaryAbility ??
    caster?.characterSheet?.spellcasting?.classes?.[0]?.ability;
  const selectedPool = !isCantrip ? spellSlots?.[effectiveSlot] : undefined;
  const noSlotsLeft = !isCantrip && selectedPool !== undefined && selectedPool.available <= 0;

  const damageRangeLabel = primary
    ? range
      ? `${range.min}-${range.max} ${primary.kind === 'damage' ? 'Damage' : primary.kind === 'heal' ? 'Healing' : 'Temp HP'}`
      : `${resolvedFormula} ${primary.kind === 'damage' ? 'Damage' : primary.kind === 'heal' ? 'Healing' : 'Temp HP'}`
    : 'Utility — no damage or healing';

  const diceLine = primary
    ? `${resolvedFormula}${primary.damageType ? ` ${formatTitleCase(primary.damageType)}` : ''}${primary.halfOnSaveSuccess ? ' (half on successful save)' : ''}`
    : null;

  return (
    <div
      data-testid={`${prefix}-picker`}
      aria-label={`Cast ${spell.name}: inspect and choose a spell slot`}
      className="w-80 max-w-[92vw] rounded-xl border border-purple-500/40 bg-slate-950/95 shadow-2xl backdrop-blur-md text-left flex flex-col gap-2 p-3"
    >
      {/* Inspect card header */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-1.5">
        <span className="font-bold text-slate-100 text-xs truncate" data-testid={`${prefix}-name`}>
          {spell.name}
        </span>
        <span
          data-testid={`${prefix}-badge`}
          className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] font-semibold text-purple-200 shrink-0"
        >
          {isCantrip ? 'Cantrip' : `Level ${spell.level}`} · {formatTitleCase(spell.school)}
        </span>
      </div>

      {/* Damage range + dice line */}
      <div className="space-y-0.5">
        <div
          data-testid={`${prefix}-damage-range`}
          className="text-sm font-bold text-amber-300 font-mono"
        >
          {damageRangeLabel}
        </div>
        {diceLine && (
          <div data-testid={`${prefix}-dice-line`} className="text-[11px] text-slate-300">
            {diceLine}
          </div>
        )}
      </div>

      <p data-testid={`${prefix}-description`} className="text-[11px] text-slate-400 leading-relaxed">
        {spell.description}
      </p>

      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-300">
        <span data-testid={`${prefix}-range`}>Range: {formatSpellRange(spell.targeting)}</span>
        {saveAbility && (
          <span data-testid={`${prefix}-save`}>
            Save: {saveAbility.toUpperCase()}
            {saveDc !== undefined ? ` vs DC ${saveDc}` : ' vs your spell save DC'}
            {castingAbility ? ` (${castingAbility.toUpperCase()} casting)` : ''}
          </span>
        )}
      </div>

      {/* Cost row */}
      <div
        data-testid={`${prefix}-cost`}
        className="flex items-center justify-center gap-1.5 pt-1.5 border-t border-slate-800 text-[11px] font-semibold text-amber-300"
      >
        <span>▲ {formatCastingTimeLabel(spell)}</span>
        {!isCantrip && (
          <>
            <span className="text-slate-600">+</span>
            <span className="text-sky-300">■ Level {effectiveSlot} Slot</span>
          </>
        )}
      </div>

      {/* Slot picker (skipped for cantrips) */}
      {!isCantrip && (
        <div className="pt-1 border-t border-slate-800 space-y-1.5">
          <div
            data-testid={`${prefix}-slots`}
            role="group"
            aria-label={`Choose a spell slot for ${spell.name}`}
            className="flex flex-wrap items-center gap-1"
          >
            {options.length === 0 ? (
              <span data-testid={`${prefix}-no-slots`} className="text-[11px] text-slate-500">
                No spell slots of level {spell.level} or higher.
              </span>
            ) : (
              options.map((opt) => (
                <button
                  key={opt.level}
                  type="button"
                  data-testid={`${prefix}-slot-${opt.level}`}
                  aria-pressed={effectiveSlot === opt.level}
                  aria-label={`Level ${opt.level} slot, ${opt.available} of ${opt.max} available${opt.disabled ? ', exhausted' : ''}`}
                  disabled={opt.disabled}
                  onClick={() => onSelectSlot(opt.level)}
                  className={`px-2 py-1 rounded-md text-[11px] font-mono font-bold border focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 transition-colors ${
                    effectiveSlot === opt.level
                      ? 'bg-purple-500 text-slate-950 border-purple-500'
                      : opt.disabled
                        ? 'bg-slate-950 text-slate-600 border-slate-800 cursor-not-allowed line-through'
                        : 'bg-slate-900 border-purple-700/60 text-purple-200 hover:border-purple-400'
                  }`}
                >
                  {ROMAN[opt.level] ?? opt.level} {opt.available}/{opt.max}
                </button>
              ))
            )}
          </div>
          {upcastPreview && effectiveSlot > spell.level && (
            <div data-testid={`${prefix}-upcast-preview`} className="text-[11px] text-purple-200">
              {upcastPreview} Casting at level {effectiveSlot}
              {primary && resolvedFormula ? ` (${resolvedFormula})` : ''}.
            </div>
          )}
          {upcastPreview && effectiveSlot <= spell.level && (
            <div data-testid={`${prefix}-upcast-preview`} className="text-[11px] text-slate-500">
              {upcastPreview}
            </div>
          )}
        </div>
      )}

      {(blockedByBaRule || noSlotsLeft) && (
        <div
          data-testid={`${prefix}-warning`}
          className="flex items-start gap-1 text-[11px] text-rose-400 font-medium"
        >
          <span aria-hidden>⚠️</span>
          <span>
            {blockedByBaRule
              ? 'Bonus Action spell cast: only cantrips remain this turn (SRD 5.1).'
              : `No level ${effectiveSlot} spell slots left.`}
          </span>
        </div>
      )}
    </div>
  );
}
