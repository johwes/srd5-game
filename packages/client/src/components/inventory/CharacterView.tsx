import { useEffect, useMemo, useState } from 'react';
import {
  ABILITY_IDS,
  SKILL_IDS,
  type CharacterBuildState,
  type SrdCompendium,
  defaultCompendium,
} from '@srd5/data';
import { computeDerivedCharacter, getXpProgress } from '@srd5/engine';
import { ItemIcon } from './ItemIcon.js';
import {
  INVENTORY_FILTERS,
  INVENTORY_FILTER_LABELS,
  getInventoryFilterCategory,
  getInventoryItemName,
  getInventoryTotalWeightLb,
  type InventoryFilterKey,
} from './inventoryCategories.js';
import { InventoryView, type InventorySlotName } from './InventoryView.js';
import {
  INVENTORY_SORTS,
  INVENTORY_SORT_LABELS,
  sortInventoryInstances,
  type InventorySortKey,
} from './inventorySort.js';
import {
  formatAbilityAbbrev,
  formatAbilityFullName,
  formatSignedNumber,
  formatTitleCase,
} from '../compendium/formatters.js';

export type CharacterViewRailTab = 'build' | 'skills' | 'attributes';

export type CharacterViewMode = 'character' | 'party';

export interface CharacterViewProps {
  /** All active heroes (1–4) shown in the switcher. */
  heroes: CharacterBuildState[];
  /** Currently displayed hero id. */
  activeHeroId: string;
  /** Compendium for lookups. */
  compendium?: SrdCompendium;
  /** Switch the displayed hero. */
  onSelectHero: (heroId: string) => void;
  /** Close the fullscreen modal (also bound to Esc). */
  onClose: () => void;
  /** Equip (or unequip when `instanceId` is `undefined`). */
  onEquipItem: (heroId: string, slot: InventorySlotName, instanceId: string | undefined) => void;
  /** Attune / unattune by instance id. */
  onAttuneItem: (heroId: string, instanceId: string) => void;
  onUnattuneItem: (heroId: string, instanceId: string) => void;
  /** Optional Use action (potions, scrolls, wands). */
  onUseItem?: (heroId: string, instanceId: string) => void;
  /** Optional hero-to-hero transfer. */
  onTransferItem?: (fromHeroId: string, instanceId: string, toHeroId: string) => void;
  /** Optional drop / split / identify / sell (stretch parity). */
  onDropItem?: (heroId: string, instanceId: string) => void;
  onSplitStack?: (heroId: string, instanceId: string, quantity: number) => void;
  onIdentifyItem?: (heroId: string, instanceId: string) => void;
  onSellItem?: (heroId: string, instanceId: string) => void;
  /** Test id prefix. Defaults to `character-view`. */
  testIdPrefix?: string;
  /** Initial view mode. Defaults to `character`. */
  initialMode?: CharacterViewMode;
}

const RAIL_TABS: ReadonlyArray<{ id: CharacterViewRailTab; label: string }> = [
  { id: 'build', label: 'Build' },
  { id: 'skills', label: 'Skills' },
  { id: 'attributes', label: 'Attributes' },
];

/**
 * SRD-1503 class-tinted doll backdrop (Spec 14 §5: token sprite enlarged on a
 * class-tinted backdrop; licensed-icon palette only, no Larian art).
 */
export function getDollBackdropClass(classId: string | undefined): string {
  switch ((classId ?? '').toLowerCase()) {
    case 'fighter':
      return 'from-red-950 via-red-900 to-slate-900 border-red-700/50';
    case 'wizard':
      return 'from-indigo-950 via-indigo-900 to-slate-900 border-indigo-700/50';
    case 'cleric':
      return 'from-amber-950 via-amber-900 to-slate-900 border-amber-700/50';
    case 'rogue':
      return 'from-emerald-950 via-emerald-900 to-slate-900 border-emerald-700/50';
    case 'bard':
      return 'from-fuchsia-950 via-fuchsia-900 to-slate-900 border-fuchsia-700/50';
    case 'ranger':
      return 'from-lime-950 via-lime-900 to-slate-900 border-lime-700/50';
    case 'druid':
      return 'from-green-950 via-green-900 to-slate-900 border-green-700/50';
    default:
      return 'from-slate-800 via-slate-900 to-slate-950 border-slate-700';
  }
}

/**
 * SRD-1501 BG3-style Character view shell (Spec 14 §3.1).
 *
 * Full-screen 3-pane modal: stats rail · doll + equipment · backpack.
 * The doll + backpack panes reuse the Spec-12 `InventoryView` grid and
 * paperdoll slots verbatim (no grid fork); this shell adds the header
 * (portrait, race · class/level line, XP bar, party gold total, hero
 * switcher, Esc close) and the left stats rail (Build / Skills /
 * Attributes tabs over sheet-drawer derived data, presentation only).
 *
 * SRD-1502 adds the Party strip mode (Spec 14 §3.2): all active heroes side
 * by side, each with a doll card (portrait, HP, AC, per-hero gold) plus a
 * condensed backpack grid and a STR×15 weight bar. A shared search/filter
 * applies to every card; hero-to-hero moves dispatch through
 * `onTransferItem` (click → "Send to <hero>" or drag card-to-card) and
 * re-render from engine state (no optimistic UI).
 */
