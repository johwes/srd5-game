import { defaultCompendium } from '@srd5/data';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EntityDetailView } from '../components/compendium/EntityDetailView.js';
import {
  getRarityBadgeClass,
  getRarityBorderClass,
  getRarityTextClass,
  getItemRarityForMagicItem,
  normalizeItemRarity,
  formatRarityLabel,
  ITEM_RARITY_ORDER,
} from '../components/inventory/itemRarity.js';
import {
  hasRawTemplateVars,
  summarizeItemAbility,
  summarizeItemMechanics,
  summarizeItemModifier,
} from '../components/inventory/itemEffectSummary.js';
import { InventoryItemRow } from '../components/inventory/InventoryItemRow.js';
import { ItemTooltipCard } from '../components/inventory/ItemTooltipCard.js';

afterEach(() => {
  cleanup();
});

describe('SRD-1302: rarity visual language', () => {
  it('covers all six rarities with distinct border/text/badge classes', () => {
    expect(ITEM_RARITY_ORDER).toEqual([
      'common',
      'uncommon',
      'rare',
      'very_rare',
      'legendary',
      'artifact',
    ]);
    const borders = new Set(ITEM_RARITY_ORDER.map(getRarityBorderClass));
    expect(borders.size).toBe(6);
    expect(getRarityBorderClass('common')).toContain('slate-700');
    expect(getRarityBorderClass('uncommon')).toContain('emerald-500/60');
    expect(getRarityBorderClass('rare')).toContain('sky-400/70');
    expect(getRarityBorderClass('very_rare')).toContain('purple-400/70');
    expect(getRarityBorderClass('legendary')).toContain('amber-400');
    expect(getRarityBorderClass('artifact')).toContain('red-400');
    expect(getRarityBorderClass('artifact')).toContain('animate-pulse');

    expect(getRarityTextClass('common')).toContain('slate-300');
    expect(getRarityTextClass('uncommon')).toContain('emerald-300');
    expect(getRarityTextClass('rare')).toContain('sky-300');
    expect(getRarityTextClass('very_rare')).toContain('purple-300');
    expect(getRarityTextClass('legendary')).toContain('amber-300');
    expect(getRarityTextClass('artifact')).toContain('red-300');

    expect(getRarityBadgeClass('legendary')).toContain('amber');
    expect(formatRarityLabel('very_rare')).toBe('Very Rare');
  });

  it('normalizes rarity strings and defaults mundane equipment to common', () => {
    expect(normalizeItemRarity(undefined)).toBe('common');
    expect(normalizeItemRarity('Very Rare')).toBe('very_rare');
    expect(normalizeItemRarity('very-rare')).toBe('very_rare');
    expect(normalizeItemRarity('LEGENDARY')).toBe('legendary');
    expect(normalizeItemRarity('bogus')).toBe('common');
    expect(getItemRarityForMagicItem(null)).toBe('common');
    expect(getItemRarityForMagicItem(undefined)).toBe('common');
    expect(getItemRarityForMagicItem({ rarity: 'rare' })).toBe('rare');
  });
});

