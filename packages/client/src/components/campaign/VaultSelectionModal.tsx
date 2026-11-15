import { useMemo, useState } from 'react';
import type { CharacterBuildState } from '@srd5/data';
import { computeDerivedCharacter } from '@srd5/engine';
import { formatTitleCase } from '../compendium/formatters.js';

export interface VaultSelectionModalProps {
  slotIndex: number;
  availableCharacters: CharacterBuildState[];
  onSelectCharacter: (character: CharacterBuildState) => void;
  onClose: () => void;
}

export function VaultSelectionModal({
  slotIndex,
  availableCharacters,
  onSelectCharacter,
  onClose,
}: VaultSelectionModalProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredCharacters = useMemo(() => {
    if (!searchQuery.trim()) return availableCharacters;
    const q = searchQuery.toLowerCase();
    return availableCharacters.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.raceId.toLowerCase().includes(q) ||
        c.classes.some((cls) => cls.classId.toLowerCase().includes(q)),
    );
  }, [availableCharacters, searchQuery]);

  return (
    <div
      data-testid="vault-selection-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vault-modal-title"
    >
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-amber-600/40 bg-slate-950 text-slate-100 shadow-[0_0_30px_rgba(245,158,11,0.2)]">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 p-4 sm:p-5">
          <div>
            <h3
              id="vault-modal-title"
              className="text-lg sm:text-xl font-serif font-bold text-amber-400 flex items-center gap-2"
            >
              <span aria-hidden="true">🏛️</span>
              <span>Character Vault</span>
              <span className="text-xs font-sans font-semibold text-slate-400">
                (Slot {slotIndex + 1})
              </span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Select a veteran hero from your vault to join the campfire expedition.
            </p>
          </div>
          <button
            type="button"
            data-testid="vault-modal-close"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-white flex items-center justify-center transition-colors focus:ring-2 focus:ring-amber-400 focus:outline-none"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Filter Input */}
        <div className="p-4 border-b border-slate-800/80 bg-slate-900/40">
          <input
            type="search"
            data-testid="vault-modal-search"
            placeholder="Search by name, class, or race..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
        </div>

        {/* Hero Cards List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filteredCharacters.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400 space-y-2">
              <span className="text-3xl block">📭</span>
              <p>No characters match your search in the vault.</p>
            </div>
          ) : (
            filteredCharacters.map((hero) => {
              let derived;
              try {
                derived = computeDerivedCharacter(hero);
              } catch {
                derived = null;
              }

              const primaryClass = hero.classes[0];
              const level = hero.classes.reduce((acc, c) => acc + c.level, 0);

              return (
                <div
                  key={hero.id}
                  data-testid={`vault-hero-card-${hero.id}`}
                  className="rounded-xl border border-slate-800 bg-slate-900/80 p-3.5 sm:p-4 hover:border-amber-500/50 hover:bg-slate-900 transition-all flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm sm:text-base font-bold font-serif text-slate-100">
                        {hero.name}
                      </h4>
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        Level {level} {primaryClass ? formatTitleCase(primaryClass.classId) : 'Hero'}
                      </span>
                    </div>

                    <p className="text-xs text-slate-400">
                      {formatTitleCase(hero.raceId)}{' '}
                      {hero.subraceId ? `(${formatTitleCase(hero.subraceId)})` : ''} &middot;{' '}
                      Background: {hero.backgroundId ? formatTitleCase(hero.backgroundId) : 'Adventurer'}
                    </p>

                    <div className="flex items-center gap-3 pt-1 text-[11px] font-mono text-slate-300">
                      <span>HP: {derived?.maxHp ?? 10}</span>
                      <span>AC: {derived?.armorClass.totalAc ?? 10}</span>
                      <span>SPD: {derived?.speedFeet ?? 30}ft</span>
                      <span className="text-slate-400">
                        (STR {hero.baseAbilities?.str ?? 10} DEX {hero.baseAbilities?.dex ?? 10} CON {hero.baseAbilities?.con ?? 10})
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    data-testid={`vault-modal-assign-${hero.id}`}
                    onClick={() => {
                      onSelectCharacter(hero);
                      onClose();
                    }}
                    className="min-h-[44px] px-4 py-2 rounded-xl border border-amber-500/80 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-slate-950 font-bold text-xs uppercase tracking-wider transition-all focus:ring-2 focus:ring-amber-400 focus:outline-none self-end sm:self-center shrink-0 cursor-pointer shadow-sm"
                  >
                    Select Hero ➔
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="border-t border-slate-800 p-3 sm:p-4 bg-slate-950 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-700 bg-slate-900 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white transition-colors focus:ring-2 focus:ring-amber-400 focus:outline-none"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
