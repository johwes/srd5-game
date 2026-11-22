import { useMemo, useState } from 'react';
import type { CharacterBuildState, SpellData, SrdCompendium } from '@srd5/data';
import { computeDerivedCharacter, type DerivedCharacterSheet } from '@srd5/engine';
import { assetRegistry } from '../../canvas/assets/AssetRegistry.js';
import {
  formatAbilityAbbrev,
  formatSignedNumber,
  formatTitleCase,
} from '../compendium/formatters.js';

export interface CharacterSpellbookProps {
  /** Hero whose spellbook is displayed. */
  hero: CharacterBuildState;
  /** Compendium for spell lookups. */
  compendium: SrdCompendium;
  /** Precomputed derived sheet (avoids recompute when the parent has one). */
  derived?: DerivedCharacterSheet;
  /** Test id prefix. Defaults to `character-view`. */
  testIdPrefix?: string;
}

type SpellbookTabId = string; // classId or 'common'

const ROMAN_LEVELS: Record<number, string> = {
  1: 'I',
  2: 'II',
  3: 'III',
  4: 'IV',
  5: 'V',
  6: 'VI',
  7: 'VII',
  8: 'VIII',
  9: 'IX',
};

function resolveSpellIconUrl(spell: SpellData): { url: string; altText: string } {
  try {
    const res = assetRegistry.resolveSpellIcon({
      id: spell.id,
      school: spell.school,
      name: spell.name,
    });
    return { url: res.url, altText: res.altText };
  } catch {
    return { url: '/assets/game-icons/spell-book.svg', altText: spell.school };
  }
}

function classDisplayName(classId: string, compendium: SrdCompendium): string {
  return compendium.getClass(classId)?.name ?? formatTitleCase(classId);
}

/**
 * SRD-1507 spellbook panel (Spec 14 §10).
 *
 * Dedicated per-hero panel: class tabs with prepared counts, a `Common`
 * tab for non-spell actions, a per-class header (subclass, casting ability,
 * save DC, spell attack, resource pips, search), then cantrips followed by
 * spells grouped by level (I–IX) as icon cells with live slot pips per
 * level row (filled = available, from `derived.spellcasting.spellSlots`).
 *
 * Presentation over sheet-drawer data only — no engine mechanics, no
 * prepare toggles (preparation stays in the sheet drawer).
 */
