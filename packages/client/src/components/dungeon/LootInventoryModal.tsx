import React, { useEffect, useState } from 'react';
import type { InventoryItemInstance } from '@srd5/data';
import type { LootInventoryModalProps } from './types.js';
import { InventoryGridCell } from '../inventory/InventoryGridCell.js';
import { InventoryView } from '../inventory/InventoryView.js';

/**
 * SRD-1307 drop provenance line for the loot UI (per-slay attribution).
 * `monster_drop` bundles name the fallen; war awards and caches label
 * their own source so both paths never read as the same kill.
 */
export function formatLootProvenance(origin: string, sourceName?: string | null): string {
  switch (origin) {
    case 'monster_drop':
      return sourceName ? `Slain foe drop — ${sourceName}` : 'Slain foe drop';
    case 'war_award':
      return 'War spoils award';
    default:
      return sourceName ? `${sourceName}` : 'Discovered cache';
  }
}

export function LootInventoryModal({
  isOpen,
  party,
  initialHeroId,
  compendium,
  activeLoot,
  onClose,
  onClaimLoot,
  onEquipItem,
  onAttuneItem,
  onUnattuneItem,
  onUseItem,
  onTransferItem,
  onDropItem,
  onSplitStack,
  onIdentifyItem,
  onSellItem,
  onSwapWeaponSet,
  onOpenCharacterView,
}: LootInventoryModalProps) {
  const partyList = Object.values(party);
  const [selectedHeroId, setSelectedHeroId] = useState<string>(
    partyList[0]?.id ?? '',
  );
  const [activeTab, setActiveTab] = useState<'discovered' | 'inventory'>(
    activeLoot ? 'discovered' : 'inventory',
  );

  // Sync the selected hero whenever the modal opens: honor the targeted hero
  // (selected combatant / lead explorer) instead of sticking to whoever was
  // selected during a previous open.
  useEffect(() => {
    if (!isOpen) return;
    if (initialHeroId && party[initialHeroId]) {
      setSelectedHeroId(initialHeroId);
    } else if (!party[selectedHeroId]) {
      const fallback = partyList[0]?.id ?? '';
      setSelectedHeroId(fallback);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialHeroId]);

  // If the live prop was fully looted elsewhere, fall back to the
  // inventory tab instead of showing a stale discovered bundle.
  useEffect(() => {
    if (isOpen && !activeLoot) {
      setActiveTab('inventory');
    }
  }, [isOpen, activeLoot]);

  // Keep selection valid if the party roster changes while open.
  useEffect(() => {
    if (isOpen && !party[selectedHeroId] && partyList[0]) {
      setSelectedHeroId(partyList[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, party]);

  if (!isOpen) return null;

  const currentHero = party[selectedHeroId] ?? partyList[0];
  const sheet = currentHero?.characterSheet;
  const buildState = (currentHero as any)?.buildState;
  const inventory: InventoryItemInstance[] =
    buildState?.inventory ?? (sheet as any)?.inventory ?? [];
  const currency =
    buildState?.currency ?? (sheet as any)?.currency ?? { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  const equippedSlots: Record<string, string | undefined> =
    buildState?.equippedSlots ?? (sheet as any)?.equippedSlots ?? {};
  const attunedIds: string[] =
    buildState?.attunedItemInstanceIds ?? (sheet as any)?.attunement?.attunedItemIds ?? [];

  const handleClaimAll = () => {
    if (!currentHero || !activeLoot) return;
    onClaimLoot(currentHero.id, activeLoot.sourcePropId, activeLoot.bundle);
    setActiveTab('inventory');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="loot-inventory-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-4xl rounded-xl border border-slate-700 bg-slate-900 shadow-2xl p-6 text-slate-100 space-y-5 animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]">
        <header className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h2 id="loot-inventory-title" className="text-xl font-bold text-amber-400">
              💎 Dungeon Loot &amp; Party Inventory
            </h2>
            <p className="text-xs text-slate-400">
              Manage equipment loadouts, magic item attunement (max 3), and claim discovered spoils.
            </p>
          </div>
          <button
            type="button"
            data-testid="loot-inventory-close-btn"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md text-lg"
          >
            ✕
          </button>
        </header>

        {/* Tab Controls */}
        <div className="flex gap-2 border-b border-slate-800 pb-2">
          {activeLoot && (
            <button
              type="button"
              data-testid="tab-discovered-loot-btn"
              onClick={() => setActiveTab('discovered')}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                activeTab === 'discovered'
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-slate-800 text-slate-300 hover:text-white'
              }`}
            >
              🎁 Discovered Loot ({activeLoot.sourceName ?? 'Chest'})
            </button>
          )}
          <button
            type="button"
            data-testid="tab-party-inventory-btn"
            onClick={() => setActiveTab('inventory')}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
              activeTab === 'inventory'
                ? 'bg-amber-500 text-slate-950'
                : 'bg-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            🎒 Party Gear &amp; Equipment
          </button>
        </div>

        {/* Tab 1: Discovered Loot */}
        {activeTab === 'discovered' && activeLoot && (
          <div className="space-y-4 overflow-y-auto pr-1">
            <div className="p-4 rounded-lg bg-slate-950 border border-amber-500/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-bold text-amber-300">
                  Contents of {activeLoot.sourceName ?? 'Discovered Cache'}:
                </div>                <div className="text-xs text-slate-400">
                  Recipient:{' '}
                  <span className="font-semibold text-slate-200">
                    {currentHero?.name}
                  </span>
                </div>
              </div>
              {activeLoot.bundle.origin && (
                <div
                  data-testid="discovered-loot-provenance"
                  className="text-[11px] text-slate-400 italic"
                >
                  🏴 {formatLootProvenance(activeLoot.bundle.origin, activeLoot.bundle.sourceName)}
                </div>
              )}

              {/* Gold pile + items grid (gold-only economy; click to take) */}
              {((activeLoot.bundle.gp ?? 0) > 0 ||
                (activeLoot.bundle.items && activeLoot.bundle.items.length > 0)) && (
                <div className="space-y-1.5 pt-2 border-t border-slate-800">
                  <div className="text-xs font-semibold text-slate-400 uppercase">
                    Spoils:{' '}
                    <span className="normal-case font-normal text-slate-500">
                      click an item or the gold pile to take it
                    </span>
                  </div>
                  <div
                    data-testid="discovered-loot-grid"
                    className="grid grid-cols-4 sm:grid-cols-5 gap-1.5 p-2 rounded-xl bg-slate-950/60 border border-slate-800"
                  >
                    {(activeLoot.bundle.gp ?? 0) > 0 && (
                      <button
                        type="button"
                        data-testid="discovered-loot-gold-pile"
                        title={`Take ${activeLoot.bundle.gp} gp`}
                        aria-label={`Take ${activeLoot.bundle.gp} gold pieces`}
                        onClick={() =>
                          currentHero &&
                          onClaimLoot(
                            currentHero.id,
                            activeLoot.sourcePropId,
                            undefined,
                            undefined,
                            true,
                          )
                        }
                        className="group relative flex flex-col items-center justify-center gap-0.5 w-16 h-16 rounded-lg bg-amber-950/40 border-2 border-amber-500/70 p-1 transition-colors hover:bg-amber-900/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 cursor-pointer"
                      >
                        <img
                          src="/assets/game-icons/coins.svg"
                          alt=""
                          className="w-6 h-6"
                          draggable={false}
                        />
                        <span className="max-w-full truncate text-[9px] leading-tight font-bold text-amber-300">
                          {activeLoot.bundle.gp} gp
                        </span>
                        <span className="max-w-full truncate text-[9px] leading-tight text-amber-200/70">
                          Gold Pile
                        </span>
                      </button>
                    )}
                    {(activeLoot.bundle.items ?? []).map((itemId, idx) => (
                      <InventoryGridCell
                        key={`${itemId}-${idx}`}
                        itemId={itemId}
                        instanceId={`discovered-${itemId}-${idx}`}
                        compendium={compendium}
                        testIdPrefix="discovered-loot"
                        provenanceLine={
                          activeLoot.bundle.origin
                            ? formatLootProvenance(
                                activeLoot.bundle.origin,
                                activeLoot.bundle.sourceName,
                              )
                            : undefined
                        }
                        onSelect={() =>
                          currentHero &&
                          onClaimLoot(currentHero.id, activeLoot.sourcePropId, undefined, idx)
                        }
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <span>Distribute to:</span>
                <select
                  data-testid="loot-recipient-select"
                  value={selectedHeroId}
                  onChange={(e) => setSelectedHeroId(e.target.value)}
                  className="rounded bg-slate-800 border-slate-700 text-slate-200 px-2 py-1 text-xs"
                >
                  {partyList.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                data-testid="claim-all-loot-btn"
                onClick={handleClaimAll}
                className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shadow-md transition-colors"
              >
                Claim All Spoils
              </button>
            </div>
          </div>
        )}

        {/* Tab 2: Party Inventory */}
        {activeTab === 'inventory' && (
          <div className="space-y-4 overflow-y-auto pr-1 flex-1">
            {/* Hero Selector Ribbons */}
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {partyList.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  data-testid={`inventory-hero-tab-${h.id}`}
                  onClick={() => setSelectedHeroId(h.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                    selectedHeroId === h.id
                      ? 'bg-amber-500 text-slate-950 shadow-sm'
                      : 'bg-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  {h.name}
                </button>
              ))}
            </div>

            {/* SRD-1305: BG3-style graphical inventory (grid + paperdoll). */}
            <InventoryView
              heroId={currentHero.id}
              heroName={currentHero.name}
              inventory={inventory}
              equippedSlots={equippedSlots}
              attunedItemInstanceIds={attunedIds}
              currency={currency}
              compendium={compendium}
              partyHeroes={partyList.map((h) => ({ id: h.id, name: h.name }))}
              strScore={(currentHero as unknown as { strengthScore?: number }).strengthScore}
              onEquipItem={(slot, instanceId) => onEquipItem(selectedHeroId, slot, instanceId)}
              onAttuneItem={(instanceId) => onAttuneItem(selectedHeroId, instanceId)}
              onUnattuneItem={(instanceId) => onUnattuneItem(selectedHeroId, instanceId)}
              onUseItem={onUseItem ? (instanceId) => onUseItem(selectedHeroId, instanceId) : undefined}
              onTransferItem={onTransferItem ? (instanceId, toHeroId) => onTransferItem(selectedHeroId, instanceId, toHeroId) : undefined}
              onDropItem={onDropItem ? (instanceId) => onDropItem(selectedHeroId, instanceId) : undefined}
              onSplitStack={onSplitStack ? (instanceId, qty) => onSplitStack(selectedHeroId, instanceId, qty) : undefined}
              onIdentifyItem={onIdentifyItem ? (instanceId) => onIdentifyItem(selectedHeroId, instanceId) : undefined}
              onSellItem={onSellItem ? (instanceId) => onSellItem(selectedHeroId, instanceId) : undefined}
              onSwapWeaponSet={
                onSwapWeaponSet ? (set) => onSwapWeaponSet(selectedHeroId, set) : undefined
              }
              testIdPrefix="inventory"
            />
          </div>
        )}

        <footer className="flex items-center justify-between gap-2 pt-3 border-t border-slate-800">
          {onOpenCharacterView && currentHero ? (
            <button
              type="button"
              data-testid="loot-open-character-view-btn"
              onClick={() => onOpenCharacterView(currentHero.id)}
              className="px-4 py-2 rounded-lg bg-purple-600/20 border border-purple-600/60 text-purple-200 text-xs font-semibold hover:bg-purple-600/30"
            >
              🧙 Inspect {currentHero.name} in Character view
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            data-testid="loot-inventory-done-btn"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
