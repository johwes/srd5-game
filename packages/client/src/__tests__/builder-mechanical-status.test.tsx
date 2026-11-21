import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SKILL_IDS, defaultCompendium } from '@srd5/data';
import {
  CharacterBuilderWizard,
  RELEVANCE_MATRIX,
  getLanguageMechanicalInfo,
  getPartyCoverageHints,
  getSkillMechanicalInfo,
  getSpellMechanicalInfo,
} from '../components/builder/index.js';
import { CampaignSetupWizard } from '../components/campaign/CampaignSetupWizard.js';

afterEach(() => {
  cleanup();
});

describe('SRD-1211: mechanical-status badging + party-aware hints', () => {
  it('every SRD skill has a supported mechanical path (no silent dead picks)', () => {
    for (const skillId of SKILL_IDS) {
      const info = getSkillMechanicalInfo(skillId);
      expect(info.status).toBe('supported');
      expect(info.uses.length).toBeGreaterThan(0);
      expect(info.badge.length).toBeGreaterThan(0);
    }
    expect(RELEVANCE_MATRIX.map((r) => r.skill).sort()).toEqual([...SKILL_IDS].sort());
  });

  it('every bundled language has a supported gate path', () => {
    for (const lang of defaultCompendium.languages) {
      const info = getLanguageMechanicalInfo(lang.id);
      expect(info.status).toBe('supported');
      expect(info.uses.length).toBeGreaterThan(0);
    }
    // Reference quest table stakes: Orcish opens full negotiation.
    const orc = getLanguageMechanicalInfo('orc');
    expect(orc.badge).toMatch(/Orc tribe/);
    expect(orc.uses.join(' ')).toMatch(/gesture/);
  });

  it('every builder-offered spell id resolves with an executable path', () => {
    const spellIds = defaultCompendium.spells.map((s) => s.id);
    expect(spellIds.length).toBeGreaterThan(0);
    for (const id of spellIds) {
      const info = getSpellMechanicalInfo(id);
      expect(info.status).toBe('supported');
      expect(info.paths.length).toBeGreaterThan(0);
    }
    // Unknown ids are explicitly unsupported with a tracking ticket (SRD-1212 gate).
    const missing = getSpellMechanicalInfo('not-a-real-spell-xyz');
    expect(missing.status).toBe('unsupported');
    expect(missing.trackingTicket).toBe('SRD-1212');
  });

  it('party hints flag missing Orcish and recommend comprehension magic', () => {
    const hints = getPartyCoverageHints([
      { languages: ['common', 'elvish'], skillProficiencies: ['perception'], spellIds: ['fire-bolt'] },
    ]);
    const orcHint = hints.find((h) => h.id === 'missing-orcish');
    expect(orcHint).toBeDefined();
    expect(orcHint!.message).toMatch(/Orcish/);
    expect(orcHint!.remedy).toMatch(/Comprehend Languages/);

    // A party with Orcish + comprehension magic clears the gate hint.
    const covered = getPartyCoverageHints([
      {
        languages: ['common', 'orc'],
        skillProficiencies: ['perception', 'persuasion', 'insight', 'history'],
        spellIds: ['comprehend-languages'],
      },
    ]);
    expect(covered.find((h) => h.id === 'missing-orcish')).toBeUndefined();
  });

  it('ChoiceSpecSelector renders mechanical-status badges for skill picks', () => {
    render(<CharacterBuilderWizard />);
    fireEvent.click(screen.getByTestId('builder-step-tab-class'));
    fireEvent.click(screen.getByTestId('builder-class-card-rogue'));
    // Rogue L1 skill grid uses ChoiceSpecSelector with skill-type options.
    const badge = screen.getByTestId('class-choice-l1-mech-rogue-skills-stealth');
    expect(badge.textContent).toMatch(/Hide/);
    expect(badge.getAttribute('title')).toMatch(/Mechanical path/);
  });

  it('SpellsStep renders executable badges + tooltip details', () => {
    render(<CharacterBuilderWizard />);
    fireEvent.click(screen.getByTestId('builder-load-template-pregen-wizard'));
    fireEvent.click(screen.getByTestId('builder-step-tab-spells'));
    const badge = screen.getByTestId('builder-cantrip-option-mech-fire-bolt');
    expect(badge.textContent?.length).toBeGreaterThan(0);
    const detail = screen.getByTestId('builder-cantrip-option-mech-detail-fire-bolt');
    expect(detail.textContent).toMatch(/Mechanical path/);
  });

  it('ReviewStep shows tabletop coverage panel with party-aware hints', () => {
    render(<CharacterBuilderWizard />);
    fireEvent.click(screen.getByTestId('builder-step-tab-review'));
    expect(screen.getByTestId('builder-tabletop-coverage')).toBeDefined();
    // Default fighter (Human, no Orcish) must surface the Orcish gate hint.
    expect(screen.getByTestId('party-coverage-hint-missing-orcish')).toBeDefined();
    expect(screen.getByTestId('relevance-matrix-row-history')).toBeDefined();
    expect(screen.getByTestId('builder-review-lang-mech-common')).toBeDefined();
  });

  it('CampaignSetupWizard party stage surfaces tabletop hints', () => {
    render(
      <CampaignSetupWizard
        initialStage={3}
        onLaunch={() => {}}
      />,
    );
    expect(screen.getByTestId('wizard-tabletop-hints')).toBeDefined();
    expect(screen.getByTestId('party-coverage-hints')).toBeDefined();
  });
});
