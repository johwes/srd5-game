import {
  ABILITY_IDS,
  AI_ARCHETYPES,
  ARMOR_CATEGORIES,
  CHALLENGE_RATINGS,
  CREATURE_SIZES,
  CREATURE_TYPES,
  HIT_DIE_SIZES,
  MAGIC_ITEM_CATEGORIES,
  MAGIC_ITEM_RARITIES,
  MAGIC_SCHOOLS,
  SPELL_LEVELS,
  WEAPON_CATEGORIES,
  type AbilityId,
  type AiArchetype,
  type ArmorCategory,
  type ChallengeRating,
  type CreatureSize,
  type CreatureType,
  type EquipmentData,
  type HitDieSize,
  type MagicItemCategory,
  type MagicItemRarity,
  type MagicSchool,
  type SpellLevel,
  type SrdCompendium,
  type WeaponCategory,
  defaultCompendium,
} from '@srd5/data';
import { useMemo, useState } from 'react';
import { EntityDetailView, type InspectableEntity } from './EntityDetailView.js';
import {
  formatAbilityAbbrev,
  formatAbilityBonuses,
  formatChallengeRating,
  formatCopperCost,
  formatSpellLevel,
  formatTitleCase,
} from './formatters.js';

export type CompendiumTabId =
  | 'races'
  | 'classes'
  | 'spells'
  | 'equipment'
  | 'magic_items'
  | 'monsters'
  | 'reference';

interface CompendiumListItem {
  id: string;
  name: string;
  subtitle: string;
  badgeText: string;
  entity: InspectableEntity;
}

export interface CompendiumBrowserProps {
  compendium?: SrdCompendium;
  initialTab?: CompendiumTabId;
}

const SPELLCASTER_CLASS_IDS = [
  'bard',
  'cleric',
  'druid',
  'paladin',
  'ranger',
  'sorcerer',
  'warlock',
  'wizard',
] as const;

