import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Container } from 'pixi.js';
import { defaultCompendium, getPregenCharacter } from '@srd5/data';
import { computeDerivedCharacter } from '@srd5/engine';
import type { PlayerViewCombatant } from '@srd5/transport';
import {
  ActionHotbar,
  CombatantMedallion,
  SelectedEnemyCard,
  computeIconSize,
} from '../components/combat/index.js';
import { ActionTooltipCard } from '../components/combat/ActionTooltipCard.js';
import { CreatureTokenRenderer } from '../canvas/index.js';
import { PauseMenuModal } from '../components/system/index.js';
import {
  loadAppSettings,
  saveAppSettings,
} from '../persistence/settingsPersistence.js';

afterEach(() => {
  cleanup();
});

function makePartyCombatant(
  id: string,
  name: string,
  overrides?: Partial<PlayerViewCombatant>,
): PlayerViewCombatant {
  return {
    id,
    name,
    side: 'party',
    size: 'medium',
    position: { x: 1, y: 1 },
    speedFeet: 30,
    currentHp: 24,
    maxHp: 32,
    tempHp: 0,
    armorClass: 16,
    conditions: [],
    isDead: false,
    isStable: true,
    reactionAvailable: true,
    ...overrides,
  };
}

function makeMonsterCombatant(
  id: string,
  name: string,
  overrides?: Partial<PlayerViewCombatant>,
): PlayerViewCombatant {
  return {
    id,
    name,
    side: 'monster',
    size: 'medium',
    position: { x: 5, y: 5 },
    speedFeet: 30,
    currentHp: 13,
    maxHp: 26,
    tempHp: 0,
    armorClass: 13,
    conditions: [],
    isDead: false,
    isStable: false,
    reactionAvailable: true,
    challengeRating: 2,
    monsterType: 'humanoid',
    ...overrides,
  };
}

