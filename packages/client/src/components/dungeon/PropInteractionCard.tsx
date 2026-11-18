import React from 'react';
import type { InteractiveProp } from '@srd5/engine';
import type { PropInteractionKind, PropInteractionOption } from '@srd5/engine';

export type PropInteractHandler = (propId: string, interaction: PropInteractionKind) => void;

interface PropInteractionCardProps {
  prop: InteractiveProp;
  options: PropInteractionOption[];
  onInteract: PropInteractHandler;
  onClose: () => void;
  onUseShrine?: (propId: string) => void;
}

const KIND_ICON: Record<string, string> = {
  door: '🚪',
  secret_door: '🤫',
  chest: '📦',
  trap: '⚠️',
  stairs_down: '🪜',
  stairs_up: '🪜',
  lever: '🕹️',
  shrine: '✨',
};

/**
 * SRD-510 click-to-inspect prop card. Opened by clicking a prop sprite (or its
 * HUD indicator row); shows only the actions valid for the prop's kind and
 * state, each with its check preview. Dismissed via Esc, click-away, or any
 * committed action.
 */
export function PropInteractionCard({ prop, options, onInteract, onClose, onUseShrine }: PropInteractionCardProps) {
  const handleAction = (interaction: PropInteractionKind) => {
    if (prop.kind === 'shrine' && interaction === 'open' && onUseShrine) {
      onUseShrine(prop.id);
      return;
    }
    onInteract(prop.id, interaction);
  };

  return (
    <div
      data-testid={`prop-card-${prop.id}`}
      role="dialog"
      aria-label={`Interact with ${prop.id.replace(/[-_]/g, ' ')}`}
      className="pointer-events-auto w-full max-w-md rounded-xl border border-amber-500/50 bg-slate-950/95 backdrop-blur-md p-4 shadow-2xl space-y-3"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl" aria-hidden>
            {KIND_ICON[prop.kind] ?? '❔'}
          </span>
          <div className="min-w-0">
            <div className="font-bold text-slate-100 text-sm truncate capitalize">
              {prop.id.replace(/[-_]/g, ' ')}
            </div>
            <div className="text-[11px] text-slate-400">
              {prop.kind.replace(/_/g, ' ')} ·{' '}
              <span className="font-semibold text-slate-300">{prop.state}</span>
            </div>
          </div>
        </div>
        <button
          type="button"
          data-testid={`prop-card-close-${prop.id}`}
          onClick={onClose}
          aria-label="Close interaction card"
          className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold shrink-0"
        >
          ✕
        </button>
      </div>

      {options.length === 0 ? (
        <div className="text-xs text-slate-500 italic">Nothing to do here.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {options.map((opt) => (
            <div key={opt.interaction}>
              <button
                type="button"
                data-testid={`prop-action-${opt.interaction}-${prop.id}`}
                onClick={() => handleAction(opt.interaction)}
                className="w-full px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold text-xs text-left transition-colors"
              >
                {opt.label}
                {opt.checkHint && (
                  <span className="block font-mono font-normal text-[11px] text-slate-800">
                    {opt.checkHint}
                  </span>
                )}
              </button>
              {opt.riskHint && (
                <div className="text-[11px] text-amber-300/90 mt-1 flex items-center gap-1">
                  <span aria-hidden>⚠️</span>
                  <span>{opt.riskHint}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
