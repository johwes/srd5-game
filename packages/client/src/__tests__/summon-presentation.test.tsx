import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Container, Graphics } from 'pixi.js';
import type {
  PlayerViewCombatant,
  PlayerViewInitiativeEntry,
  PlayerViewState,
} from '@srd5/transport';
import { CreatureTokenRenderer } from '../canvas/index.js';
import {
  ActionHotbar,
  CombatantMedallion,
  TacticalCombatHud,
} from '../components/combat/index.js';
import { resolveSpellTargets } from '../utils/combatTargeting.js';
import { validateTargetPick } from '../utils/pendingTargeting.js';
import { defaultCompendium } from '@srd5/data';

function makeCombatant(
  id: string,
  name: string,
  overrides: Partial<PlayerViewCombatant> = {},
): PlayerViewCombatant {
  return {
    id,
    name,
    side: 'party',
    size: 'medium',
    position: { x: 2, y: 2 },
    speedFeet: 30,
    currentHp: 20,
    maxHp: 20,
    tempHp: 0,
    armorClass: 14,
    conditions: [],
    isDead: false,
    isStable: true,
    reactionAvailable: true,
    ...overrides,
  };
}

function makeSummon(
  overrides: Partial<PlayerViewCombatant> = {},
): PlayerViewCombatant {
  return makeCombatant('hand-token', 'Arcane Hand', {
    side: 'party',
    position: { x: 3, y: 3 },
    isSummon: true,
    summonId: 'arcane-hand-token',
    summonSourceName: 'Arcane Hand',
    summonControl: 'commanded',
    untargetable: false,
    summonedByEntityId: 'hero-wizard',
    ...overrides,
  });
}

afterEach(() => {
  cleanup();
});

