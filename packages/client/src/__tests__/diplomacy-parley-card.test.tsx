import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DiplomacyParleyCard } from '../components/realm/DiplomacyParleyCard.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ROWS = [
  { approach: 'persuasion' as const, bonus: 7, dc: 14 },
  { approach: 'deception' as const, bonus: 5, dc: 14 },
  { approach: 'intimidation' as const, bonus: 3, dc: 14 },
];

const BASE = {
  encounterKind: 'envoy' as const,
  counterparty: 'the Gilded League',
  historyBonus: 4,
  historyDc: 13,
  insightPassive: 16,
  speakerDeceptionTotal: 14,
  rows: ROWS,
};

describe('SRD-1209: DiplomacyParleyCard', () => {
  it('renders history, insight cue, and all three approaches with odds', () => {
    render(<DiplomacyParleyCard {...BASE} onResolve={() => {}} />);
    expect(screen.getByTestId('diplomacy-parley-card')).toBeDefined();
    expect(screen.getByTestId('diplomacy-history-row').textContent).toContain('DC 13');
    // Passive 16 beats deception 14 → the "feels off" cue renders.
    expect(screen.getByTestId('diplomacy-cue').textContent).toContain('something feels off');
    for (const approach of ['persuasion', 'deception', 'intimidation']) {
      const btn = screen.getByTestId(`diplomacy-approach-${approach}`);
      expect(btn.textContent).toContain('vs DC 14');
    }
  });

  it('badges unlocked History leverage vs no leverage', () => {
    const { rerender } = render(
      <DiplomacyParleyCard {...BASE} historyUnlocked onResolve={() => {}} />,
    );
    expect(screen.getByTestId('diplomacy-history-badge').getAttribute('data-unlocked')).toBe('true');

    rerender(<DiplomacyParleyCard {...BASE} historyUnlocked={false} onResolve={() => {}} />);
    expect(screen.getByTestId('diplomacy-history-badge').getAttribute('data-unlocked')).toBe('false');
  });

  it('hides the cue when the passive does not beat the lie', () => {
    render(
      <DiplomacyParleyCard {...BASE} insightPassive={9} speakerDeceptionTotal={14} onResolve={() => {}} />,
    );
    expect(screen.queryByTestId('diplomacy-cue')).toBeNull();
  });

  it('commits the selected approach', () => {
    const onResolve = vi.fn();
    render(<DiplomacyParleyCard {...BASE} onResolve={onResolve} />);
    fireEvent.click(screen.getByTestId('diplomacy-approach-intimidation'));
    fireEvent.click(screen.getByTestId('diplomacy-commit'));
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith('intimidation');
  });

  it('renders degraded results as progress, not a block', () => {
    render(
      <DiplomacyParleyCard
        {...BASE}
        onResolve={() => {}}
        lastResult={{
          outcome: 'degraded',
          success: false,
          headline: 'A 3-day cooling holds instead. The deal degrades, it never dies.',
        }}
      />,
    );
    const result = screen.getByTestId('diplomacy-result');
    expect(result.getAttribute('data-result')).toBe('degraded');
    expect(result.textContent).toContain('never dies');
  });
});
