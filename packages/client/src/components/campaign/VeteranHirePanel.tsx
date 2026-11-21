import React, { useState } from 'react';
import type { CharacterBuildState } from '@srd5/data';
import {
  VETERAN_MAX_ROSTER_SIZE,
  veteranHireCost,
  type VeteranRosterEntry,
} from '@srd5/engine';

/**
 * SRD-1405: Veteran hire panel for campfire assembly (Spec 13 §7).
 *
 * Retired veterans appear alongside the SRD-603 vault/seat machinery with a
 * gp hire cost scaling by level (`level × 100 gp`), paid from the seated
 * party's pooled personal gold. Hired veterans deploy as ordinary party
 * members. Releasing a veteran is a destructive two-step confirm.
 */

export interface VeteranHirePanelProps {
  veterans: VeteranRosterEntry[];
  /** Currently seated campfire party (their pooled gp funds the hire). */
  seatedParty: CharacterBuildState[];
  hasEmptySeat: boolean;
  onHire: (veteranId: string) => void;
  onRelease: (veteranId: string) => void;
}

export function pooledPartyGold(party: CharacterBuildState[]): number {
  return party.reduce((sum, c) => sum + (c.currency?.gp ?? 0), 0);
}

function classSummary(build: CharacterBuildState): string {
  return build.classes.map((c) => `${c.classId} ${c.level}`).join(' / ');
}

export function VeteranHirePanel({
  veterans,
  seatedParty,
  hasEmptySeat,
  onHire,
  onRelease,
}: VeteranHirePanelProps) {
  const [pendingReleaseId, setPendingReleaseId] = useState<string | null>(null);
  const purse = pooledPartyGold(seatedParty);

  return (
    <section
      data-testid="veteran-hire-panel"
      className="rounded-xl border border-slate-800 bg-slate-900/70 p-3.5 space-y-3"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
        <h3 className="text-sm font-bold text-slate-200">
          🎖️ Retired Veterans — Heroes Remembered
        </h3>
        <span data-testid="veteran-party-purse" className="text-[11px] text-slate-400">
          Party purse: <span className="font-bold text-yellow-300">{purse} gp</span>
          {' · '}
          {veterans.length}/{VETERAN_MAX_ROSTER_SIZE} remembered
        </span>
      </div>

      {veterans.length === 0 ? (
        <p data-testid="veteran-hire-empty" className="text-xs text-slate-500 italic">
          No retired veterans yet. Living heroes of level 3+ may retire at the
          end of a Descent run, a cleared Realm delve, or a Realm war victory —
          then return to fight beside new companies.
        </p>
      ) : (
        <ul className="space-y-2">
          {veterans.map((entry) => {
            const cost = veteranHireCost(entry.level);
            const affordable = purse >= cost;
            const canHire = affordable && hasEmptySeat;
            const disabledReason = !hasEmptySeat
              ? 'No empty campfire seat — clear a slot first.'
              : !affordable
                ? `Needs ${cost} gp (party holds ${purse} gp).`
                : undefined;
            const confirmingRelease = pendingReleaseId === entry.veteranId;
            return (
              <li
                key={entry.veteranId}
                data-testid={`veteran-hire-row-${entry.veteranId}`}
                className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 space-y-2"
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-slate-100 truncate">
                      {entry.hero.name}
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-amber-400/90">
                        {entry.source === 'realm' ? 'Realm veteran' : entry.source === 'delve' ? 'Delve veteran' : 'Descent veteran'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Level {entry.level} · {classSummary(entry.hero)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      data-testid={`veteran-hire-cost-${entry.veteranId}`}
                      className={`text-xs font-bold ${affordable ? 'text-yellow-300' : 'text-rose-400'}`}
                      title={disabledReason ?? `Hire for ${cost} gp`}
                    >
                      💰 {cost} gp
                    </span>
                    <button
                      type="button"
                      data-testid={`veteran-hire-${entry.veteranId}`}
                      disabled={!canHire}
                      title={disabledReason ?? `Hire ${entry.hero.name} for ${cost} gp`}
                      onClick={() => onHire(entry.veteranId)}
                      className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors focus:ring-2 focus:ring-amber-400 focus:outline-none ${
                        canHire
                          ? 'bg-amber-600 hover:bg-amber-500 text-slate-950'
                          : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                      }`}
                    >
                      Hire
                    </button>
                    <button
                      type="button"
                      data-testid={`veteran-release-${entry.veteranId}`}
                      onClick={() => setPendingReleaseId(entry.veteranId)}
                      className="min-h-[40px] px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-[11px] font-semibold text-slate-400 hover:text-slate-200 transition-colors focus:outline-none"
                    >
                      Release
                    </button>
                  </div>
                </div>
                {confirmingRelease && (
                  <div
                    data-testid={`veteran-release-confirm-${entry.veteranId}`}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-rose-600/40 bg-rose-950/20 px-2.5 py-2"
                  >
                    <span className="text-[11px] text-rose-200">
                      Release {entry.hero.name} from memory forever?
                    </span>
                    <button
                      type="button"
                      data-testid={`veteran-release-confirm-yes-${entry.veteranId}`}
                      onClick={() => {
                        onRelease(entry.veteranId);
                        setPendingReleaseId(null);
                      }}
                      className="min-h-[36px] px-2.5 py-1 rounded-md bg-rose-700 hover:bg-rose-600 text-[11px] font-bold text-white"
                    >
                      Yes, release
                    </button>
                    <button
                      type="button"
                      data-testid={`veteran-release-cancel-${entry.veteranId}`}
                      onClick={() => setPendingReleaseId(null)}
                      className="min-h-[36px] px-2.5 py-1 rounded-md border border-slate-700 bg-slate-900 text-[11px] font-semibold text-slate-300"
                    >
                      Keep
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
