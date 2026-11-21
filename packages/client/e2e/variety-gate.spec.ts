import { expect, test } from '@playwright/test';

/**
 * SRD-1406 E2E: Variety verification gate — browser smoke at 1280×800.
 *
 * Covers what browser automation can honestly cover:
 * 1. Realm launch with non-default Civ setup-screen options (grand scope +
 *    manual seed) — the Realm HUD shows the world-options banner with the
 *    chosen scope and visible seed.
 * 2. Endless Delve entry from the Realm HUD — the delve DungeonView mounts
 *    and inherits the session's world options (banner visible in the
 *    roguelite HUD), proving the SRD-1406 RealmView wiring.
 * 3. Zero console errors and zero horizontal overflow throughout.
 *
 * Deliberately out of scope (repo convention, see the SRD-1307 corpse-loot
 * spec): playing combat victories or lockpicking vaults through the UI.
 * The RNG-gated surfaces — champion skull badge visibility and the vault
 * open flow — are proven deterministically in
 * `packages/client/src/__tests__/variety-gate-1406.test.tsx` (exact
 * production components) and headless in
 * `packages/engine/src/__tests__/variety-gate-1406.test.ts`.
 */
test.describe('SRD-1406: Variety gate browser smoke (options banner + delve entry)', () => {
  test('Realm launch with grand scope + manual seed shows the banner in Realm and Delve', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    // Title -> New Game -> The Realm.
    await page.getByTestId('title-menu-new-game-btn').click();
    await expect(page.getByTestId('campaign-setup-wizard')).toBeVisible();
    await page.getByTestId('wizard-mode-card-realm').click();
    await page.getByTestId('wizard-nav-next').click(); // Difficulty + world options

    // Civ setup-screen options: grand scope + manual seed.
    await expect(page.getByTestId('world-options-form')).toBeVisible();
    await page.getByTestId('world-scope-grand').click();
    await page.getByTestId('world-seed-input').fill('987654');
    // The manual seed commits on blur — Tab out before asserting the preview.
    await page.getByTestId('world-seed-input').press('Tab');
    // The rolled seed is visible before commit.
    await expect(page.getByTestId('world-seed-preview')).toContainText('987654');

    await page.getByTestId('wizard-nav-next').click(); // Party assembly
    const resetBtn = page.getByTestId('wizard-reset-iconics-btn');
    if (await resetBtn.isVisible()) await resetBtn.click();
    await page.getByTestId('wizard-nav-next').click(); // Prologue
    await page.getByTestId('wizard-launch-cta').click();

    // Realm overworld mounts; pick a nation to dismiss the banner modal.
    await expect(page.getByTestId('realm-view-container')).toBeVisible({ timeout: 30000 });
    const nationModal = page.getByTestId('realm-nation-select-modal');
    if (await nationModal.isVisible()) {
      const options = nationModal.locator('[data-testid^="realm-nation-option-"]');
      expect(await options.count()).toBeGreaterThanOrEqual(3);
      await options.first().click();
      await expect(nationModal).not.toBeVisible();
    }

    // Options banner shown in the Realm HUD with scope + visible seed.
    const realmBanner = page.getByTestId('world-options-banner').first();
    await expect(realmBanner).toBeVisible();
    await expect(realmBanner).toContainText('Grand');
    await expect(realmBanner).toContainText('987654');

    // Endless Delve inherits the session config: the delve HUD banner shows it.
    await page.getByTestId('realm-hud-endless-delve-btn').click();
    await expect(page.getByTestId('dungeon-view-container')).toBeVisible({ timeout: 30000 });
    const delveBanner = page.getByTestId('world-options-banner').first();
    await expect(delveBanner).toBeVisible();
    await expect(delveBanner).toContainText('Grand');
    await expect(delveBanner).toContainText('987654');

    // No horizontal overflow at Deck resolution.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    expect(consoleErrors).toHaveLength(0);
  });
});
