import React, { useState } from 'react';
import type { OverworldPOI } from '@srd5/engine';
import { defaultCompendium } from '@srd5/data';
import {
  getSettlementHubAccess,
  getIdentifyCost,
  getShopCatalogEntry,
  getShopItemPrice,
  getTempleBlessingCost,
  getTempleCleanseCost,
  SELL_PRICE_RATIO,
  TEMPLE_BLESSING_ID,
} from '@srd5/engine';
import { InventoryItemRow } from '../inventory/InventoryItemRow.js';
import {
  type RealmSessionState,
  getHubMarketStock,
  getHubRumors,
  getPartyList,
} from './realmEngine.js';

/**
 * Settlement adventuring hub (SRD-808): a single menu per settlement — never a
 * walkable tactical city map. Tabs: Inn (safe free Long Rest + rumors that
 * reveal nearby POIs), Market (rep-gated buy/sell + identify), Temple
 * (affliction cleansing + blessings), Board (tavern postings with giver
 * blurbs, accept/abandon).
 */

export type HubTab = 'inn' | 'market' | 'temple' | 'board';

export interface RealmSettlementHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: RealmSessionState;
  poi: OverworldPOI | null;
  onCamp: (restType: 'short' | 'long') => void;
  onHearRumor: (targetPoiId: string) => void;
  onBuy: (itemId: string, quantity: number, characterId: string) => void;
  onSell: (characterId: string, instanceId: string) => void;
  onIdentify: (characterId: string, instanceId: string) => void;
  onCleanse: (characterId: string) => void;
  onBless: () => void;
  onAcceptQuest: (questId: string) => void;
  onAbandonQuest: (questId: string) => void;
}

