import React from 'react';
import type { ActivatedAbilitySpec, ModifierSpec } from '@srd5/data';
import { ItemIcon } from './ItemIcon.js';
import {
  formatRarityLabel,
  getRarityBadgeClass,
  getRarityBorderClass,
  type ItemRarityKey,
} from './itemRarity.js';
import { summarizeItemMechanics } from './itemEffectSummary.js';

export interface ItemTooltipCharges {
  max: number;
  remaining?: number;
  rechargeFormula?: string;
  rechargeTiming?: string;
}

export interface ItemTooltipCardProps {
  /** Canonical item id (used for the icon + testid suffix). */
  itemId: string;
  /** Display name, e.g. "Longsword +1". */
  name: string;
  /** Rarity key; mundane equipment passes `common`. */
  rarity?: ItemRarityKey;
  /** Category line, e.g. "Weapon • Martial Melee" / "Potion" / "Wondrous". */
  categoryLabel?: string;
  /** SRD 5.1 description paragraph. */
  description: string;
  /** Passive modifiers rendered into the emerald game-effect box. */
  modifiers?: readonly ModifierSpec[] | null;
  /** Activated abilities rendered into the emerald game-effect box. */
  activatedAbilities?: readonly ActivatedAbilitySpec[] | null;
  /** Precomputed effect lines (override; else derived from modifiers/abilities). */
  effectSummary?: readonly string[];
  /** Charge pool + recharge (wands/staffs). */
  charges?: ItemTooltipCharges | null;
  /** Attunement requirement from the dataset. */
  requiresAttunement?: boolean;
  /** Dataset attunement restriction, e.g. "by a spellcaster". */
  attunementRestriction?: string;
  /** Live attunement state for inventory instances. */
  attunementState?: 'attuned' | 'unattuned' | 'n/a';
  /** Cost line, e.g. "50 gp". */
  costLabel?: string;
  /** Weight line, e.g. "3 lb.". */
  weightLabel?: string;
  /** Extra footer line (provenance, e.g. "Goblin loot"). */
  provenanceLine?: string;
  /** Test id prefix. Defaults to `item`. */
  testIdPrefix?: string;
}

/**
 * SRD-1302 shared item tooltip card (Spec 12 §4).
 *
 * Mirrors the SRD-1215 `SkillTooltipCard` pattern (`role="tooltip"`,
 * `group-hover` reveal, `<prefix>-tooltip-<id>` testids): header with icon +
 * name + rarity badge + category/attunement line, SRD description body,
 * emerald "game effect" box, and a charges/attunement/cost/weight footer.
 */
export function ItemTooltipCard({
  itemId,
  name,
  rarity = 'common',
  categoryLabel,
  description,
  modifiers,
  activatedAbilities,
  effectSummary,
  charges,
  requiresAttunement = false,
  attunementRestriction,
  attunementState = 'n/a',
  costLabel,
  weightLabel,
  provenanceLine,
  testIdPrefix = 'item',
}: ItemTooltipCardProps) {
  const testId = `${testIdPrefix}-tooltip-${itemId}`;
  const effects = effectSummary ?? summarizeItemMechanics(modifiers, activatedAbilities);
  const effectLines = (effects ?? []).filter((l) => l.trim().length > 0);
  const rarityLabel = formatRarityLabel(rarity);

  const chargesLine = charges
    ? charges.remaining !== undefined
      ? `${charges.remaining}/${charges.max} charges${charges.rechargeFormula ? `, recharge ${charges.rechargeFormula}` : ''}${charges.rechargeTiming ? ` at ${charges.rechargeTiming}` : ''}`
      : `Up to ${charges.max} charges${charges.rechargeFormula ? ` (recharges ${charges.rechargeFormula}${charges.rechargeTiming ? ` at ${charges.rechargeTiming}` : ''})` : ''}`
    : null;

  const showLegendarySparkle = rarity === 'legendary';

  return (
    <div
      role="tooltip"
      data-testid={testId}
      className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3 bg-slate-950/95 border ${getRarityBorderClass(rarity)} rounded-xl shadow-2xl backdrop-blur-md text-left flex flex-col gap-1.5 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 focus-within:opacity-100 pointer-events-none transition-opacity z-50`}
    >
      <div className="flex items-center justify-between gap-1.5 border-b border-slate-800 pb-1.5">
        <span className="font-bold text-slate-100 text-xs flex items-center gap-1.5 min-w-0">
          <ItemIcon itemId={itemId} size={16} testId={`${testIdPrefix}-tooltip-icon`} />
          <span className="truncate">{name}</span>
        </span>
        <span
          data-testid={`${testId}-rarity`}
          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border shrink-0 ${getRarityBadgeClass(rarity)}`}
        >
          {showLegendarySparkle ? `✨ ${rarityLabel}` : rarityLabel}
        </span>
      </div>

      {(categoryLabel || requiresAttunement) && (
        <div data-testid={`${testId}-category`} className="text-[10px] text-slate-400 capitalize">
          {categoryLabel ?? 'Item'}
          {requiresAttunement
            ? ` • Requires Attunement${attunementRestriction ? ` (${attunementRestriction})` : ''}`
            : ''}
        </div>
      )}

      <div
        data-testid={`${testId}-description`}
        className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-line max-h-40 overflow-y-auto"
      >
        {description}
      </div>

      {effectLines.length > 0 && (
        <div
          data-testid={`${testId}-effect`}
          className="text-[11px] leading-relaxed rounded bg-emerald-950/40 border border-emerald-800/50 px-2 py-1 text-emerald-200"
        >
          <span className="font-semibold">⚙ Game effect: </span>
          {effectLines.join('; ')}
        </div>
      )}

      <div className="flex flex-col gap-0.5 text-[10px] text-slate-400">
        {chargesLine && (
          <div data-testid={`${testId}-charges`} className="text-amber-200/90 font-medium">
            ⚡ {chargesLine}
          </div>
        )}
        {requiresAttunement && attunementState !== 'n/a' && (
          <div data-testid={`${testId}-attunement`} className="text-purple-300 font-medium">
            {attunementState === 'attuned' ? '🟣 Attuned' : '⚪ Unattuned (Attunement Req)'}
          </div>
        )}
        {(costLabel || weightLabel) && (
          <div data-testid={`${testId}-cost`} className="font-medium">
            {[costLabel, weightLabel].filter(Boolean).join(' • ')}
          </div>
        )}
        {provenanceLine && (
          <div data-testid={`${testId}-provenance`} className="italic">
            {provenanceLine}
          </div>
        )}
      </div>
    </div>
  );
}
