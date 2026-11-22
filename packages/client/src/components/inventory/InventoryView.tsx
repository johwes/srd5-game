import React, { useMemo, useState } from 'react';
import type { InventoryItemInstance, SrdCompendium } from '@srd5/data';
import type { DerivedWeaponAttackProfile } from '@srd5/engine';
import { ItemIcon } from './ItemIcon.js';
import { ItemTooltipCard } from './ItemTooltipCard.js';
import { InventoryGridCell } from './InventoryGridCell.js';
import {
  INVENTORY_FILTERS,
  INVENTORY_FILTER_LABELS,
  getInventoryFilterCategory,
  getInventoryItemName,
  getInventoryTotalWeightLb,
  isInventoryItemAttunable,
  isInventoryItemUsable,
  type InventoryFilterKey,
} from './inventoryCategories.js';
import {
  candidateSlotsForItem,
  compareItemToEquipped,
  suggestEquipSlot,
} from './inventoryCompare.js';
import {
  INVENTORY_SORTS,
  INVENTORY_SORT_LABELS,
  getInventoryItemValueCopper,
  sortInventoryInstances,
  type InventorySortKey,
} from './inventorySort.js';
import {
  formatRarityLabel,
  getItemRarityForMagicItem,
  getRarityBorderClass,
  getRarityTextClass,
} from './itemRarity.js';
import { formatGoldCost, formatSignedNumber, formatTitleCase } from '../compendium/formatters.js';

/** The 5 engine paperdoll slots mirrored by the BG3-style grid (Spec 12 §8). */
export type InventorySlotName = 'armor' | 'shield' | 'mainHand' | 'offHand' | 'ranged';

export const PAPERDOLL_SLOTS: readonly InventorySlotName[] = [
  'armor',
  'shield',
  'mainHand',
  'offHand',
  'ranged',
] as const;

export const PAPERDOLL_SLOT_LABELS: Record<InventorySlotName, string> = {
  armor: 'Armor',
  shield: 'Shield',
  mainHand: 'Main Hand',
  offHand: 'Off Hand',
  ranged: 'Ranged',
};

/**
 * Read one equipped instance id from either slot-key shape:
 * - short UI form `{ armor: '<inst>' }` (used by `LootInventoryModal`), or
 * - long engine form `{ armorInstanceId: '<inst>' }` (written by dispatches).
 */
export function resolveEquippedInstanceId(
  slots: Record<string, string | undefined> | undefined | null,
  slot: InventorySlotName,
): string | undefined {
  if (!slots) return undefined;
  return slots[slot] ?? slots[`${slot}InstanceId`];
}

export interface InventoryViewCurrency {
  gp?: number;
}

export interface InventoryViewProps {
  /** Owning hero id (dispatched back on equip/attune/use). */
  heroId: string;
  /** Owning hero display name. */
  heroName: string;
  /** Full backpack incl. equipped instances. */
  inventory: readonly InventoryItemInstance[];
  /** Equipped slots (short or long key shape). */
  equippedSlots: Record<string, string | undefined>;
  /** Attuned instance ids (max 3). */
  attunedItemInstanceIds: readonly string[];
  /** Coin purse. */
  currency?: InventoryViewCurrency;
  /** Compendium for lookups. */
  compendium: SrdCompendium;
  /** Equip (or unequip when `instanceId` is `undefined`). */
  onEquipItem: (slot: InventorySlotName, instanceId: string | undefined) => void;
  /** Attune / unattune by instance id. */
  onAttuneItem: (instanceId: string) => void;
  onUnattuneItem: (instanceId: string) => void;
  /** Optional Use action (potions, scrolls, wands). */
  onUseItem?: (instanceId: string) => void;
  /** Test id prefix. Defaults to `inventory`. */
  testIdPrefix?: string;
  // ── SRD-1306 stretch actions (all optional; hidden when unset) ──
  /** Party heroes available as give/trade targets (excluding self). */
  partyHeroes?: ReadonlyArray<{ id: string; name: string }>;
  /** STR score for the carrying-capacity readout (capacity = STR × 15). */
  strScore?: number;
  /** Derived weapon attack profiles for the melee/ranged weapon cards (SRD-1503). */
  weaponAttacks?: readonly DerivedWeaponAttackProfile[];
  /** Precomputed equip-restriction messages (errors block, warnings inform). */
  equipIssues?: ReadonlyArray<{ slot: string; message: string; severity: 'error' | 'warning' }>;
  /** Give/trade the selected stack to another hero. */
  onTransferItem?: (instanceId: string, toHeroId: string) => void;
  /**
   * SRD-1504: notified when the right-click context menu opens/closes so a
   * hosting modal can keep Esc for menu-dismiss instead of closing itself.
   */
  onContextMenuOpenChange?: (open: boolean) => void;  /** Drop/discard the selected stack. */
  onDropItem?: (instanceId: string) => void;
  /** Split `quantity` units off the selected stack. */
  onSplitStack?: (instanceId: string, quantity: number) => void;
  /** Identify an unidentified magic item (free dungeon handling). */
  onIdentifyItem?: (instanceId: string) => void;
  /** Dungeon sell-back at half value. */
  onSellItem?: (instanceId: string) => void;
}

