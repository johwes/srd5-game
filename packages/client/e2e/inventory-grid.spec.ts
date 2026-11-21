import { expect, test } from '@playwright/test';

/**
 * SRD-1305 E2E: BG3-style graphical inventory (Spec 12 §8).
 *
 * Launches the Sunken Crypt campaign, opens the loot & inventory modal, and
 * verifies the icon-grid backpack + visual paperdoll are fully operable by
 * mouse and keyboard at the 1280×800 Steam Deck resolution with zero console
 * errors and zero horizontal overflow.
 */
test.describe('SRD-1305: Graphical Inventory grid + paperdoll', () => {
  test('paperdoll, filters, search, select/equip, and keyboard flow at 1280x800', async ({
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

    // 1. Paperdoll: exactly the 5 engine slots, each a focusable button.
    for (const slot of ['armor', 'shield', 'mainHand', 'offHand', 'ranged']) {
      const slotBtn = page.getByTestId(`${prefix}-paperdoll-slot-${slot}`);
      await expect(slotBtn).toBeVisible();
      expect(await slotBtn.getAttribute('type')).toBe('button');
    }
    await expect(page.getByTestId(`${prefix}-attunement-count`)).toBeVisible();

    // 2. Backpack grid starts populated (pregens ship with gear).
    const grid = page.getByTestId(`${prefix}-grid`);
    await expect(grid).toBeVisible();
    const allCells = grid.locator(`[data-testid^="${prefix}-cell-"]`);
    const initialCount = await allCells.count();
    expect(initialCount).toBeGreaterThan(0);

    // Currency + encumbrance-display strip.
    await expect(page.getByTestId(`${prefix}-currency`)).toBeVisible();
    await expect(page.getByTestId(`${prefix}-weight`)).toContainText('lb.');

    // 3. Category filter narrows the grid; All restores it.
    await page.getByTestId(`${prefix}-filter-weapons`).click();
    const weaponCount = await grid.locator(`[data-testid^="${prefix}-cell-"]`).count();
    expect(weaponCount).toBeGreaterThan(0);
    expect(weaponCount).toBeLessThanOrEqual(initialCount);
    await page.getByTestId(`${prefix}-filter-all`).click();
    expect(await grid.locator(`[data-testid^="${prefix}-cell-"]`).count()).toBe(initialCount);

    // 4. Text search: gibberish empties the grid; clearing restores it.
    await page.getByTestId(`${prefix}-search`).fill('zzz-no-such-item');
    await expect(page.getByTestId(`${prefix}-grid-empty`)).toBeVisible();
    await page.getByTestId(`${prefix}-search`).fill('');
    expect(await grid.locator(`[data-testid^="${prefix}-cell-"]`).count()).toBe(initialCount);

    // 5. Click select -> action bar with compare line + per-slot equip buttons.
    const firstCell = grid.locator(`[data-testid^="${prefix}-cell-"]`).first();
    const firstCellTestId = (await firstCell.getAttribute('data-testid')) ?? '';
    const instanceId = firstCellTestId.replace(`${prefix}-cell-`, '');
    await firstCell.click();
    const actions = page.getByTestId(`${prefix}-actions-${instanceId}`);
    await expect(actions).toBeVisible();
    await expect(page.getByTestId(`${prefix}-compare-${instanceId}`)).toBeVisible();
    const equipBtns = actions.locator(`[data-testid^="${prefix}-equip-${instanceId}-"]`);
    const useBtn = page.getByTestId(`${prefix}-use-${instanceId}`);
    const attuneBtn = page.getByTestId(`${prefix}-attune-${instanceId}`);
    expect(
      (await equipBtns.count()) + (await useBtn.count()) + (await attuneBtn.count()),
    ).toBeGreaterThan(0);
    // Equip path fires without breaking the modal (engine owns the result).
    if ((await equipBtns.count()) > 0) {
      await equipBtns.first().click();
      await expect(page.getByTestId(`${prefix}-view`)).toBeVisible();
    }

    // 6. Keyboard parity: Tab-focus a cell, Enter selects it (Deck-safe).
    await page.getByTestId(`${prefix}-deselect`).click().catch(() => {});
    const kbCell = grid.locator(`[data-testid^="${prefix}-cell-"]`).first();
    await kbCell.focus();
    await expect(kbCell).toBeFocused();
    await page.keyboard.press('Enter');
    const kbTestId = (await kbCell.getAttribute('data-testid')) ?? '';
    const kbInstance = kbTestId.replace(`${prefix}-cell-`, '');
    await expect(page.getByTestId(`${prefix}-actions-${kbInstance}`)).toBeVisible();

    // 7. Paperdoll slot click inspects its occupant (or stays empty-safe).
    await page.getByTestId(`${prefix}-paperdoll-slot-armor`).click();
    await expect(page.getByTestId(`${prefix}-view`)).toBeVisible();

    // 8. No horizontal overflow at Deck resolution.
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth - document.documentElement.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);

    expect(consoleErrors).toHaveLength(0);
  });
});
