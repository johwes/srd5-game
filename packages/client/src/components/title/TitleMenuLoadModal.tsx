import React, { useState, useEffect, useRef } from 'react';
import {
  DEFAULT_DUNGEON_SLOT_IDS,
  type DungeonSaveSlotData,
  deleteDungeonSaveSlot,
  exportDungeonSaveToJson,
  getDefaultDungeonSlotLabel,
  importDungeonSaveFromJson,
  loadDungeonSaveSlots,
  triggerDungeonSaveDownload,
  defaultDungeonStorageAdapter,
} from '../../persistence/index.js';
import type { TitleMenuLoadModalProps } from './types.js';

export function TitleMenuLoadModal({
  isOpen,
  storageAdapter = defaultDungeonStorageAdapter,
  onClose,
  onSelectSlot,
}: TitleMenuLoadModalProps) {
  const [slots, setSlots] = useState<Record<string, DungeonSaveSlotData>>({});
  const [loadingSlotId, setLoadingSlotId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reloadSlots = async () => {
    try {
      const loaded = await loadDungeonSaveSlots(storageAdapter);
      setSlots(loaded);
    } catch {
      // Ignored
    }
  };

  useEffect(() => {
    if (isOpen) {
      void reloadSlots();
      setStatusMessage(null);
      setErrorMessage(null);
    }
  }, [isOpen]);

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

  const handleLoad = async (slotData: DungeonSaveSlotData) => {
    setLoadingSlotId(slotData.slotId);
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      onSelectSlot(slotData);
      onClose();
    } catch (err) {
      setErrorMessage(`Failed to load save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingSlotId(null);
    }
  };

  const handleDelete = async (slotId: string) => {
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      await deleteDungeonSaveSlot(slotId, storageAdapter);
      await reloadSlots();
      setStatusMessage(`Deleted save in ${getDefaultDungeonSlotLabel(slotId)}.`);
    } catch (err) {
      setErrorMessage(`Failed to delete save: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleExport = (slot: DungeonSaveSlotData) => {
    try {
      const json = exportDungeonSaveToJson(slot);
      const filename = `srd5-save-${slot.slotId}-${new Date().toISOString().slice(0, 10)}.json`;
      triggerDungeonSaveDownload(filename, json);
      setStatusMessage(`Exported ${slot.slotName} to ${filename}`);
    } catch (err) {
      setErrorMessage(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatusMessage(null);
    setErrorMessage(null);

    try {
      const text = await file.text();
      const result = importDungeonSaveFromJson(text);
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }

      onSelectSlot(result.data);
      onClose();
    } catch (err) {
      setErrorMessage(`Import error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const allSlotIds = Array.from(
    new Set([...DEFAULT_DUNGEON_SLOT_IDS, ...Object.keys(slots)]),
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="load-game-modal-title"
      data-testid="title-menu-load-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div className="relative w-full max-w-3xl rounded-xl border border-amber-500/40 bg-slate-900/95 p-6 shadow-2xl text-slate-100 space-y-5 my-8">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">💾</span>
            <h2
              id="load-game-modal-title"
              className="text-lg sm:text-xl font-bold tracking-tight text-amber-400 font-serif"
            >
              Load Saved Campaign
            </h2>
          </div>
          <button
            type="button"
            data-testid="title-menu-load-close-btn"
            onClick={onClose}
            aria-label="Close Load Game Modal"
            className="rounded-lg p-2 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus:ring-2 focus:ring-amber-400 focus:outline-none"
          >
            ✕
          </button>
        </div>

        {statusMessage && (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-4 py-2.5 text-xs text-emerald-300">
            {statusMessage}
          </div>
        )}

        {errorMessage && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-4 py-2.5 text-xs text-rose-300">
            {errorMessage}
          </div>
        )}

        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {allSlotIds.map((slotId) => {
            const slotData = slots[slotId];
            const label = getDefaultDungeonSlotLabel(slotId);
            const isPopulated = Boolean(slotData);

            return (
              <div
                key={slotId}
                className={`rounded-lg border p-4 transition-colors ${
                  isPopulated
                    ? 'border-amber-900/60 bg-slate-950/70 hover:border-amber-600/60'
                    : 'border-slate-800 bg-slate-950/30 text-slate-500'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-amber-300 text-sm">{label}</span>
                      {slotId === 'slot_auto' && (
                        <span className="rounded bg-amber-900/40 border border-amber-700/50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300 uppercase tracking-wider">
                          Auto
                        </span>
                      )}
                      {!isPopulated && (
                        <span className="text-xs italic text-slate-600">— Empty —</span>
                      )}
                    </div>

                    {isPopulated && slotData && (
                      <div className="mt-1 space-y-1 text-xs text-slate-300">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="text-slate-400">
                            Floor: <strong className="text-slate-200">{slotData.meta.floorName}</strong>
                          </span>
                          {slotData.meta.currentRoomName && (
                            <span className="text-slate-400">
                              Room: <strong className="text-slate-200">{slotData.meta.currentRoomName}</strong>
                            </span>
                          )}
                          <span className="text-slate-400">
                            Saved: {new Date(slotData.savedAt).toLocaleString()}
                          </span>
                        </div>

                        {slotData.meta.partySummary?.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {slotData.meta.partySummary.map((hero) => (
                              <div
                                key={hero.id}
                                className="rounded bg-slate-900 border border-slate-800 px-2 py-1 text-[11px]"
                              >
                                <span className="font-semibold text-amber-200">{hero.name}</span>{' '}
                                <span className="text-slate-400">({hero.className})</span>{' '}
                                <span className="text-emerald-400 font-mono">
                                  {hero.currentHp}/{hero.maxHp} HP
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {isPopulated && slotData && (
                    <div className="flex items-center gap-2 self-end sm:self-center">
                      <button
                        type="button"
                        data-testid={`load-slot-${slotId}-btn`}
                        disabled={loadingSlotId === slotId}
                        onClick={() => void handleLoad(slotData)}
                        className="min-h-[44px] px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs uppercase tracking-wider transition-colors disabled:opacity-50"
                      >
                        {loadingSlotId === slotId ? 'Loading…' : 'Load'}
                      </button>
                      <button
                        type="button"
                        data-testid={`export-slot-${slotId}-btn`}
                        onClick={() => handleExport(slotData)}
                        className="min-h-[44px] px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs transition-colors"
                        title="Export save to JSON file"
                      >
                        ⬇ Export
                      </button>
                      <button
                        type="button"
                        data-testid={`delete-slot-${slotId}-btn`}
                        onClick={() => void handleDelete(slotId)}
                        className="min-h-[44px] px-3 py-2 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-900/50 text-rose-300 text-xs transition-colors"
                        title="Delete this save slot"
                      >
                        🗑
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-800">
          <div>
            <label className="inline-flex items-center gap-2 cursor-pointer rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition-colors">
              <span>📂 Import Save (.json)</span>
              <input
                ref={fileInputRef}
                type="file"
                data-testid="import-save-input"
                accept=".json"
                onChange={(e) => void handleFileImport(e)}
                className="hidden"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
