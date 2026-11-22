import { defaultCompendium, getPregenCharacter } from '@srd5/data';
import { computeDerivedCharacter } from '@srd5/engine';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CharacterView } from '../components/inventory/CharacterView.js';
import { formatTitleCase } from '../components/compendium/formatters.js';

afterEach(() => {
  cleanup();
});

const compendium = defaultCompendium;

function twoHeroes() {
  const fighter = getPregenCharacter('pregen-fighter')!;
  const wizard = getPregenCharacter('pregen-wizard')!;
  return [fighter, wizard];
}

function baseViewProps(heroes = twoHeroes()) {
  return {
    heroes,
    activeHeroId: heroes[0]!.id,
    compendium,
    onSelectHero: vi.fn(),
    onClose: vi.fn(),
    onEquipItem: vi.fn(),
    onAttuneItem: vi.fn(),
    onUnattuneItem: vi.fn(),
    onTransferItem: vi.fn(),
  };
}

describe('SRD-1505: Stats rail completion (Build / Skills / Attributes)', () => {
  it('Build tab shows class breakdown, defenses, and notable features from sheet data', () => {
    const heroes = twoHeroes();
    const derived = computeDerivedCharacter(heroes[0]!, compendium);
    render(<CharacterView {...baseViewProps(heroes)} />);
    fireEvent.click(screen.getByTestId('character-view-rail-tab-build'));
    expect(screen.getByTestId('character-view-rail-panel-build')).toBeDefined();

    // Class/subclass/level breakdown: one row per derived class.
    expect(screen.getByTestId('character-view-rail-classes')).toBeDefined();
    for (const c of derived.classes) {
      const row = screen.getByTestId(`character-view-rail-class-${c.classId}`);
      expect(row.textContent).toContain(c.className);
      expect(row.textContent).toContain(`L${c.level}`);
    }

    // Defenses render from the derived mitigation lists.
    expect(screen.getByTestId('character-view-rail-resistances').textContent).toContain(
      derived.damageResistances.length > 0 ? 'Resistances:' : 'None',
    );
    expect(screen.getByTestId('character-view-rail-immunities')).toBeDefined();
    expect(screen.getByTestId('character-view-rail-vulnerabilities')).toBeDefined();

    // Notable features list every derived feature id by compendium name.
    expect(screen.getByTestId('character-view-rail-features')).toBeDefined();
    for (const fId of derived.featureIds.slice(0, 3)) {
      const expected = compendium.getFeature(fId)?.name ?? formatTitleCase(fId);
      expect(screen.getByTestId(`character-view-rail-feature-${fId}`).textContent).toContain(
        expected.slice(0, 12),
      );
    }
  });

  it('Build tab lists active conditions and the empty state when healthy', () => {
    const heroes = twoHeroes();
    render(<CharacterView {...baseViewProps(heroes)} />);
    fireEvent.click(screen.getByTestId('character-view-rail-tab-build'));
    // Healthy hero: explicit "None" row (no hover-only information).
    expect(screen.getByTestId('character-view-rail-conditions-none').textContent).toContain('None');

    // Poisoned hero: condition row appears with the title-cased condition id.
    cleanup();
    const poisoned = {
      ...heroes[0]!,
      runtime: {
        ...heroes[0]!.runtime,
        activeConditions: [{ conditionId: 'poisoned' as const, sourceName: 'Giant Spider' }],
      },
    };
    render(<CharacterView {...baseViewProps([poisoned, heroes[1]!])} />);
    fireEvent.click(screen.getByTestId('character-view-rail-tab-build'));
    const row = screen.getByTestId('character-view-rail-condition-poisoned');
    expect(row.textContent).toContain('Poisoned');
    expect(row.textContent).toContain('Giant Spider');
    expect(screen.queryByTestId('character-view-rail-conditions-none')).toBeNull();
  });

  it('Skills tab groups by ability with scores and proficiency stars', () => {
    const heroes = twoHeroes();
    const derived = computeDerivedCharacter(heroes[0]!, compendium);
    render(<CharacterView {...baseViewProps(heroes)} />);
    fireEvent.click(screen.getByTestId('character-view-rail-tab-skills'));
    expect(screen.getByTestId('character-view-rail-panel-skills')).toBeDefined();

    // Passive header mirrors the derived passive scores.
    expect(screen.getByTestId('character-view-rail-passives').textContent).toContain(
      String(derived.passivePerception),
    );

    // Every skill still renders under its ability group with the derived bonus.
    const stealthAbility = derived.skills.stealth.ability;
    const group = screen.getByTestId(`character-view-rail-skill-group-${stealthAbility}`);
    expect(group.textContent).toContain(String(derived.abilities[stealthAbility].score));
    expect(
      screen.getByTestId('character-view-rail-skill-stealth').textContent,
    ).toContain('Stealth');
    expect(
      screen.getByTestId('character-view-rail-skill-perception').textContent,
    ).toContain('Perception');

    // Proficiency stars: at least one proficient skill on the iconic fighter
    // carries a badge, matching the sheet-drawer badge language.
    const proficientSkill = (Object.keys(derived.skills) as Array<keyof typeof derived.skills>).find(
      (id) => derived.skills[id].proficiencyLevel === 'proficient' || derived.skills[id].proficiencyLevel === 'expertise',
    );
    expect(proficientSkill).toBeDefined();
    const badge = screen.getByTestId(`character-view-rail-skill-badge-${proficientSkill!}`);
    expect(['● Prof', '★ Exp']).toContainEqual(badge.textContent);
  });

  it('Attributes tab shows vitals, creature line, carrying capacity, and proficiencies', () => {
    const heroes = twoHeroes();
    const derived = computeDerivedCharacter(heroes[0]!, compendium);
    render(<CharacterView {...baseViewProps(heroes)} />);
    fireEvent.click(screen.getByTestId('character-view-rail-tab-attributes'));
    expect(screen.getByTestId('character-view-rail-panel-attributes')).toBeDefined();

    // Combat vitals mirror the derived sheet.
    expect(screen.getByTestId('character-view-rail-attr-hp').textContent).toContain(
      `${derived.currentHp}/${derived.maxHp}`,
    );
    expect(screen.getByTestId('character-view-rail-attr-ac').textContent).toContain(
      String(derived.armorClass.totalAc),
    );
    expect(screen.getByTestId('character-view-rail-attr-speed').textContent).toContain(
      `${derived.speedFeet} ft`,
    );

    // Creature line + carrying capacity (STR × 15, display only).
    expect(screen.getByTestId('character-view-rail-attr-creature').textContent).toContain('Humanoid');
    const expectedCapacity = `${(derived.abilities.str?.score ?? 10) * 15} lb`;
    expect(screen.getByTestId('character-view-rail-attr-carry').textContent).toContain(expectedCapacity);

    // Full proficiency lists (armor / weapons / tools / saves / languages).
    expect(screen.getByTestId('character-view-rail-attr-prof-armor')).toBeDefined();
    expect(screen.getByTestId('character-view-rail-attr-prof-weapons')).toBeDefined();
    expect(screen.getByTestId('character-view-rail-attr-prof-tools')).toBeDefined();
    expect(screen.getByTestId('character-view-rail-attr-prof-saves')).toBeDefined();
    expect(screen.getByTestId('character-view-rail-attr-languages')).toBeDefined();

    // All six abilities still render with scores.
    for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
      expect(screen.getByTestId(`character-view-rail-ability-${ab}`).textContent).toContain(
        String(derived.abilities[ab].score),
      );
    }
  });

  it('rail tabs are presentation-only: switching tabs dispatches no engine commands', () => {
    const props = baseViewProps();
    render(<CharacterView {...props} />);
    for (const tab of ['skills', 'attributes', 'build'] as const) {
      fireEvent.click(screen.getByTestId(`character-view-rail-tab-${tab}`));
    }
    expect(props.onEquipItem).not.toHaveBeenCalled();
    expect(props.onAttuneItem).not.toHaveBeenCalled();
    expect(props.onUnattuneItem).not.toHaveBeenCalled();
    expect(props.onTransferItem).not.toHaveBeenCalled();
  });
});
