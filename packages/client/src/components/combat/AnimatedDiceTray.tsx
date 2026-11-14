import React, { useState } from 'react';
import type { DiceRollRecord, DiceGroupRollRecord } from '@srd5/engine';
import type { DiceTrayProps } from './types.js';

interface DieFaceProps {
  sides: number;
  value: number;
  isKept?: boolean;
  isDropped?: boolean;
  isCrit?: boolean;
  isFumble?: boolean;
  isRerolled?: boolean;
  originalValue?: number;
  animating?: boolean;
}

export function DieFace({
  sides,
  value,
  isKept = true,
  isDropped = false,
  isCrit = false,
  isFumble = false,
  isRerolled = false,
  originalValue,
  animating = false,
}: DieFaceProps) {
  // Determine shape styling based on die sides
  const getShapeClasses = () => {
    switch (sides) {
      case 4:
        return 'clip-triangle aspect-[1/0.88]';
      case 6:
        return 'rounded-lg aspect-square';
      case 8:
        return 'rotate-45 rounded-sm aspect-square';
      case 10:
        return 'rounded-md aspect-[1/1.1]';
      case 12:
        return 'rounded-xl aspect-square';
      case 20:
        return 'rounded-2xl aspect-square';
      default:
        return 'rounded-full aspect-square';
    }
  };

  // Color scheme based on crit, fumble, or dropped
  let bgGradient = 'bg-gradient-to-br from-slate-700 to-slate-900 border-slate-600 text-slate-100';
  if (isCrit) {
    bgGradient =
      'bg-gradient-to-br from-amber-400 via-yellow-500 to-amber-600 border-amber-300 text-slate-950 font-black shadow-lg shadow-amber-500/50';
  } else if (isFumble) {
    bgGradient =
      'bg-gradient-to-br from-red-600 via-rose-700 to-red-900 border-rose-400 text-white font-black shadow-lg shadow-red-600/50';
  } else if (isDropped) {
    bgGradient = 'bg-slate-900/60 border-slate-800 text-slate-500 line-through opacity-60';
  } else if (isKept) {
    bgGradient = 'bg-gradient-to-br from-indigo-700 to-slate-900 border-indigo-400/80 text-white shadow-md';
  }

  const animationClass = animating ? 'animate-bounce' : 'transition-transform duration-300 hover:scale-105';

  return (
    <div className="relative inline-flex flex-col items-center">
      <div
        data-testid={`die-face-d${sides}`}
        className={`relative flex items-center justify-center min-w-10 min-h-10 px-2 py-1.5 border-2 ${getShapeClasses()} ${bgGradient} ${animationClass}`}
      >
        <span
          className={`text-sm sm:text-base font-extrabold select-none ${sides === 8 ? '-rotate-45' : ''}`}
        >
          {value}
        </span>

        {/* Die Type Watermark */}
        <span
          className={`absolute bottom-0.5 right-1 text-[8px] font-mono opacity-40 uppercase select-none ${sides === 8 ? '-rotate-45' : ''}`}
        >
          d{sides}
        </span>
      </div>

      {/* Dropped Badge */}
      {isDropped && (
        <span className="mt-0.5 text-[9px] uppercase tracking-wider text-slate-500 font-semibold">
          dropped
        </span>
      )}

      {/* Rerolled Tag (e.g. Halfling Lucky) */}
      {isRerolled && originalValue !== undefined && (
        <span className="mt-0.5 text-[9px] text-amber-400 font-mono font-bold flex items-center gap-0.5">
          <span className="line-through text-slate-500">{originalValue}</span>
          <span>➔</span>
          <span>{value}</span>
        </span>
      )}
    </div>
  );
}

