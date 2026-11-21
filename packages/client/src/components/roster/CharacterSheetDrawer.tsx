import { useEffect, useState } from 'react';
import {
  ABILITY_IDS,
  type AbilityId,
  type CharacterBuildState,
  SKILL_IDS,
  type SkillId,
  type SrdCompendium,
  defaultCompendium,
} from '@srd5/data';
import {
  type DerivedCharacterSheet,
  type EquippedSlots,
  MAX_CHARACTER_LEVEL,
  type ModifierContribution,
  awardCharacterXp,
  computeDerivedCharacter,
  getXpProgress,
} from '@srd5/engine';
import {
  formatAbilityAbbrev,
  formatAbilityFullName,
  formatSignedNumber,
  formatTitleCase,
} from '../compendium/formatters.js';
import { getSkillMechanicalInfo } from '../builder/relevance.js';

export type CharacterSheetTabId = 'overview' | 'equipment' | 'spells';

export interface FormulaInspectorItem {
  id: string;
  label: string;
  totalDisplay: string;
  formulaSummary: string;
  contributions: ModifierContribution[];
  extraNotes?: string[];
}

export interface CharacterSheetDrawerProps {
  character: CharacterBuildState;
  compendium?: SrdCompendium;
  onClose: () => void;
  onUpdateCharacter?: (updated: CharacterBuildState) => void;
  onOpenLevelUp?: (character: CharacterBuildState) => void;
  onExportCharacter?: (character: CharacterBuildState) => void;
}

function formatBreakdownInline(contributions: readonly ModifierContribution[]): string {
  if (contributions.length === 0) {
    return '0';
  }
  return contributions
    .map((c, idx) => {
      if (idx === 0) {
        return `${c.sourceName} (${c.value >= 0 ? c.value : formatSignedNumber(c.value)})`;
      }
      return `${c.value >= 0 ? '+' : '-'} ${c.sourceName} (${Math.abs(c.value)})`;
    })
    .join(' ');
}

function buildDefaultFormulaInspector(derived: DerivedCharacterSheet): FormulaInspectorItem {
  return {
    id: 'ac',
    label: 'Armor Class (AC)',
    totalDisplay: String(derived.armorClass.totalAc),
    formulaSummary: derived.armorClass.formulaTooltip,
    contributions: [
      {
        sourceId: derived.armorClass.selectedFormulaId,
        sourceName: `${derived.armorClass.selectedFormulaName} (Base)`,
        value: derived.armorClass.baseAc,
      },
      ...(derived.armorClass.shieldBonus > 0
        ? [
            {
              sourceId: 'shield',
              sourceName: 'Equipped Shield',
              value: derived.armorClass.shieldBonus,
            },
          ]
        : []),
      ...derived.armorClass.additiveBonuses,
    ],
    extraNotes: derived.armorClass.candidateFormulas.map(
      (cand) =>
        `${cand.name}: ${cand.formula} = ${cand.baseAc}${
          cand.id === derived.armorClass.selectedFormulaId
            ? ' [Selected Highest]'
            : cand.valid
              ? ' [Lower Candidate]'
              : ` [Inactive: ${cand.invalidReason ?? 'Not met'}]`
        }`,
    ),
  };
}

