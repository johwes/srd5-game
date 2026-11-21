import React from 'react';
import { getPregenCharacter, type CharacterBuildState } from '@srd5/data';
import type { VeteranRosterEntry } from '@srd5/engine';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VeteranHirePanel } from '../components/campaign/VeteranHirePanel.js';
import { VeteranRetirementOffer } from '../components/campaign/VeteranRetirementOffer.js';
import { CampaignSetupWizard } from '../components/campaign/index.js';

afterEach(() => {
  cleanup();
});

/**
 * SRD-1405: Veteran Roster assembly UI (Spec 13 §7).
 * Acceptance: veterans hireable in campfire assembly at level-scaled gp and
 * deploy as ordinary members; roster caps at 8 with confirm-to-release;
 * persistence survives reloads (see veteran-persistence.test.ts).
 */

function makeHero(id: string, name: string, level: number, gp = 0): CharacterBuildState {
  const base = structuredClone(getPregenCharacter('pregen-fighter')!);
  base.id = id;
  base.name = name;
  base.classes = base.classes.map((c) => ({
    ...c,
    level,
    hpRollsByLevel: Array.from({ length: level }, () => c.hpRollsByLevel[0] ?? 8),
  }));
  base.currency = { cp: 0, sp: 0, ep: 0, gp, pp: 0 };
  return base;
}

function makeVeteran(id: string, name: string, level: number): VeteranRosterEntry {
  return {
    veteranId: id,
    hero: makeHero(id, name, Math.min(level, 10)),
    level,
    retiredAt: '2026-11-21T00:00:00.000Z',
    runId: 'run-9',
    source: 'descent',
  };
}

