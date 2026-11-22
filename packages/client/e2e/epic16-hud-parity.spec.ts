import { expect, test } from '@playwright/test';

/**
 * SRD-1601 + SRD-1604 (partial): BG3 HUD parity verification at 1280×800.
 *
 * 1. Exploration HUD layout: no full-width top bar — a compact location chip
 *    (top-left), an icon system cluster (top-right), a left vertical portrait
 *    rail, and a bottom-center action bar. Positional assertions pin the
 *    BG3 arrangement (rail left of viewport center, action bar low-center).
 * 2. `C`/`I` hotkey flow: pressing `c` in the dungeon opens the fullscreen
 *    BG3 Character view (never the legacy sheet drawer); a second `c`
 *    closes it; `i` reopens it; `Esc` closes it.
 * 3. Zero horizontal overflow and zero console errors throughout, with
 *    screenshots archived per surface for the side-by-side BG3 review.
 */
test.describe('SRD-1601/1604: BG3 HUD parity (portrait rail, chrome, C/I hotkey)', () => {
  test('exploration HUD layout + C/I Character view flow at 1280x800', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    const expectNoOverflow = async () => {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    };

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

    // ── BG3 layout pins ──
    const rail = page.getByTestId('hud-party-rail');
    const actionBar = page.getByTestId('hud-action-bar');
    const chip = page.getByTestId('hud-location-chip');
    const cluster = page.getByTestId('hud-system-cluster');
    await expect(rail).toBeVisible();
    await expect(actionBar).toBeVisible();
    await expect(chip).toBeVisible();
    await expect(cluster).toBeVisible();

    const railBox = await rail.boundingBox();
    const barBox = await actionBar.boundingBox();
    const chipBox = await chip.boundingBox();
    const clusterBox = await cluster.boundingBox();
    expect(railBox).not.toBeNull();
    expect(barBox).not.toBeNull();
    expect(chipBox).not.toBeNull();
    expect(clusterBox).not.toBeNull();

    // Portrait rail hugs the left edge, vertically centered-ish.
    expect(railBox!.x).toBeLessThan(40);
    expect(railBox!.x + railBox!.width).toBeLessThan(640);
    expect(railBox!.y).toBeGreaterThan(80);
    // Action bar sits low and centered.
    expect(barBox!.y + barBox!.height).toBeGreaterThan(640);
    expect(barBox!.x).toBeGreaterThan(300);
    // Location chip top-left, system cluster top-right.
    expect(chipBox!.x).toBeLessThan(40);
    expect(chipBox!.y).toBeLessThan(40);
    expect(clusterBox!.x + clusterBox!.width).toBeGreaterThan(1100);
    expect(clusterBox!.y).toBeLessThan(40);
    await expectNoOverflow();
    await page.screenshot({ path: testInfo.outputPath('1604-hud-exploration.png') });

    // ── C/I hotkey flow ──
    // Pressing `c` opens the fullscreen Character view, not the legacy drawer.
    await page.keyboard.press('c');
    await expect(page.getByTestId('character-view')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('character-sheet-drawer')).toHaveCount(0);
    await expectNoOverflow();
    await page.screenshot({ path: testInfo.outputPath('1604-character-view-via-hotkey.png') });

    // A second `c` closes it again.
    await page.keyboard.press('c');
    await expect(page.getByTestId('character-view')).toHaveCount(0);

    // `i` reopens it; Esc closes it.
    await page.keyboard.press('i');
    await expect(page.getByTestId('character-view')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('character-sheet-drawer')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('character-view')).toHaveCount(0);
    await expectNoOverflow();

    expect(consoleErrors).toHaveLength(0);
  });
});
