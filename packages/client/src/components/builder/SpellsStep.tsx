import {
  type CharacterBuildState,
  type SpellData,
  type SrdCompendium,
  defaultCompendium,
} from '@srd5/data';
import {
  formatAbilityAbbrev,
  formatSignedNumber,
  formatSpellLevel,
  formatTitleCase,
} from '../compendium/formatters.js';
import { getBuilderSpellcastingRequirements } from './builderState.js';

export interface SpellsStepProps {
  buildState: CharacterBuildState;
  onChange: (updater: (prev: CharacterBuildState) => CharacterBuildState) => void;
  compendium?: SrdCompendium;
}

export function SpellsStep({
  buildState,
  onChange,
  compendium = defaultCompendium,
}: SpellsStepProps) {
  const reqs = getBuilderSpellcastingRequirements(buildState, compendium);

  if (!reqs.applicable) {
    return (
      <div
        data-testid="builder-step-spells-noncaster"
        className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-center space-y-2"
      >
        <h3 className="text-base font-semibold text-amber-300">
          Non-Spellcasting Class at Current Level
        </h3>
        <p className="text-xs text-slate-400 max-w-lg mx-auto">
          Your character&apos;s current class and level do not require selecting class
          cantrips or spells in Step 6. Proceed directly to Step 7 (Review &amp; Finalize).
        </p>
      </div>
    );
  }

  const allowedCantripSet = new Set(reqs.availableCantrips.map((s) => s.id));
  const allowedLeveledSet = new Set(reqs.availableLeveledSpells.map((s) => s.id));
  const alwaysPreparedSet = new Set(reqs.alwaysPreparedSpellIds);

  const selectedCantrips = buildState.spellcasting.knownCantripIds.filter((id) =>
    allowedCantripSet.has(id),
  );
  const selectedCantripSet = new Set(selectedCantrips);

  const selectedKnown = buildState.spellcasting.knownSpellIds.filter((id) =>
    allowedLeveledSet.has(id),
  );
  const selectedKnownSet = new Set(selectedKnown);

  const selectedBook = buildState.spellcasting.spellbookSpellIds.filter((id) =>
    allowedLeveledSet.has(id),
  );
  const selectedBookSet = new Set(selectedBook);

  const selectedPrepared = buildState.spellcasting.preparedSpellIds.filter(
    (id) =>
      allowedLeveledSet.has(id) &&
      !alwaysPreparedSet.has(id) &&
      (reqs.preparationMode !== 'spellbook' || selectedBookSet.has(id)),
  );
  const selectedPreparedSet = new Set(selectedPrepared);

  const handleToggleCantrip = (spellId: string) => {
    onChange((prev) => {
      const current = prev.spellcasting.knownCantripIds.filter((id) =>
        allowedCantripSet.has(id),
      );
      let next: string[];
      if (current.includes(spellId)) {
        next = current.filter((id) => id !== spellId);
      } else if (current.length < reqs.cantripsRequired) {
        next = [...current, spellId];
      } else {
        return prev;
      }
      return {
        ...prev,
        spellcasting: {
          ...prev.spellcasting,
          knownCantripIds: next,
        },
      };
    });
  };

  const handleToggleKnownSpell = (spellId: string) => {
    onChange((prev) => {
      const current = prev.spellcasting.knownSpellIds.filter((id) =>
        allowedLeveledSet.has(id),
      );
      let next: string[];
      if (current.includes(spellId)) {
        next = current.filter((id) => id !== spellId);
      } else if (current.length < reqs.knownSpellsRequired) {
        next = [...current, spellId];
      } else {
        return prev;
      }
      return {
        ...prev,
        spellcasting: {
          ...prev.spellcasting,
          knownSpellIds: next,
        },
      };
    });
  };

  const handleToggleSpellbookSpell = (spellId: string) => {
    onChange((prev) => {
      const currentBook = prev.spellcasting.spellbookSpellIds.filter((id) =>
        allowedLeveledSet.has(id),
      );
      let nextBook: string[];
      let nextPrep = prev.spellcasting.preparedSpellIds;

      if (currentBook.includes(spellId)) {
        nextBook = currentBook.filter((id) => id !== spellId);
        nextPrep = nextPrep.filter((id) => id !== spellId);
      } else if (currentBook.length < reqs.spellbookSpellsRequired) {
        nextBook = [...currentBook, spellId];
      } else {
        return prev;
      }

      return {
        ...prev,
        spellcasting: {
          ...prev.spellcasting,
          spellbookSpellIds: nextBook,
          preparedSpellIds: nextPrep,
        },
      };
    });
  };

  const handleTogglePreparedSpell = (spellId: string) => {
    onChange((prev) => {
      const currentPrep = prev.spellcasting.preparedSpellIds.filter(
        (id) =>
          allowedLeveledSet.has(id) &&
          !alwaysPreparedSet.has(id) &&
          (reqs.preparationMode !== 'spellbook' ||
            prev.spellcasting.spellbookSpellIds.includes(id)),
      );
      let nextPrep: string[];
      if (currentPrep.includes(spellId)) {
        nextPrep = currentPrep.filter((id) => id !== spellId);
      } else if (currentPrep.length < reqs.preparedSpellsRequired) {
        nextPrep = [...currentPrep, spellId];
      } else {
        return prev;
      }
      return {
        ...prev,
        spellcasting: {
          ...prev.spellcasting,
          preparedSpellIds: nextPrep,
        },
      };
    });
  };

  const renderSpellButton = (
    spell: SpellData,
    isSelected: boolean,
    isDisabled: boolean,
    onToggle: () => void,
    testIdPrefix: string,
  ) => (
    <button
      key={spell.id}
      type="button"
      disabled={isDisabled}
      data-testid={`${testIdPrefix}-${spell.id}`}
      aria-pressed={isSelected}
      onClick={onToggle}
      className={`text-left p-2.5 rounded-lg border text-xs transition-colors flex flex-col justify-between gap-1 ${
        isSelected
          ? 'bg-purple-500/20 border-purple-400 text-purple-100 font-medium'
          : isDisabled
            ? 'bg-slate-950/40 border-slate-800/60 text-slate-600 cursor-not-allowed'
            : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
      }`}
    >
      <div className="flex items-center justify-between gap-1.5">
        <span className="truncate font-semibold">{spell.name}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 shrink-0">
          {spell.level === 0 ? 'Cantrip' : `L${spell.level}`}
        </span>
      </div>
      <div className="text-[11px] text-slate-400">
        {formatTitleCase(spell.school)}
        {spell.concentration ? ' · Conc.' : ''}
        {spell.ritual ? ' · Ritual' : ''}
      </div>
    </button>
  );

  return (
    <div data-testid="builder-step-spells" className="space-y-6">
      {/* Spellcasting Stats Banner */}
      <section className="rounded-xl border border-purple-900/60 bg-purple-950/20 p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-purple-300">
            {reqs.className} Spellcasting ({formatTitleCase(reqs.preparationMode ?? 'spellcaster')})
          </h3>
          <p className="text-xs text-slate-300">
            Spellcasting Ability:{' '}
            <strong>
              {reqs.spellcastingAbility
                ? formatAbilityAbbrev(reqs.spellcastingAbility)
                : '—'}
            </strong>{' '}
            &middot; Max Spell Level: {formatSpellLevel(reqs.maxSpellLevel as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9)}
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <div className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800">
            <span className="text-slate-400">Spell Save DC: </span>
            <strong
              data-testid="builder-spell-save-dc"
              className="text-amber-300 font-mono"
            >
              {reqs.spellSaveDc ?? 10}
            </strong>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800">
            <span className="text-slate-400">Spell Attack: </span>
            <strong
              data-testid="builder-spell-attack-bonus"
              className="text-amber-300 font-mono"
            >
              {formatSignedNumber(reqs.spellAttackBonus ?? 0)}
            </strong>
          </div>
        </div>
      </section>

      {/* Always-Prepared Domain / Oath / Circle Spells */}
      {reqs.alwaysPreparedSpellIds.length > 0 && (
        <section
          data-testid="builder-always-prepared-spells"
          className="rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-3.5 space-y-2"
        >
          <div className="text-xs font-semibold text-emerald-300">
            Always Prepared Subclass Spells (Do Not Count Against Limit)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {reqs.alwaysPreparedSpellIds.map((spellId) => {
              const sp = compendium.getSpell(spellId);
              return (
                <span
                  key={spellId}
                  className="px-2.5 py-1 rounded bg-emerald-950/80 border border-emerald-700/60 text-xs text-emerald-200"
                >
                  {sp?.name ?? formatTitleCase(spellId)}
                </span>
              );
            })}
          </div>
        </section>
      )}

      {/* Cantrip Selection */}
      {reqs.cantripsRequired > 0 && (
        <section
          data-testid="builder-cantrips-section"
          className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-slate-100">
                Select {reqs.className} Cantrips (Level 0)
              </h4>
              <p className="text-xs text-slate-400">
                Choose {reqs.cantripsRequired} cantrips from the {reqs.className} spell list.
              </p>
            </div>
            <span
              data-testid="builder-cantrips-counter"
              className={`px-2.5 py-0.5 rounded text-xs font-medium border ${
                selectedCantrips.length === reqs.cantripsRequired
                  ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300'
                  : 'bg-amber-950/60 border-amber-700/60 text-amber-300'
              }`}
            >
              {selectedCantrips.length} / {reqs.cantripsRequired} Selected
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {reqs.availableCantrips.map((spell) => {
              const isSelected = selectedCantripSet.has(spell.id);
              const isDisabled =
                !isSelected && selectedCantrips.length >= reqs.cantripsRequired;
              return renderSpellButton(
                spell,
                isSelected,
                isDisabled,
                () => handleToggleCantrip(spell.id),
                'builder-cantrip-option',
              );
            })}
          </div>
        </section>
      )}

      {/* Known Casters (Bard, Ranger, Sorcerer, Warlock) */}
      {reqs.preparationMode === 'known' && (
        <section
          data-testid="builder-known-spells-section"
          className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-slate-100">
                Select Known Spells
              </h4>
              <p className="text-xs text-slate-400">
                Choose {reqs.knownSpellsRequired} spells from the {reqs.className} spell list.
              </p>
            </div>
            <span
              data-testid="builder-known-spells-counter"
              className={`px-2.5 py-0.5 rounded text-xs font-medium border ${
                selectedKnown.length === reqs.knownSpellsRequired
                  ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300'
                  : 'bg-amber-950/60 border-amber-700/60 text-amber-300'
              }`}
            >
              {selectedKnown.length} / {reqs.knownSpellsRequired} Selected
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {reqs.availableLeveledSpells.map((spell) => {
              const isSelected = selectedKnownSet.has(spell.id);
              const isDisabled =
                !isSelected && selectedKnown.length >= reqs.knownSpellsRequired;
              return renderSpellButton(
                spell,
                isSelected,
                isDisabled,
                () => handleToggleKnownSpell(spell.id),
                'builder-known-spell-option',
              );
            })}
          </div>
        </section>
      )}

      {/* Wizard Spellbook & Prepared from Spellbook */}
      {reqs.preparationMode === 'spellbook' && (
        <>
          <section
            data-testid="builder-spellbook-section"
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-slate-100">
                  1. Select Wizard Spellbook Spells ({reqs.spellbookSpellsRequired}{' '}
                  Spells)
                </h4>
                <p className="text-xs text-slate-400">
                  A Level 1 Wizard starts with 6 1st-level spells in their spellbook (+2 per additional Wizard level).
                </p>
              </div>
              <span
                data-testid="builder-spellbook-counter"
                className={`px-2.5 py-0.5 rounded text-xs font-medium border ${
                  selectedBook.length === reqs.spellbookSpellsRequired
                    ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300'
                    : 'bg-amber-950/60 border-amber-700/60 text-amber-300'
                }`}
              >
                {selectedBook.length} / {reqs.spellbookSpellsRequired} in Spellbook
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {reqs.availableLeveledSpells.map((spell) => {
                const isSelected = selectedBookSet.has(spell.id);
                const isDisabled =
                  !isSelected &&
                  selectedBook.length >= reqs.spellbookSpellsRequired;
                return renderSpellButton(
                  spell,
                  isSelected,
                  isDisabled,
                  () => handleToggleSpellbookSpell(spell.id),
                  'builder-spellbook-option',
                );
              })}
            </div>
          </section>

          <section
            data-testid="builder-wizard-prepared-section"
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-slate-100">
                  2. Prepare Spells from Your Spellbook ({reqs.preparedSpellsRequired}{' '}
                  Spells)
                </h4>
                <p className="text-xs text-slate-400">
                  Prepare INT modifier + Wizard level (minimum 1) spells from your spellbook.
                </p>
              </div>
              <span
                data-testid="builder-prepared-spells-counter"
                className={`px-2.5 py-0.5 rounded text-xs font-medium border ${
                  selectedPrepared.length === reqs.preparedSpellsRequired
                    ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300'
                    : 'bg-amber-950/60 border-amber-700/60 text-amber-300'
                }`}
              >
                {selectedPrepared.length} / {reqs.preparedSpellsRequired} Prepared
              </span>
            </div>

            {selectedBook.length === 0 ? (
              <p className="text-xs text-amber-300">
                Add spells to your Wizard Spellbook above first, then choose which ones to prepare.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {selectedBook
                  .map((id) => compendium.getSpell(id))
                  .filter((s): s is SpellData => Boolean(s))
                  .map((spell) => {
                    const isSelected = selectedPreparedSet.has(spell.id);
                    const isDisabled =
                      !isSelected &&
                      selectedPrepared.length >= reqs.preparedSpellsRequired;
                    return renderSpellButton(
                      spell,
                      isSelected,
                      isDisabled,
                      () => handleTogglePreparedSpell(spell.id),
                      'builder-prepared-spell-option',
                    );
                  })}
              </div>
            )}
          </section>
        </>
      )}

      {/* Prepared Casters (Cleric, Druid, Paladin) */}
      {reqs.preparationMode === 'prepared_full_list' && (
        <section
          data-testid="builder-prepared-spells-section"
          className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-slate-100">
                Select Prepared {reqs.className} Spells
              </h4>
              <p className="text-xs text-slate-400">
                Choose {reqs.preparedSpellsRequired} spells to prepare from the{' '}
                {reqs.className} spell list.
              </p>
            </div>
            <span
              data-testid="builder-prepared-spells-counter"
              className={`px-2.5 py-0.5 rounded text-xs font-medium border ${
                selectedPrepared.length === reqs.preparedSpellsRequired
                  ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300'
                  : 'bg-amber-950/60 border-amber-700/60 text-amber-300'
              }`}
            >
              {selectedPrepared.length} / {reqs.preparedSpellsRequired} Prepared
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {reqs.availableLeveledSpells
              .filter((s) => !alwaysPreparedSet.has(s.id))
              .map((spell) => {
                const isSelected = selectedPreparedSet.has(spell.id);
                const isDisabled =
                  !isSelected &&
                  selectedPrepared.length >= reqs.preparedSpellsRequired;
                return renderSpellButton(
                  spell,
                  isSelected,
                  isDisabled,
                  () => handleTogglePreparedSpell(spell.id),
                  'builder-prepared-spell-option',
                );
              })}
          </div>
        </section>
      )}
    </div>
  );
}
