import React, { useState } from 'react';
import type { RestCampModalProps } from './types.js';

export function RestCampModal({
  isOpen,
  party,
  compendium,
  isSafeRoom,
  currentRoomName,
  onClose,
  onStartShortRest,
  onStartLongRest,
}: RestCampModalProps) {
  const [activeTab, setActiveTab] = useState<'short' | 'long'>('short');
  const [hitDiceSpend, setHitDiceSpend] = useState<Record<string, number>>({});
  const [forceSafeRest, setForceSafeRest] = useState(false);

  if (!isOpen) return null;

  const partyList = Object.values(party);

  // Check if Bard is in party with Song of Rest (Level 2+)
  const hasBardSongOfRest = partyList.some((c) => {
    const sheet = c.characterSheet;
    const bardClass = sheet?.classes?.find((entry) => entry.classId === 'bard');
    return bardClass && bardClass.level >= 2;
  });

  const handleDiceChange = (charId: string, delta: number, maxAvailable: number) => {
    const current = hitDiceSpend[charId] ?? 0;
    const next = Math.max(0, Math.min(maxAvailable, current + delta));
    setHitDiceSpend((prev) => ({
      ...prev,
      [charId]: next,
    }));
  };

  const handleExecuteShortRest = () => {
    onStartShortRest(hitDiceSpend);
    onClose();
  };

  const handleExecuteLongRest = () => {
    onStartLongRest({ forceSafe: forceSafeRest });
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rest-camp-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-xl rounded-xl border border-slate-700 bg-slate-900 shadow-2xl p-6 text-slate-100 space-y-5 animate-in fade-in zoom-in-95 duration-150">
        <header className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h2 id="rest-camp-title" className="text-xl font-bold text-amber-400">
              🏕️ Party Rest &amp; Recuperation Camp
            </h2>
            <p className="text-xs text-slate-400">
              Location: {currentRoomName ?? 'Dungeon Corridor'} &middot;{' '}
              {isSafeRoom ? (
                <span className="text-emerald-400 font-semibold">Sanctuary (Safe Room)</span>
              ) : (
                <span className="text-amber-400 font-semibold">Unsecured Dungeon Area</span>
              )}
            </p>
          </div>
          <button
            type="button"
            data-testid="rest-camp-close-btn"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md text-lg"
          >
            ✕
          </button>
        </header>

        {/* Tab Switcher */}
        <div className="flex rounded-lg bg-slate-950 p-1 border border-slate-800">
          <button
            type="button"
            data-testid="tab-short-rest-btn"
            aria-pressed={activeTab === 'short'}
            onClick={() => setActiveTab('short')}
            className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${
              activeTab === 'short'
                ? 'bg-amber-500 text-slate-950 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            ⏱️ Short Rest (1 In-Game Hour)
          </button>
          <button
            type="button"
            data-testid="tab-long-rest-btn"
            aria-pressed={activeTab === 'long'}
            onClick={() => setActiveTab('long')}
            className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${
              activeTab === 'long'
                ? 'bg-amber-500 text-slate-950 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            🌙 Long Rest (8 In-Game Hours)
          </button>
        </div>

        {/* Short Rest Content */}
        {activeTab === 'short' && (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-950/70 p-3 border border-slate-800 text-xs text-slate-300 space-y-1">
              <div className="font-semibold text-amber-300">Short Rest Benefits:</div>
              <p>
                Spend unspent Hit Dice from your pool to regain HP (1d[Die] + CON modifier per die, minimum 0).
                Recharges short-rest class features like <em>Second Wind</em>, <em>Action Surge</em>, <em>Ki</em>, and <em>Pact Magic</em>.
              </p>
              {hasBardSongOfRest && (
                <p className="text-emerald-400 font-semibold">
                  🎵 Bard's <em>Song of Rest</em> active: Allies who spend Hit Dice regain an extra 1d6 HP!
                </p>
              )}
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {partyList.map((hero) => {
                const sheet = hero.characterSheet;
                const firstPool = sheet?.hitDicePools?.[0];
                const totalDice = firstPool?.total ?? sheet?.totalLevel ?? 1;
                const spentDice = firstPool?.spent ?? (hero as any).runtime?.hitDiceSpent ?? 0;
                const availableDice = firstPool?.available ?? Math.max(0, totalDice - spentDice);
                const dieType = firstPool ? `d${firstPool.dieSize}` : 'd10';
                const allocated = hitDiceSpend[hero.id] ?? 0;
                const conMod = sheet?.abilities?.con?.modifier ?? 0;

                return (
                  <div
                    key={hero.id}
                    data-testid={`short-rest-row-${hero.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-slate-800 bg-slate-950/40"
                  >
                    <div>
                      <div className="font-semibold text-sm text-slate-200">{hero.name}</div>
                      <div className="text-xs text-slate-400">
                        HP: {hero.currentHp} / {hero.maxHp} &middot; Dice Pool:{' '}
                        <span className="text-amber-300 font-medium">
                          {availableDice} {dieType} available
                        </span>{' '}
                        (CON mod {conMod >= 0 ? `+${conMod}` : conMod})
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">Spend:</span>
                      <button
                        type="button"
                        data-testid={`dice-dec-btn-${hero.id}`}
                        disabled={allocated <= 0}
                        onClick={() => handleDiceChange(hero.id, -1, availableDice)}
                        className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-xs font-bold text-slate-200"
                      >
                        -
                      </button>
                      <span
                        data-testid={`dice-count-${hero.id}`}
                        className="w-6 text-center text-sm font-bold text-amber-300"
                      >
                        {allocated}
                      </span>
                      <button
                        type="button"
                        data-testid={`dice-inc-btn-${hero.id}`}
                        disabled={allocated >= availableDice}
                        onClick={() => handleDiceChange(hero.id, 1, availableDice)}
                        className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-xs font-bold text-slate-200"
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <footer className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                data-testid="short-rest-cancel-btn"
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="execute-short-rest-btn"
                onClick={handleExecuteShortRest}
                className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shadow-md transition-colors"
              >
                Take Short Rest (1 Hr)
              </button>
            </footer>
          </div>
        )}

        {/* Long Rest Content */}
        {activeTab === 'long' && (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-950/70 p-3 border border-slate-800 text-xs text-slate-300 space-y-2">
              <div className="font-semibold text-amber-300">Long Rest Benefits:</div>
              <ul className="list-disc list-inside space-y-1 text-slate-300">
                <li>Restores full Hit Points to maximum and resets Death Saves.</li>
                <li>Recovers all expended spell slots (L1–9) and short/long rest class abilities.</li>
                <li>Regains spent Hit Dice up to half total Hit Dice (minimum 1 Hit Die).</li>
                <li>Reduces exhaustion level by 1.</li>
              </ul>
            </div>

            {/* Room Ambush Risk Banner */}
            <div
              data-testid="long-rest-safety-banner"
              className={`p-3.5 rounded-lg border text-xs flex items-start gap-2.5 ${
                isSafeRoom
                  ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                  : 'border-amber-500/40 bg-amber-950/30 text-amber-300'
              }`}
            >
              <span className="text-base">{isSafeRoom ? '🛡️' : '⚠️'}</span>
              <div>
                <div className="font-bold">
                  {isSafeRoom
                    ? 'Safe Room Sanctuary'
                    : 'Unsecured Dungeon Environment'}
                </div>
                <div className="mt-0.5 opacity-90">
                  {isSafeRoom
                    ? 'This location is secured against wandering monsters. Your rest will complete with zero risk of ambush.'
                    : 'Resting in an open dungeon risks a surprise ambush from wandering monster patrols (1–4 on d20 roll interrupts the rest with combat!).'}
                </div>
              </div>
            </div>

            {!isSafeRoom && (
              <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  data-testid="force-safe-camp-checkbox"
                  checked={forceSafeRest}
                  onChange={(e) => setForceSafeRest(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-0"
                />
                <span>Fortify camp (guarantee uninterrupted rest)</span>
              </label>
            )}

            <footer className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                data-testid="long-rest-cancel-btn"
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="execute-long-rest-btn"
                onClick={handleExecuteLongRest}
                className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shadow-md transition-colors"
              >
                Take Long Rest (8 Hrs)
              </button>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
