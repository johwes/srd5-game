import {
  type AbilityId,
  type ChoiceSpec,
  type SrdCompendium,
  defaultCompendium,
} from '@srd5/data';
import {
  DRACONIC_ANCESTRY_TABLE,
  normalizeFeatureOptionId,
} from '@srd5/engine';
import {
  formatAbilityAbbrev,
  formatAbilityFullName,
  formatTitleCase,
} from '../compendium/formatters.js';
import { SkillTooltipCard } from '../compendium/SkillTooltipCard.js';
import {
  getLanguageMechanicalInfo,
  getSkillMechanicalInfo,
  getSpellMechanicalInfo,
} from './relevance.js';

export interface ChoiceSpecSelectorProps {
  choice: ChoiceSpec;
  selected: readonly string[];
  onChange: (nextSelected: string[]) => void;
  compendium?: SrdCompendium;
  disabledOptions?: ReadonlySet<string>;
  testIdPrefix?: string;
}

export function formatChoiceOptionLabel(
  optionId: string,
  choice: ChoiceSpec,
  compendium: SrdCompendium = defaultCompendium,
): { title: string; subtitle?: string } {
  switch (choice.type) {
    case 'ability_score_bonus': {
      const ab = optionId as AbilityId;
      return {
        title: `${formatAbilityFullName(ab)} (${formatAbilityAbbrev(ab)})`,
        subtitle: `+${choice.bonus}`,
      };
    }
    case 'skill': {
      return {
        title: formatTitleCase(optionId),
      };
    }
    case 'language': {
      const lang = compendium.getLanguage(optionId);
      return {
        title: lang?.name ?? formatTitleCase(optionId),
        ...(lang?.category ? { subtitle: formatTitleCase(lang.category) } : {}),
      };
    }
    case 'tool': {
      const tool = compendium.getTool(optionId);
      return {
        title: tool?.name ?? formatTitleCase(optionId),
      };
    }
    case 'proficiency': {
      const prof = compendium.getProficiency(optionId);
      return {
        title: prof?.name ?? formatTitleCase(optionId),
      };
    }
    case 'spell': {
      const spell = compendium.getSpell(optionId);
      return {
        title: spell?.name ?? formatTitleCase(optionId),
        ...(spell
          ? {
              subtitle:
                spell.level === 0
                  ? `${formatTitleCase(spell.school)} cantrip`
                  : `L${spell.level} ${formatTitleCase(spell.school)}`,
            }
          : {}),
      };
    }
    case 'feature_option': {
      if (choice.featureGroup === 'draconic-ancestry') {
        const entry = DRACONIC_ANCESTRY_TABLE[optionId];
        if (entry) {
          const shapeDesc =
            entry.aoeShape === 'line'
              ? `${entry.widthFeet ?? 5}x${entry.sizeFeet} ft line`
              : `${entry.sizeFeet} ft cone`;
          return {
            title: `${entry.dragon} Dragon`,
            subtitle: `${formatTitleCase(entry.damageType)} (${shapeDesc}, ${entry.saveAbility.toUpperCase()} save)`,
          };
        }
      }
      const normalized = normalizeFeatureOptionId(optionId, choice);
      const feature =
        compendium.getFeature(normalized) ?? compendium.getFeature(optionId);
      if (feature) {
        return {
          title: feature.name,
          subtitle:
            feature.description.length > 90
              ? `${feature.description.slice(0, 87)}...`
              : feature.description,
        };
      }
      return {
        title: formatTitleCase(optionId),
      };
    }
    case 'equipment_bundle': {
      const branch = choice.options.find((b) => b.id === optionId);
      return {
        title: branch?.label ?? formatTitleCase(optionId),
      };
    }
  }
}

