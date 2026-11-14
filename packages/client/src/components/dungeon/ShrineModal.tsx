import React from 'react';
import type { PlayerViewProp } from '@srd5/transport';
import type { InteractiveProp } from '@srd5/engine';

export interface ShrineModalProps {
  isOpen: boolean;
  shrine: InteractiveProp | PlayerViewProp | null;
  actorName: string;
  onClose: () => void;
  onActivate: (propId: string) => void;
}

export function ShrineModal({
  isOpen,
  shrine,
  actorName,
  onClose,
  onActivate,
}: ShrineModalProps) {
  if (!isOpen || !shrine) return null;

  const shrineType = shrine.shrineType ?? 'fountain_restoration';
  const isUsed = shrine.state === 'open' || shrine.state === 'triggered' || shrine.state === 'destroyed';

  const getShrineInfo = () => {
    switch (shrineType) {
      case 'shrine_blood_god':
        return {
          title: 'Shrine of the Blood God',
          icon: '🩸',
          borderColor: 'border-red-600',
          badgeBg: 'bg-red-950 text-red-200 border-red-700',
          description:
            'A foreboding obsidian altar stained with ancient ichor. The whispers of the Blood God promise martial supremacy to those willing to make a flesh sacrifice.',
          reward: '+2 to all attack rolls for 3 dungeon floors.',
          risk: 'Permanently reduces your maximum Hit Points by 15%.',
          buttonLabel: 'Make Blood Offering',
          buttonClass: 'bg-red-700 hover:bg-red-600 text-white',
        };
      case 'shrine_arcane_weave':
        return {
          title: 'Shrine of the Arcane Weave',
          icon: '🔮',
          borderColor: 'border-purple-600',
          badgeBg: 'bg-purple-950 text-purple-200 border-purple-700',
          description:
            'A crystalline monolith vibrating with raw magical currents. Drawing upon its nexus replenishes spent sorceries, but the resonant surge will alert planar horrors.',
          reward: 'Instantly restores all expended spell slots for the entire party.',
          risk: 'Summons a hostile Astral Specter ambush immediately.',
          buttonLabel: 'Channel Arcane Surge',
          buttonClass: 'bg-purple-700 hover:bg-purple-600 text-white',
        };
      case 'fountain_restoration':
      default:
        return {
          title: 'Fountain of Restoration',
          icon: '💧',
          borderColor: 'border-cyan-600',
          badgeBg: 'bg-cyan-950 text-cyan-200 border-cyan-700',
          description:
            'A serene font of luminous waters bubbling up from deep crystalline strata. Drinking cleanses physical infirmities, exhaustion, and lingering curses.',
          reward: 'Restores all party members to maximum HP and purges all negative conditions and exhaustion.',
          risk: 'One use only per dungeon floor.',
          buttonLabel: 'Drink Blessed Waters',
          buttonClass: 'bg-cyan-700 hover:bg-cyan-600 text-white',
        };
    }
  };

  const info = getShrineInfo();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shrine-modal-title"
      data-testid="shrine-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
    >
      <div
        className={`relative w-full max-w-lg bg-slate-900 border-2 ${info.borderColor} rounded-xl shadow-2xl p-6 flex flex-col gap-4 text-slate-100`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{info.icon}</span>
            <div>
              <h2 id="shrine-modal-title" className="text-xl font-bold text-white tracking-wide">
                {info.title}
              </h2>
              <span className={`text-xs px-2 py-0.5 rounded border ${info.badgeBg}`}>
                Dungeon Dais Prop
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors text-2xl leading-none"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Description */}
        <p className="text-sm text-slate-300 leading-relaxed italic bg-slate-950/60 p-3 rounded border border-slate-800">
          "{info.description}"
        </p>

        {/* Risk & Reward Card */}
        <div className="flex flex-col gap-2 text-sm">
          <div className="bg-emerald-950/40 border border-emerald-800/80 rounded p-3">
            <div className="font-semibold text-emerald-400 flex items-center gap-1.5 mb-1">
              <span>✦</span> Blessing (Reward):
            </div>
            <div className="text-emerald-200 text-xs leading-normal">{info.reward}</div>
          </div>

          <div className="bg-rose-950/40 border border-rose-800/80 rounded p-3">
            <div className="font-semibold text-rose-400 flex items-center gap-1.5 mb-1">
              <span>⚠</span> Sacrifice / Peril (Risk):
            </div>
            <div className="text-rose-200 text-xs leading-normal">{info.risk}</div>
          </div>
        </div>

        {isUsed ? (
          <div className="bg-slate-800/60 text-slate-400 text-center py-2 px-4 rounded text-sm font-medium border border-slate-700">
            This shrine has already been invoked. Its power lies dormant.
          </div>
        ) : (
          <div className="text-xs text-slate-400 text-center">
            Acting hero: <span className="font-semibold text-white">{actorName}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
          >
            Step Away
          </button>
          {!isUsed && (
            <button
              type="button"
              data-testid="shrine-activate-button"
              onClick={() => {
                onActivate(shrine.id);
                onClose();
              }}
              className={`px-5 py-2 rounded text-sm font-bold shadow-lg transition-all ${info.buttonClass}`}
            >
              {info.buttonLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
