import React, { useEffect, useState } from 'react';
import type { AvailableReaction } from '@srd5/engine';
import { useEscHandler, ESC_PRIORITY } from '../../hooks/useEscStack.js';
import type { ReactionInterruptModalProps } from './types.js';

export function ReactionInterruptModal({
  prompt,
  reactorCombatant,
  onResolve,
  isOpen = true,
  deadlineMs = null,
  serverAuthoritativeTimeout = false,
  className = '',
}: ReactionInterruptModalProps) {
  const [selectedSlotLevels, setSelectedSlotLevels] = useState<Record<string, number>>({});
  const [remainingMs, setRemainingMs] = useState<number | null>(
    prompt?.timeoutMs ?? null,
  );
  const [totalMs, setTotalMs] = useState<number | null>(prompt?.timeoutMs ?? null);

  // Local prompts own their timer; multiplayer prompts follow the server deadline.
  useEffect(() => {
    if (!prompt) return;

    const authoritative = serverAuthoritativeTimeout && typeof deadlineMs === 'number';
    const startedAt = Date.now();
    const deadline = authoritative
      ? deadlineMs!
      : prompt.timeoutMs
        ? startedAt + prompt.timeoutMs
        : null;
    const windowMs = authoritative
      ? (prompt.timeoutMs ?? Math.max(1, deadline! - startedAt))
      : (prompt.timeoutMs ?? null);

    if (deadline === null || windowMs === null) {
      setRemainingMs(null);
      setTotalMs(null);
      return;
    }

    setTotalMs(windowMs);
    setRemainingMs(Math.max(0, deadline - Date.now()));
    const interval = setInterval(() => {
      const left = Math.max(0, deadline - Date.now());
      setRemainingMs(left);
      if (left <= 0) {
        clearInterval(interval);
        // The authoritative server resolves (auto-passes) the prompt; dispatching
        // here too would race with it and produce an engine error.
        if (!authoritative) onResolve({ execute: false });
      }
    }, 100);

    return () => clearInterval(interval);
  }, [prompt, onResolve, deadlineMs, serverAuthoritativeTimeout]);

  // Escape passes the prompt (BG3 layering via the shared useEscStack —
  // the reaction interrupt is topmost while open). Number keys stay on a
  // dedicated listener since they never conflict with the Escape stack.
  useEscHandler(
    () => {
      onResolve({ execute: false });
      return true;
    },
    { priority: ESC_PRIORITY.reaction, active: isOpen && prompt != null },
  );

  // Keyboard navigation: number keys to choose reaction
  useEffect(() => {
    if (!isOpen || !prompt) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const num = parseInt(e.key, 10);
      if (!isNaN(num) && num >= 1 && num <= prompt.availableReactions.length) {
        e.preventDefault();
        const reaction = prompt.availableReactions[num - 1]!;
        handleExecute(reaction);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, prompt, onResolve, selectedSlotLevels]);

  if (!isOpen || !prompt) {
    return null;
  }

  const handleExecute = (reaction: AvailableReaction) => {
    const slotLevel =
      selectedSlotLevels[reaction.id] ?? reaction.slotLevel ?? undefined;
    onResolve({
      execute: true,
      reactionId: reaction.id,
      ...(slotLevel !== undefined ? { slotLevel } : {}),
    });
  };

  const getTriggerBadge = (triggerType: string) => {
    switch (triggerType) {
      case 'attack_roll_hit':
        return { label: 'Incoming Hit', color: 'bg-red-500/20 text-red-300 border-red-500/40' };
      case 'movement_reach_exit':
        return { label: 'Opportunity Attack', color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' };
      case 'spell_cast':
        return { label: 'Spell Cast', color: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' };
      case 'damage_taken':
        return { label: 'Damage Taken', color: 'bg-rose-500/20 text-rose-300 border-rose-500/40' };
      default:
        return { label: 'Interrupt Trigger', color: 'bg-slate-500/20 text-slate-300 border-slate-500/40' };
    }
  };

  const badge = getTriggerBadge(prompt.triggerType);
  const reactorName = reactorCombatant?.name ?? prompt.reactorEntityId;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reaction-modal-title"
      data-testid="reaction-interrupt-modal"
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in ${className}`}
    >
      <div className="relative w-full max-w-lg bg-slate-900 border-2 border-amber-500/80 rounded-xl shadow-2xl shadow-amber-950/50 overflow-hidden">
        {/* Animated Timeout Progress Bar */}
        {totalMs && remainingMs !== null && (
          <div className="w-full bg-slate-800 h-1.5 overflow-hidden">
            <div
              className="bg-amber-400 h-full transition-all duration-100 ease-linear"
              style={{
                width: `${Math.max(0, Math.min(100, (remainingMs / totalMs) * 100))}%`,
              }}
            />
          </div>
        )}

        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-amber-950/60 via-slate-900 to-slate-900 border-b border-amber-500/30">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-7 h-7 rounded-full bg-amber-500 text-slate-950 font-black text-sm shadow">
              ⚡
            </span>
            <div>
              <h3
                id="reaction-modal-title"
                className="text-base font-bold text-amber-300 tracking-wide uppercase"
              >
                Reaction Opportunity
              </h3>
              <p className="text-xs text-slate-400">
                Action required for <strong className="text-slate-200">{reactorName}</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {remainingMs !== null && (
              <span
                data-testid="reaction-countdown"
                className="px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/40"
              >
                {Math.ceil(remainingMs / 1000)}s
              </span>
            )}
            <span
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${badge.color}`}
            >
              {badge.label}
            </span>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4">
          {/* Trigger Context Box */}
          <div
            data-testid="reaction-trigger-description"
            className="p-3.5 rounded-lg bg-slate-950/70 border border-slate-800 text-xs text-slate-200 leading-relaxed flex items-start gap-2.5"
          >
            <span className="text-amber-400 text-sm mt-0.5">⚠️</span>
            <div className="flex-1">
              <span className="text-[11px] uppercase tracking-wider text-slate-400 block font-semibold mb-0.5">
                Trigger Event
              </span>
              <span>{prompt.triggerDescription}</span>
            </div>
          </div>

          {/* Reactor Stats Snapshot (if available) */}
          {reactorCombatant && (
            <div className="flex items-center justify-between text-xs px-3 py-2 rounded-md bg-slate-800/60 border border-slate-700/50">
              <span className="text-slate-300 font-medium">
                {reactorCombatant.name}
              </span>
              <div className="flex items-center gap-3">
                <span className="text-red-300">
                  HP {reactorCombatant.currentHp}/{reactorCombatant.maxHp}
                </span>
                <span className="text-cyan-300 font-semibold">
                  AC {reactorCombatant.armorClass}
                </span>
                <span className="text-emerald-400 font-semibold">
                  Reaction Available
                </span>
              </div>
            </div>
          )}

          {/* Available Reactions List */}
          <div className="space-y-2.5">
            <label className="text-[11px] uppercase tracking-wider text-slate-400 font-bold block">
              Choose Reaction:
            </label>

            {prompt.availableReactions.map((reaction, index) => {
              const numKey = index + 1;
              return (
                <div
                  key={reaction.id}
                  data-testid={`reaction-card-${reaction.id}`}
                  className="p-3 rounded-lg bg-slate-950/50 border border-slate-800 hover:border-amber-500/60 transition-colors flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded bg-slate-800 text-amber-300 text-xs font-mono font-bold flex items-center justify-center">
                        {numKey}
                      </span>
                      <span className="text-sm font-bold text-slate-100">
                        {reaction.label}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 uppercase">
                        {reaction.reactionType.replace('_', ' ')}
                      </span>
                    </div>

                    {reaction.slotLevel !== undefined && (
                      <span className="text-xs text-indigo-300 font-medium bg-indigo-950/60 border border-indigo-800 px-2 py-0.5 rounded">
                        Level {reaction.slotLevel} Slot
                      </span>
                    )}
                  </div>

                  {reaction.description && (
                    <p className="text-xs text-slate-300 leading-normal pl-7">
                      {reaction.description}
                    </p>
                  )}

                  <div className="pl-7 pt-1 flex items-center justify-between">
                    {/* Optional Spell Slot selector if upcastable */}
                    {reaction.slotLevel !== undefined && (
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-400">Slot:</span>
                        <select
                          data-testid={`reaction-slot-select-${reaction.id}`}
                          value={selectedSlotLevels[reaction.id] ?? reaction.slotLevel}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            setSelectedSlotLevels((prev) => ({
                              ...prev,
                              [reaction.id]: val,
                            }));
                          }}
                          className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-xs text-slate-200"
                        >
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9]
                            .filter((lvl) => lvl >= (reaction.slotLevel ?? 1))
                            .map((lvl) => (
                              <option key={lvl} value={lvl}>
                                Level {lvl}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}

                    <button
                      type="button"
                      data-testid={`reaction-execute-${reaction.id}`}
                      onClick={() => handleExecute(reaction)}
                      className="ml-auto px-3.5 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow hover:shadow-amber-500/20 transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <span>Trigger ({numKey})</span>
                      <span>➔</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-5 py-3 bg-slate-950/80 border-t border-slate-800 text-xs">
          <span className="text-slate-400">
            Press <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">Esc</kbd> to decline
          </span>

          <button
            type="button"
            data-testid="reaction-pass-btn"
            onClick={() => onResolve({ execute: false })}
            className="px-4 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-medium transition-colors cursor-pointer"
          >
            Pass Reaction
          </button>
        </div>
      </div>
    </div>
  );
}
