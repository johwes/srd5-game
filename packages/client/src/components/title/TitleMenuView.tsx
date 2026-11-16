import React, { useState, useEffect } from 'react';
import { SRD_LEGAL_ATTRIBUTION, SRD_VERSION } from '@srd5/data';
import { getTransportInfo } from '@srd5/transport';
import {
  type DungeonSaveSlotData,
  defaultDungeonStorageAdapter,
  getLatestDungeonSaveSlot,
  loadAppSettings,
  loadDungeonSaveSlots,
  resetAppSettings,
  saveAppSettings,
} from '../../persistence/index.js';
import { TitleMenuCreditsModal } from './TitleMenuCreditsModal.js';
import { TitleMenuLoadModal } from './TitleMenuLoadModal.js';
import { TitleMenuSettingsModal } from './TitleMenuSettingsModal.js';
import type { AppSettings, TitleMenuViewProps } from './types.js';

export function TitleMenuView({
  onContinue,
  onNewGame,
  onLoadSlot,
  onOpenVault,
  onOpenBuilder,
  onOpenCompendium,
  onOpenArena,
  onOpenMultiplayer,
  storageAdapter = defaultDungeonStorageAdapter,
  activeSave: initialActiveSave,
  settings: initialSettings,
  onUpdateSettings,
}: TitleMenuViewProps) {
  const [latestSave, setLatestSave] = useState<DungeonSaveSlotData | null>(
    initialActiveSave ?? null,
  );
  const [isLoadingSaves, setIsLoadingSaves] = useState(true);
  const [isCreditsOpen, setIsCreditsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>(() =>
    initialSettings ? { ...initialSettings } : loadAppSettings(),
  );

  const transportInfo = getTransportInfo();

  useEffect(() => {
    let active = true;
    setIsLoadingSaves(true);
    void loadDungeonSaveSlots(storageAdapter).then((slots) => {
      if (active) {
        const detected = getLatestDungeonSaveSlot(slots);
        setLatestSave(detected ?? initialActiveSave ?? null);
        setIsLoadingSaves(false);
      }
    });
    return () => {
      active = false;
    };
  }, [storageAdapter, initialActiveSave]);

  const handleSaveSettings = (updated: AppSettings) => {
    setAppSettings(updated);
    saveAppSettings(updated);
    onUpdateSettings?.(updated);
  };

  const handleResetSettings = () => {
    const defaults = resetAppSettings();
    setAppSettings(defaults);
    onUpdateSettings?.(defaults);
  };

  const handleSelectSlotFromLoadModal = (slot: DungeonSaveSlotData) => {
    setLatestSave(slot);
    if (onLoadSlot) {
      onLoadSlot(slot);
    } else if (onContinue) {
      onContinue(slot);
    }
  };

  const formatContinueSubtitle = (save: DungeonSaveSlotData) => {
    const floor = save.meta.floorName || save.floorId;
    const heroCount = save.meta.partySummary?.length ?? 0;
    const partyText = heroCount === 1 ? '1 Hero' : `${heroCount} Heroes`;
    const dateText = save.savedAt
      ? new Date(save.savedAt).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';
    return `${save.meta.campaignName} — ${floor} · ${partyText}${dateText ? ` · ${dateText}` : ''}`;
  };

  return (
    <div
      data-testid="title-menu-view"
      className="relative min-h-screen w-full bg-slate-950 text-slate-100 flex flex-col justify-between overflow-x-hidden selection:bg-amber-500 selection:text-slate-950"
    >
      {/* Torchlight & Atmospheric Radial Glows */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 -left-40 h-96 w-96 rounded-full bg-amber-600/15 blur-3xl animate-pulse"
        style={{ animationDuration: '4s' }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 -right-40 h-96 w-96 rounded-full bg-amber-700/15 blur-3xl animate-pulse"
        style={{ animationDuration: '5s' }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 inset-x-0 h-64 bg-gradient-to-t from-slate-950 via-slate-950/80 to-transparent"
      />

      {/* Floating Ambient Embers Particles */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        {[
          { left: '10%', delay: '0s', duration: '7s' },
          { left: '25%', delay: '2s', duration: '6s' },
          { left: '40%', delay: '4s', duration: '8s' },
          { left: '60%', delay: '1s', duration: '7.5s' },
          { left: '75%', delay: '3s', duration: '6.5s' },
          { left: '90%', delay: '5s', duration: '9s' },
        ].map((ember, i) => (
          <div
            key={i}
            className="absolute bottom-2 h-1.5 w-1.5 rounded-full bg-amber-400/60 shadow-[0_0_8px_rgba(245,158,11,0.8)] animate-bounce"
            style={{
              left: ember.left,
              animationDuration: ember.duration,
              animationDelay: ember.delay,
            }}
          />
        ))}
      </div>

      {/* Top Bar / Steam Deck Ergonomics Header */}
      <header className="relative z-10 w-full max-w-6xl mx-auto px-4 pt-4 sm:pt-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]" />
          <span className="text-xs font-mono font-medium tracking-wide text-slate-400">
            SRD {SRD_VERSION} &middot; Engine v{transportInfo.engine.engineVersion}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {onOpenArena && (
            <button
              type="button"
              data-testid="title-menu-arena-btn"
              onClick={onOpenArena}
              className="min-h-[44px] px-3.5 py-1.5 rounded-lg border border-amber-900/60 bg-slate-900/80 hover:bg-slate-800 text-xs font-semibold text-amber-300 transition-colors focus:ring-2 focus:ring-amber-400 focus:outline-none"
            >
              ⚔️ Arena Skirmish
            </button>
          )}
          <button
            type="button"
            data-testid="title-menu-credits-btn"
            onClick={() => setIsCreditsOpen(true)}
            className="min-h-[44px] px-3.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900/80 hover:bg-slate-800 text-xs font-semibold text-slate-300 transition-colors focus:ring-2 focus:ring-amber-400 focus:outline-none"
          >
            📜 Credits &amp; Legal
          </button>
          <button
            type="button"
            data-testid="title-menu-settings-btn"
            onClick={() => setIsSettingsOpen(true)}
            aria-label="Settings and Options"
            className="min-h-[44px] px-3.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900/80 hover:bg-slate-800 text-xs font-semibold text-slate-300 transition-colors focus:ring-2 focus:ring-amber-400 focus:outline-none"
          >
            ⚙️ Settings
          </button>
        </div>
      </header>

      {/* Centerpiece / CRPG Title & Menu Options */}
      <main className="relative z-10 w-full max-w-md sm:max-w-lg mx-auto px-4 py-8 sm:py-12 flex flex-col items-center text-center space-y-8">
        {/* Title Branding */}
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-950/30 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-amber-300">
            <span>⚔️</span>
            <span>Tactical Turn-Based Dungeon Crawler</span>
            <span>🛡️</span>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight font-serif bg-gradient-to-b from-amber-100 via-amber-300 to-amber-600 bg-clip-text text-transparent drop-shadow-[0_4px_16px_rgba(245,158,11,0.35)]">
            DUNGEONS OF KAELEN
          </h1>

          <p className="text-xs sm:text-sm tracking-[0.25em] uppercase text-amber-200/80 font-semibold">
            SRD 5.1 Tactical Dungeon Crawler &middot; A 5e Tactical Roleplaying Game
          </p>
        </div>

        {/* Atmospheric Runic Divider */}
        <div className="flex items-center gap-3 w-full max-w-xs text-amber-600/50">
          <div className="flex-1 h-px bg-gradient-to-r from-transparent to-amber-600/50" />
          <span className="text-xs">✦ ⚔ ✦</span>
          <div className="flex-1 h-px bg-gradient-to-l from-transparent to-amber-600/50" />
        </div>

        {/* Primary Main Menu Buttons */}
        <div className="w-full space-y-3">
          {/* CONTINUE BUTTON */}
          <button
            type="button"
            data-testid="title-menu-continue-btn"
            disabled={!latestSave || isLoadingSaves}
            onClick={() => latestSave && onContinue?.(latestSave)}
            aria-disabled={!latestSave || isLoadingSaves}
            className={`w-full min-h-[54px] rounded-xl px-6 py-3 border text-left transition-all duration-200 flex flex-col justify-center focus:ring-2 focus:ring-amber-400 focus:outline-none ${
              latestSave && !isLoadingSaves
                ? 'border-amber-500/70 bg-gradient-to-r from-amber-950/80 via-slate-900 to-amber-950/80 hover:border-amber-400 hover:shadow-[0_0_20px_rgba(245,158,11,0.25)] text-slate-100 cursor-pointer'
                : 'border-slate-800 bg-slate-900/40 text-slate-500 cursor-not-allowed opacity-50'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-base sm:text-lg font-bold tracking-wide uppercase text-amber-300 flex items-center gap-2">
                <span>▶</span>
                <span>Continue</span>
              </span>
              {latestSave && !isLoadingSaves && (
                <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">
                  Active Save
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5 truncate">
              {latestSave
                ? formatContinueSubtitle(latestSave)
                : isLoadingSaves
                  ? 'Checking save slots…'
                  : '(No Saved Game Found)'}
            </p>
          </button>

          {/* NEW GAME BUTTON */}
          <button
            type="button"
            data-testid="title-menu-new-game-btn"
            onClick={onNewGame}
            className="w-full min-h-[54px] rounded-xl px-6 py-3 border border-amber-600/50 bg-slate-900/90 hover:bg-slate-800 hover:border-amber-400 hover:shadow-[0_0_15px_rgba(245,158,11,0.18)] text-slate-100 transition-all duration-200 flex flex-col justify-center text-left focus:ring-2 focus:ring-amber-400 focus:outline-none cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-base sm:text-lg font-bold tracking-wide uppercase text-slate-100 flex items-center gap-2">
                <span>✦</span>
                <span>New Game</span>
              </span>
              <span className="text-[11px] text-amber-400/80 font-medium">Campaign / Roguelite</span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Assemble a party and embark into the Sunken Crypt of Kaelen
            </p>
          </button>

          {/* MULTIPLAYER LOBBY BUTTON */}
          {onOpenMultiplayer && (
            <button
              type="button"
              data-testid="title-menu-multiplayer-btn"
              onClick={onOpenMultiplayer}
              className="w-full min-h-[50px] rounded-xl px-6 py-2.5 border border-sky-700/60 bg-slate-900/80 hover:bg-slate-800 hover:border-sky-500 text-slate-200 transition-colors flex items-center justify-between text-left focus:ring-2 focus:ring-sky-400 focus:outline-none cursor-pointer"
            >
              <span className="text-sm sm:text-base font-semibold tracking-wide flex items-center gap-2">
                <span>🌐</span>
                <span>Multiplayer Lobby</span>
              </span>
              <span className="text-xs text-slate-500">Room Codes · Co-op / PvP</span>
            </button>
          )}

          {/* LOAD GAME BUTTON */}
          <button
            type="button"
            data-testid="title-menu-load-game-btn"
            onClick={() => setIsLoadModalOpen(true)}
            className="w-full min-h-[50px] rounded-xl px-6 py-2.5 border border-slate-800 bg-slate-900/70 hover:bg-slate-800 hover:border-slate-700 text-slate-200 transition-colors flex items-center justify-between text-left focus:ring-2 focus:ring-amber-400 focus:outline-none cursor-pointer"
          >
            <span className="text-sm sm:text-base font-semibold tracking-wide flex items-center gap-2">
              <span>💾</span>
              <span>Load Game</span>
            </span>
            <span className="text-xs text-slate-500">Manage Save Slots</span>
          </button>

          {/* CHARACTER VAULT & BUILDER */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              data-testid="title-menu-vault-btn"
              onClick={onOpenVault}
              className="min-h-[48px] rounded-xl px-4 py-2.5 border border-slate-800 bg-slate-900/70 hover:bg-slate-800 hover:border-amber-600/50 text-slate-200 transition-colors flex items-center justify-between text-left focus:ring-2 focus:ring-amber-400 focus:outline-none cursor-pointer"
            >
              <span className="text-xs sm:text-sm font-semibold flex items-center gap-1.5">
                <span>👥</span>
                <span>Character Vault</span>
              </span>
              <span className="text-[10px] text-slate-400">Roster</span>
            </button>

            <button
              type="button"
              data-testid="title-menu-builder-btn"
              onClick={onOpenBuilder}
              className="min-h-[48px] rounded-xl px-4 py-2.5 border border-slate-800 bg-slate-900/70 hover:bg-slate-800 hover:border-amber-600/50 text-slate-200 transition-colors flex items-center justify-between text-left focus:ring-2 focus:ring-amber-400 focus:outline-none cursor-pointer"
            >
              <span className="text-xs sm:text-sm font-semibold flex items-center gap-1.5">
                <span>🎲</span>
                <span>Roll New Hero</span>
              </span>
              <span className="text-[10px] text-amber-400/90 font-medium">7-Step</span>
            </button>
          </div>

          {/* SRD 5.1 COMPENDIUM */}
          <button
            type="button"
            data-testid="title-menu-compendium-btn"
            onClick={onOpenCompendium}
            className="w-full min-h-[48px] rounded-xl px-6 py-2.5 border border-slate-800 bg-slate-900/60 hover:bg-slate-800 hover:border-slate-700 text-slate-300 transition-colors flex items-center justify-between text-left focus:ring-2 focus:ring-amber-400 focus:outline-none cursor-pointer"
          >
            <span className="text-xs sm:text-sm font-semibold flex items-center gap-2">
              <span>📖</span>
              <span>SRD 5.1 Rules Compendium</span>
            </span>
            <span className="text-[11px] text-slate-500">Offline Manual</span>
          </button>
        </div>
      </main>

      {/* Atmospheric Footer with Statutory CC-BY-4.0 Notice */}
      <footer className="relative z-10 w-full max-w-6xl mx-auto px-4 py-4 text-center border-t border-slate-800/80 text-xs text-slate-500 space-y-1">
        <p className="line-clamp-2 max-w-4xl mx-auto text-[11px] leading-relaxed text-slate-500">
          {SRD_LEGAL_ATTRIBUTION}
        </p>
        <p className="text-[10px] text-slate-600">
          Dungeons of Kaelen &middot; Built with pure deterministic TypeScript engine, WebGL viewport &amp; React HUD
        </p>
      </footer>

      {/* Modals */}
      <TitleMenuCreditsModal
        isOpen={isCreditsOpen}
        onClose={() => setIsCreditsOpen(false)}
      />

      <TitleMenuSettingsModal
        isOpen={isSettingsOpen}
        settings={appSettings}
        onClose={() => setIsSettingsOpen(false)}
        onSaveSettings={handleSaveSettings}
        onResetSettings={handleResetSettings}
      />

      <TitleMenuLoadModal
        isOpen={isLoadModalOpen}
        storageAdapter={storageAdapter}
        onClose={() => setIsLoadModalOpen(false)}
        onSelectSlot={handleSelectSlotFromLoadModal}
      />
    </div>
  );
}
