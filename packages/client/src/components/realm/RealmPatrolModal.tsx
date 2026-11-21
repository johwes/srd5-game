import React from 'react';
import {
  PATROL_BLUFF_DC,
  PATROL_BRIBE_COST_GOLD,
  PATROL_EVADE_DC,
  type WarPatrolApproach,
} from '@srd5/engine';

/**
 * Enemy-territory patrol encounter dialogue (SRD-1106, Spec 10 §7).
 *
 * Four options — Bluff (Persuasion/Deception or Disguise Self), Slip Off the
 * Road (Stealth/Survival), Bribe (50 gp, +5 Threat), Fight (tactical battle,
 * +20 Threat on the kill) — with live skill odds and post-resolution d20
 * feedback. Presentational: the host owns `reduceRealm` dispatch.
 */

export interface PatrolApproachPreview {
  approach: WarPatrolApproach;
  bonus: number;
  actorName: string;
  dc: number | null;
  odds: number | null;
  note: string;
}

export interface RealmPatrolModalProps {
  isOpen: boolean;
  nationId: string;
  nationName: string;
  threat: number;
  threatTier: string;
  gold: number;
  previews: PatrolApproachPreview[];
  /** Post-resolution headline + optional roll line (host-computed). */
  result: { headline: string; rollLine: string | null } | null;
  /** SRD-1214: war-tongue note rendered under the threat line (odds rows). */
  languageNote?: string | null;
  onChooseApproach: (approach: WarPatrolApproach) => void;
  onClose: () => void;
}

export const PATROL_APPROACH_LABELS: Record<WarPatrolApproach, string> = {
  bluff: '🗣️ Bluff as Traveling Band',
  evade: '🌲 Slip Off the Road',
  bribe: '💰 Bribe the Captain',
  fight: '⚔️ Engage the Patrol',
};

export function buildPatrolPreviews(args: {
  bluffBonus: number;
  bluffActor: string;
  evadeBonus: number;
  evadeActor: string;
  gold: number;
}): PatrolApproachPreview[] {
  const bluffOdds = Math.min(0.95, Math.max(0.05, (21 - Math.max(2, Math.min(20, PATROL_BLUFF_DC - args.bluffBonus))) / 20));
  const evadeOdds = Math.min(0.95, Math.max(0.05, (21 - Math.max(2, Math.min(20, PATROL_EVADE_DC - args.evadeBonus))) / 20));
  return [
    {
      approach: 'bluff',
      bonus: args.bluffBonus,
      actorName: args.bluffActor,
      dc: PATROL_BLUFF_DC,
      odds: bluffOdds,
      note: `Persuasion/Deception DC ${PATROL_BLUFF_DC} (+0 Threat) · Disguise Self auto-passes`,
    },
    {
      approach: 'evade',
      bonus: args.evadeBonus,
      actorName: args.evadeActor,
      dc: PATROL_EVADE_DC,
      odds: evadeOdds,
      note: `Stealth/Survival DC ${PATROL_EVADE_DC} (+0 Threat)`,
    },
    {
      approach: 'bribe',
      bonus: 0,
      actorName: '',
      dc: null,
      odds: null,
      note:
        args.gold >= PATROL_BRIBE_COST_GOLD
          ? `${PATROL_BRIBE_COST_GOLD} gp (+5 Threat)`
          : `Need ${PATROL_BRIBE_COST_GOLD} gp (war chest: ${args.gold} gp)`,
    },
    {
      approach: 'fight',
      bonus: 0,
      actorName: '',
      dc: null,
      odds: null,
      note: 'Tactical battle · +20 Threat on the kill (pursuit at 55+)',
    },
  ];
}

export function RealmPatrolModal({
  isOpen,
  nationId,
  nationName,
  threat,
  threatTier,
  gold,
  previews,
  result,
  languageNote,
  onChooseApproach,
  onClose,
}: RealmPatrolModalProps) {
  if (!isOpen) return null;
  void nationId;
  void gold;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="realm-patrol-title"
      data-testid="realm-patrol-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-xl border border-red-800/60 bg-slate-900 shadow-2xl p-6 text-slate-100 space-y-4">
        <header className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h2 id="realm-patrol-title" className="text-xl font-bold text-red-400">
              🚨 {nationName} Patrol
            </h2>
            <p
              data-testid="realm-patrol-threat-line"
              className="text-xs text-slate-400 mt-1"
            >
              Threat {threat} ({threatTier}) — bluff, evade, bribe, or fight.
            </p>
            {languageNote && (
              <p
                data-testid="realm-patrol-language-note"
                className="text-[11px] text-violet-300 mt-1"
              >
                {languageNote}
              </p>
            )}
          </div>
          <button
            type="button"
            data-testid="realm-patrol-close-btn"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md text-lg"
          >
            ✕
          </button>
        </header>

        {result ? (
          <div data-testid="realm-patrol-result" className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 space-y-1.5">
            <p data-testid="realm-patrol-headline" className="text-sm font-bold text-slate-100">
              {result.headline}
            </p>
            {result.rollLine && (
              <p data-testid="realm-patrol-roll" className="text-xs text-slate-300 font-mono">
                {result.rollLine}
              </p>
            )}
          </div>
        ) : (
          <ul data-testid="realm-patrol-options" className="space-y-2">
            {previews.map((preview) => (
              <li key={preview.approach}>
                <button
                  type="button"
                  data-testid={`realm-patrol-option-${preview.approach}`}
                  onClick={() => onChooseApproach(preview.approach)}
                  className="w-full text-left rounded-lg border border-slate-700 bg-slate-950/60 hover:border-red-500/70 p-3 space-y-1 transition-colors min-h-[44px]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-slate-100">
                      {PATROL_APPROACH_LABELS[preview.approach]}
                    </span>
                    {preview.odds !== null && (
                      <span
                        data-testid={`realm-patrol-odds-${preview.approach}`}
                        className="text-[11px] font-mono text-sky-300 shrink-0"
                      >
                        {Math.round(preview.odds * 100)}%
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {preview.note}
                    {preview.dc !== null
                      ? ` · ${preview.actorName} ${preview.bonus >= 0 ? '+' : ''}${preview.bonus}`
                      : ''}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
