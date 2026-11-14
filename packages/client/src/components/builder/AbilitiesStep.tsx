import {
  ABILITY_IDS,
  type AbilityId,
  type CharacterBuildState,
  type SrdCompendium,
  defaultCompendium,
} from '@srd5/data';
import {
  type AbilityGenerationMethod,
  POINT_BUY_BUDGET,
  POINT_BUY_COST_TABLE,
  POINT_BUY_MAX_SCORE,
  POINT_BUY_MIN_SCORE,
  STANDARD_ARRAY,
  calculatePointBuySummary,
  computeDerivedCharacter,
  generateSeededAbilityRolls,
  validateCharacterBuildAbilities,
} from '@srd5/engine';
import {
  formatAbilityAbbrev,
  formatAbilityFullName,
  formatSignedNumber,
} from '../compendium/formatters.js';

export interface AbilitiesStepProps {
  buildState: CharacterBuildState;
  onChange: (updater: (prev: CharacterBuildState) => CharacterBuildState) => void;
  compendium?: SrdCompendium;
}

export function AbilitiesStep({
  buildState,
  onChange,
  compendium = defaultCompendium,
}: AbilitiesStepProps) {
  const derived = computeDerivedCharacter(buildState, compendium);
  const validation = validateCharacterBuildAbilities(buildState);
  const pointBuySummary = calculatePointBuySummary(
    buildState.baseAbilities,
    POINT_BUY_BUDGET,
  );
  const currentSeed = buildState.abilityRollSeed ?? 42;
  const rollPool = generateSeededAbilityRolls(currentSeed);

  const handleMethodChange = (method: AbilityGenerationMethod) => {
    onChange((prev) => {
      if (prev.abilityMethod === method) return prev;

      if (method === 'standard_array') {
        return {
          ...prev,
          abilityMethod: 'standard_array',
          baseAbilities: {
            str: 15,
            dex: 14,
            con: 13,
            int: 12,
            wis: 10,
            cha: 8,
          },
        };
      }

      if (method === 'point_buy') {
        // Default balanced 27-point buy array: 15, 15, 15, 8, 8, 8 (9+9+9=27) or 15, 14, 13, 12, 10, 8 (9+7+5+4+2+0=27)
        return {
          ...prev,
          abilityMethod: 'point_buy',
          baseAbilities: {
            str: 15,
            dex: 14,
            con: 13,
            int: 12,
            wis: 10,
            cha: 8,
          },
        };
      }

      if (method === 'rolled') {
        const seed = prev.abilityRollSeed ?? 42;
        const pool = generateSeededAbilityRolls(seed);
        return {
          ...prev,
          abilityMethod: 'rolled',
          abilityRollSeed: seed,
          baseAbilities: {
            str: pool.scores[0],
            dex: pool.scores[1],
            con: pool.scores[2],
            int: pool.scores[3],
            wis: pool.scores[4],
            cha: pool.scores[5],
          },
        };
      }

      return {
        ...prev,
        abilityMethod: method,
      };
    });
  };

  const handlePointBuyDelta = (ability: AbilityId, delta: 1 | -1) => {
    onChange((prev) => {
      const current = prev.baseAbilities[ability];
      const next = current + delta;
      if (next < POINT_BUY_MIN_SCORE || next > POINT_BUY_MAX_SCORE) {
        return prev;
      }
      return {
        ...prev,
        baseAbilities: {
          ...prev.baseAbilities,
          [ability]: next,
        },
      };
    });
  };

  const handleSetAbilityScore = (
    ability: AbilityId,
    newScore: number,
    swapFromPool?: readonly number[],
  ) => {
    onChange((prev) => {
      const oldScore = prev.baseAbilities[ability];
      if (oldScore === newScore) return prev;

      // If assigning from a fixed 6-element multiset (Standard Array or Rolled pool),
      // swap with another ability holding `newScore` if all copies of `newScore` are already in use.
      if (swapFromPool) {
        const allowedCount = swapFromPool.filter((v) => v === newScore).length;
        const otherAbilitiesWithScore = ABILITY_IDS.filter(
          (ab) => ab !== ability && prev.baseAbilities[ab] === newScore,
        );
        if (otherAbilitiesWithScore.length >= allowedCount && otherAbilitiesWithScore[0]) {
          const swapTarget = otherAbilitiesWithScore[0];
          return {
            ...prev,
            baseAbilities: {
              ...prev.baseAbilities,
              [ability]: newScore,
              [swapTarget]: oldScore,
            },
          };
        }
      }

      return {
        ...prev,
        baseAbilities: {
          ...prev.baseAbilities,
          [ability]: newScore,
        },
      };
    });
  };

  const handleSeedChange = (newSeed: number) => {
    const safeSeed = Math.max(0, Math.floor(Number.isFinite(newSeed) ? newSeed : 0));
    const pool = generateSeededAbilityRolls(safeSeed);
    onChange((prev) => ({
      ...prev,
      abilityMethod: 'rolled',
      abilityRollSeed: safeSeed,
      baseAbilities: {
        str: pool.scores[0],
        dex: pool.scores[1],
        con: pool.scores[2],
        int: pool.scores[3],
        wis: pool.scores[4],
        cha: pool.scores[5],
      },
    }));
  };

  return (
    <div data-testid="builder-step-abilities" className="space-y-6">
      {/* Generation Method Tabs */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-amber-300">
              Ability Score Generation Method
            </h3>
            <p className="text-xs text-slate-400">
              Choose Standard Array, 27-Point Buy, or Deterministic 4d6kh3 Rolls.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: 'standard_array', label: 'Standard Array' },
                { id: 'point_buy', label: '27-Point Buy' },
                { id: 'rolled', label: 'Rolled (4d6kh3)' },
              ] as const
            ).map((tab) => {
              const active = buildState.abilityMethod === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  data-testid={`builder-ability-method-${tab.id}`}
                  aria-pressed={active}
                  onClick={() => handleMethodChange(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    active
                      ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Method-specific status bar */}
        {buildState.abilityMethod === 'standard_array' && (
          <div
            data-testid="builder-standard-array-banner"
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-950/80 border border-slate-800 px-3.5 py-2.5 text-xs"
          >
            <span className="text-slate-300">
              Standard Array Values:{' '}
              <strong className="text-amber-300 font-mono">
                [{STANDARD_ARRAY.join(', ')}]
              </strong>
            </span>
            <span
              className={
                validation.valid ? 'text-emerald-400 font-medium' : 'text-amber-300'
              }
            >
              {validation.valid
                ? 'All 6 Standard Array scores assigned'
                : validation.errors[0]}
            </span>
          </div>
        )}

        {buildState.abilityMethod === 'point_buy' && (
          <div
            data-testid="builder-point-buy-banner"
            className="space-y-2 rounded-lg bg-slate-950/80 border border-slate-800 p-3 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-slate-300">
                Point Buy Budget:{' '}
                <strong
                  data-testid="builder-point-buy-remaining"
                  className="text-amber-300 font-mono"
                >
                  {pointBuySummary.pointsRemaining} / {pointBuySummary.budget} points remaining
                </strong>{' '}
                ({pointBuySummary.pointsSpent} spent)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="builder-point-buy-reset-8"
                  onClick={() =>
                    onChange((prev) => ({
                      ...prev,
                      baseAbilities: {
                        str: 8,
                        dex: 8,
                        con: 8,
                        int: 8,
                        wis: 8,
                        cha: 8,
                      },
                    }))
                  }
                  className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:bg-slate-800"
                >
                  Reset All to 8
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] text-slate-400">
              <span>Cost Table:</span>
              {Object.entries(POINT_BUY_COST_TABLE).map(([score, cost]) => (
                <span
                  key={score}
                  className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 font-mono"
                >
                  {score}={cost}pt
                </span>
              ))}
            </div>
          </div>
        )}

        {buildState.abilityMethod === 'rolled' && (
          <div
            data-testid="builder-rolled-banner"
            className="space-y-3 rounded-lg bg-slate-950/80 border border-slate-800 p-3 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <label
                  htmlFor="builder-roll-seed-input"
                  className="text-slate-300 font-medium"
                >
                  PRNG Seed:
                </label>
                <input
                  id="builder-roll-seed-input"
                  data-testid="builder-roll-seed-input"
                  type="number"
                  min={0}
                  value={currentSeed}
                  onChange={(e) => handleSeedChange(Number(e.target.value))}
                  className="w-28 rounded bg-slate-900 border border-slate-700 px-2.5 py-1 font-mono text-amber-300"
                />
                <button
                  type="button"
                  data-testid="builder-roll-new-seed-btn"
                  onClick={() => handleSeedChange(currentSeed + 1)}
                  className="px-3 py-1 rounded bg-amber-500/20 border border-amber-500/60 text-amber-200 font-medium hover:bg-amber-500/30"
                >
                  Roll Next Seed
                </button>
              </div>
              <div className="text-slate-400">
                Rolled Pool:{' '}
                <strong
                  data-testid="builder-rolled-pool-values"
                  className="text-amber-300 font-mono"
                >
                  [{rollPool.scores.join(', ')}]
                </strong>{' '}
                (Sum: {rollPool.totalSum})
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {rollPool.records.map((rec, idx) => (
                <div
                  key={idx}
                  className="rounded bg-slate-900/90 border border-slate-800 p-2 text-center"
                >
                  <div className="text-[10px] text-slate-400">Roll #{idx + 1}</div>
                  <div className="text-sm font-bold text-amber-300 font-mono">
                    {rec.total}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">
                    [{rec.rolls.join(', ')}]
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 6 Ability Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {ABILITY_IDS.map((abilityId) => {
          const baseScore = buildState.baseAbilities[abilityId];
          const derivedAb = derived.abilities[abilityId];
          const bonusFromOriginAndAsi =
            derivedAb.racialBonus + derivedAb.asiBonus + derivedAb.featBonus;

          return (
            <div
              key={abilityId}
              data-testid={`builder-ability-card-${abilityId}`}
              className="rounded-xl border border-slate-800 bg-slate-900/75 p-4 flex flex-col justify-between gap-3"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-amber-400">
                    {formatAbilityAbbrev(abilityId)}
                  </div>
                  <div className="text-sm font-semibold text-slate-100">
                    {formatAbilityFullName(abilityId)}
                  </div>
                </div>

                <div className="text-right">
                  <div
                    data-testid={`builder-ability-final-${abilityId}`}
                    className="text-xl font-bold font-mono text-slate-100"
                  >
                    {derivedAb.score}{' '}
                    <span className="text-sm text-amber-300">
                      ({formatSignedNumber(derivedAb.modifier)})
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Base {baseScore}{' '}
                    {bonusFromOriginAndAsi !== 0 &&
                      `${formatSignedNumber(bonusFromOriginAndAsi)} bonus`}
                  </div>
                </div>
              </div>

              {/* Controls by Method */}
              {buildState.abilityMethod === 'point_buy' ? (
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                  <button
                    type="button"
                    data-testid={`builder-point-buy-dec-${abilityId}`}
                    disabled={!pointBuySummary.canDecrement[abilityId]}
                    onClick={() => handlePointBuyDelta(abilityId, -1)}
                    className="px-3 py-1 rounded border border-slate-700 bg-slate-950 text-sm font-bold text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800"
                  >
                    &minus;
                  </button>
                  <div className="text-center">
                    <div
                      data-testid={`builder-ability-base-${abilityId}`}
                      className="text-sm font-mono font-semibold text-amber-300"
                    >
                      Base: {baseScore}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Cost: {pointBuySummary.costByAbility[abilityId] ?? 0} pt
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid={`builder-point-buy-inc-${abilityId}`}
                    disabled={!pointBuySummary.canIncrement[abilityId]}
                    onClick={() => handlePointBuyDelta(abilityId, 1)}
                    className="px-3 py-1 rounded border border-slate-700 bg-slate-950 text-sm font-bold text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800"
                  >
                    +
                  </button>
                </div>
              ) : (
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
                  <label
                    htmlFor={`builder-ability-select-${abilityId}`}
                    className="text-xs text-slate-400"
                  >
                    Base Score:
                  </label>
                  <select
                    id={`builder-ability-select-${abilityId}`}
                    aria-label={`Base ${formatAbilityFullName(abilityId)} score`}
                    data-testid={`builder-ability-select-${abilityId}`}
                    value={baseScore}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      const pool =
                        buildState.abilityMethod === 'standard_array'
                          ? STANDARD_ARRAY
                          : buildState.abilityMethod === 'rolled'
                            ? rollPool.scores
                            : undefined;
                      handleSetAbilityScore(abilityId, val, pool);
                    }}
                    className="rounded bg-slate-950 border border-slate-700 px-2.5 py-1 text-xs font-mono text-amber-300"
                  >
                    {(buildState.abilityMethod === 'standard_array'
                      ? [...STANDARD_ARRAY]
                      : buildState.abilityMethod === 'rolled'
                        ? Array.from(new Set(rollPool.sortedScores))
                        : Array.from({ length: 18 }, (_, i) => i + 3)
                    ).map((scoreVal) => (
                      <option key={scoreVal} value={scoreVal}>
                        {scoreVal}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
