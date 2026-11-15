import { type ChangeEvent, type DragEvent, useRef, useState } from 'react';
import {
  type CharacterBuildState,
  getPregenCharacter,
} from '@srd5/data';
import { computeDerivedCharacter } from '@srd5/engine';
import { formatTitleCase } from '../compendium/formatters.js';
import {
  type PartySlotAssignment,
  SLOT_ROLE_LABELS,
  type SlotRoleSuggestion,
} from './types.js';

export interface CampfirePartySlotCardProps {
  slotIndex: number;
  assignment: PartySlotAssignment;
  availableRosterCharacters: CharacterBuildState[];
  onAssignHero: (hero: CharacterBuildState | null, slotIndex: number) => void;
  onUpdateSeat: (
    slotIndex: number,
    seatUpdates: Partial<Pick<PartySlotAssignment, 'seatType' | 'playerSeatId'>>,
  ) => void;
  onOpenVaultModal: (slotIndex: number) => void;
  onRollNewHero?: (slotIndex: number) => void;
  onFileDrop: (fileText: string, slotIndex: number) => void;
}

async function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string) ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function CampfirePartySlotCard({
  slotIndex,
  assignment,
  availableRosterCharacters,
  onAssignHero,
  onUpdateSeat,
  onOpenVaultModal,
  onRollNewHero,
  onFileDrop,
}: CampfirePartySlotCardProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hero = assignment.character;
  const roleMeta = SLOT_ROLE_LABELS[assignment.roleSuggestion];

  // Derive stats for hero if present
  let derived: ReturnType<typeof computeDerivedCharacter> | null = null;
  if (hero) {
    try {
      derived = computeDerivedCharacter(hero);
    } catch {
      derived = null;
    }
  }

  // File drag-and-drop handlers
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      try {
        const text = await readFileText(file);
        onFileDrop(text, slotIndex);
      } catch {
        onFileDrop('', slotIndex);
      }
    }
  };

  const handleFileInputChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const text = await readFileText(file);
        onFileDrop(text, slotIndex);
      } catch {
        onFileDrop('', slotIndex);
      }
      // Reset input value so same file can be re-dropped/selected if desired
      e.target.value = '';
    }
  };

  // Iconic pregen match for this slot index
  const iconicIdForSlot = [
    'pregen-fighter',
    'pregen-rogue',
    'pregen-wizard',
    'pregen-cleric',
  ][slotIndex] ?? 'pregen-fighter';
  const defaultIconic = getPregenCharacter(iconicIdForSlot);

  return (
    <div
      data-testid={`wizard-party-slot-${slotIndex}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative rounded-xl border p-4 flex flex-col justify-between space-y-4 transition-all duration-200 ${
        isDragOver
          ? 'border-amber-400 bg-amber-950/40 ring-2 ring-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.3)]'
          : hero
            ? 'border-amber-600/40 bg-gradient-to-b from-slate-900 via-slate-900 to-amber-950/20 shadow-md'
            : 'border-dashed border-slate-800 bg-slate-900/30 text-slate-500 hover:border-slate-700 hover:bg-slate-900/40'
      }`}
    >
      {/* Hidden file input for .srd5.json */}
      <input
        type="file"
        ref={fileInputRef}
        data-testid={`wizard-slot-file-input-${slotIndex}`}
        accept=".json,.srd5.json"
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Slot Header: Role Suggestion & Clear Button */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
        <div className="flex items-center gap-1.5 overflow-hidden">
          <span className="text-sm">{roleMeta.icon}</span>
          <div className="overflow-hidden">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400/90 block truncate">
              Slot {slotIndex} &middot; {roleMeta.title}
            </span>
            <span className="text-[9px] text-slate-400 block truncate">
              {roleMeta.subtitle}
            </span>
          </div>
        </div>

        {hero && (
          <button
            type="button"
            data-testid={`wizard-clear-slot-${slotIndex}`}
            onClick={() => onAssignHero(null, slotIndex)}
            className="min-h-[28px] min-w-[28px] px-1.5 py-0.5 rounded text-[11px] font-semibold text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors focus:outline-none"
            title="Remove hero from slot"
            aria-label="Remove hero from slot"
          >
            ✕
          </button>
        )}
      </div>

      {/* Slot Center: Populated Hero or Empty State */}
      {hero ? (
        <div className="space-y-2">
          <div>
            <h4 className="text-base font-bold font-serif text-slate-100 flex items-center gap-1.5 truncate">
              <span>{hero.name}</span>
            </h4>
            <p className="text-xs text-amber-300 capitalize font-medium">
              {formatTitleCase(hero.raceId)}{' '}
              {hero.subraceId ? `(${formatTitleCase(hero.subraceId)}) ` : ''}
              {hero.classes[0]?.classId ? formatTitleCase(hero.classes[0].classId) : 'Hero'} (Level{' '}
              {hero.classes[0]?.level ?? 1})
            </p>
          </div>

          {/* Derived Combat Stats */}
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-center text-[10px]">
            <div>
              <div className="text-slate-400 uppercase font-semibold">Max HP</div>
              <div className="text-xs font-bold text-emerald-400">
                {derived?.maxHp ?? 10}
              </div>
            </div>
            <div>
              <div className="text-slate-400 uppercase font-semibold">AC</div>
              <div className="text-xs font-bold text-amber-300">
                {derived?.armorClass.totalAc ?? 10}
              </div>
            </div>
            <div>
              <div className="text-slate-400 uppercase font-semibold">Speed</div>
              <div className="text-xs font-bold text-slate-200">
                {derived?.speedFeet ?? 30}ft
              </div>
            </div>
          </div>

          {/* Ability Scores */}
          {hero.baseAbilities && (
            <div className="grid grid-cols-3 gap-1 pt-1 text-[10px] text-slate-400 font-mono">
              <div>STR {hero.baseAbilities.str}</div>
              <div>DEX {hero.baseAbilities.dex}</div>
              <div>CON {hero.baseAbilities.con}</div>
              <div>INT {hero.baseAbilities.int}</div>
              <div>WIS {hero.baseAbilities.wis}</div>
              <div>CHA {hero.baseAbilities.cha}</div>
            </div>
          )}
        </div>
      ) : (
        <div className="py-4 flex flex-col items-center justify-center space-y-2 text-center">
          <span className="text-2xl opacity-60">🏕️</span>
          <div className="text-xs font-semibold text-slate-400">
            (Empty Hero Slot)
          </div>
          <p className="text-[10px] text-slate-400 max-w-[180px]">
            Drop a .srd5.json file here or recruit a hero below.
          </p>
        </div>
      )}

      {/* Slot Actions Section */}
      <div className="space-y-2 pt-2 border-t border-slate-800/80">
        {!hero ? (
          <div className="grid grid-cols-2 gap-1.5">
            {/* Quick-Pick Pregen */}
            {defaultIconic && (
              <button
                type="button"
                data-testid={`wizard-slot-${slotIndex}-quick-pregen`}
                onClick={() => onAssignHero(defaultIconic, slotIndex)}
                className="min-h-[38px] px-2 py-1 rounded-lg border border-amber-900/60 bg-amber-950/30 hover:bg-amber-900/50 text-[11px] font-semibold text-amber-300 transition-colors focus:ring-1 focus:ring-amber-400 focus:outline-none truncate"
                title={`Quick-pick ${defaultIconic.name} (${defaultIconic.classes[0]?.classId})`}
              >
                ⚡ Quick {defaultIconic.classes[0]?.classId ? formatTitleCase(defaultIconic.classes[0].classId) : 'Pregen'}
              </button>
            )}

            {/* Character Vault Import */}
            <button
              type="button"
              data-testid={`wizard-slot-${slotIndex}-vault-btn`}
              onClick={() => onOpenVaultModal(slotIndex)}
              className="min-h-[38px] px-2 py-1 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-[11px] font-semibold text-slate-200 transition-colors focus:ring-1 focus:ring-amber-400 focus:outline-none truncate"
            >
              🏛️ Vault
            </button>

            {/* Roll New Hero */}
            <button
              type="button"
              data-testid={`wizard-roll-hero-slot-${slotIndex}`}
              onClick={() => onRollNewHero?.(slotIndex)}
              className="min-h-[38px] px-2 py-1 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-[11px] font-semibold text-slate-200 transition-colors focus:ring-1 focus:ring-amber-400 focus:outline-none truncate"
            >
              🎲 Roll Hero
            </button>

            {/* Import .srd5.json */}
            <button
              type="button"
              data-testid={`wizard-slot-${slotIndex}-import-btn`}
              onClick={() => fileInputRef.current?.click()}
              className="min-h-[38px] px-2 py-1 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-[11px] font-semibold text-slate-200 transition-colors focus:ring-1 focus:ring-amber-400 focus:outline-none truncate"
            >
              📁 Drop JSON
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-testid={`wizard-slot-${slotIndex}-vault-btn`}
              onClick={() => onOpenVaultModal(slotIndex)}
              className="flex-1 min-h-[36px] px-2 py-1 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-[11px] font-semibold text-slate-200 transition-colors focus:outline-none"
            >
              🏛️ Swap from Vault
            </button>
            <button
              type="button"
              data-testid={`wizard-roll-hero-slot-${slotIndex}`}
              onClick={() => onRollNewHero?.(slotIndex)}
              className="min-h-[36px] px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-[11px] font-semibold text-slate-200 transition-colors focus:outline-none"
              title="Roll a new hero in builder"
            >
              🎲
            </button>
          </div>
        )}

        {/* Quick Dropdown Swap (for backward compatibility & test suites) */}
        <div>
          <label
            htmlFor={`wizard-slot-${slotIndex}-select`}
            className="text-[9px] uppercase tracking-wider font-semibold text-slate-400 block mb-0.5"
          >
            Select Hero:
          </label>
          <select
            id={`wizard-slot-${slotIndex}-select`}
            data-testid={`wizard-slot-${slotIndex}-select`}
            value={hero?.id ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              if (!val) {
                onAssignHero(null, slotIndex);
                return;
              }
              const found =
                availableRosterCharacters.find((c) => c.id === val) ??
                getPregenCharacter(val) ??
                null;
              onAssignHero(found, slotIndex);
            }}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-amber-400 focus:outline-none"
          >
            <option value="">(None)</option>
            {availableRosterCharacters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({formatTitleCase(c.raceId)} {formatTitleCase(c.classes[0]?.classId ?? 'Hero')})
              </option>
            ))}
            {/* Always provide the 4 iconic options if not already in roster */}
            {!availableRosterCharacters.some((c) => c.id === 'pregen-fighter') && (
              <option value="pregen-fighter">Garrick Vance (Human Fighter)</option>
            )}
            {!availableRosterCharacters.some((c) => c.id === 'pregen-rogue') && (
              <option value="pregen-rogue">Vex Tealeaf (Halfling Rogue)</option>
            )}
            {!availableRosterCharacters.some((c) => c.id === 'pregen-wizard') && (
              <option value="pregen-wizard">Lyra Silversun (High Elf Wizard)</option>
            )}
            {!availableRosterCharacters.some((c) => c.id === 'pregen-cleric') && (
              <option value="pregen-cleric">Bram Ironheart (Hill Dwarf Cleric)</option>
            )}
          </select>
        </div>

        {/* Multiplayer Seat Assignment Hook (Future-Ready) */}
        <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between gap-1 text-[10px]">
          <span className="text-slate-400 font-medium">Seat:</span>
          <select
            data-testid={`wizard-slot-${slotIndex}-seat-type`}
            value={assignment.seatType}
            onChange={(e) =>
              onUpdateSeat(slotIndex, {
                seatType: e.target.value as 'local' | 'network_remote',
              })
            }
            className="rounded border border-slate-800 bg-slate-950 px-1.5 py-0.5 text-[10px] text-slate-300 focus:border-amber-400 focus:outline-none"
          >
            <option value="local">Local Player</option>
            <option value="network_remote">Remote Seat</option>
          </select>

          <input
            type="text"
            data-testid={`wizard-slot-${slotIndex}-seat-id`}
            value={assignment.playerSeatId ?? `Player ${slotIndex + 1}`}
            onChange={(e) =>
              onUpdateSeat(slotIndex, {
                playerSeatId: e.target.value,
              })
            }
            className="w-20 rounded border border-slate-800 bg-slate-950 px-1 py-0.5 text-[10px] text-slate-300 focus:border-amber-400 focus:outline-none"
            placeholder={`Player ${slotIndex + 1}`}
          />
        </div>
      </div>
    </div>
  );
}
