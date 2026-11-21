import React, { useMemo } from 'react';
import type { CharacterBuildState } from '@srd5/data';
import type { GraveyardEntry, VeteranRosterEntry } from '@srd5/engine';
import { getWorldOptionsSummary } from '@srd5/engine';
import { getGraveyardHighScores } from '../../persistence/roguelitePersistence.js';
import { VeteranRetirementOffer } from '../campaign/VeteranRetirementOffer.js';

export interface GraveyardModalProps {
  isOpen: boolean;
  currentEntry: GraveyardEntry | null;
  onStartNewRun: () => void;
  onExitToRoster: () => void;
  /** SRD-1405: living heroes (level 3+) offered retirement at run conclusion. */
  retirementCandidates?: CharacterBuildState[];
  veteranRoster?: VeteranRosterEntry[];
  onRetireVeteran?: (heroId: string, confirmRelease: boolean) => void;
}

export function GraveyardModal({
  isOpen,
  currentEntry,
  onStartNewRun,
  onExitToRoster,
  retirementCandidates = [],
  veteranRoster = [],
  onRetireVeteran,
}: GraveyardModalProps) {
  if (!isOpen) return null;

  const highScores = useMemo(() => {
    return getGraveyardHighScores(8);
  }, [currentEntry]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="graveyard-modal-title"
      data-testid="graveyard-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 overflow-y-auto"
    >
      <div className="relative w-full max-w-2xl bg-slate-950 border-2 border-stone-800 rounded-2xl shadow-2xl p-6 sm:p-8 flex flex-col gap-6 text-slate-100 my-8">
        {/* Header */}
        <div className="flex flex-col items-center text-center gap-2">
          <span className="text-5xl">💀</span>
          <h2
            id="graveyard-modal-title"
            className="text-3xl font-extrabold tracking-wider text-stone-200 uppercase"
          >
            The Descent Has Ended
          </h2>
          {currentEntry && (
            <p className="text-rose-400 font-medium text-sm italic">
              "{currentEntry.deathCause}"
            </p>
          )}
        </div>

        {/* Current Run Score Banner */}
        {currentEntry && (
          <div className="bg-stone-900/80 border border-amber-600/50 rounded-xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-inner">
            <div className="flex flex-col items-center sm:items-start">
              <span className="text-xs uppercase font-bold tracking-widest text-amber-500">
                Final Run Score
              </span>
              <span className="text-3xl sm:text-4xl font-black text-amber-300">
                ★ {currentEntry.score.toLocaleString()}
              </span>
              {/* SRD-1403 run record: persisted world options, like-for-like scores. */}
              {currentEntry.worldOptions && (
                <span data-testid="graveyard-world-options" className="text-[11px] text-sky-300 mt-1">
                  🌍 {getWorldOptionsSummary(currentEntry.worldOptions)}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-xs">
              <div className="bg-slate-900/80 p-2.5 rounded border border-slate-800">
                <div className="text-slate-400">Deepest Depth</div>
                <div className="text-base font-bold text-white mt-0.5">
                  Depth {currentEntry.depth}
                </div>
              </div>
              <div className="bg-slate-900/80 p-2.5 rounded border border-slate-800">
                <div className="text-slate-400">Monsters Slain</div>
                <div className="text-base font-bold text-rose-400 mt-0.5">
                  ⚔ {currentEntry.monstersSlain}
                </div>
              </div>
              <div className="bg-slate-900/80 p-2.5 rounded border border-slate-800">
                <div className="text-slate-400">Gold Plundered</div>
                <div className="text-base font-bold text-yellow-400 mt-0.5">
                  🪙 {currentEntry.goldCollected} GP
                </div>
              </div>
              <div className="bg-slate-900/80 p-2.5 rounded border border-slate-800">
                <div className="text-slate-400">Turns Survived</div>
                <div className="text-base font-bold text-sky-400 mt-0.5">
                  ⌛ {currentEntry.turnsTaken}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SRD-1405: retirement offer for surviving leveled heroes. */}
        {onRetireVeteran && retirementCandidates.length > 0 && (
          <VeteranRetirementOffer
            candidates={retirementCandidates}
            roster={veteranRoster}
            onRetire={onRetireVeteran}
            sourceLabel="The Descent Has Ended"
          />
        )}

        {/* Hall of the Slain (Leaderboard) */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between border-b border-stone-800 pb-2">
            <h3 className="text-sm font-bold uppercase tracking-wider text-stone-400">
              Graveyard Records & Hall of Fame
            </h3>
            <span className="text-xs text-stone-500">All-Time Top Descents</span>
          </div>

          <div className="max-h-56 overflow-y-auto border border-stone-800/80 rounded-lg bg-stone-900/40">
            {highScores.length === 0 ? (
              <div className="p-6 text-center text-sm text-stone-500 italic">
                No past descents recorded in the graveyard yet.
              </div>
            ) : (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-stone-900/90 text-stone-400 border-b border-stone-800">
                    <th className="py-2.5 px-3 font-semibold">#</th>
                    <th className="py-2.5 px-3 font-semibold">Score</th>
                    <th className="py-2.5 px-3 font-semibold">Depth</th>
                    <th className="py-2.5 px-3 font-semibold">Fate</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Slain</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-800/60">
                  {highScores.map((entry, index) => {
                    const isCurrent = currentEntry?.runId === entry.runId;
                    return (
                      <tr
                        key={entry.runId || index}
                        className={`transition-colors ${
                          isCurrent
                            ? 'bg-amber-950/40 font-semibold text-amber-200'
                            : 'hover:bg-stone-900/50 text-stone-300'
                        }`}
                      >
                        <td className="py-2 px-3 text-stone-400">{index + 1}</td>
                        <td className="py-2 px-3 text-amber-400 font-bold">
                          ★ {entry.score.toLocaleString()}
                        </td>
                        <td className="py-2 px-3">Depth {entry.depth}</td>
                        <td className="py-2 px-3 truncate max-w-[200px]" title={entry.deathCause}>
                          {entry.deathCause}
                        </td>
                        <td className="py-2 px-3 text-right text-rose-300">
                          {entry.monstersSlain}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-4 border-t border-stone-800">
          <button
            type="button"
            onClick={onExitToRoster}
            className="w-full sm:w-auto px-5 py-2.5 rounded-lg text-sm font-semibold bg-stone-900 hover:bg-stone-800 text-stone-300 border border-stone-700 transition-colors"
          >
            Exit to Party Roster
          </button>
          <button
            type="button"
            data-testid="graveyard-new-run-button"
            onClick={onStartNewRun}
            className="w-full sm:w-auto px-6 py-2.5 rounded-lg text-sm font-bold bg-amber-600 hover:bg-amber-500 text-slate-950 shadow-lg shadow-amber-600/30 transition-all uppercase tracking-wide"
          >
            Embark on New Descent
          </button>
        </div>
      </div>
    </div>
  );
}
