import React, { useState, useEffect } from 'react';
import type { TitleMenuSettingsModalProps, AppSettings } from './types.js';

export function TitleMenuSettingsModal({
  isOpen,
  settings: initialSettings,
  onClose,
  onSaveSettings,
  onResetSettings,
}: TitleMenuSettingsModalProps) {
  const [formState, setFormState] = useState<AppSettings>(initialSettings);

  useEffect(() => {
    setFormState(initialSettings);
  }, [initialSettings, isOpen]);

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

  const handleChange = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const updated = { ...formState, [key]: value };
    setFormState(updated);
    onSaveSettings(updated);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      data-testid="title-menu-settings-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div className="relative w-full max-w-xl rounded-xl border border-amber-500/40 bg-slate-900/95 p-6 shadow-2xl text-slate-100 space-y-5 my-8">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚙️</span>
            <h2
              id="settings-modal-title"
              className="text-lg sm:text-xl font-bold tracking-tight text-amber-400 font-serif"
            >
              Settings &amp; Options
            </h2>
          </div>
          <button
            type="button"
            data-testid="title-menu-settings-close-btn"
            onClick={onClose}
            aria-label="Close Settings Modal"
            className="rounded-lg p-2 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus:ring-2 focus:ring-amber-400 focus:outline-none"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
          {/* Audio Section */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-300">
              Audio Volumes
            </h3>

            <div className="space-y-3 text-sm">
              <label className="flex items-center justify-between gap-4">
                <span className="text-slate-300">Master Volume</span>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    data-testid="title-menu-settings-master-vol"
                    value={formState.masterVolume}
                    onChange={(e) => handleChange('masterVolume', Number(e.target.value))}
                    className="w-32 accent-amber-500 cursor-pointer"
                  />
                  <span className="w-10 text-right text-xs font-mono text-amber-400">
                    {formState.masterVolume}%
                  </span>
                </div>
              </label>

              <label className="flex items-center justify-between gap-4">
                <span className="text-slate-300">Sound Effects (SFX)</span>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    data-testid="title-menu-settings-sfx-vol"
                    value={formState.sfxVolume}
                    onChange={(e) => handleChange('sfxVolume', Number(e.target.value))}
                    className="w-32 accent-amber-500 cursor-pointer"
                  />
                  <span className="w-10 text-right text-xs font-mono text-amber-400">
                    {formState.sfxVolume}%
                  </span>
                </div>
              </label>

              <label className="flex items-center justify-between gap-4">
                <span className="text-slate-300">Music &amp; Atmosphere</span>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    data-testid="title-menu-settings-music-vol"
                    value={formState.musicVolume}
                    onChange={(e) => handleChange('musicVolume', Number(e.target.value))}
                    className="w-32 accent-amber-500 cursor-pointer"
                  />
                  <span className="w-10 text-right text-xs font-mono text-amber-400">
                    {formState.musicVolume}%
                  </span>
                </div>
              </label>
            </div>
          </div>

          {/* Gameplay & Display Section */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-300">
              Gameplay &amp; Display
            </h3>

            <div className="space-y-3 text-sm">
              <label className="flex items-center justify-between gap-4">
                <span className="text-slate-300">Combat Animation Speed</span>
                <select
                  data-testid="title-menu-settings-anim-speed"
                  value={formState.animationSpeed}
                  onChange={(e) =>
                    handleChange('animationSpeed', e.target.value as AppSettings['animationSpeed'])
                  }
                  className="rounded bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs text-slate-200 focus:ring-2 focus:ring-amber-500"
                >
                  <option value="normal">Normal (Default)</option>
                  <option value="fast">Fast (2× Speed)</option>
                  <option value="instant">Instant (No delay)</option>
                </select>
              </label>

              <label className="flex items-center justify-between gap-4">
                <span className="text-slate-300">UI Scale (Handheld / High-DPI)</span>
                <select
                  data-testid="title-menu-settings-ui-scale"
                  value={formState.uiScale}
                  onChange={(e) =>
                    handleChange('uiScale', e.target.value as AppSettings['uiScale'])
                  }
                  className="rounded bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs text-slate-200 focus:ring-2 focus:ring-amber-500"
                >
                  <option value="100%">100% (Standard)</option>
                  <option value="110%">110% (Handheld)</option>
                  <option value="125%">125% (Large)</option>
                  <option value="150%">150% (Accessible)</option>
                </select>
              </label>

              <label className="flex items-center justify-between gap-4">
                <span className="text-slate-300">Tactical 5-ft Grid Visibility</span>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    data-testid="title-menu-settings-grid-brightness"
                    value={formState.gridBrightness}
                    onChange={(e) => handleChange('gridBrightness', Number(e.target.value))}
                    className="w-32 accent-amber-500 cursor-pointer"
                  />
                  <span className="w-10 text-right text-xs font-mono text-amber-400">
                    {formState.gridBrightness}%
                  </span>
                </div>
              </label>
            </div>
          </div>

          {/* Toggles */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-300">
              Visual Options
            </h3>

            <div className="space-y-3 text-sm">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-slate-300">Animated 3D Dice Tray</span>
                <input
                  type="checkbox"
                  data-testid="title-menu-settings-dice-toggle"
                  checked={formState.diceTray3d}
                  onChange={(e) => handleChange('diceTray3d', e.target.checked)}
                  className="h-5 w-5 rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-amber-500"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-slate-300">Fast AI Turns (Skip AI path delay)</span>
                <input
                  type="checkbox"
                  data-testid="title-menu-settings-fast-ai-toggle"
                  checked={formState.fastAiTurns}
                  onChange={(e) => handleChange('fastAiTurns', e.target.checked)}
                  className="h-5 w-5 rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-amber-500"
                />
              </label>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-slate-800">
          <button
            type="button"
            data-testid="title-menu-settings-reset-btn"
            onClick={onResetSettings}
            className="min-h-[44px] px-4 py-2 text-xs font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 rounded-lg transition-colors border border-rose-900/40"
          >
            Reset to Defaults
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-6 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm transition-colors focus:ring-2 focus:ring-amber-300 focus:outline-none"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
