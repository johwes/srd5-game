import React from 'react';
import type { LootBundleSpec, SrdCompendium } from '@srd5/data';
import { InventoryGridCell } from '../inventory/InventoryGridCell.js';
import { ESC_PRIORITY, useEscHandler } from '../../hooks/useEscStack.js';
import { formatLootProvenance } from './LootInventoryModal.js';

export interface LootBoxAnchorPoint {
  /** Screen/container pixel coordinates of the container (prop) projection. */
  x: number;
  y: number;
}

export interface AnchoredLootBoxLoot {
  sourcePropId?: string;
  sourceName?: string;
  bundle: LootBundleSpec;
}

export interface AnchoredLootBoxPanelProps {
  loot: AnchoredLootBoxLoot;
  compendium: SrdCompendium;
  partyHeroes: Array<{ id: string; name: string }>;
  selectedHeroId: string;
  onSelectHero: (heroId: string) => void;
  /** Container-relative pixel projection of the loot source; null centers. */
  anchor?: LootBoxAnchorPoint | null;
  /** Container/viewport size used for clamping; defaults to 1280x800. */
  viewportWidth?: number;
  viewportHeight?: number;
  onClaimItem: (itemIndex: number) => void;
  onClaimGold: () => void;
  onClaimAll: () => void;
  /** Opens the fullscreen loot/inventory modal for full management. */
  onManage: () => void;
  onClose: () => void;
}

export const ANCHORED_LOOT_BOX_WIDTH = 320;
export const ANCHORED_LOOT_BOX_OFFSET = 16;
export const ANCHORED_LOOT_BOX_MARGIN = 12;

/**
 * SRD-1510 viewport clamping for the anchored loot box.
 *
 * Places the box down-right of the container projection, then clamps it
 * inside the viewport so it never overflows (Battlefield stays visible
 * behind it; no fullscreen modal chrome).
 */
export function clampLootBoxPosition(
  anchor: LootBoxAnchorPoint | null,
  viewportWidth: number,
  viewportHeight: number,
  boxWidth = ANCHORED_LOOT_BOX_WIDTH,
  boxHeight = 380,
  margin = ANCHORED_LOOT_BOX_MARGIN,
): { left: number; top: number } {
  const safeW = Math.max(1, viewportWidth);
  const safeH = Math.max(1, viewportHeight);
  if (!anchor) {
    return {
      left: Math.max(margin, (safeW - boxWidth) / 2),
      top: Math.max(margin, safeH - boxHeight - 96),
    };
  }
  const desiredLeft = anchor.x + ANCHORED_LOOT_BOX_OFFSET;
  const desiredTop = anchor.y + ANCHORED_LOOT_BOX_OFFSET;
  return {
    left: Math.min(Math.max(desiredLeft, margin), Math.max(margin, safeW - boxWidth - margin)),
    top: Math.min(Math.max(desiredTop, margin), Math.max(margin, safeH - boxHeight - margin)),
  };
}

/**
 * SRD-1510 anchored in-world loot box (BG3 `bg3-loot-box-inworld` reference).
 *
 * First-touch acquisition surface: item grid, gold line, Take All bar,
 * click-item-to-take — the same `CLAIM_LOOT` commands as the fullscreen
 * `LootInventoryModal`, minus the modal chrome. The battlefield stays
 * visible behind it (absolute positioning, no fullscreen backdrop).
 * Dismissed via Esc, the close button, or walk-away (parent unmounts it
 * when the prop leaves adjacency).
 */
