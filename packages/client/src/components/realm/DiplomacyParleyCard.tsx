import React, { useState } from 'react';
import type { DiplomacyApproach, DiplomacyEncounterKind } from '@srd5/engine';

export interface DiplomacyOddsRow {
  approach: DiplomacyApproach;
  bonus: number;
  dc: number;
}

export interface DiplomacyParleyResult {
  outcome: string;
  success: boolean;
  headline: string;
}

interface DiplomacyParleyCardProps {
  encounterKind: DiplomacyEncounterKind;
  counterparty: string;
  /** Best live party History bonus + the unlock DC. */
  historyBonus: number;
  historyDc: number;
  historyUnlocked?: boolean;
  /** Best live party Insight passive vs the speaker's Deception total. */
  insightPassive: number;
  speakerDeceptionTotal: number;
  cue?: string;
  rows: DiplomacyOddsRow[];
  onResolve: (approach: DiplomacyApproach) => void;
  lastResult?: DiplomacyParleyResult | null;
  disabled?: boolean;
}

const APPROACH_LABEL: Record<DiplomacyApproach, string> = {
  persuasion: 'Persuade',
  deception: 'Deceive',
  intimidation: 'Intimidate',
};

const APPROACH_ICON: Record<DiplomacyApproach, string> = {
  persuasion: '🤝',
  deception: '🎭',
  intimidation: '😠',
};

const APPROACH_HINT: Record<DiplomacyApproach, string> = {
  persuasion: 'Alliance + fair terms',
  deception: 'Wins today, fallout later',
  intimidation: 'Compliance + attitude cost',
};

/**
 * SRD-1209 Diplomacy parley card (Spec 11 §5).
 *
 * Presentational + callback-driven so the War Room, tribe parley, and envoy
 * views can all commit the same `resolveDiplomaticParley` template. Stage
 * hints (History unlock, Insight read, triple-approach odds) come from props
 * so tooltips never drift from the engine template; failure always degrades
 * the deal — the card renders degraded/backlash as progress, never a block.
 */
export function DiplomacyParleyCard({
  encounterKind,
  counterparty,
  historyBonus,
  historyDc,
  historyUnlocked,
  insightPassive,
  speakerDeceptionTotal,
  cue,
  rows,
  onResolve,
  lastResult,
  disabled,
}: DiplomacyParleyCardProps) {
  const [approach, setApproach] = useState<DiplomacyApproach>('persuasion');
  const passiveBeatsLie = insightPassive >= speakerDeceptionTotal;

  const commit = () => {
    if (disabled) return;
    onResolve(approach);
  };

  return (
    <div
      data-testid="diplomacy-parley-card"
      data-encounter={encounterKind}
      className="rounded-xl border border-sky-500/40 bg-slate-950/95 p-3 space-y-2.5"
      aria-label={`Diplomatic parley with ${counterparty}`}
    >
      <div className="text-xs font-bold text-sky-200">
        🕊️ Parley <span className="font-normal text-slate-400">· {counterparty}</span>
        <span className="ml-1 text-[10px] uppercase tracking-wider text-slate-500">{encounterKind}</span>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-2 text-[11px] text-slate-300 space-y-1">
        <div data-testid="diplomacy-history-row">
          📜 History {historyBonus >= 0 ? `+${historyBonus}` : historyBonus} vs DC {historyDc}
          {historyUnlocked !== undefined && (
            <span
              data-testid="diplomacy-history-badge"
              data-unlocked={historyUnlocked ? 'true' : 'false'}
              className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                historyUnlocked
                  ? 'bg-emerald-950/60 border-emerald-700/50 text-emerald-200'
                  : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}
            >
              {historyUnlocked ? '✓ Leverage (−2 DC, top tier)' : 'No leverage yet'}
            </span>
          )}
        </div>
        <div data-testid="diplomacy-insight-row">
          👁️ Insight passive {insightPassive} vs Deception {speakerDeceptionTotal}
          {passiveBeatsLie && (
            <span data-testid="diplomacy-cue" className="ml-1.5 italic text-amber-200">
              — {cue ?? 'something feels off'}
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-1.5" role="group" aria-label="Diplomatic approach">
        {rows.map((row) => (
          <button
            key={row.approach}
            type="button"
            data-testid={`diplomacy-approach-${row.approach}`}
            onClick={() => setApproach(row.approach)}
            aria-pressed={approach === row.approach}
            className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
              approach === row.approach
                ? 'bg-sky-500 text-slate-950'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <span aria-hidden>{APPROACH_ICON[row.approach]}</span> {APPROACH_LABEL[row.approach]}
            <span className="block font-mono font-normal text-[10px] opacity-80">
              {row.bonus >= 0 ? `+${row.bonus}` : row.bonus} vs DC {row.dc}
            </span>
            <span className="block font-normal text-[10px] opacity-70">{APPROACH_HINT[row.approach]}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        data-testid="diplomacy-commit"
        onClick={commit}
        disabled={disabled}
        className="w-full px-3 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-slate-950 font-bold text-xs transition-colors"
      >
        Press the {APPROACH_LABEL[approach].toLowerCase()} case
      </button>

      {lastResult && (
        <div
          data-testid="diplomacy-result"
          data-result={lastResult.success ? 'success' : 'degraded'}
          className={`rounded-lg border px-2.5 py-2 text-[11px] italic ${
            lastResult.success
              ? 'bg-emerald-950/60 border-emerald-700/50 text-emerald-200'
              : 'bg-amber-950/60 border-amber-700/50 text-amber-200'
          }`}
        >
          {lastResult.success ? '✅' : '📉'} {lastResult.headline}
        </div>
      )}
    </div>
  );
}
