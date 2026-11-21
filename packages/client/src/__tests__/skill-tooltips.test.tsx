import { SKILL_IDS, defaultCompendium, getPregenCharacter } from '@srd5/data';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CharacterBuilderWizard } from '../components/builder/index.js';
import { CharacterSheetDrawer } from '../components/roster/index.js';
import { SkillTooltipCard } from '../components/compendium/SkillTooltipCard.js';

afterEach(() => {
  cleanup();
});

describe('SRD-1215: skill benefit tooltips', () => {
  it('every SRD skill resolves a description + governing ability from the compendium', () => {
    expect(SKILL_IDS).toHaveLength(18);
    for (const skillId of SKILL_IDS) {
      const def = defaultCompendium.getSkill(skillId);
      expect(def, `missing compendium entry for ${skillId}`).toBeDefined();
      expect(def!.description.length).toBeGreaterThan(0);
      expect(def!.ability).toMatch(/^(str|dex|con|int|wis|cha)$/);
    }
  });

  it('SkillTooltipCard renders name, ability, description, and game-use benefits', () => {
    render(
      <div className="group relative">
        <SkillTooltipCard
          name="Stealth"
          abilityLabel="Dexterity (DEX)"
          description="Make a Dexterity (Stealth) check when you attempt to conceal yourself."
          badge="Combat Hider"
          uses={['Hide as an action in combat', 'Sneak past patrols']}
          testId="skill-tip-test"
        />
      </div>,
    );
    const tip = screen.getByTestId('skill-tip-test');
    expect(tip.getAttribute('role')).toBe('tooltip');
    expect(tip.textContent).toContain('Stealth');
    expect(tip.textContent).toContain('Dexterity (DEX)');
    expect(tip.textContent).toContain('conceal yourself');
    expect(screen.getByTestId('skill-tip-test-uses').textContent).toContain(
      'Hide as an action in combat',
    );
  });

  it('class skill picker renders hover tooltips with the SRD description + benefits', () => {
    render(<CharacterBuilderWizard />);
    fireEvent.click(screen.getByTestId('builder-step-tab-class'));
    fireEvent.click(screen.getByTestId('builder-class-card-rogue'));

    const stealthDef = defaultCompendium.getSkill('stealth')!;
    const tip = screen.getByTestId(
      'class-choice-l1-tooltip-rogue-skills-stealth',
    );
    // Full SRD description is present (not truncated like the subtitle).
    expect(tip.textContent).toContain(stealthDef.description);
    expect(tip.textContent).toContain('Dexterity');
    // Game-use benefits resolve alongside the description.
    expect(
      screen.getByTestId(
        'class-choice-l1-tooltip-rogue-skills-stealth-uses',
      ).textContent!.length,
    ).toBeGreaterThan(0);

    // The option button advertises the tooltip for assistive tech.
    expect(
      screen
        .getByTestId('class-choice-l1-option-rogue-skills-stealth')
        .getAttribute('aria-describedby'),
    ).toBe('class-choice-l1-tooltip-rogue-skills-stealth');
  });

  it('expertise picker renders hover tooltips explaining the skill benefit', () => {
    render(<CharacterBuilderWizard />);
    fireEvent.click(screen.getByTestId('builder-step-tab-class'));
    fireEvent.click(screen.getByTestId('builder-class-card-rogue'));

    // Unlock Expertise by completing the 4-skill proficiency pick.
    for (const skill of ['stealth', 'perception', 'acrobatics', 'insight']) {
      fireEvent.click(
        screen.getByTestId(`class-choice-l1-option-rogue-skills-${skill}`),
      );
    }
    expect(screen.getByTestId('builder-expertise-l1')).toBeDefined();

    const perceptionDef = defaultCompendium.getSkill('perception')!;
    const tip = screen.getByTestId('builder-expertise-tooltip-l1-perception');
    expect(tip.textContent).toContain(perceptionDef.description);
    expect(tip.textContent).toContain('Wisdom');
    expect(tip.textContent).toContain('Expertise doubles your proficiency');
  });

  it('custom background selects show a live benefit readout for each chosen skill', () => {
    render(<CharacterBuilderWizard />);
    fireEvent.click(screen.getByTestId('builder-step-tab-background'));
    fireEvent.click(screen.getByTestId('builder-bg-mode-custom'));

    for (const idx of [0, 1]) {
      const select = screen.getByTestId(
        `builder-custom-bg-skill-${idx}`,
      ) as HTMLSelectElement;
      const def = defaultCompendium.getSkill(select.value)!;
      const detail = screen.getByTestId(`builder-custom-bg-skill-detail-${idx}`);
      expect(detail.textContent).toContain(def.description);
      expect(detail.textContent).toContain('Used in this game:');
    }

    // Changing a select updates its readout.
    const select0 = screen.getByTestId(
      'builder-custom-bg-skill-0',
    ) as HTMLSelectElement;
    fireEvent.change(select0, { target: { value: 'arcana' } });
    expect(
      screen.getByTestId('builder-custom-bg-skill-detail-0').textContent,
    ).toContain(defaultCompendium.getSkill('arcana')!.description);
  });

  it('character-sheet skill inspector explains what the skill does + where it is used', () => {
    const wizard = getPregenCharacter('pregen-wizard')!;
    render(
      <CharacterSheetDrawer
        character={structuredClone(wizard)}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('sheet-skill-row-arcana'));
    const notes = screen.getByTestId(
      'sheet-formula-inspector-notes',
    ).textContent!;
    expect(notes).toContain(
      defaultCompendium.getSkill('arcana')!.description,
    );
    expect(notes).toContain('Used in this game for:');
    // The pre-existing formula breakdown is preserved.
    expect(
      screen.getByTestId('sheet-formula-inspector-summary').textContent,
    ).toContain('Passive:');
  });
});
