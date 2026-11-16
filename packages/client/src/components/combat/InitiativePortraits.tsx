import React from 'react';
import type { PlayerViewCombatant, PlayerViewInitiativeEntry } from '@srd5/transport';

export interface InitiativePortraitsProps {
  initiativeOrder: PlayerViewInitiativeEntry[];
  combatants: Record<string, PlayerViewCombatant>;
  activeCombatantId: string | null;
  selectedCombatantId?: string | null;
  round?: number;
  onSelectCombatant?: (combatantId: string) => void;
  className?: string;
}

function hpPercentOf(combatant: PlayerViewCombatant): number {
  if (combatant.maxHp <= 0) return 0;
  return Math.max(0, Math.min(100, (combatant.currentHp / combatant.maxHp) * 100));
}

function PortraitCard({
  combatant,
  initiative,
  dimmed,
  isActive,
  isSelected,
  onSelectCombatant,
  testPrefix,
}: {
  combatant: PlayerViewCombatant;
  initiative: number;
  dimmed?: boolean;
  isActive: boolean;
  isSelected: boolean;
  onSelectCombatant?: (combatantId: string) => void;
  testPrefix: string;
}) {
  const hpPct = hpPercentOf(combatant);
  const hpText = `${combatant.currentHp}/${combatant.maxHp}`;
  const dead = combatant.isDead;

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`${testPrefix}-${combatant.id}`}
      data-active={isActive}
      data-selected={isSelected}
      onClick={() => onSelectCombatant?.(combatant.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectCombatant?.(combatant.id);
        }
      }}
      title={`${combatant.name} — HP ${hpText}${combatant.conditions.length > 0 ? ` — ${combatant.conditions.join(', ')}` : ''}`}
      className={`relative flex flex-col items-center w-12 shrink-0 cursor-pointer transition-transform ${
        isActive ? 'scale-115 z-10' : 'hover:scale-110'
      } ${dead ? 'opacity-50 grayscale' : ''} ${dimmed ? 'opacity-80' : ''}`}
    >
      {isActive && (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-1 rounded-full bg-amber-400 text-slate-950 text-[8px] font-black uppercase tracking-wider shadow z-10">
          Turn
        </span>
      )}
      <div
        className={`relative w-10 h-10 rounded-md overflow-hidden flex items-center justify-center font-bold text-sm border-2 ${
          dead
            ? 'bg-slate-950 border-slate-700 text-slate-500'
            : isActive
              ? 'bg-slate-800 border-amber-400 text-amber-200 shadow-[0_0_12px_rgba(251,191,36,0.6)]'
              : isSelected
                ? 'bg-slate-800 border-white text-slate-100'
                : dimmed
                  ? 'bg-rose-950/70 border-rose-800 text-rose-300'
                  : 'bg-sky-950/70 border-sky-700 text-sky-200'
        }`}
      >
        {dead ? '💀' : combatant.name.charAt(0)}
        <span className="absolute bottom-0 inset-x-0 text-center text-[8px] font-mono font-bold leading-tight bg-slate-950/85 text-slate-200">
          {hpText}
        </span>
      </div>
      <div className="w-10 h-1 bg-slate-950/80 rounded-full overflow-hidden mt-0.5 border border-slate-800">
        <div
          className={`h-full transition-all duration-300 ${
            dead
              ? 'bg-slate-700'
              : hpPct > 50
                ? 'bg-emerald-400'
                : hpPct > 25
                  ? 'bg-amber-400'
                  : 'bg-rose-500'
          }`}
          style={{ width: `${hpPct}%` }}
        />
      </div>
      <span className="text-[8px] font-mono text-slate-400 leading-tight">#{initiative}</span>
    </div>
  );
}

/**
 * BG3-style initiative portrait columns (reference: screenshots 076 / 085).
 * Enemies run along the top row, allies along the bottom row, each card
 * showing HP text plus a micro HP bar so party/enemy status is glanceable
 * without opening any panel.
 */
export function InitiativePortraits({
  initiativeOrder,
  combatants,
  activeCombatantId,
  selectedCombatantId,
  round,
  onSelectCombatant,
  className = '',
}: InitiativePortraitsProps) {
  const visibleEntries = initiativeOrder.filter(
    (entry) => entry.isVisible && combatants[entry.entityId],
  );
  const enemies = visibleEntries.filter(
    (entry) => combatants[entry.entityId]?.side === 'monster',
  );
  const allies = visibleEntries.filter(
    (entry) => combatants[entry.entityId]?.side !== 'monster',
  );

  const renderRow = (
    entries: PlayerViewInitiativeEntry[],
    dimmed: boolean,
    testPrefix: string,
  ) => (
    <div className="flex items-start gap-1">
      {entries.map((entry) => {
        const combatant = combatants[entry.entityId]!;
        return (
          <PortraitCard
            key={combatant.id}
            combatant={combatant}
            initiative={entry.initiative}
            dimmed={dimmed}
            isActive={entry.entityId === activeCombatantId}
            isSelected={entry.entityId === selectedCombatantId}
            onSelectCombatant={onSelectCombatant}
            testPrefix={testPrefix}
          />
        );
      })}
    </div>
  );

  return (
    <div
      data-testid="initiative-portraits"
      className={`flex flex-col gap-1.5 p-1.5 rounded-xl bg-slate-950/85 border border-slate-800/80 backdrop-blur-md shadow-lg select-none max-w-[46vw] ${className}`}
    >
      {typeof round === 'number' && (
        <div
          data-testid="initiative-portraits-round"
          className="px-1 text-[9px] font-black uppercase tracking-wider text-amber-400"
        >
          Round {round}
        </div>
      )}
      {enemies.length > 0 && (
        <div data-testid="initiative-portraits-enemies" className="overflow-x-auto">
          {renderRow(enemies, true, 'initiative-foe-card')}
        </div>
      )}
      {allies.length > 0 && (
        <div data-testid="initiative-portraits-allies" className="overflow-x-auto">
          {renderRow(allies, false, 'initiative-ally-card')}
        </div>
      )}
      {visibleEntries.length === 0 && (
        <span className="text-[10px] text-slate-500 italic px-1">No combatants revealed</span>
      )}
    </div>
  );
}

