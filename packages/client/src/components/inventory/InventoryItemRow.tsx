import React from 'react';
import type { SrdCompendium } from '@srd5/data';
import { ItemIcon } from './ItemIcon.js';
import { ItemTooltipCard } from './ItemTooltipCard.js';
import {
  formatRarityLabel,
  getItemRarityForMagicItem,
  getRarityBadgeClass,
  getRarityBorderClass,
  getRarityTextClass,
} from './itemRarity.js';
import { formatGoldCost, formatTitleCase } from '../compendium/formatters.js';

export interface InventoryItemRowProps {
  /** Canonical equipment / magic-item id. */
  itemId: string;
  /** Compendium for name/description/mechanics lookup. */
  compendium: SrdCompendium;
  /** Stack count (defaults to 1, hidden when 1). */
  quantity?: number;
  /** Live attunement state for inventory instances. */
  attunementState?: 'attuned' | 'unattuned' | 'n/a';
  /** Remaining charges override (instance-level). */
  chargesRemaining?: number;
  /** Provenance line, e.g. loot source. */
  provenanceLine?: string;
  /** Test id base, e.g. `loot-item-longsword-0`. */
  testId: string;
  /** Action buttons rendered on the right (Equip / Use / Attune / Buy / Sell). */
  actions?: React.ReactNode;
}

/**
 * SRD-1302 shared item row: icon + rarity border + name + badge with a
 * hover/focus tooltip (description, game effect, charges, attunement).
 *
 * Used by loot, shop, and paperdoll surfaces so the rarity visual language
 * stays in one place.
 */
export function InventoryItemRow({
  itemId,
  compendium,
  quantity = 1,
  attunementState = 'n/a',
  chargesRemaining,
  provenanceLine,
  testId,
  actions,
}: InventoryItemRowProps) {
  const magic = compendium.getMagicItem(itemId);
  const equip = !magic ? compendium.getEquipment(itemId) : undefined;
  const rarity = getItemRarityForMagicItem(magic ?? null);
  const name = magic?.name ?? equip?.name ?? itemId.replace(/[-_]/g, ' ');
  const description =
    magic?.description ?? (equip as { description?: string } | undefined)?.description ?? 'No description available.';
  const isAttunable = Boolean(magic?.requiresAttunement);
  const categoryLabel = magic
    ? formatTitleCase(magic.category)
    : equip
      ? formatTitleCase(equip.kind)
      : 'Item';
  const costLabel = equip ? formatGoldCost(equip.costCopper) : undefined;
  const weightLabel = equip ? `${equip.weightLb} lb.` : undefined;

  return (
    <div
      data-testid={testId}
      className={`group relative flex items-center justify-between gap-2 p-2 rounded bg-slate-900 border text-xs ${getRarityBorderClass(rarity)}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="shrink-0">
          <ItemIcon itemId={itemId} size={18} testId={`${testId}-icon`} />
        </span>
        <div className="min-w-0">
          <div className={`font-medium truncate flex items-center gap-1.5 ${getRarityTextClass(rarity)}`}>
            <span className="truncate">{name}</span>
            {quantity > 1 && <span className="text-slate-400 shrink-0">x{quantity}</span>}
            {magic && (
              <span
                data-testid={`${testId}-rarity`}
                className={`px-1 py-px rounded text-[10px] border shrink-0 ${getRarityBadgeClass(rarity)}`}
              >
                {formatRarityLabel(rarity)}
              </span>
            )}
          </div>
          {isAttunable && (
            <div className="text-[10px] text-purple-400">
              {attunementState === 'attuned'
                ? '🟣 Attuned'
                : attunementState === 'unattuned'
                  ? '⚪ Unattuned (Attunement Req)'
                  : 'Requires Attunement'}
            </div>
          )}
        </div>
      </div>

      {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}

      <ItemTooltipCard
        itemId={itemId}
        name={name}
        rarity={rarity}
        categoryLabel={categoryLabel}
        description={description}
        modifiers={
          magic?.modifiers ?? (equip?.kind === 'gear' ? (equip.modifiers ?? null) : null)
        }
        activatedAbilities={
          magic?.activatedAbilities ??
          (equip?.kind === 'gear' ? (equip.activatedAbilities ?? null) : null)
        }
        charges={
          magic?.charges
            ? {
                max: magic.charges.max,
                remaining: chargesRemaining,
                rechargeFormula: magic.charges.rechargeFormula,
                rechargeTiming: magic.charges.rechargeTiming ?? undefined,
              }
            : null
        }
        requiresAttunement={isAttunable}
        attunementRestriction={magic?.attunementRestriction}
        attunementState={attunementState}
        costLabel={costLabel}
        weightLabel={weightLabel}
        provenanceLine={provenanceLine}
        testIdPrefix={testId}
      />
    </div>
  );
}