describe('SRD-608: BG3-Reference UI Polish', () => {
  describe('SelectedEnemyCard', () => {
    it('shows hostile HP, conditions and buffs with a close button', () => {
      const goblin = makeMonsterCombatant('goblin-1', 'Klaw', {
        conditions: ['poisoned'],
        activeEffects: [
          { effectId: 'bless-buff', name: 'Bless', requiresConcentration: true, remainingRounds: 8, modifiers: [] },
        ],
      });
      const onClose = vi.fn();

      render(<SelectedEnemyCard combatant={goblin} onClose={onClose} />);

      expect(screen.getByTestId('selected-enemy-card')).toBeDefined();
      expect(screen.getByTestId('selected-enemy-name').textContent).toContain('Klaw');
      expect(screen.getByTestId('selected-enemy-hp-text').textContent).toContain('13/26');
      const card = screen.getByTestId('selected-enemy-card');
      expect(card.textContent).toContain('poisoned');
      expect(card.textContent).toContain('Bless');

      fireEvent.click(screen.getByTestId('selected-enemy-close-btn'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('renders nothing without a combatant and offers sheet access for allies', () => {
      const { container } = render(<SelectedEnemyCard combatant={null} />);
      expect(container.textContent).toBe('');

      const fighter = makePartyCombatant('hero-fighter', 'Valeros');
      const onOpenSheet = vi.fn();
      render(<SelectedEnemyCard combatant={fighter} onOpenCharacterSheet={onOpenSheet} />);
      fireEvent.click(screen.getByTestId('selected-ally-sheet-btn'));
      expect(onOpenSheet).toHaveBeenCalledWith('hero-fighter');
    });
  });

  describe('ActionTooltipCard', () => {
    it('renders name, badge, effects, warning and cost footer', () => {
      render(
        <ActionTooltipCard
          testId="tooltip-shillelagh"
          name="Shillelagh"
          badge="Cantrip"
          subtitle="transmutation · bonus action"
          effectLines={['Imbue your staff with nature\u2019s power.']}
          warning="No club or quarterstaff equipped."
          cost={{ action: 'Bonus Action' }}
          accent="purple"
        />,
      );

      const card = screen.getByTestId('tooltip-shillelagh');
      expect(card.textContent).toContain('Shillelagh');
      expect(card.textContent).toContain('Cantrip');
      expect(card.textContent).toContain('No club or quarterstaff equipped.');
      expect(card.textContent).toContain('Bonus Action');
    });
  });

  describe('CombatantMedallion', () => {
    it('renders portrait, HP, pips, buffs and concentration marker', () => {
      const fighter = makePartyCombatant('hero-fighter', 'Valeros', {
        tempHp: 5,
        activeEffects: [
          { effectId: 'bless-buff', name: 'Bless', requiresConcentration: true, remainingRounds: 8, modifiers: [] },
        ],
        concentratingOn: {
          sourceId: 'bless',
          sourceName: 'Bless',
          targetEntityIds: ['hero-fighter'],
          remainingRounds: 8,
        },
      });
      const onOpenSheet = vi.fn();

      render(
        <CombatantMedallion
          combatant={fighter}
          turnBudget={{ action: 1, bonusAction: 0 } as never}
          onOpenCharacterSheet={onOpenSheet}
        />,
      );

      expect(screen.getByTestId('combat-medallion')).toBeDefined();
      expect(screen.getByTestId('hotbar-active-hero-name').textContent).toContain('Valeros');
      expect(screen.getByTestId('hotbar-active-hero-hp').textContent).toContain('HP 24/32');
      expect(screen.getByTestId('hotbar-active-hero-hp').textContent).toContain('+5');
      expect(screen.getByTestId('medallion-buffs').textContent).toContain('✦');
      expect(screen.getByTestId('medallion-concentration')).toBeDefined();

      fireEvent.click(screen.getByTestId('medallion-portrait-btn'));
      expect(onOpenSheet).toHaveBeenCalledWith('hero-fighter');
    });
  });

  describe('ActionHotbar customization', () => {
    function makeFighter(): PlayerViewCombatant {
      const pregen = getPregenCharacter('pregen-fighter')!;
      const derived = computeDerivedCharacter(pregen, defaultCompendium);
      return makePartyCombatant('hero-fighter', derived.name, {
        characterSheet: derived,
      });
    }

    it('exposes a resize handle and honors configured row counts', () => {
      const fighter = makeFighter();

      const { unmount } = render(
        <ActionHotbar
          activeCombatant={fighter}
          turnBudget={null}
          compendium={defaultCompendium}
          initialRows={1}
        />,
      );
      const handle = screen.getByTestId('hotbar-resize-handle');
      expect(handle.getAttribute('aria-valuemin')).toBe('1');
      expect(handle.getAttribute('aria-valuemax')).toBe('3');
      // Single-row mode scrolls horizontally with hidden scrollbars
      expect(screen.getByTestId('hotbar-panel-attack').className).toContain('flex-nowrap');
      unmount();

      render(
        <ActionHotbar
          activeCombatant={fighter}
          turnBudget={null}
          compendium={defaultCompendium}
          initialRows={3}
        />,
      );
      const panel = screen.getByTestId('hotbar-panel-attack');
      // Multi-row mode wraps with no scrollbars at all
      expect(panel.className).toContain('flex-wrap');
      expect(panel.className).toContain('overflow-visible');
    });

    it('scales icons to fit the row budget instead of scrolling', () => {
      // Fit math: N icons in R rows within W px, gap 8, clamped to [30, 48]
      expect(computeIconSize(0, 2, 400)).toBe(48);
      expect(computeIconSize(8, 2, 0)).toBe(48); // unmeasured container falls back to full size
      expect(computeIconSize(8, 2, 430)).toBe(48); // 4 cols -> 101px, clamped to max
      expect(computeIconSize(20, 2, 430)).toBe(35); // 10 cols -> 35px each
      expect(computeIconSize(30, 1, 320)).toBe(30); // extreme density hits the min size
      expect(computeIconSize(2, 2, 430)).toBe(48);
    });

    it('shows weapon-specific icons instead of one generic glyph', () => {
      const pregen = getPregenCharacter('pregen-fighter')!;
      const derived = computeDerivedCharacter(pregen, defaultCompendium);
      const fighter = makePartyCombatant('hero-fighter', derived.name, {
        characterSheet: derived,
      });

      render(
        <ActionHotbar
          activeCombatant={fighter}
          turnBudget={null}
          compendium={defaultCompendium}
        />,
      );

      const firstWeapon = derived.weaponAttacks[0]!;
      const card = screen.getByTestId(`attack-action-card-${firstWeapon.id}`);
      // Longsword-class weapons resolve to the broadsword glyph, not crossed swords
      const icons = card.querySelectorAll('img[data-testid^="game-icon-"]');
      expect(icons.length).toBeGreaterThan(0);
      const testIds = Array.from(icons).map((img) => img.getAttribute('data-testid'));
      expect(testIds.some((id) => id !== 'game-icon-attack')).toBe(true);
    });
  });

  describe('PauseMenu hotbar density setting', () => {
    it('persists hotbar row preference from the settings view', () => {
      const store: Record<string, string> = {};
      const storage = {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          store[k] = String(v);
        },
        removeItem: (k: string) => {
          delete store[k];
        },
        clear: () => {},
        key: () => null,
        get length() {
          return 0;
        },
      } as Storage;

      saveAppSettings({ ...loadAppSettings(storage), hotbarRows: 2 }, storage);

      render(
        <PauseMenuModal
          isOpen
          onClose={vi.fn()}
          settingsStorage={storage}
          onExitToTitle={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId('pause-menu-settings-btn'));
      expect(screen.getByTestId('pause-settings-hotbar-rows-2')).toBeDefined();

      fireEvent.click(screen.getByTestId('pause-settings-hotbar-rows-3'));
      expect(loadAppSettings(storage).hotbarRows).toBe(3);
    });
  });

  describe('Creature token buff pips & concentration ring', () => {
    it('draws emerald buff pips and overflow counts', () => {
      const parent = new Container();
      const renderer = new CreatureTokenRenderer(parent);

      renderer.render({
        combatants: [
          {
            id: 'buffed-fighter',
            name: 'Valeros',
            side: 'party',
            size: 'medium',
            position: { x: 1, y: 1 },
            currentHp: 20,
            maxHp: 20,
            activeEffects: [
              { effectId: 'bless-buff', name: 'Bless' },
              { effectId: 'haste-buff', name: 'Haste' },
              { effectId: 'aid-buff', name: 'Aid' },
              { effectId: 'rage-buff', name: 'Rage' },
            ],
          },
        ],
        cellSize: 48,
      });

      const node = renderer.getTokenNode('buffed-fighter');
      expect(node).toBeDefined();
      const buffLabels = node!.buffsContainer.children.map((c) => c.label);
      expect(buffLabels).toEqual(['Buff_bless-buff', 'Buff_haste-buff', 'Buff_aid-buff', 'Buff_More']);
      expect(node!.buffsContainer.visible).toBe(true);
    });

    it('hides buff pips when the combatant has no active effects', () => {
      const parent = new Container();
      const renderer = new CreatureTokenRenderer(parent);

      renderer.render({
        combatants: [
          {
            id: 'plain-fighter',
            name: 'Valeros',
            side: 'party',
            size: 'medium',
            position: { x: 1, y: 1 },
            currentHp: 20,
            maxHp: 20,
          },
        ],
        cellSize: 48,
      });

      const node = renderer.getTokenNode('plain-fighter');
      expect(node).toBeDefined();
      expect(node!.buffsContainer.visible).toBe(false);
      expect(node!.buffsContainer.children.length).toBe(0);
    });
  });
});