/**
 * SRD-1305 BG3-style graphical inventory (Spec 12 §8).
 *
 * Left: visual paperdoll — the 5 engine slots as large icon slots with
 * rarity borders and attunement pips; click inspects, click-then-click with
 * a selected backpack item equips it, drag-and-drop works the same, and
 * every slot is a focusable button so focus + Enter (Steam Deck) has full
 * parity with mouse/touch.
 *
 * Right: icon-grid backpack with stack counts, rarity borders, type
 * filters, text search, and a selection action bar (Equip / Use / Attune)
 * with `+1 AC`-style compare deltas in the tooltip and the action bar.
 */
export function InventoryView({
  heroId,
  heroName,
  inventory,
  equippedSlots,
  attunedItemInstanceIds,
  currency,
  compendium,
  onEquipItem,
  onAttuneItem,
  onUnattuneItem,
  onUseItem,
  testIdPrefix = 'inventory',
  partyHeroes,
  strScore,
  weaponAttacks,
  equipIssues,
  onTransferItem,
  onDropItem,
  onSplitStack,
  onIdentifyItem,
  onSellItem,
  onContextMenuOpenChange,
}: InventoryViewProps) {
  const prefix = `${testIdPrefix}-${heroId}`;
  const [filter, setFilter] = useState<InventoryFilterKey>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<InventorySortKey>('newest');
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [splitQuantity, setSplitQuantity] = useState(1);
  const [giveTargetId, setGiveTargetId] = useState('');
  const [contextMenu, setContextMenu] = useState<{ instanceId: string; x: number; y: number } | null>(null);

  const instanceById = useMemo(() => {
    const map = new Map<string, InventoryItemInstance>();
    for (const inst of inventory) map.set(inst.instanceId, inst);
    return map;
  }, [inventory]);

  const equippedInstanceBySlot = useMemo(() => {
    const map = new Map<InventorySlotName, InventoryItemInstance>();
    for (const slot of PAPERDOLL_SLOTS) {
      const instId = resolveEquippedInstanceId(equippedSlots, slot);
      const inst = instId ? instanceById.get(instId) : undefined;
      if (inst) map.set(slot, inst);
    }
    return map;
  }, [equippedSlots, instanceById]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return inventory.filter((inst) => {
      if (filter !== 'all' && getInventoryFilterCategory(inst.itemId, compendium) !== filter) {
        return false;
      }
      if (needle.length > 0) {
        const name = getInventoryItemName(inst.itemId, compendium).toLowerCase();
        if (!name.includes(needle) && !inst.itemId.toLowerCase().includes(needle)) return false;
      }
      return true;
    });
  }, [inventory, filter, search, compendium]);

  // SRD-1504 sort control (native select; Deck focus+Enter parity).
  const visible = useMemo(
    () => sortInventoryInstances(filtered, sort, compendium),
    [filtered, sort, compendium],
  );

  const selected = selectedInstanceId ? (instanceById.get(selectedInstanceId) ?? null) : null;
  const selectedSlots = selected ? candidateSlotsForItem(selected.itemId, compendium) : [];
  const selectedSuggested = selected ? suggestEquipSlot(selected.itemId, compendium) : null;
  const selectedUsable = selected ? isInventoryItemUsable(selected.itemId, compendium) : false;
  const selectedAttunable = selected ? isInventoryItemAttunable(selected.itemId, compendium) : false;
  const selectedIsAttuned = selected ? attunedItemInstanceIds.includes(selected.instanceId) : false;
  const selectedCompare = selected
    ? compareItemToEquipped(
        selected.itemId,
        selectedSuggested
          ? (equippedInstanceBySlot.get(selectedSuggested)?.itemId ?? null)
          : null,
        compendium,
      )
    : [];

  const totalWeightLb = getInventoryTotalWeightLb(inventory, compendium);
  // Gold-only economy: the purse holds whole gold pieces.
  const totalGp = currency?.gp ?? 0;

  const handleDropOnSlot = (event: React.DragEvent, slot: InventorySlotName) => {
    event.preventDefault();
    const instId =
      event.dataTransfer.getData('text/inventory-instance-id') ||
      event.dataTransfer.getData('text/plain');
    const inst = instId ? instanceById.get(instId) : undefined;
    if (!inst) return;
    if (!candidateSlotsForItem(inst.itemId, compendium).includes(slot)) return;
    onEquipItem(slot, inst.instanceId);
    setSelectedInstanceId(inst.instanceId);
  };

  const handlePaperdollClick = (slot: InventorySlotName) => {
    // Click-then-click equip: a selected backpack item that fits this slot
    // equips here; otherwise the click inspects the current occupant.
    if (selected && selectedSlots.includes(slot)) {
      onEquipItem(slot, selected.instanceId);
      return;
    }
    const occupant = equippedInstanceBySlot.get(slot);
    setSelectedInstanceId(occupant ? occupant.instanceId : null);
  };

  /**
   * SRD-1504 double-click / double-tap activation (Spec 14 §4): equips into
   * the suggested slot when the item is equippable, otherwise fires Use when
   * the item is usable. Single click/Enter still only selects (action bar).
   */
  const handleActivate = (instanceId: string) => {
    const inst = instanceById.get(instanceId);
    if (!inst) return;
    setSelectedInstanceId(instanceId);
    setContextMenu(null);
    const suggested = suggestEquipSlot(inst.itemId, compendium);
    if (suggested) {
      onEquipItem(suggested, instanceId);
      return;
    }
    if (isInventoryItemUsable(inst.itemId, compendium) && onUseItem) {
      onUseItem(instanceId);
    }
  };

  /** SRD-1504 right-click / long-press opener (keyboard parity lives in the action bar). */
  const openContextMenu = (event: { preventDefault(): void; clientX: number; clientY: number }, instanceId: string) => {
    event.preventDefault();
    setSelectedInstanceId(instanceId);
    setContextMenu({ instanceId, x: event.clientX, y: event.clientY });
  };

  const closeContextMenu = () => setContextMenu(null);

  React.useEffect(() => {
    if (!contextMenu) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [contextMenu]);

  React.useEffect(() => {
    onContextMenuOpenChange?.(contextMenu !== null);
  }, [contextMenu, onContextMenuOpenChange]);

  const ctxInstance = contextMenu ? (instanceById.get(contextMenu.instanceId) ?? null) : null;
  const ctxSlots = ctxInstance ? candidateSlotsForItem(ctxInstance.itemId, compendium) : [];
  const ctxUsable = ctxInstance ? isInventoryItemUsable(ctxInstance.itemId, compendium) : false;
  const ctxAttunable = ctxInstance ? isInventoryItemAttunable(ctxInstance.itemId, compendium) : false;
  const ctxIsAttuned = ctxInstance ? attunedItemInstanceIds.includes(ctxInstance.instanceId) : false;
  const ctxValueCopper = ctxInstance ? getInventoryItemValueCopper(ctxInstance.itemId, compendium) : 0;

  return (
    <div data-testid={`${prefix}-view`} className="flex flex-col gap-3">
      {/* Currency + encumbrance-display strip (display only; no enforcement). */}
      <div className="flex items-center justify-between gap-2 text-xs">
        <div data-testid={`${prefix}-currency`} className="font-medium text-slate-300">
          💰 {totalGp} gp
        </div>
        <div data-testid={`${prefix}-weight`} className="font-medium text-slate-400">
          ⚖️ {totalWeightLb} lb. carried
          {strScore !== undefined && (
            <span
              data-testid={`${prefix}-capacity`}
              className={totalWeightLb > strScore * 15 ? 'text-red-300 font-semibold' : 'text-slate-500'}
            >
              {' '}
              / {strScore * 15} lb. cap{totalWeightLb > strScore * 15 ? ' — encumbered (display only)' : ''}
            </span>
          )}
        </div>
      </div>
      {/* SRD-1503 weight capacity bar (STR × 15, display only). */}
      {strScore !== undefined && (
        <div>
          <div
            data-testid={`${prefix}-weight-bar`}
            role="progressbar"
            aria-valuenow={
              strScore * 15 > 0 ? Math.min(100, Math.round((totalWeightLb / (strScore * 15)) * 100)) : 0
            }
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${heroName} carrying capacity`}
            className="h-1.5 rounded-full bg-slate-800 overflow-hidden"
          >
            <div
              className={`h-full ${
                totalWeightLb > strScore * 15
                  ? 'bg-red-400'
                  : totalWeightLb >= strScore * 15 * 0.8
                    ? 'bg-amber-400'
                    : 'bg-emerald-400'
              }`}
              style={{
                width: `${strScore * 15 > 0 ? Math.min(100, Math.round((totalWeightLb / (strScore * 15)) * 100)) : 0}%`,
              }}
            />
          </div>
        </div>
      )}
      {equipIssues && equipIssues.length > 0 && (
        <div data-testid={`${prefix}-equip-issues`} className="rounded-lg border border-red-500/40 bg-red-950/40 p-2 text-[11px] text-red-200">
          {equipIssues.map((issue, idx) => (
            <div key={`${issue.slot}-${idx}`} data-testid={`${prefix}-equip-issue-${idx}`}>
              {issue.severity === 'error' ? '⛔' : '⚠️'} {issue.slot}: {issue.message}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-3">
        {/* ── Left: visual paperdoll ── */}
        <div data-testid={`${prefix}-paperdoll`} aria-label={`${heroName} paperdoll`}>
          <div className="text-[10px] font-semibold uppercase text-slate-400 mb-1.5">
            🛡️ {heroName} — Equipped
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {PAPERDOLL_SLOTS.map((slot) => {
              const occupant = equippedInstanceBySlot.get(slot);
              const magic = occupant ? compendium.getMagicItem(occupant.itemId) : undefined;
              const equip = occupant && !magic ? compendium.getEquipment(occupant.itemId) : undefined;
              const rarity = getItemRarityForMagicItem(magic ?? null);
              const name = occupant ? getInventoryItemName(occupant.itemId, compendium) : 'Empty';
              const isAttuned = occupant ? attunedItemInstanceIds.includes(occupant.instanceId) : false;
              return (
                <div key={slot} className="flex flex-col gap-1">
                  <div className="text-[10px] uppercase font-semibold text-slate-500">
                    {PAPERDOLL_SLOT_LABELS[slot]}
                  </div>
                  <button
                    type="button"
                    data-testid={`${prefix}-paperdoll-slot-${slot}`}
                    aria-label={`${PAPERDOLL_SLOT_LABELS[slot]} slot${occupant ? `: ${name}` : ' (empty)'}`}
                    title={occupant ? name : `${PAPERDOLL_SLOT_LABELS[slot]} (empty)`}
                    onClick={() => handlePaperdollClick(slot)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => handleDropOnSlot(event, slot)}
                    className={`group relative flex flex-col items-center justify-center gap-0.5 min-h-20 rounded-xl bg-slate-900 border-2 p-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 transition-colors ${getRarityBorderClass(rarity)} ${selected && selectedSlots.includes(slot) ? 'ring-2 ring-amber-400/70' : ''}`}
                  >
                    {occupant ? (
                      <>
                        <ItemIcon
                          itemId={occupant.itemId}
                          size={30}
                          testId={`${prefix}-paperdoll-icon`}
                        />
                        <span
                          className={`max-w-full truncate text-[10px] font-semibold ${getRarityTextClass(rarity)}`}
                        >
                          {name}
                        </span>
                        {isAttuned && (
                          <span
                            data-testid={`${prefix}-paperdoll-attuned-${slot}`}
                            title="Attuned"
                            className="absolute top-1 right-1 text-xs leading-none"
                          >
                            🟣
                          </span>
                        )}
                        <ItemTooltipCard
                          itemId={occupant.itemId}
                          name={name}
                          rarity={rarity}
                          categoryLabel={
                            magic
                              ? formatTitleCase(magic.category)
                              : equip
                                ? formatTitleCase(equip.kind)
                                : 'Item'
                          }
                          description={
                            magic?.description ??
                            (equip as { description?: string } | undefined)?.description ??
                            'No description available.'
                          }
                          modifiers={magic?.modifiers ?? null}
                          activatedAbilities={magic?.activatedAbilities ?? null}
                          charges={
                            magic?.charges
                              ? {
                                  max: magic.charges.max,
                                  remaining: occupant.chargesRemaining,
                                  rechargeFormula: magic.charges.rechargeFormula,
                                  rechargeTiming: magic.charges.rechargeTiming ?? undefined,
                                }
                              : null
                          }
                          requiresAttunement={Boolean(magic?.requiresAttunement)}
                          attunementState={isAttuned ? 'attuned' : 'unattuned'}
                          testIdPrefix={`${prefix}-paperdoll-${slot}`}
                        />
                      </>
                    ) : (
                      <span className="text-[11px] text-slate-600 font-medium">Empty</span>
                    )}
                  </button>
                  {occupant && (
                    <button
                      type="button"
                      data-testid={`${prefix}-unequip-${slot}`}
                      onClick={() => {
                        onEquipItem(slot, undefined);
                        if (selectedInstanceId === occupant.instanceId) setSelectedInstanceId(null);
                      }}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                    >
                      Unequip
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-1 text-[10px] text-purple-300/90" data-testid={`${prefix}-attunement-count`}>
            🔮 Attuned {attunedItemInstanceIds.length} / 3 max
          </div>
          {/* SRD-1503 weapon cards: melee / ranged from derived attack profiles. */}
          {(() => {
            const attacks = weaponAttacks ?? [];
            const melee =
              attacks.find((a) => a.slot === 'main_hand' && a.rangeType === 'melee') ??
              attacks.find((a) => a.slot === 'off_hand' && a.rangeType === 'melee') ??
              attacks.find((a) => a.rangeType === 'melee') ??
              null;
            const ranged = attacks.find((a) => a.rangeType === 'ranged') ?? null;
            const cards: ReadonlyArray<{ key: 'melee' | 'ranged'; label: string; profile: DerivedWeaponAttackProfile | null }> = [
              { key: 'melee', label: '⚔️ Melee', profile: melee },
              { key: 'ranged', label: '🏹 Ranged', profile: ranged },
            ];
            return (
              <div className="mt-2 flex flex-col gap-1.5" aria-label={`${heroName} weapon cards`}>
                {cards.map(({ key, label, profile }) => (
                  <div
                    key={key}
                    data-testid={`${prefix}-weapon-${key}`}
                    className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-2"
                  >
                    {profile ? (
                      <>
                        <ItemIcon itemId={profile.weaponId} size={26} testId={`${prefix}-weapon-${key}-icon`} />
                        <div className="min-w-0 flex-1">
                          <div
                            data-testid={`${prefix}-weapon-${key}-name`}
                            className="truncate text-[11px] font-bold text-slate-100"
                          >
                            {label} · {profile.name}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                            <span
                              data-testid={`${prefix}-weapon-${key}-tohit`}
                              title={
                                profile.toHitBreakdown.length > 0
                                  ? profile.toHitBreakdown.map((c) => `${c.sourceName} ${formatSignedNumber(c.value)}`).join(', ')
                                  : undefined
                              }
                              className="px-1.5 py-0.5 rounded bg-sky-950/70 border border-sky-700/50 text-sky-200 font-mono font-semibold"
                            >
                              {formatSignedNumber(profile.toHitBonus)} to hit
                            </span>
                            <span
                              data-testid={`${prefix}-weapon-${key}-damage`}
                              title={
                                profile.damageBreakdown.length > 0
                                  ? profile.damageBreakdown.map((c) => `${c.sourceName} ${formatSignedNumber(c.value)}`).join(', ')
                                  : undefined
                              }
                              className="font-mono text-amber-200"
                            >
                              {profile.damageFormula} {profile.damageType}
                            </span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div
                        data-testid={`${prefix}-weapon-${key}-empty`}
                        className="text-[11px] text-slate-500"
                      >
                        {label} · No {key === 'melee' ? 'melee' : 'ranged'} weapon ready
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        {/* ── Right: backpack grid ── */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1.5" role="group" aria-label="Backpack filters">
            {INVENTORY_FILTERS.map((key) => (
              <button
                key={key}
                type="button"
                data-testid={`${prefix}-filter-${key}`}
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                className={`px-2 py-1 rounded-md text-[11px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${filter === key ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:text-white'}`}
              >
                {INVENTORY_FILTER_LABELS[key]}
              </button>
            ))}
            <input
              type="search"
              data-testid={`${prefix}-search`}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search items…"
              aria-label="Search backpack"
              className="ml-auto px-2 py-1 rounded-md bg-slate-950 border border-slate-700 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 w-36"
            />
            <label className="inline-flex items-center gap-1 text-[11px] text-slate-400">
              Sort
              <select
                data-testid={`${prefix}-sort`}
                value={sort}
                onChange={(event) => setSort(event.target.value as InventorySortKey)}
                aria-label="Sort backpack"
                className="px-1 py-1 rounded bg-slate-950 border border-slate-700 text-[11px] text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              >
                {INVENTORY_SORTS.map((key) => (
                  <option key={key} value={key}>
                    {INVENTORY_SORT_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div
            data-testid={`${prefix}-grid`}
            role="grid"
            aria-label={`${heroName} backpack (${visible.length} items)`}
            className="grid grid-cols-4 sm:grid-cols-5 lg:grid-cols-6 gap-1.5 p-2 rounded-xl bg-slate-950/60 border border-slate-800 max-h-72 overflow-y-auto"
          >
            {visible.length === 0 ? (
              <div
                data-testid={`${prefix}-grid-empty`}
                className="col-span-full p-4 text-center text-xs text-slate-500"
              >
                {inventory.length === 0 ? 'Backpack is empty.' : 'No items match this filter.'}
              </div>
            ) : (
              visible.map((inst) => {
                const compareLines = compareItemToEquipped(
                  inst.itemId,
                  (() => {
                    const suggested = suggestEquipSlot(inst.itemId, compendium);
                    return suggested
                      ? (equippedInstanceBySlot.get(suggested)?.itemId ?? null)
                      : null;
                  })(),
                  compendium,
                );
                return (
                  <InventoryGridCell
                    key={inst.instanceId}
                    itemId={inst.itemId}
                    instanceId={inst.instanceId}
                    quantity={inst.quantity}
                    attunementState={
                      isInventoryItemAttunable(inst.itemId, compendium)
                        ? attunedItemInstanceIds.includes(inst.instanceId)
                          ? 'attuned'
                          : 'unattuned'
                        : 'n/a'
                    }
                    chargesRemaining={inst.chargesRemaining}
                    provenanceLine={compareLines.length > 0 ? compareLines.join('; ') : undefined}
                    compendium={compendium}
                    selected={selectedInstanceId === inst.instanceId}
                    draggable={candidateSlotsForItem(inst.itemId, compendium).length > 0}
                    testIdPrefix={prefix}
                    onSelect={setSelectedInstanceId}
                    onActivate={handleActivate}
                    onContextMenuInstance={openContextMenu}
                    onDragStartInstance={(event, dragId) => {
                      event.dataTransfer.setData('text/inventory-instance-id', dragId);
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                  />
                );
              })
            )}
          </div>

          {/* SRD-1504 right-click context menu (same handlers as the action bar). */}
          {contextMenu && ctxInstance && (
            <div
              data-testid={`${prefix}-ctx-backdrop`}
              className="fixed inset-0 z-[70]"
              onClick={closeContextMenu}
              onContextMenu={(event) => {
                event.preventDefault();
                closeContextMenu();
              }}
            >
              <div
                role="menu"
                aria-label={`${getInventoryItemName(ctxInstance.itemId, compendium)} actions`}
                data-testid={`${prefix}-ctx-menu-${ctxInstance.instanceId}`}
                onClick={(event) => event.stopPropagation()}
                onContextMenu={(event) => event.preventDefault()}
                style={{
                  position: 'fixed',
                  left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 250)),
                  top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 320)),
                }}
                className="w-56 rounded-xl border border-amber-500/40 bg-slate-900 shadow-2xl p-1.5 flex flex-col gap-0.5 max-h-80 overflow-y-auto"
              >
                <div className="px-2 py-1 text-[11px] font-bold text-slate-100 truncate border-b border-slate-800 mb-1">
                  {getInventoryItemName(ctxInstance.itemId, compendium)}
                  {ctxInstance.quantity > 1 && (
                    <span className="text-slate-400"> ×{ctxInstance.quantity}</span>
                  )}
                </div>
                {ctxSlots.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    role="menuitem"
                    data-testid={`${prefix}-ctx-equip-${slot}-${ctxInstance.instanceId}`}
                    onClick={() => {
                      onEquipItem(slot, ctxInstance.instanceId);
                      closeContextMenu();
                    }}
                    className="px-2 py-1.5 rounded-lg text-left text-[12px] font-semibold text-slate-200 hover:bg-amber-500 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                  >
                    Equip → {PAPERDOLL_SLOT_LABELS[slot]}
                  </button>
                ))}
                {ctxUsable && onUseItem && (
                  <button
                    type="button"
                    role="menuitem"
                    data-testid={`${prefix}-ctx-use-${ctxInstance.instanceId}`}
                    onClick={() => {
                      onUseItem(ctxInstance.instanceId);
                      closeContextMenu();
                    }}
                    className="px-2 py-1.5 rounded-lg text-left text-[12px] font-semibold text-emerald-200 hover:bg-emerald-700 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                  >
                    Use
                  </button>
                )}
                {ctxAttunable &&
                  (ctxIsAttuned ? (
                    <button
                      type="button"
                      role="menuitem"
                      data-testid={`${prefix}-ctx-unattune-${ctxInstance.instanceId}`}
                      onClick={() => {
                        onUnattuneItem(ctxInstance.instanceId);
                        closeContextMenu();
                      }}
                      className="px-2 py-1.5 rounded-lg text-left text-[12px] font-semibold text-slate-200 hover:bg-slate-700 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                    >
                      Unattune
                    </button>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      data-testid={`${prefix}-ctx-attune-${ctxInstance.instanceId}`}
                      disabled={attunedItemInstanceIds.length >= 3}
                      onClick={() => {
                        onAttuneItem(ctxInstance.instanceId);
                        closeContextMenu();
                      }}
                      className="px-2 py-1.5 rounded-lg text-left text-[12px] font-semibold text-purple-200 hover:bg-purple-800 hover:text-white disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
                    >
                      Attune{attunedItemInstanceIds.length >= 3 ? ' (3 max)' : ''}
                    </button>
                  ))}
                {onTransferItem &&
                  partyHeroes &&
                  partyHeroes.filter((h) => h.id !== heroId).length > 0 && (
                    <div className="border-t border-slate-800 pt-1 mt-0.5">
                      <div className="px-2 py-0.5 text-[10px] uppercase font-semibold text-slate-500">
                        Send to hero
                      </div>
                      {partyHeroes
                        .filter((h) => h.id !== heroId)
                        .map((h) => (
                          <button
                            key={h.id}
                            type="button"
                            role="menuitem"
                            data-testid={`${prefix}-ctx-send-${h.id}-${ctxInstance.instanceId}`}
                            onClick={() => {
                              onTransferItem(ctxInstance.instanceId, h.id);
                              closeContextMenu();
                            }}
                            className="w-full px-2 py-1.5 rounded-lg text-left text-[12px] font-semibold text-slate-200 hover:bg-amber-500 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                          >
                            ➡ {h.name}
                          </button>
                        ))}
                    </div>
                  )}
                {onSplitStack && ctxInstance.quantity > 1 && (
                  <div className="border-t border-slate-800 pt-1 mt-0.5 flex items-center gap-1 px-1">
                    <input
                      type="number"
                      min={1}
                      max={ctxInstance.quantity - 1}
                      value={Math.min(splitQuantity, ctxInstance.quantity - 1)}
                      onChange={(event) => setSplitQuantity(Number(event.target.value))}
                      data-testid={`${prefix}-ctx-split-qty-${ctxInstance.instanceId}`}
                      aria-label="Split quantity"
                      className="w-14 px-1 py-1 rounded bg-slate-950 border border-slate-700 text-[11px] text-slate-200"
                    />
                    <button
                      type="button"
                      role="menuitem"
                      data-testid={`${prefix}-ctx-split-${ctxInstance.instanceId}`}
                      onClick={() => {
                        onSplitStack(ctxInstance.instanceId, splitQuantity);
                        closeContextMenu();
                      }}
                      className="flex-1 px-2 py-1.5 rounded-lg text-left text-[12px] font-semibold text-slate-200 hover:bg-slate-700 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                    >
                      Split stack
                    </button>
                  </div>
                )}
                {ctxInstance.identified === false && onIdentifyItem && (
                  <button
                    type="button"
                    role="menuitem"
                    data-testid={`${prefix}-ctx-identify-${ctxInstance.instanceId}`}
                    onClick={() => {
                      onIdentifyItem(ctxInstance.instanceId);
                      closeContextMenu();
                    }}
                    className="px-2 py-1.5 rounded-lg text-left text-[12px] font-semibold text-sky-200 hover:bg-sky-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                  >
                    🔍 Identify
                  </button>
                )}
                {onDropItem && (
                  <button
                    type="button"
                    role="menuitem"
                    data-testid={`${prefix}-ctx-drop-${ctxInstance.instanceId}`}
                    onClick={() => {
                      onDropItem(ctxInstance.instanceId);
                      closeContextMenu();
                    }}
                    className="px-2 py-1.5 rounded-lg text-left text-[12px] font-semibold text-red-200 hover:bg-red-900/70 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                  >
                    Drop
                  </button>
                )}
                {onSellItem && (
                  <button
                    type="button"
                    role="menuitem"
                    data-testid={`${prefix}-ctx-sell-${ctxInstance.instanceId}`}
                    title={
                      ctxValueCopper > 0
                        ? `Value ${formatGoldCost(ctxValueCopper)} · sells for ${formatGoldCost(Math.floor(ctxValueCopper / 2))}`
                        : 'Unpriced — sells for 0 gp'
                    }
                    onClick={() => {
                      onSellItem(ctxInstance.instanceId);
                      closeContextMenu();
                    }}
                    className="px-2 py-1.5 rounded-lg text-left text-[12px] font-semibold text-yellow-200 hover:bg-yellow-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400"
                  >
                    Sell (½ value
                    {ctxValueCopper > 0 ? ` · ${formatGoldCost(Math.floor(ctxValueCopper / 2))}` : ''}
                    )
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Selection action bar: Equip / Use / Attune + compare deltas. */}
          {selected && (
            <div
              data-testid={`${prefix}-actions-${selected.instanceId}`}
              className="mt-1.5 p-2 rounded-xl bg-slate-900 border border-amber-500/40 flex flex-col gap-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-slate-100 truncate">
                  {getInventoryItemName(selected.itemId, compendium)}
                  {selected.quantity > 1 && (
                    <span className="text-slate-400"> ×{selected.quantity}</span>
                  )}
                  {magicRarityBadge(selected.itemId, compendium)}
                </div>
                <button
                  type="button"
                  data-testid={`${prefix}-deselect`}
                  onClick={() => setSelectedInstanceId(null)}
                  aria-label="Clear selection"
                  className="text-slate-500 hover:text-white text-sm px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded"
                >
                  ✕
                </button>
              </div>
              {selectedCompare.length > 0 ? (
                <div
                  data-testid={`${prefix}-compare-${selected.instanceId}`}
                  className="text-[11px] text-emerald-300 font-medium"
                >
                  ⚖ {selectedCompare.join(' · ')}
                </div>
              ) : (
                <div
                  data-testid={`${prefix}-compare-${selected.instanceId}`}
                  className="text-[11px] text-slate-500"
                >
                  {selectedSuggested ? 'No stat change vs equipped.' : 'Not equippable — works from the backpack.'}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                {selectedSlots.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    data-testid={`${prefix}-equip-${selected.instanceId}-${slot}`}
                    onClick={() => onEquipItem(slot, selected.instanceId)}
                    className={`px-2 py-1 rounded text-[11px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${slot === selectedSuggested ? 'bg-amber-500 hover:bg-amber-400 text-slate-950' : 'bg-slate-800 hover:bg-slate-700 text-slate-200'}`}
                  >
                    Equip → {PAPERDOLL_SLOT_LABELS[slot]}
                  </button>
                ))}
                {selectedUsable && onUseItem && (
                  <button
                    type="button"
                    data-testid={`${prefix}-use-${selected.instanceId}`}
                    onClick={() => onUseItem(selected.instanceId)}
                    className="px-2 py-1 rounded bg-emerald-900/60 hover:bg-emerald-800 border border-emerald-700/60 text-emerald-200 text-[11px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                  >
                    Use
                  </button>
                )}
                {selectedAttunable &&
                  (selectedIsAttuned ? (
                    <button
                      type="button"
                      data-testid={`${prefix}-unattune-${selected.instanceId}`}
                      onClick={() => onUnattuneItem(selected.instanceId)}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                    >
                      Unattune
                    </button>
                  ) : (
                    <button
                      type="button"
                      data-testid={`${prefix}-attune-${selected.instanceId}`}
                      disabled={attunedItemInstanceIds.length >= 3}
                      onClick={() => onAttuneItem(selected.instanceId)}
                      className="px-2 py-1 rounded bg-purple-900/60 hover:bg-purple-800 border border-purple-700/60 text-purple-200 text-[11px] font-semibold disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
                    >
                      Attune{attunedItemInstanceIds.length >= 3 ? ' (3 max)' : ''}
                    </button>
                  ))}
              </div>
              {/* SRD-1306 stretch: identify / give / drop / split / sell. */}
              {(onIdentifyItem || onTransferItem || onDropItem || onSplitStack || onSellItem) && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-800">
                  {selected.identified === false && onIdentifyItem && (
                    <button
                      type="button"
                      data-testid={`${prefix}-identify-${selected.instanceId}`}
                      onClick={() => onIdentifyItem(selected.instanceId)}
                      className="px-2 py-1 rounded bg-sky-900/60 hover:bg-sky-800 border border-sky-700/60 text-sky-200 text-[11px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                    >
                      🔍 Identify
                    </button>
                  )}
                  {selected.identified === false && (
                    <span
                      data-testid={`${prefix}-unidentified-${selected.instanceId}`}
                      className="text-[11px] text-sky-300/80 italic"
                    >
                      Unidentified — properties masked until identified.
                    </span>
                  )}
                  {onDropItem && (
                    <button
                      type="button"
                      data-testid={`${prefix}-drop-${selected.instanceId}`}
                      onClick={() => onDropItem(selected.instanceId)}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-red-900/60 border border-slate-700 text-slate-300 text-[11px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                    >
                      Drop
                    </button>
                  )}
                  {onSellItem && (
                    <button
                      type="button"
                      data-testid={`${prefix}-sell-${selected.instanceId}`}
                      onClick={() => onSellItem(selected.instanceId)}
                      className="px-2 py-1 rounded bg-yellow-900/60 hover:bg-yellow-800 border border-yellow-700/60 text-yellow-200 text-[11px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400"
                    >
                      Sell (½ value)
                    </button>
                  )}
                  {onSplitStack && selected.quantity > 1 && (
                    <span className="inline-flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        max={selected.quantity - 1}
                        value={splitQuantity}
                        onChange={(event) => setSplitQuantity(Number(event.target.value))}
                        data-testid={`${prefix}-split-qty-${selected.instanceId}`}
                        aria-label="Split quantity"
                        className="w-14 px-1 py-1 rounded bg-slate-950 border border-slate-700 text-[11px] text-slate-200"
                      />
                      <button
                        type="button"
                        data-testid={`${prefix}-split-${selected.instanceId}`}
                        onClick={() => onSplitStack(selected.instanceId, splitQuantity)}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                      >
                        Split stack
                      </button>
                    </span>
                  )}
                  {onTransferItem && partyHeroes && partyHeroes.filter((h) => h.id !== heroId).length > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <select
                        data-testid={`${prefix}-give-target-${selected.instanceId}`}
                        value={giveTargetId}
                        onChange={(event) => setGiveTargetId(event.target.value)}
                        aria-label="Give to hero"
                        className="px-1 py-1 rounded bg-slate-950 border border-slate-700 text-[11px] text-slate-200"
                      >
                        <option value="">Give to…</option>
                        {partyHeroes
                          .filter((h) => h.id !== heroId)
                          .map((h) => (
                            <option key={h.id} value={h.id}>
                              {h.name}
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        data-testid={`${prefix}-give-${selected.instanceId}`}
                        disabled={!giveTargetId}
                        onClick={() => giveTargetId && onTransferItem(selected.instanceId, giveTargetId)}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                      >
                        Give
                      </button>
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function magicRarityBadge(itemId: string, compendium: SrdCompendium): React.ReactNode {
  const magic = compendium.getMagicItem(itemId);
  if (!magic) return null;
  return (
    <span className="ml-1.5 text-[10px] text-slate-400 font-normal">
      {formatRarityLabel(getItemRarityForMagicItem(magic))}
    </span>
  );
}
