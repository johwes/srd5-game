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
import { formatCopperCost, formatTitleCase } from '../compendium/formatters.js';
import { getInventoryItemName } from './inventoryCategories.js';

export interface InventoryGridCellProps {
  /** Canonical equipment / magic-item id. */
  itemId: string;
  /** Inventory instance id (for stack identity + testids). Defaults to itemId. */
  instanceId?: string;
  /** Stack count badge (hidden when 1). */
  quantity?: number;
  /** Live attunement state for inventory instances. */
  attunementState?: 'attuned' | 'unattuned' | 'n/a';
  /** Remaining charges override (instance-level). */
  chargesRemaining?: number;
  /** Provenance line, e.g. loot source or compare delta. */
  provenanceLine?: string;
  /** Compendium for name/description/mechanics lookup. */
  compendium: SrdCompendium;
  /** Selected (armed) visual state. */
  selected?: boolean;
  /** Native HTML5 drag source for drag-onto-paperdoll. */
  draggable?: boolean;
  /** Test id prefix (cell testid = `<prefix>-cell-<instanceId>`). */
  testIdPrefix?: string;
  /** Click / Enter activation (selects the cell). */
  onSelect?: (instanceId: string) => void;
  /** Drag payload starter (sets the drag data). */
  onDragStartInstance?: (event: React.DragEvent, instanceId: string) => void;
}

/**
 * SRD-1305 single backpack icon cell (Spec 12 §8).
 *
 * A focusable `<button>` (Deck-safe keyboard/Enter parity) carrying the item
 * icon, stack-count badge, rarity border, attunement pip, and the shared
 * `ItemTooltipCard` on hover/focus. Reused by `InventoryView` and the
 * discovered-loot grid so loot-modal text rows stay retired everywhere.
 */
export function InventoryGridCell({
  itemId,
  instanceId,
  quantity = 1,
  attunementState = 'n/a',
  chargesRemaining,
  provenanceLine,
  compendium,
  selected = false,
  draggable = false,
  testIdPrefix = 'inventory',
  onSelect,
  onDragStartInstance,
}: InventoryGridCellProps) {
  const instId = instanceId ?? itemId;
  const magic = compendium.getMagicItem(itemId);
  const equip = !magic ? compendium.getEquipment(itemId) : undefined;
  const rarity = getItemRarityForMagicItem(magic ?? null);
  const name = getInventoryItemName(itemId, compendium);
  const description =
    magic?.description ?? (equip as { description?: string } | undefined)?.description ?? 'No description available.';
  const categoryLabel = magic
    ? formatTitleCase(magic.category)
    : equip
      ? formatTitleCase(equip.kind)
      : 'Item';
  const costLabel = equip ? formatCopperCost(equip.costCopper) : undefined;
  const weightLabel = equip ? `${equip.weightLb} lb.` : undefined;
  const cellTestId = `${testIdPrefix}-cell-${instId}`;

  return (
    <button
      type="button"
      data-testid={cellTestId}
      aria-label={`${name}${quantity > 1 ? `, quantity ${quantity}` : ''}`}
      aria-pressed={selected}
      title={name}
      draggable={draggable}
      onClick={() => onSelect?.(instId)}
      onDragStart={(event) => onDragStartInstance?.(event, instId)}
      className={`group relative flex flex-col items-center justify-center gap-0.5 w-16 h-16 rounded-lg bg-slate-900 border-2 p-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${getRarityBorderClass(rarity)} ${selected ? 'ring-2 ring-amber-400 bg-slate-800' : 'hover:bg-slate-800'}`}
    >
      <ItemIcon itemId={itemId} size={26} testId={`${testIdPrefix}-cell-icon`} />
      <span
        data-testid={`${cellTestId}-name`}
        className={`max-w-full truncate text-[9px] leading-tight font-medium ${getRarityTextClass(rarity)}`}
      >
        {name}
      </span>
      {quantity > 1 && (
        <span
          data-testid={`${cellTestId}-stack`}
          className="absolute top-0.5 right-0.5 min-w-5 px-1 rounded bg-slate-950/90 border border-slate-600 text-[10px] font-bold text-slate-100 text-center"
        >
          ×{quantity}
        </span>
      )}
      {attunementState === 'attuned' && (
        <span
          data-testid={`${cellTestId}-attuned`}
          title="Attuned"
          className="absolute bottom-0.5 right-0.5 text-[10px] leading-none"
        >
          🟣
        </span>
      )}
      {magic && (
        <span
          data-testid={`${cellTestId}-rarity`}
          title={formatRarityLabel(rarity)}
          className={`absolute bottom-0.5 left-0.5 px-0.5 rounded text-[8px] font-bold border ${getRarityBadgeClass(rarity)}`}
        >
          {formatRarityLabel(rarity).slice(0, 1)}
        </span>
      )}
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
        requiresAttunement={Boolean(magic?.requiresAttunement)}
        attunementRestriction={magic?.attunementRestriction}
        attunementState={attunementState}
        costLabel={costLabel}
        weightLabel={weightLabel}
        provenanceLine={provenanceLine}
        testIdPrefix={cellTestId}
      />
    </button>
  );
}
