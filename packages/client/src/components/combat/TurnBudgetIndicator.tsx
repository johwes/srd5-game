import React from 'react';
import type { TurnBudgetIndicatorProps } from './types.js';

export function TurnBudgetIndicator({
  turnBudget,
  speedFeet = 30,
  compact = false,
  className = '',
}: TurnBudgetIndicatorProps) {
  if (!turnBudget) {
    return (
      <div
        data-testid="turn-budget-indicator-empty"
        className={`text-xs text-slate-500 italic ${className}`}
      >
        No active turn budget
      </div>
    );
  }

  const {
    action,
    bonusAction,
    reactionAvailable,
    movementRemainingFeet,
    freeObjectInteraction,
    disengaged,
    dodging,
    extraAttacksRemaining,
    bonusActionSpellCast,
  } = turnBudget;

  const movementPercentage = Math.max(
    0,
    Math.min(100, (movementRemainingFeet / Math.max(1, speedFeet)) * 100),
  );

  return (
    <div
      data-testid="turn-budget-indicator"
      className={`flex flex-wrap items-center gap-2 sm:gap-3 text-xs ${className}`}
    >
      {/* Action Indicator */}
      <div
        data-testid="turn-budget-action"
        className={`flex items-center gap-1.5 px-2 py-1 rounded border font-medium transition-colors ${
          action > 0
            ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300'
            : 'bg-slate-900 border-slate-700 text-slate-500 line-through'
        }`}
        title={action > 0 ? 'Main Action available' : 'Main Action spent'}
      >
        <span
          className={`inline-block w-2.5 h-2.5 rounded-full ${
            action > 0 ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-slate-600'
          }`}
        />
        <span>Action {action > 1 ? `(${action})` : ''}</span>
      </div>

      {/* Bonus Action Indicator */}
      <div
        data-testid="turn-budget-bonus"
        className={`flex items-center gap-1.5 px-2 py-1 rounded border font-medium transition-colors ${
          bonusAction > 0
            ? 'bg-amber-950/80 border-amber-600 text-amber-300'
            : 'bg-slate-900 border-slate-700 text-slate-500 line-through'
        }`}
        title={
          bonusAction > 0 ? 'Bonus Action available' : 'Bonus Action spent'
        }
      >
        <span
          className={`inline-block w-2.5 h-2.5 rounded-full ${
            bonusAction > 0
              ? 'bg-amber-400 shadow-[0_0_6px_#fbbf24]'
              : 'bg-slate-600'
          }`}
        />
        <span>Bonus</span>
      </div>

      {/* Reaction Indicator */}
      <div
        data-testid="turn-budget-reaction"
        className={`flex items-center gap-1.5 px-2 py-1 rounded border font-medium transition-colors ${
          reactionAvailable
            ? 'bg-sky-950/80 border-sky-600 text-sky-300'
            : 'bg-slate-900 border-slate-700 text-slate-500 line-through'
        }`}
        title={
          reactionAvailable ? 'Reaction ready' : 'Reaction spent until next turn'
        }
      >
        <span
          className={`inline-block w-2.5 h-2.5 rounded-full ${
            reactionAvailable
              ? 'bg-sky-400 shadow-[0_0_6px_#38bdf8]'
              : 'bg-slate-600'
          }`}
        />
        <span>React</span>
      </div>

      {/* Movement Gauge */}
      <div
        data-testid="turn-budget-movement"
        className="flex items-center gap-1.5 px-2 py-1 rounded border bg-slate-900 border-slate-700 text-slate-300"
        title={`Remaining movement: ${movementRemainingFeet} of ${speedFeet} ft`}
      >
        <span className="text-amber-400">👟</span>
        <div className="flex flex-col">
          <div className="flex items-baseline justify-between gap-1 text-[11px] leading-tight">
            <span className="font-semibold text-slate-100">
              {movementRemainingFeet}
            </span>
            <span className="text-slate-500">/{speedFeet}ft</span>
          </div>
          {!compact && (
            <div className="w-16 h-1 bg-slate-800 rounded-full overflow-hidden mt-0.5">
              <div
                className={`h-full transition-all duration-200 ${
                  movementPercentage > 40
                    ? 'bg-amber-400'
                    : movementPercentage > 0
                      ? 'bg-orange-500'
                      : 'bg-slate-600'
                }`}
                style={{ width: `${movementPercentage}%` }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Free Object Interaction (if not compact) */}
      {!compact && freeObjectInteraction > 0 && (
        <span
          data-testid="turn-budget-free-interaction"
          className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] text-slate-400"
          title="Free object interaction available (open door, draw/sheathe weapon)"
        >
          Free Int ●
        </span>
      )}

      {/* Active Tactical Badges */}
      {disengaged && (
        <span
          data-testid="turn-budget-disengaged"
          className="px-2 py-0.5 rounded bg-emerald-900/60 border border-emerald-500 text-emerald-300 text-[11px] font-semibold flex items-center gap-1"
        >
          <span>💨</span> Disengaged
        </span>
      )}

      {dodging && (
        <span
          data-testid="turn-budget-dodging"
          className="px-2 py-0.5 rounded bg-blue-900/60 border border-blue-500 text-blue-300 text-[11px] font-semibold flex items-center gap-1"
        >
          <span>🛡️</span> Dodging
        </span>
      )}

      {extraAttacksRemaining > 0 && (
        <span
          data-testid="turn-budget-extra-attack"
          className="px-2 py-0.5 rounded bg-amber-900/60 border border-amber-500 text-amber-300 text-[11px] font-semibold"
        >
          +{extraAttacksRemaining} Extra Attack
        </span>
      )}

      {bonusActionSpellCast && (
        <span
          data-testid="turn-budget-cantrip-only"
          className="px-2 py-0.5 rounded bg-purple-900/60 border border-purple-500 text-purple-300 text-[11px] font-semibold"
          title="SRD Rule: Casting a bonus action spell restricts action spells to 1-action cantrips"
        >
          Cantrips Only
        </span>
      )}
    </div>
  );
}
