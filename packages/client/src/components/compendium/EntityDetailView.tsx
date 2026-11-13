import {
  ABILITY_IDS,
  type AbilityId,
  type ArmorData,
  type BackgroundData,
  type ClassData,
  type ConditionDefinition,
  type EquipmentData,
  type EquipmentPackData,
  type FeatData,
  type GearData,
  type MagicItemData,
  type MonsterActionSpec,
  type MonsterData,
  type RaceData,
  type SpellData,
  type SrdCompendium,
  type ToolData,
  type WeaponData,
} from '@srd5/data';
import {
  formatAbilityAbbrev,
  formatAbilityBonuses,
  formatAbilityScoreWithMod,
  formatChallengeRating,
  formatCopperCost,
  formatSignedNumber,
  formatSpellComponents,
  formatSpellDuration,
  formatSpellLevel,
  formatSpellRange,
  formatTitleCase,
} from './formatters.js';

export type InspectableEntity =
  | { kind: 'race'; data: RaceData }
  | { kind: 'class'; data: ClassData }
  | { kind: 'spell'; data: SpellData }
  | { kind: 'equipment'; data: EquipmentData }
  | { kind: 'magic_item'; data: MagicItemData }
  | { kind: 'monster'; data: MonsterData }
  | { kind: 'background'; data: BackgroundData }
  | { kind: 'feat'; data: FeatData }
  | { kind: 'condition'; data: ConditionDefinition };

interface EntityDetailViewProps {
  entity: InspectableEntity;
  compendium: SrdCompendium;
}

