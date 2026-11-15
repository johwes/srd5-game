import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.js';
import {
  CharacterBuilderWizard,
  createDefaultBuilderWizardState,
  getNextBuilderStep,
  getPreviousBuilderStep,
  validateAllBuilderSteps,
} from '../components/builder/index.js';

afterEach(() => {
  cleanup();
});

describe('SRD-207: 7-Step Character Builder Wizard UI', () => {
  it('switches between Character Builder and SRD 5.1 Compendium in App shell', () => {
    render(<App initialView="builder" />);

    expect(screen.getByTestId('character-builder-wizard')).toBeDefined();

    fireEvent.click(screen.getByTestId('app-nav-compendium'));
    expect(screen.getByTestId('compendium-tab-races')).toBeDefined();

    fireEvent.click(screen.getByTestId('app-nav-builder'));
    expect(screen.getByTestId('character-builder-wizard')).toBeDefined();
  });

  it('validates Step 1 (Origin): enforces subrace requirement and racial ChoiceSpecs (Dragonborn, High Elf, Half-Elf)', () => {
    render(<CharacterBuilderWizard />);

    // Select Elf -> requires High Elf subrace + cantrip + extra language
    fireEvent.click(screen.getByTestId('builder-race-card-elf'));
    expect(screen.getByTestId('builder-subrace-section')).toBeDefined();
    expect(screen.getByTestId('builder-step-badge-origin').textContent).toBe('Todo');
    expect(
      (screen.getByTestId('builder-next-step-btn') as HTMLButtonElement).disabled,
    ).toBe(true);

    // Pick High Elf subrace
    fireEvent.click(screen.getByTestId('builder-subrace-card-high-elf'));
    expect(screen.getByTestId('builder-racial-choices-section')).toBeDefined();

    // Pick High Elf cantrip (fire-bolt) and extra language (draconic)
    fireEvent.click(
      screen.getByTestId('racial-choice-option-high-elf-cantrip-fire-bolt'),
    );
    fireEvent.click(
      screen.getByTestId('racial-choice-option-high-elf-extra-language-draconic'),
    );

    expect(screen.getByTestId('builder-step-badge-origin').textContent).toBe('Valid');
    expect(
      (screen.getByTestId('builder-next-step-btn') as HTMLButtonElement).disabled,
    ).toBe(false);

    // Select Dragonborn -> requires Draconic Ancestry
    fireEvent.click(screen.getByTestId('builder-race-card-dragonborn'));
    expect(screen.getByTestId('builder-step-badge-origin').textContent).toBe('Todo');
    fireEvent.click(
      screen.getByTestId('racial-choice-option-draconic-ancestry-red'),
    );
    expect(screen.getByTestId('builder-step-badge-origin').textContent).toBe('Valid');
  });

  it('validates Step 2 (Class & Level): enforces L1 subclass (Cleric), skill choices, Rogue Expertise, and L4 ASI/Feat', () => {
    render(<CharacterBuilderWizard />);

    fireEvent.click(screen.getByTestId('builder-step-tab-class'));
    expect(screen.getByTestId('builder-step-class')).toBeDefined();

    // Select Cleric -> requires Divine Domain at Level 1 + 2 Cleric skills
    fireEvent.click(screen.getByTestId('builder-class-card-cleric'));
    expect(screen.getByTestId('builder-subclass-section')).toBeDefined();
    expect(screen.getByTestId('builder-step-badge-class').textContent).toBe('Todo');

    // Select Life Domain subclass and 2 Cleric skills (History, Medicine)
    fireEvent.click(screen.getByTestId('builder-subclass-card-life'));
    fireEvent.click(
      screen.getByTestId('class-choice-l1-option-cleric-skills-history'),
    );
    fireEvent.click(
      screen.getByTestId('class-choice-l1-option-cleric-skills-medicine'),
    );
    expect(screen.getByTestId('builder-step-badge-class').textContent).toBe('Valid');

    // Increase starting level to Level 4 -> unlocks Level 4 ASI / Feat
    fireEvent.change(screen.getByTestId('builder-class-level-select'), {
      target: { value: '4' },
    });
    expect(screen.getByTestId('builder-asi-section')).toBeDefined();
    expect(screen.getByTestId('builder-step-badge-class').textContent).toBe('Todo');

    // Pick +2 WIS ASI at Level 4
    fireEvent.click(screen.getByTestId('builder-asi-plus2-l4-wis'));
    expect(screen.getByTestId('builder-step-badge-class').textContent).toBe('Valid');

    // Select Rogue at Level 1 -> requires 4 skills + 2 Expertise selections
    fireEvent.change(screen.getByTestId('builder-class-level-select'), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByTestId('builder-class-card-rogue'));
    expect(screen.getByTestId('builder-step-badge-class').textContent).toBe('Todo');

    for (const sk of ['acrobatics', 'Deception', 'stealth', 'sleight-of-hand']) {
      const skillSlug = sk.toLowerCase();
      fireEvent.click(
        screen.getByTestId(`class-choice-l1-option-rogue-skills-${skillSlug}`),
      );
    }
    // Still Todo until 2 Expertise options are chosen
    expect(screen.getByTestId('builder-step-badge-class').textContent).toBe('Todo');
    fireEvent.click(
      screen.getByTestId('builder-expertise-option-l1-stealth'),
    );
    fireEvent.click(
      screen.getByTestId('builder-expertise-option-l1-thieves-tools'),
    );
    expect(screen.getByTestId('builder-step-badge-class').textContent).toBe('Valid');
  });

  it('validates Step 3 (Ability Scores): supports Standard Array swap, 27-Point Buy math, and Seeded 4d6kh3 rolls', () => {
    render(<CharacterBuilderWizard />);

    fireEvent.click(screen.getByTestId('builder-step-tab-abilities'));
    expect(screen.getByTestId('builder-step-abilities')).toBeDefined();

    // 1. Standard Array is active and valid by default
    expect(screen.getByTestId('builder-standard-array-banner')).toBeDefined();
    expect(screen.getByTestId('builder-step-badge-abilities').textContent).toBe(
      'Valid',
    );

    // 2. Switch to 27-Point Buy
    fireEvent.click(screen.getByTestId('builder-ability-method-point_buy'));
    expect(screen.getByTestId('builder-point-buy-banner')).toBeDefined();
    expect(screen.getByTestId('builder-point-buy-remaining').textContent).toContain(
      '0 / 27 points remaining',
    );
    expect(screen.getByTestId('builder-step-badge-abilities').textContent).toBe(
      'Valid',
    );

    // Decrement STR from 15 (9pt) to 14 (7pt) -> 2 unspent points -> step becomes Todo
    fireEvent.click(screen.getByTestId('builder-point-buy-dec-str'));
    expect(screen.getByTestId('builder-point-buy-remaining').textContent).toContain(
      '2 / 27 points remaining',
    );
    expect(screen.getByTestId('builder-step-badge-abilities').textContent).toBe(
      'Todo',
    );

    // Increment STR back to 15 -> 0 remaining -> Valid
    fireEvent.click(screen.getByTestId('builder-point-buy-inc-str'));
    expect(screen.getByTestId('builder-step-badge-abilities').textContent).toBe(
      'Valid',
    );

    // 3. Switch to Rolled (4d6kh3) and verify deterministic seed replay
    fireEvent.click(screen.getByTestId('builder-ability-method-rolled'));
    expect(screen.getByTestId('builder-rolled-banner')).toBeDefined();
    const initialPool = screen.getByTestId('builder-rolled-pool-values').textContent;

    fireEvent.click(screen.getByTestId('builder-roll-new-seed-btn'));
    const nextPool = screen.getByTestId('builder-rolled-pool-values').textContent;
    expect(nextPool).not.toBe(initialPool);
    expect(screen.getByTestId('builder-step-badge-abilities').textContent).toBe(
      'Valid',
    );
  });

  it('validates Step 4 (Background & Duplicate Proficiency Rule): prompts replacement on skill/language collision', () => {
    render(<CharacterBuilderWizard />);

    // Default Human has 'dwarvish' as extra language, and Acolyte has 'elvish' & 'draconic'
    fireEvent.click(screen.getByTestId('builder-step-tab-background'));
    expect(screen.getByTestId('builder-step-badge-background').textContent).toBe(
      'Valid',
    );

    // Cause a duplicate language collision by picking 'dwarvish' in Acolyte languages as well
    // First deselect 'draconic', then select 'dwarvish'
    fireEvent.click(
      screen.getByTestId('bg-choice-option-acolyte-languages-draconic'),
    );
    fireEvent.click(
      screen.getByTestId('bg-choice-option-acolyte-languages-dwarvish'),
    );

    // Duplicate Proficiency Replacement section appears and marks Step 4 as Todo until resolved
    expect(
      screen.getByTestId('builder-duplicate-proficiencies-section'),
    ).toBeDefined();
    expect(screen.getByTestId('builder-step-badge-background').textContent).toBe(
      'Todo',
    );

    // Pick 'giant' as replacement language for duplicate 'dwarvish'
    fireEvent.click(
      screen.getByTestId('builder-duplicate-option-language-dwarvish-giant'),
    );
    expect(screen.getByTestId('builder-step-badge-background').textContent).toBe(
      'Valid',
    );

    // Also test Custom SRD Background mode
    fireEvent.click(screen.getByTestId('builder-bg-mode-custom'));
    expect(screen.getByTestId('builder-bg-custom-panel')).toBeDefined();
  });

  it('validates Step 5 (Equipment): supports Equipment Bundles with category sub-choices and Gold Shop mode', () => {
    render(<CharacterBuilderWizard />);

    fireEvent.click(screen.getByTestId('builder-step-tab-equipment'));
    expect(screen.getByTestId('builder-equip-bundles-section')).toBeDefined();
    expect(screen.getByTestId('builder-step-badge-equipment').textContent).toBe(
      'Valid',
    );

    // Switch to Gold Shop mode
    fireEvent.click(screen.getByTestId('builder-equip-mode-gold'));
    expect(screen.getByTestId('builder-equip-gold-section')).toBeDefined();
    // Empty cart is invalid until at least 1 item is purchased
    expect(screen.getByTestId('builder-step-badge-equipment').textContent).toBe(
      'Todo',
    );

    // Buy a Longsword and Shield from the shop
    fireEvent.change(screen.getByTestId('builder-gold-shop-search'), {
      target: { value: 'Longsword' },
    });
    fireEvent.click(screen.getByTestId('builder-shop-buy-longsword'));
    expect(screen.getByTestId('builder-step-badge-equipment').textContent).toBe(
      'Valid',
    );
    expect(screen.getByTestId('builder-inv-badge-longsword')).toBeDefined();
  });

  it('skips Step 6 (Spells) for Non-Casters and validates Wizard Spellbook + Prepared Spells for Casters', () => {
    const defaultWizard = createDefaultBuilderWizardState();
    // Default character is a Level 1 Fighter (non-caster)
    expect(
      getNextBuilderStep('equipment', defaultWizard.buildState),
    ).toBe('review');
    expect(
      getPreviousBuilderStep('review', defaultWizard.buildState),
    ).toBe('equipment');

    render(<CharacterBuilderWizard />);

    // Load the pre-generated High Elf Wizard template
    fireEvent.click(screen.getByTestId('builder-load-template-pregen-wizard'));
    fireEvent.click(screen.getByTestId('builder-step-tab-spells'));

    expect(screen.getByTestId('builder-step-spells')).toBeDefined();
    expect(screen.getByTestId('builder-cantrips-counter').textContent).toBe(
      '3 / 3 Selected',
    );
    expect(screen.getByTestId('builder-spellbook-counter').textContent).toBe(
      '6 / 6 in Spellbook',
    );
    expect(screen.getByTestId('builder-prepared-spells-counter').textContent).toBe(
      '4 / 4 Prepared',
    );
    expect(screen.getByTestId('builder-step-badge-spells').textContent).toBe(
      'Valid',
    );

    // Deselect one prepared spell -> step becomes Todo
    fireEvent.click(
      screen.getByTestId('builder-prepared-spell-option-magic-missile'),
    );
    expect(screen.getByTestId('builder-step-badge-spells').textContent).toBe(
      'Todo',
    );

    // Re-select it -> Valid
    fireEvent.click(
      screen.getByTestId('builder-prepared-spell-option-magic-missile'),
    );
    expect(screen.getByTestId('builder-step-badge-spells').textContent).toBe(
      'Valid',
    );
  });

  it('completes Step 7 (Review & Finalize), enforces Product Identity name guardrails, and saves character to roster', () => {
    const onSave = vi.fn();
    render(<CharacterBuilderWizard onSaveCharacter={onSave} />);

    fireEvent.click(screen.getByTestId('builder-step-tab-review'));
    expect(screen.getByTestId('builder-step-review')).toBeDefined();

    // Verify derived Fighter stats (Chain Mail 16 + Shield 2 + Defense 1 = AC 19, Max HP 12)
    expect(screen.getByTestId('builder-review-ac').textContent).toBe('19');
    expect(screen.getByTestId('builder-review-hp').textContent).toBe('12');
    expect(
      within(screen.getByTestId('builder-review-attack-longsword')).getByText(
        '+5 to hit',
      ),
    ).toBeDefined();

    // Test Product Identity name guardrail (e.g., "Mordenkainen" or "Beholder")
    fireEvent.change(screen.getByTestId('builder-character-name-input'), {
      target: { value: 'Mordenkainen the Beholder' },
    });
    expect(screen.getByTestId('builder-review-errors')).toBeDefined();
    expect(
      (screen.getByTestId('builder-finalize-btn') as HTMLButtonElement).disabled,
    ).toBe(true);

    // Restore valid name and finalize
    fireEvent.change(screen.getByTestId('builder-character-name-input'), {
      target: { value: 'Kaelen Vanguard' },
    });
    expect(
      (screen.getByTestId('builder-finalize-btn') as HTMLButtonElement).disabled,
    ).toBe(false);

    fireEvent.click(screen.getByTestId('builder-finalize-btn'));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('builder-saved-confirmation').textContent).toContain(
      'Kaelen Vanguard',
    );

    // Verify all 7 steps are valid in state validator
    const validations = validateAllBuilderSteps(createDefaultBuilderWizardState());
    expect(validations.review.valid).toBe(true);
  });
});
