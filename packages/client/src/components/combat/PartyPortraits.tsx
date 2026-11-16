import React from 'react';
import type { PlayerViewCombatant } from '@srd5/transport';
import type { PartyPortraitsProps } from './types.js';

export function PartyPortraits({
  party,
  activeCombatantId,
  selectedCombatantId,
  onSelectPartyMember,
  onOpenCharacterSheet,
  onLevelUpCharacter,
  collapsed = false,
  onToggleCollapse,
  className = '',
}: PartyPortraitsProps) {
  const partyList: PlayerViewCombatant[] = Array.isArray(party)
    ? party
    : Object.values(party);

  return (
    <aside
      data-testid="party-portraits"
      className={`flex flex-col gap-2 transition-all select-none ${
        collapsed
          ? 'w-[68px] p-1 bg-transparent'
          : 'w-64 sm:w-72 p-2 bg-slate-900/90 border border-slate-800 rounded-lg shadow-lg backdrop-blur-sm'
      } ${className}`}
    >
      {/* Header with Collapsible Toggle */}
      <div className={`flex items-center justify-between px-1 ${collapsed ? 'order-last justify-center' : 'pb-1 border-b border-slate-800'}`}>
        {!collapsed && (
          <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
            Party ({partyList.length})
          </span>
        )}
        {onToggleCollapse && (
          <button
            type="button"
            data-testid="party-portraits-toggle-collapse"
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand party panel' : 'Collapse party panel'}
            className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 text-xs transition-colors ml-auto"
          >
            {collapsed ? '▶' : '◀'}
          </button>
        )}
      </div>

      {/* Hero Cards List */}
      <div
        className={`flex flex-col gap-2 ${
          collapsed ? 'overflow-visible' : 'overflow-y-auto max-h-[calc(100vh-250px)] scrollbar-thin'
        }`}
      >
        {partyList.map((hero) => {
          const isActive = hero.id === activeCombatantId;
          const isSelected = hero.id === selectedCombatantId;
          const sheet = hero.characterSheet;

          const hpPercent =
            hero.maxHp > 0
              ? Math.max(0, Math.min(100, (hero.currentHp / hero.maxHp) * 100))
              : 0;

          const classSummary =
            sheet?.classes?.map((c) => `${c.className} ${c.level}`).join(' / ') ??
            'Hero';

          if (collapsed) {
            return (
              <div
                key={hero.id}
                role="button"
                tabIndex={0}
                data-testid={`party-card-collapsed-${hero.id}`}
                onClick={() => onSelectPartyMember?.(hero.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectPartyMember?.(hero.id);
                  }
                }}
                className={`group relative flex flex-col items-center justify-center p-1.5 rounded-xl border transition-all cursor-pointer ${
                  isActive
                    ? 'border-amber-400 bg-amber-950/40 ring-2 ring-amber-400/90 shadow-[0_0_14px_rgba(251,191,36,0.5)]'
                    : isSelected
                      ? 'border-white bg-slate-800/80 ring-2 ring-white/70'
                      : 'border-slate-800/80 bg-slate-950/80 hover:border-slate-600'
                }`}
                title={`${hero.name} (HP: ${hero.currentHp}/${hero.maxHp})`}
              >
                {/* Portrait Circle Token */}
                <div className="relative">
                  <div
                    className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center font-bold text-xs shadow-inner ${
                      isActive
                        ? 'bg-amber-900/60 text-amber-200 border-2 border-amber-400'
                        : isSelected
                          ? 'bg-sky-950 text-sky-200 border-2 border-sky-400'
                          : 'bg-slate-900 text-slate-200 border border-slate-700'
                    }`}
                  >
                    {hero.name.charAt(0)}
                  </div>

                  {/* Reaction Pip */}
                  {hero.reactionAvailable !== false && (
                    <div
                      className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-sky-400 border border-slate-950 shadow"
                      title="Reaction Ready"
                    />
                  )}

                  {/* Level Up Beacon */}
                  {hero.levelUpAvailable && (
                    <div
                      className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 text-slate-950 font-black text-[9px] flex items-center justify-center animate-bounce shadow"
                      title="Level Up Available!"
                    >
                      ⇧
                    </div>
                  )}
                </div>

                {/* Mini HP Meter */}
                <div className="w-full h-1.5 bg-slate-900 rounded-full mt-1.5 overflow-hidden border border-slate-800/80">
                  <div
                    className={`h-full transition-all duration-300 ${
                      hero.isDead
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

                {/* Floating BG3 Tooltip Card on Hover */}
                <div className="absolute left-full top-0 ml-2.5 w-60 p-3 bg-slate-950/95 border border-slate-700/80 rounded-xl shadow-2xl backdrop-blur-md opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity z-50 text-left flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-1 border-b border-slate-800 pb-1.5">
                    <div>
                      <div className="font-bold text-slate-100 text-xs truncate">
                        {hero.name}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {classSummary}
                      </div>
                    </div>
                    {isActive && (
                      <span className="px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-950 text-[9px] font-black uppercase tracking-wider">
                        Active
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-semibold text-[11px]">HP:</span>
                    <span
                      className={`font-mono font-bold ${
                        hpPercent > 50
                          ? 'text-emerald-300'
                          : hpPercent > 25
                            ? 'text-amber-300'
                            : 'text-rose-400'
                      }`}
                    >
                      {hero.currentHp}/{hero.maxHp}
                      {hero.tempHp > 0 && ` (+${hero.tempHp})`}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-300 border-t border-slate-800/80 pt-1">
                    <span>🛡️ AC {hero.armorClass}</span>
                    <span>👟 {hero.speedFeet}ft</span>
                    <span className={hero.reactionAvailable !== false ? 'text-sky-300' : 'text-slate-500 line-through'}>
                      {hero.reactionAvailable !== false ? '🔵 React' : '⚪ React'}
                    </span>
                  </div>

                  {(hero.conditions.length > 0 || (hero.activeEffects?.length ?? 0) > 0) && (
                    <div className="flex flex-wrap items-center gap-1 pt-0.5">
                      {hero.conditions.map((condition) => (
                        <span
                          key={condition}
                          className="px-1 py-0.2 rounded bg-amber-950 border border-amber-600 text-amber-200 font-bold text-[9px] uppercase"
                        >
                          {condition}
                        </span>
                      ))}
                      {(hero.activeEffects ?? []).map((effect) => (
                        <span
                          key={effect.effectId}
                          className="px-1 py-0.2 rounded bg-emerald-950 border border-emerald-600 text-emerald-200 font-bold text-[9px]"
                          title={`${effect.name}${effect.remainingRounds !== undefined ? ` (${effect.remainingRounds} rounds left)` : ''}`}
                        >
                          ✨ {effect.name}
                        </span>
                      ))}
                    </div>
                  )}

                  {onOpenCharacterSheet && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenCharacterSheet(hero.id);
                      }}
                      className="mt-1 w-full py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-amber-300 hover:text-amber-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <span>📜</span>
                      <span>Inspect Sheet (C / I)</span>
                    </button>
                  )}
                </div>
              </div>
            );
          }

          return (
            <div
              key={hero.id}
              role="button"
              tabIndex={0}
              data-testid={`party-card-${hero.id}`}
              data-active={isActive}
              data-selected={isSelected}
              onClick={() => onSelectPartyMember?.(hero.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectPartyMember?.(hero.id);
                }
              }}
              className={`relative flex flex-col gap-1.5 p-2.5 rounded-lg border transition-all cursor-pointer ${
                isActive
                  ? 'border-amber-400 bg-amber-950/30 ring-2 ring-amber-400/80 shadow-[0_0_12px_rgba(251,191,36,0.3)]'
                  : isSelected
                    ? 'border-white bg-slate-800/80 ring-1 ring-white/60'
                    : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
              }`}
            >
              {/* Active Indicator Top Tag */}
              {isActive && (
                <div
                  data-testid={`party-card-active-tag-${hero.id}`}
                  className="absolute -top-2 right-3 px-2 py-0.2 rounded-full bg-amber-400 text-slate-950 text-[9px] font-black uppercase tracking-wider shadow"
                >
                  Active Turn
                </div>
              )}

              {/* Top Row: Avatar, Name, Class, Sheet Button */}
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full bg-sky-900/90 border-2 border-sky-500 flex items-center justify-center font-bold text-sky-200 text-sm shrink-0 shadow">
                  {hero.name.charAt(0)}
                </div>

                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs font-bold text-slate-100 truncate">
                    {hero.name}
                  </span>
                  <span className="text-[11px] text-slate-400 truncate">
                    {classSummary}
                  </span>
                </div>

                {hero.levelUpAvailable && onLevelUpCharacter && (
                  <button
                    type="button"
                    data-testid={`party-card-level-up-btn-${hero.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onLevelUpCharacter(hero.id);
                    }}
                    title="Level Up Available!"
                    className="px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/30 font-bold text-[10px] animate-pulse shrink-0"
                  >
                    ⇧ Lvl Up
                  </button>
                )}

                {onOpenCharacterSheet && (
                  <button
                    type="button"
                    data-testid={`party-card-sheet-btn-${hero.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenCharacterSheet(hero.id);
                    }}
                    title="Open Character Sheet (Hotkey: C or I)"
                    className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-amber-400 transition-colors shrink-0 text-xs"
                  >
                    📜
                  </button>
                )}
              </div>

              {/* HP Bar and Numerical Stats */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1 font-semibold">
                    <span className="text-slate-400 text-[11px]">HP</span>
                    <span
                      data-testid={`party-card-hp-${hero.id}`}
                      className={`${
                        hero.isDead
                          ? 'text-slate-500 line-through'
                          : hpPercent > 50
                            ? 'text-emerald-300'
                            : hpPercent > 25
                              ? 'text-amber-300'
                              : 'text-rose-400 font-bold'
                      }`}
                    >
                      {hero.currentHp} / {hero.maxHp}
                    </span>
                    {hero.tempHp > 0 && (
                      <span
                        data-testid={`party-card-thp-${hero.id}`}
                        className="px-1 py-0.2 rounded bg-sky-950 border border-sky-500 text-sky-300 text-[10px] font-bold"
                      >
                        +{hero.tempHp}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-[11px] text-slate-300">
                    <span
                      data-testid={`party-card-ac-${hero.id}`}
                      className="flex items-center gap-0.5 font-semibold"
                      title="Armor Class"
                    >
                      🛡️ {hero.armorClass}
                    </span>
                    <span
                      data-testid={`party-card-speed-${hero.id}`}
                      className="flex items-center gap-0.5"
                      title="Speed"
                    >
                      👟 {hero.speedFeet}ft
                    </span>
                  </div>
                </div>

                {/* HP Progress Bar */}
                <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className={`h-full transition-all duration-300 ${
                      hero.isDead
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

              {/* Bottom Row: Reaction status, Death Saves, or Conditions */}
              <div className="flex flex-wrap items-center justify-between gap-1 pt-0.5 text-[10px]">
                <div className="flex items-center gap-1">
                  <span
                    data-testid={`party-card-reaction-${hero.id}`}
                    className={`px-1.5 py-0.5 rounded border text-[10px] font-medium flex items-center gap-1 ${
                      hero.reactionAvailable !== false
                        ? 'bg-sky-950/60 border-sky-700 text-sky-300'
                        : 'bg-slate-900 border-slate-800 text-slate-500 line-through'
                    }`}
                    title={
                      hero.reactionAvailable !== false
                        ? 'Reaction Available'
                        : 'Reaction Spent'
                    }
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        hero.reactionAvailable !== false
                          ? 'bg-sky-400'
                          : 'bg-slate-600'
                      }`}
                    />
                    React
                  </span>
                </div>

                {/* Death Saves Indicator if at 0 HP */}
                {hero.currentHp === 0 && !hero.isDead && sheet?.deathSaves && (
                  <div
                    data-testid={`party-card-death-saves-${hero.id}`}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-950/80 border border-rose-700 text-rose-300 text-[10px]"
                    title={`Death Saves: ${sheet.deathSaves.successes} Successes, ${sheet.deathSaves.failures} Failures`}
                  >
                    <span>💀</span>
                    <span className="text-emerald-400 font-bold">
                      {sheet.deathSaves.successes}S
                    </span>
                    <span>/</span>
                    <span className="text-rose-400 font-bold">
                      {sheet.deathSaves.failures}F
                    </span>
                  </div>
                )}

                {/* Condition Badges */}
                {hero.conditions.length > 0 && (
                  <div
                    data-testid={`party-card-conditions-${hero.id}`}
                    className="flex flex-wrap items-center gap-1 ml-auto"
                  >
                    {hero.conditions.map((condition) => (
                      <span
                        key={condition}
                        className="px-1.5 py-0.2 rounded bg-amber-950 border border-amber-600 text-amber-200 font-bold text-[9px] uppercase"
                        title={condition}
                      >
                        {condition}
                      </span>
                    ))}
                  </div>
                )}

                {/* Active Buff / Debuff Badges (Bless, Haste, Rage, Shield, ...) */}
                {(hero.activeEffects?.length ?? 0) > 0 && (
                  <div
                    data-testid={`party-card-buffs-${hero.id}`}
                    className="flex flex-wrap items-center gap-1 w-full pt-0.5"
                  >
                    {hero.activeEffects!.slice(0, 4).map((effect) => (
                      <span
                        key={effect.effectId}
                        className="px-1.5 py-0.2 rounded bg-emerald-950 border border-emerald-600 text-emerald-200 font-bold text-[9px] uppercase"
                        title={`${effect.name}${effect.remainingRounds !== undefined ? ` (${effect.remainingRounds} rounds left)` : ''}${effect.requiresConcentration ? ' [Concentration]' : ''}`}
                      >
                        ✨ {effect.name}
                        {effect.remainingRounds !== undefined
                          ? ` (${effect.remainingRounds})`
                          : ''}
                      </span>
                    ))}
                    {hero.activeEffects!.length > 4 && (
                      <span
                        className="px-1.5 py-0.2 rounded bg-slate-800 border border-slate-700 text-slate-300 font-bold text-[9px]"
                        title={hero.activeEffects!.slice(4).map((e) => e.name).join(', ')}
                      >
                        +{hero.activeEffects!.length - 4} more
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
