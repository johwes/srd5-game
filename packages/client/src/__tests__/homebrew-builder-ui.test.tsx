import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultCompendium, type CharacterBuildState } from '@srd5/data';
import { CompendiumBrowser } from '../components/compendium/CompendiumBrowser.js';
import { BackgroundStep } from '../components/builder/BackgroundStep.js';
import { ClassStep } from '../components/builder/ClassStep.js';
import { createDefaultBuilderWizardState } from '../components/builder/index.js';

afterEach(() => {
  cleanup();
});

describe('SRD-1006: Homebrew Builder UI & Compendium Provenance Filtering', () => {
  describe('CompendiumBrowser source provenance filter', () => {
    it('filters entries by source (SRD 5.1 Only vs Homebrew Only)', () => {
      render(<CompendiumBrowser compendium={defaultCompendium} />);

      // Switch to Monsters tab
      fireEvent.click(screen.getByTestId('compendium-tab-monsters'));

      // Source filter dropdown exists
      const sourceSelect = screen.getByTestId('compendium-filter-source') as HTMLSelectElement;
      expect(sourceSelect).toBeDefined();

      // All sources: both goblin and goblin-boss exist in compendium
      const allGoblinBoss = defaultCompendium.getMonster('goblin-boss');
      expect(allGoblinBoss?.source).toBe('homebrew');

      // Filter to SRD 5.1 Only
      fireEvent.change(sourceSelect, { target: { value: 'srd-5.1' } });
      expect(screen.queryByText('Goblin Boss')).toBeNull();

      // Filter to Homebrew Only
      fireEvent.change(sourceSelect, { target: { value: 'homebrew' } });
      expect(screen.getAllByText('Goblin Boss').length).toBeGreaterThan(0);
    });
  });

  describe('BackgroundStep custom background authoring and PI screening', () => {
    it('allows authoring custom background narrative and displays live PI warnings', () => {
      let state = createDefaultBuilderWizardState().buildState;
      const onChange = (updater: any) => {
        state = typeof updater === 'function' ? updater(state) : updater;
        rerender(<BackgroundStep buildState={state} onChange={onChange} compendium={defaultCompendium} />);
      };

      const { rerender } = render(
        <BackgroundStep buildState={state} onChange={onChange} compendium={defaultCompendium} />,
      );

      // Switch to Custom Background mode
      fireEvent.click(screen.getByTestId('builder-bg-mode-custom'));
      expect(screen.getByTestId('builder-bg-custom-panel')).toBeDefined();

      // Name, description, feature inputs exist
      const nameInput = screen.getByTestId('builder-custom-bg-name') as HTMLInputElement;
      const descInput = screen.getByTestId('builder-custom-bg-desc') as HTMLTextAreaElement;
      const featureNameInput = screen.getByTestId('builder-custom-bg-feature-name') as HTMLInputElement;
      const featureDescInput = screen.getByTestId('builder-custom-bg-feature-desc') as HTMLInputElement;

      fireEvent.change(nameInput, { target: { value: 'Crypt Delver' } });
      fireEvent.change(descInput, { target: { value: 'Explorer of ancient subterranean tombs.' } });
      fireEvent.change(featureNameInput, { target: { value: 'Tomb Sense' } });
      fireEvent.change(featureDescInput, { target: { value: 'Recall stonework layout patterns.' } });

      expect(state.customBackground?.name).toBe('Crypt Delver');
      expect(state.customBackground?.description).toBe('Explorer of ancient subterranean tombs.');
      expect(state.customBackground?.feature?.name).toBe('Tomb Sense');

      // No PI warning for clean homebrew
      expect(screen.queryByTestId('builder-bg-pi-warning')).toBeNull();

      // Type a Product Identity prohibited term (e.g. Waterdeep)
      fireEvent.change(nameInput, { target: { value: 'Waterdeep Cutpurse' } });
      expect(screen.getByTestId('builder-bg-pi-warning')).toBeDefined();
      expect(screen.getByTestId('builder-bg-pi-warning').textContent).toContain('waterdeep');

      // Check human review confirmation checkbox
      const reviewCheckbox = screen.getByTestId('builder-bg-human-review') as HTMLInputElement;
      fireEvent.click(reviewCheckbox);
      expect(state.customBackground?.humanReviewed).toBe(true);
    });
  });

  describe('ClassStep custom feat authoring and live equipment', () => {
    it('allows authoring custom homebrew feat at ASI level and equips it', () => {
      let state: CharacterBuildState = {
        ...createDefaultBuilderWizardState().buildState,
        classes: [
          {
            classId: 'fighter',
            level: 4,
            hpRollsByLevel: [10, 6, 6, 6],
            choiceSelectionsByLevel: {},
            asiOrFeatByLevel: {},
          },
        ],
      };

      const onChange = (updater: any) => {
        state = typeof updater === 'function' ? updater(state) : updater;
        rerender(<ClassStep buildState={state} onChange={onChange} compendium={defaultCompendium} />);
      };

      const { rerender } = render(
        <ClassStep buildState={state} onChange={onChange} compendium={defaultCompendium} />,
      );

      // Level 4 ASI section is displayed
      expect(screen.getByTestId('builder-asi-card-l4')).toBeDefined();

      // Switch L4 ASI mode to Feat
      fireEvent.click(screen.getByTestId('builder-asi-mode-feat-l4'));

      // Custom feat authoring toggle button exists
      const authorToggleBtn = screen.getByTestId('builder-feat-author-custom-toggle-l4');
      expect(authorToggleBtn).toBeDefined();

      // Click to open custom feat authoring form
      fireEvent.click(authorToggleBtn);
      expect(screen.getByTestId('builder-custom-feat-form-l4')).toBeDefined();

      const featNameInput = screen.getByTestId('builder-custom-feat-name');
      const featDescInput = screen.getByTestId('builder-custom-feat-desc');
      const modTypeSelect = screen.getByTestId('builder-custom-feat-mod-type');

      // Test Product Identity warning on prohibited term (e.g. Beholder)
      fireEvent.change(featNameInput, { target: { value: 'Beholder Slayer' } });
      expect(screen.getByTestId('builder-custom-feat-pi-warning')).toBeDefined();
      expect(screen.getByTestId('builder-custom-feat-pi-warning').textContent).toContain('beholder');

      // Change to clean name
      fireEvent.change(featNameInput, { target: { value: 'Ironclad Sentinel' } });
      fireEvent.change(featDescInput, { target: { value: 'Defensive shield training.' } });
      fireEvent.change(modTypeSelect, { target: { value: 'ac' } });
      expect(screen.queryByTestId('builder-custom-feat-pi-warning')).toBeNull();

      // Check human review confirmation
      fireEvent.click(screen.getByTestId('builder-custom-feat-human-review'));

      // Save and equip feat
      fireEvent.click(screen.getByTestId('builder-custom-feat-save-btn'));

      // Form closes and the custom feat is equipped on Fighter level 4 ASI
      expect(screen.queryByTestId('builder-custom-feat-form-l4')).toBeNull();
      const selection = state.classes[0]?.asiOrFeatByLevel[4];
      expect(selection?.type).toBe('feat');
      if (selection?.type === 'feat') {
        expect(selection.featId).toBe('ironclad-sentinel');
      }
      expect(state.customFeats?.some((f) => f.id === 'ironclad-sentinel')).toBe(true);
    });
  });
});
