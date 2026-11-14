import React from 'react';
import type { PlayerViewCombatant } from '@srd5/transport';
import type { InitiativeRibbonProps } from './types.js';

function getSideColorClasses(side: PlayerViewCombatant['side']) {
  switch (side) {
    case 'party':
      return {
        border: 'border-sky-500',
        bg: 'bg-sky-950/40',
        text: 'text-sky-300',
        badge: 'bg-sky-900 border-sky-700 text-sky-200',
      };
    case 'monster':
      return {
        border: 'border-rose-500',
        bg: 'bg-rose-950/40',
        text: 'text-rose-300',
        badge: 'bg-rose-900 border-rose-700 text-rose-200',
      };
    case 'neutral':
    default:
      return {
        border: 'border-amber-500',
        bg: 'bg-amber-950/40',
        text: 'text-amber-300',
        badge: 'bg-amber-900 border-amber-700 text-amber-200',
      };
  }
}

export function InitiativeRibbon({
  round,
  phase,
  initiativeOrder,
  combatants,
  activeCombatantId,
  selectedCombatantId,
  onSelectCombatant,
  className = '',
}: InitiativeRibbonProps) {
  return (
    <div
      data-testid="initiative-ribbon"
      className={`flex items-center gap-2 px-3 py-2 bg-slate-900/90 border border-slate-800 rounded-lg shadow-md backdrop-blur-sm overflow-x-auto select-none ${className}`}
    >
      {/* Round & Phase Indicator */}
      <div
        data-testid="initiative-round-badge"
        className="flex flex-col items-center justify-center px-2.5 py-1 bg-slate-950 border border-amber-600/60 rounded text-center shrink-0 min-w-[68px]"
      >
        <span className="text-[10px] uppercase font-bold tracking-wider text-amber-400">
          Round
        </span>
        <span className="text-base font-extrabold text-amber-300 leading-tight">
          {round}
        </span>
        {phase && (
          <span className="text-[9px] text-slate-400 capitalize">
            {phase.replace(/_/g, ' ')}
          </span>
        )}
      </div>

      <div className="h-8 w-px bg-slate-800 shrink-0" />

      {/* Combatant Ribbon */}
      <div className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-thin">
        {initiativeOrder.map((entry, index) => {
          const combatant = combatants[entry.entityId];
          const isActive = entry.entityId === activeCombatantId;
          const isSelected = entry.entityId === selectedCombatantId;

          if (!entry.isVisible || !combatant) {
            return (
              <div
                key={entry.entityId || index}
                data-testid={`initiative-card-hidden-${index}`}
                className="flex items-center gap-1.5 px-2 py-1 rounded border border-dashed border-slate-700 bg-slate-950/60 text-slate-500 text-xs shrink-0 opacity-70"
                title="Unrevealed combatant"
              >
                <span>❓</span>
                <span className="italic">Unknown</span>
                <span className="text-[10px] font-mono">#{entry.initiative}</span>
              </div>
            );
          }

          const colors = getSideColorClasses(combatant.side);
          const hpPercent =
            combatant.maxHp > 0
              ? Math.max(0, Math.min(100, (combatant.currentHp / combatant.maxHp) * 100))
              : 0;

          return (
            <div
              key={combatant.id}
              role="button"
              tabIndex={0}
              data-testid={`initiative-card-${combatant.id}`}
              data-active={isActive}
              data-selected={isSelected}
              onClick={() => onSelectCombatant?.(combatant.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectCombatant?.(combatant.id);
                }
              }}
              className={`group relative flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer shrink-0 ${
                colors.bg
              } ${
                isActive
                  ? 'border-amber-400 ring-2 ring-amber-400/80 shadow-[0_0_12px_rgba(251,191,36,0.4)] scale-[1.03] z-10'
                  : isSelected
                    ? 'border-white ring-1 ring-white/60'
                    : `${colors.border} hover:border-slate-400`
              }`}
            >
              {/* Active Indicator Pin */}
              {isActive && (
                <span
                  data-testid="initiative-active-badge"
                  className="absolute -top-2 left-1/2 -translate-x-1/2 px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-950 text-[9px] font-black uppercase tracking-wider shadow"
                >
                  Turn
                </span>
              )}

              {/* Side Avatar / Initial */}
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs uppercase border ${colors.badge}`}
              >
                {combatant.name.charAt(0)}
              </div>

              {/* Name & Initiative Score */}
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-xs font-semibold truncate max-w-[100px] ${
                      combatant.isDead
                        ? 'line-through text-slate-500'
                        : isActive
                          ? 'text-amber-200'
                          : 'text-slate-200'
                    }`}
                  >
                    {combatant.name}
                  </span>
                  <span className="text-[10px] font-mono font-bold text-slate-400">
                    {entry.initiative}
                  </span>
                </div>

                {/* HP Micro-Bar */}
                <div className="w-full h-1 bg-slate-950/80 rounded-full overflow-hidden mt-0.5 border border-slate-800">
                  <div
                    className={`h-full transition-all duration-300 ${
                      combatant.isDead
                        ? 'bg-slate-700'
                        : hpPercent > 50
                          ? 'bg-emerald-400'
                          : hpPercent > 25
                            ? 'bg-amber-400'
                            : 'bg-rose-500'
                    }`}
                    style={{ width: `${hpPercent}%` }}
                  />
                </div>
              </div>

              {/* Dead or Conditions Mini-Badges */}
              {combatant.isDead ? (
                <span
                  data-testid="initiative-dead-icon"
                  className="text-xs text-rose-400"
                  title="Dead"
                >
                  💀
                </span>
              ) : combatant.currentHp === 0 ? (
                <span
                  data-testid="initiative-unconscious-icon"
                  className="text-[10px] px-1 py-0.2 rounded bg-rose-950 border border-rose-600 text-rose-300 font-bold"
                  title="Unconscious"
                >
                  0 HP
                </span>
              ) : combatant.conditions.length > 0 ? (
                <div
                  data-testid="initiative-conditions-list"
                  className="flex items-center gap-0.5"
                >
                  {combatant.conditions.slice(0, 2).map((c) => (
                    <span
                      key={c}
                      className="px-1 py-0.2 rounded bg-slate-800 border border-slate-700 text-[9px] font-bold text-amber-300 uppercase"
                      title={c}
                    >
                      {c.slice(0, 2)}
                    </span>
                  ))}
                  {combatant.conditions.length > 2 && (
                    <span className="text-[9px] text-slate-400 font-bold">
                      +{combatant.conditions.length - 2}
                    </span>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
