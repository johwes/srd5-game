import {
  type CharacterBuildState,
  type SrdCompendium,
  defaultCompendium,
} from '@srd5/data';
import {
  formatAbilityBonuses,
  formatTitleCase,
} from '../compendium/formatters.js';
import { ChoiceSpecSelector } from './ChoiceSpecSelector.js';

export interface OriginStepProps {
  buildState: CharacterBuildState;
  onChange: (updater: (prev: CharacterBuildState) => CharacterBuildState) => void;
  compendium?: SrdCompendium;
}

export function OriginStep({
  buildState,
  onChange,
  compendium = defaultCompendium,
}: OriginStepProps) {
  const selectedRace = compendium.getRace(buildState.raceId);
  const subraces = selectedRace
    ? compendium.getSubracesForRace(selectedRace.id)
    : [];
  const selectedSubrace = buildState.subraceId
    ? compendium.getSubrace(buildState.subraceId)
    : undefined;

  const handleSelectRace = (raceId: string) => {
    const race = compendium.getRace(raceId);
    if (!race) return;

    onChange((prev) => {
      if (prev.raceId === raceId) return prev;
      return {
        ...prev,
        raceId,
        subraceId: undefined,
        racialChoices: {},
      };
    });
  };

  const handleSelectSubrace = (subraceId: string) => {
    onChange((prev) => {
      // Preserve race-level choices while resetting subrace-level choices
      const race = compendium.getRace(prev.raceId);
      const raceChoiceIds = new Set<string>(
        race
          ? [
              ...race.choices.map((c) => c.id),
              ...race.traits.flatMap((t) => (t.choices ?? []).map((c) => c.id)),
            ]
          : [],
      );
      const nextRacialChoices: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(prev.racialChoices)) {
        if (raceChoiceIds.has(k)) {
          nextRacialChoices[k] = v;
        }
      }
      return {
        ...prev,
        subraceId,
        racialChoices: nextRacialChoices,
      };
    });
  };

  const handleRacialChoiceChange = (choiceId: string, selected: string[]) => {
    onChange((prev) => ({
      ...prev,
      racialChoices: {
        ...prev.racialChoices,
        [choiceId]: selected,
      },
    }));
  };

  const allRacialChoices = [
    ...(selectedRace?.choices ?? []),
    ...(selectedRace?.traits.flatMap((t) => t.choices ?? []) ?? []),
    ...(selectedSubrace && selectedRace?.subraceIds.includes(selectedSubrace.id)
      ? [
          ...selectedSubrace.choices,
          ...selectedSubrace.traits.flatMap((t) => t.choices ?? []),
        ]
      : []),
  ];

  return (
    <div data-testid="builder-step-origin" className="space-y-6">
      {/* Race Selection Grid */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-amber-300">
            Select SRD 5.1 Race
          </h3>
          <span className="text-xs text-slate-400">
            {compendium.races.length} playable races
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {compendium.races.map((race) => {
            const isSelected = buildState.raceId === race.id;
            return (
              <button
                key={race.id}
                type="button"
                data-testid={`builder-race-card-${race.id}`}
                aria-pressed={isSelected}
                onClick={() => handleSelectRace(race.id)}
                className={`text-left p-3.5 rounded-lg border transition-all flex flex-col justify-between gap-2 ${
                  isSelected
                    ? 'bg-amber-500/15 border-amber-400 ring-1 ring-amber-400/50'
                    : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-sm text-slate-100">
                      {race.name}
                    </div>
                    <div className="text-xs text-amber-300/90 mt-0.5">
                      {formatAbilityBonuses(race.abilityBonuses)}
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-[11px] text-slate-300">
                    {formatTitleCase(race.size)} &middot; {race.speedFeet} ft
                  </span>
                </div>

                <div className="text-xs text-slate-400 line-clamp-2">
                  {race.description ??
                    race.traits.map((t) => t.name).join(', ')}
                </div>

                <div className="flex flex-wrap gap-1 pt-1">
                  {race.subraceIds.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-950/80 border border-indigo-800/60 text-indigo-300">
                      Requires Subrace
                    </span>
                  )}
                  {race.senses.darkvisionFeet && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                      Darkvision {race.senses.darkvisionFeet} ft
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Subrace Selection (if required) */}
      {selectedRace && subraces.length > 0 && (
        <section
          data-testid="builder-subrace-section"
          className="rounded-xl border border-indigo-900/60 bg-indigo-950/20 p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-indigo-300">
                Select {selectedRace.name} Subrace (Required)
              </h3>
              <p className="text-xs text-slate-400">
                {selectedRace.name} characters must select an SRD 5.1 subrace.
              </p>
            </div>
            <span
              data-testid="builder-subrace-status"
              className={`px-2 py-0.5 rounded text-xs font-medium border ${
                selectedSubrace
                  ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300'
                  : 'bg-amber-950/60 border-amber-700/60 text-amber-300'
              }`}
            >
              {selectedSubrace ? selectedSubrace.name : 'Selection Required'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {subraces.map((subrace) => {
              const isSelected = buildState.subraceId === subrace.id;
              return (
                <button
                  key={subrace.id}
                  type="button"
                  data-testid={`builder-subrace-card-${subrace.id}`}
                  aria-pressed={isSelected}
                  onClick={() => handleSelectSubrace(subrace.id)}
                  className={`text-left p-3.5 rounded-lg border transition-all space-y-1.5 ${
                    isSelected
                      ? 'bg-indigo-500/20 border-indigo-400 text-slate-100'
                      : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">{subrace.name}</span>
                    <span className="text-xs text-indigo-300 font-medium">
                      {formatAbilityBonuses(subrace.abilityBonuses)}
                    </span>
                  </div>
                  {subrace.description && (
                    <p className="text-xs text-slate-400">{subrace.description}</p>
                  )}
                  {subrace.traits.length > 0 && (
                    <div className="text-xs text-slate-300 pt-1">
                      <span className="text-slate-400">Traits: </span>
                      {subrace.traits.map((t) => t.name).join(', ')}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Racial & Subracial Choices */}
      {allRacialChoices.length > 0 && (
        <section
          data-testid="builder-racial-choices-section"
          className="space-y-3"
        >
          <h3 className="text-sm font-semibold text-amber-300">
            Ancestral Choices & Options
          </h3>
          <div className="space-y-3">
            {allRacialChoices.map((choice) => (
              <ChoiceSpecSelector
                key={choice.id}
                choice={choice}
                selected={buildState.racialChoices[choice.id] ?? []}
                onChange={(next) => handleRacialChoiceChange(choice.id, next)}
                compendium={compendium}
                testIdPrefix="racial-choice"
              />
            ))}
          </div>
        </section>
      )}

      {/* Selected Race & Subrace Trait Summary */}
      {selectedRace && (
        <section
          data-testid="builder-origin-summary"
          className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
            <div>
              <h4 className="text-sm font-semibold text-slate-200">
                {selectedSubrace
                  ? `${selectedSubrace.name} (${selectedRace.name})`
                  : selectedRace.name}{' '}
                Traits & Proficiencies
              </h4>
              <p className="text-xs text-slate-400">
                Speed: {selectedRace.speedFeet} ft &middot; Size:{' '}
                {formatTitleCase(selectedRace.size)} &middot; Languages:{' '}
                {selectedRace.languages.map(formatTitleCase).join(', ')}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              ...selectedRace.traits,
              ...(selectedSubrace?.traits ?? []),
            ].map((trait) => (
              <div
                key={trait.id}
                className="rounded-lg bg-slate-950/70 border border-slate-800/80 p-3 space-y-1"
              >
                <div className="text-xs font-semibold text-amber-300">
                  {trait.name}
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {trait.description}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
