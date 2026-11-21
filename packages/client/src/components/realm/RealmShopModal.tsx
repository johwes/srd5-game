import React, { useState } from 'react';
import type { OverworldPOI, ShopInventory } from '@srd5/engine';
import { getShopCatalogEntry, getShopItemPrice, SELL_PRICE_RATIO } from '@srd5/engine';
import { defaultCompendium } from '@srd5/data';
import type { RealmSessionState } from './realmEngine.js';
import { getPartyList } from './realmEngine.js';
import { InventoryItemRow } from '../inventory/InventoryItemRow.js';

/**
 * Settlement shop modal (SRD-805): buy gear / rations at reputation-adjusted
 * prices and sell party inventory at half value. Purchases are delivered to
 * the chosen hero's inventory via REALM_BUY_ITEM.
 */

export interface RealmShopModalProps {
  isOpen: boolean;
  onClose: () => void;
  poi: OverworldPOI | null;
  inventory: ShopInventory | null;
  session: RealmSessionState;
  reputation: number;
  onBuy: (itemId: string, quantity: number, characterId: string) => void;
  onSell: (characterId: string, instanceId: string) => void;
}

export function RealmShopModal({
  isOpen,
  onClose,
  poi,
  inventory,
  session,
  reputation,
  onBuy,
  onSell,
}: RealmShopModalProps) {
  const [tab, setTab] = useState<'buy' | 'sell'>('buy');
  const [recipientId, setRecipientId] = useState<string>(session.partyOrder[0] ?? '');

  if (!isOpen || !poi || !inventory) return null;

  const party = getPartyList(session);
  const effectiveRecipient = party.some((h) => h.id === recipientId)
    ? recipientId
    : (party[0]?.id ?? '');
  const gold = session.travel.gold;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="realm-shop-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl p-6 text-slate-100 space-y-4">
        <header className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h2 id="realm-shop-title" className="text-xl font-bold text-amber-400">
              🛒 {inventory.shopName}
            </h2>
            <p className="text-xs text-slate-400">
              {poi.name} · Purse: <span className="text-yellow-300 font-bold">{gold} gp</span>
              {reputation !== 0 && (
                <span> · Reputation price modifier ({reputation > 0 ? 'discount' : 'markup'})</span>
              )}
            </p>
          </div>
          <button
            type="button"
            data-testid="realm-shop-close-btn"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md text-lg"
          >
            ✕
          </button>
        </header>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-slate-950 p-0.5 border border-slate-800">
            <button
              type="button"
              data-testid="realm-shop-tab-buy"
              aria-pressed={tab === 'buy'}
              onClick={() => setTab('buy')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                tab === 'buy' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
              }`}
            >
              Buy
            </button>
            <button
              type="button"
              data-testid="realm-shop-tab-sell"
              aria-pressed={tab === 'sell'}
              onClick={() => setTab('sell')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                tab === 'sell' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
              }`}
            >
              Sell
            </button>
          </div>
          {tab === 'buy' && (
            <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-400">
              Deliver to
              <select
                data-testid="realm-shop-recipient-select"
                value={effectiveRecipient}
                onChange={(e) => setRecipientId(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-200"
              >
                {party.map((hero) => (
                  <option key={hero.id} value={hero.id}>
                    {hero.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {tab === 'buy' ? (
          <ul data-testid="realm-shop-buy-list" className="space-y-1.5">
            {inventory.items.length === 0 && (
              <li className="text-sm text-slate-500 italic">Sold out — check back after other travelers.</li>
            )}
            {inventory.items.map((item) => {
              const price = getShopItemPrice(item, reputation);
              const affordable = gold >= price && item.quantity > 0;
              return (
                <li key={item.itemId}>
                  <InventoryItemRow
                    itemId={item.itemId}
                    compendium={defaultCompendium}
                    quantity={item.quantity}
                    testId={`realm-shop-item-${item.itemId}`}
                    actions={
                      <>
                        <span className="text-xs font-bold text-yellow-300">{price} gp</span>
                        <button
                          type="button"
                          data-testid={`realm-shop-buy-${item.itemId}`}
                          disabled={!affordable}
                          onClick={() => onBuy(item.itemId, 1, effectiveRecipient)}
                          className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-600 text-slate-950 text-xs font-bold min-h-[36px]"
                        >
                          Buy
                        </button>
                      </>
                    }
                  />
                </li>
              );
            })}
          </ul>
        ) : (
          <div data-testid="realm-shop-sell-list" className="space-y-3">
            {party.map((hero) => {
              const items = hero.buildState?.inventory ?? [];
              if (items.length === 0) return null;
              return (
                <div key={hero.id}>
                  <h3 className="text-xs font-bold text-slate-400 mb-1">{hero.name}</h3>
                  <ul className="space-y-1">
                    {items.map((instance) => {
                      const catalog = getShopCatalogEntry(instance.itemId);
                      const basePrice = catalog
                        ? getShopItemPrice(
                            {
                              itemId: instance.itemId,
                              name: catalog.name,
                              basePriceGp: catalog.basePriceGp,
                              quantity: 1,
                              isMagicItem: catalog.isMagicItem,
                            },
                            reputation,
                          )
                        : 1;
                      const sellValue = Math.max(
                        1,
                        Math.floor(basePrice * SELL_PRICE_RATIO),
                      ) * instance.quantity;
                      return (
                        <li key={instance.instanceId}>
                          <InventoryItemRow
                            itemId={instance.itemId}
                            compendium={defaultCompendium}
                            quantity={instance.quantity}
                            testId={`realm-shop-sell-item-${instance.instanceId}`}
                            actions={
                              <>
                                <span className="text-xs font-bold text-yellow-300">{sellValue} gp</span>
                                <button
                                  type="button"
                                  data-testid={`realm-shop-sell-${instance.instanceId}`}
                                  onClick={() => onSell(hero.id, instance.instanceId)}
                                  className="px-3 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-bold text-slate-100 min-h-[32px]"
                                >
                                  Sell
                                </button>
                              </>
                            }
                          />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
            {party.every((h) => (h.buildState?.inventory?.length ?? 0) === 0) && (
              <p className="text-sm text-slate-500 italic">The party has nothing to sell.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
