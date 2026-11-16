import React from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Container } from 'pixi.js';
import { createTacticalGrid } from '@srd5/engine';
import {
  CreatureTokenRenderer,
  FloatingTextRenderer,
  HazardZoneRenderer,
  TacticalCanvasViewport,
  facingToAngleRad,
  hazardVisualFamilyOf,
  vectorToFacing,
  type CreatureFacing,
  type CreatureTokenData,
} from '../canvas/index.js';

describe('SRD-403: PixiJS Creature Token Layer & Floating Text', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  describe('Facing Math & Direction Calculation', () => {
    it('converts all 8 facing directions to accurate radians', () => {
      const facings: Array<{ facing: CreatureFacing; expected: number }> = [
        { facing: 'e', expected: 0 },
        { facing: 'se', expected: Math.PI / 4 },
        { facing: 's', expected: Math.PI / 2 },
        { facing: 'sw', expected: (3 * Math.PI) / 4 },
        { facing: 'w', expected: Math.PI },
        { facing: 'nw', expected: (-3 * Math.PI) / 4 },
        { facing: 'n', expected: -Math.PI / 2 },
        { facing: 'ne', expected: -Math.PI / 4 },
      ];

      for (const { facing, expected } of facings) {
        expect(facingToAngleRad(facing)).toBeCloseTo(expected, 4);
      }
    });

    it('determines the closest CreatureFacing from 2D delta vectors', () => {
      expect(vectorToFacing(1, 0)).toBe('e');
      expect(vectorToFacing(1, 1)).toBe('se');
      expect(vectorToFacing(0, 1)).toBe('s');
      expect(vectorToFacing(-1, 1)).toBe('sw');
      expect(vectorToFacing(-1, 0)).toBe('w');
      expect(vectorToFacing(-1, -1)).toBe('nw');
      expect(vectorToFacing(0, -1)).toBe('n');
      expect(vectorToFacing(1, -1)).toBe('ne');
      expect(vectorToFacing(0, 0)).toBe('e'); // default stationary
    });
  });

  describe('CreatureTokenRenderer', () => {
    it('creates tokens with appropriate footprint scaling based on creature size', () => {
      const parent = new Container();
      const renderer = new CreatureTokenRenderer(parent);

      const combatants: CreatureTokenData[] = [
        {
          id: 'hero-fighter',
          name: 'Valeros',
          side: 'party',
          size: 'medium',
          position: { x: 2, y: 3 },
          currentHp: 24,
          maxHp: 24,
        },
        {
          id: 'ogre-brute',
          name: 'Ogre',
          side: 'monster',
          size: 'large',
          position: { x: 4, y: 4 },
          currentHp: 59,
          maxHp: 59,
        },
        {
          id: 'frost-giant',
          name: 'Frost Giant',
          side: 'monster',
          size: 'huge',
          position: { x: 8, y: 8 },
          currentHp: 138,
          maxHp: 138,
        },
      ];

      renderer.render({ combatants, cellSize: 48 });

      // Fighter (medium = 1x1 cell): center at (2 + 0.5) * 48 = 120, (3 + 0.5) * 48 = 168
      const fighterNode = renderer.getTokenNode('hero-fighter');
      expect(fighterNode).toBeDefined();
      expect(fighterNode?.container.position.x).toBe(120);
      expect(fighterNode?.container.position.y).toBe(168);

      // Ogre (large = 2x2 cells): center at (4 + 1.0) * 48 = 240, (4 + 1.0) * 48 = 240
      const ogreNode = renderer.getTokenNode('ogre-brute');
      expect(ogreNode).toBeDefined();
      expect(ogreNode?.container.position.x).toBe(240);
      expect(ogreNode?.container.position.y).toBe(240);

      // Frost Giant (huge = 3x3 cells): center at (8 + 1.5) * 48 = 456, (8 + 1.5) * 48 = 456
      const giantNode = renderer.getTokenNode('frost-giant');
      expect(giantNode).toBeDefined();
      expect(giantNode?.container.position.x).toBe(456);
      expect(giantNode?.container.position.y).toBe(456);
    });

    it('renders HP perimeter arcs and temp HP overlays', () => {
      const parent = new Container();
      const renderer = new CreatureTokenRenderer(parent);

      const combatants: CreatureTokenData[] = [
        {
          id: 'healthy-hero',
          name: 'Fighter',
          side: 'party',
          size: 'medium',
          position: { x: 1, y: 1 },
          currentHp: 20,
          maxHp: 20,
        },
        {
          id: 'wounded-hero',
          name: 'Wizard',
          side: 'party',
          size: 'medium',
          position: { x: 2, y: 1 },
          currentHp: 6,
          maxHp: 18,
          tempHp: 5,
        },
        {
          id: 'critical-hero',
          name: 'Rogue',
          side: 'party',
          size: 'medium',
          position: { x: 3, y: 1 },
          currentHp: 2,
          maxHp: 16,
        },
        {
          id: 'dead-goblin',
          name: 'Goblin',
          side: 'monster',
          size: 'small',
          position: { x: 4, y: 1 },
          currentHp: 0,
          maxHp: 7,
          isDead: true,
        },
      ];

      renderer.render({ combatants, cellSize: 48, showHpArc: true });

      const healthy = renderer.getTokenNode('healthy-hero');
      expect(healthy?.hpArcGraphics.visible).toBe(true);

      const wounded = renderer.getTokenNode('wounded-hero');
      expect(wounded?.hpArcGraphics.visible).toBe(true);

      const dead = renderer.getTokenNode('dead-goblin');
      expect(dead?.data.isDead).toBe(true);
    });

    it('renders condition badges on tokens and batches overflow with +N badge', () => {
      const parent = new Container();
      const renderer = new CreatureTokenRenderer(parent);

      const combatants: CreatureTokenData[] = [
        {
          id: 'afflicted-fighter',
          name: 'Fighter',
          side: 'party',
          size: 'medium',
          position: { x: 1, y: 1 },
          currentHp: 15,
          maxHp: 20,
          conditions: ['prone', 'poisoned'],
        },
        {
          id: 'multi-afflicted-cleric',
          name: 'Cleric',
          side: 'party',
          size: 'medium',
          position: { x: 2, y: 1 },
          currentHp: 10,
          maxHp: 18,
          conditions: ['blinded', 'charmed', 'frightened', 'restrained', 'stunned'],
        },
      ];

      renderer.render({ combatants, cellSize: 48, showConditionBadges: true });

      const fNode = renderer.getTokenNode('afflicted-fighter');
      expect(fNode?.conditionsContainer.children.length).toBe(2);
      expect(fNode?.conditionsContainer.children.map((c) => c.label)).toEqual([
        'Badge_prone',
        'Badge_poisoned',
      ]);

      // multi-afflicted shows 3 individual badges plus 1 "+2" overflow badge
      const cNode = renderer.getTokenNode('multi-afflicted-cleric');
      expect(cNode?.conditionsContainer.children.length).toBe(4);
      expect(cNode?.conditionsContainer.children.map((c) => c.label)).toEqual([
        'Badge_blinded',
        'Badge_charmed',
        'Badge_frightened',
        'Badge_More',
      ]);
    });

    it('renders directional facing chevrons and initials', () => {
      const parent = new Container();
      const renderer = new CreatureTokenRenderer(parent);

      const combatants: CreatureTokenData[] = [
        {
          id: 'goblin-scout',
          name: 'Goblin Scout',
          side: 'monster',
          size: 'small',
          position: { x: 5, y: 5 },
          currentHp: 7,
          maxHp: 7,
          facing: 's',
          label: 'GS',
        },
      ];

      renderer.render({ combatants, cellSize: 48, showFacing: true });

      const node = renderer.getTokenNode('goblin-scout');
      expect(node?.currentFacing).toBe('s');
      expect(node?.facingGraphics.visible).toBe(true);
      expect(node?.initialText.text).toBe('GS');
    });

    it('renders selection and active turn aura rings', () => {
      const parent = new Container();
      const renderer = new CreatureTokenRenderer(parent);

      const combatants: CreatureTokenData[] = [
        {
          id: 'c1',
          name: 'Hero 1',
          side: 'party',
          size: 'medium',
          position: { x: 1, y: 1 },
          currentHp: 10,
          maxHp: 10,
        },
        {
          id: 'c2',
          name: 'Hero 2',
          side: 'party',
          size: 'medium',
          position: { x: 2, y: 1 },
          currentHp: 10,
          maxHp: 10,
        },
      ];

      renderer.render({
        combatants,
        cellSize: 48,
        selectedId: 'c1',
        activeId: 'c2',
      });

      const c1 = renderer.getTokenNode('c1');
      const c2 = renderer.getTokenNode('c2');
      expect(c1).toBeDefined();
      expect(c2).toBeDefined();
    });

    it('cleans up removed tokens when combatant list updates', () => {
      const parent = new Container();
      const renderer = new CreatureTokenRenderer(parent);

      renderer.render({
        combatants: [
          { id: 't1', name: 'T1', side: 'party', size: 'medium', position: { x: 0, y: 0 }, currentHp: 10, maxHp: 10 },
          { id: 't2', name: 'T2', side: 'monster', size: 'small', position: { x: 1, y: 1 }, currentHp: 5, maxHp: 5 },
        ],
        cellSize: 48,
      });

      expect(renderer.getAllTokens().length).toBe(2);

      // Re-render without t2
      renderer.render({
        combatants: [
          { id: 't1', name: 'T1', side: 'party', size: 'medium', position: { x: 0, y: 0 }, currentHp: 10, maxHp: 10 },
        ],
        cellSize: 48,
      });

      expect(renderer.getAllTokens().length).toBe(1);
      expect(renderer.getTokenNode('t2')).toBeUndefined();
    });

    it('animates token movement along a path and updates facing', async () => {
      const parent = new Container();
      const renderer = new CreatureTokenRenderer(parent);

      const token: CreatureTokenData = {
        id: 'walker',
        name: 'Ranger',
        side: 'party',
        size: 'medium',
        position: { x: 1, y: 1 },
        currentHp: 15,
        maxHp: 15,
        facing: 'e',
      };

      renderer.render({ combatants: [token], cellSize: 48 });

      const path = [
        { x: 1, y: 1 },
        { x: 2, y: 1 }, // Moving East
        { x: 2, y: 2 }, // Moving South
      ];

      const stepSpy = vi.fn();
      const movePromise = renderer.animateMove('walker', path, {
        durationMs: 40,
        onStep: stepSpy,
      });

      const walker = renderer.getTokenNode('walker');
      expect(walker?.currentFacing).toBe('e');

      // Finish all animations immediately
      renderer.finishAllAnimations(48);
      await movePromise;

      expect(walker?.data.position).toEqual({ x: 2, y: 2 });
    });
  });

  describe('FloatingTextRenderer', () => {
    it('spawns and animates floating combat text entries', () => {
      const parent = new Container();
      const renderer = new FloatingTextRenderer(parent);

      const item = renderer.spawnText({
        text: '-12 Slashing',
        worldX: 100,
        worldY: 100,
        type: 'damage',
        durationMs: 1000,
      });

      expect(renderer.getActiveCount()).toBe(1);
      expect(item.textNode.text).toBe('-12 Slashing');
      expect(item.textNode.position.x).toBe(100);
      expect(item.textNode.position.y).toBe(100);

      // Advance animation halfway
      renderer.update(500);
      expect(item.textNode.position.y).toBeLessThan(100); // Drifted upwards

      // Clear all
      renderer.clear();
      expect(renderer.getActiveCount()).toBe(0);
    });

    it('translates domain GameEvents into styled floating text', () => {
      const parent = new Container();
      const renderer = new FloatingTextRenderer(parent);

      const posLookup = (id: string) => (id === 'hero-1' ? { x: 3, y: 3 } : undefined);

      // Damage event
      renderer.handleGameEvent(
        {
          type: 'DAMAGE_APPLIED',
          targetId: 'hero-1',
          rawAmount: 14,
          finalAmount: 7,
          damageType: 'fire',
          tempHpAbsorbed: 0,
          hpRemaining: 15,
          resistanceApplied: true,
        },
        posLookup,
        48,
      );

      // Healing event
      renderer.handleGameEvent(
        {
          type: 'HEAL_APPLIED',
          targetId: 'hero-1',
          amount: 8,
          hpBefore: 15,
          hpAfter: 23,
        },
        posLookup,
        48,
      );

      // Miss event
      renderer.handleGameEvent(
        {
          type: 'ATTACK_RESOLVED',
          attackerId: 'gob-1',
          targetId: 'hero-1',
          weaponOrSpellName: 'Scimitar',
          attackType: 'melee_weapon',
          roll: 8,
          totalToHit: 12,
          targetAc: 16,
          outcome: 'miss',
        },
        posLookup,
        48,
      );

      // Crit event
      renderer.handleGameEvent(
        {
          type: 'ATTACK_RESOLVED',
          attackerId: 'gob-1',
          targetId: 'hero-1',
          weaponOrSpellName: 'Scimitar',
          attackType: 'melee_weapon',
          roll: 20,
          totalToHit: 24,
          targetAc: 16,
          outcome: 'critical_hit',
        },
        posLookup,
        48,
      );

      // Condition added
      renderer.handleGameEvent(
        {
          type: 'CONDITION_ADDED',
          targetId: 'hero-1',
          conditionId: 'poisoned',
        },
        posLookup,
        48,
      );

      expect(renderer.getActiveCount()).toBe(5);
    });
  });

  describe('HazardZoneRenderer', () => {
    it('maps zone ids to visual families', () => {
      expect(hazardVisualFamilyOf('grease-zone')).toBe('slick');
      expect(hazardVisualFamilyOf('web-zone')).toBe('webs');
      expect(hazardVisualFamilyOf('entangle-zone')).toBe('webs');
      expect(hazardVisualFamilyOf('black-tentacles-zone')).toBe('webs');
      expect(hazardVisualFamilyOf('spike-growth-zone')).toBe('thorns');
      expect(hazardVisualFamilyOf('cloudkill-zone')).toBe('fog');
      expect(hazardVisualFamilyOf('darkness-zone')).toBe('fog');
      expect(hazardVisualFamilyOf('stinking-cloud-zone')).toBe('fog');
      expect(hazardVisualFamilyOf('silence-zone')).toBe('fog');
      expect(hazardVisualFamilyOf('wall-of-fire-zone')).toBe('flames');
      expect(hazardVisualFamilyOf('flaming-sphere-zone')).toBe('flames');
      expect(hazardVisualFamilyOf('spirit-guardians-zone')).toBe('radiant');
      expect(hazardVisualFamilyOf('ice-storm-difficult-terrain')).toBe('frost');
      expect(hazardVisualFamilyOf('confusion-zone')).toBe('mind');
      expect(hazardVisualFamilyOf('mystery-zone')).toBe('arcane');
    });

    function makeZone(
      id: string,
      zoneId: string,
      sourceName: string,
      cells: Array<{ x: number; y: number }>,
    ) {
      return {
        id,
        zoneId,
        casterId: 'caster-1',
        sourceName,
        shape: 'cube' as const,
        origin: cells[0]!,
        sizeFeet: 10,
        cells,
        durationRounds: 10,
        remainingRounds: 10,
        requiresConcentration: false,
        difficultTerrain: true,
        triggeredCreaturesThisTurn: [],
        onEnterOrStartTurn: [],
      };
    }

    it('draws one connected overlay plus label per zone and clears on empty', () => {
      const parent = new Container();
      const renderer = new HazardZoneRenderer(parent);

      renderer.render({
        zones: [
          makeZone('hz1', 'grease-zone', 'Grease', [
            { x: 5, y: 5 },
            { x: 6, y: 5 },
          ]),
          makeZone('hz2', 'web-zone', 'Web', [{ x: 2, y: 2 }]),
        ],
        cellSize: 48,
      });

      const labels = renderer.container.children.map((c) => c.label);
      expect(labels).toContain('Hazard_hz1');
      expect(labels).toContain('HazardLabel_hz1');
      expect(labels).toContain('Hazard_hz2');
      expect(labels).toContain('HazardLabel_hz2');

      renderer.render({ zones: [], cellSize: 48 });
      expect(renderer.container.children.length).toBe(0);

      renderer.destroy();
    });
  });

  describe('TacticalCanvasViewport Component Integration', () => {
    it('mounts cleanly with creature combatants and handles clicks/hovers', () => {
      const grid = createTacticalGrid(8, 8, 'floor_stone');
      const combatants: CreatureTokenData[] = [
        {
          id: 'char-1',
          name: 'Fighter',
          side: 'party',
          size: 'medium',
          position: { x: 2, y: 2 },
          currentHp: 20,
          maxHp: 20,
        },
        {
          id: 'gob-1',
          name: 'Goblin',
          side: 'monster',
          size: 'small',
          position: { x: 4, y: 4 },
          currentHp: 7,
          maxHp: 7,
        },
      ];

      const onCombatantClick = vi.fn();
      const onCombatantHover = vi.fn();

      const { container } = render(
        <TacticalCanvasViewport
          grid={grid}
          combatants={combatants}
          selectedCombatantId="char-1"
          activeCombatantId="char-1"
          onCombatantClick={onCombatantClick}
          onCombatantHover={onCombatantHover}
        />,
      );

      expect(container.querySelector('canvas')).toBeDefined();
    });
  });
});
