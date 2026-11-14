import React from 'react';
import { defaultCompendium, getPregenCharacter } from '@srd5/data';
import {
  computeDerivedCharacter,
  type DerivedCharacterSheet,
  type DiceRollRecord,
  type GameEvent,
  type PendingReactionPrompt,
  type TurnBudget,
} from '@srd5/engine';
import type {
  PlayerViewCombatant,
  PlayerViewState,
} from '@srd5/transport';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AnimatedDiceTray,
  CombatLog,
  DieFace,
  ReactionInterruptModal,
  TacticalCombatHud,
} from '../components/combat/index.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function createMockTurnBudget(overrides?: Partial<TurnBudget>): TurnBudget {
  return {
    action: 1,
    bonusAction: 1,
    reactionAvailable: true,
    movementRemainingFeet: 30,
    freeObjectInteraction: 1,
    bonusActionSpellCast: false,
    leveledActionSpellCast: false,
    attackActionTaken: false,
    extraAttacksRemaining: 0,
    disengaged: false,
    dodging: false,
    ...overrides,
  };
}

function createMockHero(
  id: string,
  pregenId: 'fighter' | 'wizard' | 'cleric' | 'rogue',
  overrides?: Partial<PlayerViewCombatant>,
): PlayerViewCombatant {
  const pregen = getPregenCharacter(`pregen-${pregenId}`)!;
  const sheet: DerivedCharacterSheet = computeDerivedCharacter(
    pregen,
    defaultCompendium,
  );

  return {
    id,
    name: sheet.name,
    side: 'party',
    size: 'medium',
    position: { x: 2, y: 3 },
    speedFeet: sheet.speedFeet,
    currentHp: sheet.currentHp,
    maxHp: sheet.maxHp,
    tempHp: 0,
    armorClass: sheet.armorClass.totalAc,
    conditions: [],
    isDead: false,
    isStable: true,
    reactionAvailable: true,
    characterSheet: sheet,
    ...overrides,
  };
}

function createMockViewState(overrides?: Partial<PlayerViewState>): PlayerViewState {
  const fighter = createMockHero('hero-fighter', 'fighter', {
    position: { x: 2, y: 2 },
  });
  const wizard = createMockHero('hero-wizard', 'wizard', {
    position: { x: 1, y: 2 },
  });

  const goblin: PlayerViewCombatant = {
    id: 'mob-goblin-1',
    name: 'Goblin Sneak',
    side: 'monster',
    size: 'small',
    position: { x: 4, y: 4 },
    speedFeet: 30,
    currentHp: 7,
    maxHp: 7,
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
    grid: {
      width: 10,
      height: 10,
      cells: [],
    },
    party: {
      [fighter.id]: fighter,
      [wizard.id]: wizard,
    },
    combatants: {
      [fighter.id]: fighter,
      [wizard.id]: wizard,
      [goblin.id]: goblin,
    },
    props: [],
    combat: {
      encounterId: 'enc-test-1',
      round: 1,
      phase: 'active_turn',
      initiativeOrder: [
        { entityId: fighter.id, initiative: 18, isVisible: true },
        { entityId: goblin.id, initiative: 14, isVisible: true },
        { entityId: wizard.id, initiative: 10, isVisible: true },
      ],
      activeCombatantId: fighter.id,
      turnBudget: createMockTurnBudget(),
      outcome: 'in_progress',
    },
    ...overrides,
  };
}

function createSampleDiceRoll(overrides?: Partial<DiceRollRecord>): DiceRollRecord {
  return {
    formula: '1d20 + 5',
    resolvedNotation: '1d20+5',
    mode: 'normal',
    diceGroups: [
      {
        notation: '1d20',
        count: 1,
        faces: 20,
        rolls: [14],
        kept: [14],
        dropped: [],
        subtotal: 14,
        dice: [
          {
            faces: 20,
            value: 14,
            initialRoll: 14,
            history: [14],
            kept: true,
            rerolled: false,
          },
        ],
      },
    ],
    rolls: [14],
    kept: [14],
    rerolledInitialRolls: [],
    modifier: 5,
    total: 19,
    naturalRoll: 14,
    naturalCrit: false,
    naturalFumble: false,
    ...overrides,
  };
}

