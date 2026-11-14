import React, { useState, useEffect, useRef } from 'react';
import {
  DEFAULT_DUNGEON_SLOT_IDS,
  type DungeonSaveSlotData,
  deleteDungeonSaveSlot,
  exportDungeonSaveToJson,
  getDefaultDungeonSlotLabel,
  importDungeonSaveFromJson,
  loadDungeonSaveSlots,
  saveDungeonGameToSlot,
  triggerDungeonSaveDownload,
} from '../../persistence/index.js';
import type { SaveLoadModalProps } from './types.js';

export function SaveLoadModal({
  isOpen,
  gameState,
  campaignId,
  campaignName,
  floorName,
  onClose,
  onSaveToSlot,
  onLoadFromSlot,
  onImportSaveState,
}: SaveLoadModalProps) {
  const [slots, setSlots] = useState<Record<string, DungeonSaveSlotData>>({});
  const [loadingSlotId, setLoadingSlotId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reloadSlots = async () => {
    try {
      const loaded = await loadDungeonSaveSlots();
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

  if (!isOpen) return null;

  const handleSave = async (slotId: string) => {
    setLoadingSlotId(slotId);
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      const label = getDefaultDungeonSlotLabel(slotId);
      await saveDungeonGameToSlot(slotId, label, gameState, {
        campaignId,
        campaignName,
        floorName,
      });
      await reloadSlots();
      setStatusMessage(`Game saved successfully to ${label}!`);
      if (onSaveToSlot) {
        await onSaveToSlot(slotId, label);
      }
    } catch (err) {
      setErrorMessage(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingSlotId(null);
    }
  };

  const handleLoad = async (slotId: string) => {
    setLoadingSlotId(slotId);
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      await onLoadFromSlot(slotId);
      onClose();
    } catch (err) {
      setErrorMessage(`Failed to load: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingSlotId(null);
    }
  };

  const handleDelete = async (slotId: string) => {
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      await deleteDungeonSaveSlot(slotId);
      await reloadSlots();
      setStatusMessage(`Deleted save in ${getDefaultDungeonSlotLabel(slotId)}.`);
    } catch (err) {
      setErrorMessage(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleExport = (slot: DungeonSaveSlotData) => {
    const jsonStr = exportDungeonSaveToJson(slot);
    const filename = `${campaignId}-${slot.slotId}-${Date.now()}.srd5-save.json`;
    triggerDungeonSaveDownload(filename, jsonStr);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const res = importDungeonSaveFromJson(content);
      if (res.ok) {
        onImportSaveState(res.data.gameState);
        setStatusMessage('Imported dungeon save file successfully!');
        onClose();
      } else {
        setErrorMessage(res.error);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-load-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 shadow-2xl p-6 text-slate-100 space-y-5 animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]">
        <header className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h2 id="save-load-title" className="text-xl font-bold text-amber-400">
              💾 Dungeon Exploration Save &amp; Load Slots
            </h2>
            <p className="text-xs text-slate-400">
              Persist your delve progress across sessions or export portable{' '}
              <code className="text-amber-300">.srd5-save.json</code> files.
            </p>
          </div>
          <button
            type="button"
            data-testid="save-load-close-btn"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md text-lg"
          >
            ✕
          </button>
        </header>

        {statusMessage && (
          <div
            data-testid="save-load-status-banner"
            className="p-3 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs font-semibold"
          >
            ✓ {statusMessage}
          </div>
        )}

        {errorMessage && (
          <div
            data-testid="save-load-error-banner"
            className="p-3 rounded-lg bg-red-950/60 border border-red-500/40 text-red-300 text-xs font-semibold"
          >
            ✕ {errorMessage}
          </div>
        )}

        {/* Slot Cards List */}
        <div className="space-y-3 overflow-y-auto pr-1 flex-1">
          {DEFAULT_DUNGEON_SLOT_IDS.map((slotId) => {
            const slot = slots[slotId];
            const label = getDefaultDungeonSlotLabel(slotId);
            const isAuto = slotId === 'slot_auto';

            return (
              <div
                key={slotId}
                data-testid={`save-slot-card-${slotId}`}
                className={`p-4 rounded-lg border transition-all ${
                  slot
                    ? 'border-slate-700 bg-slate-950/70'
                    : 'border-slate-800/80 bg-slate-950/30'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-200">{label}</span>
                      {isAuto && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-sky-500/20 text-sky-300 border border-sky-500/30 font-semibold">
                          Auto-Save
                        </span>
                      )}
                      {slot && (
                        <span className="text-[11px] text-slate-400">
                          {new Date(slot.savedAt).toLocaleString()}
                        </span>
                      )}
                    </div>

                    {slot ? (
                      <div className="mt-1 space-y-0.5 text-xs text-slate-400">
                        <div>
                          Floor: <span className="text-amber-300">{slot.meta.floorName}</span>
                          {slot.meta.currentRoomName && (
                            <> &middot; Room: <span className="text-slate-300">{slot.meta.currentRoomName}</span></>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate max-w-md">
                          Party:{' '}
                          {slot.meta.partySummary
                            .map((p) => `${p.name} (HP ${p.currentHp}/${p.maxHp})`)
                            .join(', ')}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-slate-500 italic">
                        Empty Slot — Ready for save.
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center">
                    <button
                      type="button"
                      data-testid={`save-to-slot-btn-${slotId}`}
                      disabled={loadingSlotId === slotId}
                      onClick={() => handleSave(slotId)}
                      className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors shadow-sm"
                    >
                      {slot ? 'Overwrite' : 'Save Game'}
                    </button>

                    {slot && (
                      <>
                        <button
                          type="button"
                          data-testid={`load-from-slot-btn-${slotId}`}
                          disabled={loadingSlotId === slotId}
                          onClick={() => handleLoad(slotId)}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors shadow-sm"
                        >
                          Load Game
                        </button>

                        <button
                          type="button"
                          data-testid={`export-slot-btn-${slotId}`}
                          onClick={() => handleExport(slot)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
                          title="Export to .srd5-save.json file"
                        >
                          📥
                        </button>

                        <button
                          type="button"
                          data-testid={`delete-slot-btn-${slotId}`}
                          onClick={() => handleDelete(slotId)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-red-950 hover:text-red-300 text-slate-400 text-xs font-medium"
                          title="Delete save slot"
                        >
                          🗑️
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer Actions & Import */}
        <footer className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-800">
          <div>
            <input
              type="file"
              ref={fileInputRef}
              accept=".json,.srd5-save.json"
              className="hidden"
              onChange={handleImportFile}
            />
            <button
              type="button"
              data-testid="import-save-file-btn"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5"
            >
              <span>📤</span> Import .srd5-save.json
            </button>
          </div>

          <button
            type="button"
            data-testid="save-load-modal-done-btn"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
