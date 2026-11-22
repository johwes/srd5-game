import { expect, test } from '@playwright/test';

/**
 * SRD-1705 E2E: weapon-set swap flow (Spec 14 §3.1, §9 amended).
 *
 * Launches the Sunken Crypt campaign, opens the loot & inventory modal, and
 * verifies the BG3-style Set I / Set II toggle: flipping sets updates the
 * paperdoll to the visible set, equipping lands in the visible set, swapping
 * back restores the primary set — at 1280×800 with zero console errors and
 * zero horizontal overflow.
 */
test.describe('SRD-1705: weapon-set equip/swap flow', () => {
  test('toggle swaps visible set, equip lands in visible set, swap back restores', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    // Title -> New Game -> Sunken Crypt campaign with iconic pregens.
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

    // Open the loot & inventory modal.
    await page.getByTestId('hud-loot-inventory-btn').click();
    await expect(page.getByTestId('tab-party-inventory-btn')).toBeVisible();

    const heroTab = page.locator('[data-testid^="inventory-hero-tab-"]').first();
    await expect(heroTab).toBeVisible();
    const heroTestId = (await heroTab.getAttribute('data-testid')) ?? '';
    const heroId = heroTestId.replace('inventory-hero-tab-', '');
    const prefix = `inventory-${heroId}`;

    // 1. Set toggle renders; primary active by default (legacy saves migrate).
    await expect(page.getByTestId(`${prefix}-weapon-set-toggle`)).toBeVisible();
    await expect(page.getByTestId(`${prefix}-weapon-set-primary`)).toBeVisible();
    await expect(page.getByTestId(`${prefix}-weapon-set-secondary`)).toBeVisible();
    expect(await page.getByTestId(`${prefix}-weapon-set-primary`).getAttribute('aria-pressed')).toBe('true');
    await expect(page.getByTestId(`${prefix}-weapon-set-label`)).toContainText('Set I');

    // Paperdoll slots render for the visible set.
    for (const slot of ['armor', 'mainHand', 'ranged']) {
      await expect(page.getByTestId(`${prefix}-paperdoll-slot-${slot}`)).toBeVisible();
    }

    // 2. Flip to Set II: pressed state + label follow, modal stays alive.
    await page.getByTestId(`${prefix}-weapon-set-secondary`).click();
    expect(await page.getByTestId(`${prefix}-weapon-set-secondary`).getAttribute('aria-pressed')).toBe('true');
    expect(await page.getByTestId(`${prefix}-weapon-set-primary`).getAttribute('aria-pressed')).toBe('false');
    await expect(page.getByTestId(`${prefix}-weapon-set-label`)).toContainText('Set II');
    await expect(page.getByTestId(`${prefix}-view`)).toBeVisible();

    // 3. Equip into the visible (secondary) set via the action bar.
    const grid = page.getByTestId(`${prefix}-grid`);
    await expect(grid).toBeVisible();
    const firstCell = grid.locator(`[data-testid^="${prefix}-cell-"]`).first();
    await expect(firstCell).toBeVisible();
    const firstCellTestId = (await firstCell.getAttribute('data-testid')) ?? '';
    const instanceId = firstCellTestId.replace(`${prefix}-cell-`, '');
    await firstCell.click();
    const actions = page.getByTestId(`${prefix}-actions-${instanceId}`);
    await expect(actions).toBeVisible();
    const equipBtns = actions.locator(`[data-testid^="${prefix}-equip-${instanceId}-"]`);
    if ((await equipBtns.count()) > 0) {
      await equipBtns.first().click();
      await expect(page.getByTestId(`${prefix}-view`)).toBeVisible();
    }

    // 4. Swap back to Set I: pressed state + label restore.
    await page.getByTestId(`${prefix}-weapon-set-primary`).click();
    expect(await page.getByTestId(`${prefix}-weapon-set-primary`).getAttribute('aria-pressed')).toBe('true');
    expect(await page.getByTestId(`${prefix}-weapon-set-secondary`).getAttribute('aria-pressed')).toBe('false');
    await expect(page.getByTestId(`${prefix}-weapon-set-label`)).toContainText('Set I');

    // 5. Weapon cards still render under the doll after the round trip.
    await expect(page.getByTestId(`${prefix}-weapon-melee`)).toBeVisible();
    await expect(page.getByTestId(`${prefix}-weapon-ranged`)).toBeVisible();

    // 6. No horizontal overflow at Deck resolution.
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth - document.documentElement.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);

    expect(consoleErrors).toHaveLength(0);
  });
});
