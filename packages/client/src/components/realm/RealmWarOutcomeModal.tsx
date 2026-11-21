import React from 'react';
import type { CharacterBuildState } from '@srd5/data';
import type { VeteranRosterEntry, WarState } from '@srd5/engine';
import { VeteranRetirementOffer } from '../campaign/VeteranRetirementOffer.js';

/**
 * War campaign Victory / Defeat ending modal (SRD-1106, Spec 10 §1).
 *
 * Victory: the player's nation reaches `dominanceTarget` or all rivals
 * collapse to 0. Defeat: the player's nation collapses to 0 (or a rival
 * reaches dominance first). The host wires the CTA buttons to the title /
 * roster flow.
 */

export interface RealmWarOutcomeModalProps {
  isOpen: boolean;
  war: WarState | null;
  onReturnToTitle: () => void;
  onKeepExploring?: () => void;
  /** SRD-1405: living heroes (level 3+) offered retirement on victory. */
  retirementCandidates?: CharacterBuildState[];
  veteranRoster?: VeteranRosterEntry[];
  onRetireVeteran?: (heroId: string, confirmRelease: boolean) => void;
}

export function RealmWarOutcomeModal({
  isOpen,
  war,
  onReturnToTitle,
  onKeepExploring,
  retirementCandidates = [],
  veteranRoster = [],
  onRetireVeteran,
}: RealmWarOutcomeModalProps) {
  if (!isOpen || !war || war.outcome === 'ongoing') return null;
  const victory = war.outcome === 'victory';
  const player = war.nations[war.playerNationId];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="realm-war-outcome-title"
      data-testid="realm-war-outcome-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
    >
      <div
        className={`w-full max-w-md rounded-xl border shadow-2xl p-6 text-slate-100 space-y-4 text-center ${
          victory ? 'border-amber-500/60 bg-slate-900' : 'border-red-800 bg-slate-900'
        }`}
      >
        <span className="text-5xl block">{victory ? '🏆' : '☠️'}</span>
        <h2
          id="realm-war-outcome-title"
          data-testid="realm-war-outcome-title"
          className={`text-2xl font-serif font-extrabold ${victory ? 'text-amber-400' : 'text-red-400'}`}
        >
          {victory ? 'Victory — the Realm is Yours' : 'Defeat — the Banner Falls'}
        </h2>
        <p data-testid="realm-war-outcome-reason" className="text-sm text-slate-300">
          {war.outcomeReason ?? (victory ? 'Your nation dominates the Realm.' : 'Your nation has fallen.')}
        </p>
        {player && (
          <p className="text-xs text-slate-500">
            {player.name} · final War Power {player.power.military + player.power.economy + player.power.arcana + player.power.morale}/{war.dominanceTarget}
          </p>
        )}
        {/* SRD-1405: dominance victory concludes a campaign — offer retirement. */}
        {victory && onRetireVeteran && retirementCandidates.length > 0 && (
          <div className="text-left">
            <VeteranRetirementOffer
              candidates={retirementCandidates}
              roster={veteranRoster}
              onRetire={onRetireVeteran}
              sourceLabel="Realm Victory"
            />
          </div>
        )}
        <div className="space-y-2">
          <button
            type="button"
            data-testid="realm-war-outcome-title-btn"
            onClick={onReturnToTitle}
            className={`w-full px-4 py-2.5 rounded-lg text-sm font-black min-h-[48px] ${
              victory
                ? 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950'
                : 'bg-red-900/70 hover:bg-red-800 text-white'
            }`}
          >
            🚪 Return to Title
          </button>
          {onKeepExploring && (
            <button
              type="button"
              data-testid="realm-war-outcome-continue-btn"
              onClick={onKeepExploring}
              className="w-full px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-bold min-h-[48px]"
            >
              🗺️ Keep Exploring
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
