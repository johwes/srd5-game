import React, { useState, useEffect, useCallback, useId } from 'react';
import {
  DEFAULT_DUNGEON_SLOT_IDS,
  type DungeonSaveSlotData,
  getDefaultDungeonSlotLabel,
  loadDungeonSaveSlots,
  quickSaveDungeonGame,
  saveDungeonGameToSlot,
  defaultDungeonStorageAdapter,
} from '../../persistence/dungeonSavePersistence.js';
import {
  type AppSettings,
  loadAppSettings,
  saveAppSettings,
  resetAppSettings,
} from '../../persistence/settingsPersistence.js';
import type {
  PauseMenuModalProps,
  PauseMenuSubView,
  PauseMenuPartyMember,
} from './types.js';

export function PauseMenuModal({
  isOpen,
  onClose,
  gameState,
  campaignId = 'campaign_kaelen',
  campaignName = 'The Sunken Crypt of Kaelen',
  floorName = 'Current Floor',
  party,
  storageAdapter = defaultDungeonStorageAdapter,
  settingsStorage,
  onQuickSave,
  onSaveToSlot,
  onLoadFromSlot,
  onOpenCharacterSheet,
  onOpenInventory,
  onExitToTitle,
}: PauseMenuModalProps) {
  const [subView, setSubView] = useState<PauseMenuSubView>('main');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [slots, setSlots] = useState<Record<string, DungeonSaveSlotData>>({});
  const [settings, setSettings] = useState<AppSettings>(() =>
    loadAppSettings(settingsStorage),
  );
  const [isSaving, setIsSaving] = useState(false);

  // Reload slots when opening or entering save/load subviews
  const reloadSlots = useCallback(async () => {
    try {
      const loaded = await loadDungeonSaveSlots(storageAdapter);
      setSlots(loaded);
    } catch {
      // Ignored
    }
  }, [storageAdapter]);

  useEffect(() => {
    if (isOpen) {
      setSubView('main');
      setStatusMessage(null);
      setErrorMessage(null);
      setSettings(loadAppSettings(settingsStorage));
      void reloadSlots();
    }
  }, [isOpen, settingsStorage, reloadSlots]);

  // Keyboard navigation: Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (subView === 'main') {
          onClose();
        } else {
          setSubView('main');
          setStatusMessage(null);
          setErrorMessage(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, subView, onClose]);

  if (!isOpen) return null;

  // Extract party members from gameState or party prop
  const normalizedParty: PauseMenuPartyMember[] = (() => {
    const rawList = party
      ? Array.isArray(party)
        ? party
        : Object.values(party)
      : gameState?.party
        ? Object.values(gameState.party)
        : [];

    return rawList.map((hero: any, idx: number) => {
      const sheet = hero.characterSheet;
      const firstClass = sheet?.classes?.[0];
      const className =
        firstClass?.classId ??
        hero.className ??
        hero.classId ??
        'Adventurer';
      const level = sheet?.totalLevel ?? hero.level ?? 1;
      const currentHp = hero.currentHp ?? 10;
      const maxHp = hero.maxHp ?? 10;
      const ac = sheet?.armorClass?.totalAc ?? hero.ac ?? 10;
      const conditions: string[] = (hero.conditions ?? []).map((c: any) =>
        typeof c === 'string' ? c : c.condition ?? c.name ?? 'unknown',
      );
      const buffs = Array.isArray(hero.activeEffects)
        ? hero.activeEffects.map((e: any) => ({
            effectId: String(e.effectId ?? e.name ?? `buff-${idx}`),
            name: String(e.name ?? e.effectId ?? 'Buff'),
            remainingRounds:
              typeof e.remainingRounds === 'number' ? e.remainingRounds : undefined,
          }))
        : [];

      return {
        id: hero.id ?? `party-hero-${idx}`,
        name: hero.name ?? `Hero ${idx + 1}`,
        className,
        level,
        currentHp,
        maxHp,
        ac,
        conditions,
        buffs,
      };
    });
  })();

  const handleQuickSaveAction = async () => {
    setIsSaving(true);
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      if (onQuickSave) {
        await onQuickSave();
      } else if (gameState) {
        await quickSaveDungeonGame(
          gameState,
          { campaignId, campaignName, floorName },
          storageAdapter,
        );
      }
      await reloadSlots();
      const timeStr = new Date().toLocaleTimeString();
      setStatusMessage(`Game quicksaved successfully at ${timeStr}!`);
    } catch (err) {
      setErrorMessage(
        `Quicksave failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveToSlotAction = async (slotId: string, label: string) => {
    setIsSaving(true);
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      if (onSaveToSlot) {
        await onSaveToSlot(slotId, label);
      } else if (gameState) {
        await saveDungeonGameToSlot(
          slotId,
          label,
          gameState,
          { campaignId, campaignName, floorName },
          storageAdapter,
        );
      }
      await reloadSlots();
      setStatusMessage(`Game saved to ${label}!`);
    } catch (err) {
      setErrorMessage(
        `Save failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoadFromSlotAction = async (slotId: string) => {
    if (!onLoadFromSlot) return;
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      await onLoadFromSlot(slotId);
      onClose();
    } catch (err) {
      setErrorMessage(
        `Load failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const handleUpdateSetting = <K extends keyof AppSettings>(
    key: K,
    val: AppSettings[K],
  ) => {
    const updated = { ...settings, [key]: val };
    setSettings(updated);
    saveAppSettings(updated, settingsStorage);
  };

  const handleResetSettings = () => {
    const reset = resetAppSettings(settingsStorage);
    setSettings(reset);
    setStatusMessage('Settings reset to defaults.');
  };

  const titleText =
    subView === 'main'
      ? 'System Menu & Pause'
      : subView === 'save'
        ? 'Save Game'
        : subView === 'load'
          ? 'Load Game'
          : subView === 'party'
            ? 'Party Sheet & Inventory'
            : subView === 'settings'
              ? 'Settings & Options'
              : 'Exit Confirmation';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pause-menu-title"
      data-testid="pause-menu-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto"
    >
      <div className="relative w-full max-w-lg rounded-2xl border border-amber-500/40 bg-slate-950/95 p-5 sm:p-6 shadow-[0_0_50px_rgba(0,0,0,0.85)] text-slate-100 space-y-4 my-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <span className="text-xl sm:text-2xl">⚙️</span>
            <div>
              <h2
                id="pause-menu-title"
                className="text-lg sm:text-xl font-bold tracking-tight text-amber-400 font-serif"
              >
                {titleText}
              </h2>
              <p className="text-xs text-slate-400">
                {campaignName} &middot; {floorName}
              </p>
            </div>
          </div>
          <button
            type="button"
            data-testid="pause-menu-close-btn"
            onClick={onClose}
            aria-label="Resume Game"
            className="rounded-lg p-2 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus:ring-2 focus:ring-amber-400 focus:outline-none"
          >
            ✕
          </button>
        </div>

        {/* Status / Error Banner */}
        {statusMessage && (
          <div
            data-testid="pause-menu-status-msg"
            className="rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-3 py-2 text-xs font-medium text-emerald-300"
          >
            ✓ {statusMessage}
          </div>
        )}
        {errorMessage && (
          <div
            data-testid="pause-menu-error-msg"
            className="rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs font-medium text-red-300"
          >
            ✕ {errorMessage}
          </div>
        )}

        {/* 1. Main SubView */}
        {subView === 'main' && (
          <div className="space-y-2.5 py-1" data-testid="pause-menu-main-view">
            <button
              type="button"
              data-testid="pause-menu-resume-btn"
              onClick={onClose}
              className="w-full text-left px-4 py-3 rounded-xl border border-amber-500/50 bg-gradient-to-r from-amber-600/30 to-amber-700/20 hover:from-amber-600/40 hover:to-amber-700/30 text-amber-200 hover:text-amber-100 font-semibold transition-all shadow-md flex items-center justify-between group"
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">▶</span>
                <div>
                  <div className="text-sm font-bold">Resume Game</div>
                  <div className="text-[11px] text-amber-300/70">
                    Return to exploration and combat (Esc)
                  </div>
                </div>
              </div>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-amber-950/60 border border-amber-600/30 text-amber-300">
                Esc
              </span>
            </button>

            <button
              type="button"
              data-testid="pause-menu-quicksave-btn"
              onClick={() => void handleQuickSaveAction()}
              disabled={isSaving}
              className="w-full text-left px-4 py-3 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 hover:border-slate-600 text-slate-200 font-semibold transition-all flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">⚡</span>
                <div>
                  <div className="text-sm font-bold">Quicksave</div>
                  <div className="text-[11px] text-slate-400">
                    Save current progress instantly
                  </div>
                </div>
              </div>
              {slots['slot_quick'] && (
                <span className="text-[11px] text-slate-400 font-mono">
                  {new Date(slots['slot_quick'].savedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              )}
            </button>

            <button
              type="button"
              data-testid="pause-menu-save-btn"
              onClick={() => {
                setSubView('save');
                setStatusMessage(null);
                setErrorMessage(null);
              }}
              className="w-full text-left px-4 py-3 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 hover:border-slate-600 text-slate-200 font-semibold transition-all flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">💾</span>
                <div>
                  <div className="text-sm font-bold">Save Game...</div>
                  <div className="text-[11px] text-slate-400">
                    Select a save slot to record state
                  </div>
                </div>
              </div>
              <span className="text-slate-500">&rarr;</span>
            </button>

            <button
              type="button"
              data-testid="pause-menu-load-btn"
              onClick={() => {
                setSubView('load');
                setStatusMessage(null);
                setErrorMessage(null);
              }}
              className="w-full text-left px-4 py-3 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 hover:border-slate-600 text-slate-200 font-semibold transition-all flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">📂</span>
                <div>
                  <div className="text-sm font-bold">Load Game...</div>
                  <div className="text-[11px] text-slate-400">
                    Restore from a previously saved slot
                  </div>
                </div>
              </div>
              <span className="text-slate-500">&rarr;</span>
            </button>

            <button
              type="button"
              data-testid="pause-menu-party-btn"
              onClick={() => {
                setSubView('party');
                setStatusMessage(null);
                setErrorMessage(null);
              }}
              className="w-full text-left px-4 py-3 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 hover:border-slate-600 text-slate-200 font-semibold transition-all flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">👥</span>
                <div>
                  <div className="text-sm font-bold">Party Sheet &amp; Inventory</div>
                  <div className="text-[11px] text-slate-400">
                    Inspect stats, spells, conditions &amp; equipment
                  </div>
                </div>
              </div>
              <span className="text-slate-500">&rarr;</span>
            </button>

            <button
              type="button"
              data-testid="pause-menu-settings-btn"
              onClick={() => {
                setSubView('settings');
                setStatusMessage(null);
                setErrorMessage(null);
              }}
              className="w-full text-left px-4 py-3 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 hover:border-slate-600 text-slate-200 font-semibold transition-all flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">⚙️</span>
                <div>
                  <div className="text-sm font-bold">Settings &amp; Options</div>
                  <div className="text-[11px] text-slate-400">
                    Volume, animation speed, grid &amp; scaling
                  </div>
                </div>
              </div>
              <span className="text-slate-500">&rarr;</span>
            </button>

            <button
              type="button"
              data-testid="pause-menu-exit-btn"
              onClick={() => setSubView('confirm_exit')}
              className="w-full text-left px-4 py-3 rounded-xl border border-red-900/40 bg-red-950/20 hover:bg-red-950/40 hover:border-red-700/60 text-red-300 font-semibold transition-all flex items-center justify-between mt-3"
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">🚪</span>
                <div>
                  <div className="text-sm font-bold">Exit to Main Menu</div>
                  <div className="text-[11px] text-red-400/70">
                    Leave adventure and return to Title Screen
                  </div>
                </div>
              </div>
              <span className="text-red-400/50">&rarr;</span>
            </button>
          </div>
        )}

        {/* 2. Save Game SubView */}
        {subView === 'save' && (
          <div className="space-y-3" data-testid="pause-save-view">
            <div className="flex items-center justify-between">
              <button
                type="button"
                data-testid="pause-save-back-btn"
                onClick={() => setSubView('main')}
                className="text-xs font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1"
              >
                &larr; Back to System Menu
              </button>
              <span className="text-xs text-slate-400">Select slot to overwrite</span>
            </div>

            <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
              {DEFAULT_DUNGEON_SLOT_IDS.map((slotId) => {
                const existing = slots[slotId];
                const label = getDefaultDungeonSlotLabel(slotId);

                return (
                  <div
                    key={slotId}
                    data-testid={`pause-save-slot-card-${slotId}`}
                    className="p-3 rounded-xl border border-slate-800 bg-slate-900/70 flex items-center justify-between gap-3 hover:border-slate-700 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-200">
                          {label}
                        </span>
                        {existing && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                            {new Date(existing.savedAt).toLocaleDateString()} &middot;{' '}
                            {new Date(existing.savedAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 truncate mt-0.5">
                        {existing ? (
                          <span>
                            {existing.meta?.floorName || existing.floorId} &middot;{' '}
                            {existing.meta?.partySummary
                              ?.map((p) => p.name)
                              .join(', ') || 'Party of Adventurers'}
                          </span>
                        ) : (
                          <span className="italic text-slate-500">[Empty Slot]</span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      data-testid={`pause-save-slot-${slotId}`}
                      onClick={() => void handleSaveToSlotAction(slotId, label)}
                      disabled={isSaving}
                      className="px-3 py-1.5 rounded-lg border border-amber-600/50 bg-amber-950/40 hover:bg-amber-900/60 text-xs font-semibold text-amber-200 hover:text-amber-100 shrink-0 transition-colors"
                    >
                      Save
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 3. Load Game SubView */}
        {subView === 'load' && (
          <div className="space-y-3" data-testid="pause-load-view">
            <div className="flex items-center justify-between">
              <button
                type="button"
                data-testid="pause-load-back-btn"
                onClick={() => setSubView('main')}
                className="text-xs font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1"
              >
                &larr; Back to System Menu
              </button>
              <span className="text-xs text-slate-400">Select save to restore</span>
            </div>

            <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
              {Object.keys(slots).length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-500 italic">
                  No saved games found on this device.
                </div>
              ) : (
                Object.values(slots)
                  .sort(
                    (a, b) =>
                      new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
                  )
                  .map((slot) => {
                    const label = slot.slotName || getDefaultDungeonSlotLabel(slot.slotId);

                    return (
                      <div
                        key={slot.slotId}
                        data-testid={`pause-load-slot-card-${slot.slotId}`}
                        className="p-3 rounded-xl border border-slate-800 bg-slate-900/70 flex items-center justify-between gap-3 hover:border-slate-700 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-slate-200">
                              {label}
                            </span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                              {new Date(slot.savedAt).toLocaleDateString()} &middot;{' '}
                              {new Date(slot.savedAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <div className="text-xs text-slate-400 truncate mt-0.5">
                            {slot.meta?.floorName || slot.floorId} &middot;{' '}
                            {slot.meta?.partySummary
                              ?.map((p) => `${p.name} (L${p.level})`)
                              .join(', ') || 'Adventurers'}
                          </div>
                        </div>

                        <button
                          type="button"
                          data-testid={`pause-load-slot-${slot.slotId}`}
                          onClick={() => void handleLoadFromSlotAction(slot.slotId)}
                          className="px-3 py-1.5 rounded-lg border border-sky-600/50 bg-sky-950/40 hover:bg-sky-900/60 text-xs font-semibold text-sky-200 hover:text-sky-100 shrink-0 transition-colors"
                        >
                          Load
                        </button>
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        )}

        {/* 4. Party & Inventory SubView */}
        {subView === 'party' && (
          <div className="space-y-3" data-testid="pause-party-view">
            <div className="flex items-center justify-between">
              <button
                type="button"
                data-testid="pause-party-back-btn"
                onClick={() => setSubView('main')}
                className="text-xs font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1"
              >
                &larr; Back to System Menu
              </button>
              {onOpenInventory && (
                <button
                  type="button"
                  data-testid="pause-open-inventory-btn"
                  onClick={() => {
                    onClose();
                    onOpenInventory();
                  }}
                  className="text-xs font-semibold px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1 transition-colors"
                >
                  <span>🎒</span> Open Inventory
                </button>
              )}
            </div>

            <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
              {normalizedParty.map((hero) => {
                const hpPercent = Math.max(
                  0,
                  Math.min(100, Math.round((hero.currentHp / hero.maxHp) * 100)),
                );

                return (
                  <div
                    key={hero.id}
                    data-testid={`pause-hero-card-${hero.id}`}
                    className="p-3 rounded-xl border border-slate-800 bg-slate-900/80 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-amber-300 truncate">
                          {hero.name}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {hero.className} &middot; Level {hero.level}
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                          AC {hero.ac}
                        </span>
                      </div>

                      {/* HP Bar */}
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-2 flex-1 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full transition-all ${
                              hpPercent > 50
                                ? 'bg-emerald-500'
                                : hpPercent > 25
                                  ? 'bg-amber-500'
                                  : 'bg-red-500'
                            }`}
                            style={{ width: `${hpPercent}%` }}
                          />
                        </div>
                        <span className="text-[11px] font-mono text-slate-400 shrink-0">
                          {hero.currentHp} / {hero.maxHp} HP
                        </span>
                      </div>

                      {/* Conditions */}
                      {hero.conditions && hero.conditions.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {hero.conditions.map((cond, cIdx) => (
                            <span
                              key={cIdx}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-red-950/60 border border-red-800/40 text-red-300 font-medium"
                            >
                              {cond}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Active buffs (Bless, Haste, Rage, Shield, ...) */}
                      {hero.buffs && hero.buffs.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {hero.buffs.map((buff) => (
                            <span
                              key={buff.effectId}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/40 text-emerald-300 font-medium"
                              title={
                                buff.remainingRounds !== undefined
                                  ? `${buff.name} (${buff.remainingRounds} rounds left)`
                                  : buff.name
                              }
                            >
                              ✨ {buff.name}
                              {buff.remainingRounds !== undefined
                                ? ` (${buff.remainingRounds})`
                                : ''}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {onOpenCharacterSheet && (
                      <button
                        type="button"
                        data-testid={`pause-inspect-hero-${hero.id}`}
                        onClick={() => {
                          onClose();
                          onOpenCharacterSheet(hero.id);
                        }}
                        className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 hover:text-white text-xs font-semibold text-slate-300 shrink-0 transition-colors"
                      >
                        Inspect Sheet
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 5. Settings SubView */}
        {subView === 'settings' && (
          <div className="space-y-4" data-testid="pause-settings-view">
            <div className="flex items-center justify-between">
              <button
                type="button"
                data-testid="pause-settings-back-btn"
                onClick={() => setSubView('main')}
                className="text-xs font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1"
              >
                &larr; Back to System Menu
              </button>
              <button
                type="button"
                data-testid="pause-settings-reset-btn"
                onClick={handleResetSettings}
                className="text-xs text-slate-400 hover:text-slate-200 underline"
              >
                Reset to Defaults
              </button>
            </div>

            <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1 text-sm">
              {/* Audio Volume Controls */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 space-y-3">
                <div className="text-xs font-semibold text-amber-300 uppercase tracking-wider">
                  Audio &amp; Volume
                </div>

                <label className="flex items-center justify-between gap-4">
                  <span className="text-xs text-slate-300">Master Volume</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      data-testid="pause-settings-master-vol"
                      value={settings.masterVolume}
                      onChange={(e) =>
                        handleUpdateSetting('masterVolume', Number(e.target.value))
                      }
                      className="w-28 sm:w-36 accent-amber-500 cursor-pointer"
                    />
                    <span className="w-10 text-right text-xs font-mono text-amber-400">
                      {settings.masterVolume}%
                    </span>
                  </div>
                </label>

                <label className="flex items-center justify-between gap-4">
                  <span className="text-xs text-slate-300">Sound Effects (SFX)</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      data-testid="pause-settings-sfx-vol"
                      value={settings.sfxVolume}
                      onChange={(e) =>
                        handleUpdateSetting('sfxVolume', Number(e.target.value))
                      }
                      className="w-28 sm:w-36 accent-amber-500 cursor-pointer"
                    />
                    <span className="w-10 text-right text-xs font-mono text-amber-400">
                      {settings.sfxVolume}%
                    </span>
                  </div>
                </label>

                <label className="flex items-center justify-between gap-4">
                  <span className="text-xs text-slate-300">Music Volume</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      data-testid="pause-settings-music-vol"
                      value={settings.musicVolume}
                      onChange={(e) =>
                        handleUpdateSetting('musicVolume', Number(e.target.value))
                      }
                      className="w-28 sm:w-36 accent-amber-500 cursor-pointer"
                    />
                    <span className="w-10 text-right text-xs font-mono text-amber-400">
                      {settings.musicVolume}%
                    </span>
                  </div>
                </label>
              </div>

              {/* Combat & Gameplay Options */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 space-y-3">
                <div className="text-xs font-semibold text-amber-300 uppercase tracking-wider">
                  Combat &amp; Animations
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-300">Hotbar Icon Rows</span>
                  <div className="flex rounded-lg bg-slate-950 p-1 border border-slate-800">
                    {([1, 2, 3] as const).map((rowCount) => (
                      <button
                        key={rowCount}
                        type="button"
                        data-testid={`pause-settings-hotbar-rows-${rowCount}`}
                        onClick={() => handleUpdateSetting('hotbarRows', rowCount)}
                        title={`Show ${rowCount} icon row${rowCount === 1 ? '' : 's'} in the action hotbar (or drag the ═══ handle above the dock)`}
                        className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
                          settings.hotbarRows === rowCount
                            ? 'bg-amber-500 text-slate-950'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {rowCount}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-300">Animation Speed</span>
                  <div className="flex rounded-lg bg-slate-950 p-1 border border-slate-800">
                    {(['normal', 'fast', 'instant'] as const).map((spd) => (
                      <button
                        key={spd}
                        type="button"
                        data-testid={`pause-settings-speed-${spd}`}
                        onClick={() => handleUpdateSetting('animationSpeed', spd)}
                        className={`px-2.5 py-1 rounded text-xs font-semibold capitalize transition-colors ${
                          settings.animationSpeed === spd
                            ? 'bg-amber-500 text-slate-950'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {spd}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex items-center justify-between gap-4 cursor-pointer">
                  <div>
                    <div className="text-xs text-slate-300 font-semibold">
                      Fast AI Turns
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Accelerate monster turn movement and declarations
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    data-testid="pause-settings-fast-ai"
                    checked={settings.fastAiTurns}
                    onChange={(e) =>
                      handleUpdateSetting('fastAiTurns', e.target.checked)
                    }
                    className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between gap-4 cursor-pointer">
                  <div>
                    <div className="text-xs text-slate-300 font-semibold">
                      3D Dice Tray Animations
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Show animated rolling dice tray in combat HUD
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    data-testid="pause-settings-dice-tray"
                    checked={settings.diceTray3d}
                    onChange={(e) =>
                      handleUpdateSetting('diceTray3d', e.target.checked)
                    }
                    className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                  />
                </label>
              </div>

              {/* Display & Grid Options */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 space-y-3">
                <div className="text-xs font-semibold text-amber-300 uppercase tracking-wider">
                  Display &amp; Grid
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-300">UI Scale</span>
                  <div className="flex rounded-lg bg-slate-950 p-1 border border-slate-800">
                    {(['100%', '110%', '125%', '150%'] as const).map((sc) => (
                      <button
                        key={sc}
                        type="button"
                        data-testid={`pause-settings-scale-${sc.replace('%', '')}`}
                        onClick={() => handleUpdateSetting('uiScale', sc)}
                        className={`px-2 py-1 rounded text-xs font-semibold transition-colors ${
                          settings.uiScale === sc
                            ? 'bg-amber-500 text-slate-950'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {sc}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex items-center justify-between gap-4">
                  <span className="text-xs text-slate-300">Grid Overlay Brightness</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      data-testid="pause-settings-grid-brightness"
                      value={settings.gridBrightness}
                      onChange={(e) =>
                        handleUpdateSetting('gridBrightness', Number(e.target.value))
                      }
                      className="w-28 sm:w-36 accent-amber-500 cursor-pointer"
                    />
                    <span className="w-10 text-right text-xs font-mono text-amber-400">
                      {settings.gridBrightness}%
                    </span>
                  </div>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* 6. Exit Confirmation SubView */}
        {subView === 'confirm_exit' && (
          <div
            data-testid="pause-exit-confirm-dialog"
            className="rounded-xl border border-red-900/50 bg-red-950/20 p-5 space-y-4 text-center"
          >
            <div className="w-12 h-12 rounded-full bg-red-950/60 border border-red-700/50 flex items-center justify-center mx-auto text-2xl">
              ⚠️
            </div>
            <div className="space-y-1.5">
              <h3 className="text-base font-bold text-red-200">
                Return to Title Menu?
              </h3>
              <p className="text-xs text-slate-300 max-w-sm mx-auto leading-relaxed">
                Any unsaved progress since your last rest or quicksave will be lost.
                Return to Title Menu?
              </p>
            </div>

            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                data-testid="pause-exit-confirm-btn"
                onClick={() => {
                  onClose();
                  onExitToTitle();
                }}
                className="px-4 py-2.5 rounded-xl border border-red-600 bg-red-700 hover:bg-red-600 text-white text-xs font-bold transition-colors shadow-lg"
              >
                Yes, Exit to Title
              </button>
              <button
                type="button"
                data-testid="pause-exit-cancel-btn"
                onClick={() => setSubView('main')}
                className="px-4 py-2.5 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold transition-colors"
              >
                Cancel &amp; Stay
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
