import React from 'react';

export interface ActionTooltipCost {
  /** e.g. "Action", "Bonus Action", "Reaction", "Movement", "Free" */
  action: string;
  /** e.g. "Spell Slot", "Level 3 Slot" — appended after a "+" pip like BG3 */
  resource?: string;
}

export interface ActionTooltipCardProps {
  icon?: React.ReactNode;
  name: string;
  /** Right-side badge, e.g. "Level 3", "Cantrip", "Melee Weapon" */
  badge?: string;
  /** Subtitle line, e.g. school name + casting time */
  subtitle?: string;
  /** Main effect lines, e.g. damage, save, range */
  effectLines?: string[];
  /** Requirement / warning line rendered in red, e.g. "No club or quarterstaff equipped." */
  warning?: string;
  /** Concentration flag chip */
  concentration?: boolean;
  cost: ActionTooltipCost;
  accent?: 'amber' | 'purple' | 'sky' | 'emerald';
  testId?: string;
}

const ACCENT_BORDER: Record<NonNullable<ActionTooltipCardProps['accent']>, string> = {
  amber: 'border-amber-500/40',
  purple: 'border-purple-500/40',
  sky: 'border-sky-500/40',
  emerald: 'border-emerald-500/40',
};

/**
 * BG3-style floating tooltip card (reference: screenshots 085 "Shillelagh"
 * and 086 "Entangle"). Name + badge header, effect summary lines, an optional
 * red requirement warning, and a cost footer (Action + resource pips).
 */
export function ActionTooltipCard({
  icon,
  name,
  badge,
  subtitle,
  effectLines = [],
  warning,
  concentration = false,
  cost,
  accent = 'amber',
  testId,
}: ActionTooltipCardProps) {
  return (
    <div
      data-testid={testId}
      className={`w-72 p-3 bg-slate-950/95 border ${ACCENT_BORDER[accent]} rounded-xl shadow-2xl backdrop-blur-md text-left flex flex-col gap-1.5`}
    >
      <div className="flex items-center justify-between gap-1 border-b border-slate-800 pb-1.5">
        <span className="font-bold text-slate-100 text-xs flex items-center gap-1.5 min-w-0">
          {icon}
          <span className="truncate">{name}</span>
        </span>
        {badge && (
          <span className="px-1.5 py-0.2 rounded bg-slate-900 border border-slate-700 text-[10px] font-semibold text-slate-300 shrink-0">
            {badge}
          </span>
        )}
      </div>

      {subtitle && (
        <div className="text-[11px] text-slate-400 capitalize">{subtitle}</div>
      )}

      {effectLines.length > 0 && (
        <div className="text-[11px] text-slate-300 leading-relaxed space-y-0.5">
          {effectLines.map((line, idx) => (
            <div key={idx}>{line}</div>
          ))}
        </div>
      )}

      {warning && (
        <div className="flex items-start gap-1 text-[11px] text-rose-400 font-medium">
          <span aria-hidden>⚠️</span>
          <span>{warning}</span>
        </div>
      )}

      {concentration && (
        <div className="text-[10px] text-amber-300 font-semibold">
          ◉ Concentration: Required
        </div>
      )}

      <div className="flex items-center justify-center gap-1.5 pt-1.5 border-t border-slate-800 text-[11px] font-semibold text-amber-300">
        <span>▲ {cost.action}</span>
        {cost.resource && (
          <>
            <span className="text-slate-600">+</span>
            <span className="text-sky-300">■ {cost.resource}</span>
          </>
        )}
      </div>
    </div>
  );
}