export function CharacterSpellbook({
  hero,
  compendium,
  derived: derivedProp,
  testIdPrefix = 'character-view',
}: CharacterSpellbookProps) {
  const prefix = `${testIdPrefix}-spellbook`;
  const derived = useMemo(
    () => derivedProp ?? computeDerivedCharacter(hero, compendium),
    [derivedProp, hero, compendium],
  );
  const [activeTab, setActiveTab] = useState<SpellbookTabId | null>(null);
  const [search, setSearch] = useState('');

  const sc = derived.spellcasting;

  const classTabs = useMemo(() => {
    if (!sc.isSpellcaster) return [];
    return sc.classes.map((cls) => {
      const classId = cls.classId;
      const allIds = new Set<string>([
        ...sc.cantripIds,
        ...sc.preparedOrKnownSpellIds,
        ...sc.alwaysPreparedSpellIds,
        ...sc.spellbookSpellIds,
      ]);
      const inClassIds = [...allIds].filter((id) => {
        if (sc.alwaysPreparedSpellIds.includes(id)) {
          // Domain/oath/circle spells always show on their class tab even
          // when the base spell list does not carry the class.
          return true;
        }
        const sp = compendium.getSpell(id);
        return sp?.classes.includes(classId) ?? id.length > 0;
      });
      // Keep only ids that resolve to a real spell record.
      const resolved = inClassIds.filter((id) => compendium.getSpell(id) !== undefined);
      const leveledPrepared = resolved.filter((id) => {
        const sp = compendium.getSpell(id);
        return (
          sp !== undefined &&
          sp.level > 0 &&
          (sc.preparedOrKnownSpellIds.includes(id) || sc.alwaysPreparedSpellIds.includes(id))
        );
      });
      return { cls, classId, spellIds: resolved, leveledPreparedCount: leveledPrepared.length };
    });
  }, [sc, compendium]);

  const effectiveTab: SpellbookTabId =
    activeTab ??
    (classTabs.length > 0 ? (classTabs[0]?.classId ?? 'common') : 'common');

  const needle = search.trim().toLowerCase();

  if (!sc.isSpellcaster || classTabs.length === 0) {
    return (
      <div data-testid={prefix} className="space-y-2">
        <div
          data-testid={`${prefix}-empty`}
          className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-center text-sm text-slate-400"
        >
          This character does not currently have Spellcasting unlocked.
        </div>
      </div>
    );
  }

  const activeEntry = classTabs.find((t) => t.classId === effectiveTab);
  const activeCls = activeEntry?.cls;
  const classSummary = derived.classes.find((c) => c.classId === effectiveTab);
  const subclassName = classSummary?.subclassName;

  const matchesSearch = (spell: SpellData): boolean => {
    if (needle.length === 0) return true;
    return (
      spell.name.toLowerCase().includes(needle) ||
      spell.id.toLowerCase().includes(needle) ||
      spell.school.toLowerCase().includes(needle)
    );
  };

  const levelGroups: Array<{ level: number; spells: SpellData[] }> = [];
  if (activeEntry) {
    const spells = activeEntry.spellIds
      .map((id) => compendium.getSpell(id))
      .filter((s): s is SpellData => s !== undefined)
      .filter(matchesSearch)
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
    for (let level = 0; level <= 9; level += 1) {
      const inLevel = spells.filter((s) => s.level === level);
      if (inLevel.length > 0) levelGroups.push({ level, spells: inLevel });
    }
  }

  const resources = Object.values(derived.resources);

  return (
    <div data-testid={prefix} className="space-y-3">
      {/* Class tabs (+ Common). */}
      <div
        data-testid={`${prefix}-tabs`}
        role="tablist"
        aria-label="Spellbook class tabs"
        className="flex flex-wrap gap-1.5"
      >
        {classTabs.map(({ cls, classId, leveledPreparedCount }) => {
          const label = cls.maxPreparedSpells
            ? `${classDisplayName(classId, compendium)} (${leveledPreparedCount}/${cls.maxPreparedSpells})`
            : `${classDisplayName(classId, compendium)} (${leveledPreparedCount})`;
          const selected = effectiveTab === classId;
          return (
            <button
              key={classId}
              type="button"
              role="tab"
              aria-selected={selected}
              data-testid={`${prefix}-tab-${classId}`}
              onClick={() => setActiveTab(classId)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
                selected ? 'bg-purple-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:text-white'
              }`}
            >
              {label}
            </button>
          );
        })}
        <button
          type="button"
          role="tab"
          aria-selected={effectiveTab === 'common'}
          data-testid={`${prefix}-tab-common`}
          onClick={() => setActiveTab('common')}
          className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
            effectiveTab === 'common'
              ? 'bg-purple-500 text-slate-950'
              : 'bg-slate-800 text-slate-300 hover:text-white'
          }`}
        >
          Common
        </button>
      </div>

      {effectiveTab === 'common' ? (
        <div data-testid={`${prefix}-common`} className="space-y-2">
          <p className="text-[11px] text-slate-500">
            Non-spell actions — weapon attacks and class resources. The hotbar stays the combat
            surface.
          </p>
          {derived.weaponAttacks.length === 0 ? (
            <div
              data-testid={`${prefix}-common-empty`}
              className="rounded-lg bg-slate-950 border border-slate-800 p-3 text-xs text-slate-500"
            >
              No weapon attacks.
            </div>
          ) : (
            <div className="space-y-1.5">
              {derived.weaponAttacks.map((atk) => (
                <div
                  key={atk.id}
                  data-testid={`${prefix}-common-attack-${atk.weaponId}`}
                  title={`${atk.name}: ${formatSignedNumber(atk.toHitBonus)} to hit, ${atk.damageFormula} ${atk.damageType}`}
                  className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs"
                >
                  <span className="text-slate-200 font-medium truncate">{atk.name}</span>
                  <span className="font-mono text-slate-400 shrink-0 ml-2">
                    {formatSignedNumber(atk.toHitBonus)} · {atk.damageFormula}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Per-class header: subclass + casting stats + resources + search. */}
          <div
            data-testid={`${prefix}-header-${effectiveTab}`}
            className="rounded-xl border border-purple-800/40 bg-purple-950/20 p-3 space-y-2"
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="text-slate-300">
                {subclassName ? (
                  <>
                    Subclass:{' '}
                    <strong data-testid={`${prefix}-subclass`} className="text-purple-200">
                      {subclassName}
                    </strong>
                  </>
                ) : (
                  <span className="text-slate-500">No subclass</span>
                )}
              </span>
              {activeCls && (
                <>
                  <span className="text-slate-400">
                    Casting:{' '}
                    <strong className="text-slate-100 font-mono">
                      {formatAbilityAbbrev(activeCls.ability)}
                    </strong>
                  </span>
                  <span className="text-slate-400">
                    Save DC:{' '}
                    <strong data-testid={`${prefix}-save-dc`} className="text-amber-300 font-mono">
                      {activeCls.spellSaveDc}
                    </strong>
                  </span>
                  <span className="text-slate-400">
                    Spell attack:{' '}
                    <strong
                      data-testid={`${prefix}-spell-attack`}
                      className="text-amber-300 font-mono"
                    >
                      {formatSignedNumber(activeCls.spellAttackBonus)}
                    </strong>
                  </span>
                </>
              )}
            </div>
            {resources.length > 0 && (
              <div
                data-testid={`${prefix}-resources`}
                className="flex flex-wrap gap-1.5 text-[11px]"
              >
                {resources.map((pool) => (
                  <span
                    key={pool.resourceId}
                    data-testid={`${prefix}-resource-${pool.resourceId}`}
                    title={`${pool.name}: ${pool.available}/${pool.max} (recharges on ${pool.recovery} rest)`}
                    className="px-2 py-0.5 rounded bg-slate-950 border border-slate-700 text-emerald-200 font-mono"
                  >
                    {pool.name} {pool.available}/{pool.max}
                  </span>
                ))}
              </div>
            )}
            <input
              type="search"
              data-testid={`${prefix}-search`}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search spells…"
              aria-label="Search spells"
              className="w-full sm:max-w-56 px-2 py-1 rounded-md bg-slate-950 border border-slate-700 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
            />
          </div>

          {/* Prepared counter. */}
          {activeCls && (
            <div
              data-testid={`${prefix}-prepared-counter`}
              className="text-[11px] font-mono text-purple-200"
            >
              {activeCls.maxPreparedSpells
                ? `Prepared ${activeEntry?.leveledPreparedCount ?? 0} / ${activeCls.maxPreparedSpells}`
                : `Known ${activeEntry?.leveledPreparedCount ?? 0}`}
              {activeCls.preparationMode === 'known' && (
                <span className="text-slate-500"> · fixed list (replaced on level-up)</span>
              )}
            </div>
          )}

          {/* Cantrip + per-level rows with live slot pips. */}
          {levelGroups.length === 0 ? (
            <div
              data-testid={`${prefix}-no-results`}
              className="rounded-lg bg-slate-950 border border-slate-800 p-3 text-xs text-slate-500"
            >
              No spells match this search.
            </div>
          ) : (
            <div className="space-y-3">
              {levelGroups.map(({ level, spells }) => {
                const pool =
                  level > 0
                    ? sc.spellSlots[level as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9]
                    : null;
                const exhausted = pool !== null && pool.max > 0 && pool.available === 0;
                return (
                  <section
                    key={level}
                    data-testid={`${prefix}-level-${level}`}
                    aria-label={level === 0 ? 'Cantrips' : `Level ${level} spells`}
                    className="space-y-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-bold text-purple-300">
                        {level === 0 ? 'Cantrips' : `Level ${level} (${ROMAN_LEVELS[level]})`}
                      </h4>
                      {pool && pool.max > 0 && (
                        <span
                          data-testid={`${prefix}-slot-pips-${level}`}
                          title={`Spell slots level ${level}: ${pool.available}/${pool.max} available`}
                          aria-label={`Spell slots level ${level}: ${pool.available} of ${pool.max} available`}
                          className={`font-mono text-[11px] ${exhausted ? 'text-slate-500' : 'text-purple-200'}`}
                        >
                          {'●'.repeat(pool.available)}
                          {'○'.repeat(pool.max - pool.available)} {pool.available}/{pool.max}
                        </span>
                      )}
                      {pool && pool.max === 0 && (
                        <span
                          data-testid={`${prefix}-slot-pips-${level}`}
                          className="font-mono text-[11px] text-slate-600"
                        >
                          no slots
                        </span>
                      )}
                    </div>
                    <div
                      role="grid"
                      aria-label={level === 0 ? 'Cantrips' : `Level ${level} spells (${spells.length})`}
                      className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-1.5"
                    >
                      {spells.map((spell) => {
                        const icon = resolveSpellIconUrl(spell);
                        const isPrepared =
                          sc.preparedOrKnownSpellIds.includes(spell.id) ||
                          sc.cantripIds.includes(spell.id);
                        const isAlways = sc.alwaysPreparedSpellIds.includes(spell.id);
                        const bookOnly =
                          sc.spellbookSpellIds.includes(spell.id) && !isPrepared && !isAlways;
                        return (
                          <button
                            key={spell.id}
                            type="button"
                            data-testid={`${prefix}-cell-${spell.id}`}
                            title={`${spell.name} (Level ${spell.level} ${formatTitleCase(spell.school)}): ${spell.description}`}
                            aria-label={`${spell.name}, level ${spell.level} ${spell.school}${isAlways ? ', always prepared' : isPrepared ? ', prepared' : bookOnly ? ', in spellbook' : ''}`}
                            className={`relative flex flex-col items-center gap-1 rounded-lg bg-slate-950 border p-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 transition-colors ${
                              exhausted ? 'opacity-50 border-slate-800' : 'border-slate-700 hover:border-purple-400'
                            }`}
                          >
                            <img
                              src={icon.url}
                              alt={icon.altText}
                              width={26}
                              height={26}
                              loading="lazy"
                              data-testid={`${prefix}-icon-${spell.id}`}
                              className="object-contain"
                            />
                            <span className="max-w-full truncate text-[10px] font-medium text-slate-200">
                              {spell.name}
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="text-[9px] font-mono text-slate-500">
                                {spell.level === 0 ? 'C' : `L${spell.level}`} ·{' '}
                                {formatTitleCase(spell.school)}
                              </span>
                              {isAlways ? (
                                <span className="px-1 rounded bg-emerald-500/15 text-emerald-300 text-[9px] font-bold">
                                  Always
                                </span>
                              ) : isPrepared ? (
                                <span className="px-1 rounded bg-purple-500/15 text-purple-300 text-[9px] font-bold">
                                  Prep
                                </span>
                              ) : bookOnly ? (
                                <span className="px-1 rounded bg-slate-800 text-slate-400 text-[9px]">
                                  Book
                                </span>
                              ) : null}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
