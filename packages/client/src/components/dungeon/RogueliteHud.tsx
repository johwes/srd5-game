import React from 'react';
import { GameIcon } from '../../canvas/assets/index.js';
import type { DeepDescentRunState } from '@srd5/engine';
import { getBiomeForDepth, getBiomeTheme } from '@srd5/engine';

export interface RogueliteHudProps {
  runState: DeepDescentRunState;
  onOpenRestCamp?: () => void;
  /**
   * BG3-style chrome folding: `'bar'` renders the standalone full-width run
   * strip; `'pills'` renders the same run status as an inline pill group for
   * embedding inside the exploration header (single chrome, no double header).
   */
  layout?: 'bar' | 'pills';
}

export function RogueliteHud({ runState, onOpenRestCamp, layout = 'bar' }: RogueliteHudProps) {
  const depth = runState.currentDepth;
  const biome = getBiomeForDepth(depth);
  const theme = getBiomeTheme(biome);

  const rations = runState.suppliesRemaining;
  const rationsColor =
    rations >= 8
      ? 'text-emerald-400 border-emerald-800 bg-emerald-950/60'
      : rations >= 4
      ? 'text-amber-400 border-amber-800 bg-amber-950/60'
      : 'text-rose-400 border-rose-800 bg-rose-950/60 animate-pulse';

  const biomeBadgeStyle = (() => {
    switch (biome) {
      case 'catacombs':
        return 'border-stone-700 bg-stone-900/90 text-stone-200';
      case 'sunken_tombs':
        return 'border-cyan-700 bg-cyan-950/90 text-cyan-200';
      case 'magma_caverns':
        return 'border-orange-700 bg-orange-950/90 text-orange-200';
      case 'deep_vaults':
        return 'border-indigo-700 bg-indigo-950/90 text-indigo-200';
      case 'abyssal_rift':
      default:
        return 'border-purple-700 bg-purple-950/90 text-purple-200';
    }
  })();

  return (
    <div
      data-testid="roguelite-hud-bar"
      className={
        layout === 'pills'
          ? 'flex flex-wrap items-center gap-x-3 gap-y-1 text-xs min-w-0'
          : 'flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-slate-950/90 border-b border-slate-800/80 text-xs backdrop-blur-sm z-30'
      }
    >
      {/* Depth & Biome */}
      <div className="flex items-center gap-2">
        <span className="font-extrabold text-white text-sm tracking-wide">
          Depth {depth}
        </span>
        <span
          className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold tracking-wide ${biomeBadgeStyle}`}
        >
          {theme.name}
        </span>
      </div>

      {/* Stats counters */}
      <div className="flex items-center gap-3">
        {/* Rations */}
        <div
          title={
            rations < 4
              ? 'Starvation warning! Rations are insufficient for a Long Rest.'
              : `${rations} Rations remaining (4 consumed per Long Rest)`
          }
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-semibold ${rationsColor}`}
        >
          <GameIcon name="berries-bowl" category="raw" size={14} />
          <span>{rations} Rations</span>
        </div>

        {/* Gold */}
        <div className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-yellow-800/60 bg-yellow-950/40 text-yellow-300 font-semibold">
          <GameIcon name="coins" category="raw" size={14} />
          <span>{runState.goldCollected} GP</span>
        </div>

        {/* Monsters Slain */}
        <div className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-800 bg-slate-900/60 text-rose-300 font-semibold">
          <GameIcon name="crossed-swords" category="raw" size={14} />
          <span>{runState.monstersSlain} Slain</span>
        </div>

        {/* Score */}
        <div className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-amber-600/60 bg-amber-950/50 text-amber-300 font-bold">
          <span>★</span>
          <span>{runState.score.toLocaleString()} pts</span>
        </div>
      </div>

      {/* Active Blessings */}
      {runState.shrineBlessings.length > 0 && (
        <div className="hidden md:flex items-center gap-1.5">
          <span className="text-slate-400 text-[10px] uppercase font-bold">Blessings:</span>
          {runState.shrineBlessings.map((blessing, i) => (
            <span
              key={i}
              className="px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-700 text-emerald-200 text-[10px] font-medium truncate max-w-[160px]"
              title={blessing}
            >
              ✦ {blessing.split(':')[0]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