export function AnimatedDiceTray({
  activeRoll,
  rollHistory = [],
  rollPurpose,
  actorName,
  onReroll,
  onClearHistory,
  onSelectHistoryRoll,
  collapsed = false,
  onToggleCollapse,
  className = '',
}: DiceTrayProps) {
  const [internalHistory, setInternalHistory] = useState<DiceRollRecord[]>([]);
  const [isAnimating, setIsAnimating] = useState(false);

  // Trigger animation effect when active roll updates
  React.useEffect(() => {
    if (activeRoll) {
      setIsAnimating(true);
      const timer = setTimeout(() => setIsAnimating(false), 450);
      return () => clearTimeout(timer);
    }
  }, [activeRoll]);

  const history = rollHistory.length > 0 ? rollHistory : internalHistory;
  const currentRoll = activeRoll ?? history[0] ?? null;

  if (collapsed) {
    return (
      <div
        data-testid="animated-dice-tray-collapsed"
        className={`bg-slate-900 border border-slate-800 rounded-lg p-2 flex items-center justify-between text-xs text-slate-400 ${className}`}
      >
        <div className="flex items-center gap-2">
          <span className="text-amber-400">🎲</span>
          <span className="font-semibold text-slate-200">Dice Tray</span>
          {currentRoll && (
            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 font-mono font-bold">
              Total: {currentRoll.total}
            </span>
          )}
        </div>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="hover:text-white px-1.5 py-0.5 rounded bg-slate-800 text-[11px]"
          >
            Expand ▲
          </button>
        )}
      </div>
    );
  }

  // Format the breakdown formula string
  const formatFormulaBreakdown = (roll: DiceRollRecord) => {
    const diceParts = roll.diceGroups.map((g) => {
      const keptStr = g.kept.length > 0 ? g.kept.join(' + ') : '0';
      return `[${keptStr}]`;
    });

    const diceSummary = diceParts.join(' + ');
    const modStr =
      roll.modifier !== 0
        ? ` ${roll.modifier >= 0 ? '+' : '-'} ${Math.abs(roll.modifier)}`
        : '';

    return `${diceSummary}${modStr} = ${roll.total}`;
  };

  return (
    <div
      data-testid="animated-dice-tray"
      className={`flex flex-col bg-slate-900 border border-slate-800 rounded-xl shadow-xl overflow-hidden ${className}`}
    >
      {/* Tray Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-950/80 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-amber-400 text-base">🎲</span>
          <div>
            <h4 className="text-xs font-bold text-slate-100 tracking-wide uppercase">
              Dice Tray
            </h4>
            {(actorName || rollPurpose) && (
              <span className="text-[10px] text-slate-400 block truncate max-w-[200px]">
                {actorName ? `${actorName}: ` : ''}
                {rollPurpose ?? 'Custom Roll'}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {onReroll && (
            <button
              type="button"
              data-testid="dice-tray-reroll-btn"
              onClick={onReroll}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300 hover:text-white transition-colors"
              title="Roll again"
            >
              🔄 Roll
            </button>
          )}

          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="px-1.5 py-0.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white text-xs"
              title="Collapse Tray"
            >
              ▼
            </button>
          )}
        </div>
      </div>

      {/* Main Dice Pit / Stage */}
      <div className="p-4 bg-gradient-to-b from-slate-950/70 to-slate-900/90 flex flex-col items-center justify-center min-h-[140px] gap-3">
        {currentRoll ? (
          <>
            {/* Critical Hit / Natural 1 Fumble Callout Banner */}
            {currentRoll.naturalCrit && (
              <div
                data-testid="dice-tray-crit-badge"
                className="px-3 py-0.5 rounded-full bg-amber-500 text-slate-950 text-xs font-extrabold uppercase tracking-widest shadow-md shadow-amber-500/40 animate-pulse flex items-center gap-1"
              >
                <span>★</span>
                <span>Critical Hit (Natural 20)!</span>
                <span>★</span>
              </div>
            )}

            {currentRoll.naturalFumble && (
              <div
                data-testid="dice-tray-fumble-badge"
                className="px-3 py-0.5 rounded-full bg-rose-600 text-white text-xs font-extrabold uppercase tracking-widest shadow-md shadow-rose-600/40 animate-pulse flex items-center gap-1"
              >
                <span>☠</span>
                <span>Fumble (Natural 1)!</span>
                <span>☠</span>
              </div>
            )}

            {/* Die Faces Grid */}
            <div className="flex flex-wrap items-center justify-center gap-3">
              {currentRoll.diceGroups.flatMap((group, groupIdx) => {
                return group.dice.map((die, dieIdx) => {
                  const isDropped = !die.kept;
                  const isCrit =
                    !isDropped &&
                    group.faces === 20 &&
                    currentRoll.naturalCrit &&
                    die.value >= 20;
                  const isFumble =
                    !isDropped &&
                    group.faces === 20 &&
                    currentRoll.naturalFumble &&
                    die.value === 1;

                  const isRerolled = die.rerolled;

                  return (
                    <DieFace
                      key={`${groupIdx}-${dieIdx}`}
                      sides={group.faces}
                      value={die.value}
                      isKept={die.kept}
                      isDropped={isDropped}
                      isCrit={isCrit}
                      isFumble={isFumble}
                      isRerolled={isRerolled}
                      originalValue={isRerolled ? die.initialRoll : undefined}
                      animating={isAnimating}
                    />
                  );
                });
              })}
            </div>

            {/* Formula & Total Breakdown */}
            <div className="flex flex-col items-center gap-1 text-center mt-1">
              <span
                data-testid="dice-tray-total"
                className={`text-2xl sm:text-3xl font-black tracking-tight ${
                  currentRoll.naturalCrit
                    ? 'text-amber-400'
                    : currentRoll.naturalFumble
                      ? 'text-rose-400'
                      : 'text-slate-100'
                }`}
              >
                {currentRoll.total}
              </span>

              <span
                data-testid="dice-tray-formula"
                className="text-xs font-mono text-slate-400 bg-slate-950/80 px-2 py-0.5 rounded border border-slate-800"
              >
                {currentRoll.resolvedNotation}: {formatFormulaBreakdown(currentRoll)}
              </span>

              {currentRoll.mode !== 'normal' && (
                <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-400">
                  {currentRoll.mode === 'advantage'
                    ? 'Advantage (Keep Highest)'
                    : 'Disadvantage (Keep Lowest)'}
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="text-center py-4 text-xs text-slate-500 italic">
            <span>No dice rolled yet. Roll an attack or spell to view dice.</span>
          </div>
        )}
      </div>

      {/* Roll History Drawer */}
      {history.length > 1 && (
        <div className="border-t border-slate-800 bg-slate-950/60 p-2 text-xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
              Recent Rolls ({history.length})
            </span>
            {onClearHistory && (
              <button
                type="button"
                data-testid="dice-tray-clear-btn"
                onClick={onClearHistory}
                className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
            {history.slice(0, 8).map((roll, idx) => (
              <button
                key={idx}
                type="button"
                data-testid="dice-tray-history-item"
                onClick={() => onSelectHistoryRoll && onSelectHistoryRoll(roll)}
                className={`px-2 py-1 rounded border text-[11px] font-mono shrink-0 transition-colors ${
                  roll === currentRoll
                    ? 'bg-amber-500/20 border-amber-500/60 text-amber-300 font-bold'
                    : 'bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                {roll.formula}: <strong>{roll.total}</strong>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
