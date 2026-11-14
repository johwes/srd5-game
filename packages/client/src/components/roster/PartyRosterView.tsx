import { type ChangeEvent, useState } from 'react';
import {
  type CharacterBuildState,
  type SrdCompendium,
  defaultCompendium,
} from '@srd5/data';
import { MAX_CHARACTER_LEVEL, computeDerivedCharacter } from '@srd5/engine';
import {
  MAX_PARTY_SIZE,
  MIN_PARTY_SIZE,
  type PersistedRosterData,
  formatSrd5Filename,
  mergeImportedCharactersIntoRoster,
  movePartyMemberOrder,
  parseSrd5JsonImport,
  removeRosterCharacter,
  serializeCharacterToSrd5Json,
  serializeRosterToSrd5Json,
  togglePartyMember,
  triggerSrd5FileDownload,
} from '../../persistence/index.js';
import {
  formatSignedNumber,
  formatTitleCase,
} from '../compendium/formatters.js';

export interface PartyRosterViewProps {
  roster: PersistedRosterData;
  compendium?: SrdCompendium;
  onUpdateRoster: (nextRoster: PersistedRosterData) => void;
  onResetToIconics: () => void;
  onInspectCharacter: (character: CharacterBuildState) => void;
  onLevelUpCharacter: (character: CharacterBuildState) => void;
  onEditInBuilder?: (character: CharacterBuildState) => void;
  onCreateNewHero?: () => void;
  onEnterArena?: () => void;
  onEnterDungeon?: () => void;
}

