import React, { useEffect } from 'react';
import { SRD_LEGAL_ATTRIBUTION, SRD_VERSION } from '@srd5/data';
import type { TitleMenuModalProps } from './types.js';

export function TitleMenuCreditsModal({ isOpen, onClose }: TitleMenuModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="credits-modal-title"
      data-testid="title-menu-credits-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div className="relative w-full max-w-2xl rounded-xl border border-amber-500/40 bg-slate-900/95 p-6 shadow-2xl text-slate-100 space-y-5 my-8">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">📜</span>
            <h2
              id="credits-modal-title"
              className="text-lg sm:text-xl font-bold tracking-tight text-amber-400 font-serif"
            >
              Credits &amp; Statutory Legal Notices
            </h2>
          </div>
          <button
            type="button"
            data-testid="title-menu-credits-close-btn"
            onClick={onClose}
            aria-label="Close Credits Modal"
            className="rounded-lg p-2 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus:ring-2 focus:ring-amber-400 focus:outline-none"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 text-xs sm:text-sm text-slate-300 max-h-[60vh] overflow-y-auto pr-2 space-y-4">
          <section className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-4 space-y-2">
            <h3 className="font-semibold text-amber-300 uppercase tracking-wider text-xs">
              System Reference Document {SRD_VERSION} (SRD 5.1) Notice
            </h3>
            <p className="leading-relaxed text-slate-200">{SRD_LEGAL_ATTRIBUTION}</p>
          </section>

          <section className="rounded-lg border border-slate-800 bg-slate-950/50 p-4 space-y-2">
            <h3 className="font-semibold text-amber-300 uppercase tracking-wider text-xs">
              Open Game License &amp; Creative Commons
            </h3>
            <p className="leading-relaxed text-slate-300">
              This game is an independent digital implementation and rules engine based solely on the
              statutory 5.1 System Reference Document released under Creative Commons Attribution 4.0
              International (CC-BY-4.0). Product Identity, trademarks, and proprietary settings owned
              by Wizards of the Coast LLC are not included.
            </p>
          </section>

          <section className="rounded-lg border border-slate-800 bg-slate-950/50 p-4 space-y-2">
            <h3 className="font-semibold text-amber-300 uppercase tracking-wider text-xs">
              Art &amp; Visual Asset Attributions
            </h3>
            <ul className="list-disc list-inside space-y-1.5 text-slate-300">
              <li>
                <span className="font-medium text-amber-200">Kenney Tiny Dungeon</span> — Created
                by Kenney (Kenney.nl), released under CC0 1.0 Universal Public Domain.
              </li>
              <li>
                <span className="font-medium text-amber-200">Game-Icons.net</span> — Provided by
                Lorc, Delapouite, Carl Olsen, and contributors, licensed under CC-BY 3.0.
              </li>
              <li>
                <span className="font-medium text-amber-200">RPG Awesome</span> — Created by
                Daniela Howe and contributors, font licensed under SIL OFL 1.1, CSS under
                MIT.
              </li>
              <li>
                <span className="font-medium text-amber-200">DawnLike 16x16 Tileset</span> — Created
                by DragonDePlatino &amp; DawnBringer, licensed under CC-BY 4.0 / CC-BY-SA 3.0.
              </li>
            </ul>
            <p
              data-testid="credits-item-icons-line"
              className="leading-relaxed text-slate-400 text-xs pt-1"
            >
              Item icons: game-icons.net contributors (CC BY 3.0); RPG Awesome (OFL/MIT);
              UI frames: Kenney.nl (CC0).
            </p>
          </section>
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-5 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm transition-colors focus:ring-2 focus:ring-amber-300 focus:outline-none"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