export interface SelectedEnemyCardProps {
  combatant: PlayerViewCombatant | null;
  onClose?: () => void;
  onOpenCharacterSheet?: (combatantId: string) => void;
  className?: string;
}

/**
 * BG3-style floating enemy info card (reference: screenshot 076 "Klaw" card).
 * Shows the selected hostile's name, level/CR, HP bar with numbers, armor,
 * conditions and active buffs at a glance.
 */
export function SelectedEnemyCard({
  combatant,
  onClose,
  onOpenCharacterSheet,
  className = '',
}: SelectedEnemyCardProps) {
  if (!combatant) return null;

  const hpPct = hpPercentOf(combatant);
  const levelLabel =
    combatant.characterSheet != null
      ? `Level ${(combatant.characterSheet as { totalLevel?: number }).totalLevel ?? 1}`
      : combatant.challengeRating !== undefined
        ? `CR ${combatant.challengeRating}`
        : combatant.side === 'monster'
          ? 'Monster'
          : 'Ally';

  return (
    <div
      data-testid="selected-enemy-card"
      className={`pointer-events-auto w-64 p-3 bg-slate-950/92 border border-rose-700/50 rounded-xl shadow-2xl backdrop-blur-md text-left ${className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div
            data-testid="selected-enemy-name"
            className="font-bold text-slate-100 text-sm truncate"
          >
            {combatant.name}
          </div>
          <div className="text-[10px] text-slate-400">
            {levelLabel}
            {combatant.monsterType ? ` · ${combatant.monsterType}` : ''}
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            data-testid="selected-enemy-close-btn"
            onClick={onClose}
            aria-label="Clear selection"
            className="p-0.5 rounded text-slate-500 hover:text-white text-xs shrink-0"
          >
            ✕
          </button>
        )}
      </div>

      <div className="mt-1.5 h-2.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
        <div
          data-testid="selected-enemy-hp-bar"
          className={`h-full transition-all duration-300 ${
            combatant.isDead
              ? 'bg-slate-700'
              : hpPct > 50
                ? 'bg-emerald-400'
                : hpPct > 25
                  ? 'bg-amber-400'
                  : 'bg-rose-500'
          }`}
          style={{ width: `${hpPct}%` }}
        />
      </div>
      <div className="mt-0.5 flex items-center justify-between text-[11px]">
        <span data-testid="selected-enemy-hp-text" className="font-mono font-bold text-rose-300">
          {combatant.currentHp}/{combatant.maxHp}
        </span>
        <span className="text-slate-400">
          🛡️ <span className="font-semibold text-slate-200">{combatant.armorClass}</span>
          {combatant.tempHp > 0 && (
            <span className="ml-1 text-sky-300 font-semibold">+{combatant.tempHp} tmp</span>
          )}
        </span>
      </div>

      {(combatant.conditions.length > 0 || (combatant.activeEffects?.length ?? 0) > 0) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {combatant.conditions.map((condition) => (
            <span
              key={condition}
              className="px-1.5 py-0.2 rounded bg-amber-950 border border-amber-600 text-amber-200 font-bold text-[10px] uppercase"
            >
              {condition}
            </span>
          ))}
          {(combatant.activeEffects ?? []).map((effect) => (
            <span
              key={effect.effectId}
              className="px-1.5 py-0.2 rounded bg-emerald-950 border border-emerald-600 text-emerald-200 font-bold text-[10px]"
              title={
                effect.remainingRounds !== undefined
                  ? `${effect.name} (${effect.remainingRounds} rounds left)`
                  : effect.name
              }
            >
              ✨ {effect.name}
            </span>
          ))}
        </div>
      )}

      {combatant.side !== 'monster' && onOpenCharacterSheet && (
        <button
          type="button"
          data-testid="selected-ally-sheet-btn"
          onClick={() => onOpenCharacterSheet(combatant.id)}
          className="mt-2 w-full py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-amber-300 hover:text-amber-200 text-xs font-semibold transition-colors"
        >
          📜 Inspect Sheet
        </button>
      )}
    </div>
  );
}
