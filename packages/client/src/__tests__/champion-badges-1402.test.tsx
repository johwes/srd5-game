import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Container, Graphics } from 'pixi.js';
import type { PlayerViewCombatant } from '@srd5/transport';
import { CreatureTokenRenderer } from '../canvas/index.js';
import { CombatantMedallion, CombatLog, InitiativeRibbon } from '../components/combat/index.js';

/**
 * SRD-1402: Champion packs — skull token badge + tooltip + spawn headline.
 * Acceptance: skull badge + origin-tagged hoard visible in UI.
 */

function makeCombatant(
  id: string,
  name: string,
  overrides: Partial<PlayerViewCombatant> = {},
): PlayerViewCombatant {
  return {
    id,
    name,
    side: 'monster',
    size: 'medium',
    position: { x: 2, y: 2 },
    speedFeet: 30,
    currentHp: 11,
    maxHp: 11,
    tempHp: 0,
    armorClass: 15,
    conditions: [],
    isDead: false,
    isStable: false,
    reactionAvailable: true,
    ...overrides,
  };
}

function makeChampion(trait: 'brutal' | 'swift' | 'warded' = 'brutal'): PlayerViewCombatant {
  return makeCombatant('champ-goblin-1', 'Champion Goblin', {
    isChampion: true,
    championTrait: trait,
  });
}

afterEach(() => {
  cleanup();
});

describe('SRD-1402: Champion badges (skull pip + tooltip + headline)', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it('renders the initiative-ribbon skull badge with the trait tooltip', () => {
    const champ = makeChampion('brutal');
    render(
      <InitiativeRibbon
        round={1}
        phase="active_turn"
        initiativeOrder={[{ entityId: champ.id, initiative: 14, isVisible: true }]}
        combatants={{ [champ.id]: champ }}
        activeCombatantId={champ.id}
      />,
    );
    const badge = screen.getByTestId('initiative-champion-badge');
    expect(badge.textContent).toContain('💀');
    expect(badge.getAttribute('title')).toBe('Champion · brutal — +50% damage');
  });

  it('renders the medallion champion chip with the warded tooltip', () => {
    render(<CombatantMedallion combatant={makeChampion('warded')} />);
    const chip = screen.getByTestId('medallion-champion-chip');
    expect(chip.textContent).toContain('Champion');
    expect(chip.textContent).toContain('warded');
    expect(chip.getAttribute('title')).toBe('Champion · warded — +2 AC');
  });

  it('renders the ELITE_SPAWNED combat-log headline (no raw JSON)', () => {
    render(
      <CombatLog
        events={[{ type: 'ELITE_SPAWNED', entityId: 'champ-goblin-1', trait: 'swift' }]}
        combatants={{ 'champ-goblin-1': makeChampion('swift') }}
      />,
    );
    const log = screen.getByTestId('combat-log');
    expect(log.textContent).toContain('Champion (swift) bars the way!');
    expect(log.textContent).toContain('CHAMPION');
    expect(log.textContent).not.toContain('{"type"');
  });

  it('draws the canvas skull badge for champions and none for regulars', () => {
    const circleSpy = vi.spyOn(Graphics.prototype, 'circle');
    try {
      const renderer = new CreatureTokenRenderer(new Container());
      renderer.render({
        combatants: [makeChampion('brutal'), makeCombatant('goblin-2', 'Goblin')],
        cellSize: 48,
        showHpArc: true,
        showConditionBadges: true,
        showFacing: false,
        showNameTags: true,
      });
      // Skull badge draws at least one extra circle beyond the base disc arcs.
      expect(circleSpy).toHaveBeenCalled();
      const nodes = (renderer as unknown as { tokenNodes: Map<string, { championBadgeContainer: Container }> })
        .tokenNodes;
      const champNode = nodes.get('champ-goblin-1');
      const regularNode = nodes.get('goblin-2');
      expect(champNode?.championBadgeContainer.visible).toBe(true);
      expect(champNode?.championBadgeContainer.children.length).toBeGreaterThan(0);
      expect(regularNode?.championBadgeContainer.visible).toBe(false);
    } finally {
      circleSpy.mockRestore();
    }
  });
});
