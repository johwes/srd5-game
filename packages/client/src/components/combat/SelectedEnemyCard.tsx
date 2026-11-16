import React from 'react';
import type { PlayerViewCombatant } from '@srd5/transport';

export interface SelectedEnemyCardProps {
  combatant: PlayerViewCombatant | null;
  onClose?: () => void;
  onOpenCharacterSheet?: (combatantId: string) => void;
  className?: string;
}

function hpPercentOf(combatant: PlayerViewCombatant): number {
  if (combatant.maxHp <= 0) return 0;
  return Math.max(0, Math.min(100, (combatant.currentHp / combatant.maxHp) * 100));
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
