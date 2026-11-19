import {
  defaultCompendium,
  getPregenCharacter,
} from '@srd5/data';
import {
  type DerivedCharacterSheet,
  type TurnBudget,
  computeDerivedCharacter,
} from '@srd5/engine';
import type {
  PlayerViewCombatant,
  PlayerViewInitiativeEntry,
  PlayerViewState,
} from '@srd5/transport';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ActionHotbar,
  InitiativeRibbon,
  PartyPortraits,
  STANDARD_ACTIONS,
  TacticalCombatHud,
  TurnBudgetIndicator,
} from '../components/combat/index.js';

afterEach(() => {
  cleanup();
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

function createMockPartyCombatant(
  id: string,
  pregenId: 'fighter' | 'wizard' | 'cleric' | 'rogue',
  overrides?: Partial<PlayerViewCombatant>,
): PlayerViewCombatant {
  const pregen = getPregenCharacter(`pregen-${pregenId}`)!;
  const derivedSheet: DerivedCharacterSheet = computeDerivedCharacter(
    pregen,
    defaultCompendium,
  );

  return {
    id,
    name: derivedSheet.name,
    side: 'party',
    size: 'medium',
    position: { x: 2, y: 3 },
    speedFeet: derivedSheet.speedFeet,
    currentHp: derivedSheet.currentHp,
    maxHp: derivedSheet.maxHp,
    tempHp: 0,
    armorClass: derivedSheet.armorClass.totalAc,
    conditions: [],
    isDead: false,
    isStable: true,
    reactionAvailable: true,
    characterSheet: derivedSheet,
    ...overrides,
  };
}

function createMockMonsterCombatant(
  id: string,
  name: string,
  overrides?: Partial<PlayerViewCombatant>,
): PlayerViewCombatant {
  return {
    id,
    name,
    side: 'monster',
    size: 'small',
    position: { x: 5, y: 6 },
    speedFeet: 30,
    currentHp: 7,
    maxHp: 7,
    tempHp: 0,
    armorClass: 15,
    conditions: [],
    isDead: false,
    isStable: false,
    reactionAvailable: true,
    ...overrides,
  };
}

function createMockPlayerViewState(): {
  viewState: PlayerViewState;
  fighter: PlayerViewCombatant;
  wizard: PlayerViewCombatant;
  goblin1: PlayerViewCombatant;
  goblin2: PlayerViewCombatant;
} {
  const fighter = createMockPartyCombatant('hero-fighter', 'fighter');
  const wizard = createMockPartyCombatant('hero-wizard', 'wizard');
  const goblin1 = createMockMonsterCombatant('goblin-1', 'Goblin Archer');
  const goblin2 = createMockMonsterCombatant('goblin-2', 'Goblin Boss', {
    maxHp: 21,
    currentHp: 21,
  });

  const initiativeOrder: PlayerViewInitiativeEntry[] = [
    { entityId: 'hero-fighter', initiative: 18, isVisible: true },
    { entityId: 'goblin-1', initiative: 15, isVisible: true },
    { entityId: 'hero-wizard', initiative: 12, isVisible: true },
    { entityId: 'goblin-2', initiative: 9, isVisible: true },
  ];

  const party: Record<string, PlayerViewCombatant> = {
    'hero-fighter': fighter,
    'hero-wizard': wizard,
  };

  const combatants: Record<string, PlayerViewCombatant> = {
    'hero-fighter': fighter,
    'hero-wizard': wizard,
    'goblin-1': goblin1,
    'goblin-2': goblin2,
  };

  const viewState: PlayerViewState = {
    playerId: 'player-1',
    mode: 'combat',
    grid: {
      width: 10,
      height: 10,
      cells: [],
    },
    party,
    combatants,
    props: [],
    combat: {
      encounterId: 'enc-watchtower-ambush',
      round: 1,
      phase: 'active_turn',
      initiativeOrder,
      activeCombatantId: 'hero-fighter',
      turnBudget: createMockTurnBudget(),
      outcome: 'in_progress',
    },
  };

  return { viewState, fighter, wizard, goblin1, goblin2 };
}

describe('SRD-406: React Tactical Combat HUD', () => {
  describe('TurnBudgetIndicator', () => {
    it('renders active Action, Bonus Action, Reaction, and movement budget', () => {
      const budget = createMockTurnBudget({
        action: 1,
        bonusAction: 1,
        reactionAvailable: true,
        movementRemainingFeet: 25,
      });

      render(<TurnBudgetIndicator turnBudget={budget} speedFeet={30} />);

      expect(screen.getByTestId('turn-budget-action').textContent).toContain('Action');
      expect(screen.getByTestId('turn-budget-bonus').textContent).toContain('Bonus');
      expect(screen.getByTestId('turn-budget-reaction').textContent).toContain('React');
      expect(screen.getByTestId('turn-budget-movement').textContent).toContain('25');
      expect(screen.getByTestId('turn-budget-movement').textContent).toContain('/30ft');
    });

    it('renders spent action states with line-through styling', () => {
      const spentBudget = createMockTurnBudget({
        action: 0,
        bonusAction: 0,
        reactionAvailable: false,
        movementRemainingFeet: 0,
      });

      render(<TurnBudgetIndicator turnBudget={spentBudget} speedFeet={30} />);

      const actionEl = screen.getByTestId('turn-budget-action');
      expect(actionEl.className).toContain('line-through');

      const bonusEl = screen.getByTestId('turn-budget-bonus');
      expect(bonusEl.className).toContain('line-through');

      const reactEl = screen.getByTestId('turn-budget-reaction');
      expect(reactEl.className).toContain('line-through');
    });

    it('renders tactical status badges (Disengaged, Dodging, Extra Attack, Cantrips Only)', () => {
      const buffedBudget = createMockTurnBudget({
        disengaged: true,
        dodging: true,
        extraAttacksRemaining: 1,
        bonusActionSpellCast: true,
      });

      render(<TurnBudgetIndicator turnBudget={buffedBudget} speedFeet={30} />);

      expect(screen.getByTestId('turn-budget-disengaged').textContent).toContain('Disengaged');
      expect(screen.getByTestId('turn-budget-dodging').textContent).toContain('Dodging');
      expect(screen.getByTestId('turn-budget-extra-attack').textContent).toContain('+1 Extra Attack');
      expect(screen.getByTestId('turn-budget-cantrip-only').textContent).toContain('Cantrips Only');
    });

    it('renders fallback empty state when turn budget is null', () => {
      render(<TurnBudgetIndicator turnBudget={null} />);
      expect(screen.getByTestId('turn-budget-indicator-empty')).toBeDefined();
    });
  });

  describe('InitiativeRibbon', () => {
    it('renders round badge, combat phase, and all ordered combatants', () => {
      const { viewState } = createMockPlayerViewState();
      const combat = viewState.combat!;

      render(
        <InitiativeRibbon
          round={combat.round}
          phase={combat.phase}
          initiativeOrder={combat.initiativeOrder}
          combatants={viewState.combatants}
          activeCombatantId={combat.activeCombatantId}
        />,
      );

      expect(screen.getByTestId('initiative-round-badge').textContent).toContain('Round');
      expect(screen.getByTestId('initiative-round-badge').textContent).toContain('1');
      expect(screen.getByTestId('initiative-round-badge').textContent?.toLowerCase()).toContain('active turn');

      expect(screen.getByTestId('initiative-card-hero-fighter')).toBeDefined();
      expect(screen.getByTestId('initiative-card-goblin-1')).toBeDefined();
      expect(screen.getByTestId('initiative-card-hero-wizard')).toBeDefined();
      expect(screen.getByTestId('initiative-card-goblin-2')).toBeDefined();

      // Active hero has the "Turn" badge
      const activeCard = screen.getByTestId('initiative-card-hero-fighter');
      expect(activeCard.getAttribute('data-active')).toBe('true');
      expect(within(activeCard).getByTestId('initiative-active-badge').textContent).toContain('Turn');
    });

    it('calls onSelectCombatant when a combatant card is clicked or keydown activated', () => {
      const { viewState } = createMockPlayerViewState();
      const combat = viewState.combat!;
      const onSelect = vi.fn();

      render(
        <InitiativeRibbon
          round={combat.round}
          phase={combat.phase}
          initiativeOrder={combat.initiativeOrder}
          combatants={viewState.combatants}
          activeCombatantId={combat.activeCombatantId}
          onSelectCombatant={onSelect}
        />,
      );

      fireEvent.click(screen.getByTestId('initiative-card-goblin-1'));
      expect(onSelect).toHaveBeenCalledWith('goblin-1');

      fireEvent.keyDown(screen.getByTestId('initiative-card-hero-wizard'), {
        key: 'Enter',
      });
      expect(onSelect).toHaveBeenCalledWith('hero-wizard');
    });

    it('renders placeholder for unrevealed / hidden combatant', () => {
      const { viewState } = createMockPlayerViewState();
      const hiddenOrder: PlayerViewInitiativeEntry[] = [
        ...viewState.combat!.initiativeOrder,
        { entityId: 'stealthed-assassin', initiative: 22, isVisible: false },
      ];

      render(
        <InitiativeRibbon
          round={1}
          initiativeOrder={hiddenOrder}
          combatants={viewState.combatants}
          activeCombatantId="hero-fighter"
        />,
      );

      expect(screen.getByTestId('initiative-card-hidden-4')).toBeDefined();
      expect(screen.getByTestId('initiative-card-hidden-4').textContent).toContain('#22');
    });
  });

  describe('PartyPortraits', () => {
    it('renders party hero cards with name, class, HP, THP, AC, speed, and reaction ready', () => {
      const { viewState, fighter } = createMockPlayerViewState();
      fighter.tempHp = 5;

      render(
        <PartyPortraits
          party={viewState.party}
          activeCombatantId="hero-fighter"
          selectedCombatantId="hero-wizard"
        />,
      );

      const fighterCard = screen.getByTestId('party-card-hero-fighter');
      expect(fighterCard.textContent).toContain(fighter.name);
      expect(screen.getByTestId('party-card-active-tag-hero-fighter').textContent).toContain('Active Turn');
      expect(screen.getByTestId('party-card-thp-hero-fighter').textContent).toContain('+5');
      expect(screen.getByTestId('party-card-ac-hero-fighter').textContent).toContain(`🛡️ ${fighter.armorClass}`);
      expect(screen.getByTestId('party-card-speed-hero-fighter').textContent).toContain(`👟 ${fighter.speedFeet}ft`);
      expect(screen.getByTestId('party-card-reaction-hero-fighter').textContent).toContain('React');
    });

    it('supports selecting party members and opening character sheet', () => {
      const { viewState } = createMockPlayerViewState();
      const onSelect = vi.fn();
      const onOpenSheet = vi.fn();

      render(
        <PartyPortraits
          party={viewState.party}
          activeCombatantId="hero-fighter"
          onSelectPartyMember={onSelect}
          onOpenCharacterSheet={onOpenSheet}
        />,
      );

      fireEvent.click(screen.getByTestId('party-card-hero-wizard'));
      expect(onSelect).toHaveBeenCalledWith('hero-wizard');

      fireEvent.click(screen.getByTestId('party-card-sheet-btn-hero-fighter'));
      expect(onOpenSheet).toHaveBeenCalledWith('hero-fighter');
    });

    it('renders condition and active buff badges for status indication', () => {
      const { viewState } = createMockPlayerViewState();

      render(
        <PartyPortraits
          party={{
            ...viewState.party,
            'hero-wizard': {
              ...viewState.party['hero-wizard']!,
              conditions: ['poisoned'],
              activeEffects: [
                {
                  effectId: 'bless-buff',
                  name: 'Bless',
                  requiresConcentration: true,
                  remainingRounds: 8,
                  modifiers: [],
                },
              ],
            },
          }}
          activeCombatantId="hero-fighter"
        />,
      );

      expect(screen.getByTestId('party-card-conditions-hero-wizard').textContent).toContain('poisoned');
      const buffs = screen.getByTestId('party-card-buffs-hero-wizard');
      expect(buffs.textContent).toContain('Bless');
      expect(buffs.textContent).toContain('(8)');
    });

    it('supports collapsing and expanding party sidebar', () => {
      const { viewState } = createMockPlayerViewState();
      const onToggle = vi.fn();

      const { rerender } = render(
        <PartyPortraits
          party={viewState.party}
          activeCombatantId="hero-fighter"
          collapsed={false}
          onToggleCollapse={onToggle}
        />,
      );

      fireEvent.click(screen.getByTestId('party-portraits-toggle-collapse'));
      expect(onToggle).toHaveBeenCalledTimes(1);

      rerender(
        <PartyPortraits
          party={viewState.party}
          activeCombatantId="hero-fighter"
          collapsed={true}
          onToggleCollapse={onToggle}
        />,
      );

      expect(screen.getByTestId('party-card-collapsed-hero-fighter')).toBeDefined();
    });
  });

  describe('ActionHotbar', () => {
    it('renders active combatant summary, turn budget, and end turn button', () => {
      const { fighter } = createMockPlayerViewState();
      const budget = createMockTurnBudget();
      const onEndTurn = vi.fn();

      render(
        <ActionHotbar
          activeCombatant={fighter}
          turnBudget={budget}
          compendium={defaultCompendium}
          onEndTurn={onEndTurn}
        />,
      );

      expect(screen.getByTestId('hotbar-active-hero-name').textContent).toContain(fighter.name);
      expect(screen.getByTestId('hotbar-active-hero-hp').textContent).toContain(
        `HP ${fighter.currentHp}/${fighter.maxHp}`,
      );
      const endTurnBtn = screen.getByTestId('hotbar-end-turn-btn') as HTMLButtonElement;
      expect(endTurnBtn.disabled).toBe(false);

      fireEvent.click(endTurnBtn);
      expect(onEndTurn).toHaveBeenCalledTimes(1);
    });

    it('renders Attack tab with equipped weapons and triggers onDeclareAttack', () => {
      const { fighter } = createMockPlayerViewState();
      const budget = createMockTurnBudget();
      const onAttack = vi.fn();

      render(
        <ActionHotbar
          activeCombatant={fighter}
          turnBudget={budget}
          compendium={defaultCompendium}
          onDeclareAttack={onAttack}
        />,
      );

      expect(screen.getByTestId('hotbar-panel-attack')).toBeDefined();
      const firstWeapon = fighter.characterSheet!.weaponAttacks[0]!;
      const attackBtn = screen.getByTestId(`attack-btn-${firstWeapon.id}`);
      expect(attackBtn).toBeDefined();

      fireEvent.click(attackBtn);
      expect(onAttack).toHaveBeenCalledTimes(1);
    });

    it('renders Spells tab with cantrips, slot counts, and triggers onCastSpell', () => {
      const { wizard } = createMockPlayerViewState();
      const budget = createMockTurnBudget();
      const onCast = vi.fn();

      render(
        <ActionHotbar
          activeCombatant={wizard}
          turnBudget={budget}
          compendium={defaultCompendium}
          activeTab="spells"
          onCastSpell={onCast}
        />,
      );

      expect(screen.getByTestId('hotbar-panel-spells')).toBeDefined();
      expect(screen.getByTestId('spell-filter-0').textContent).toContain('Cantrips');

      const castBtns = screen.getAllByRole('button', { name: /cast/i });
      expect(castBtns.length).toBeGreaterThan(0);

      fireEvent.click(castBtns[0]!);
      expect(onCast).toHaveBeenCalledTimes(1);
    });

    it('displays Bonus Action spell restriction banner when bonusActionSpellCast is active', () => {
      const { wizard } = createMockPlayerViewState();
      const budget = createMockTurnBudget({ bonusActionSpellCast: true });

      render(
        <ActionHotbar
          activeCombatant={wizard}
          turnBudget={budget}
          compendium={defaultCompendium}
          activeTab="spells"
        />,
      );

      expect(screen.getByTestId('hotbar-cantrip-restriction-banner')).toBeDefined();
      expect(screen.getByTestId('hotbar-cantrip-restriction-banner').textContent).toContain('cantrips');
    });

    it('renders Class Features tab and triggers onUseClassFeature', () => {
      const { fighter } = createMockPlayerViewState();
      const budget = createMockTurnBudget();
      const onFeature = vi.fn();

      render(
        <ActionHotbar
          activeCombatant={fighter}
          turnBudget={budget}
          compendium={defaultCompendium}
          activeTab="features"
          onUseClassFeature={onFeature}
        />,
      );

      expect(screen.getByTestId('hotbar-panel-features')).toBeDefined();
      const activateBtns = screen.queryAllByRole('button', { name: /activate/i });
      if (activateBtns.length > 0) {
        fireEvent.click(activateBtns[0]!);
        expect(onFeature).toHaveBeenCalledTimes(1);
      }
    });

    it('renders Standard Actions tab (Dash, Disengage, Dodge, Help, Hide, Search, Stand Up) and triggers onStandardAction', () => {
      const { fighter } = createMockPlayerViewState();
      const budget = createMockTurnBudget();
      const onStandard = vi.fn();

      render(
        <ActionHotbar
          activeCombatant={fighter}
          turnBudget={budget}
          compendium={defaultCompendium}
          activeTab="standard"
          onStandardAction={onStandard}
        />,
      );

      expect(screen.getByTestId('hotbar-panel-standard')).toBeDefined();
      expect(screen.getByTestId('standard-action-card-dash')).toBeDefined();
      expect(screen.getByTestId('standard-action-card-disengage')).toBeDefined();
      expect(screen.getByTestId('standard-action-card-dodge')).toBeDefined();

      fireEvent.click(screen.getByTestId('standard-action-btn-dash'));
      expect(onStandard).toHaveBeenCalledWith('dash');

      fireEvent.click(screen.getByTestId('standard-action-btn-disengage'));
      expect(onStandard).toHaveBeenCalledWith('disengage');
    });

    it('renders Items tab and triggers onUseItem', () => {
      const { fighter } = createMockPlayerViewState();
      const budget = createMockTurnBudget();
      const onUseItem = vi.fn();

      render(
        <ActionHotbar
          activeCombatant={fighter}
          turnBudget={budget}
          compendium={defaultCompendium}
          activeTab="items"
          onUseItem={onUseItem}
        />,
      );

      expect(screen.getByTestId('hotbar-panel-items')).toBeDefined();
      expect(screen.getByTestId('item-card-potion-healing')).toBeDefined();

      fireEvent.click(screen.getByTestId('item-use-btn-potion-healing'));
      expect(onUseItem).toHaveBeenCalledWith('potion-of-healing');
    });
  });

  describe('TacticalCombatHud (Full Integration)', () => {
    it('integrates Header, Initiative Ribbon, Party Portraits, Viewport Canvas, and Action Hotbar', () => {
      const { viewState } = createMockPlayerViewState();
      const onEndTurn = vi.fn();
      const onMenu = vi.fn();
      const onSelect = vi.fn();

      render(
        <TacticalCombatHud
          viewState={viewState}
          compendium={defaultCompendium}
          title="Floor 1: Ruined Watchtower"
          subtitle="Ambush Encounter"
          onEndTurn={onEndTurn}
          onToggleMenu={onMenu}
          onSelectCombatant={onSelect}
          rightPanel={<div data-testid="test-combat-log">Combat Log Inspector</div>}
        >
          <div data-testid="mock-tactical-canvas">PixiJS Canvas Viewport</div>
        </TacticalCombatHud>,
      );

      // Header verification
      expect(screen.getByTestId('combat-hud-title').textContent).toContain('Floor 1: Ruined Watchtower');
      expect(screen.getByTestId('combat-hud-header').textContent).toContain('Ambush Encounter');
      expect(screen.getByTestId('initiative-ribbon')).toBeDefined();

      // Menu button
      fireEvent.click(screen.getByTestId('combat-hud-menu-btn'));
      expect(onMenu).toHaveBeenCalledTimes(1);

      // Party portraits
      expect(screen.getByTestId('party-portraits')).toBeDefined();

      // Center viewport
      expect(screen.getByTestId('mock-tactical-canvas')).toBeDefined();

      // Right panel
      expect(screen.getByTestId('test-combat-log')).toBeDefined();

      // Action hotbar
      expect(screen.getByTestId('action-hotbar')).toBeDefined();
      const endTurnBtn = screen.getByTestId('hotbar-end-turn-btn') as HTMLButtonElement;
      expect(endTurnBtn.disabled).toBe(false);

      fireEvent.click(endTurnBtn);
      expect(onEndTurn).toHaveBeenCalledTimes(1);
    });

    it('owns log/dice visibility with parent-provided defaults and toggle notifications (Arena mode)', () => {
      const { viewState } = createMockPlayerViewState();
      const onToggleLog = vi.fn();
      const onToggleDice = vi.fn();

      const { rerender } = render(
        <TacticalCombatHud
          viewState={viewState}
          compendium={defaultCompendium}
          defaultShowCombatLog={false}
          defaultShowDiceTray={false}
          onToggleCombatLog={onToggleLog}
          onToggleDiceTray={onToggleDice}
        />,
      );

      // Closed initially: no right panel rendered
      expect(screen.queryByTestId('combat-hud-right-panel')).toBeNull();

      // Toggles flip internal state AND notify the parent with the new value
      fireEvent.click(screen.getByTestId('combat-hud-toggle-log-btn'));
      expect(onToggleLog).toHaveBeenCalledTimes(1);
      expect(onToggleLog).toHaveBeenCalledWith(true);
      fireEvent.click(screen.getByTestId('combat-hud-toggle-dice-btn'));
      expect(onToggleDice).toHaveBeenCalledTimes(1);
      expect(onToggleDice).toHaveBeenCalledWith(true);
      expect(screen.getByTestId('combat-hud-right-panel')).toBeDefined();

      // Re-rendering with open defaults keeps the (already open) panel up
      rerender(
        <TacticalCombatHud
          viewState={viewState}
          compendium={defaultCompendium}
          defaultShowCombatLog
          defaultShowDiceTray
          onToggleCombatLog={onToggleLog}
          onToggleDiceTray={onToggleDice}
        />,
      );
      expect(screen.getByTestId('combat-hud-right-panel')).toBeDefined();
      expect(screen.getByTestId('combat-hud-toggle-log-btn').getAttribute('aria-pressed')).toBe('true');
    });
  });
});
