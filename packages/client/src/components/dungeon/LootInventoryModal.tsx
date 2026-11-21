import React, { useEffect, useState } from 'react';
import type { InventoryItemInstance } from '@srd5/data';
import type { LootInventoryModalProps } from './types.js';
import { InventoryItemRow } from '../inventory/InventoryItemRow.js';

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
  const equippedSlots =
    buildState?.equippedSlots ?? (sheet as any)?.equippedSlots ?? {};
  const attunedIds: string[] =
    buildState?.attunedItemInstanceIds ?? (sheet as any)?.attunement?.attunedItemIds ?? [];

  const handleClaimAll = () => {
    if (!currentHero || !activeLoot) return;
    onClaimLoot(currentHero.id, activeLoot.sourcePropId, activeLoot.bundle);
    setActiveTab('inventory');
  };

  const getItemName = (itemId: string): string => {
    const magic = compendium.magicItems?.find((m) => m.id === itemId);
    if (magic) return magic.name;
    const equip = compendium.equipment?.find((e) => e.id === itemId);
    if (equip) return equip.name;
    return itemId.replace(/[-_]/g, ' ');
  };

  const isMagicItemRequiringAttunement = (itemId: string): boolean => {
    const magic = compendium.magicItems?.find((m) => m.id === itemId);
    return Boolean(magic?.requiresAttunement);
  };

  const totalCurrencyGp =
    (currency.cp ?? 0) / 100 +
    (currency.sp ?? 0) / 10 +
    (currency.ep ?? 0) / 2 +
    (currency.gp ?? 0) +
    (currency.pp ?? 0) * 10;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="loot-inventory-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 shadow-2xl p-6 text-slate-100 space-y-5 animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]">
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
                </div>
                <div className="text-xs text-slate-400">
                  Recipient:{' '}
                  <span className="font-semibold text-slate-200">
                    {currentHero?.name}
                  </span>
                </div>
              </div>

              {/* Coins Display */}
              <div className="grid grid-cols-5 gap-2 text-center text-xs">
                <div className="p-2 rounded bg-slate-900 border border-slate-800">
                  <div className="text-slate-400">CP</div>
                  <div className="font-bold text-amber-200">{activeLoot.bundle.cp ?? 0}</div>
                </div>
                <div className="p-2 rounded bg-slate-900 border border-slate-800">
                  <div className="text-slate-400">SP</div>
                  <div className="font-bold text-slate-200">{activeLoot.bundle.sp ?? 0}</div>
                </div>
                <div className="p-2 rounded bg-slate-900 border border-slate-800">
                  <div className="text-slate-400">EP</div>
                  <div className="font-bold text-slate-300">{activeLoot.bundle.ep ?? 0}</div>
                </div>
                <div className="p-2 rounded bg-slate-900 border border-slate-800">
                  <div className="text-slate-400">GP</div>
                  <div className="font-bold text-amber-400">{activeLoot.bundle.gp ?? 0}</div>
                </div>
                <div className="p-2 rounded bg-slate-900 border border-slate-800">
                  <div className="text-slate-400">PP</div>
                  <div className="font-bold text-slate-100">{activeLoot.bundle.pp ?? 0}</div>
                </div>
              </div>

              {/* Items List */}
              {activeLoot.bundle.items && activeLoot.bundle.items.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-slate-800">
                  <div className="text-xs font-semibold text-slate-400 uppercase">
                    Items &amp; Relics:
                  </div>
                  <div className="space-y-1">
                    {activeLoot.bundle.items.map((itemId, idx) => (
                      <InventoryItemRow
                        key={`${itemId}-${idx}`}
                        itemId={itemId}
                        compendium={compendium}
                        testId={`discovered-loot-item-${itemId}-${idx}`}
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

            {/* Currency & Attunement Overview */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <div className="font-semibold text-slate-400 uppercase text-[10px] mb-1">
                  💰 Coin Purse ({totalCurrencyGp.toFixed(1)} GP Total)
                </div>
                <div className="flex justify-between font-medium text-slate-300">
                  <span>{currency.cp ?? 0} cp</span>
                  <span>{currency.sp ?? 0} sp</span>
                  <span>{currency.ep ?? 0} ep</span>
                  <span className="text-amber-300 font-bold">{currency.gp ?? 0} gp</span>
                  <span>{currency.pp ?? 0} pp</span>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <div className="font-semibold text-slate-400 uppercase text-[10px] mb-1">
                  🔮 Magic Item Attunement ({attunedIds.length} / 3 Max)
                </div>
                <div className="text-xs text-purple-300 font-medium truncate">
                  {attunedIds.length > 0
                    ? attunedIds.map((id) => getItemName(id)).join(', ')
                    : 'No items currently attuned.'}
                </div>
              </div>
            </div>

            {/* Equipped Slots */}
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
              <div className="font-semibold text-slate-400 uppercase text-[10px]">
                🛡️ Equipped Gear Loadout
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                {(['armor', 'shield', 'mainHand', 'offHand', 'ranged'] as const).map(
                  (slot) => {
                    const instId = equippedSlots[slot];
                    const itemInst = inventory.find((it) => it.instanceId === instId);

                    if (!itemInst) {
                      return (
                        <div
                          key={slot}
                          className="p-2 rounded bg-slate-900 border border-slate-800/80 flex flex-col justify-between"
                        >
                          <div className="text-[10px] text-slate-500 uppercase font-semibold">
                            {slot}
                          </div>
                          <div className="text-xs font-medium text-slate-500 truncate mt-0.5">
                            Empty
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={slot} className="flex flex-col gap-1">
                        <div className="text-[10px] text-slate-500 uppercase font-semibold">
                          {slot}
                        </div>
                        <InventoryItemRow
                          itemId={itemInst.itemId}
                          compendium={compendium}
                          quantity={itemInst.quantity}
                          attunementState={
                            attunedIds.includes(itemInst.instanceId) ? 'attuned' : 'unattuned'
                          }
                          chargesRemaining={itemInst.chargesRemaining}
                          testId={`equipped-slot-${slot}-${itemInst.instanceId}`}
                          actions={
                            <button
                              type="button"
                              data-testid={`unequip-btn-${slot}`}
                              onClick={() => onEquipItem(selectedHeroId, slot, undefined)}
                              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-semibold"
                            >
                              Unequip
                            </button>
                          }
                        />
                      </div>
                    );
                  },
                )}
              </div>
            </div>

            {/* Inventory Bag List */}
            <div className="space-y-2">
              <div className="font-semibold text-slate-400 uppercase text-[10px]">
                🎒 Inventory Bag ({inventory.length} items)
              </div>
              {inventory.length === 0 ? (
                <div className="p-4 rounded-lg bg-slate-950/40 border border-slate-800 text-center text-xs text-slate-500">
                  Inventory is currently empty.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {inventory.map((item) => {
                    const isAttunable = isMagicItemRequiringAttunement(item.itemId);
                    const isAttuned = attunedIds.includes(item.instanceId);

                    return (
                      <InventoryItemRow
                        key={item.instanceId}
                        itemId={item.itemId}
                        compendium={compendium}
                        quantity={item.quantity}
                        attunementState={isAttunable ? (isAttuned ? 'attuned' : 'unattuned') : 'n/a'}
                        chargesRemaining={item.chargesRemaining}
                        testId={`inventory-item-row-${item.instanceId}`}
                        actions={
                          <>
                            {isAttunable && !isAttuned && attunedIds.length < 3 && (
                              <button
                                type="button"
                                data-testid={`attune-btn-${item.instanceId}`}
                                onClick={() => onAttuneItem(selectedHeroId, item.instanceId)}
                                className="px-2 py-1 rounded bg-purple-900/60 hover:bg-purple-800 border border-purple-700/60 text-purple-200 text-[10px] font-semibold"
                              >
                                Attune
                              </button>
                            )}
                            {isAttuned && (
                              <button
                                type="button"
                                data-testid={`unattune-btn-${item.instanceId}`}
                                onClick={() => onUnattuneItem(selectedHeroId, item.instanceId)}
                                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-semibold"
                              >
                                Unattune
                              </button>
                            )}
                            {onUseItem &&
                              (item.itemId.startsWith('potion') || item.itemId === 'antitoxin') && (
                                <button
                                  type="button"
                                  data-testid={`use-item-btn-${item.instanceId}`}
                                  onClick={() => onUseItem(selectedHeroId, item.instanceId)}
                                  className="px-2 py-1 rounded bg-emerald-900/60 hover:bg-emerald-800 border border-emerald-700/60 text-emerald-200 text-[10px] font-semibold"
                                >
                                  Use
                                </button>
                              )}
                          </>
                        }
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        <footer className="flex items-center justify-end pt-3 border-t border-slate-800">
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