describe('SRD-1302: item effect summarizer', () => {
  it('summarizes every modifier type without raw template vars', () => {
    const lines = [
      summarizeItemModifier({ type: 'flat_bonus', target: 'ac', value: 1 } as never),
      summarizeItemModifier({ type: 'flat_bonus', target: 'melee_attack', value: 2 } as never),
      summarizeItemModifier({ type: 'ability_score', ability: 'str', bonus: 2 } as never),
      summarizeItemModifier({ type: 'set_ability_minimum', ability: 'con', minimum: 19 } as never),
      summarizeItemModifier({ type: 'roll_mode', mode: 'advantage', target: 'skill:stealth' } as never),
      summarizeItemModifier({ type: 'damage_mitigation', mitigation: 'resistance', damageTypes: ['fire'] } as never),
      summarizeItemModifier({ type: 'condition_immunity', conditions: ['poisoned'] } as never),
      summarizeItemModifier({ type: 'ac_calculation', id: 'x', formula: '13 + @dexMod', allowsShield: true, requiresNoArmor: false } as never),
      summarizeItemModifier({ type: 'die_manipulation', rule: 'halfling_lucky' } as never),
      summarizeItemModifier({ type: 'extra_attack', attacksPerAction: 2 } as never),
      summarizeItemModifier({ type: 'grant_resource', resourceId: 'r', name: 'Rage', maxFormula: '2', recovery: 'long_rest' } as never),
    ];
    expect(lines[0]).toContain('+1');
    expect(lines[0]).toContain('AC');
    expect(lines[3]).toContain('19');
    expect(lines[4]).toMatch(/Advantage/i);
    expect(lines[5]).toMatch(/Resistance/i);
    for (const line of lines) {
      expect(hasRawTemplateVars(line)).toBe(false);
    }
  });

  it('summarizes activated abilities (heal + damage) without raw template vars', () => {
    const potion = defaultCompendium.getMagicItem('potion-of-greater-healing')!;
    expect(potion.activatedAbilities?.length).toBeGreaterThan(0);
    const line = summarizeItemAbility(potion.activatedAbilities![0]!);
    expect(line).toMatch(/Restore/i);
    expect(line).toContain('4d4 + 4');
    expect(hasRawTemplateVars(line)).toBe(false);

    const wand = defaultCompendium.getMagicItem('wand-of-magic-missiles')!;
    const wandLine = summarizeItemAbility(wand.activatedAbilities![0]!);
    expect(wandLine).toMatch(/Deal/i);
    expect(hasRawTemplateVars(wandLine)).toBe(false);
  });

  it('summarizes every bundled magic item + gear with zero template leaks', () => {
    for (const mi of defaultCompendium.magicItems) {
      const lines = summarizeItemMechanics(mi.modifiers, mi.activatedAbilities);
      for (const line of lines) {
        expect(hasRawTemplateVars(line), `${mi.id}: ${line}`).toBe(false);
      }
    }
    for (const eq of defaultCompendium.equipment) {
      if (eq.kind !== 'gear') continue;
      const lines = summarizeItemMechanics(eq.modifiers, eq.activatedAbilities);
      for (const line of lines) {
        expect(hasRawTemplateVars(line), `${eq.id}: ${line}`).toBe(false);
      }
    }
  });
});

describe('SRD-1302: ItemTooltipCard', () => {
  it('renders name, rarity, description, effect, charges, attunement, cost/weight', () => {
    const wand = defaultCompendium.getMagicItem('wand-of-magic-missiles')!;
    render(
      <div className="group relative">
        <ItemTooltipCard
          itemId={wand.id}
          name={wand.name}
          rarity="uncommon"
          categoryLabel="Wand"
          description={wand.description}
          modifiers={wand.modifiers}
          activatedAbilities={wand.activatedAbilities}
          charges={{ max: 7, remaining: 3, rechargeFormula: '1d6 + 1', rechargeTiming: 'dawn' }}
          requiresAttunement={false}
          attunementState="n/a"
          costLabel="500 gp"
          weightLabel="1 lb."
          testIdPrefix="item"
        />
      </div>,
    );
    const tip = screen.getByTestId('item-tooltip-wand-of-magic-missiles');
    expect(tip.getAttribute('role')).toBe('tooltip');
    expect(tip.textContent).toContain('Wand of Magic Missiles');
    expect(screen.getByTestId('item-tooltip-wand-of-magic-missiles-rarity').textContent).toContain(
      'Uncommon',
    );
    expect(screen.getByTestId('item-tooltip-wand-of-magic-missiles-description').textContent).toContain(
      'holding it',
    );
    expect(screen.getByTestId('item-tooltip-wand-of-magic-missiles-effect').textContent).toContain(
      'Game effect:',
    );
    expect(screen.getByTestId('item-tooltip-wand-of-magic-missiles-charges').textContent).toContain(
      '3/7 charges',
    );
    expect(screen.getByTestId('item-tooltip-wand-of-magic-missiles-cost').textContent).toContain(
      '500 gp',
    );
    expect(hasRawTemplateVars(tip.textContent ?? '')).toBe(false);
  });

  it('renders attunement state and legendary sparkle', () => {
    const armor = defaultCompendium.getMagicItem('armor-plus-3')!;
    render(
      <div className="group relative">
        <ItemTooltipCard
          itemId={armor.id}
          name={armor.name}
          rarity="legendary"
          categoryLabel="Armor"
          description={armor.description}
          modifiers={armor.modifiers}
          requiresAttunement={false}
          attunementState="n/a"
          testIdPrefix="item"
        />
      </div>,
    );
    const tip = screen.getByTestId('item-tooltip-armor-plus-3');
    expect(screen.getByTestId('item-tooltip-armor-plus-3-rarity').textContent).toContain('✨');
    expect(screen.getByTestId('item-tooltip-armor-plus-3-effect').textContent).toContain('+3');
    expect(hasRawTemplateVars(tip.textContent ?? '')).toBe(false);
  });
});