export function AnchoredLootBoxPanel({
  loot,
  compendium,
  partyHeroes,
  selectedHeroId,
  onSelectHero,
  anchor = null,
  viewportWidth = 1280,
  viewportHeight = 800,
  onClaimItem,
  onClaimGold,
  onClaimAll,
  onManage,
  onClose,
}: AnchoredLootBoxPanelProps) {
  useEscHandler(
    () => {
      onClose();
      return true;
    },
    { priority: ESC_PRIORITY.modal, active: true },
  );

  const recipient = partyHeroes.find((h) => h.id === selectedHeroId) ?? partyHeroes[0];
  const { left, top } = clampLootBoxPosition(anchor, viewportWidth, viewportHeight);
  const gp = loot.bundle.gp ?? 0;
  const items = loot.bundle.items ?? [];
  const isEmpty = gp <= 0 && items.length === 0;

  return (
    <div
      role="dialog"
      aria-label={`Loot: ${loot.sourceName ?? 'Discovered cache'}`}
      data-testid="anchored-loot-box"
      className="absolute z-40 w-80 rounded-xl border border-amber-500/40 bg-slate-900/95 shadow-2xl backdrop-blur-sm text-slate-100 pointer-events-auto flex flex-col max-h-[70%] overflow-hidden"
      style={{ left, top }}
    >
      <header className="flex items-start justify-between gap-2 px-3 pt-2.5 pb-2 border-b border-slate-800">
        <div className="min-w-0">
          <div
            data-testid="anchored-loot-title"
            className="text-sm font-bold text-amber-300 truncate"
          >
            🎁 {loot.sourceName ?? 'Discovered cache'}
          </div>
          {loot.bundle.origin && (
            <div
              data-testid="anchored-loot-provenance"
              className="text-[11px] text-slate-400 italic truncate"
            >
              🏴 {formatLootProvenance(loot.bundle.origin, loot.bundle.sourceName)}
            </div>
          )}
        </div>
        <button
          type="button"
          data-testid="anchored-loot-close-btn"
          onClick={onClose}
          aria-label="Close loot box"
          className="text-slate-400 hover:text-white p-1 rounded-md text-base leading-none shrink-0"
        >
          ✕
        </button>
      </header>

      <div className="px-3 py-2 overflow-y-auto">
        {isEmpty ? (
          <div
            data-testid="anchored-loot-empty"
            className="text-xs text-slate-400 italic py-3 text-center"
          >
            Empty — all spoils claimed.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5 pb-2 text-xs text-slate-400">
              <span>To:</span>
              <select
                data-testid="anchored-loot-recipient-select"
                value={recipient?.id ?? ''}
                onChange={(e) => onSelectHero(e.target.value)}
                className="rounded bg-slate-800 border-slate-700 text-slate-200 px-1.5 py-0.5 text-xs max-w-[10rem]"
              >
                {partyHeroes.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </div>
            <div
              data-testid="anchored-loot-grid"
              className="grid grid-cols-4 gap-1.5 p-2 rounded-lg bg-slate-950/60 border border-slate-800"
            >
              {gp > 0 && (
                <button
                  type="button"
                  data-testid="anchored-loot-gold-pile"
                  title={`Take ${gp} gp`}
                  aria-label={`Take ${gp} gold pieces`}
                  onClick={onClaimGold}
                  className="group relative flex flex-col items-center justify-center gap-0.5 w-16 h-16 rounded-lg bg-amber-950/40 border-2 border-amber-500/70 p-1 transition-colors hover:bg-amber-900/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 cursor-pointer"
                >
                  <img
                    src="/assets/game-icons/coins.svg"
                    alt=""
                    className="w-6 h-6"
                    draggable={false}
                  />
                  <span className="max-w-full truncate text-[9px] leading-tight font-bold text-amber-300">
                    {gp} gp
                  </span>
                  <span className="max-w-full truncate text-[9px] leading-tight text-amber-200/70">
                    Gold Pile
                  </span>
                </button>
              )}
              {items.map((itemId, idx) => (
                <InventoryGridCell
                  key={`${itemId}-${idx}`}
                  itemId={itemId}
                  instanceId={`anchored-${itemId}-${idx}`}
                  compendium={compendium}
                  testIdPrefix="anchored-loot"
                  provenanceLine={
                    loot.bundle.origin
                      ? formatLootProvenance(loot.bundle.origin, loot.bundle.sourceName)
                      : undefined
                  }
                  onSelect={() => onClaimItem(idx)}
                />
              ))}
            </div>
            <div className="pt-1.5 text-[11px] text-slate-500">
              Click an item or the gold pile to take it.
            </div>
          </>
        )}
      </div>

      <footer className="flex items-center gap-2 px-3 py-2.5 border-t border-slate-800">
        {!isEmpty && (
          <button
            type="button"
            data-testid="anchored-loot-take-all-btn"
            onClick={onClaimAll}
            className="flex-1 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shadow transition-colors"
          >
            Take All
          </button>
        )}
        <button
          type="button"
          data-testid="anchored-loot-manage-btn"
          onClick={onManage}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700"
        >
          Manage ▸
        </button>
      </footer>
    </div>
  );
}
