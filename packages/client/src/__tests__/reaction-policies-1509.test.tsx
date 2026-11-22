import { defaultCompendium, getPregenCharacter } from '@srd5/data';
import { computeDerivedCharacter, type PendingReactionPrompt } from '@srd5/engine';
import type { PlayerViewCombatant, PlayerViewState } from '@srd5/transport';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReactionInterruptModal, TacticalCombatHud } from '../components/combat/index.js';
import { CharacterSpellbook } from '../components/inventory/CharacterSpellbook.js';
import { listOwnedReactions } from '../components/inventory/reactionCatalog.js';
import {
  clearReactionPolicyMirrorForTests,
  decideReactionPromptAction,
  getReactionPoliciesForCharacterSync,
  getReactionPolicySync,
  normalizeReactionPolicyKey,
  setReactionPolicySync,
} from '../persistence/reactionPolicies.js';

const compendium = defaultCompendium;

beforeEach(() => {
  clearReactionPolicyMirrorForTests();
});

afterEach(() => {
  cleanup();
  clearReactionPolicyMirrorForTests();
  vi.restoreAllMocks();
});

function makePrompt(): PendingReactionPrompt {
  return {
    promptId: 'prompt-1509-1',
    reactorEntityId: 'hero-wizard',
    triggerType: 'attack_roll_hit',
    triggerDescription: 'Goblin hits Lyra (Roll 18 vs AC 15). Choose a reaction:',
    availableReactions: [
      {
        id: 'cast_shield',
        label: 'Cast Shield (+5 AC)',
        reactionType: 'shield',
        slotLevel: 1,
        description: 'Gain +5 AC.',
      },
      {
        id: 'uncanny_dodge',
        label: 'Uncanny Dodge (Halve Damage)',
        reactionType: 'uncanny_dodge',
        description: 'Halve damage.',
      },
    ],
  };
}

function makeHudViewState(prompt: PendingReactionPrompt): PlayerViewState {
  const wizardCombatant: PlayerViewCombatant = {
    id: 'hero-wizard',
    name: 'Lyra',
    side: 'party',
    size: 'medium',
    position: { x: 1, y: 2 },
    speedFeet: 30,
    currentHp: 10,
    maxHp: 10,
    tempHp: 0,
    armorClass: 15,
    conditions: [],
    isDead: false,
    isStable: true,
    reactionAvailable: true,
  };
  return {
    playerId: 'player-1',
    mode: 'combat',
    grid: { width: 10, height: 10, cells: [] },
    party: { 'hero-wizard': wizardCombatant },
    combatants: { 'hero-wizard': wizardCombatant },
    combat: {
      phase: 'reaction_prompt',
      round: 1,
      activeCombatantId: 'mob-1',
      initiativeOrder: [],
      turnBudget: null,
      pendingReactionPrompt: prompt,
      reactionInterruptContext: null,
    },
  } as unknown as PlayerViewState;
}

