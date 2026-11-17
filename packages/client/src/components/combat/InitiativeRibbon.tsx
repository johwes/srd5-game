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
      className={`flex items-center gap-2 select-none ${className}`}
    >
      {/* Round & Phase Indicator */}
      <div
        data-testid="initiative-round-badge"
        className="flex flex-col items-center justify-center px-2 py-0.5 bg-slate-950/90 border border-amber-600/50 rounded-lg text-center shrink-0 min-w-[56px]"
      >
        <span className="text-[9px] uppercase font-bold tracking-wider text-amber-400 leading-none">
          Round
        </span>
        <span className="text-base font-extrabold text-amber-300 leading-tight">
          {round}
        </span>
        {phase && (
          <span className="text-[8px] text-slate-400 capitalize leading-none">
            {phase.replace(/_/g, ' ')}
          </span>
        )}
      </div>

      {/* Turn-order portrait strip (BG3 style) */}
      <div className="flex items-center gap-1.5 py-1.5 px-1 overflow-x-auto overflow-y-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {initiativeOrder.map((entry, index) => {
          const combatant = combatants[entry.entityId];
          const isActive = entry.entityId === activeCombatantId;
          const isSelected = entry.entityId === selectedCombatantId;

          if (!entry.isVisible || !combatant) {
            return (
              <div
                key={entry.entityId || index}
                data-testid={`initiative-card-hidden-${index}`}
                className="flex flex-col items-center justify-center w-10 h-10 rounded-full border border-dashed border-slate-700 bg-slate-950/70 text-slate-500 text-[10px] shrink-0 opacity-70"
                title="Unrevealed combatant"
              >
                <span>❓</span>
                <span className="font-mono leading-none">#{entry.initiative}</span>
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
              title={`${combatant.name} (initiative ${entry.initiative})`}
              className={`group relative flex flex-col items-center shrink-0 cursor-pointer transition-transform ${
                isActive ? 'scale-125 mx-1.5 z-10' : 'hover:scale-110'
              }`}
            >
              {/* Active Indicator Pin */}
              {isActive && (
                <span
                  data-testid="initiative-active-badge"
                  className="absolute -top-3 left-1/2 -translate-x-1/2 px-1.5 rounded-full bg-amber-400 text-slate-950 text-[8px] font-black uppercase tracking-wider shadow"
                >
                  Turn
                </span>
              )}

              {/* Portrait token */}
              <div
                className={`relative w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm uppercase border-2 ${colors.bg} ${
                  combatant.isDead ? 'opacity-40 grayscale' : ''
                } ${
                  isActive
                    ? 'border-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.6)]'
                    : isSelected
                      ? 'border-white'
                      : colors.border
                } ${colors.text}`}
              >
                {combatant.isDead ? '💀' : combatant.name.charAt(0)}
                {combatant.isSummon && (
                  <span
                    data-testid="initiative-summon-badge"
                    title={combatant.summonSourceName ?? 'Summoned creature'}
                    className="absolute -top-1 -left-1 px-1 rounded-full bg-violet-700 border border-violet-300 text-[8px] font-black text-violet-50 leading-4"
                  >
                    ✦S
                  </span>
                )}
                <span className="absolute -bottom-1 -right-1 min-w-[16px] px-0.5 text-center rounded-full bg-slate-950 border border-slate-700 text-[9px] font-mono font-bold text-slate-300 leading-4">
                  {entry.initiative}
                </span>
              </div>

              {/* HP Micro-Bar */}
              <div className="w-9 h-1 bg-slate-950/80 rounded-full overflow-hidden mt-1 border border-slate-800">
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

              {combatant.isDead ? (
                <span data-testid="initiative-dead-icon" className="sr-only">
                  Dead
                </span>
              ) : combatant.currentHp === 0 ? (
                <span
                  data-testid="initiative-unconscious-icon"
                  className="absolute -top-1 -left-1 text-[8px] px-1 rounded bg-rose-950 border border-rose-600 text-rose-300 font-bold"
                  title="Unconscious"
                >
                  0
                </span>
              ) : combatant.conditions.length > 0 ? (
                <div
                  data-testid="initiative-conditions-list"
                  className="absolute -top-1 -left-1 flex"
                >
                  {combatant.conditions.slice(0, 2).map((c) => (
                    <span
                      key={c}
                      className="px-0.5 rounded bg-slate-800 border border-slate-700 text-[8px] font-bold text-amber-300 uppercase"
                      title={c}
                    >
                      {c.slice(0, 2)}
                    </span>
                  ))}
                </div>
              ) : null}

              {/* Name tooltip */}
              <span className="pointer-events-none absolute top-full mt-1 px-1.5 py-0.5 rounded bg-slate-950/95 border border-slate-700 text-[10px] text-slate-200 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-30">
                {combatant.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
