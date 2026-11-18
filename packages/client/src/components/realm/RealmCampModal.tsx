import React, { useState } from 'react';
import { getLivingParty, getPartyList, type RealmSessionState } from './realmEngine.js';

/**
 * Wilderness / inn camp modal (SRD-805): Short Rest with per-hero Hit Dice
 * spending, and Long Rests (free at safe inns; 1 ration per living member in
 * the wild, with exhaustion on short rations and ambush risk).
 */

export interface RealmCampModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: RealmSessionState;
  safeSite: boolean;
  canCampEarly: boolean;
  onCamp: (restType: 'short' | 'long', hitDiceToSpend: Record<string, number>) => void;
  onCampEarly: (hitDiceToSpend: Record<string, number>) => void;
}

function getAvailableHitDice(hero: RealmSessionState['party'][string]): number {
  const pools = hero.characterSheet?.hitDicePools ?? [];
  return pools.reduce((sum, pool) => sum + pool.available, 0);
}

export function RealmCampModal({
  isOpen,
  onClose,
  session,
  safeSite,
  canCampEarly,
  onCamp,
  onCampEarly,
}: RealmCampModalProps) {
  const [hitDiceSpend, setHitDiceSpend] = useState<Record<string, number>>({});

  if (!isOpen) return null;

  const party = getPartyList(session);
  const living = getLivingParty(session);
  const rations = session.travel.rations;
  const rationCost = living.length;
  const willStarve = !safeSite && rations < rationCost;

  const adjustSpend = (heroId: string, delta: number, max: number) => {
    setHitDiceSpend((prev) => {
      const next = Math.max(0, Math.min(max, (prev[heroId] ?? 0) + delta));
      return { ...prev, [heroId]: next };
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="realm-camp-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl p-6 text-slate-100 space-y-4">
        <header className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h2 id="realm-camp-title" className="text-xl font-bold text-amber-400">
            🏕️ Make Camp
          </h2>
          <button
            type="button"
            data-testid="realm-camp-close-btn"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md text-lg"
          >
            ✕
          </button>
        </header>

        <p className="text-xs text-slate-400">
          {safeSite ? (
            <span className="text-emerald-300 font-semibold">
              🛏️ Safe inn — Long Rests are free and fully restorative.
            </span>
          ) : (
            <>
              Wilderness camp · 🍖 {rations} rations available · Long Rest consumes{' '}
              {rationCost} (1 per living member).
              {willStarve && (
                <span className="block mt-1 text-red-300 font-semibold">
                  ⚠️ Not enough rations — the party will gain Exhaustion instead of recovering!
                </span>
              )}
              <span className="block mt-1 text-amber-300/80">
                Unsafe Long Rests risk a dawn ambush.
              </span>
            </>
          )}
        </p>

        <div data-testid="realm-camp-hit-dice-list" className="space-y-1.5">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Short Rest — spend Hit Dice
          </h3>
          {party.map((hero) => {
            const available = getAvailableHitDice(hero);
            const spend = hitDiceSpend[hero.id] ?? 0;
            return (
              <div
                key={hero.id}
                data-testid={`realm-camp-hero-${hero.id}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <span className="text-xs font-bold text-slate-200">{hero.name}</span>
                  <span className="ml-2 text-[11px] text-slate-400 font-mono">
                    HP {hero.currentHp}/{hero.maxHp} · {available} HD left
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    data-testid={`realm-camp-hd-minus-${hero.id}`}
                    onClick={() => adjustSpend(hero.id, -1, available)}
                    disabled={spend <= 0}
                    className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-sm font-bold"
                  >
                    −
                  </button>
                  <span
                    data-testid={`realm-camp-hd-count-${hero.id}`}
                    className="w-6 text-center text-xs font-mono font-bold text-amber-300"
                  >
                    {spend}
                  </span>
                  <button
                    type="button"
                    data-testid={`realm-camp-hd-plus-${hero.id}`}
                    onClick={() => adjustSpend(hero.id, 1, available)}
                    disabled={spend >= available || hero.isDead}
                    className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-sm font-bold"
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          {canCampEarly && (
            <button
              type="button"
              data-testid="realm-camp-early-rest-btn"
              onClick={() => onCampEarly(hitDiceSpend)}
              className="flex-1 px-4 py-2.5 rounded-lg bg-sky-900/50 hover:bg-sky-800/60 border border-sky-600/50 text-sm font-bold text-sky-200 min-h-[48px]"
              title="Secure daylight Short Rest — safe, heals via Hit Dice, and does not advance the day (once per day, before dusk)"
            >
              ☀️ Early Rest (safe, no day advance)
            </button>
          )}
          <button
            type="button"
            data-testid="realm-camp-short-rest-btn"
            onClick={() => onCamp('short', hitDiceSpend)}
            className="flex-1 px-4 py-2.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm font-bold text-slate-100 min-h-[48px]"
          >
            🔥 Short Rest
          </button>
          <button
            type="button"
            data-testid="realm-camp-long-rest-btn"
            onClick={() => onCamp('long', {})}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-black min-h-[48px] ${
              willStarve
                ? 'bg-red-700 hover:bg-red-600 text-white'
                : 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950'
            }`}
          >
            🌙 Long Rest{!safeSite ? ` (−${rationCost} 🍖)` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