export function CharacterSheetDrawer({
  character,
  compendium = defaultCompendium,
  onClose,
  onUpdateCharacter,
  onOpenLevelUp,
  onExportCharacter,
}: CharacterSheetDrawerProps) {
  const [activeTab, setActiveTab] = useState<CharacterSheetTabId>('overview');
  const [xpAwardInput, setXpAwardInput] = useState<string>('300');

  const derived = computeDerivedCharacter(character, compendium);
  const xpProgress = getXpProgress(character);

  const [inspectedFormula, setInspectedFormula] = useState<FormulaInspectorItem>(() =>
    buildDefaultFormulaInspector(derived),
  );

  // Keep default AC formula inspector synced if character changes and AC is currently inspected
  useEffect(() => {
    if (inspectedFormula.id === 'ac') {
      setInspectedFormula(buildDefaultFormulaInspector(derived));
    }
  }, [character]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleInspectAbility = (ab: AbilityId) => {
    const stat = derived.abilities[ab];
    setInspectedFormula({
      id: `ability-${ab}`,
      label: `${formatAbilityFullName(ab)} (${formatAbilityAbbrev(ab)}) Score & Modifier`,
      totalDisplay: `${stat.score} (${formatSignedNumber(stat.modifier)})`,
      formulaSummary: `${formatBreakdownInline(stat.breakdown)} = ${stat.score} (Modifier: floor((${stat.score} - 10) / 2) = ${formatSignedNumber(stat.modifier)})`,
      contributions: stat.breakdown,
      extraNotes: [
        `Score Cap: ${stat.maxCap}${stat.itemMinimum ? ` | Item Minimum Override: ${stat.itemMinimum}` : ''}`,
      ],
    });
  };

  const handleInspectSave = (ab: AbilityId) => {
    const save = derived.savingThrows[ab];
    setInspectedFormula({
      id: `save-${ab}`,
      label: `${formatAbilityFullName(ab)} Saving Throw`,
      totalDisplay: formatSignedNumber(save.totalBonus),
      formulaSummary: `1d20 + ${formatBreakdownInline(save.breakdown)} = ${formatSignedNumber(save.totalBonus)}`,
      contributions: save.breakdown,
      extraNotes: [
        `Proficiency: ${save.proficient ? 'Proficient' : 'Not Proficient'} | Roll Mode: ${formatTitleCase(save.rollMode)}`,
      ],
    });
  };

  const handleInspectSkill = (skillId: SkillId) => {
    const sk = derived.skills[skillId];
    // SRD-1215: the inspector doubles as the sheet's skill-benefit surface
    // (hover tooltips would clip inside the scrollable skill column): SRD
    // description + game-use relevance alongside the formula breakdown.
    const skillDef = compendium.getSkill(skillId);
    const skillMech = getSkillMechanicalInfo(skillId);
    setInspectedFormula({
      id: `skill-${skillId}`,
      label: `${formatTitleCase(skillId)} (${formatAbilityAbbrev(sk.ability)}) Check`,
      totalDisplay: formatSignedNumber(sk.totalBonus),
      formulaSummary: `1d20 + ${formatBreakdownInline(sk.breakdown)} = ${formatSignedNumber(sk.totalBonus)} (Passive: ${sk.passiveScore})`,
      contributions: sk.breakdown,
      extraNotes: [
        ...(skillDef ? [`What it does: ${skillDef.description}`] : []),
        ...(skillMech.status === 'supported' && skillMech.uses.length > 0
          ? [`Used in this game for: ${skillMech.uses.join('; ')}`]
          : []),
        `Tier: ${formatTitleCase(sk.proficiencyLevel)} | Passive Score: ${sk.passiveScore} | Roll Mode: ${formatTitleCase(sk.rollMode)}`,
      ],
    });
  };

  const handleInspectHp = () => {
    setInspectedFormula({
      id: 'hp',
      label: 'Maximum Hit Points (HP)',
      totalDisplay: `${derived.currentHp} / ${derived.maxHp} HP`,
      formulaSummary: `${formatBreakdownInline(derived.hpBreakdown)} = ${derived.maxHp} Max HP`,
      contributions: derived.hpBreakdown,
      extraNotes: derived.hitDicePools.map(
        (pool) => `Hit Dice Pool: ${pool.available}/${pool.total} d${pool.dieSize} available`,
      ),
    });
  };

  const handleInspectInitiative = () => {
    setInspectedFormula({
      id: 'initiative',
      label: 'Initiative Bonus',
      totalDisplay: formatSignedNumber(derived.initiative.bonus),
      formulaSummary: `1d20 + ${formatBreakdownInline(derived.initiative.breakdown)} = ${formatSignedNumber(derived.initiative.bonus)}`,
      contributions: derived.initiative.breakdown,
      extraNotes: [`Roll Mode: ${formatTitleCase(derived.initiative.rollMode)}`],
    });
  };

  const handleInspectAttack = (atkId: string) => {
    const atk = derived.weaponAttacks.find((a) => a.id === atkId);
    if (!atk) return;
    setInspectedFormula({
      id: `attack-${atk.id}`,
      label: `${atk.name} (${formatTitleCase(atk.slot)}) Attack & Damage`,
      totalDisplay: `${formatSignedNumber(atk.toHitBonus)} to hit | ${atk.damageFormula} ${atk.damageType}`,
      formulaSummary: `Attack Roll: 1d20 + ${formatBreakdownInline(atk.toHitBreakdown)} = ${formatSignedNumber(atk.toHitBonus)} to hit | Damage: ${atk.damageDice} + ${formatBreakdownInline(atk.damageBreakdown)} = ${atk.damageFormula} ${atk.damageType}`,
      contributions: atk.toHitBreakdown,
      extraNotes: [
        `Damage Breakdown: ${atk.damageDice} base dice + ${formatBreakdownInline(atk.damageBreakdown)} = ${atk.damageFormula}`,
        ...(atk.versatileDamageFormula
          ? [`Versatile (Two-Handed): ${atk.versatileDamageFormula} ${atk.damageType}`]
          : []),
      ],
    });
  };

  const handleAwardXp = () => {
    if (!onUpdateCharacter) return;
    const parsedXp = Number(xpAwardInput);
    if (!Number.isFinite(parsedXp) || parsedXp <= 0) return;
    const res = awardCharacterXp(character, parsedXp);
    onUpdateCharacter(res.state);
  };

  const handleEquipSlotChange = (
    slotKey: keyof EquippedSlots,
    instanceId: string,
  ) => {
    if (!onUpdateCharacter) return;
    const nextSlots: EquippedSlots = { ...character.equippedSlots };

    if (!instanceId) {
      delete nextSlots[slotKey];
    } else {
      nextSlots[slotKey] = instanceId;

      // Enforce SRD 5.1 two-handed vs shield/off-hand constraint
      if (slotKey === 'mainHandInstanceId') {
        const inst = character.inventory.find((i) => i.instanceId === instanceId);
        const eq = inst ? compendium.getEquipment(inst.itemId) : undefined;
        if (eq?.kind === 'weapon' && eq.properties.includes('two-handed')) {
          delete nextSlots.shieldInstanceId;
          delete nextSlots.offHandInstanceId;
        }
      } else if (slotKey === 'shieldInstanceId') {
        delete nextSlots.offHandInstanceId;
        const mainInst = character.inventory.find(
          (i) => i.instanceId === nextSlots.mainHandInstanceId,
        );
        const mainEq = mainInst ? compendium.getEquipment(mainInst.itemId) : undefined;
        if (mainEq?.kind === 'weapon' && mainEq.properties.includes('two-handed')) {
          delete nextSlots.mainHandInstanceId;
        }
      } else if (slotKey === 'offHandInstanceId') {
        delete nextSlots.shieldInstanceId;
        const mainInst = character.inventory.find(
          (i) => i.instanceId === nextSlots.mainHandInstanceId,
        );
        const mainEq = mainInst ? compendium.getEquipment(mainInst.itemId) : undefined;
        if (mainEq?.kind === 'weapon' && mainEq.properties.includes('two-handed')) {
          delete nextSlots.mainHandInstanceId;
        }
      }
    }

    onUpdateCharacter({
      ...character,
      equippedSlots: nextSlots,
    });
  };

  const handleToggleAttunement = (instanceId: string) => {
    if (!onUpdateCharacter) return;
    const current = character.attunedItemInstanceIds;
    const isAttuned = current.includes(instanceId);
    let nextAttuned: string[];
    if (isAttuned) {
      nextAttuned = current.filter((id) => id !== instanceId);
    } else {
      if (current.length >= 3) {
        return; // Max 3 attuned items per SRD 5.1
      }
      nextAttuned = [...current, instanceId];
    }
    onUpdateCharacter({
      ...character,
      attunedItemInstanceIds: nextAttuned,
    });
  };

  const handleTogglePreparedSpell = (spellId: string, maxPrepared: number) => {
    if (!onUpdateCharacter) return;
    const currentPrep = character.spellcasting.preparedSpellIds;
    const isPrepared = currentPrep.includes(spellId);
    let nextPrep: string[];
    if (isPrepared) {
      nextPrep = currentPrep.filter((id) => id !== spellId);
    } else {
      if (currentPrep.length >= maxPrepared) {
        return;
      }
      nextPrep = [...currentPrep, spellId];
    }
    onUpdateCharacter({
      ...character,
      spellcasting: {
        ...character.spellcasting,
        preparedSpellIds: nextPrep,
      },
    });
  };

  // Inventory categorization for Paperdoll selectors
  const armorItems = character.inventory.filter((inst) => {
    const eq = compendium.getEquipment(inst.itemId);
    return eq?.kind === 'armor' && eq.category !== 'shield';
  });
  const shieldItems = character.inventory.filter((inst) => {
    const eq = compendium.getEquipment(inst.itemId);
    return eq?.kind === 'armor' && eq.category === 'shield';
  });
  const meleeWeaponItems = character.inventory.filter((inst) => {
    const eq = compendium.getEquipment(inst.itemId);
    return eq?.kind === 'weapon' && eq.rangeType === 'melee';
  });
  const offHandLightWeaponItems = character.inventory.filter((inst) => {
    const eq = compendium.getEquipment(inst.itemId);
    return (
      eq?.kind === 'weapon' &&
      eq.rangeType === 'melee' &&
      eq.properties.includes('light') &&
      inst.instanceId !== character.equippedSlots.mainHandInstanceId
    );
  });
  const rangedWeaponItems = character.inventory.filter((inst) => {
    const eq = compendium.getEquipment(inst.itemId);
    return (
      eq?.kind === 'weapon' &&
      (eq.rangeType === 'ranged' || eq.properties.includes('thrown'))
    );
  });

  // Attunable magic items in inventory
  const attunableInventoryItems = character.inventory.filter((inst) => {
    const mi = compendium.getMagicItem(inst.itemId);
    return Boolean(mi?.requiresAttunement);
  });

  return (
    <div
      data-testid="character-sheet-drawer-backdrop"
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex justify-end"
    >
      <aside
        data-testid="character-sheet-drawer"
        aria-label={`Character Sheet: ${derived.name}`}
        className="w-full max-w-4xl bg-slate-950 border-l border-slate-800 h-full flex flex-col overflow-hidden shadow-2xl"
      >
        {/* Top Drawer Header */}
        <header className="p-4 sm:p-5 border-b border-slate-800 bg-slate-900/90 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  data-testid="sheet-character-name"
                  className="text-xl font-bold text-amber-400"
                >
                  {derived.name}
                </h2>
                <span
                  data-testid="sheet-character-level-badge"
                  className="px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-bold"
                >
                  Level {derived.totalLevel}
                </span>
                <span className="text-xs text-slate-300">
                  {derived.subraceName ?? derived.raceName} &middot;{' '}
                  {derived.classes
                    .map(
                      (c) =>
                        `${c.className}${c.subclassName ? ` (${c.subclassName})` : ''} ${c.level}`,
                    )
                    .join(' / ')}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {derived.backgroundName} &middot; {formatTitleCase(derived.alignment)} &middot;{' '}
                Size: {formatTitleCase(derived.size)}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {onOpenLevelUp && derived.totalLevel < MAX_CHARACTER_LEVEL && (
                <button
                  type="button"
                  data-testid="sheet-open-level-up-btn"
                  onClick={() => onOpenLevelUp(character)}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold hover:bg-amber-400 transition-colors"
                >
                  &uarr; Level Up (L{derived.totalLevel} &rarr; L{derived.totalLevel + 1})
                </button>
              )}
              {onExportCharacter && (
                <button
                  type="button"
                  data-testid="sheet-export-btn"
                  onClick={() => onExportCharacter(character)}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-200 text-xs font-semibold hover:bg-slate-700"
                >
                  Export .srd5.json
                </button>
              )}
              <button
                type="button"
                data-testid="sheet-close-btn"
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-slate-300 text-xs font-semibold hover:text-white"
              >
                Close (Esc)
              </button>
            </div>
          </div>

          {/* XP Progression & Quick Award Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-slate-800/80 text-xs">
            <div className="flex items-center gap-3">
              <span data-testid="sheet-xp-summary" className="font-mono text-slate-300">
                XP: <strong className="text-amber-300">{xpProgress.currentXp}</strong>
                {xpProgress.nextLevelThresholdXp !== null
                  ? ` / ${xpProgress.nextLevelThresholdXp} (Next Level in ${xpProgress.xpToNextLevel} XP)`
                  : ' (Max Level 20)'}
              </span>
              {xpProgress.canLevelUp && (
                <span
                  data-testid="sheet-xp-ready-badge"
                  className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-700 text-emerald-300 text-[11px] font-semibold"
                >
                  Ready to Level Up!
                </span>
              )}
            </div>

            {onUpdateCharacter && derived.totalLevel < MAX_CHARACTER_LEVEL && (
              <div className="flex items-center gap-1.5">
                <label htmlFor="sheet-award-xp-input" className="text-slate-400">
                  Award XP:
                </label>
                <input
                  id="sheet-award-xp-input"
                  data-testid="sheet-award-xp-input"
                  type="number"
                  min={1}
                  step={50}
                  value={xpAwardInput}
                  onChange={(e) => setXpAwardInput(e.target.value)}
                  className="w-20 rounded bg-slate-950 border border-slate-700 px-2 py-1 text-xs font-mono text-slate-100"
                />
                <button
                  type="button"
                  data-testid="sheet-award-xp-btn"
                  onClick={handleAwardXp}
                  className="px-2.5 py-1 rounded bg-emerald-600/20 border border-emerald-600/60 text-emerald-300 font-semibold hover:bg-emerald-600/30"
                >
                  + Add XP
                </button>
              </div>
            )}
          </div>

          {/* Interactive Formula Breakdown Inspector */}
          <div
            data-testid="sheet-formula-inspector"
            className="rounded-lg bg-slate-950 border border-amber-500/30 p-3 text-xs space-y-1"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-amber-300">
                Formula Inspector: {inspectedFormula.label}
              </span>
              <span
                data-testid="sheet-formula-inspector-total"
                className="font-mono font-bold text-slate-100 px-2 py-0.5 rounded bg-slate-900 border border-slate-800"
              >
                {inspectedFormula.totalDisplay}
              </span>
            </div>
            <div
              data-testid="sheet-formula-inspector-summary"
              className="font-mono text-[11px] text-slate-300"
            >
              {inspectedFormula.formulaSummary}
            </div>
            {inspectedFormula.extraNotes && inspectedFormula.extraNotes.length > 0 && (
              <div
                data-testid="sheet-formula-inspector-notes"
                className="text-[11px] text-slate-400 space-y-0.5 pt-1 border-t border-slate-900"
              >
                {inspectedFormula.extraNotes.map((note, idx) => (
                  <div key={idx}>{note}</div>
                ))}
              </div>
            )}
          </div>

          {/* Drawer Sub-Navigation Tabs */}
          <div className="flex gap-2 pt-1">
            {(
              [
                { id: 'overview', label: 'Overview, Abilities & Skills' },
                {
                  id: 'equipment',
                  label: `Equipment & Loadout (${character.inventory.length})`,
                },
                {
                  id: 'spells',
                  label: derived.spellcasting.isSpellcaster
                    ? `Spellbook & Preparation (${derived.spellcasting.preparedOrKnownSpellIds.length})`
                    : 'Spellcasting (None)',
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                data-testid={`sheet-tab-${tab.id}`}
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  activeTab === tab.id
                    ? 'bg-amber-500 text-slate-950'
                    : 'bg-slate-950 border border-slate-800 text-slate-300 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </header>

        {/* Scrollable Sheet Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {activeTab === 'overview' && (
            <div data-testid="sheet-panel-overview" className="space-y-6">
              {/* Top Combat Vitals Row (Click or Hover to Inspect Formula) */}
              <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <button
                  type="button"
                  data-testid="sheet-vital-ac"
                  title={derived.armorClass.formulaTooltip}
                  onClick={() =>
                    setInspectedFormula(buildDefaultFormulaInspector(derived))
                  }
                  className="rounded-xl border border-slate-800 bg-slate-900/80 p-3 text-center hover:border-amber-500/60 transition-colors"
                >
                  <div className="text-[11px] uppercase tracking-wider text-slate-400">
                    Armor Class
                  </div>
                  <div
                    data-testid="sheet-ac-value"
                    className="text-2xl font-bold font-mono text-amber-300 mt-0.5"
                  >
                    {derived.armorClass.totalAc}
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">
                    {derived.armorClass.selectedFormulaName}
                  </div>
                </button>

                <button
                  type="button"
                  data-testid="sheet-vital-hp"
                  title={derived.hpBreakdown
                    .map((b) => `${b.sourceName}: ${formatSignedNumber(b.value)}`)
                    .join(', ')}
                  onClick={handleInspectHp}
                  className="rounded-xl border border-slate-800 bg-slate-900/80 p-3 text-center hover:border-emerald-500/60 transition-colors"
                >
                  <div className="text-[11px] uppercase tracking-wider text-slate-400">
                    Hit Points
                  </div>
                  <div
                    data-testid="sheet-hp-value"
                    className="text-2xl font-bold font-mono text-emerald-300 mt-0.5"
                  >
                    {derived.currentHp}/{derived.maxHp}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Hit Dice:{' '}
                    {derived.hitDicePools
                      .map((p) => `${p.available}/${p.total}d${p.dieSize}`)
                      .join(' ')}
                  </div>
                </button>

                <button
                  type="button"
                  data-testid="sheet-vital-initiative"
                  title={derived.initiative.breakdown
                    .map((b) => `${b.sourceName}: ${formatSignedNumber(b.value)}`)
                    .join(', ')}
                  onClick={handleInspectInitiative}
                  className="rounded-xl border border-slate-800 bg-slate-900/80 p-3 text-center hover:border-amber-500/60 transition-colors"
                >
                  <div className="text-[11px] uppercase tracking-wider text-slate-400">
                    Initiative
                  </div>
                  <div
                    data-testid="sheet-initiative-value"
                    className="text-2xl font-bold font-mono text-slate-100 mt-0.5"
                  >
                    {formatSignedNumber(derived.initiative.bonus)}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {formatTitleCase(derived.initiative.rollMode)}
                  </div>
                </button>

                <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3 text-center">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400">
                    Speed &amp; Vision
                  </div>
                  <div
                    data-testid="sheet-speed-value"
                    className="text-2xl font-bold font-mono text-slate-100 mt-0.5"
                  >
                    {derived.speedFeet} ft
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {derived.senses.darkvisionFeet > 0
                      ? `Darkvision ${derived.senses.darkvisionFeet} ft`
                      : 'Normal Vision'}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3 text-center">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400">
                    Proficiency
                  </div>
                  <div
                    data-testid="sheet-prof-value"
                    className="text-2xl font-bold font-mono text-amber-300 mt-0.5"
                  >
                    {formatSignedNumber(derived.proficiencyBonus)}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Attacks/Action: {derived.attacksPerAction}
                  </div>
                </div>

                <button
                  type="button"
                  data-testid="sheet-vital-passive-perception"
                  onClick={() => handleInspectSkill('perception')}
                  className="rounded-xl border border-slate-800 bg-slate-900/80 p-3 text-center hover:border-amber-500/60 transition-colors"
                >
                  <div className="text-[11px] uppercase tracking-wider text-slate-400">
                    Passive Perc.
                  </div>
                  <div
                    data-testid="sheet-passive-perception-value"
                    className="text-2xl font-bold font-mono text-slate-100 mt-0.5"
                  >
                    {derived.passivePerception}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Inv {derived.passiveInvestigation} &middot; Ins{' '}
                    {derived.passiveInsight}
                  </div>
                </button>
              </section>

              {/* Main 3-Column Sheet Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Column 1: 6 Ability Scores & Saving Throws */}
                <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-amber-300">
                    Ability Scores &amp; Saving Throws
                  </h3>
                  <div className="space-y-2">
                    {ABILITY_IDS.map((ab) => {
                      const abStat = derived.abilities[ab];
                      const saveStat = derived.savingThrows[ab];
                      return (
                        <div
                          key={ab}
                          data-testid={`sheet-ability-row-${ab}`}
                          title={abStat.breakdown
                            .map(
                              (b) => `${b.sourceName}: ${formatSignedNumber(b.value)}`,
                            )
                            .join(', ')}
                          className="rounded-lg bg-slate-950 border border-slate-800 p-2.5 flex items-center justify-between text-xs gap-2"
                        >
                          <button
                            type="button"
                            data-testid={`sheet-inspect-ability-${ab}`}
                            onClick={() => handleInspectAbility(ab)}
                            className="text-left hover:text-amber-300 transition-colors"
                          >
                            <div className="font-bold text-amber-300">
                              {formatAbilityAbbrev(ab)}{' '}
                              <span className="font-normal text-slate-300">
                                {formatAbilityFullName(ab)}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono">
                              Score {abStat.score} ({formatSignedNumber(abStat.modifier)})
                            </div>
                          </button>

                          <button
                            type="button"
                            data-testid={`sheet-inspect-save-${ab}`}
                            title={saveStat.breakdown
                              .map(
                                (b) => `${b.sourceName}: ${formatSignedNumber(b.value)}`,
                              )
                              .join(', ')}
                            onClick={() => handleInspectSave(ab)}
                            className={`px-2.5 py-1 rounded border font-mono text-xs transition-colors ${
                              saveStat.proficient
                                ? 'bg-emerald-950/70 border-emerald-700/70 text-emerald-300 hover:border-emerald-500'
                                : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600'
                            }`}
                          >
                            Save {formatSignedNumber(saveStat.totalBonus)}
                            {saveStat.proficient ? ' ●' : ''}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Competing AC Candidate Formulas Breakdown */}
                  <div className="rounded-lg bg-slate-950 border border-slate-800 p-3 space-y-1.5 text-xs">
                    <div className="font-semibold text-slate-200">
                      Competing AC Formulas Evaluated
                    </div>
                    <div className="space-y-1">
                      {derived.armorClass.candidateFormulas.map((cand) => {
                        const isWinner =
                          cand.id === derived.armorClass.selectedFormulaId;
                        return (
                          <div
                            key={cand.id}
                            data-testid={`sheet-ac-candidate-${cand.id}`}
                            className={`flex items-center justify-between px-2 py-1 rounded text-[11px] font-mono ${
                              isWinner
                                ? 'bg-amber-500/15 border border-amber-500/40 text-amber-200'
                                : cand.valid
                                  ? 'bg-slate-900 text-slate-300'
                                  : 'bg-slate-950 text-slate-500'
                            }`}
                          >
                            <span className="truncate">{cand.name}</span>
                            <span>
                              {cand.valid ? `Base ${cand.baseAc}` : 'Inactive'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </section>

                {/* Column 2: All 18 Skills */}
                <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-amber-300">
                    Skills ({derived.proficiencies.skills.length} Proficient)
                  </h3>
                  <div className="space-y-1.5 max-h-[460px] overflow-y-auto pr-1">
                    {SKILL_IDS.map((skillId) => {
                      const sk = derived.skills[skillId];
                      const badge =
                        sk.proficiencyLevel === 'expertise'
                          ? '★ Exp'
                          : sk.proficiencyLevel === 'proficient'
                            ? '● Prof'
                            : sk.proficiencyLevel === 'half'
                              ? '◐ Half'
                              : '';
                      return (
                        <button
                          key={skillId}
                          type="button"
                          data-testid={`sheet-skill-row-${skillId}`}
                          title={sk.breakdown
                            .map(
                              (b) => `${b.sourceName}: ${formatSignedNumber(b.value)}`,
                            )
                            .join(', ')}
                          onClick={() => handleInspectSkill(skillId)}
                          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800/80 hover:border-amber-500/50 text-xs transition-colors"
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="text-slate-200 truncate">
                              {formatTitleCase(skillId)}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              ({formatAbilityAbbrev(sk.ability)})
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {badge && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-300">
                                {badge}
                              </span>
                            )}
                            <span className="font-mono font-semibold text-slate-100">
                              {formatSignedNumber(sk.totalBonus)}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* Column 3: Features, Traits, Resources & Proficiencies */}
                <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
                  {/* Resource Pools */}
                  {Object.keys(derived.resources).length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-emerald-300">
                        Class &amp; Racial Resource Pools
                      </h3>
                      <div className="space-y-1.5">
                        {Object.values(derived.resources).map((pool) => (
                          <div
                            key={pool.resourceId}
                            data-testid={`sheet-resource-${pool.resourceId}`}
                            className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 flex items-center justify-between text-xs"
                          >
                            <div>
                              <div className="font-semibold text-slate-100">
                                {pool.name}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                Recharges on {formatTitleCase(pool.recovery)} Rest
                              </div>
                            </div>
                            <span className="font-mono font-bold text-emerald-300">
                              {pool.available} / {pool.max}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Features & Feats */}
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-amber-300">
                      Features, Traits &amp; Feats
                    </h3>
                    <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1 text-xs">
                      {derived.featureIds.map((fId) => {
                        const feat = compendium.getFeature(fId);
                        return (
                          <div
                            key={fId}
                            data-testid={`sheet-feature-${fId}`}
                            className="rounded bg-slate-950 border border-slate-800 px-2.5 py-1.5"
                          >
                            <div className="font-semibold text-slate-200">
                              {feat?.name ?? formatTitleCase(fId)}
                            </div>
                            {feat?.description && (
                              <div className="text-[11px] text-slate-400 line-clamp-2 mt-0.5">
                                {feat.description}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {derived.featIds.map((featId) => {
                        const featData = compendium.getFeat(featId);
                        return (
                          <div
                            key={featId}
                            data-testid={`sheet-feat-${featId}`}
                            className="rounded bg-amber-950/30 border border-amber-700/50 px-2.5 py-1.5"
                          >
                            <div className="font-semibold text-amber-300">
                              Feat: {featData?.name ?? formatTitleCase(featId)}
                            </div>
                            {featData?.description && (
                              <div className="text-[11px] text-slate-300 line-clamp-2 mt-0.5">
                                {featData.description}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Proficiencies & Resistances */}
                  <div className="space-y-1.5 pt-2 border-t border-slate-800 text-xs">
                    <div className="font-semibold text-slate-200">
                      Proficiencies &amp; Defenses
                    </div>
                    {derived.damageResistances.length > 0 && (
                      <div className="text-slate-400">
                        Resistances:{' '}
                        <span className="text-amber-300 font-medium">
                          {derived.damageResistances.map(formatTitleCase).join(', ')}
                        </span>
                      </div>
                    )}
                    <div className="text-slate-400">
                      Armor:{' '}
                      <span className="text-slate-200">
                        {derived.proficiencies.armor.map(formatTitleCase).join(', ') ||
                          'None'}
                      </span>
                    </div>
                    <div className="text-slate-400">
                      Weapons:{' '}
                      <span className="text-slate-200">
                        {derived.proficiencies.weapons.map(formatTitleCase).join(', ') ||
                          'None'}
                      </span>
                    </div>
                    <div className="text-slate-400">
                      Tools:{' '}
                      <span className="text-slate-200">
                        {derived.proficiencies.tools.map(formatTitleCase).join(', ') ||
                          'None'}
                      </span>
                    </div>
                    <div className="text-slate-400">
                      Languages:{' '}
                      <span className="text-slate-200">
                        {derived.proficiencies.languages
                          .map(formatTitleCase)
                          .join(', ') || 'None'}
                      </span>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          )}

          {activeTab === 'equipment' && (
            <div data-testid="sheet-panel-equipment" className="space-y-6">
              {/* Interactive Loadout Paperdoll & Weapon Attacks */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-amber-300">
                      Equipped Loadout Paperdoll
                    </h3>
                    <span className="text-xs font-mono text-slate-400">
                      Current AC: <strong className="text-amber-300">{derived.armorClass.totalAc}</strong>
                    </span>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div>
                      <label
                        htmlFor="sheet-equip-armor-select"
                        className="block text-slate-300 font-medium mb-1"
                      >
                        Body Armor Slot
                      </label>
                      <select
                        id="sheet-equip-armor-select"
                        data-testid="sheet-equip-armor-select"
                        value={character.equippedSlots.armorInstanceId ?? ''}
                        onChange={(e) =>
                          handleEquipSlotChange('armorInstanceId', e.target.value)
                        }
                        className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-slate-100"
                      >
                        <option value="">Unarmored (None)</option>
                        {armorItems.map((inst) => {
                          const eq = compendium.getEquipment(inst.itemId);
                          return (
                            <option key={inst.instanceId} value={inst.instanceId}>
                              {eq?.name ?? inst.itemId}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="sheet-equip-shield-select"
                        className="block text-slate-300 font-medium mb-1"
                      >
                        Shield Slot (+2 AC)
                      </label>
                      <select
                        id="sheet-equip-shield-select"
                        data-testid="sheet-equip-shield-select"
                        value={character.equippedSlots.shieldInstanceId ?? ''}
                        onChange={(e) =>
                          handleEquipSlotChange('shieldInstanceId', e.target.value)
                        }
                        className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-slate-100"
                      >
                        <option value="">No Shield</option>
                        {shieldItems.map((inst) => {
                          const eq = compendium.getEquipment(inst.itemId);
                          return (
                            <option key={inst.instanceId} value={inst.instanceId}>
                              {eq?.name ?? inst.itemId}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="sheet-equip-mainhand-select"
                        className="block text-slate-300 font-medium mb-1"
                      >
                        Main-Hand Melee Weapon
                      </label>
                      <select
                        id="sheet-equip-mainhand-select"
                        data-testid="sheet-equip-mainhand-select"
                        value={character.equippedSlots.mainHandInstanceId ?? ''}
                        onChange={(e) =>
                          handleEquipSlotChange('mainHandInstanceId', e.target.value)
                        }
                        className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-slate-100"
                      >
                        <option value="">Unarmed Strike Only</option>
                        {meleeWeaponItems.map((inst) => {
                          const eq = compendium.getEquipment(inst.itemId);
                          return (
                            <option key={inst.instanceId} value={inst.instanceId}>
                              {eq?.name ?? inst.itemId}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="sheet-equip-offhand-select"
                        className="block text-slate-300 font-medium mb-1"
                      >
                        Off-Hand Light Weapon (Two-Weapon Fighting)
                      </label>
                      <select
                        id="sheet-equip-offhand-select"
                        data-testid="sheet-equip-offhand-select"
                        value={character.equippedSlots.offHandInstanceId ?? ''}
                        onChange={(e) =>
                          handleEquipSlotChange('offHandInstanceId', e.target.value)
                        }
                        className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-slate-100"
                      >
                        <option value="">Empty Off-Hand</option>
                        {offHandLightWeaponItems.map((inst) => {
                          const eq = compendium.getEquipment(inst.itemId);
                          return (
                            <option key={inst.instanceId} value={inst.instanceId}>
                              {eq?.name ?? inst.itemId}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="sheet-equip-ranged-select"
                        className="block text-slate-300 font-medium mb-1"
                      >
                        Ranged Weapon Slot
                      </label>
                      <select
                        id="sheet-equip-ranged-select"
                        data-testid="sheet-equip-ranged-select"
                        value={character.equippedSlots.rangedInstanceId ?? ''}
                        onChange={(e) =>
                          handleEquipSlotChange('rangedInstanceId', e.target.value)
                        }
                        className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-slate-100"
                      >
                        <option value="">No Ranged Weapon</option>
                        {rangedWeaponItems.map((inst) => {
                          const eq = compendium.getEquipment(inst.itemId);
                          return (
                            <option key={inst.instanceId} value={inst.instanceId}>
                              {eq?.name ?? inst.itemId}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  </div>

                  {/* Magic Item Attunement Slots (Max 3) */}
                  <div className="pt-3 border-t border-slate-800 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-purple-300">
                        Magic Item Attunement
                      </span>
                      <span
                        data-testid="sheet-attunement-count"
                        className="font-mono text-slate-400"
                      >
                        {character.attunedItemInstanceIds.length} / 3 Attuned
                      </span>
                    </div>
                    {attunableInventoryItems.length === 0 ? (
                      <p className="text-slate-500">
                        No magic items requiring attunement in inventory.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {attunableInventoryItems.map((inst) => {
                          const mi = compendium.getMagicItem(inst.itemId);
                          const isAttuned = character.attunedItemInstanceIds.includes(
                            inst.instanceId,
                          );
                          return (
                            <button
                              key={inst.instanceId}
                              type="button"
                              data-testid={`sheet-attune-toggle-${inst.instanceId}`}
                              onClick={() => handleToggleAttunement(inst.instanceId)}
                              className={`w-full flex items-center justify-between px-3 py-1.5 rounded border text-xs ${
                                isAttuned
                                  ? 'bg-purple-950/50 border-purple-500 text-purple-200'
                                  : 'bg-slate-950 border-slate-800 text-slate-300'
                              }`}
                            >
                              <span>{mi?.name ?? inst.itemId}</span>
                              <span className="font-mono">
                                {isAttuned ? '★ Attuned' : 'Attune'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </section>

                {/* Weapon Attack Profiles & Inventory List */}
                <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-amber-300">
                      Weapon Attack Profiles (Click for Breakdown)
                    </h3>
                    {derived.weaponAttacks.map((atk) => (
                      <button
                        key={atk.id}
                        type="button"
                        data-testid={`sheet-attack-profile-${atk.weaponId}`}
                        onClick={() => handleInspectAttack(atk.id)}
                        className="w-full text-left rounded-lg bg-slate-950 border border-slate-800 hover:border-amber-500/60 p-3 space-y-1 text-xs transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-100">
                            {atk.name}{' '}
                            <span className="text-[10px] text-slate-400">
                              ({formatTitleCase(atk.slot)})
                            </span>
                          </span>
                          <span className="font-mono text-amber-300 font-bold">
                            {formatSignedNumber(atk.toHitBonus)} to hit
                          </span>
                        </div>
                        <div className="text-slate-300 font-mono text-[11px]">
                          Damage: {atk.damageFormula} {atk.damageType}
                          {atk.versatileDamageFormula
                            ? ` (Versatile ${atk.versatileDamageFormula})`
                            : ''}
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Currency & Inventory */}
                  <div className="pt-3 border-t border-slate-800 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-200">
                        Inventory &amp; Currency
                      </span>
                      <span
                        data-testid="sheet-currency-summary"
                        className="font-mono text-amber-300"
                      >
                        {character.currency.pp > 0 ? `${character.currency.pp} pp ` : ''}
                        {character.currency.gp} gp {character.currency.sp} sp{' '}
                        {character.currency.cp} cp
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-56 overflow-y-auto pr-1">
                      {character.inventory.map((inst) => {
                        const eq = compendium.getEquipment(inst.itemId);
                        return (
                          <div
                            key={inst.instanceId}
                            data-testid={`sheet-inventory-item-${inst.itemId}`}
                            className="flex items-center justify-between px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800"
                          >
                            <span className="text-slate-200 truncate">
                              {eq?.name ?? formatTitleCase(inst.itemId)}
                            </span>
                            <span className="font-mono text-slate-400">
                              &times;{inst.quantity}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </section>
              </div>
            </div>
          )}

          {activeTab === 'spells' && (
            <div data-testid="sheet-panel-spells" className="space-y-6">
              {!derived.spellcasting.isSpellcaster ? (
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-center text-sm text-slate-400">
                  This character does not currently have Spellcasting unlocked.
                </div>
              ) : (
                <>
                  {/* Spellcasting Stats & Slot Tracker */}
                  <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-purple-300">
                          Spellcasting Summary
                        </h3>
                        <p className="text-xs text-slate-400">
                          Effective Caster Level: {derived.spellcasting.effectiveCasterLevel}
                        </p>
                      </div>
                      <div className="flex items-center gap-4 text-xs font-mono">
                        <span>
                          Spell Save DC:{' '}
                          <strong
                            data-testid="sheet-spell-save-dc"
                            className="text-amber-300"
                          >
                            {derived.spellcasting.primarySpellSaveDc}
                          </strong>
                        </span>
                        <span>
                          Spell Attack:{' '}
                          <strong
                            data-testid="sheet-spell-attack-bonus"
                            className="text-amber-300"
                          >
                            {formatSignedNumber(
                              derived.spellcasting.primarySpellAttackBonus ?? 0,
                            )}
                          </strong>
                        </span>
                      </div>
                    </div>

                    {/* Spell Slots Row */}
                    <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2 text-xs">
                      {([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((lvl) => {
                        const pool = derived.spellcasting.spellSlots[lvl];
                        return (
                          <div
                            key={lvl}
                            data-testid={`sheet-spell-slot-l${lvl}`}
                            className={`rounded-lg border p-2 text-center font-mono ${
                              pool.max > 0
                                ? 'bg-slate-950 border-purple-800/60 text-purple-200'
                                : 'bg-slate-950/40 border-slate-800/50 text-slate-600'
                            }`}
                          >
                            <div className="text-[10px] uppercase">Lvl {lvl}</div>
                            <div className="font-bold text-sm mt-0.5">
                              {pool.available}/{pool.max}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {derived.spellcasting.pactMagic && (
                      <div
                        data-testid="sheet-pact-magic-banner"
                        className="rounded-lg bg-purple-950/30 border border-purple-700/50 px-3 py-2 text-xs text-purple-200 flex items-center justify-between font-mono"
                      >
                        <span>
                          Warlock Pact Magic (Slot Level{' '}
                          {derived.spellcasting.pactMagic.slotLevel})
                        </span>
                        <strong>
                          {derived.spellcasting.pactMagic.availableSlots} /{' '}
                          {derived.spellcasting.pactMagic.maxSlots} Slots
                        </strong>
                      </div>
                    )}
                  </section>

                  {/* Cantrips & Always-Prepared Spells */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3 text-xs">
                      <h4 className="text-sm font-semibold text-amber-300">
                        Known Cantrips ({derived.spellcasting.cantripIds.length})
                      </h4>
                      <div className="flex flex-wrap gap-1.5">
                        {derived.spellcasting.cantripIds.map((cId) => {
                          const sp = compendium.getSpell(cId);
                          return (
                            <span
                              key={cId}
                              data-testid={`sheet-cantrip-${cId}`}
                              className="px-2.5 py-1 rounded-md bg-slate-950 border border-slate-800 text-slate-200"
                            >
                              {sp?.name ?? cId}
                            </span>
                          );
                        })}
                      </div>

                      {derived.spellcasting.alwaysPreparedSpellIds.length > 0 && (
                        <div className="pt-3 border-t border-slate-800 space-y-2">
                          <h4 className="text-sm font-semibold text-emerald-300">
                            Always Prepared Domain / Oath / Circle Spells
                          </h4>
                          <div className="flex flex-wrap gap-1.5">
                            {derived.spellcasting.alwaysPreparedSpellIds.map((sId) => {
                              const sp = compendium.getSpell(sId);
                              return (
                                <span
                                  key={sId}
                                  data-testid={`sheet-always-prepared-${sId}`}
                                  className="px-2.5 py-1 rounded-md bg-emerald-950/50 border border-emerald-700/60 text-emerald-200"
                                >
                                  {sp?.name ?? sId}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </section>

                    {/* Interactive Spell Preparation Manager */}
                    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3 text-xs">
                      {derived.spellcasting.classes.map((clsSpell) => {
                        const maxPrep = clsSpell.maxPreparedSpells ?? 0;
                        const canPrepare =
                          clsSpell.preparationMode === 'spellbook' ||
                          clsSpell.preparationMode === 'prepared_full_list';

                        if (!canPrepare) {
                          return (
                            <div key={clsSpell.classId} className="space-y-2">
                              <h4 className="text-sm font-semibold text-purple-300">
                                Known Spells ({character.spellcasting.knownSpellIds.length})
                              </h4>
                              <div className="flex flex-wrap gap-1.5">
                                {character.spellcasting.knownSpellIds.map((sId) => {
                                  const sp = compendium.getSpell(sId);
                                  return (
                                    <span
                                      key={sId}
                                      data-testid={`sheet-known-spell-${sId}`}
                                      className="px-2.5 py-1 rounded-md bg-slate-950 border border-slate-800 text-slate-200"
                                    >
                                      {sp?.name ?? sId} (L{sp?.level ?? 1})
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        }

                        // Determine candidate pool for preparation
                        const alwaysPrepSet = new Set(clsSpell.alwaysPreparedSpellIds);
                        const candidateIds =
                          clsSpell.preparationMode === 'spellbook'
                            ? character.spellcasting.spellbookSpellIds
                            : compendium
                                .getSpellsForClass(clsSpell.classId)
                                .filter(
                                  (s) =>
                                    s.level >= 1 &&
                                    derived.spellcasting.spellSlots[
                                      s.level as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
                                    ]?.max > 0 &&
                                    !alwaysPrepSet.has(s.id),
                                )
                                .map((s) => s.id);

                        return (
                          <div key={clsSpell.classId} className="space-y-2">
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-semibold text-purple-300">
                                {clsSpell.preparationMode === 'spellbook'
                                  ? 'Wizard Spellbook Preparation'
                                  : 'Prepared Spells Manager'}
                              </h4>
                              <span
                                data-testid="sheet-prepared-counter"
                                className="font-mono text-amber-300"
                              >
                                {character.spellcasting.preparedSpellIds.length} / {maxPrep}{' '}
                                Prepared
                              </span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-60 overflow-y-auto pr-1">
                              {candidateIds.map((sId) => {
                                const sp = compendium.getSpell(sId);
                                const isPrep =
                                  character.spellcasting.preparedSpellIds.includes(sId);
                                return (
                                  <button
                                    key={sId}
                                    type="button"
                                    data-testid={`sheet-prep-spell-toggle-${sId}`}
                                    onClick={() => handleTogglePreparedSpell(sId, maxPrep)}
                                    className={`flex items-center justify-between px-2.5 py-1.5 rounded border text-left transition-colors ${
                                      isPrep
                                        ? 'bg-purple-950/60 border-purple-500 text-purple-200'
                                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                                    }`}
                                  >
                                    <span className="truncate">
                                      {sp?.name ?? sId} (L{sp?.level ?? 1})
                                    </span>
                                    <span className="font-mono text-[10px]">
                                      {isPrep ? '● Prep' : '○'}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </section>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