describe('SRD-1509: Reactions policy tab', () => {
  it('normalizes per-slot reaction ids to canonical policy keys', () => {
    expect(normalizeReactionPolicyKey('counterspell_slot_3')).toBe('counterspell');
    expect(normalizeReactionPolicyKey('cast_shield')).toBe('shield');
    expect(normalizeReactionPolicyKey('shield_slot_2')).toBe('shield');
    expect(normalizeReactionPolicyKey('opportunity_attack')).toBe('opportunity_attack');
    expect(normalizeReactionPolicyKey('protection')).toBe('protection');
    expect(normalizeReactionPolicyKey('uncanny_dodge')).toBe('uncanny_dodge');
  });

  it('decides show/auto/pass from the policy map (missing entries default to ask)', () => {
    const prompt = makePrompt();
    expect(decideReactionPromptAction(prompt, {})).toEqual({ action: 'show' });
    expect(
      decideReactionPromptAction(prompt, { shield: 'auto', uncanny_dodge: 'off' }),
    ).toEqual({ action: 'auto', reactionId: 'cast_shield', slotLevel: 1 });
    expect(
      decideReactionPromptAction(prompt, { shield: 'off', uncanny_dodge: 'off' }),
    ).toEqual({ action: 'pass' });
    // Later auto still wins over an earlier off (prompt order preserved).
    expect(
      decideReactionPromptAction(prompt, { shield: 'off', uncanny_dodge: 'auto' }),
    ).toEqual({ action: 'auto', reactionId: 'uncanny_dodge' });
  });

  it('persists policies per character in the sync mirror', () => {
    expect(getReactionPolicySync('hero-a', 'shield')).toBe('ask');
    setReactionPolicySync('hero-a', 'cast_shield', 'auto');
    expect(getReactionPolicySync('hero-a', 'shield')).toBe('auto');
    expect(getReactionPolicySync('hero-a', 'counterspell_slot_3')).toBe('ask');
    // Other characters are unaffected.
    expect(getReactionPolicySync('hero-b', 'shield')).toBe('ask');
    expect(getReactionPoliciesForCharacterSync('hero-a')).toEqual({ shield: 'auto' });
  });

  it('catalogs owned reactions: fighter OA-only, wizard OA+Shield', () => {
    const fighter = getPregenCharacter('pregen-fighter')!;
    const fighterSheet = computeDerivedCharacter(fighter, compendium);
    expect(listOwnedReactions(fighter, fighterSheet).map((e) => e.key)).toEqual([
      'opportunity_attack',
    ]);

    const wizard = getPregenCharacter('pregen-wizard')!;
    const wizardSheet = computeDerivedCharacter(wizard, compendium);
    expect(listOwnedReactions(wizard, wizardSheet).map((e) => e.key)).toEqual([
      'opportunity_attack',
      'shield',
    ]);
  });

  it('catalogs Uncanny Dodge for rogues at level 5+ (presentation only)', () => {
    const rogue = getPregenCharacter('pregen-rogue')!;
    const leveled = {
      ...rogue,
      classes: rogue.classes.map((c) => ({ ...c, level: 5 })),
    } as unknown as typeof rogue;
    const sheet = computeDerivedCharacter(leveled, compendium);
    expect(listOwnedReactions(leveled, sheet).map((e) => e.key)).toContain('uncanny_dodge');
  });

  it('spellbook shows a Reactions tab with Ask/Auto/Off per row and persists flips', () => {
    const wizard = getPregenCharacter('pregen-wizard')!;
    render(<CharacterSpellbook hero={wizard} compendium={compendium} />);
    fireEvent.click(screen.getByTestId('character-view-spellbook-tab-reactions'));
    expect(screen.getByTestId('character-view-spellbook-reactions')).toBeDefined();
    expect(
      screen.getByTestId('character-view-spellbook-reactions-row-opportunity_attack'),
    ).toBeDefined();
    expect(
      screen.getByTestId('character-view-spellbook-reactions-row-shield'),
    ).toBeDefined();
    // Slot tags render per Spec 14 §12 (per-slot-level variants).
    expect(screen.getByTestId('character-view-spellbook-reactions-slot-shield').textContent).toBe(
      'I+',
    );

    fireEvent.click(
      screen.getByTestId('character-view-spellbook-reactions-policy-shield-auto'),
    );
    expect(getReactionPolicySync(wizard.id, 'shield')).toBe('auto');
    expect(
      screen
        .getByTestId('character-view-spellbook-reactions-policy-shield-auto')
        .getAttribute('aria-pressed'),
    ).toBe('true');

    // Keyboard/focus parity: the policy control is a real button.
    const btn = screen.getByTestId('character-view-spellbook-reactions-policy-shield-off');
    expect(btn.tagName).toBe('BUTTON');
    btn.focus();
    expect(document.activeElement).toBe(btn);
  });

  it('non-casters keep the spell empty state but still reach the Reactions tab', () => {
    const fighter = getPregenCharacter('pregen-fighter')!;
    render(<CharacterSpellbook hero={fighter} compendium={compendium} />);
    expect(screen.getByTestId('character-view-spellbook-empty')).toBeDefined();
    fireEvent.click(screen.getByTestId('character-view-spellbook-tab-reactions'));
    expect(
      screen.getByTestId('character-view-spellbook-reactions-row-opportunity_attack'),
    ).toBeDefined();
  });

  it('interrupt modal shows the active policy and flips it mid-fight', () => {
    const prompt = makePrompt();
    const onResolve = vi.fn();
    const onPolicyChange = vi.fn();
    render(
      <ReactionInterruptModal
        prompt={prompt}
        onResolve={onResolve}
        policies={{ shield: 'auto' }}
        onPolicyChange={onPolicyChange}
      />,
    );
    expect(screen.getByTestId('reaction-policy-active-cast_shield').textContent).toBe('auto');
    fireEvent.click(screen.getByTestId('reaction-policy-set-cast_shield-off'));
    expect(onPolicyChange).toHaveBeenCalledWith('shield', 'off');
    // Choosing still resolves normally.
    fireEvent.click(screen.getByTestId('reaction-execute-cast_shield'));
    expect(onResolve).toHaveBeenCalledWith({
      execute: true,
      reactionId: 'cast_shield',
      slotLevel: 1,
    });
  });

  it('HUD auto-executes the first Auto option and hides the modal', async () => {
    const prompt = makePrompt();
    setReactionPolicySync('hero-wizard', 'shield', 'auto');
    const onResolveReaction = vi.fn();
    render(
      <TacticalCombatHud viewState={makeHudViewState(prompt)} onResolveReaction={onResolveReaction} />,
    );
    await waitFor(() => {
      expect(onResolveReaction).toHaveBeenCalledWith({
        execute: true,
        reactionId: 'cast_shield',
        slotLevel: 1,
      });
    });
    expect(screen.queryByTestId('reaction-interrupt-modal')).toBeNull();
  });

  it('HUD passes immediately when every option is Off, and shows the modal on Ask', async () => {
    const prompt = makePrompt();
    setReactionPolicySync('hero-wizard', 'shield', 'off');
    setReactionPolicySync('hero-wizard', 'uncanny_dodge', 'off');
    const onResolveReaction = vi.fn();
    const { unmount } = render(
      <TacticalCombatHud viewState={makeHudViewState(prompt)} onResolveReaction={onResolveReaction} />,
    );
    await waitFor(() => {
      expect(onResolveReaction).toHaveBeenCalledWith({ execute: false });
    });
    expect(screen.queryByTestId('reaction-interrupt-modal')).toBeNull();
    unmount();
    cleanup();

    // Default (Ask) keeps today's modal with the mid-fight policy flip.
    clearReactionPolicyMirrorForTests();
    const onAsk = vi.fn();
    render(
      <TacticalCombatHud viewState={makeHudViewState(prompt)} onResolveReaction={onAsk} />,
    );
    expect(screen.getByTestId('reaction-interrupt-modal')).toBeDefined();
    expect(screen.getByTestId('reaction-policy-active-cast_shield').textContent).toBe('ask');
    fireEvent.click(screen.getByTestId('reaction-policy-set-cast_shield-auto'));
    expect(getReactionPolicySync('hero-wizard', 'shield')).toBe('auto');
    // Flipping to Auto mid-fight immediately auto-answers (client-side policy).
    await waitFor(() => {
      expect(onAsk).toHaveBeenCalledWith({
        execute: true,
        reactionId: 'cast_shield',
        slotLevel: 1,
      });
    });
  });
});
