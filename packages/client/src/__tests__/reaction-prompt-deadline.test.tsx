import React from 'react';
import type { PendingReactionPrompt } from '@srd5/engine';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReactionInterruptModal } from '../components/combat/index.js';

const prompt: PendingReactionPrompt = {
  promptId: 'mp-prompt',
  reactorEntityId: 'wizard',
  triggerType: 'attack_roll_hit',
  triggerDescription: 'Goblin hits Wizard',
  availableReactions: [
    { id: 'shield', label: 'Cast Shield', reactionType: 'shield', slotLevel: 1 },
  ],
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SRD-703: server-authoritative reaction countdown', () => {
  it('counts down to the projected deadline without dispatching on expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const deadlineMs = Date.now() + 5000;
    const onResolve = vi.fn();

    render(
      <ReactionInterruptModal
        prompt={prompt}
        deadlineMs={deadlineMs}
        serverAuthoritativeTimeout
        onResolve={onResolve}
      />,
    );

    expect(screen.getByTestId('reaction-countdown').textContent).toBe('5s');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByTestId('reaction-countdown').textContent).toBe('2s');
    expect(onResolve).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByTestId('reaction-countdown').textContent).toBe('0s');
    // The authoritative server resolves the prompt; the client must not race it.
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('keeps the legacy local auto-pass when no server deadline is supplied', async () => {
    vi.useFakeTimers();
    const onResolve = vi.fn();
    const localPrompt: PendingReactionPrompt = { ...prompt, timeoutMs: 1000 };

    render(<ReactionInterruptModal prompt={localPrompt} onResolve={onResolve} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(onResolve).toHaveBeenCalledWith({ execute: false });
  });
});
