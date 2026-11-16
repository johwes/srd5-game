import React from 'react';
import type { PlayerViewCombatant } from '@srd5/transport';

export interface CombatantMedallionProps {
  combatant: PlayerViewCombatant | null;
  turnBudget?: { action?: number; bonusAction?: number } | null;
  onOpenCharacterSheet?: (combatantId: string) => void;
  className?: string;
}

/**
 * BG3-style centered portrait medallion (reference: screenshots 076 / 085).
 * Circular portrait with HP bar, action/bonus pips, armor, buff dots and a
 * concentration marker — the anchor of the bottom dock.
 */
export function CombatantMedallion({
  combatant,
  turnBudget,
  onOpenCharacterSheet,
  className = '',
}: CombatantMedallionProps) {
  if (!combatant) {
    return (
      <div
        data-testid="combat-medallion-empty"
        className={`flex flex-col items-center justify-center gap-1 w-24 shrink-0 ${className}`}
      >
        <div className="w-14 h-14 rounded-full bg-slate-900 border-2 border-slate-800 flex items-center justify-center text-slate-600 text-xl">
          ?
        </div>
        <span className="text-xs text-slate-500 italic text-center">
          No combatant active
        </span>
      </div>
    );
  }

  const hpPct =
    combatant.maxHp > 0
      ? Math.max(0, Math.min(100, (combatant.currentHp / combatant.maxHp) * 100))
      : 0;
  const buffs = combatant.activeEffects ?? [];
  const concentrating = Boolean(combatant.concentratingOn);

  return (
    <div
      data-testid="combat-medallion"
      className={`relative flex flex-col items-center justify-center gap-1 w-24 shrink-0 select-none ${className}`}
    >
      {/* Buff dots row (above portrait, BG3 status-icon style) */}
      {buffs.length > 0 && (
        <div
          data-testid="medallion-buffs"
          className="flex items-center justify-center gap-0.5 max-w-full flex-wrap"
          title={buffs.map((b) => b.name).join(', ')}
        >
          {buffs.slice(0, 5).map((effect) => (
            <span
              key={effect.effectId}
              className="w-3.5 h-3.5 rounded-full bg-emerald-500/90 border border-emerald-300 text-[8px] leading-3 text-center text-slate-950 font-black"
              title={`${effect.name}${effect.remainingRounds !== undefined ? ` (${effect.remainingRounds} rounds left)` : ''}`}
            >
              ✦
            </span>
          ))}
          {buffs.length > 5 && (
            <span className="text-[8px] text-emerald-300 font-bold">+{buffs.length - 5}</span>
          )}
        </div>
      )}

      <button
        type="button"
        data-testid="medallion-portrait-btn"
        onClick={() => onOpenCharacterSheet?.(combatant.id)}
        title={`${combatant.name} — open character sheet`}
        className="relative w-14 h-14 rounded-full bg-amber-500/15 border-2 border-amber-400 flex items-center justify-center font-black text-amber-300 text-xl shadow-[0_0_14px_rgba(251,191,36,0.45)] hover:border-amber-300 transition-colors cursor-pointer"
      >
        {combatant.isDead ? '💀' : combatant.name.charAt(0)}
        {concentrating && (
          <span
            data-testid="medallion-concentration"
            title={`Concentrating${combatant.concentratingOn?.sourceName ? `: ${combatant.concentratingOn.sourceName}` : ''}`}
            className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-purple-600 border border-purple-300 text-[9px] leading-4 text-center text-white font-black"
          >
            ◉
          </span>
        )}
      </button>

      <span
        data-testid="hotbar-active-hero-name"
        className="text-xs font-bold text-amber-300 truncate max-w-full"
      >
        {combatant.name}
      </span>

      <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
        <div
          data-testid="medallion-hp-bar"
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
      <span
        data-testid="hotbar-active-hero-hp"
        className="text-[11px] font-semibold text-slate-200"
      >
        HP {combatant.currentHp}/{combatant.maxHp}
        {combatant.tempHp > 0 && (
          <span className="text-sky-300"> (+{combatant.tempHp})</span>
        )}
      </span>

      {/* Action economy pips */}
      {turnBudget && (
        <div className="flex items-center gap-1" title="Action economy">
          <span
            data-testid="medallion-action-pip"
            className={`w-2 h-2 rounded-full ${(turnBudget.action ?? 0) > 0 ? 'bg-emerald-400' : 'bg-slate-700'}`}
            title="Action"
          />
          <span
            data-testid="medallion-bonus-pip"
            className={`w-2 h-2 rounded-full ${(turnBudget.bonusAction ?? 0) > 0 ? 'bg-amber-400' : 'bg-slate-700'}`}
            title="Bonus action"
          />
        </div>
      )}

      <span className="text-[10px] text-slate-400">
        AC {combatant.armorClass} · {combatant.speedFeet}ft
      </span>
    </div>
  );
}
