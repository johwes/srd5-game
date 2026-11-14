import React, { useState, useEffect } from 'react';
import type { MarchingFormation } from '@srd5/engine';
import type { MarchingOrderModalProps } from './types.js';

export function MarchingOrderModal({
  isOpen,
  marchingOrder,
  party,
  onClose,
  onApplyMarchingOrder,
}: MarchingOrderModalProps) {
  const [order, setOrder] = useState<string[]>(marchingOrder.order);
  const [formation, setFormation] = useState<MarchingFormation>(
    marchingOrder.formation ?? 'single_file',
  );
  const [leadExplorerId, setLeadExplorerId] = useState<string>(
    marchingOrder.leadExplorerId ?? marchingOrder.order[0] ?? '',
  );

  useEffect(() => {
    setOrder(marchingOrder.order);
    setFormation(marchingOrder.formation ?? 'single_file');
    setLeadExplorerId(marchingOrder.leadExplorerId ?? marchingOrder.order[0] ?? '');
  }, [marchingOrder]);

  if (!isOpen) return null;

  const handleMove = (index: number, direction: 'up' | 'down') => {
    const next = [...order];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= next.length) return;
    const temp = next[index]!;
    next[index] = next[targetIndex]!;
    next[targetIndex] = temp;
    setOrder(next);
  };

  const handleApply = () => {
    onApplyMarchingOrder(order, formation, leadExplorerId);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="marching-order-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 shadow-2xl p-6 text-slate-100 space-y-6 animate-in fade-in zoom-in-95 duration-150">
        <header className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h2 id="marching-order-title" className="text-xl font-bold text-amber-400">
              🛡️ Party Marching Order &amp; Formation
            </h2>
            <p className="text-xs text-slate-400">
              Configure movement sequence and spatial formation for exploration mode.
            </p>
          </div>
          <button
            type="button"
            data-testid="marching-order-close-btn"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md text-lg"
          >
            ✕
          </button>
        </header>

        {/* Formation Selection */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Movement Formation
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              data-testid="formation-single-file-btn"
              onClick={() => setFormation('single_file')}
              className={`p-3 rounded-lg border text-left transition-all ${
                formation === 'single_file'
                  ? 'border-amber-500 bg-amber-500/10 text-amber-200'
                  : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="font-semibold text-sm">🚶 Single File (Column)</div>
              <div className="text-xs text-slate-400 mt-1">
                Narrow corridors. Each character trails directly behind the preceding member.
              </div>
            </button>

            <button
              type="button"
              data-testid="formation-two-by-two-btn"
              onClick={() => setFormation('two_by_two')}
              className={`p-3 rounded-lg border text-left transition-all ${
                formation === 'two_by_two'
                  ? 'border-amber-500 bg-amber-500/10 text-amber-200'
                  : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="font-semibold text-sm">👥 2x2 Squad (Box)</div>
              <div className="text-xs text-slate-400 mt-1">
                Open rooms and wide halls. 2 vanguards in front, 2 rearguards in back.
              </div>
            </button>
          </div>
        </div>

        {/* Party Sequence List */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Marching Sequence &amp; Scout Selection
          </label>
          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {order.map((id, idx) => {
              const combatant = party[id];
              const isLead = id === leadExplorerId;
              const name = combatant?.name ?? id;

              return (
                <div
                  key={id}
                  data-testid={`marching-order-row-${idx}`}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    isLead
                      ? 'border-amber-500/60 bg-slate-800/80'
                      : 'border-slate-800 bg-slate-950/50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-800 text-xs font-bold text-slate-300">
                      {idx + 1}
                    </span>
                    <div>
                      <div className="font-semibold text-sm text-slate-200 flex items-center gap-1.5">
                        {name}
                        {isLead && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            👑 Lead Scout
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400">
                        HP: {combatant?.currentHp}/{combatant?.maxHp} &middot; AC:{' '}
                        {combatant?.armorClass}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      data-testid={`set-lead-btn-${id}`}
                      onClick={() => setLeadExplorerId(id)}
                      disabled={isLead}
                      className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                        isLead
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                      }`}
                    >
                      {isLead ? 'Current Lead' : 'Set as Lead'}
                    </button>
                    <button
                      type="button"
                      data-testid={`move-up-btn-${idx}`}
                      disabled={idx === 0}
                      onClick={() => handleMove(idx, 'up')}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-xs font-bold"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      data-testid={`move-down-btn-${idx}`}
                      disabled={idx === order.length - 1}
                      onClick={() => handleMove(idx, 'down')}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-xs font-bold"
                    >
                      ▼
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Visual Formation Preview */}
        <div className="rounded-lg bg-slate-950 p-3 border border-slate-800">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-2 font-semibold">
            Formation Visual Preview (Facing Forward ▲)
          </div>
          {formation === 'single_file' ? (
            <div className="flex flex-col items-center gap-1.5 py-1">
              {order.map((id, i) => (
                <div
                  key={id}
                  className="px-3 py-1 rounded bg-slate-900 border border-slate-700 text-xs font-medium text-slate-300 w-44 text-center truncate"
                >
                  {i === 0 ? '👑 ' : ''}{party[id]?.name ?? id}
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 max-w-xs mx-auto py-1">
              {order.map((id, i) => (
                <div
                  key={id}
                  className="px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-xs font-medium text-slate-300 text-center truncate"
                >
                  {id === leadExplorerId ? '👑 ' : ''}{party[id]?.name ?? id}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions Footer */}
        <footer className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
          <button
            type="button"
            data-testid="marching-order-cancel-btn"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="marching-order-apply-btn"
            onClick={handleApply}
            className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shadow-md transition-colors"
          >
            Apply Formation
          </button>
        </footer>
      </div>
    </div>
  );
}