describe('SRD-1302: InventoryItemRow surfaces', () => {
  it('renders a magic row with icon, rarity badge, and tooltip', () => {
    render(
      <InventoryItemRow
        itemId="cloak-of-protection"
        compendium={defaultCompendium}
        testId="loot-row-cloak"
      />,
    );
    const row = screen.getByTestId('loot-row-cloak');
    expect(row.className).toContain('emerald-500/60');
    expect(screen.getByTestId('loot-row-cloak-icon-cloak-of-protection')).toBeDefined();
    expect(screen.getByTestId('loot-row-cloak-rarity').textContent).toContain('Uncommon');
    const tip = screen.getByTestId('loot-row-cloak-tooltip-cloak-of-protection');
    expect(tip.getAttribute('role')).toBe('tooltip');
    expect(tip.textContent).toContain('Game effect:');
    expect(hasRawTemplateVars(tip.textContent ?? '')).toBe(false);
  });

  it('renders a mundane row as common with cost/weight in the tooltip', () => {
    render(
      <InventoryItemRow itemId="longsword" compendium={defaultCompendium} testId="shop-row-sword" />,
    );
    const row = screen.getByTestId('shop-row-sword');
    expect(row.className).toContain('slate-700');
    const tip = screen.getByTestId('shop-row-sword-tooltip-longsword');
    expect(tip.textContent).not.toMatch(/@\w/);
  });
});

describe('SRD-1302: compendium detail renders modifiers + activated abilities', () => {
  it('magic-item detail lists modifiers, abilities, and charges', () => {
    const wand = defaultCompendium.getMagicItem('wand-of-magic-missiles')!;
    render(
      <EntityDetailView
        entity={{ kind: 'magic_item', data: wand }}
        compendium={defaultCompendium}
      />,
    );
    expect(screen.getByTestId('compendium-detail-magic-item')).toBeDefined();
    expect(screen.getByTestId('compendium-detail-magic-item-charges').textContent).toContain('7');
    const abilities = screen.getByTestId('compendium-detail-magic-item-abilities');
    expect(abilities.textContent).toContain('Magic Missile');
    expect(abilities.textContent).not.toMatch(/@\w/);
  });

  it('potion detail renders its drink ability with the heal formula', () => {
    const potion = defaultCompendium.getMagicItem('potion-of-greater-healing')!;
    render(
      <EntityDetailView
        entity={{ kind: 'magic_item', data: potion }}
        compendium={defaultCompendium}
      />,
    );
    const abilities = screen.getByTestId('compendium-detail-magic-item-abilities');
    expect(abilities.textContent).toContain('4d4 + 4');
  });

  it('gear detail renders mechanics when present', () => {
    const acid = defaultCompendium.getEquipment('acid-vial')!;
    expect(acid.kind).toBe('gear');
    render(
      <EntityDetailView entity={{ kind: 'equipment', data: acid }} compendium={defaultCompendium} />,
    );
    expect(screen.getByTestId('compendium-detail-equipment-mechanics')).toBeDefined();
    expect(screen.getByTestId('compendium-detail-equipment-abilities').textContent).toContain(
      '2d6',
    );
  });
});