export function PartyRosterView({
  roster,
  compendium = defaultCompendium,
  onUpdateRoster,
  onResetToIconics,
  onInspectCharacter,
  onLevelUpCharacter,
  onEditInBuilder,
  onCreateNewHero,
  onEnterArena,
  onEnterDungeon,
}: PartyRosterViewProps) {
  const [jsonModalMode, setJsonModalMode] = useState<'export' | 'import' | null>(
    null,
  );
  const [jsonModalTitle, setJsonModalTitle] = useState<string>('');
  const [jsonModalFilename, setJsonModalFilename] = useState<string>('');
  const [jsonText, setJsonText] = useState<string>('');
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const activePartyCharacters = roster.activePartyIds
    .map((id) => roster.characters.find((c) => c.id === id))
    .filter((c): c is CharacterBuildState => c !== undefined);

  const isPartyValid =
    activePartyCharacters.length >= MIN_PARTY_SIZE &&
    activePartyCharacters.length <= MAX_PARTY_SIZE;

  const avgPartyLevel =
    activePartyCharacters.length > 0
      ? (
          activePartyCharacters.reduce(
            (sum, c) =>
              sum + c.classes.reduce((cSum, entry) => cSum + entry.level, 0),
            0,
          ) / activePartyCharacters.length
        ).toFixed(1)
      : '0.0';

  const handleTogglePartySlot = (characterId: string) => {
    setErrorBanner(null);
    const res = togglePartyMember(roster, characterId);
    if (res.error) {
      setErrorBanner(res.error);
      return;
    }
    onUpdateRoster(res.roster);
  };

  const handleMoveSlot = (characterId: string, direction: 'up' | 'down') => {
    setErrorBanner(null);
    onUpdateRoster(movePartyMemberOrder(roster, characterId, direction));
  };

  const handleDeleteCharacter = (characterId: string, name: string) => {
    setErrorBanner(null);
    onUpdateRoster(removeRosterCharacter(roster, characterId));
    setStatusBanner(`Removed ${name} from roster.`);
  };

  const handleExportSingleCharacter = (character: CharacterBuildState) => {
    const content = serializeCharacterToSrd5Json(character);
    const filename = formatSrd5Filename(character.name, 'character');
    setJsonModalMode('export');
    setJsonModalTitle(`Export Character: ${character.name}`);
    setJsonModalFilename(filename);
    setJsonText(content);
    setImportErrors([]);
    triggerSrd5FileDownload(filename, content);
  };

  const handleExportFullRoster = () => {
    const content = serializeRosterToSrd5Json(roster);
    const filename = formatSrd5Filename('party-roster', 'roster');
    setJsonModalMode('export');
    setJsonModalTitle('Export Party Roster (.srd5.json)');
    setJsonModalFilename(filename);
    setJsonText(content);
    setImportErrors([]);
    triggerSrd5FileDownload(filename, content);
  };

  const handleOpenImportModal = () => {
    setJsonModalMode('import');
    setJsonModalTitle('Import Character or Party (.srd5.json)');
    setJsonModalFilename('');
    setJsonText('');
    setImportErrors([]);
  };

  const handleFileInputChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setJsonText(text);
    setImportErrors([]);
  };

  const handleConfirmImport = () => {
    const parsed = parseSrd5JsonImport(jsonText, compendium);
    if (!parsed.ok) {
      setImportErrors(parsed.errors);
      return;
    }
    const nextRoster = mergeImportedCharactersIntoRoster(roster, parsed, {
      replaceActiveParty: parsed.format === 'srd5-roster',
    });
    onUpdateRoster(nextRoster);
    setJsonModalMode(null);
    setImportErrors([]);
    setStatusBanner(
      `Imported ${parsed.characters.length} character(s): ${parsed.characters
        .map((c) => c.name)
        .join(', ')}.`,
    );
  };

  return (
    <div data-testid="party-roster-view" className="space-y-6">
      {/* Top Tavern & Party Roster Header */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-xl font-bold text-amber-400">
              Party Roster &amp; Adventurers&apos; Tavern
            </h2>
            <span
              data-testid="roster-active-party-badge"
              className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                isPartyValid
                  ? 'bg-emerald-950/70 border-emerald-700 text-emerald-300'
                  : 'bg-rose-950/70 border-rose-700 text-rose-300'
              }`}
            >
              Active Party: {activePartyCharacters.length} / {MAX_PARTY_SIZE} Heroes
            </span>
            <span className="text-xs text-slate-400 font-mono">
              Avg Party Level: {avgPartyLevel}
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Assemble a 1&ndash;4 hero Party Roster, inspect full derived character sheets
            and formula breakdowns, level up heroes, or export/import portable{' '}
            <code className="text-amber-300">.srd5.json</code> files.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onEnterDungeon && (
            <button
              type="button"
              data-testid="roster-enter-dungeon-btn"
              onClick={onEnterDungeon}
              disabled={!isPartyValid}
              className="px-3.5 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-xs font-bold hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40 shadow-sm transition-all flex items-center gap-1.5"
            >
              <span>🏰</span> Delve Dungeon
            </button>
          )}
          {onEnterArena && (
            <button
              type="button"
              data-testid="roster-enter-arena-btn"
              onClick={onEnterArena}
              className="px-3.5 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 text-xs font-bold hover:from-amber-400 hover:to-amber-500 shadow-sm transition-all flex items-center gap-1.5"
            >
              <span>⚔️</span> Enter Arena
            </button>
          )}
          {onCreateNewHero && (
            <button
              type="button"
              data-testid="roster-create-hero-btn"
              onClick={onCreateNewHero}
              className="px-3.5 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold hover:bg-amber-400 transition-colors"
            >
              + Create New Hero
            </button>
          )}
          <button
            type="button"
            data-testid="roster-open-import-btn"
            onClick={handleOpenImportModal}
            className="px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-xs font-semibold text-slate-200 hover:border-amber-500/60"
          >
            Import .srd5.json
          </button>
          <button
            type="button"
            data-testid="roster-export-party-btn"
            onClick={handleExportFullRoster}
            className="px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-xs font-semibold text-slate-200 hover:border-amber-500/60"
          >
            Export Roster (.srd5.json)
          </button>
          <button
            type="button"
            data-testid="roster-reset-iconics-btn"
            onClick={() => {
              onResetToIconics();
              setStatusBanner('Reset roster to the 4 iconic SRD 5.1 Level 1 heroes.');
              setErrorBanner(null);
            }}
            className="px-3 py-2 rounded-lg border border-slate-800 bg-slate-950 text-xs text-slate-400 hover:text-slate-200"
          >
            Reset Iconic Party
          </button>
        </div>
      </section>

      {/* Status & Error Banners */}
      {statusBanner && (
        <div
          data-testid="roster-status-banner"
          className="rounded-lg border border-emerald-700/60 bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-200 flex items-center justify-between"
        >
          <span>{statusBanner}</span>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="text-emerald-400 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {errorBanner && (
        <div
          data-testid="roster-error-banner"
          className="rounded-lg border border-rose-700/60 bg-rose-950/30 px-4 py-2.5 text-xs text-rose-200 flex items-center justify-between"
        >
          <span>{errorBanner}</span>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="text-rose-400 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Active Party Marching Order Slots (1 to 4 Heroes) */}
      <section
        data-testid="roster-active-party-section"
        className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-amber-300">
            Active Party Marching Order (1&ndash;4 Heroes)
          </h3>
          <span className="text-xs text-slate-400">
            Slot 1 leads the party in dungeon exploration
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((slotIdx) => {
            const hero = activePartyCharacters[slotIdx];
            if (!hero) {
              return (
                <div
                  key={slotIdx}
                  data-testid={`roster-party-slot-empty-${slotIdx + 1}`}
                  className="rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-4 flex flex-col items-center justify-center text-center min-h-[120px]"
                >
                  <div className="text-xs font-semibold text-slate-500">
                    Party Slot {slotIdx + 1} (Empty)
                  </div>
                  <div className="text-[11px] text-slate-600 mt-1">
                    Add a hero from the roster below
                  </div>
                </div>
              );
            }

            const derived = computeDerivedCharacter(hero, compendium);
            return (
              <div
                key={hero.id}
                data-testid={`roster-party-slot-${slotIdx + 1}`}
                className="rounded-xl border border-amber-500/40 bg-slate-950 p-3.5 flex flex-col justify-between gap-2.5"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
                      Slot {slotIdx + 1}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={slotIdx === 0}
                        data-testid={`roster-party-move-up-${hero.id}`}
                        onClick={() => handleMoveSlot(hero.id, 'up')}
                        className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-300 disabled:opacity-30"
                        title="Move Forward in Marching Order"
                      >
                        &larr;
                      </button>
                      <button
                        type="button"
                        disabled={slotIdx === activePartyCharacters.length - 1}
                        data-testid={`roster-party-move-down-${hero.id}`}
                        onClick={() => handleMoveSlot(hero.id, 'down')}
                        className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-300 disabled:opacity-30"
                        title="Move Back in Marching Order"
                      >
                        &rarr;
                      </button>
                    </div>
                  </div>
                  <div className="font-bold text-sm text-slate-100 truncate">
                    {derived.name}
                  </div>
                  <div className="text-xs text-slate-400 truncate">
                    L{derived.totalLevel} {derived.subraceName ?? derived.raceName}{' '}
                    {derived.classes.map((c) => c.className).join('/')}
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs font-mono pt-2 border-t border-slate-900">
                  <span>
                    HP <strong className="text-emerald-300">{derived.maxHp}</strong>
                  </span>
                  <span>
                    AC{' '}
                    <strong className="text-amber-300">
                      {derived.armorClass.totalAc}
                    </strong>
                  </span>
                  <button
                    type="button"
                    data-testid={`roster-party-slot-remove-${hero.id}`}
                    onClick={() => handleTogglePartySlot(hero.id)}
                    className="text-[11px] text-rose-400 hover:text-rose-300 font-sans"
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* All Saved Heroes in Roster */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-200">
          Saved Heroes in Roster ({roster.characters.length})
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {roster.characters.map((hero) => {
            const derived = computeDerivedCharacter(hero, compendium);
            const inParty = roster.activePartyIds.includes(hero.id);
            const primaryAttack = derived.weaponAttacks[0];

            return (
              <div
                key={hero.id}
                data-testid={`roster-hero-card-${hero.id}`}
                className={`rounded-xl border p-4 space-y-3 transition-all ${
                  inParty
                    ? 'bg-slate-900/90 border-amber-500/50'
                    : 'bg-slate-900/50 border-slate-800'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-bold text-base text-amber-300">
                        {derived.name}
                      </h4>
                      <span
                        data-testid={`roster-hero-level-${hero.id}`}
                        className="px-2 py-0.5 rounded bg-slate-800 text-xs font-semibold text-slate-200"
                      >
                        Level {derived.totalLevel}
                      </span>
                      {inParty && (
                        <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-700/60 text-[11px] font-semibold text-emerald-300">
                          In Party (Slot {roster.activePartyIds.indexOf(hero.id) + 1})
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {derived.subraceName ?? derived.raceName} &middot;{' '}
                      {derived.classes
                        .map(
                          (c) =>
                            `${c.className}${c.subclassName ? ` (${c.subclassName})` : ''} ${c.level}`,
                        )
                        .join(' / ')}{' '}
                      &middot; {formatTitleCase(derived.alignment)}
                    </p>
                  </div>

                  <button
                    type="button"
                    data-testid={`roster-party-toggle-${hero.id}`}
                    onClick={() => handleTogglePartySlot(hero.id)}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold border shrink-0 ${
                      inParty
                        ? 'bg-slate-950 border-slate-700 text-slate-300 hover:border-rose-500/60 hover:text-rose-300'
                        : 'bg-emerald-600/20 border-emerald-500/60 text-emerald-300 hover:bg-emerald-600/30'
                    }`}
                  >
                    {inParty ? 'Remove from Party' : '+ Add to Party'}
                  </button>
                </div>

                {/* Quick Vitals Strip */}
                <div className="grid grid-cols-4 gap-2 rounded-lg bg-slate-950 border border-slate-800/80 p-2.5 text-center text-xs font-mono">
                  <div>
                    <div className="text-[10px] text-slate-400 uppercase">HP</div>
                    <div className="font-bold text-emerald-300">
                      {derived.currentHp}/{derived.maxHp}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 uppercase">AC</div>
                    <div className="font-bold text-amber-300">
                      {derived.armorClass.totalAc}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 uppercase">Init</div>
                    <div className="font-bold text-slate-200">
                      {formatSignedNumber(derived.initiative.bonus)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 uppercase">
                      {derived.spellcasting.isSpellcaster ? 'Spell DC' : 'Attack'}
                    </div>
                    <div className="font-bold text-purple-300">
                      {derived.spellcasting.isSpellcaster
                        ? `DC ${derived.spellcasting.primarySpellSaveDc}`
                        : primaryAttack
                          ? formatSignedNumber(primaryAttack.toHitBonus)
                          : '+0'}
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      data-testid={`roster-inspect-sheet-${hero.id}`}
                      onClick={() => onInspectCharacter(hero)}
                      className="px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/50 text-amber-300 text-xs font-semibold hover:bg-amber-500/25"
                    >
                      Character Sheet
                    </button>
                    {derived.totalLevel < MAX_CHARACTER_LEVEL && (
                      <button
                        type="button"
                        data-testid={`roster-level-up-${hero.id}`}
                        onClick={() => onLevelUpCharacter(hero)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/50 text-emerald-300 text-xs font-semibold hover:bg-emerald-500/25"
                      >
                        &uarr; Level Up
                      </button>
                    )}
                    {onEditInBuilder && (
                      <button
                        type="button"
                        data-testid={`roster-edit-builder-${hero.id}`}
                        onClick={() => onEditInBuilder(hero)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 text-xs hover:text-white"
                      >
                        Edit Build
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      data-testid={`roster-export-char-${hero.id}`}
                      onClick={() => handleExportSingleCharacter(hero)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 text-xs hover:border-amber-500/50"
                    >
                      Export .srd5.json
                    </button>
                    <button
                      type="button"
                      data-testid={`roster-delete-char-${hero.id}`}
                      onClick={() => handleDeleteCharacter(hero.id, hero.name)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-rose-400 text-xs hover:border-rose-500/50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Portable .srd5.json Export / Import Modal */}
      {jsonModalMode && (
        <div
          data-testid="roster-srd5-json-modal"
          className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-950 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-amber-400">
                  {jsonModalTitle}
                </h3>
                {jsonModalFilename && (
                  <p
                    data-testid="roster-export-filename"
                    className="text-xs text-slate-400 font-mono"
                  >
                    File: {jsonModalFilename}
                  </p>
                )}
              </div>
              <button
                type="button"
                data-testid="roster-json-modal-close-btn"
                onClick={() => setJsonModalMode(null)}
                className="px-3 py-1 rounded border border-slate-700 bg-slate-900 text-xs text-slate-300 hover:text-white"
              >
                Close
              </button>
            </div>

            {jsonModalMode === 'import' && (
              <div className="space-y-2 text-xs">
                <label
                  htmlFor="roster-import-file-input"
                  className="block text-slate-300 font-medium"
                >
                  Upload a <code className="text-amber-300">.srd5.json</code> file or
                  paste JSON below:
                </label>
                <input
                  id="roster-import-file-input"
                  data-testid="roster-import-file-input"
                  type="file"
                  accept=".json,.srd5.json"
                  onChange={handleFileInputChange}
                  className="block w-full text-xs text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-amber-300 hover:file:bg-slate-700"
                />
              </div>
            )}

            <textarea
              data-testid="roster-json-textarea"
              readOnly={jsonModalMode === 'export'}
              value={jsonText}
              onChange={(e) => {
                setJsonText(e.target.value);
                setImportErrors([]);
              }}
              placeholder="Paste .srd5.json character or party roster JSON here..."
              rows={12}
              className="w-full rounded-xl bg-slate-900 border border-slate-800 p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-amber-400"
            />

            {importErrors.length > 0 && (
              <div
                data-testid="roster-import-errors"
                className="rounded-lg border border-rose-700/70 bg-rose-950/30 p-3 text-xs text-rose-200 space-y-1"
              >
                <div className="font-semibold text-rose-300">
                  Import Validation Failed:
                </div>
                <ul className="list-disc list-inside space-y-0.5">
                  {importErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              {jsonModalMode === 'import' ? (
                <button
                  type="button"
                  data-testid="roster-confirm-import-btn"
                  onClick={handleConfirmImport}
                  className="px-4 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold hover:bg-amber-400"
                >
                  Validate &amp; Import .srd5.json
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="roster-download-again-btn"
                  onClick={() =>
                    triggerSrd5FileDownload(
                      jsonModalFilename || 'character.srd5.json',
                      jsonText,
                    )
                  }
                  className="px-4 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold hover:bg-amber-400"
                >
                  Download {jsonModalFilename}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