export function CharacterView({
  heroes,
  activeHeroId,
  compendium = defaultCompendium,
  onSelectHero,
  onClose,
  onEquipItem,
  onAttuneItem,
  onUnattuneItem,
  onUseItem,
  onTransferItem,
  onDropItem,
  onSplitStack,
  onIdentifyItem,
  onSellItem,
  testIdPrefix = 'character-view',
  initialMode = 'character',
}: CharacterViewProps) {
  const [railTab, setRailTab] = useState<CharacterViewRailTab>('build');
  const [viewMode, setViewMode] = useState<CharacterViewMode>(initialMode);
  const [partySearch, setPartySearch] = useState('');
  const [partyFilter, setPartyFilter] = useState<InventoryFilterKey>('all');
  const [partySort, setPartySort] = useState<InventorySortKey>('newest');
  const [partySelected, setPartySelected] = useState<{ heroId: string; instanceId: string } | null>(null);
  const [partyContextMenu, setPartyContextMenu] = useState<{ heroId: string; instanceId: string; x: number; y: number } | null>(null);
  const [backpackMenuOpen, setBackpackMenuOpen] = useState(false);

  const activeHero = useMemo(
    () => heroes.find((h) => h.id === activeHeroId) ?? heroes[0],
    [heroes, activeHeroId],
  );

  // Esc closes the fullscreen modal (same dismissal rule as prop cards).
  // When a context menu is open (backpack grid or party strip), Esc dismisses
  // the menu first and leaves the Character view open.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (backpackMenuOpen) return;
        if (partyContextMenu) {
          setPartyContextMenu(null);
          return;
        }
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, partyContextMenu, backpackMenuOpen]);

  const partyGoldTotal = useMemo(
    () => heroes.reduce((sum, h) => sum + (h.currency?.gp ?? 0), 0),
    [heroes],
  );

  if (!activeHero) return null;

  const derived = computeDerivedCharacter(activeHero, compendium);
  const xpProgress = getXpProgress(activeHero);
  const xpPct =
    xpProgress.nextLevelThresholdXp !== null && xpProgress.nextLevelThresholdXp > 0
      ? Math.min(100, Math.round((xpProgress.currentXp / xpProgress.nextLevelThresholdXp) * 100))
      : 100;
  const strScore = derived.abilities.str?.score;
  const classLine = derived.classes
    .map((c) => `${c.className}${c.subclassName ? ` (${c.subclassName})` : ''} ${c.level}`)
    .join(' / ');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Character view: ${derived.name}`}
      data-testid={testIdPrefix}
      className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4"
    >
      <div
        data-testid={`${testIdPrefix}-panel`}
        className="w-full max-w-7xl max-h-[92vh] overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl flex flex-col"
      >
        {/* ── Header: portrait, name, race·class/level, XP bar, party gold, switcher, close ── */}
        <header className="flex flex-col gap-2 border-b border-slate-800 bg-slate-900/90 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                data-testid={`${testIdPrefix}-header-portrait`}
                aria-hidden="true"
                className="w-11 h-11 shrink-0 rounded-full bg-gradient-to-br from-amber-600 to-purple-800 flex items-center justify-center text-lg font-bold text-white"
              >
                {derived.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2
                    data-testid={`${testIdPrefix}-header-name`}
                    className="text-lg font-bold text-amber-300 truncate"
                  >
                    {derived.name}
                  </h2>
                  <span
                    data-testid={`${testIdPrefix}-header-level`}
                    className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-bold"
                  >
                    Level {derived.totalLevel}
                  </span>
                </div>
                <p
                  data-testid={`${testIdPrefix}-header-subline`}
                  className="text-xs text-slate-400 truncate"
                >
                  {derived.subraceName ?? derived.raceName} · {classLine}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div
                data-testid={`${testIdPrefix}-mode-toggle`}
                role="tablist"
                aria-label="Character or party view"
                className="flex gap-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewMode === 'character'}
                  data-testid={`${testIdPrefix}-mode-character`}
                  onClick={() => setViewMode('character')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                    viewMode === 'character'
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  Character
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewMode === 'party'}
                  data-testid={`${testIdPrefix}-mode-party`}
                  onClick={() => setViewMode('party')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                    viewMode === 'party'
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  Party ({heroes.length})
                </button>
              </div>
              <span
                data-testid={`${testIdPrefix}-header-party-gold`}
                className="px-2.5 py-1 rounded-lg bg-amber-950/50 border border-amber-700/50 text-amber-200 text-xs font-bold"
                title="Party gold total (sum of hero purses)"
              >
                💰 {partyGoldTotal} gp party
              </span>
              <button
                type="button"
                data-testid={`${testIdPrefix}-close-btn`}
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-slate-300 text-xs font-semibold hover:text-white"
              >
                Close (Esc)
              </button>
            </div>
          </div>

          {/* XP bar */}
          <div className="flex items-center gap-2 text-xs">
            <span data-testid={`${testIdPrefix}-header-xp`} className="font-mono text-slate-300 shrink-0">
              XP: <strong className="text-amber-300">{xpProgress.currentXp}</strong>
              {xpProgress.nextLevelThresholdXp !== null
                ? ` / ${xpProgress.nextLevelThresholdXp}`
                : ' (Max Level 20)'}
            </span>
            <div
              data-testid={`${testIdPrefix}-xp-bar`}
              role="progressbar"
              aria-valuenow={xpPct}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1.5 flex-1 rounded-full bg-slate-800 overflow-hidden"
            >
              <div className="h-full bg-amber-400" style={{ width: `${xpPct}%` }} />
            </div>
            {xpProgress.canLevelUp && (
              <span
                data-testid={`${testIdPrefix}-xp-ready-badge`}
                className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-700 text-emerald-300 text-[11px] font-semibold"
              >
                Ready to Level Up!
              </span>
            )}
          </div>

          {/* Hero switcher (portrait tabs) */}
          <div
            data-testid={`${testIdPrefix}-hero-switcher`}
            role="tablist"
            aria-label="Switch hero"
            className="flex gap-1.5 overflow-x-auto"
          >
            {heroes.map((h) => {
              const d = computeDerivedCharacter(h, compendium);
              const selected = h.id === activeHero.id;
              return (
                <button
                  key={h.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  data-testid={`${testIdPrefix}-hero-tab-${h.id}`}
                  onClick={() => onSelectHero(h.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                    selected
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  {d.name} · L{d.totalLevel}
                </button>
              );
            })}
          </div>
        </header>

        {/* ── Body: character 3-pane vs party strip (SRD-1502) ── */}
        {viewMode === 'party' ? (
          <div className="flex-1 overflow-y-auto p-3 min-h-0">
            {/* Shared search/filter applies to every hero card. */}
            <div className="flex flex-wrap items-center gap-1.5 mb-2" role="group" aria-label="Party backpack filters">
              {INVENTORY_FILTERS.map((key) => (
                <button
                  key={key}
                  type="button"
                  data-testid={`${testIdPrefix}-party-filter-${key}`}
                  aria-pressed={partyFilter === key}
                  onClick={() => setPartyFilter(key)}
                  className={`px-2 py-1 rounded-md text-[11px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${partyFilter === key ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:text-white'}`}
                >
                  {INVENTORY_FILTER_LABELS[key]}
                </button>
              ))}
              <input
                type="search"
                data-testid={`${testIdPrefix}-party-search`}
                value={partySearch}
                onChange={(event) => setPartySearch(event.target.value)}
                placeholder="Search all backpacks…"
                aria-label="Search all backpacks"
                className="ml-auto px-2 py-1 rounded-md bg-slate-950 border border-slate-700 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 w-40"
              />
              <label className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                Sort
                <select
                  data-testid={`${testIdPrefix}-party-sort`}
                  value={partySort}
                  onChange={(event) => setPartySort(event.target.value as InventorySortKey)}
                  aria-label="Sort all backpacks"
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
              data-testid={`${testIdPrefix}-party-strip`}
              aria-label="Party strip"
              className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5"
            >
              {heroes.map((hero) => {
                const d = computeDerivedCharacter(hero, compendium);
                const heroStr = d.abilities.str?.score ?? 10;
                const carriedLb = getInventoryTotalWeightLb(hero.inventory, compendium);
                const capacityLb = heroStr * 15;
                const weightPct = capacityLb > 0 ? Math.min(100, Math.round((carriedLb / capacityLb) * 100)) : 0;
                const overWeight = carriedLb > capacityLb;
                const nearWeight = !overWeight && carriedLb >= capacityLb * 0.8;
                const needle = partySearch.trim().toLowerCase();
                const visibleItems = sortInventoryInstances(
                  hero.inventory.filter((inst) => {
                    if (partyFilter !== 'all' && getInventoryFilterCategory(inst.itemId, compendium) !== partyFilter) return false;
                    if (needle.length > 0) {
                      const name = getInventoryItemName(inst.itemId, compendium).toLowerCase();
                      if (!name.includes(needle) && !inst.itemId.toLowerCase().includes(needle)) return false;
                    }
                    return true;
                  }),
                  partySort,
                  compendium,
                );
                const heroGp = hero.currency?.gp ?? 0;
                return (
                  <section
                    key={hero.id}
                    data-testid={`${testIdPrefix}-party-card-${hero.id}`}
                    aria-label={`${d.name} party card`}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (!onTransferItem) return;
                      const instId =
                        event.dataTransfer.getData('text/inventory-instance-id') ||
                        event.dataTransfer.getData('text/plain');
                      const fromHeroId = event.dataTransfer.getData('text/party-source-hero-id');
                      if (!instId || !fromHeroId || fromHeroId === hero.id) return;
                      onTransferItem(fromHeroId, instId, hero.id);
                      setPartySelected(null);
                    }}
                    className="rounded-xl border border-slate-800 bg-slate-900/70 p-2 flex flex-col gap-2"
                  >
                    {/* Doll card: portrait, name, HP, AC, per-hero gold */}
                    <div className="flex items-center gap-2">
                      <div
                        data-testid={`${testIdPrefix}-party-card-${hero.id}-portrait`}
                        aria-hidden="true"
                        className="w-9 h-9 shrink-0 rounded-full bg-gradient-to-br from-amber-600 to-purple-800 flex items-center justify-center text-sm font-bold text-white"
                      >
                        {d.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div
                          data-testid={`${testIdPrefix}-party-card-${hero.id}-name`}
                          className="text-xs font-bold text-amber-200 truncate"
                        >
                          {d.name} · L{d.totalLevel}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-300">
                          <span data-testid={`${testIdPrefix}-party-card-${hero.id}-hp`} className="font-mono">
                            ❤️ {d.currentHp}/{d.maxHp}
                          </span>
                          <span data-testid={`${testIdPrefix}-party-card-${hero.id}-ac`} className="font-mono">
                            🛡️ {d.armorClass.totalAc}
                          </span>
                        </div>
                      </div>
                      <span
                        data-testid={`${testIdPrefix}-party-card-${hero.id}-gold`}
                        title={`${d.name} purse`}
                        className="px-2 py-0.5 rounded bg-amber-950/60 border border-amber-700/50 text-amber-200 text-[11px] font-bold whitespace-nowrap"
                      >
                        💰 {heroGp} gp
                      </span>
                    </div>
                    {/* Weight capacity bar (STR × 15, display only). */}
                    <div>
                      <div
                        data-testid={`${testIdPrefix}-party-card-${hero.id}-weight`}
                        className={`text-[11px] font-medium ${overWeight ? 'text-red-300' : nearWeight ? 'text-amber-300' : 'text-slate-400'}`}
                      >
                        ⚖️ {carriedLb} / {capacityLb} lb{overWeight ? ' — encumbered (display only)' : ''}
                      </div>
                      <div
                        data-testid={`${testIdPrefix}-party-card-${hero.id}-weight-bar`}
                        role="progressbar"
                        aria-valuenow={weightPct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${d.name} carrying capacity`}
                        className="h-1.5 rounded-full bg-slate-800 overflow-hidden"
                      >
                        <div
                          className={`h-full ${overWeight ? 'bg-red-400' : nearWeight ? 'bg-amber-400' : 'bg-emerald-400'}`}
                          style={{ width: `${weightPct}%` }}
                        />
                      </div>
                    </div>
                    {/* Condensed backpack grid */}
                    <div
                      data-testid={`${testIdPrefix}-party-card-${hero.id}-grid`}
                      role="grid"
                      aria-label={`${d.name} backpack (${visibleItems.length} items)`}
                      className="grid grid-cols-4 gap-1 p-1.5 rounded-lg bg-slate-950/60 border border-slate-800 max-h-56 overflow-y-auto"
                    >
                      {visibleItems.length === 0 ? (
                        <div
                          data-testid={`${testIdPrefix}-party-card-${hero.id}-grid-empty`}
                          className="col-span-full p-3 text-center text-[11px] text-slate-500"
                        >
                          {hero.inventory.length === 0 ? 'Backpack is empty.' : 'No items match this filter.'}
                        </div>
                      ) : (
                        visibleItems.map((inst) => {
                          const itemName = getInventoryItemName(inst.itemId, compendium);
                          const isSelected =
                            partySelected?.heroId === hero.id && partySelected?.instanceId === inst.instanceId;
                          return (
                            <button
                              key={inst.instanceId}
                              type="button"
                              data-testid={`${testIdPrefix}-party-card-${hero.id}-cell-${inst.instanceId}`}
                              title={itemName}
                              aria-label={`${itemName}${inst.quantity > 1 ? ` ×${inst.quantity}` : ''}`}
                              aria-pressed={isSelected}
                              draggable={Boolean(onTransferItem)}
                              onDragStart={(event) => {
                                event.dataTransfer.setData('text/inventory-instance-id', inst.instanceId);
                                event.dataTransfer.setData('text/party-source-hero-id', hero.id);
                                event.dataTransfer.effectAllowed = 'move';
                              }}
                              onClick={() =>
                                setPartySelected(
                                  isSelected ? null : { heroId: hero.id, instanceId: inst.instanceId },
                                )
                              }
                              onDoubleClick={() =>
                                setPartySelected({ heroId: hero.id, instanceId: inst.instanceId })
                              }
                              onContextMenu={(event) => {
                                event.preventDefault();
                                setPartySelected({ heroId: hero.id, instanceId: inst.instanceId });
                                setPartyContextMenu({
                                  heroId: hero.id,
                                  instanceId: inst.instanceId,
                                  x: event.clientX,
                                  y: event.clientY,
                                });
                              }}
                              className={`relative flex flex-col items-center justify-center gap-0.5 min-h-14 rounded-lg bg-slate-900 border p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 transition-colors ${isSelected ? 'border-amber-400 ring-2 ring-amber-400/60' : 'border-slate-700'}`}
                            >
                              <ItemIcon itemId={inst.itemId} size={24} testId={`${testIdPrefix}-party-card-icon`} />
                              <span className="max-w-full truncate text-[9px] font-medium text-slate-300">
                                {itemName}
                                {inst.quantity > 1 && <span className="text-slate-500"> ×{inst.quantity}</span>}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                    {/* Hero-to-hero moves: select → Send to <hero> (focus+Enter parity). */}
                    {partySelected?.heroId === hero.id && onTransferItem && (
                      <div
                        data-testid={`${testIdPrefix}-party-selected-actions-${partySelected.instanceId}`}
                        className="flex flex-wrap items-center gap-1 p-1.5 rounded-lg bg-slate-950 border border-amber-500/40"
                      >
                        <span className="text-[10px] text-slate-400">Send to:</span>
                        {heroes
                          .filter((h) => h.id !== hero.id)
                          .map((target) => {
                            const targetDerived = computeDerivedCharacter(target, compendium);
                            return (
                              <button
                                key={target.id}
                                type="button"
                                data-testid={`${testIdPrefix}-party-send-${hero.id}-to-${target.id}-${partySelected.instanceId}`}
                                onClick={() => {
                                  onTransferItem(hero.id, partySelected.instanceId, target.id);
                                  setPartySelected(null);
                                }}
                                className="px-2 py-1 rounded bg-slate-800 hover:bg-amber-500 hover:text-slate-950 text-slate-200 text-[10px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                              >
                                {targetDerived.name}
                              </button>
                            );
                          })}
                        <button
                          type="button"
                          data-testid={`${testIdPrefix}-party-deselect`}
                          onClick={() => setPartySelected(null)}
                          aria-label="Clear party selection"
                          className="ml-auto text-slate-500 hover:text-white text-xs px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
            {/* SRD-1504 party-strip right-click menu (Send to hero + Use; action bar stays the Deck path). */}
            {partyContextMenu && onTransferItem && (
              <div
                data-testid={`${testIdPrefix}-party-ctx-backdrop`}
                className="fixed inset-0 z-[70]"
                onClick={() => setPartyContextMenu(null)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setPartyContextMenu(null);
                }}
              >
                <div
                  role="menu"
                  aria-label="Send item to hero"
                  data-testid={`${testIdPrefix}-party-ctx-menu-${partyContextMenu.instanceId}`}
                  onClick={(event) => event.stopPropagation()}
                  onContextMenu={(event) => event.preventDefault()}
                  style={{
                    position: 'fixed',
                    left: Math.max(8, Math.min(partyContextMenu.x, window.innerWidth - 250)),
                    top: Math.max(8, Math.min(partyContextMenu.y, window.innerHeight - 240)),
                  }}
                  className="w-56 rounded-xl border border-amber-500/40 bg-slate-900 shadow-2xl p-1.5 flex flex-col gap-0.5"
                >
                  <div className="px-2 py-1 text-[11px] font-bold text-slate-100 border-b border-slate-800 mb-1">
                    Send to hero
                  </div>
                  {heroes
                    .filter((h) => h.id !== partyContextMenu.heroId)
                    .map((target) => {
                      const targetDerived = computeDerivedCharacter(target, compendium);
                      return (
                        <button
                          key={target.id}
                          type="button"
                          role="menuitem"
                          data-testid={`${testIdPrefix}-party-ctx-send-${partyContextMenu.heroId}-to-${target.id}-${partyContextMenu.instanceId}`}
                          onClick={() => {
                            onTransferItem(
                              partyContextMenu.heroId,
                              partyContextMenu.instanceId,
                              target.id,
                            );
                            setPartyContextMenu(null);
                            setPartySelected(null);
                          }}
                          className="px-2 py-1.5 rounded-lg text-left text-[12px] font-semibold text-slate-200 hover:bg-amber-500 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                        >
                          ➡ {targetDerived.name}
                        </button>
                      );
                    })}
                  {onUseItem && (
                    <button
                      type="button"
                      role="menuitem"
                      data-testid={`${testIdPrefix}-party-ctx-use-${partyContextMenu.instanceId}`}
                      onClick={() => {
                        onUseItem(partyContextMenu.heroId, partyContextMenu.instanceId);
                        setPartyContextMenu(null);
                      }}
                      className="px-2 py-1.5 rounded-lg text-left text-[12px] font-semibold text-emerald-200 hover:bg-emerald-700 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                    >
                      Use
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-0 min-h-0">
          {/* Left rail: Build / Skills / Attributes over drawer data */}
          <aside
            data-testid={`${testIdPrefix}-rail`}
            aria-label="Character stats rail"
            className="border-b lg:border-b-0 lg:border-r border-slate-800 bg-slate-900/60 p-3 overflow-y-auto max-h-56 lg:max-h-none"
          >
            <div className="flex gap-1.5 mb-2" role="tablist" aria-label="Stats rail tabs">
              {RAIL_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={railTab === tab.id}
                  data-testid={`${testIdPrefix}-rail-tab-${tab.id}`}
                  onClick={() => setRailTab(tab.id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                    railTab === tab.id
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {railTab === 'build' && (
              <div data-testid={`${testIdPrefix}-rail-panel-build`} className="space-y-2 text-xs">
                {/* SRD-1505: class/subclass/level breakdown over derived sheet data. */}
                <div data-testid={`${testIdPrefix}-rail-classes`} className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">
                    Class Breakdown
                  </div>
                  {derived.classes.map((c) => (
                    <div
                      key={c.classId}
                      data-testid={`${testIdPrefix}-rail-class-${c.classId}`}
                      className="flex items-center justify-between px-2 py-1 rounded bg-slate-950 border border-slate-800/80"
                    >
                      <span className="text-slate-200 truncate">
                        {c.className}
                        {c.subclassName ? ` (${c.subclassName})` : ''}
                      </span>
                      <span className="font-mono text-slate-400 shrink-0 ml-2">
                        L{c.level} · d{c.hitDie}
                      </span>
                    </div>
                  ))}
                  <div className="text-slate-400 px-0.5">
                    {derived.backgroundName} · {formatTitleCase(derived.alignment)}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div data-testid={`${testIdPrefix}-rail-hp`} className="rounded-lg bg-slate-950 border border-slate-800 p-2 text-center">
                    <div className="text-[10px] uppercase text-slate-500">HP</div>
                    <div className="font-mono font-bold text-emerald-300">
                      {derived.currentHp}/{derived.maxHp}
                      {derived.tempHp > 0 ? ` (+${derived.tempHp} tmp)` : ''}
                    </div>
                  </div>
                  <div data-testid={`${testIdPrefix}-rail-ac`} className="rounded-lg bg-slate-950 border border-slate-800 p-2 text-center">
                    <div className="text-[10px] uppercase text-slate-500">AC</div>
                    <div className="font-mono font-bold text-amber-300">{derived.armorClass.totalAc}</div>
                  </div>
                  <div className="rounded-lg bg-slate-950 border border-slate-800 p-2 text-center">
                    <div className="text-[10px] uppercase text-slate-500">Prof</div>
                    <div className="font-mono font-bold text-slate-100">
                      {formatSignedNumber(derived.proficiencyBonus)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-950 border border-slate-800 p-2 text-center">
                    <div className="text-[10px] uppercase text-slate-500">Init</div>
                    <div className="font-mono font-bold text-slate-100">
                      {formatSignedNumber(derived.initiative.bonus)}
                    </div>
                  </div>
                </div>
                <div className="text-slate-400">
                  Speed:{' '}
                  <span className="text-slate-200 font-mono">{derived.speedFeet} ft</span>
                  {' · '}
                  {derived.senses.darkvisionFeet > 0
                    ? `Darkvision ${derived.senses.darkvisionFeet} ft`
                    : 'Normal vision'}
                </div>
                {/* SRD-1505: conditions list over derived activeConditions (presentation only). */}
                <div data-testid={`${testIdPrefix}-rail-conditions`} className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">
                    Conditions
                  </div>
                  {derived.activeConditions.length === 0 && derived.exhaustionLevel === 0 && !derived.concentratingOn ? (
                    <div
                      data-testid={`${testIdPrefix}-rail-conditions-none`}
                      className="px-2 py-1 rounded bg-slate-950 border border-slate-800/80 text-slate-500"
                    >
                      None
                    </div>
                  ) : (
                    <>
                      {derived.activeConditions.map((cond, idx) => (
                        <div
                          key={`${cond.conditionId}-${idx}`}
                          data-testid={`${testIdPrefix}-rail-condition-${cond.conditionId}`}
                          className="flex items-center justify-between px-2 py-1 rounded bg-slate-950 border border-amber-700/40"
                        >
                          <span className="text-amber-200 font-medium truncate">
                            {formatTitleCase(cond.conditionId)}
                          </span>
                          <span className="text-[10px] text-slate-400 shrink-0 ml-2">
                            {cond.durationRounds ? `${cond.durationRounds} rd` : ''}
                            {cond.sourceName ? ` · ${cond.sourceName}` : ''}
                          </span>
                        </div>
                      ))}
                      {derived.exhaustionLevel > 0 && (
                        <div
                          data-testid={`${testIdPrefix}-rail-condition-exhaustion`}
                          className="flex items-center justify-between px-2 py-1 rounded bg-slate-950 border border-amber-700/40"
                        >
                          <span className="text-amber-200 font-medium">Exhaustion</span>
                          <span className="text-[10px] text-slate-400">Level {derived.exhaustionLevel}</span>
                        </div>
                      )}
                      {derived.concentratingOn && (
                        <div
                          data-testid={`${testIdPrefix}-rail-concentrating`}
                          className="px-2 py-1 rounded bg-slate-950 border border-indigo-700/50 text-indigo-200"
                        >
                          Concentrating
                          {derived.concentratingOn.sourceId
                            ? `: ${formatTitleCase(derived.concentratingOn.sourceId)}`
                            : ''}
                        </div>
                      )}
                    </>
                  )}
                </div>
                {/* SRD-1505: full defenses row over derived mitigation lists. */}
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">
                    Defenses
                  </div>
                  <div data-testid={`${testIdPrefix}-rail-resistances`} className="text-slate-400">
                    Resistances:{' '}
                    <span className="text-amber-300">
                      {derived.damageResistances.length > 0
                        ? derived.damageResistances.map(formatTitleCase).join(', ')
                        : 'None'}
                    </span>
                  </div>
                  <div data-testid={`${testIdPrefix}-rail-immunities`} className="text-slate-400">
                    Immunities:{' '}
                    <span className="text-slate-200">
                      {derived.damageImmunities.length > 0
                        ? derived.damageImmunities.map(formatTitleCase).join(', ')
                        : 'None'}
                    </span>
                  </div>
                  <div data-testid={`${testIdPrefix}-rail-vulnerabilities`} className="text-slate-400">
                    Vulnerabilities:{' '}
                    <span className="text-red-300">
                      {derived.damageVulnerabilities.length > 0
                        ? derived.damageVulnerabilities.map(formatTitleCase).join(', ')
                        : 'None'}
                    </span>
                  </div>
                  {derived.conditionImmunities.length > 0 && (
                    <div data-testid={`${testIdPrefix}-rail-condition-immunities`} className="text-slate-400">
                      Condition immunities:{' '}
                      <span className="text-slate-200">
                        {derived.conditionImmunities.map(formatTitleCase).join(', ')}
                      </span>
                    </div>
                  )}
                </div>
                {/* SRD-1505: notable features over derived feature/feat/trait ids (presentation only). */}
                <div data-testid={`${testIdPrefix}-rail-features`} className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">
                    Notable Features ({derived.featureIds.length + derived.featIds.length + derived.traitIds.length})
                  </div>
                  {derived.featureIds.length + derived.featIds.length + derived.traitIds.length === 0 ? (
                    <div
                      data-testid={`${testIdPrefix}-rail-features-none`}
                      className="px-2 py-1 rounded bg-slate-950 border border-slate-800/80 text-slate-500"
                    >
                      No features yet
                    </div>
                  ) : (
                    <div className="space-y-1 max-h-48 overflow-y-auto pr-0.5">
                      {derived.featureIds.map((fId) => (
                        <div
                          key={fId}
                          data-testid={`${testIdPrefix}-rail-feature-${fId}`}
                          title={compendium.getFeature(fId)?.description ?? formatTitleCase(fId)}
                          className="px-2 py-1 rounded bg-slate-950 border border-slate-800/80"
                        >
                          <span className="text-slate-200 font-medium">
                            {compendium.getFeature(fId)?.name ?? formatTitleCase(fId)}
                          </span>
                        </div>
                      ))}
                      {derived.featIds.map((featId) => (
                        <div
                          key={featId}
                          data-testid={`${testIdPrefix}-rail-feature-${featId}`}
                          title={compendium.getFeat(featId)?.description ?? formatTitleCase(featId)}
                          className="px-2 py-1 rounded bg-amber-950/30 border border-amber-700/40"
                        >
                          <span className="text-amber-200 font-medium">
                            Feat: {compendium.getFeat(featId)?.name ?? formatTitleCase(featId)}
                          </span>
                        </div>
                      ))}
                      {derived.traitIds.map((traitId) => (
                        <div
                          key={traitId}
                          data-testid={`${testIdPrefix}-rail-feature-${traitId}`}
                          className="px-2 py-1 rounded bg-slate-950 border border-slate-800/80"
                        >
                          <span className="text-slate-400">{formatTitleCase(traitId)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {railTab === 'skills' && (
              <div data-testid={`${testIdPrefix}-rail-panel-skills`} className="space-y-2 text-xs">
                {/* SRD-1505: passive scores header over derived sheet data. */}
                <div
                  data-testid={`${testIdPrefix}-rail-passives`}
                  className="flex items-center justify-between px-2 py-1 rounded bg-slate-950 border border-slate-800/80 text-[11px] text-slate-400"
                >
                  <span>
                    Passive Perc.{' '}
                    <span className="font-mono text-slate-200">{derived.passivePerception}</span>
                  </span>
                  <span>
                    Inv.{' '}
                    <span className="font-mono text-slate-200">{derived.passiveInvestigation}</span>
                  </span>
                  <span>
                    Ins.{' '}
                    <span className="font-mono text-slate-200">{derived.passiveInsight}</span>
                  </span>
                </div>
                {ABILITY_IDS.map((ab) => {
                  const abStat = derived.abilities[ab];
                  const groupSkills = SKILL_IDS.filter((skillId) => derived.skills[skillId].ability === ab);
                  if (groupSkills.length === 0) return null;
                  return (
                    <div key={ab} data-testid={`${testIdPrefix}-rail-skill-group-${ab}`} className="space-y-1">
                      <div className="flex items-center justify-between px-1 pt-1">
                        <span
                          className="text-[10px] uppercase tracking-wider text-slate-500"
                          title={`${formatAbilityFullName(ab)} ${abStat.score}`}
                        >
                          {formatAbilityFullName(ab)} ({formatAbilityAbbrev(ab)})
                        </span>
                        <span className="font-mono text-[11px] text-slate-400">
                          {abStat.score} ({formatSignedNumber(abStat.modifier)})
                        </span>
                      </div>
                      {groupSkills.map((skillId) => {
                        const sk = derived.skills[skillId];
                        const badge =
                          sk.proficiencyLevel === 'expertise'
                            ? '★ Exp'
                            : sk.proficiencyLevel === 'proficient'
                              ? '● Prof'
                              : sk.proficiencyLevel === 'half'
                                ? '◐ Half'
                                : '';
                        return (
                          <div
                            key={skillId}
                            data-testid={`${testIdPrefix}-rail-skill-${skillId}`}
                            title={`${formatTitleCase(skillId)} (${formatAbilityAbbrev(sk.ability)}): 1d20 ${formatSignedNumber(sk.totalBonus)} · Passive ${sk.passiveScore}`}
                            className="flex items-center justify-between px-2 py-1 rounded bg-slate-950 border border-slate-800/80"
                          >
                            <span className="text-slate-200 truncate">
                              {formatTitleCase(skillId)}{' '}
                              <span className="text-[10px] text-slate-500">
                                ({formatAbilityAbbrev(sk.ability)})
                              </span>
                              {badge && (
                                <span
                                  data-testid={`${testIdPrefix}-rail-skill-badge-${skillId}`}
                                  className="ml-1.5 px-1 py-px rounded bg-amber-500/15 text-amber-300 text-[10px]"
                                >
                                  {badge}
                                </span>
                              )}
                            </span>
                            <span className="font-mono font-semibold text-slate-100">
                              {formatSignedNumber(sk.totalBonus)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}

            {railTab === 'attributes' && (
              <div data-testid={`${testIdPrefix}-rail-panel-attributes`} className="space-y-2 text-xs">
                {/* SRD-1505: combat vitals over derived sheet data (presentation only). */}
                <div className="grid grid-cols-2 gap-1.5">
                  <div data-testid={`${testIdPrefix}-rail-attr-hp`} className="rounded-lg bg-slate-950 border border-slate-800 p-2 text-center">
                    <div className="text-[10px] uppercase text-slate-500">HP</div>
                    <div className="font-mono font-bold text-emerald-300">
                      {derived.currentHp}/{derived.maxHp}
                    </div>
                  </div>
                  <div data-testid={`${testIdPrefix}-rail-attr-ac`} className="rounded-lg bg-slate-950 border border-slate-800 p-2 text-center">
                    <div className="text-[10px] uppercase text-slate-500">AC</div>
                    <div className="font-mono font-bold text-amber-300">{derived.armorClass.totalAc}</div>
                  </div>
                  <div data-testid={`${testIdPrefix}-rail-attr-initiative`} className="rounded-lg bg-slate-950 border border-slate-800 p-2 text-center">
                    <div className="text-[10px] uppercase text-slate-500">Initiative</div>
                    <div className="font-mono font-bold text-slate-100">
                      {formatSignedNumber(derived.initiative.bonus)}
                    </div>
                  </div>
                  <div data-testid={`${testIdPrefix}-rail-attr-speed`} className="rounded-lg bg-slate-950 border border-slate-800 p-2 text-center">
                    <div className="text-[10px] uppercase text-slate-500">Speed</div>
                    <div className="font-mono font-bold text-slate-100">{derived.speedFeet} ft</div>
                  </div>
                </div>
                <div data-testid={`${testIdPrefix}-rail-attr-senses`} className="text-slate-400">
                  Senses:{' '}
                  <span className="text-slate-200">
                    {derived.senses.darkvisionFeet > 0
                      ? `Darkvision ${derived.senses.darkvisionFeet} ft`
                      : 'Normal vision'}
                  </span>
                  {' · '}Passive Perc.{' '}
                  <span className="font-mono text-slate-200">{derived.passivePerception}</span>
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">
                    Ability Scores
                  </div>
                  {ABILITY_IDS.map((ab) => {
                    const stat = derived.abilities[ab];
                    const save = derived.savingThrows[ab];
                    return (
                      <div
                        key={ab}
                        data-testid={`${testIdPrefix}-rail-ability-${ab}`}
                        title={`${formatAbilityFullName(ab)} save ${formatSignedNumber(save.totalBonus)}${save.proficient ? ' (proficient)' : ''}`}
                        className="flex items-center justify-between px-2 py-1 rounded bg-slate-950 border border-slate-800/80"
                      >
                        <span className="text-slate-200">
                          {formatAbilityAbbrev(ab)}{' '}
                          <span className="text-[10px] text-slate-500">{formatAbilityFullName(ab)}</span>
                          {save.proficient && <span className="ml-1 text-[10px] text-emerald-300">●</span>}
                        </span>
                        <span className="font-mono text-slate-100">
                          {stat.score} ({formatSignedNumber(stat.modifier)})
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div data-testid={`${testIdPrefix}-rail-attr-creature`} className="text-slate-400">
                  Type: <span className="text-slate-200">Humanoid</span>
                  {' · '}Size: <span className="text-slate-200">{formatTitleCase(derived.size)}</span>
                  {' · '}Alignment:{' '}
                  <span className="text-slate-200">{formatTitleCase(derived.alignment)}</span>
                </div>
                <div data-testid={`${testIdPrefix}-rail-attr-carry`} className="text-slate-400">
                  Carrying capacity:{' '}
                  <span className="font-mono text-slate-200">
                    {getInventoryTotalWeightLb(activeHero.inventory, compendium)} / {(strScore ?? 10) * 15} lb
                  </span>{' '}
                  <span className="text-slate-500">(STR × 15, display only)</span>
                </div>
                <div className="space-y-1 pt-1 border-t border-slate-800">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">
                    Proficiencies
                  </div>
                  <div data-testid={`${testIdPrefix}-rail-attr-prof-armor`} className="text-slate-400">
                    Armor:{' '}
                    <span className="text-slate-200">
                      {derived.proficiencies.armor.map(formatTitleCase).join(', ') || 'None'}
                    </span>
                  </div>
                  <div data-testid={`${testIdPrefix}-rail-attr-prof-weapons`} className="text-slate-400">
                    Weapons:{' '}
                    <span className="text-slate-200">
                      {derived.proficiencies.weapons.map(formatTitleCase).join(', ') || 'None'}
                    </span>
                  </div>
                  <div data-testid={`${testIdPrefix}-rail-attr-prof-tools`} className="text-slate-400">
                    Tools:{' '}
                    <span className="text-slate-200">
                      {derived.proficiencies.tools.map(formatTitleCase).join(', ') || 'None'}
                    </span>
                  </div>
                  <div data-testid={`${testIdPrefix}-rail-attr-prof-saves`} className="text-slate-400">
                    Saving throws:{' '}
                    <span className="text-slate-200">
                      {derived.proficiencies.savingThrows.map((s) => formatAbilityAbbrev(s)).join(', ') || 'None'}
                    </span>
                  </div>
                  <div data-testid={`${testIdPrefix}-rail-attr-languages`} className="text-slate-400">
                    Languages:{' '}
                    <span className="text-slate-200">
                      {derived.proficiencies.languages.map(formatTitleCase).join(', ') || 'None'}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </aside>

          {/* Center + right: doll depth header + reuse InventoryView (paperdoll + grid) verbatim */}
          <div
            data-testid={`${testIdPrefix}-inventory-pane`}
            className="p-3 overflow-y-auto min-h-0"
          >
            {/* SRD-1503 doll: enlarged token on class-tinted backdrop + AC shield. */}
            <div
              data-testid={`${testIdPrefix}-doll`}
              className={`mb-2 flex items-center gap-3 rounded-xl border bg-gradient-to-br p-2.5 ${getDollBackdropClass(derived.classes[0]?.classId)}`}
            >
              <div
                data-testid={`${testIdPrefix}-doll-portrait`}
                aria-hidden="true"
                className="w-16 h-16 shrink-0 rounded-xl bg-slate-950/60 border border-white/10 flex items-center justify-center text-3xl font-bold text-white"
              >
                {derived.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-white truncate">{derived.name}</div>
                <div className="text-[11px] text-slate-300 truncate">
                  {derived.subraceName ?? derived.raceName} · {classLine}
                </div>
              </div>
              <div
                data-testid={`${testIdPrefix}-doll-ac`}
                title={`Armor Class ${derived.armorClass.totalAc}`}
                className="px-2.5 py-1.5 rounded-xl bg-sky-950/70 border border-sky-700/60 text-sky-200 text-sm font-bold font-mono whitespace-nowrap"
              >
                🛡️ {derived.armorClass.totalAc} AC
              </div>
            </div>
            <InventoryView
              heroId={activeHero.id}
              heroName={derived.name}
              inventory={activeHero.inventory}
              equippedSlots={activeHero.equippedSlots as unknown as Record<string, string | undefined>}
              attunedItemInstanceIds={activeHero.attunedItemInstanceIds}
              currency={activeHero.currency}
              compendium={compendium}
              partyHeroes={heroes
                .filter((h) => h.id !== activeHero.id)
                .map((h) => ({ id: h.id, name: h.name }))}
              strScore={strScore}
              weaponAttacks={derived.weaponAttacks}
              onEquipItem={(slot, instanceId) => onEquipItem(activeHero.id, slot, instanceId)}
              onAttuneItem={(instanceId) => onAttuneItem(activeHero.id, instanceId)}
              onUnattuneItem={(instanceId) => onUnattuneItem(activeHero.id, instanceId)}
              onUseItem={onUseItem ? (instanceId) => onUseItem(activeHero.id, instanceId) : undefined}
              onTransferItem={
                onTransferItem
                  ? (instanceId, toHeroId) => onTransferItem(activeHero.id, instanceId, toHeroId)
                  : undefined
              }
              onDropItem={onDropItem ? (instanceId) => onDropItem(activeHero.id, instanceId) : undefined}
              onSplitStack={
                onSplitStack ? (instanceId, qty) => onSplitStack(activeHero.id, instanceId, qty) : undefined
              }
              onIdentifyItem={
                onIdentifyItem ? (instanceId) => onIdentifyItem(activeHero.id, instanceId) : undefined
              }
              onSellItem={onSellItem ? (instanceId) => onSellItem(activeHero.id, instanceId) : undefined}
              onContextMenuOpenChange={setBackpackMenuOpen}
              testIdPrefix={testIdPrefix}
            />
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
