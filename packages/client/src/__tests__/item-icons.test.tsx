import fs from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { defaultCompendium } from '@srd5/data';
import {
  FALLBACK_ICONS,
  getItemIcon,
  getItemIconClass,
  isItemIconRegistered,
  ITEM_ICON_REGISTRY,
  resetItemIconWarnings,
  resolveItemIconUrl,
} from '../components/inventory/itemIcons.js';
import { ItemIcon } from '../components/inventory/ItemIcon.js';
import { TitleMenuCreditsModal } from '../components/title/TitleMenuCreditsModal.js';

/** Read the bundled RPG Awesome CSS straight from node_modules (offline). */
const rpgRequire = createRequire(import.meta.url);
const rpgAwesomeCss = fs.readFileSync(
  rpgRequire.resolve('rpg-awesome/css/rpg-awesome.min.css'),
  'utf8',
);

const FALLBACKS = ['weapon', 'armor', 'potion', 'gear', 'tool'] as const;

describe('SRD-1301: Licensed item-icon registry (RPG Awesome + game-icons gaps)', () => {
  it('covers 100% of equipment.json + magic-items.json ids with no extras', () => {
    const expected = new Set<string>([
      ...defaultCompendium.equipment.map((e) => e.id),
      ...defaultCompendium.magicItems.map((m) => m.id),
    ]);
    expect(expected.size).toBeGreaterThan(190);

    const registered = new Set(Object.keys(ITEM_ICON_REGISTRY));
    const missing = [...expected].filter((id) => !registered.has(id));
    const extra = [...registered].filter((id) => !expected.has(id));

    expect(missing).toEqual([]);
    expect(extra).toEqual([]);

    for (const id of expected) {
      expect(isItemIconRegistered(id)).toBe(true);
      const ref = getItemIcon(id);
      expect(FALLBACKS).toContain(ref.fallback);
      expect(ref.ra ?? ref.svg).toBeDefined();
      if (ref.ra) expect(ref.ra).toMatch(/^[a-z0-9-]+$/);
      if (ref.svg) expect(ref.svg).toMatch(/^[a-z0-9-]+\.svg$/);
    }
  });

  it('bundles every referenced RPG Awesome glyph offline (no tofu boxes)', () => {
    expect(typeof rpgAwesomeCss).toBe('string');
    expect(rpgAwesomeCss.length).toBeGreaterThan(10_000);

    const suffixes = new Set<string>();
    for (const ref of Object.values(ITEM_ICON_REGISTRY)) {
      if (ref.ra) suffixes.add(ref.ra);
    }
    for (const ref of Object.values(FALLBACK_ICONS)) suffixes.add(ref.ra);

    expect(suffixes.size).toBeGreaterThan(60);
    const missing = [...suffixes].filter((s) => !rpgAwesomeCss.includes(`ra-${s}`));
    expect(missing).toEqual([]);
  });

  it('builds valid RA classes and vendored SVG urls', () => {
    expect(getItemIconClass('longsword')).toBe('ra ra-sword');
    expect(getItemIconClass('potion-of-healing')).toBe('ra ra-potion');
    expect(getItemIconClass('shield')).toBe('ra ra-shield');

    expect(resolveItemIconUrl('potion-of-healing')).toBe('/assets/game-icons/health-potion.svg');
    expect(resolveItemIconUrl('longsword')).toBe('/assets/game-icons/broadsword.svg');
    expect(resolveItemIconUrl('scroll-of-fireball')).toBe('/assets/game-icons/scroll-unfurled.svg');
  });

  it('falls back to the gear glyph for unknown ids, warning exactly once', () => {
    resetItemIconWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const first = getItemIcon('not-a-real-item');
      expect(first).toEqual(FALLBACK_ICONS.gear);
      expect(getItemIcon('not-a-real-item')).toEqual(FALLBACK_ICONS.gear);
      expect(warn).toHaveBeenCalledTimes(1);

      // Helpers never produce broken output for unknown ids either.
      expect(getItemIconClass('not-a-real-item')).toBe('ra ra-ammo-bag');
      expect(resolveItemIconUrl('not-a-real-item')).toBe('/assets/game-icons/chest.svg');
    } finally {
      warn.mockRestore();
      resetItemIconWarnings();
    }
  });

  it('renders the RA font glyph by default (primary system)', () => {
    render(<ItemIcon itemId="longsword" size={24} />);
    const glyph = screen.getByTestId('item-icon-longsword');
    expect(glyph.tagName.toLowerCase()).toBe('i');
    expect(glyph.className).toContain('ra-sword');
    expect(glyph.getAttribute('data-icon')).toBe('sword');
  });

  it('renders the vendored SVG on request and degrades to RA on load failure', () => {
    const { rerender } = render(<ItemIcon itemId="potion-of-healing" preferSvg />);
    const img = screen.getByTestId('item-icon-potion-of-healing');
    expect(img.tagName.toLowerCase()).toBe('img');
    expect(img.getAttribute('src')).toBe('/assets/game-icons/health-potion.svg');

    fireEvent.error(img);
    rerender(<ItemIcon itemId="potion-of-healing" preferSvg />);
    const fallback = screen.getByTestId('item-icon-potion-of-healing');
    expect(fallback.tagName.toLowerCase()).toBe('i');
    expect(fallback.className).toContain('ra-potion');
  });

  it('renders unknown ids as the gear fallback glyph (no broken image)', () => {
    resetItemIconWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      render(<ItemIcon itemId="mystery-box-xyz" preferSvg />);
      const img = screen.getByTestId('item-icon-mystery-box-xyz');
      expect(img.tagName.toLowerCase()).toBe('img');
      expect(img.getAttribute('src')).toBe('/assets/game-icons/chest.svg');

      fireEvent.error(img);
      const fallback = screen.getByTestId('item-icon-mystery-box-xyz');
      expect(fallback.tagName.toLowerCase()).toBe('i');
      expect(fallback.className).toContain('ra-ammo-bag');
    } finally {
      warn.mockRestore();
      resetItemIconWarnings();
    }
  });

  it('credits screen carries the item-icons attribution line', () => {
    render(<TitleMenuCreditsModal isOpen={true} onClose={() => {}} />);
    const line = screen.getByTestId('credits-item-icons-line');
    expect(line.textContent).toMatch(/game-icons\.net.*CC BY 3\.0/i);
    expect(line.textContent).toMatch(/RPG Awesome.*OFL\/MIT/i);
    expect(line.textContent).toMatch(/Kenney\.nl.*CC0/i);
    expect(screen.getAllByText(/RPG Awesome/i).length).toBeGreaterThanOrEqual(2);
  });
});