describe('SRD-904: Client Summon Presentation', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  describe('Canvas token ring', () => {
    it('draws a violet summon ring and ✦S badge, and fades untargetable tokens', () => {
      const circleSpy = vi.spyOn(Graphics.prototype, 'circle');
      try {
        const renderer = new CreatureTokenRenderer(new Container());
        renderer.render({
          combatants: [
            makeSummon(),
            makeSummon({
              id: 'hound-token',
              name: 'Faithful Hound',
              untargetable: true,
              position: { x: 6, y: 6 },
            }),
          ],
          cellSize: 48,
        });

        const hand = renderer.getTokenNode('hand-token');
        const hound = renderer.getTokenNode('hound-token');
        expect(hand).toBeDefined();
        expect(hound).toBeDefined();

        // radius = max(12, 1 * 48 * 0.44); the summon ring is drawn at radius + 2.
        const radius = Math.max(12, 48 * 0.44);
        const ringRadii = circleSpy.mock.calls.map((call) => call[2] as number);
        expect(ringRadii.some((r) => Math.abs(r - (radius + 2)) < 1e-9)).toBe(true);

        const badge = hand!.summonBadgeContainer.children.find(
          (child) => child.label === 'SummonBadge',
        );
        expect(badge).toBeDefined();
        const badgeText = badge!.children.find(
          (child) => child.label === 'SummonBadgeText',
        );
        expect((badgeText as { text?: string } | undefined)?.text).toContain('✦S');

        expect(hand!.container.alpha).toBe(1);
        expect(hound!.container.alpha).toBeCloseTo(0.6, 5);
      } finally {
        circleSpy.mockRestore();
      }
    });

    it('does not render summon decorations on ordinary creatures', () => {
      const renderer = new CreatureTokenRenderer(new Container());
      renderer.render({
        combatants: [makeCombatant('hero-fighter', 'Valeros')],
        cellSize: 48,
      });
      const node = renderer.getTokenNode('hero-fighter');
      expect(node?.summonBadgeContainer.visible).toBe(false);
      expect(node?.container.alpha).toBe(1);
    });
  });

  describe('Medallion summon chip', () => {
    it('shows the ✦ Summoned chip with the source spell name', () => {
      render(<CombatantMedallion combatant={makeSummon()} />);

      const chip = screen.getByTestId('medallion-summon-chip');
      expect(chip.textContent).toContain('✦ Summoned');
      expect(chip.textContent).toContain('Arcane Hand');
      expect(screen.getByTestId('hotbar-active-hero-name').textContent).toContain(
        'Arcane Hand',
      );
    });

    it('does not show the chip for non-summons', () => {
      render(<CombatantMedallion combatant={makeCombatant('hero', 'Valeros')} />);
      expect(screen.queryByTestId('medallion-summon-chip')).toBeNull();
    });
  });

  describe('Hotbar switching', () => {
    it('switches to the summon tab and exposes commanded actions', () => {
      const onUseSummonAction = vi.fn();
      const summon = makeSummon({
        summonActions: [
          {
            id: 'clenched-fist',
            name: 'Clenched Fist',
            description: '+spellAttack, 4d6 force damage.',
          },
        ],
      });

      render(
        <ActionHotbar
          activeCombatant={summon}
          turnBudget={{ action: 1, bonusAction: 1 } as never}
          combatants={{ [summon.id]: summon }}
          isPlayerControlled
          onUseSummonAction={onUseSummonAction}
        />,
      );

      expect(screen.getByTestId('hotbar-tab-summon')).toBeDefined();
      expect(screen.getByTestId('hotbar-panel-summon')).toBeDefined();
      expect(screen.getByTestId('hotbar-summon-source').textContent).toContain(
        'Arcane Hand',
      );
      fireEvent.click(screen.getByTestId('summon-action-btn-clenched-fist'));
      expect(onUseSummonAction).toHaveBeenCalledWith('clenched-fist');
    });

    it('offers a dismiss action for autonomous summons owned by the active caster', () => {
      const onDismissSummon = vi.fn();
      const caster = makeCombatant('hero-wizard', 'Ezren');
      const hound = makeSummon({
        id: 'hound-token',
        name: 'Faithful Hound',
        summonSourceName: 'Faithful Hound',
        summonControl: 'autonomous',
        summonDismissible: true,
        untargetable: true,
      });

      render(
        <ActionHotbar
          activeCombatant={caster}
          turnBudget={{ action: 1, bonusAction: 1 } as never}
          combatants={{ [caster.id]: caster, [hound.id]: hound }}
          isPlayerControlled
          onDismissSummon={onDismissSummon}
        />,
      );

      fireEvent.click(screen.getByTestId('hotbar-tab-summon'));
      fireEvent.click(screen.getByTestId(`summon-dismiss-btn-${hound.id}`));
      expect(onDismissSummon).toHaveBeenCalledWith(
        expect.objectContaining({ id: hound.id }),
      );
    });

    it('keeps the hotbar hot for a commanded summon via transitive caster control', () => {
      const caster = makeCombatant('hero-wizard', 'Ezren');
      const summon = makeSummon({ summonControl: 'commanded' });
      const viewState: PlayerViewState = {
        playerId: 'player-1',
        mode: 'combat',
        grid: { width: 10, height: 10, cells: [] },
        party: { [caster.id]: caster },
        combatants: { [caster.id]: caster, [summon.id]: summon },
        props: [],
        combat: {
          encounterId: 'enc-summon-test',
          round: 1,
          phase: 'active_turn',
          initiativeOrder: [
            { entityId: summon.id, initiative: 20, isVisible: true },
          ] satisfies PlayerViewInitiativeEntry[],
          activeCombatantId: summon.id,
          turnBudget: {
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
          },
          outcome: 'in_progress',
        },
      };

      render(
        <TacticalCombatHud
          viewState={viewState}
          compendium={defaultCompendium}
          // A host's coarse side check says "not controlled"; summon ownership wins.
          isPlayerControlled={false}
        />,
      );

      expect(screen.getByTestId('initiative-summon-badge')).toBeDefined();
      expect(screen.getByTestId('medallion-summon-chip').textContent).toContain(
        'Arcane Hand',
      );
      expect(
        (screen.getByTestId('hotbar-end-turn-btn') as HTMLButtonElement).disabled,
      ).toBe(false);
    });
  });

  describe('Targeting exclusion', () => {
    const spell = defaultCompendium.spells.find((s) => s.id === 'fire-bolt')!;

    it('does not auto-target an untargetable summon as the nearest enemy', () => {
      const caster = makeCombatant('hero-wizard', 'Ezren');
      const hound = makeSummon({
        id: 'hound-token',
        name: 'Faithful Hound',
        side: 'monster',
        untargetable: true,
        position: { x: 3, y: 2 },
      });
      const goblin = makeCombatant('goblin-1', 'Goblin', {
        side: 'monster',
        position: { x: 4, y: 2 },
      });

      const result = resolveSpellTargets({
        spell,
        caster,
        combatants: {
          [caster.id]: caster,
          [hound.id]: hound,
          [goblin.id]: goblin,
        },
      });

      expect(result.targetIds).toEqual([goblin.id]);
    });

    it('rejects untargetable summons in explicit and pending target picks', () => {
      const caster = makeCombatant('hero-wizard', 'Ezren');
      const hound = makeSummon({
        id: 'hound-token',
        name: 'Faithful Hound',
        side: 'monster',
        untargetable: true,
        position: { x: 3, y: 2 },
      });
      const combatants = { [caster.id]: caster, [hound.id]: hound };

      const resolved = resolveSpellTargets({
        spell,
        caster,
        combatants,
        selectedCombatantId: hound.id,
      });
      expect(resolved.targetIds).toEqual([]);
      expect(resolved.errorFeedback).toContain('cannot be targeted');

      const pick = validateTargetPick(
        {
          kind: 'single',
          label: 'Fire Bolt',
          spellId: spell.id,
          disposition: 'hostile',
          rangeFeet: 120,
          picked: [],
        } as never,
        hound,
        caster,
        combatants,
      );
      expect(pick.ok).toBe(false);
      expect(pick.error).toContain('cannot be targeted');
    });

    it('keeps harmable summons targetable', () => {
      const caster = makeCombatant('hero-wizard', 'Ezren');
      const hand = makeSummon({ side: 'monster', untargetable: false });
      const result = resolveSpellTargets({
        spell,
        caster,
        combatants: { [caster.id]: caster, [hand.id]: hand },
      });
      expect(result.targetIds).toEqual([hand.id]);
    });
  });
});