describe('SRD-407: Reaction Interrupt Modal, Animated Dice Tray & Combat Log with Breakdown Tooltips', () => {
  describe('1. ReactionInterruptModal Component', () => {
    const mockPrompt: PendingReactionPrompt = {
      promptId: 'prompt-shield-1',
      reactorEntityId: 'hero-wizard',
      triggerType: 'attack_roll_hit',
      triggerDescription: 'Goblin Archer rolled 16 vs AC 12 (Hit!)',
      availableReactions: [
        {
          id: 'react-shield',
          label: 'Cast Shield (+5 AC)',
          reactionType: 'shield',
          slotLevel: 1,
          description: '+5 AC until start of your next turn; turns Hit into Miss!',
        },
        {
          id: 'react-custom',
          label: 'Opportunity Attack',
          reactionType: 'opportunity_attack',
          description: 'Make a melee weapon attack against departing target.',
        },
      ],
      timeoutMs: 10000,
    };

    it('renders reaction opportunity details, trigger description, and available reaction choices', () => {
      const onResolve = vi.fn();
      render(
        <ReactionInterruptModal
          prompt={mockPrompt}
          reactorCombatant={createMockHero('hero-wizard', 'wizard')}
          onResolve={onResolve}
        />,
      );

      expect(screen.getByTestId('reaction-interrupt-modal')).toBeDefined();
      expect(screen.getByText(/Reaction Opportunity/i)).toBeDefined();
      expect(screen.getByTestId('reaction-trigger-description').textContent).toContain(
        'Goblin Archer rolled 16 vs AC 12',
      );
      expect(screen.getByText('Cast Shield (+5 AC)')).toBeDefined();
      expect(screen.getByText('Opportunity Attack')).toBeDefined();
      expect(screen.getByTestId('reaction-pass-btn')).toBeDefined();
    });

    it('resolves execution when a reaction trigger button is clicked', () => {
      const onResolve = vi.fn();
      render(
        <ReactionInterruptModal
          prompt={mockPrompt}
          reactorCombatant={createMockHero('hero-wizard', 'wizard')}
          onResolve={onResolve}
        />,
      );

      const shieldBtn = screen.getByTestId('reaction-execute-react-shield');
      fireEvent.click(shieldBtn);

      expect(onResolve).toHaveBeenCalledWith({
        execute: true,
        reactionId: 'react-shield',
        slotLevel: 1,
      });
    });

    it('allows upcasting spell slot level before executing reaction', () => {
      const onResolve = vi.fn();
      render(
        <ReactionInterruptModal
          prompt={mockPrompt}
          reactorCombatant={createMockHero('hero-wizard', 'wizard')}
          onResolve={onResolve}
        />,
      );

      const slotSelect = screen.getByTestId('reaction-slot-select-react-shield');
      fireEvent.change(slotSelect, { target: { value: '2' } });

      const shieldBtn = screen.getByTestId('reaction-execute-react-shield');
      fireEvent.click(shieldBtn);

      expect(onResolve).toHaveBeenCalledWith({
        execute: true,
        reactionId: 'react-shield',
        slotLevel: 2,
      });
    });

    it('resolves pass when the Pass button is clicked', () => {
      const onResolve = vi.fn();
      render(
        <ReactionInterruptModal
          prompt={mockPrompt}
          reactorCombatant={createMockHero('hero-wizard', 'wizard')}
          onResolve={onResolve}
        />,
      );

      const passBtn = screen.getByTestId('reaction-pass-btn');
      fireEvent.click(passBtn);

      expect(onResolve).toHaveBeenCalledWith({ execute: false });
    });

    it('supports keyboard shortcuts: Escape to pass, number keys to execute', () => {
      const onResolve = vi.fn();
      render(
        <ReactionInterruptModal
          prompt={mockPrompt}
          reactorCombatant={createMockHero('hero-wizard', 'wizard')}
          onResolve={onResolve}
        />,
      );

      // Press '1' to execute first reaction (Shield)
      fireEvent.keyDown(window, { key: '1' });
      expect(onResolve).toHaveBeenCalledWith({
        execute: true,
        reactionId: 'react-shield',
        slotLevel: 1,
      });

      // Press Escape to pass
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onResolve).toHaveBeenCalledWith({ execute: false });
    });

    it('auto-resolves with execute: false when timeout expires', async () => {
      vi.useFakeTimers();
      const onResolve = vi.fn();
      const shortTimeoutPrompt: PendingReactionPrompt = {
        ...mockPrompt,
        timeoutMs: 500,
      };

      render(
        <ReactionInterruptModal
          prompt={shortTimeoutPrompt}
          onResolve={onResolve}
        />,
      );

      vi.advanceTimersByTime(600);
      expect(onResolve).toHaveBeenCalledWith({ execute: false });
      vi.useRealTimers();
    });
  });

  describe('2. AnimatedDiceTray Component', () => {
    it('renders normal dice roll with formula and total', () => {
      const roll = createSampleDiceRoll();
      render(
        <AnimatedDiceTray
          activeRoll={roll}
          rollPurpose="Longsword Attack"
          actorName="Thorin"
        />,
      );

      expect(screen.getByTestId('animated-dice-tray')).toBeDefined();
      expect(screen.getByTestId('dice-tray-total').textContent).toContain('19');
      expect(screen.getByTestId('dice-tray-formula').textContent).toContain('1d20+5: [14] + 5 = 19');
      expect(screen.getByTestId('die-face-d20').textContent).toContain('14');
    });

    it('renders Natural 20 Critical Hit badge with glowing highlight', () => {
      const critRoll = createSampleDiceRoll({
        naturalCrit: true,
        naturalRoll: 20,
        total: 25,
        diceGroups: [
          {
            notation: '1d20',
            count: 1,
            faces: 20,
            rolls: [20],
            kept: [20],
            dropped: [],
            subtotal: 20,
            dice: [
              {
                faces: 20,
                value: 20,
                initialRoll: 20,
                history: [20],
                kept: true,
                rerolled: false,
              },
            ],
          },
        ],
      });

      render(<AnimatedDiceTray activeRoll={critRoll} />);
      expect(screen.getByTestId('dice-tray-crit-badge')).toBeDefined();
      expect(screen.getByTestId('dice-tray-crit-badge').textContent).toContain('Critical Hit');
    });

    it('renders Natural 1 Fumble badge with skull callout', () => {
      const fumbleRoll = createSampleDiceRoll({
        naturalFumble: true,
        naturalRoll: 1,
        total: 6,
        diceGroups: [
          {
            notation: '1d20',
            count: 1,
            faces: 20,
            rolls: [1],
            kept: [1],
            dropped: [],
            subtotal: 1,
            dice: [
              {
                faces: 20,
                value: 1,
                initialRoll: 1,
                history: [1],
                kept: true,
                rerolled: false,
              },
            ],
          },
        ],
      });

      render(<AnimatedDiceTray activeRoll={fumbleRoll} />);
      expect(screen.getByTestId('dice-tray-fumble-badge')).toBeDefined();
      expect(screen.getByTestId('dice-tray-fumble-badge').textContent).toContain('Fumble');
    });

    it('renders Advantage / Disadvantage with kept vs dropped dice visual separation', () => {
      const advRoll = createSampleDiceRoll({
        mode: 'advantage',
        total: 23,
        diceGroups: [
          {
            notation: '2d20kh1',
            count: 2,
            faces: 20,
            rolls: [18, 5],
            kept: [18],
            dropped: [5],
            subtotal: 18,
            dice: [
              {
                faces: 20,
                value: 18,
                initialRoll: 18,
                history: [18],
                kept: true,
                rerolled: false,
              },
              {
                faces: 20,
                value: 5,
                initialRoll: 5,
                history: [5],
                kept: false,
                rerolled: false,
              },
            ],
          },
        ],
      });

      render(<AnimatedDiceTray activeRoll={advRoll} />);
      expect(screen.getByText(/Advantage \(Keep Highest\)/i)).toBeDefined();
      expect(screen.getByText('dropped')).toBeDefined();
    });

    it('renders rerolled dice (Halfling Lucky / Great Weapon Fighting)', () => {
      const luckyRoll = createSampleDiceRoll({
        total: 21,
        diceGroups: [
          {
            notation: '1d20',
            count: 1,
            faces: 20,
            rolls: [1, 16],
            kept: [16],
            dropped: [],
            subtotal: 16,
            dice: [
              {
                faces: 20,
                value: 16,
                initialRoll: 1,
                history: [1, 16],
                kept: true,
                rerolled: true,
                rerollReason: 'halfling_lucky',
              },
            ],
          },
        ],
      });

      render(<AnimatedDiceTray activeRoll={luckyRoll} />);
      expect(screen.getByText('1')).toBeDefined();
      expect(screen.getAllByText('16').length).toBeGreaterThanOrEqual(1);
    });

    it('supports roll history inspection and clear history', () => {
      const roll1 = createSampleDiceRoll({ formula: '1d20+5', total: 19 });
      const roll2 = createSampleDiceRoll({ formula: '2d6+3', total: 11 });
      const onSelect = vi.fn();
      const onClear = vi.fn();

      render(
        <AnimatedDiceTray
          activeRoll={roll1}
          rollHistory={[roll1, roll2]}
          onSelectHistoryRoll={onSelect}
          onClearHistory={onClear}
        />,
      );

      const historyItems = screen.getAllByTestId('dice-tray-history-item');
      expect(historyItems).toHaveLength(2);

      fireEvent.click(historyItems[1]!);
      expect(onSelect).toHaveBeenCalledWith(roll2);

      const clearBtn = screen.getByTestId('dice-tray-clear-btn');
      fireEvent.click(clearBtn);
      expect(onClear).toHaveBeenCalled();
    });
  });

  describe('3. CombatLog Component with Breakdown Tooltips', () => {
    const mockEvents: GameEvent[] = [
      {
        type: 'ROUND_STARTED',
        round: 1,
      },
      {
        type: 'TURN_STARTED',
        entityId: 'hero-fighter',
        round: 1,
      },
      {
        type: 'ATTACK_RESOLVED',
        attackerId: 'hero-fighter',
        targetId: 'mob-goblin-1',
        weaponOrSpellName: 'Longsword',
        attackType: 'melee_weapon',
        roll: 14,
        totalToHit: 19,
        targetAc: 15,
        outcome: 'hit',
        damage: {
          total: 9,
          damageType: 'slashing',
          diceFormula: '1d8 + 3',
        },
      },
      {
        type: 'DAMAGE_APPLIED',
        targetId: 'mob-goblin-1',
        rawAmount: 9,
        finalAmount: 9,
        damageType: 'slashing',
        tempHpAbsorbed: 0,
        hpRemaining: 0,
      },
      {
        type: 'SAVING_THROW_RESOLVED',
        entityId: 'hero-wizard',
        ability: 'con',
        dc: 10,
        roll: 12,
        total: 14,
        outcome: 'success',
        sourceSpellOrAbilityName: 'Concentration Check',
      },
      {
        type: 'SPELL_CAST',
        actorId: 'hero-wizard',
        spellId: 'magic_missile',
        spellName: 'Magic Missile',
        spellLevel: 1,
        castAtLevel: 1,
        actionCost: 'action',
        slotExpended: 1,
        targetEntityIds: ['mob-goblin-1'],
      },
      {
        type: 'CONDITION_ADDED',
        targetId: 'mob-goblin-1',
        conditionId: 'prone',
        sourceName: 'Shield Bash',
      },
      {
        type: 'DEATH_SAVE_ROLLED',
        entityId: 'hero-fighter',
        roll: 20,
        outcome: 'revived',
        deathSaves: { successes: 0, failures: 0 },
        currentHp: 1,
      },
      {
        type: 'REACTION_RESOLVED',
        promptId: 'prompt-1',
        reactorEntityId: 'hero-wizard',
        actionTaken: 'executed',
        reactionType: 'shield',
      },
      {
        type: 'ENCOUNTER_VICTORY',
        outcome: 'party_victory',
        round: 1,
      },
    ];

    it('renders formatted event rows for attacks, damage, spells, conditions, saves, and death saves', () => {
      render(
        <CombatLog
          events={mockEvents}
          combatants={{
            'hero-fighter': createMockHero('hero-fighter', 'fighter'),
            'hero-wizard': createMockHero('hero-wizard', 'wizard'),
            'mob-goblin-1': {
              id: 'mob-goblin-1',
              name: 'Goblin Sneak',
              side: 'monster',
              size: 'small',
              position: { x: 4, y: 4 },
              speedFeet: 30,
              currentHp: 7,
              maxHp: 7,
              tempHp: 0,
              armorClass: 15,
              conditions: [],
              isDead: false,
              isStable: true,
            },
          }}
        />,
      );

      expect(screen.getByTestId('combat-log')).toBeDefined();
      expect(screen.getAllByTestId('combat-log-entry').length).toBeGreaterThanOrEqual(10);
      expect(screen.getByText(/attacks Goblin Sneak/i)).toBeDefined();
      expect(screen.getByText(/takes damage/i)).toBeDefined();
      expect(screen.getByText(/CON Save/i)).toBeDefined();
      expect(screen.getByText(/casts Magic Missile/i)).toBeDefined();
      expect(screen.getByText(/gained condition/i)).toBeDefined();
      expect(screen.getByText(/NAT 20 \(REVIVED!\)/i)).toBeDefined();
    });

    it('displays transparent formula breakdown tooltip on hovering over an event entry', () => {
      render(
        <CombatLog
          events={mockEvents}
          combatants={{
            'hero-fighter': createMockHero('hero-fighter', 'fighter'),
            'mob-goblin-1': {
              id: 'mob-goblin-1',
              name: 'Goblin Sneak',
              side: 'monster',
              size: 'small',
              position: { x: 4, y: 4 },
              speedFeet: 30,
              currentHp: 7,
              maxHp: 7,
              tempHp: 0,
              armorClass: 15,
              conditions: [],
              isDead: false,
              isStable: true,
            },
          }}
        />,
      );

      // Initially no tooltip
      expect(screen.queryByTestId('combat-log-tooltip')).toBeNull();

      // Find the Attack entry and hover
      const entries = screen.getAllByTestId('combat-log-entry');
      const attackEntry = entries[2]!; // 3rd event is ATTACK_RESOLVED
      fireEvent.mouseEnter(attackEntry);

      // Tooltip should appear with exact breakdown
      expect(screen.getByTestId('combat-log-tooltip')).toBeDefined();
      expect(screen.getByText(/Attack Roll Breakdown/i)).toBeDefined();
      expect(screen.getByText(/Natural d20: 14/i)).toBeDefined();
      expect(screen.getByText(/Total to Hit: 19 vs AC 15/i)).toBeDefined();
      expect(screen.getByText(/Follow-up Damage: 9 slashing \(1d8 \+ 3\)/i)).toBeDefined();

      // Mouse leave hides tooltip
      fireEvent.mouseLeave(attackEntry);
      expect(screen.queryByTestId('combat-log-tooltip')).toBeNull();
    });

    it('filters log entries by category (Attacks, Spells, Saves, Conditions)', () => {
      render(<CombatLog events={mockEvents} />);

      // Filter by Spells
      const spellsFilterBtn = screen.getByTestId('combat-log-filter-spells');
      fireEvent.click(spellsFilterBtn);

      const filteredSpells = screen.getAllByTestId('combat-log-entry');
      expect(filteredSpells).toHaveLength(1);
      expect(filteredSpells[0]!.textContent).toContain('Magic Missile');

      // Filter by Saves
      const savesFilterBtn = screen.getByTestId('combat-log-filter-saves');
      fireEvent.click(savesFilterBtn);

      const filteredSaves = screen.getAllByTestId('combat-log-entry');
      expect(filteredSaves).toHaveLength(2); // CON save + Death save

      // Filter by All
      const allFilterBtn = screen.getByTestId('combat-log-filter-all');
      fireEvent.click(allFilterBtn);
      expect(screen.getAllByTestId('combat-log-entry').length).toBe(mockEvents.length);
    });

    it('searches log entries by keyword query', () => {
      render(<CombatLog events={mockEvents} />);

      const searchInput = screen.getByTestId('combat-log-search-input');
      fireEvent.change(searchInput, { target: { value: 'slashing' } });

      const filtered = screen.getAllByTestId('combat-log-entry');
      expect(filtered.length).toBeGreaterThanOrEqual(1);
      expect(filtered[0]!.textContent).toContain('slashing');
    });

    it('copies log entries to clipboard when Copy button is clicked', async () => {
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: writeTextMock,
        },
      });

      render(<CombatLog events={mockEvents} />);

      const copyBtn = screen.getByTestId('combat-log-copy-btn');
      fireEvent.click(copyBtn);

      expect(writeTextMock).toHaveBeenCalled();
      expect(await screen.findByText('✓ Copied')).toBeDefined();
    });
  });

  describe('4. Full Integration into TacticalCombatHud', () => {
    it('prominently renders ReactionInterruptModal when pendingReactionPrompt is present in viewState.combat', () => {
      const onResolveReaction = vi.fn();
      const prompt: PendingReactionPrompt = {
        promptId: 'prompt-oa-1',
        reactorEntityId: 'hero-fighter',
        triggerType: 'movement_reach_exit',
        triggerDescription: 'Goblin Sneak moves out of Thorin reach',
        availableReactions: [
          {
            id: 'react-oa',
            label: 'Opportunity Attack',
            reactionType: 'opportunity_attack',
            description: 'Make a melee weapon strike with Longsword.',
          },
        ],
      };

      const viewState = createMockViewState();
      viewState.combat!.pendingReactionPrompt = prompt;

      render(
        <TacticalCombatHud
          viewState={viewState}
          onResolveReaction={onResolveReaction}
        />,
      );

      expect(screen.getByTestId('reaction-interrupt-modal')).toBeDefined();
      expect(screen.getByTestId('reaction-trigger-description').textContent).toContain(
        'moves out of Thorin reach',
      );

      // Execute OA
      const execBtn = screen.getByTestId('reaction-execute-react-oa');
      fireEvent.click(execBtn);

      expect(onResolveReaction).toHaveBeenCalledWith({
        execute: true,
        reactionId: 'react-oa',
      });
    });

    it('renders CombatLog and AnimatedDiceTray in right panel with header toggles', () => {
      const viewState = createMockViewState();
      const roll = createSampleDiceRoll({ total: 22 });

      render(
        <TacticalCombatHud
          viewState={viewState}
          activeRoll={roll}
          events={[
            {
              type: 'ATTACK_RESOLVED',
              attackerId: 'hero-fighter',
              targetId: 'mob-goblin-1',
              weaponOrSpellName: 'Longsword',
              attackType: 'melee_weapon',
              roll: 17,
              totalToHit: 22,
              targetAc: 15,
              outcome: 'hit',
            },
          ]}
        />,
      );

      expect(screen.getByTestId('combat-hud-right-panel')).toBeDefined();
      expect(screen.getByTestId('animated-dice-tray')).toBeDefined();
      expect(screen.getByTestId('combat-log')).toBeDefined();

      // Toggle dice tray off
      const toggleDiceBtn = screen.getByTestId('combat-hud-toggle-dice-btn');
      fireEvent.click(toggleDiceBtn);
      expect(screen.queryByTestId('animated-dice-tray')).toBeNull();

      // Toggle log off
      const toggleLogBtn = screen.getByTestId('combat-hud-toggle-log-btn');
      fireEvent.click(toggleLogBtn);
      expect(screen.queryByTestId('combat-hud-right-panel')).toBeNull();
    });
  });
});
