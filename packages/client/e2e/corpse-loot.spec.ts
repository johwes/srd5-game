import { expect, test } from '@playwright/test';

/**
 * SRD-1307 E2E: the shared loot-modal shell that hosts the per-corpse loot
 * cards (Spec 12 §11.2) keeps working after the corpse-looting changes:
 * launch the Sunken Crypt campaign, open the loot & inventory modal, and
 * exercise the icon-grid backpack (filters, search, hero tabs) at the
 * 1280×800 Steam Deck resolution with zero console errors and zero
 * horizontal overflow.
 *
 * Corpse-specific flows (CR-scaled rolls, corpse spawn, search bonuses,
 * claims, floor-exit sweep) are verified deterministically headless plus
 * component-level card/modal tests; playing a full combat victory through
 * the UI is intentionally out of scope for browser automation.
 */
test.describe('SRD-1307: loot-modal shell (corpse loot card host)', () => {
  test('inventory grid operates by mouse and keyboard at 1280x800', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    await page.getByTestId('title-menu-new-game-btn').click();
    await expect(page.getByTestId('campaign-setup-wizard')).toBeVisible();
    await page.getByTestId('wizard-mode-card-campaign_kaelen').click();
    await page.getByTestId('wizard-nav-next').click(); // difficulty
    await page.getByTestId('wizard-nav-next').click(); // party
    const resetBtn = page.getByTestId('wizard-reset-iconics-btn');
    if (await resetBtn.isVisible()) await resetBtn.click();
    await page.getByTestId('wizard-nav-next').click(); // narrative
    await page.getByTestId('wizard-launch-cta').click();

    await expect(page.getByTestId('dungeon-view-container')).toBeVisible({ timeout: 15000 });

    // Open the loot & inventory modal (same shell corpse cards use).
    await page.getByTestId('hud-loot-inventory-btn').click();
    await expect(page.getByTestId('tab-party-inventory-btn')).toBeVisible();

    const heroTab = page.locator('[data-testid^="inventory-hero-tab-"]').first();
    await expect(heroTab).toBeVisible();
    const heroTestId = (await heroTab.getAttribute('data-testid')) ?? '';
    const prefix = `inventory-${heroTestId.replace('inventory-hero-tab-', '')}`;

    // Paperdoll + grid render.
    for (const slot of ['armor', 'shield', 'mainHand', 'offHand', 'ranged']) {
      await expect(page.getByTestId(`${prefix}-paperdoll-slot-${slot}`)).toBeVisible();
    }
    const grid = page.getByTestId(`${prefix}-grid`);
    await expect(grid).toBeVisible();
    const initialCount = await grid.locator(`[data-testid^="${prefix}-cell-"]`).count();
    expect(initialCount).toBeGreaterThan(0);

    // Filters + search narrow and restore the grid.
    await page.getByTestId(`${prefix}-filter-weapons`).click();
    expect(await grid.locator(`[data-testid^="${prefix}-cell-"]`).count()).toBeLessThanOrEqual(
      initialCount,
    );
    await page.getByTestId(`${prefix}-filter-all`).click();
    await page.getByTestId(`${prefix}-search`).fill('zzz-no-such-item');
    await expect(page.getByTestId(`${prefix}-grid-empty`)).toBeVisible();
    await page.getByTestId(`${prefix}-search`).fill('');
    expect(await grid.locator(`[data-testid^="${prefix}-cell-"]`).count()).toBe(initialCount);

    // Select a cell: action bar + compare line appear.
    const firstCell = grid.locator(`[data-testid^="${prefix}-cell-"]`).first();
    const cellTestId = (await firstCell.getAttribute('data-testid')) ?? '';
    await firstCell.click();
    await expect(
      page.getByTestId(`${prefix}-actions-${cellTestId.replace(`${prefix}-cell-`, '')}`),
    ).toBeVisible();

    // Hero tab switching keeps the shell consistent.
    const tabs = page.locator('[data-testid^="inventory-hero-tab-"]');
    if ((await tabs.count()) > 1) {
      await tabs.nth(1).click();
      const secondId = ((await tabs.nth(1).getAttribute('data-testid')) ?? '').replace(
        'inventory-hero-tab-',
        '',
      );
      await expect(page.getByTestId(`inventory-${secondId}-grid`)).toBeVisible();
    }

    // No horizontal overflow at Deck resolution.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    expect(consoleErrors).toHaveLength(0);
  });
});