function Badge({
  children,
  variant = 'default',
}: {
  children: React.ReactNode;
  variant?: 'default' | 'amber' | 'emerald' | 'sky' | 'purple' | 'rose';
}) {
  const styles: Record<NonNullable<typeof variant>, string> = {
    default: 'bg-slate-800 text-slate-300 border-slate-700',
    amber: 'bg-amber-950/60 text-amber-300 border-amber-700/60',
    emerald: 'bg-emerald-950/60 text-emerald-300 border-emerald-700/60',
    sky: 'bg-sky-950/60 text-sky-300 border-sky-700/60',
    purple: 'bg-purple-950/60 text-purple-300 border-purple-700/60',
    rose: 'bg-rose-950/60 text-rose-300 border-rose-700/60',
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium border ${styles[variant]}`}
    >
      {children}
    </span>
  );
}

function RaceDetail({ race, compendium }: { race: RaceData; compendium: SrdCompendium }) {
  const subraces = compendium.getSubracesForRace(race.id);
  const languageNames = race.languages.map((id) => compendium.getLanguage(id)?.name ?? id);
  const profNames = race.proficiencies.map((id) => compendium.getProficiency(id)?.name ?? id);

  return (
    <article className="space-y-6" data-testid="compendium-detail-race">
      <div className="border-b border-slate-800 pb-4">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Badge variant="amber">Race</Badge>
          <Badge>{formatTitleCase(race.size)}</Badge>
          <Badge>{race.speedFeet} ft. Speed</Badge>
          {race.senses.darkvisionFeet ? (
            <Badge variant="purple">Darkvision {race.senses.darkvisionFeet} ft.</Badge>
          ) : null}
        </div>
        <h2 className="text-2xl font-bold text-amber-300">{race.name}</h2>
        <p className="mt-2 text-sm text-slate-300 leading-relaxed">{race.description}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-900/70 border border-slate-800 rounded-lg p-4 text-sm">
        <div>
          <span className="block text-xs uppercase tracking-wider text-slate-400">
            Ability Score Increase
          </span>
          <span className="font-semibold text-slate-100">
            {formatAbilityBonuses(race.abilityBonuses)}
          </span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wider text-slate-400">Languages</span>
          <span className="font-semibold text-slate-100">
            {languageNames.length > 0 ? languageNames.join(', ') : 'None'}
          </span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wider text-slate-400">
            Proficiencies
          </span>
          <span className="font-semibold text-slate-100">
            {profNames.length > 0 ? profNames.join(', ') : 'None'}
          </span>
        </div>
      </div>

      {race.traits.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-400">
            Racial Traits
          </h3>
          <div className="space-y-3">
            {race.traits.map((trait) => (
              <div
                key={trait.id}
                className="bg-slate-900/50 border border-slate-800/80 rounded-lg p-3.5"
              >
                <h4 className="font-semibold text-slate-100">{trait.name}</h4>
                <p className="mt-1 text-sm text-slate-300 leading-relaxed">{trait.description}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {subraces.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-400">
            Subraces ({subraces.length})
          </h3>
          <div className="space-y-4">
            {subraces.map((subrace) => (
              <div
                key={subrace.id}
                className="bg-slate-900/70 border border-amber-900/40 rounded-lg p-4 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-lg font-bold text-amber-200">{subrace.name}</h4>
                  <Badge variant="amber">
                    ASI: {formatAbilityBonuses(subrace.abilityBonuses)}
                  </Badge>
                </div>
                <p className="text-sm text-slate-300">{subrace.description}</p>
                {subrace.traits.length > 0 && (
                  <div className="pt-2 space-y-2 border-t border-slate-800">
                    {subrace.traits.map((trait) => (
                      <div key={trait.id} className="text-sm">
                        <span className="font-semibold text-slate-200">{trait.name}: </span>
                        <span className="text-slate-300">{trait.description}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}

function ClassDetail({ cls, compendium }: { cls: ClassData; compendium: SrdCompendium }) {
  const subclasses = compendium.getSubclassesForClass(cls.id);
  const features = compendium.getFeaturesForClass(cls.id);
  const classSpells = compendium.getSpellsForClass(cls.id);

  return (
    <article className="space-y-6" data-testid="compendium-detail-class">
      <div className="border-b border-slate-800 pb-4">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Badge variant="amber">Class</Badge>
          <Badge variant="emerald">Hit Die: d{cls.hitDie}</Badge>
          <Badge>
            Primary: {cls.primaryAbilities.map((a) => formatAbilityAbbrev(a)).join(' / ')}
          </Badge>
          <Badge>
            Saves: {cls.savingThrowProficiencies.map((a) => formatAbilityAbbrev(a)).join(', ')}
          </Badge>
          {cls.spellcasting ? (
            <Badge variant="purple">
              Spellcaster ({formatAbilityAbbrev(cls.spellcasting.ability)} &middot;{' '}
              {formatTitleCase(cls.spellcasting.progression)})
            </Badge>
          ) : (
            <Badge>Martial</Badge>
          )}
        </div>
        <h2 className="text-2xl font-bold text-amber-300">{cls.name}</h2>
        {cls.description && (
          <p className="mt-2 text-sm text-slate-300 leading-relaxed">{cls.description}</p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-900/70 border border-slate-800 rounded-lg p-4 text-sm">
        <div>
          <span className="block text-xs uppercase tracking-wider text-slate-400">
            Armor & Weapon Proficiencies
          </span>
          <span className="text-slate-200">
            {[...cls.armorProficiencies, ...cls.weaponProficiencies]
              .map((id) => compendium.getProficiency(id)?.name ?? formatTitleCase(id))
              .join(', ') || 'None'}
          </span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wider text-slate-400">
            Subclass Unlock ({cls.subclassTitle})
          </span>
          <span className="text-slate-200">
            Level {cls.subclassLevel} &middot;{' '}
            {subclasses.map((sc) => sc.name).join(', ') || 'None'}
          </span>
        </div>
      </div>

      {subclasses.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-400">
            SRD 5.1 {cls.subclassTitle}
          </h3>
          {subclasses.map((sc) => {
            const scFeatures = compendium.getFeaturesForSubclass(sc.id);
            return (
              <div
                key={sc.id}
                className="bg-slate-900/70 border border-amber-900/40 rounded-lg p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-lg font-bold text-amber-200">{sc.name}</h4>
                  <Badge variant="amber">{sc.subclassFlavor}</Badge>
                </div>
                <p className="text-sm text-slate-300 leading-relaxed">{sc.description}</p>
                {scFeatures.length > 0 && (
                  <div className="pt-2 border-t border-slate-800 space-y-2">
                    {scFeatures.map((feat) => (
                      <div key={feat.id} className="text-sm">
                        <span className="font-semibold text-amber-300/90">
                          Level {feat.level} — {feat.name}:{' '}
                        </span>
                        <span className="text-slate-300">{feat.description}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-400">
          Level 1–20 Progression Table
        </h3>
        <div className="overflow-x-auto border border-slate-800 rounded-lg">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-900 text-slate-400 uppercase border-b border-slate-800">
              <tr>
                <th className="py-2 px-3">Lvl</th>
                <th className="py-2 px-3">Prof</th>
                <th className="py-2 px-3">Features Unlocked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 bg-slate-950/40">
              {cls.levels.map((lvl) => {
                const featNames = lvl.featureIds.map(
                  (fId) => compendium.getFeature(fId)?.name ?? formatTitleCase(fId),
                );
                return (
                  <tr key={lvl.level} className="hover:bg-slate-900/50">
                    <td className="py-1.5 px-3 font-semibold text-amber-300">{lvl.level}</td>
                    <td className="py-1.5 px-3">+{lvl.proficiencyBonus}</td>
                    <td className="py-1.5 px-3">
                      {featNames.length > 0 ? featNames.join(', ') : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {features.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-400">
            Class Features ({features.length})
          </h3>
          <div className="space-y-3">
            {features.map((feat) => (
              <div
                key={feat.id}
                className="bg-slate-900/50 border border-slate-800/80 rounded-lg p-3.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-semibold text-slate-100">{feat.name}</h4>
                  <Badge>Level {feat.level}</Badge>
                </div>
                <p className="mt-1.5 text-sm text-slate-300 leading-relaxed">{feat.description}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {classSpells.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-400">
            Class Spell List ({classSpells.length} SRD Spells)
          </h3>
          <p className="text-xs text-slate-400">
            Includes cantrips and leveled spells available to {cls.name}s in SRD 5.1.
          </p>
        </section>
      )}
    </article>
  );
}

function SpellDetail({ spell, compendium }: { spell: SpellData; compendium: SrdCompendium }) {
  const classNames = spell.classes.map((id) => compendium.getClass(id)?.name ?? formatTitleCase(id));

  return (
    <article className="space-y-6" data-testid="compendium-detail-spell">
      <div className="border-b border-slate-800 pb-4">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Badge variant="purple">{formatSpellLevel(spell.level)}</Badge>
          <Badge variant="sky">{formatTitleCase(spell.school)}</Badge>
          {spell.concentration && <Badge variant="amber">Concentration</Badge>}
          {spell.ritual && <Badge variant="emerald">Ritual</Badge>}
        </div>
        <h2 className="text-2xl font-bold text-amber-300">{spell.name}</h2>
        <p className="text-xs text-slate-400 italic mt-1">
          {spell.level === 0
            ? `${formatTitleCase(spell.school)} cantrip`
            : `${formatSpellLevel(spell.level)} ${spell.school}`}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-900/70 border border-slate-800 rounded-lg p-4 text-sm">
        <div>
          <span className="block text-xs uppercase tracking-wider text-slate-400">
            Casting Time
          </span>
          <span className="font-semibold text-slate-100">
            {formatTitleCase(spell.castingTime)}
          </span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wider text-slate-400">
            Range / Area
          </span>
          <span className="font-semibold text-slate-100">
            {formatSpellRange(spell.targeting)}
          </span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wider text-slate-400">Components</span>
          <span className="font-semibold text-slate-100">
            {formatSpellComponents(spell.components)}
          </span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wider text-slate-400">Duration</span>
          <span className="font-semibold text-slate-100">
            {formatSpellDuration(spell.duration, spell.concentration)}
          </span>
        </div>
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-400">
          Description
        </h3>
        <div className="bg-slate-900/50 border border-slate-800/80 rounded-lg p-4 text-sm text-slate-200 leading-relaxed whitespace-pre-line">
          {spell.description}
        </div>
      </section>

      {spell.higherLevelDescription && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-400">
            At Higher Levels
          </h3>
          <div className="bg-amber-950/20 border border-amber-800/40 rounded-lg p-3.5 text-sm text-slate-200 leading-relaxed">
            {spell.higherLevelDescription}
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800 text-xs text-slate-400">
        <span className="font-semibold uppercase tracking-wider text-slate-300">Classes:</span>
        {classNames.map((name) => (
          <Badge key={name}>{name}</Badge>
        ))}
      </div>
    </article>
  );
}

function EquipmentDetail({
  item,
  compendium,
}: {
  item: EquipmentData;
  compendium: SrdCompendium;
}) {
  return (
    <article className="space-y-6" data-testid="compendium-detail-equipment">
      <div className="border-b border-slate-800 pb-4">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Badge variant="amber">{formatTitleCase(item.kind)}</Badge>
          <Badge>{formatCopperCost(item.costCopper)}</Badge>
          <Badge>{item.weightLb} lb.</Badge>
        </div>
        <h2 className="text-2xl font-bold text-amber-300">{item.name}</h2>
      </div>

      {item.kind === 'weapon' && <WeaponSubDetail weapon={item} />}
      {item.kind === 'armor' && <ArmorSubDetail armor={item} />}
      {item.kind === 'gear' && <GearSubDetail gear={item} />}
      {item.kind === 'tool' && <ToolSubDetail tool={item} />}
      {item.kind === 'pack' && <PackSubDetail pack={item} compendium={compendium} />}

      {item.description && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-400">
            Description
          </h3>
          <p className="bg-slate-900/50 border border-slate-800/80 rounded-lg p-4 text-sm text-slate-300 leading-relaxed">
            {item.description}
          </p>
        </section>
      )}
    </article>
  );
}

function WeaponSubDetail({ weapon }: { weapon: WeaponData }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-900/70 border border-slate-800 rounded-lg p-4 text-sm">
      <div>
        <span className="block text-xs uppercase tracking-wider text-slate-400">Category</span>
        <span className="font-semibold text-slate-100">
          {formatTitleCase(weapon.category)} {formatTitleCase(weapon.rangeType)}
        </span>
      </div>
      <div>
        <span className="block text-xs uppercase tracking-wider text-slate-400">Damage</span>
        <span className="font-semibold text-amber-300">
          {weapon.damageDice} {weapon.damageType}
          {weapon.versatileDamageDice ? ` (Versatile ${weapon.versatileDamageDice})` : ''}
        </span>
      </div>
      <div>
        <span className="block text-xs uppercase tracking-wider text-slate-400">Range</span>
        <span className="font-semibold text-slate-100">
          {weapon.rangeFeet
            ? `${weapon.rangeFeet.normal}/${weapon.rangeFeet.long} ft.`
            : weapon.properties.includes('reach')
              ? '10 ft. reach'
              : '5 ft. melee'}
        </span>
      </div>
      <div>
        <span className="block text-xs uppercase tracking-wider text-slate-400">Properties</span>
        <span className="font-semibold text-slate-100">
          {weapon.properties.length > 0
            ? weapon.properties.map(formatTitleCase).join(', ')
            : 'None'}
        </span>
      </div>
    </div>
  );
}

function ArmorSubDetail({ armor }: { armor: ArmorData }) {
  const acFormula =
    armor.category === 'shield'
      ? `+${armor.baseAc} AC`
      : armor.addDexModifier
        ? armor.maxDexBonus !== undefined
          ? `${armor.baseAc} + DEX (max +${armor.maxDexBonus})`
          : `${armor.baseAc} + DEX`
        : `${armor.baseAc}`;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-900/70 border border-slate-800 rounded-lg p-4 text-sm">
      <div>
        <span className="block text-xs uppercase tracking-wider text-slate-400">Armor Type</span>
        <span className="font-semibold text-slate-100">{formatTitleCase(armor.category)}</span>
      </div>
      <div>
        <span className="block text-xs uppercase tracking-wider text-slate-400">Armor Class</span>
        <span className="font-semibold text-emerald-300">{acFormula}</span>
      </div>
      <div>
        <span className="block text-xs uppercase tracking-wider text-slate-400">
          Strength Req.
        </span>
        <span className="font-semibold text-slate-100">
          {armor.strengthRequirement ? `STR ${armor.strengthRequirement}` : 'None'}
        </span>
      </div>
      <div>
        <span className="block text-xs uppercase tracking-wider text-slate-400">Stealth</span>
        <span className="font-semibold text-slate-100">
          {armor.stealthDisadvantage ? 'Disadvantage' : 'Normal'}
        </span>
      </div>
    </div>
  );
}

function GearSubDetail({ gear }: { gear: GearData }) {
  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-4 text-sm">
      <span className="text-xs uppercase tracking-wider text-slate-400 mr-2">Gear Category:</span>
      <span className="font-semibold text-slate-100">{formatTitleCase(gear.category)}</span>
    </div>
  );
}

function ToolSubDetail({ tool }: { tool: ToolData }) {
  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-4 text-sm flex flex-wrap gap-6">
      <div>
        <span className="block text-xs uppercase tracking-wider text-slate-400">Tool Category</span>
        <span className="font-semibold text-slate-100">{formatTitleCase(tool.category)}</span>
      </div>
      {tool.defaultAbility && (
        <div>
          <span className="block text-xs uppercase tracking-wider text-slate-400">
            Default Ability
          </span>
          <span className="font-semibold text-slate-100">
            {formatAbilityAbbrev(tool.defaultAbility)}
          </span>
        </div>
      )}
    </div>
  );
}

function PackSubDetail({
  pack,
  compendium,
}: {
  pack: EquipmentPackData;
  compendium: SrdCompendium;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-400">
        Pack Contents ({pack.contents.length} items)
      </h3>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-900/60 border border-slate-800 rounded-lg p-4 text-sm">
        {pack.contents.map((entry) => {
          const resolved = compendium.getEquipment(entry.itemId);
          return (
            <li key={entry.itemId} className="flex items-center justify-between text-slate-200">
              <span>{resolved?.name ?? formatTitleCase(entry.itemId)}</span>
              <span className="text-xs font-mono text-amber-300">&times;{entry.quantity}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function MagicItemDetail({ item }: { item: MagicItemData }) {
  return (
    <article className="space-y-6" data-testid="compendium-detail-magic-item">
      <div className="border-b border-slate-800 pb-4">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Badge variant="purple">{formatTitleCase(item.rarity)}</Badge>
          <Badge variant="amber">{formatTitleCase(item.category)}</Badge>
          {item.requiresAttunement && (
            <Badge variant="rose">
              Requires Attunement
              {item.attunementRestriction ? ` (${item.attunementRestriction})` : ''}
            </Badge>
          )}
        </div>
        <h2 className="text-2xl font-bold text-amber-300">{item.name}</h2>
      </div>

      {item.charges && (
        <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-3.5 text-sm">
          <span className="text-slate-400">Charges: </span>
          <span className="font-semibold text-amber-300">Up to {item.charges.max} charges</span>
          {item.charges.rechargeFormula && (
            <span className="text-slate-300">
              {' '}
              (Recharges {item.charges.rechargeFormula} at{' '}
              {formatTitleCase(item.charges.rechargeTiming ?? 'dawn')})
            </span>
          )}
        </div>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-400">
          Description
        </h3>
        <div className="bg-slate-900/50 border border-slate-800/80 rounded-lg p-4 text-sm text-slate-200 leading-relaxed whitespace-pre-line">
          {item.description}
        </div>
      </section>
    </article>
  );
}

function MonsterActionList({
  title,
  actions,
}: {
  title: string;
  actions: readonly MonsterActionSpec[];
}) {
  if (actions.length === 0) return null;
  return (
    <section className="space-y-2.5">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-400 border-b border-amber-900/50 pb-1">
        {title}
      </h3>
      <div className="space-y-2.5">
        {actions.map((action) => (
          <div
            key={action.id}
            className="bg-slate-900/50 border border-slate-800/80 rounded-lg p-3 text-sm"
          >
            <span className="font-bold italic text-amber-200">{action.name}. </span>
            <span className="text-slate-200 leading-relaxed">{action.description}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function MonsterDetail({ monster }: { monster: MonsterData }) {
  const speedParts: string[] = [`${monster.speed.walk} ft.`];
  if (monster.speed.fly)
    speedParts.push(`fly ${monster.speed.fly} ft.${monster.speed.hover ? ' (hover)' : ''}`);
  if (monster.speed.swim) speedParts.push(`swim ${monster.speed.swim} ft.`);
  if (monster.speed.climb) speedParts.push(`climb ${monster.speed.climb} ft.`);
  if (monster.speed.burrow) speedParts.push(`burrow ${monster.speed.burrow} ft.`);

  const saveEntries = (Object.entries(monster.savingThrows) as Array<[AbilityId, number | undefined]>)
    .filter((entry): entry is [AbilityId, number] => typeof entry[1] === 'number')
    .map(([ab, mod]) => `${formatAbilityAbbrev(ab)} ${formatSignedNumber(mod)}`);

  const skillEntries = Object.entries(monster.skills)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .map(([skill, mod]) => `${formatTitleCase(skill)} ${formatSignedNumber(mod)}`);

  const senseParts: string[] = [];
  if (monster.senses.darkvisionFeet)
    senseParts.push(`Darkvision ${monster.senses.darkvisionFeet} ft.`);
  if (monster.senses.blindsightFeet)
    senseParts.push(`Blindsight ${monster.senses.blindsightFeet} ft.`);
  if (monster.senses.tremorsenseFeet)
    senseParts.push(`Tremorsense ${monster.senses.tremorsenseFeet} ft.`);
  if (monster.senses.truesightFeet)
    senseParts.push(`Truesight ${monster.senses.truesightFeet} ft.`);
  senseParts.push(`Passive Perception ${monster.senses.passivePerception}`);

  return (
    <article className="space-y-5" data-testid="compendium-detail-monster">
      <div className="border-b border-amber-900/60 pb-4">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Badge variant="rose">
            CR {formatChallengeRating(monster.challengeRating)} ({monster.xp.toLocaleString()} XP)
          </Badge>
          <Badge variant="amber">{formatTitleCase(monster.size)}</Badge>
          <Badge>{formatTitleCase(monster.type)}</Badge>
          <Badge variant="sky">AI: {formatTitleCase(monster.aiArchetype)}</Badge>
        </div>
        <h2 className="text-2xl font-bold text-amber-300">{monster.name}</h2>
        <p className="text-xs italic text-slate-400 mt-1">
          {formatTitleCase(monster.size)} {monster.type}
          {monster.subtype ? ` (${monster.subtype})` : ''}, {formatTitleCase(monster.alignment)}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-900/70 border border-slate-800 rounded-lg p-3.5 text-sm">
        <div>
          <span className="block text-xs uppercase tracking-wider text-slate-400">
            Armor Class
          </span>
          <span className="font-bold text-emerald-300">
            {monster.armorClass.value}{' '}
            <span className="text-xs font-normal text-slate-400">
              ({monster.armorClass.notes ?? formatTitleCase(monster.armorClass.type)})
            </span>
          </span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wider text-slate-400">Hit Points</span>
          <span className="font-bold text-rose-300">
            {monster.hitPoints.average}{' '}
            <span className="text-xs font-normal text-slate-400">
              ({monster.hitPoints.rollFormula})
            </span>
          </span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wider text-slate-400">Speed</span>
          <span className="font-semibold text-slate-100">{speedParts.join(', ')}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 bg-slate-900/90 border border-amber-900/40 rounded-lg p-3 text-center">
        {ABILITY_IDS.map((ab) => (
          <div key={ab} className="bg-slate-950/60 rounded p-2 border border-slate-800/80">
            <div className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
              {formatAbilityAbbrev(ab)}
            </div>
            <div className="text-sm font-semibold text-slate-100 mt-0.5">
              {formatAbilityScoreWithMod(monster.abilities[ab])}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-3.5 text-xs space-y-1.5 text-slate-300">
        {saveEntries.length > 0 && (
          <div>
            <strong className="text-slate-100">Saving Throws: </strong>
            {saveEntries.join(', ')}
          </div>
        )}
        {skillEntries.length > 0 && (
          <div>
            <strong className="text-slate-100">Skills: </strong>
            {skillEntries.join(', ')}
          </div>
        )}
        {monster.damageVulnerabilities.length > 0 && (
          <div>
            <strong className="text-slate-100">Damage Vulnerabilities: </strong>
            {monster.damageVulnerabilities.map(formatTitleCase).join(', ')}
          </div>
        )}
        {monster.damageResistances.length > 0 && (
          <div>
            <strong className="text-slate-100">Damage Resistances: </strong>
            {monster.damageResistances.map(formatTitleCase).join(', ')}
          </div>
        )}
        {monster.damageImmunities.length > 0 && (
          <div>
            <strong className="text-slate-100">Damage Immunities: </strong>
            {monster.damageImmunities.map(formatTitleCase).join(', ')}
          </div>
        )}
        {monster.conditionImmunities.length > 0 && (
          <div>
            <strong className="text-slate-100">Condition Immunities: </strong>
            {monster.conditionImmunities.map(formatTitleCase).join(', ')}
          </div>
        )}
        <div>
          <strong className="text-slate-100">Senses: </strong>
          {senseParts.join(', ')}
        </div>
        <div>
          <strong className="text-slate-100">Languages: </strong>
          {monster.languages.length > 0
            ? monster.languages.map(formatTitleCase).join(', ')
            : '—'}
        </div>
      </div>

      {monster.traits.length > 0 && (
        <section className="space-y-2.5">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-400 border-b border-amber-900/50 pb-1">
            Special Traits
          </h3>
          <div className="space-y-2.5">
            {monster.traits.map((trait) => (
              <div
                key={trait.id}
                className="bg-slate-900/50 border border-slate-800/80 rounded-lg p-3 text-sm"
              >
                <span className="font-bold italic text-amber-200">{trait.name}. </span>
                <span className="text-slate-200 leading-relaxed">{trait.description}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <MonsterActionList title="Actions" actions={monster.actions} />
      {monster.bonusActions && (
        <MonsterActionList title="Bonus Actions" actions={monster.bonusActions} />
      )}
      {monster.reactions && <MonsterActionList title="Reactions" actions={monster.reactions} />}
      {monster.legendaryActions && (
        <MonsterActionList
          title={`Legendary Actions (${monster.legendaryActions.perRound}/Round)`}
          actions={monster.legendaryActions.actions}
        />
      )}
    </article>
  );
}

function BackgroundDetail({ background }: { background: BackgroundData }) {
  return (
    <article className="space-y-5" data-testid="compendium-detail-background">
      <div className="border-b border-slate-800 pb-4">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Badge variant="amber">Background</Badge>
          {background.skillProficiencies.map((skill) => (
            <Badge key={skill} variant="emerald">
              Skill: {formatTitleCase(skill)}
            </Badge>
          ))}
        </div>
        <h2 className="text-2xl font-bold text-amber-300">{background.name}</h2>
        <p className="mt-2 text-sm text-slate-300 leading-relaxed">{background.description}</p>
      </div>

      <section className="bg-slate-900/60 border border-slate-800 rounded-lg p-4 space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-400">
          Feature: {background.feature.name}
        </h3>
        <p className="text-sm text-slate-200 leading-relaxed">{background.feature.description}</p>
      </section>
    </article>
  );
}

function FeatDetail({ feat }: { feat: FeatData }) {
  return (
    <article className="space-y-5" data-testid="compendium-detail-feat">
      <div className="border-b border-slate-800 pb-4">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Badge variant="amber">Feat</Badge>
          {feat.prerequisites.map((prereq, idx) => (
            <Badge key={idx} variant="rose">
              {prereq.type === 'ability_minimum'
                ? `Requires ${formatAbilityAbbrev(prereq.ability)} ${prereq.minimum}+`
                : formatTitleCase(prereq.type)}
            </Badge>
          ))}
        </div>
        <h2 className="text-2xl font-bold text-amber-300">{feat.name}</h2>
        <p className="mt-2 text-sm text-slate-300 leading-relaxed whitespace-pre-line">
          {feat.description}
        </p>
      </div>
    </article>
  );
}

function ConditionDetail({ condition }: { condition: ConditionDefinition }) {
  return (
    <article className="space-y-5" data-testid="compendium-detail-condition">
      <div className="border-b border-slate-800 pb-4">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Badge variant="rose">Condition</Badge>
        </div>
        <h2 className="text-2xl font-bold text-amber-300">{condition.name}</h2>
        <p className="mt-2 text-sm text-slate-300 leading-relaxed">{condition.description}</p>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-400">
          Mechanical Effects
        </h3>
        <ul className="list-disc list-inside space-y-1.5 bg-slate-900/60 border border-slate-800 rounded-lg p-4 text-sm text-slate-200">
          {condition.bullets.map((bullet, idx) => (
            <li key={idx} className="leading-relaxed">
              {bullet}
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}

export function EntityDetailView({ entity, compendium }: EntityDetailViewProps) {
  switch (entity.kind) {
    case 'race':
      return <RaceDetail race={entity.data} compendium={compendium} />;
    case 'class':
      return <ClassDetail cls={entity.data} compendium={compendium} />;
    case 'spell':
      return <SpellDetail spell={entity.data} compendium={compendium} />;
    case 'equipment':
      return <EquipmentDetail item={entity.data} compendium={compendium} />;
    case 'magic_item':
      return <MagicItemDetail item={entity.data} />;
    case 'monster':
      return <MonsterDetail monster={entity.data} />;
    case 'background':
      return <BackgroundDetail background={entity.data} />;
    case 'feat':
      return <FeatDetail feat={entity.data} />;
    case 'condition':
      return <ConditionDetail condition={entity.data} />;
  }
}