export function CompendiumBrowser({
  compendium = defaultCompendium,
  initialTab = 'races',
}: CompendiumBrowserProps) {
  const [activeTab, setActiveTab] = useState<CompendiumTabId>(initialTab);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

  // Race Filters
  const [raceSize, setRaceSize] = useState<CreatureSize | 'all'>('all');
  const [raceAbility, setRaceAbility] = useState<AbilityId | 'all'>('all');
  const [raceDarkvisionOnly, setRaceDarkvisionOnly] = useState<boolean>(false);

  // Class Filters
  const [classHitDie, setClassHitDie] = useState<HitDieSize | 'all'>('all');
  const [classPrimaryAbility, setClassPrimaryAbility] = useState<AbilityId | 'all'>('all');
  const [classSpellcasterMode, setClassSpellcasterMode] = useState<
    'all' | 'spellcaster' | 'martial'
  >('all');

  // Spell Filters
  const [spellLevel, setSpellLevel] = useState<SpellLevel | 'all'>('all');
  const [spellSchool, setSpellSchool] = useState<MagicSchool | 'all'>('all');
  const [spellClassId, setSpellClassId] = useState<string>('all');
  const [spellConcentrationOnly, setSpellConcentrationOnly] = useState<boolean>(false);
  const [spellRitualOnly, setSpellRitualOnly] = useState<boolean>(false);

  // Equipment Filters
  const [equipmentKind, setEquipmentKind] = useState<EquipmentData['kind'] | 'all'>('all');
  const [weaponCategory, setWeaponCategory] = useState<WeaponCategory | 'all'>('all');
  const [armorCategory, setArmorCategory] = useState<ArmorCategory | 'all'>('all');

  // Magic Item Filters
  const [magicItemCategory, setMagicItemCategory] = useState<MagicItemCategory | 'all'>('all');
  const [magicItemRarity, setMagicItemRarity] = useState<MagicItemRarity | 'all'>('all');
  const [magicItemAttunement, setMagicItemAttunement] = useState<
    'all' | 'required' | 'not_required'
  >('all');

  // Monster Filters
  const [monsterType, setMonsterType] = useState<CreatureType | 'all'>('all');
  const [monsterSize, setMonsterSize] = useState<CreatureSize | 'all'>('all');
  const [monsterCr, setMonsterCr] = useState<ChallengeRating | 'all'>('all');
  const [monsterArchetype, setMonsterArchetype] = useState<AiArchetype | 'all'>('all');

  // Reference Filters
  const [referenceKind, setReferenceKind] = useState<'all' | 'condition' | 'background' | 'feat'>(
    'all',
  );

  const resetAllFilters = () => {
    setSearchQuery('');
    setRaceSize('all');
    setRaceAbility('all');
    setRaceDarkvisionOnly(false);
    setClassHitDie('all');
    setClassPrimaryAbility('all');
    setClassSpellcasterMode('all');
    setSpellLevel('all');
    setSpellSchool('all');
    setSpellClassId('all');
    setSpellConcentrationOnly(false);
    setSpellRitualOnly(false);
    setEquipmentKind('all');
    setWeaponCategory('all');
    setArmorCategory('all');
    setMagicItemCategory('all');
    setMagicItemRarity('all');
    setMagicItemAttunement('all');
    setMonsterType('all');
    setMonsterSize('all');
    setMonsterCr('all');
    setMonsterArchetype('all');
    setReferenceKind('all');
  };

  const handleTabChange = (nextTab: CompendiumTabId) => {
    setActiveTab(nextTab);
    setSelectedEntityId(null);
  };

  const items: readonly CompendiumListItem[] = useMemo(() => {
    const trimmedQuery = searchQuery.trim() || undefined;

    switch (activeTab) {
      case 'races': {
        const filtered = compendium.filterRaces({
          query: trimmedQuery,
          size: raceSize === 'all' ? undefined : raceSize,
          abilityBonus: raceAbility === 'all' ? undefined : raceAbility,
          hasDarkvision: raceDarkvisionOnly ? true : undefined,
        });
        return filtered.map((race) => ({
          id: race.id,
          name: race.name,
          subtitle: `${formatTitleCase(race.size)} • ${race.speedFeet} ft. • ASI: ${formatAbilityBonuses(race.abilityBonuses)}`,
          badgeText:
            race.subraceIds.length > 0
              ? `${race.subraceIds.length} Subrace${race.subraceIds.length > 1 ? 's' : ''}`
              : formatTitleCase(race.size),
          entity: { kind: 'race', data: race },
        }));
      }

      case 'classes': {
        const filtered = compendium.filterClasses({
          query: trimmedQuery,
          hitDie: classHitDie === 'all' ? undefined : classHitDie,
          primaryAbility: classPrimaryAbility === 'all' ? undefined : classPrimaryAbility,
          isSpellcaster:
            classSpellcasterMode === 'all'
              ? undefined
              : classSpellcasterMode === 'spellcaster',
        });
        return filtered.map((cls) => ({
          id: cls.id,
          name: cls.name,
          subtitle: `Primary: ${cls.primaryAbilities.map(formatAbilityAbbrev).join('/')} • Saves: ${cls.savingThrowProficiencies.map(formatAbilityAbbrev).join(', ')}`,
          badgeText: `d${cls.hitDie}`,
          entity: { kind: 'class', data: cls },
        }));
      }

      case 'spells': {
        const filtered = compendium.filterSpells({
          query: trimmedQuery,
          level: spellLevel === 'all' ? undefined : spellLevel,
          school: spellSchool === 'all' ? undefined : spellSchool,
          classId: spellClassId === 'all' ? undefined : spellClassId,
          concentration: spellConcentrationOnly ? true : undefined,
          ritual: spellRitualOnly ? true : undefined,
        });
        return filtered.map((spell) => ({
          id: spell.id,
          name: spell.name,
          subtitle: `${formatTitleCase(spell.school)} • ${formatTitleCase(spell.castingTime)}${spell.concentration ? ' • Conc.' : ''}${spell.ritual ? ' • Ritual' : ''}`,
          badgeText: spell.level === 0 ? 'Cantrip' : `Lvl ${spell.level}`,
          entity: { kind: 'spell', data: spell },
        }));
      }

      case 'equipment': {
        const filtered = compendium.filterEquipment({
          query: trimmedQuery,
          kind: equipmentKind === 'all' ? undefined : equipmentKind,
          weaponCategory: weaponCategory === 'all' ? undefined : weaponCategory,
          armorCategory: armorCategory === 'all' ? undefined : armorCategory,
        });
        return filtered.map((item) => {
          const detailSummary =
            item.kind === 'weapon'
              ? `${item.damageDice} ${item.damageType}`
              : item.kind === 'armor'
                ? item.category === 'shield'
                  ? `+${item.baseAc} AC`
                  : `AC ${item.baseAc}`
                : formatTitleCase(item.kind);
          return {
            id: item.id,
            name: item.name,
            subtitle: `${detailSummary} • ${ item.weightLb } lb.`,
            badgeText: formatCopperCost(item.costCopper),
            entity: { kind: 'equipment', data: item },
          };
        });
      }

      case 'magic_items': {
        const filtered = compendium.filterMagicItems({
          query: trimmedQuery,
          category: magicItemCategory === 'all' ? undefined : magicItemCategory,
          rarity: magicItemRarity === 'all' ? undefined : magicItemRarity,
          requiresAttunement:
            magicItemAttunement === 'all'
              ? undefined
              : magicItemAttunement === 'required',
        });
        return filtered.map((item) => ({
          id: item.id,
          name: item.name,
          subtitle: `${formatTitleCase(item.category)}${item.requiresAttunement ? ' • Attunement' : ''}`,
          badgeText: formatTitleCase(item.rarity),
          entity: { kind: 'magic_item', data: item },
        }));
      }

      case 'monsters': {
        const filtered = compendium.filterMonsters({
          query: trimmedQuery,
          type: monsterType === 'all' ? undefined : monsterType,
          size: monsterSize === 'all' ? undefined : monsterSize,
          challengeRating: monsterCr === 'all' ? undefined : monsterCr,
          aiArchetype: monsterArchetype === 'all' ? undefined : monsterArchetype,
        });
        return filtered.map((monster) => ({
          id: monster.id,
          name: monster.name,
          subtitle: `${formatTitleCase(monster.size)} ${formatTitleCase(monster.type)} • AC ${monster.armorClass.value} • HP ${monster.hitPoints.average}`,
          badgeText: `CR ${formatChallengeRating(monster.challengeRating)}`,
          entity: { kind: 'monster', data: monster },
        }));
      }

      case 'reference': {
        const results: CompendiumListItem[] = [];
        const qLower = trimmedQuery?.toLowerCase();

        if (referenceKind === 'all' || referenceKind === 'background') {
          for (const bg of compendium.filterBackgrounds({ query: trimmedQuery })) {
            results.push({
              id: `bg:${bg.id}`,
              name: bg.name,
              subtitle: `Background • Feature: ${bg.feature.name}`,
              badgeText: 'Background',
              entity: { kind: 'background', data: bg },
            });
          }
        }
        if (referenceKind === 'all' || referenceKind === 'feat') {
          for (const feat of compendium.filterFeats({ query: trimmedQuery })) {
            results.push({
              id: `feat:${feat.id}`,
              name: feat.name,
              subtitle: 'SRD 5.1 Feat',
              badgeText: 'Feat',
              entity: { kind: 'feat', data: feat },
            });
          }
        }
        if (referenceKind === 'all' || referenceKind === 'condition') {
          for (const cond of compendium.conditions) {
            if (
              !qLower ||
              cond.name.toLowerCase().includes(qLower) ||
              cond.description.toLowerCase().includes(qLower)
            ) {
              results.push({
                id: `cond:${cond.id}`,
                name: cond.name,
                subtitle: `${cond.bullets.length} effect rule${cond.bullets.length > 1 ? 's' : ''}`,
                badgeText: 'Condition',
                entity: { kind: 'condition', data: cond },
              });
            }
          }
        }
        return results;
      }
    }
  }, [
    activeTab,
    compendium,
    searchQuery,
    raceSize,
    raceAbility,
    raceDarkvisionOnly,
    classHitDie,
    classPrimaryAbility,
    classSpellcasterMode,
    spellLevel,
    spellSchool,
    spellClassId,
    spellConcentrationOnly,
    spellRitualOnly,
    equipmentKind,
    weaponCategory,
    armorCategory,
    magicItemCategory,
    magicItemRarity,
    magicItemAttunement,
    monsterType,
    monsterSize,
    monsterCr,
    monsterArchetype,
    referenceKind,
  ]);

  const activeItem: CompendiumListItem | undefined = useMemo(() => {
    if (items.length === 0) return undefined;
    if (selectedEntityId) {
      const found = items.find((i) => i.id === selectedEntityId);
      if (found) return found;
    }
    return items[0];
  }, [items, selectedEntityId]);

  const tabs: ReadonlyArray<{
    id: CompendiumTabId;
    label: string;
    totalCount: number;
  }> = [
    { id: 'races', label: 'Races', totalCount: compendium.races.length },
    { id: 'classes', label: 'Classes', totalCount: compendium.classes.length },
    { id: 'spells', label: 'Spells', totalCount: compendium.spells.length },
    { id: 'equipment', label: 'Equipment', totalCount: compendium.equipment.length },
    { id: 'magic_items', label: 'Magic Items', totalCount: compendium.magicItems.length },
    { id: 'monsters', label: 'Monsters', totalCount: compendium.monsters.length },
    {
      id: 'reference',
      label: 'Reference',
      totalCount:
        compendium.backgrounds.length + compendium.feats.length + compendium.conditions.length,
    },
  ];

  return (
    <section
      className="flex flex-col gap-4 w-full"
      aria-label="SRD 5.1 Compendium Browser"
      data-testid="compendium-browser"
    >
      {/* Category Navigation Tabs */}
      <nav
        className="flex flex-wrap gap-2 border-b border-slate-800 pb-3"
        aria-label="Compendium Categories"
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-testid={`compendium-tab-${tab.id}`}
              onClick={() => handleTabChange(tab.id)}
              className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 cursor-pointer ${
                isActive
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`text-xs px-1.5 py-0.5 rounded-full ${
                  isActive ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {tab.totalCount}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Search & Category Filter Bar */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          <div className="relative flex-1">
            <input
              type="search"
              aria-label="Search compendium"
              data-testid="compendium-search-input"
              placeholder={`Search ${formatTitleCase(activeTab)} by name, trait, or keyword...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-400"
            />
          </div>
          <div className="flex items-center justify-between sm:justify-end gap-3">
            <span
              className="text-xs font-medium text-slate-400"
              data-testid="compendium-result-count"
            >
              Showing <strong className="text-amber-300">{items.length}</strong> entries
            </span>
            <button
              type="button"
              onClick={resetAllFilters}
              data-testid="compendium-reset-filters"
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer"
            >
              Reset Filters
            </button>
          </div>
        </div>

        {/* Category-specific filters */}
        {activeTab === 'races' && (
          <div className="flex flex-wrap gap-3 items-center pt-1">
            <select
              aria-label="Filter races by size"
              value={raceSize}
              onChange={(e) => setRaceSize(e.target.value as CreatureSize | 'all')}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="all">All Sizes</option>
              <option value="small">Small</option>
              <option value="medium">Medium</option>
            </select>

            <select
              aria-label="Filter races by ability bonus"
              value={raceAbility}
              onChange={(e) => setRaceAbility(e.target.value as AbilityId | 'all')}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="all">All Ability Bonuses</option>
              {ABILITY_IDS.map((ab) => (
                <option key={ab} value={ab}>
                  +{formatAbilityAbbrev(ab)} Bonus
                </option>
              ))}
            </select>

            <label className="inline-flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={raceDarkvisionOnly}
                onChange={(e) => setRaceDarkvisionOnly(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950 text-amber-500"
              />
              Has Darkvision
            </label>
          </div>
        )}

        {activeTab === 'classes' && (
          <div className="flex flex-wrap gap-3 items-center pt-1">
            <select
              aria-label="Filter classes by hit die"
              value={classHitDie === 'all' ? 'all' : String(classHitDie)}
              onChange={(e) =>
                setClassHitDie(
                  e.target.value === 'all' ? 'all' : (Number(e.target.value) as HitDieSize),
                )
              }
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="all">All Hit Dice</option>
              {HIT_DIE_SIZES.map((hd) => (
                <option key={hd} value={hd}>
                  d{hd} Hit Die
                </option>
              ))}
            </select>

            <select
              aria-label="Filter classes by primary ability"
              value={classPrimaryAbility}
              onChange={(e) => setClassPrimaryAbility(e.target.value as AbilityId | 'all')}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="all">All Primary Abilities</option>
              {ABILITY_IDS.map((ab) => (
                <option key={ab} value={ab}>
                  {formatAbilityAbbrev(ab)}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter classes by spellcasting"
              value={classSpellcasterMode}
              onChange={(e) =>
                setClassSpellcasterMode(e.target.value as 'all' | 'spellcaster' | 'martial')
              }
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="all">All Classes</option>
              <option value="spellcaster">Spellcasters Only</option>
              <option value="martial">Non-Spellcasters Only</option>
            </select>
          </div>
        )}

        {activeTab === 'spells' && (
          <div className="flex flex-wrap gap-3 items-center pt-1">
            <select
              aria-label="Filter spells by level"
              value={spellLevel === 'all' ? 'all' : String(spellLevel)}
              onChange={(e) =>
                setSpellLevel(
                  e.target.value === 'all' ? 'all' : (Number(e.target.value) as SpellLevel),
                )
              }
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="all">All Spell Levels</option>
              {SPELL_LEVELS.map((lvl) => (
                <option key={lvl} value={lvl}>
                  {formatSpellLevel(lvl)}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter spells by school"
              value={spellSchool}
              onChange={(e) => setSpellSchool(e.target.value as MagicSchool | 'all')}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="all">All Magic Schools</option>
              {MAGIC_SCHOOLS.map((school) => (
                <option key={school} value={school}>
                  {formatTitleCase(school)}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter spells by class"
              value={spellClassId}
              onChange={(e) => setSpellClassId(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="all">All Caster Classes</option>
              {SPELLCASTER_CLASS_IDS.map((clsId) => (
                <option key={clsId} value={clsId}>
                  {formatTitleCase(clsId)}
                </option>
              ))}
            </select>

            <label className="inline-flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={spellConcentrationOnly}
                onChange={(e) => setSpellConcentrationOnly(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950 text-amber-500"
              />
              Concentration
            </label>

            <label className="inline-flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={spellRitualOnly}
                onChange={(e) => setSpellRitualOnly(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950 text-amber-500"
              />
              Ritual
            </label>
          </div>
        )}

        {activeTab === 'equipment' && (
          <div className="flex flex-wrap gap-3 items-center pt-1">
            <select
              aria-label="Filter equipment by kind"
              value={equipmentKind}
              onChange={(e) => setEquipmentKind(e.target.value as EquipmentData['kind'] | 'all')}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="all">All Equipment Kinds</option>
              <option value="weapon">Weapons</option>
              <option value="armor">Armor & Shields</option>
              <option value="gear">Adventuring Gear</option>
              <option value="tool">Tools</option>
              <option value="pack">Equipment Packs</option>
            </select>

            <select
              aria-label="Filter equipment by weapon category"
              value={weaponCategory}
              onChange={(e) => setWeaponCategory(e.target.value as WeaponCategory | 'all')}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="all">All Weapon Categories</option>
              {WEAPON_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {formatTitleCase(cat)} Weapons
                </option>
              ))}
            </select>

            <select
              aria-label="Filter equipment by armor category"
              value={armorCategory}
              onChange={(e) => setArmorCategory(e.target.value as ArmorCategory | 'all')}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="all">All Armor Categories</option>
              {ARMOR_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {formatTitleCase(cat)}
                </option>
              ))}
            </select>
          </div>
        )}

        {activeTab === 'magic_items' && (
          <div className="flex flex-wrap gap-3 items-center pt-1">
            <select
              aria-label="Filter magic items by category"
              value={magicItemCategory}
              onChange={(e) => setMagicItemCategory(e.target.value as MagicItemCategory | 'all')}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="all">All Magic Item Categories</option>
              {MAGIC_ITEM_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {formatTitleCase(cat)}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter magic items by rarity"
              value={magicItemRarity}
              onChange={(e) => setMagicItemRarity(e.target.value as MagicItemRarity | 'all')}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="all">All Rarities</option>
              {MAGIC_ITEM_RARITIES.map((rarity) => (
                <option key={rarity} value={rarity}>
                  {formatTitleCase(rarity)}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter magic items by attunement"
              value={magicItemAttunement}
              onChange={(e) =>
                setMagicItemAttunement(e.target.value as 'all' | 'required' | 'not_required')
              }
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="all">All Attunement</option>
              <option value="required">Requires Attunement</option>
              <option value="not_required">No Attunement Required</option>
            </select>
          </div>
        )}

        {activeTab === 'monsters' && (
          <div className="flex flex-wrap gap-3 items-center pt-1">
            <select
              aria-label="Filter monsters by creature type"
              value={monsterType}
              onChange={(e) => setMonsterType(e.target.value as CreatureType | 'all')}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="all">All Creature Types</option>
              {CREATURE_TYPES.map((ct) => (
                <option key={ct} value={ct}>
                  {formatTitleCase(ct)}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter monsters by size"
              value={monsterSize}
              onChange={(e) => setMonsterSize(e.target.value as CreatureSize | 'all')}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="all">All Sizes</option>
              {CREATURE_SIZES.map((sz) => (
                <option key={sz} value={sz}>
                  {formatTitleCase(sz)}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter monsters by challenge rating"
              value={monsterCr === 'all' ? 'all' : String(monsterCr)}
              onChange={(e) =>
                setMonsterCr(
                  e.target.value === 'all' ? 'all' : (Number(e.target.value) as ChallengeRating),
                )
              }
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="all">All Challenge Ratings</option>
              {CHALLENGE_RATINGS.map((cr) => (
                <option key={cr} value={cr}>
                  CR {formatChallengeRating(cr)}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter monsters by AI archetype"
              value={monsterArchetype}
              onChange={(e) => setMonsterArchetype(e.target.value as AiArchetype | 'all')}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="all">All AI Archetypes</option>
              {AI_ARCHETYPES.map((arch) => (
                <option key={arch} value={arch}>
                  {formatTitleCase(arch)}
                </option>
              ))}
            </select>
          </div>
        )}

        {activeTab === 'reference' && (
          <div className="flex flex-wrap gap-3 items-center pt-1">
            <select
              aria-label="Filter reference by kind"
              value={referenceKind}
              onChange={(e) =>
                setReferenceKind(e.target.value as 'all' | 'condition' | 'background' | 'feat')
              }
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="all">All Reference Entries</option>
              <option value="condition">Conditions (15)</option>
              <option value="background">Backgrounds</option>
              <option value="feat">Feats</option>
            </select>
          </div>
        )}
      </div>

      {/* Master-Detail Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Entity List (Left Column) */}
        <div
          className="lg:col-span-5 bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden flex flex-col max-h-[640px]"
          data-testid="compendium-entity-list"
        >
          {items.length === 0 ? (
            <div className="p-8 text-center space-y-3">
              <p className="text-sm text-slate-400">
                No SRD 5.1 entries match your current search or filter criteria.
              </p>
              <button
                type="button"
                onClick={resetAllFilters}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 text-slate-950 cursor-pointer"
              >
                Clear All Filters
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-slate-800/80 overflow-y-auto">
              {items.map((item) => {
                const isSelected = activeItem?.id === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      data-testid={`compendium-item-${item.id}`}
                      onClick={() => setSelectedEntityId(item.id)}
                      className={`w-full text-left px-4 py-3 transition-colors flex items-center justify-between gap-3 cursor-pointer ${
                        isSelected
                          ? 'bg-amber-500/15 border-l-4 border-amber-400'
                          : 'hover:bg-slate-800/60'
                      }`}
                    >
                      <div className="min-w-0">
                        <div
                          className={`text-sm font-semibold truncate ${
                            isSelected ? 'text-amber-300' : 'text-slate-100'
                          }`}
                        >
                          {item.name}
                        </div>
                        <div className="text-xs text-slate-400 truncate mt-0.5">
                          {item.subtitle}
                        </div>
                      </div>
                      <span className="shrink-0 text-[11px] font-medium px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                        {item.badgeText}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Entity Detail Inspector (Right Column) */}
        <div
          className="lg:col-span-7 bg-slate-900/60 border border-slate-800 rounded-xl p-5 min-h-[420px] max-h-[640px] overflow-y-auto"
          data-testid="compendium-detail-pane"
        >
          {activeItem ? (
            <EntityDetailView entity={activeItem.entity} compendium={compendium} />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-slate-500 py-16">
              Select an entry from the list to inspect its full SRD 5.1 statistics.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