export function ChoiceSpecSelector({
  choice,
  selected,
  onChange,
  compendium = defaultCompendium,
  disabledOptions,
  testIdPrefix = 'choice',
}: ChoiceSpecSelectorProps) {
  const allowedOptions = compendium.resolveChoiceOptions(choice);
  const normalizedSelected = selected.map((opt) =>
    choice.type === 'feature_option' ? normalizeFeatureOptionId(opt, choice) : opt,
  );
  const selectedSet = new Set(normalizedSelected);
  const isComplete = normalizedSelected.length === choice.count;

  const handleToggleOption = (optionId: string) => {
    const canonical =
      choice.type === 'feature_option'
        ? normalizeFeatureOptionId(optionId, choice)
        : optionId;

    if (selectedSet.has(canonical)) {
      onChange(normalizedSelected.filter((id) => id !== canonical));
      return;
    }

    if (choice.count === 1) {
      onChange([canonical]);
      return;
    }

    if (normalizedSelected.length < choice.count) {
      onChange([...normalizedSelected, canonical]);
    }
  };

  return (
    <div
      data-testid={`${testIdPrefix}-${choice.id}`}
      className="rounded-lg border border-slate-800 bg-slate-900/70 p-3.5 space-y-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-slate-200">{choice.label}</h4>
          <p className="text-xs text-slate-400">
            Select {choice.count} option{choice.count === 1 ? '' : 's'}
          </p>
        </div>
        <span
          data-testid={`${testIdPrefix}-status-${choice.id}`}
          className={`px-2 py-0.5 rounded text-xs font-medium border ${
            isComplete
              ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300'
              : 'bg-amber-950/60 border-amber-700/60 text-amber-300'
          }`}
        >
          {normalizedSelected.length} / {choice.count} Selected
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {allowedOptions.map((optionId) => {
          const canonical =
            choice.type === 'feature_option'
              ? normalizeFeatureOptionId(optionId, choice)
              : optionId;
          const isSelected = selectedSet.has(canonical);
          const isExternallyDisabled = Boolean(
            disabledOptions?.has(canonical) && !isSelected,
          );
          const isMaxReached =
            !isSelected && choice.count > 1 && normalizedSelected.length >= choice.count;
          const isDisabled = isExternallyDisabled || isMaxReached;
          const { title, subtitle } = formatChoiceOptionLabel(
            canonical,
            choice,
            compendium,
          );
          // SRD-1211: mechanical-status badging — every pick shows where it
          // matters (gate / verb / spell path) via the spell-card tooltip pattern.
          // SRD-1215: skill options additionally resolve the SRD description +
          // game-use benefits into a hover tooltip card.
          const skillDef =
            choice.type === 'skill' ? compendium.getSkill(canonical) : undefined;
          const skillTipId = `${testIdPrefix}-tooltip-${choice.id}-${canonical}`;
          const skillMech =
            choice.type === 'skill'
              ? getSkillMechanicalInfo(canonical)
              : null;
          const mechBadge = (() => {
            if (skillMech) {
              return {
                label: skillMech.badge,
                title: `Mechanical path — ${skillMech.uses.join('; ')}`,
                testId: `${testIdPrefix}-mech-${choice.id}-${canonical}`,
                supported: skillMech.status === 'supported',
              };
            }
            if (choice.type === 'language') {
              const info = getLanguageMechanicalInfo(canonical, compendium);
              return {
                label: info.badge,
                title: `Mechanical path — ${info.uses.join('; ')}`,
                testId: `${testIdPrefix}-mech-${choice.id}-${canonical}`,
                supported: info.status === 'supported',
              };
            }
            if (choice.type === 'spell') {
              const info = getSpellMechanicalInfo(canonical, compendium);
              return {
                label: info.badge,
                title: `Mechanical path — ${info.detail}`,
                testId: `${testIdPrefix}-mech-${choice.id}-${canonical}`,
                supported: info.status === 'supported',
              };
            }
            return null;
          })();

          return (
            <div
              key={canonical}
              className={skillDef ? 'relative group' : 'contents'}
            >
            <button
              type="button"
              disabled={isDisabled}
              data-testid={`${testIdPrefix}-option-${choice.id}-${canonical}`}
              aria-pressed={isSelected}
              aria-describedby={skillDef ? skillTipId : undefined}
              onClick={() => handleToggleOption(canonical)}
              className={`text-left px-3 py-2 rounded-md border text-xs transition-colors flex flex-col justify-between gap-0.5 ${skillDef ? 'w-full' : ''} ${
                isSelected
                  ? 'bg-amber-500/15 border-amber-500 text-amber-200 font-medium'
                  : isDisabled
                    ? 'bg-slate-950/50 border-slate-800/60 text-slate-600 cursor-not-allowed'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-900'
              }`}
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className="truncate font-medium">{title}</span>
                {isSelected && (
                  <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300">
                    Picked
                  </span>
                )}
              </div>
              {subtitle && (
                <span className="text-[11px] text-slate-400 line-clamp-2">
                  {subtitle}
                </span>
              )}
              {mechBadge && (
                <span
                  data-testid={mechBadge.testId}
                  title={mechBadge.title}
                  className={`inline-flex w-fit items-center gap-1 text-[10px] px-1.5 py-0.2 rounded border font-medium ${
                    mechBadge.supported
                      ? 'bg-emerald-950/70 border-emerald-700/60 text-emerald-300'
                      : 'bg-amber-950/70 border-amber-600/60 text-amber-300'
                  }`}
                >
                  <span aria-hidden="true">⚙</span>
                  {mechBadge.label}
                </span>
              )}
            </button>
            {skillDef && skillMech && (
              <SkillTooltipCard
                name={title}
                abilityLabel={`${formatAbilityFullName(skillDef.ability)} (${formatAbilityAbbrev(skillDef.ability)})`}
                description={skillDef.description}
                badge={skillMech.badge}
                uses={skillMech.uses}
                testId={skillTipId}
              />
            )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
