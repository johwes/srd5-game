import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TheftActionPanel } from '../components/combat/TheftActionPanel.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const TARGETS = [
  { id: 'mark-1', name: 'Suspicious Peddler', adjacent: true, passivePerception: 11 },
  { id: 'mark-2', name: 'Distant Guard', adjacent: false, passivePerception: 14 },
];

describe('SRD-1206: TheftActionPanel', () => {
  it('commits a pickpocket attempt against the selected adjacent mark', () => {
    const onAttempt = vi.fn();
    render(
      <TheftActionPanel
        actorId="rogue-1"
        actorName="Vex"
        sleightBonus={7}
        hasTools
        hasFastHands={false}
        targets={TARGETS}
        onAttempt={onAttempt}
      />,
    );

    expect(screen.getByTestId('theft-action-panel')).toBeDefined();
    fireEvent.click(screen.getByTestId('theft-kind-pickpocket'));
    fireEvent.click(screen.getByTestId('theft-commit'));

    expect(onAttempt).toHaveBeenCalledTimes(1);
    expect(onAttempt).toHaveBeenCalledWith({
      actorId: 'rogue-1',
      targetId: 'mark-1',
      kind: 'pickpocket',
    });
  });

  it('supports plant and lift payloads (key vs pouch)', () => {
    const onAttempt = vi.fn();
    render(
      <TheftActionPanel
        actorId="rogue-1"
        actorName="Vex"
        sleightBonus={5}
        hasTools={false}
        hasFastHands={false}
        targets={TARGETS}
        onAttempt={onAttempt}
      />,
    );

    fireEvent.click(screen.getByTestId('theft-kind-lift'));
    fireEvent.click(screen.getByTestId('theft-lift-pouch'));
    fireEvent.click(screen.getByTestId('theft-commit'));

    expect(onAttempt).toHaveBeenCalledWith({
      actorId: 'rogue-1',
      targetId: 'mark-1',
      kind: 'lift',
      liftWhat: 'pouch',
    });
  });

  it('only shows the Fast Hands bonus-action toggle for Thief rogues', () => {
    const onAttempt = vi.fn();
    const { rerender } = render(
      <TheftActionPanel
        actorId="rogue-1"
        actorName="Vex"
        sleightBonus={7}
        hasTools
        hasFastHands={false}
        targets={TARGETS}
        onAttempt={onAttempt}
      />,
    );
    expect(screen.queryByTestId('theft-bonus-toggle')).toBeNull();
    expect(screen.queryByTestId('theft-fast-hands-badge')).toBeNull();

    rerender(
      <TheftActionPanel
        actorId="rogue-1"
        actorName="Vex"
        sleightBonus={7}
        hasTools
        hasFastHands
        targets={TARGETS}
        onAttempt={onAttempt}
      />,
    );
    const toggle = screen.getByTestId('theft-bonus-toggle');
    expect(toggle).toBeDefined();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByTestId('theft-commit'));
    expect(onAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ asBonusAction: true }),
    );
  });

  it('renders success vs caught results with distinct styling', () => {
    const onAttempt = vi.fn();
    const { rerender } = render(
      <TheftActionPanel
        actorId="rogue-1"
        actorName="Vex"
        sleightBonus={7}
        hasTools
        hasFastHands
        targets={TARGETS}
        onAttempt={onAttempt}
        lastResult={{ success: true, caught: false, headline: 'Vex lifts 8 gp from Suspicious Peddler (18 vs DC 11).' }}
      />,
    );
    expect(screen.getByTestId('theft-result').getAttribute('data-result')).toBe('success');

    rerender(
      <TheftActionPanel
        actorId="rogue-1"
        actorName="Vex"
        sleightBonus={7}
        hasTools
        hasFastHands
        targets={TARGETS}
        onAttempt={onAttempt}
        lastResult={{ success: false, caught: true, headline: 'Suspicious Peddler catches Vex — caught red-handed.' }}
      />,
    );
    expect(screen.getByTestId('theft-result').getAttribute('data-result')).toBe('caught');
  });

  it('disables commit when no adjacent mark is selected', () => {
    const onAttempt = vi.fn();
    render(
      <TheftActionPanel
        actorId="rogue-1"
        actorName="Vex"
        sleightBonus={3}
        hasTools={false}
        hasFastHands={false}
        targets={[{ id: 'far', name: 'Far Guard', adjacent: false }]}
        onAttempt={onAttempt}
      />,
    );
    const commit = screen.getByTestId('theft-commit') as HTMLButtonElement;
    expect(commit.disabled).toBe(true);
  });
});