export function RealmSettlementHubModal({
  isOpen,
  onClose,
  session,
  poi,
  onCamp,
  onHearRumor,
  onBuy,
  onSell,
  onIdentify,
  onCleanse,
  onBless,
  onAcceptQuest,
  onAbandonQuest,
}: RealmSettlementHubModalProps) {
  const [tab, setTab] = useState<HubTab>('inn');
  const [recipientId, setRecipientId] = useState<string>(session.partyOrder[0] ?? '');

  if (!isOpen || !poi) return null;

  const party = getPartyList(session);
  const effectiveRecipient = party.some((h) => h.id === recipientId)
    ? recipientId
    : (party[0]?.id ?? '');
  const access = getSettlementHubAccess(session.map, poi);
  const rumors = getHubRumors(session, poi.id);
  const stock = getHubMarketStock(session, poi.id);
  const gold = session.travel.gold;
  const identifyCost = getIdentifyCost(access.reputation);
  const cleanseCost = getTempleCleanseCost(access.reputation);
  const blessingCost = getTempleBlessingCost(access.reputation);
  const boardQuests = session.questLog.quests.filter(
    (q) => q.status === 'available' && q.boardPoiId === poi.id,
  );
  const activeQuests = session.questLog.quests.filter((q) => q.status === 'active');
  const unidentified = party.flatMap((hero) =>
    (hero.buildState?.inventory ?? [])
      .filter((item) => !item.identified)
      .map((item) => ({ hero, item })),
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="realm-hub-title"
      data-testid="realm-hub-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-amber-500/40 bg-slate-900 shadow-2xl p-6 text-slate-100 space-y-4">
        <header className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h2 id="realm-hub-title" data-testid="realm-hub-title" className="text-xl font-bold text-amber-400">
              🏘️ {poi.name} — Adventuring Hub
            </h2>
            <p data-testid="realm-hub-reputation" className="text-xs text-slate-400">
              {access.tier} (rep {access.reputation}) · prices ×{access.priceMultiplier}
            </p>
          </div>
          <button
            type="button"
            data-testid="realm-hub-close-btn"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md text-lg"
          >
            ✕
          </button>
        </header>

        <div className="flex rounded-lg bg-slate-950 p-0.5 border border-slate-800 w-fit">
          {(
            [
              ['inn', '🛏️ Inn & Rumors'],
              ['market', '🛒 Market'],
              ['temple', '🕍 Temple'],
              ['board', `📋 Board (${boardQuests.length})`],
            ] as Array<[HubTab, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              data-testid={`realm-hub-tab-${key}`}
              aria-pressed={tab === key}
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                tab === key ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'inn' && (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">
              The inn is always open to travellers: a safe, free Long Rest (wilderness ration
              rules do not apply here).
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="realm-hub-inn-short-rest-btn"
                onClick={() => onCamp('short')}
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold min-h-[44px]"
              >
                🏕️ Short Rest
              </button>
              <button
                type="button"
                data-testid="realm-hub-inn-long-rest-btn"
                onClick={() => onCamp('long')}
                className="px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-xs font-bold min-h-[44px]"
              >
                🛏️ Long Rest (safe & free)
              </button>
            </div>
            <h3 className="text-sm font-bold text-slate-200">Whispers over ale (1 gp each)</h3>
            <ul data-testid="realm-hub-rumor-list" className="space-y-1.5">
              {rumors.length === 0 && (
                <li className="text-sm text-slate-500 italic">No rumors tonight — the fire crackles quietly.</li>
              )}
              {rumors.map((rumor) => {
                const revealed = session.revealedPoiIds.includes(rumor.targetPoiId);
                return (
                  <li
                    key={rumor.id}
                    data-testid={`realm-hub-rumor-${rumor.targetPoiId}`}
                    className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2"
                  >
                    <div className="text-xs font-bold text-slate-200">{rumor.title}</div>
                    <p className="text-[11px] text-slate-400 italic">
                      {rumor.informant} leans in: {rumor.rumorText}
                    </p>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-500">
                        📍 {rumor.distanceTiles} tiles away · {rumor.costGp} gp
                        {revealed ? ' · marked ✓' : ''}
                      </span>
                      <button
                        type="button"
                        data-testid={`realm-hub-hear-rumor-${rumor.targetPoiId}`}
                        disabled={revealed || gold < rumor.costGp}
                        onClick={() => onHearRumor(rumor.targetPoiId)}
                        className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-600 text-slate-950 text-xs font-bold"
                      >
                        {revealed ? 'Marked ✓' : 'Buy a round 🍺'}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {tab === 'market' && (
          <div className="space-y-3">
            {!access.marketOpen ? (
              <p data-testid="realm-hub-market-closed" className="text-sm text-red-300">
                🚫 The market gates are closed to your party ({access.tier} standing). Raise your
                reputation to trade here.
              </p>
            ) : (
              <>
                <p className="text-xs text-slate-400">
                  Purse: <span className="text-yellow-300 font-bold">{gold} gp</span>
                  {!access.magicStockVisible && ' · rare stock hidden from unfriendly buyers'}
                </p>
                <label className="flex items-center gap-1.5 text-xs text-slate-400">
                  Deliver to
                  <select
                    data-testid="realm-hub-recipient-select"
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
                <ul data-testid="realm-hub-buy-list" className="space-y-1.5">
                  {(stock?.items ?? []).length === 0 && (
                    <li className="text-sm text-slate-500 italic">Sold out — check back after other travelers.</li>
                  )}
                  {(stock?.items ?? []).map((item) => {
                    const price = getShopItemPrice(item, access.reputation);
                    const affordable = gold >= price && item.quantity > 0;
                    return (
                      <li key={item.itemId}>
                        <InventoryItemRow
                          itemId={item.itemId}
                          compendium={defaultCompendium}
                          quantity={item.quantity}
                          testId={`realm-hub-buy-item-${item.itemId}`}
                          actions={
                            <>
                              <span className="text-xs font-bold text-yellow-300">{price} gp</span>
                              <button
                                type="button"
                                data-testid={`realm-hub-buy-${item.itemId}`}
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
                <h3 className="text-sm font-bold text-slate-200">
                  Identify magic ({identifyCost} gp each)
                </h3>
                <ul data-testid="realm-hub-identify-list" className="space-y-1">
                  {unidentified.length === 0 && (
                    <li className="text-xs text-slate-500 italic">Nothing awaits identification.</li>
                  )}
                  {unidentified.map(({ hero, item }) => (
                    <li
                      key={item.instanceId}
                      data-testid={`realm-hub-identify-item-${item.instanceId}`}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5"
                    >
                      <span className="text-xs text-slate-300 truncate">
                        {hero.name}: {item.itemId}
                      </span>
                      <button
                        type="button"
                        data-testid={`realm-hub-identify-${item.instanceId}`}
                        disabled={gold < identifyCost}
                        onClick={() => onIdentify(hero.id, item.instanceId)}
                        className="px-3 py-1 rounded-lg bg-purple-700 hover:bg-purple-600 disabled:bg-slate-800 disabled:text-slate-600 text-xs font-bold text-white"
                      >
                        Identify · {identifyCost} gp
                      </button>
                    </li>
                  ))}
                </ul>
                <h3 className="text-sm font-bold text-slate-200">Sell</h3>
                <ul data-testid="realm-hub-sell-list" className="space-y-1">
                  {party.every((h) => (h.buildState?.inventory?.length ?? 0) === 0) && (
                    <li className="text-xs text-slate-500 italic">The party has nothing to sell.</li>
                  )}
                  {party.flatMap((hero) =>
                    (hero.buildState?.inventory ?? []).map((instance) => {
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
                            access.reputation,
                          )
                        : 1;
                      const sellValue = Math.max(1, Math.floor(basePrice * SELL_PRICE_RATIO)) * instance.quantity;
                      return (
                        <li key={instance.instanceId}>
                          <InventoryItemRow
                            itemId={instance.itemId}
                            compendium={defaultCompendium}
                            quantity={instance.quantity}
                            provenanceLine={hero.name}
                            testId={`realm-hub-sell-item-${instance.instanceId}`}
                            actions={
                              <>
                                <span className="text-xs font-bold text-yellow-300">{sellValue} gp</span>
                                <button
                                  type="button"
                                  data-testid={`realm-hub-sell-${instance.instanceId}`}
                                  onClick={() => onSell(hero.id, instance.instanceId)}
                                  className="px-3 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-bold text-slate-100"
                                >
                                  Sell
                                </button>
                              </>
                            }
                          />
                        </li>
                      );
                    }),
                  )}
                </ul>
              </>
            )}
          </div>
        )}

        {tab === 'temple' && (
          <div className="space-y-3">
            {!access.templeOpen ? (
              <p data-testid="realm-hub-temple-closed" className="text-sm text-red-300">
                🚫 The temple doors are barred to your party ({access.tier} standing).
              </p>
            ) : (
              <>
                <p className="text-xs text-slate-400">
                  Cleansing lifts poison, blindness, deafness, fear and one level of exhaustion ·{' '}
                  <span className="text-yellow-300 font-bold">{cleanseCost} gp</span> per hero. Blessings
                  aid every living hero ·{' '}
                  <span className="text-yellow-300 font-bold">
                    {blessingCost === 0 ? 'free (exalted allies)' : `${blessingCost} gp`}
                  </span>
                  .
                </p>
                <ul data-testid="realm-hub-cleanse-list" className="space-y-1.5">
                  {party.map((hero) => {
                    const blessed = hero.blessings?.includes(TEMPLE_BLESSING_ID) === true;
                    return (
                      <li
                        key={hero.id}
                        data-testid={`realm-hub-hero-${hero.id}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <span className="text-sm font-semibold text-slate-200">{hero.name}</span>
                          <span className="ml-2 text-[11px] text-slate-500">
                            {hero.conditions.length > 0 ? hero.conditions.join(', ') : 'healthy'}
                            {hero.exhaustionLevel ? ` · exhaustion ${hero.exhaustionLevel}` : ''}
                            {blessed ? ' · ✨ blessed' : ''}
                          </span>
                        </div>
                        <button
                          type="button"
                          data-testid={`realm-hub-cleanse-${hero.id}`}
                          disabled={gold < cleanseCost}
                          onClick={() => onCleanse(hero.id)}
                          className="px-3 py-1.5 rounded-lg bg-cyan-700 hover:bg-cyan-600 disabled:bg-slate-800 disabled:text-slate-600 text-xs font-bold text-white shrink-0"
                        >
                          Cleanse · {cleanseCost} gp
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <button
                  type="button"
                  data-testid="realm-hub-bless-btn"
                  disabled={gold < blessingCost}
                  onClick={onBless}
                  className="w-full px-4 py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-40 text-slate-950 text-sm font-black min-h-[48px]"
                >
                  ✨ Receive Blessing {blessingCost === 0 ? '(free)' : `· ${blessingCost} gp`}
                </button>
              </>
            )}
          </div>
        )}

        {tab === 'board' && (
          <div className="space-y-3">
            {!access.boardOpen ? (
              <p data-testid="realm-hub-board-closed" className="text-sm text-red-300">
                🚫 The board is torn down — none will post work for the hated.
              </p>
            ) : (
              <>
                <ul data-testid="realm-hub-board-list" className="space-y-2">
                  {boardQuests.length === 0 && (
                    <li className="text-sm text-slate-500 italic">No postings on this board.</li>
                  )}
                  {boardQuests.map((quest) => (
                    <li
                      key={quest.id}
                      data-testid={`realm-hub-quest-${quest.id}`}
                      className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-1.5"
                    >
                      <div className="text-sm font-bold text-slate-100">{quest.title}</div>
                      <p className="text-xs text-slate-400">{quest.description}</p>
                      {quest.giverName && (
                        <p data-testid={`realm-hub-quest-giver-${quest.id}`} className="text-[11px] text-amber-200/90 italic">
                          — {quest.giverName}: “{quest.giverBlurb}”
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        {quest.targetName && <span className="text-slate-300">📍 {quest.targetName}</span>}
                        <span className="text-yellow-300 font-bold">💰 {quest.rewardGold} gp</span>
                        <span className="text-purple-300 font-bold">🚩 +{quest.reputationReward} rep</span>
                      </div>
                      <button
                        type="button"
                        data-testid={`realm-hub-accept-${quest.id}`}
                        onClick={() => onAcceptQuest(quest.id)}
                        className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold min-h-[36px]"
                      >
                        Accept Quest
                      </button>
                    </li>
                  ))}
                </ul>
                {activeQuests.length > 0 && (
                  <>
                    <h3 className="text-sm font-bold text-slate-200">Active contracts</h3>
                    <ul data-testid="realm-hub-active-list" className="space-y-1.5">
                      {activeQuests.map((quest) => (
                        <li
                          key={quest.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2"
                        >
                          <span className="text-xs text-slate-200 truncate">{quest.title}</span>
                          <button
                            type="button"
                            data-testid={`realm-hub-abandon-${quest.id}`}
                            onClick={() => onAbandonQuest(quest.id)}
                            className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-red-900/60 border border-slate-700 text-xs font-semibold text-slate-300 hover:text-red-200"
                          >
                            Abandon
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
