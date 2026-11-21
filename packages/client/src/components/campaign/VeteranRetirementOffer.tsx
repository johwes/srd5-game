import React, { useState } from 'react';
import type { CharacterBuildState } from '@srd5/data';
import {
  VETERAN_MAX_ROSTER_SIZE,
  getBuildTotalLevel,
  planVeteranRetirement,
  type VeteranRosterEntry,
} from '@srd5/engine';

/**
 * SRD-1405: Veteran retirement offer (Spec 13 §7).
 *
 * Offered exactly to living heroes at a run's conclusion (Descent
 * `endRogueliteRun`, cleared Realm delve, Realm dominance victory) with
 * total level ≥ 3. When the roster is full the retirement requires an
 * explicit confirmation to release the oldest veterans first (FIFO
 * confirm-to-release row).
 */

export interface VeteranRetirementOfferProps {
  /** Living heroes in the retirement level band (parent-filtered). */
  candidates: CharacterBuildState[];
  /** Current persisted veteran roster (for the cap / FIFO preview). */
  roster: VeteranRosterEntry[];
  /** Parent persists the retirement; `confirmRelease` releases FIFO oldest. */
  onRetire: (heroId: string, confirmRelease: boolean) => void;
  /** Where the retirement comes from (display + engine event source). */
  sourceLabel?: string;
}

function classSummary(build: CharacterBuildState): string {
  return build.classes.map((c) => `${c.classId} ${c.level}`).join(' / ');
}

export function VeteranRetirementOffer({
  candidates,
  roster,
  onRetire,
  sourceLabel,
}: VeteranRetirementOfferProps) {
  const [pendingConfirmId, setPendingConfirmId] = useState<string | null>(null);

  if (candidates.length === 0) return null;

  const rosterFull = roster.length >= VETERAN_MAX_ROSTER_SIZE;
  const pendingCandidate = pendingConfirmId
    ? (candidates.find((c) => c.id === pendingConfirmId) ?? null)
    : null;
  const wouldRelease = pendingCandidate
    ? planVeteranRetirement(roster, [pendingCandidate]).wouldRelease
    : [];

  const handleRetireClick = (heroId: string) => {
    if (rosterFull) {
      setPendingConfirmId(heroId);
      return;
    }
    onRetire(heroId, false);
  };

  return (
    <section
      data-testid="veteran-retirement-offer"
      className="rounded-xl border border-amber-700/50 bg-amber-950/20 p-4 space-y-3 text-left"
    >
      <div>
        <h3 className="text-sm font-bold text-amber-300">
          🎖️ Heroes Remembered{sourceLabel ? ` — ${sourceLabel}` : ''}
        </h3>
        <p className="text-xs text-slate-400 mt-0.5">
          Living heroes of level 3+ may retire into the persistent veteran
          roster ({roster.length}/{VETERAN_MAX_ROSTER_SIZE}) instead of fading
          into legend. Veterans can be rehired at the campfire for a
          level-scaled gp cost.
        </p>
      </div>

      <ul className="space-y-2">
        {candidates.map((hero) => (
          <li
            key={hero.id}
            data-testid={`veteran-candidate-${hero.id}`}
            className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-slate-100 truncate">{hero.name}</div>
              <div className="text-[11px] text-slate-400">
                Level {getBuildTotalLevel(hero)} · {classSummary(hero)}
              </div>
            </div>
            <button
              type="button"
              data-testid={`veteran-retire-${hero.id}`}
              onClick={() => handleRetireClick(hero.id)}
              className="min-h-[40px] px-3.5 py-1.5 rounded-lg border border-amber-600/60 bg-amber-950/40 hover:bg-amber-900/50 text-xs font-bold text-amber-200 transition-colors focus:ring-2 focus:ring-amber-400 focus:outline-none"
            >
              🎖️ Retire Hero
            </button>
          </li>
        ))}
      </ul>

      {pendingCandidate && (
        <div
          data-testid="veteran-release-confirm-row"
          className="rounded-lg border border-rose-600/50 bg-rose-950/30 p-3 space-y-2"
        >
          <p className="text-xs text-rose-200">
            ⚠️ The veteran roster is full ({VETERAN_MAX_ROSTER_SIZE}/
            {VETERAN_MAX_ROSTER_SIZE}). Retiring{' '}
            <span className="font-bold">{pendingCandidate.name}</span> releases
            the oldest veteran{wouldRelease.length > 1 ? 's' : ''} first
            (FIFO):{' '}
            <span className="font-bold">
              {wouldRelease.map((v) => v.hero.name).join(', ') || '—'}
            </span>
            .
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid={`veteran-retire-confirm-${pendingCandidate.id}`}
              onClick={() => {
                onRetire(pendingCandidate.id, true);
                setPendingConfirmId(null);
              }}
              className="min-h-[40px] px-3.5 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-600 text-xs font-bold text-white transition-colors focus:ring-2 focus:ring-rose-400 focus:outline-none"
            >
              Confirm — Release &amp; Retire
            </button>
            <button
              type="button"
              data-testid="veteran-release-cancel"
              onClick={() => setPendingConfirmId(null)}
              className="min-h-[40px] px-3.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-slate-300 transition-colors focus:outline-none"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