describe('SRD-1405: Veteran campfire UI', () => {
  describe('VeteranHirePanel', () => {
    it('shows the empty state when no veterans are remembered', () => {
      render(
        <VeteranHirePanel
          veterans={[]}
          seatedParty={[makeHero('a', 'A', 1, 10)]}
          hasEmptySeat
          onHire={vi.fn()}
          onRelease={vi.fn()}
        />,
      );
      expect(screen.getByTestId('veteran-hire-panel')).toBeDefined();
      expect(screen.getByTestId('veteran-hire-empty').textContent).toContain(
        'No retired veterans yet',
      );
      expect(screen.getByTestId('veteran-party-purse').textContent).toContain('10 gp');
    });

    it('displays the level-scaled hire cost and hires into an empty seat', () => {
      const onHire = vi.fn();
      render(
        <VeteranHirePanel
          veterans={[makeVeteran('v1', 'Veteran Val', 4)]}
          seatedParty={[makeHero('a', 'A', 1, 500)]}
          hasEmptySeat
          onHire={onHire}
          onRelease={vi.fn()}
        />,
      );
      // Level 4 × 100 gp.
      expect(screen.getByTestId('veteran-hire-cost-v1').textContent).toContain('400');
      const hireBtn = screen.getByTestId('veteran-hire-v1');
      expect(hireBtn).not.toHaveProperty('disabled', true);
      fireEvent.click(hireBtn);
      expect(onHire).toHaveBeenCalledWith('v1');
    });

    it('disables Hire when the party purse cannot cover the cost', () => {
      render(
        <VeteranHirePanel
          veterans={[makeVeteran('v1', 'Veteran Val', 6)]}
          seatedParty={[makeHero('a', 'A', 1, 40)]}
          hasEmptySeat
          onHire={vi.fn()}
          onRelease={vi.fn()}
        />,
      );
      const hireBtn = screen.getByTestId('veteran-hire-v1');
      expect(hireBtn).toHaveProperty('disabled', true);
      expect(hireBtn.getAttribute('title')).toContain('600 gp');
    });

    it('disables Hire when no campfire seat is free', () => {
      render(
        <VeteranHirePanel
          veterans={[makeVeteran('v1', 'Veteran Val', 3)]}
          seatedParty={[makeHero('a', 'A', 1, 900)]}
          hasEmptySeat={false}
          onHire={vi.fn()}
          onRelease={vi.fn()}
        />,
      );
      const hireBtn = screen.getByTestId('veteran-hire-v1');
      expect(hireBtn).toHaveProperty('disabled', true);
      expect(hireBtn.getAttribute('title')).toContain('No empty campfire seat');
    });

    it('releases a veteran through a two-step confirm', () => {
      const onRelease = vi.fn();
      render(
        <VeteranHirePanel
          veterans={[makeVeteran('v1', 'Veteran Val', 3)]}
          seatedParty={[makeHero('a', 'A', 1, 900)]}
          hasEmptySeat
          onHire={vi.fn()}
          onRelease={onRelease}
        />,
      );
      fireEvent.click(screen.getByTestId('veteran-release-v1'));
      expect(screen.getByTestId('veteran-release-confirm-v1').textContent).toContain(
        'forever?',
      );
      expect(onRelease).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId('veteran-release-confirm-yes-v1'));
      expect(onRelease).toHaveBeenCalledWith('v1');
    });

    it('cancelling release keeps the veteran', () => {
      const onRelease = vi.fn();
      render(
        <VeteranHirePanel
          veterans={[makeVeteran('v1', 'Veteran Val', 3)]}
          seatedParty={[]}
          hasEmptySeat
          onHire={vi.fn()}
          onRelease={onRelease}
        />,
      );
      fireEvent.click(screen.getByTestId('veteran-release-v1'));
      fireEvent.click(screen.getByTestId('veteran-release-cancel-v1'));
      expect(onRelease).not.toHaveBeenCalled();
      expect(screen.queryByTestId('veteran-release-confirm-yes-v1')).toBeNull();
    });
  });

  describe('VeteranRetirementOffer', () => {
    it('renders nothing without candidates', () => {
      const { container } = render(
        <VeteranRetirementOffer candidates={[]} roster={[]} onRetire={vi.fn()} />,
      );
      expect(container.querySelector('[data-testid="veteran-retirement-offer"]')).toBeNull();
    });

    it('offers each living candidate and retires without confirmation when room remains', () => {
      const onRetire = vi.fn();
      render(
        <VeteranRetirementOffer
          candidates={[makeHero('h1', 'Hero One', 5), makeHero('h2', 'Hero Two', 3)]}
          roster={[makeVeteran('old', 'Old Vet', 4)]}
          onRetire={onRetire}
        />,
      );
      expect(screen.getByTestId('veteran-candidate-h1').textContent).toContain('Level 5');
      expect(screen.getByTestId('veteran-candidate-h2').textContent).toContain('Level 3');
      fireEvent.click(screen.getByTestId('veteran-retire-h1'));
      expect(onRetire).toHaveBeenCalledWith('h1', false);
      expect(screen.queryByTestId('veteran-release-confirm-row')).toBeNull();
    });

    it('requires FIFO confirm-to-release when the roster is full', () => {
      const onRetire = vi.fn();
      const full = Array.from({ length: 8 }, (_, i) =>
        makeVeteran(`old-${i}`, `Old Vet ${i}`, 3 + (i % 5)),
      );
      render(
        <VeteranRetirementOffer
          candidates={[makeHero('h9', 'Hero Nine', 6)]}
          roster={full}
          onRetire={onRetire}
        />,
      );
      fireEvent.click(screen.getByTestId('veteran-retire-h9'));
      expect(onRetire).not.toHaveBeenCalled();
      const confirmRow = screen.getByTestId('veteran-release-confirm-row');
      // Oldest-first FIFO: old-0 is released first.
      expect(confirmRow.textContent).toContain('Old Vet 0');
      expect(confirmRow.textContent).toContain('Hero Nine');
      fireEvent.click(screen.getByTestId('veteran-retire-confirm-h9'));
      expect(onRetire).toHaveBeenCalledWith('h9', true);
    });

    it('cancelling the release confirmation retires nothing', () => {
      const onRetire = vi.fn();
      const full = Array.from({ length: 8 }, (_, i) =>
        makeVeteran(`old-${i}`, `Old Vet ${i}`, 4),
      );
      render(
        <VeteranRetirementOffer
          candidates={[makeHero('h9', 'Hero Nine', 6)]}
          roster={full}
          onRetire={onRetire}
        />,
      );
      fireEvent.click(screen.getByTestId('veteran-retire-h9'));
      fireEvent.click(screen.getByTestId('veteran-release-cancel'));
      expect(onRetire).not.toHaveBeenCalled();
      expect(screen.queryByTestId('veteran-release-confirm-row')).toBeNull();
    });
  });

  describe('Campfire assembly hire flow', () => {
    function richParty(): CharacterBuildState[] {
      return [makeHero('rich-a', 'Rich Ana', 1, 500), makeHero('rich-b', 'Rich Bo', 1, 500)];
    }

    it('hires a veteran into the first empty seat, pays party gold, and notifies the host', () => {
      const onHireVeteran = vi.fn();
      render(
        <CampaignSetupWizard
          initialStage={3}
          initialParty={richParty()}
          availableVeterans={[makeVeteran('vet-1', 'Veteran Val', 3)]}
          onHireVeteran={onHireVeteran}
          onLaunch={vi.fn()}
        />,
      );

      // Level 3 veteran costs 300 gp; the seated purse holds 1000 gp.
      expect(screen.getByTestId('veteran-hire-cost-vet-1').textContent).toContain('300');
      fireEvent.click(screen.getByTestId('veteran-hire-vet-1'));

      expect(onHireVeteran).toHaveBeenCalledWith('vet-1');
      // Deployed as an ordinary member in the first empty seat (slot 2).
      expect(screen.getByTestId('wizard-party-slot-2').textContent).toContain('Veteran Val');
      expect(screen.getByTestId('wizard-import-success').textContent).toContain(
        'Hired veteran Veteran Val',
      );
      // 1000 − 300 gp deducted from the party purse.
      expect(screen.getByTestId('veteran-party-purse').textContent).toContain('700 gp');
    });

    it('blocks the hire with an explanatory error when the purse is short', () => {
      const onHireVeteran = vi.fn();
      render(
        <CampaignSetupWizard
          initialStage={3}
          initialParty={[makeHero('poor-a', 'Poor Ana', 1, 25)]}
          availableVeterans={[makeVeteran('vet-1', 'Veteran Val', 5)]}
          onHireVeteran={onHireVeteran}
          onLaunch={vi.fn()}
        />,
      );
      // Hire is disabled (500 gp cost vs 25 gp purse) so it can never fire.
      expect(screen.getByTestId('veteran-hire-vet-1')).toHaveProperty('disabled', true);
      expect(onHireVeteran).not.toHaveBeenCalled();
      expect(screen.getByTestId('wizard-party-slot-1').textContent).toContain(
        '(Empty Hero Slot)',
      );
    });
  });
});
