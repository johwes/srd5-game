import { expect, test } from '@playwright/test';

test.describe('SRD-605: Steam-Ready Title Screen & New Game Campaign Setup E2E Suite', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      console.error('Page uncaught error:', err.message);
    });
  });

  test('1. Title Screen & Main Menu Navigation on 1280x800 Steam Deck resolution', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    // 1.1 Default view on launch is TitleMenuView
    const titleView = page.getByTestId('title-menu-view');
    await expect(titleView).toBeVisible();

    // Verify CRPG Title Branding
    await expect(page.getByRole('heading', { name: /DUNGEONS OF KAELEN/i })).toBeVisible();
    await expect(page.getByText(/SRD 5\.1 Tactical Dungeon Crawler/i).first()).toBeVisible();

    // 1.2 "Continue" button is disabled initially when no save exists
    const continueBtn = page.getByTestId('title-menu-continue-btn');
    await expect(continueBtn).toBeDisabled();

    // 1.3 Credits & Legal attribution modal
    const creditsBtn = page.getByTestId('title-menu-credits-btn');
    await expect(creditsBtn).toBeVisible();
    await creditsBtn.click();
    await expect(page.getByTestId('title-menu-credits-modal')).toBeVisible();
    await expect(page.getByText(/Creative Commons Attribution 4\.0/i).first()).toBeVisible();
    await page.getByTestId('title-menu-credits-close-btn').click();
    await expect(page.getByTestId('title-menu-credits-modal')).not.toBeVisible();

    // 1.4 Title Settings modal
    const settingsBtn = page.getByTestId('title-menu-settings-btn');
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();
    await expect(page.getByTestId('title-menu-settings-modal')).toBeVisible();
    await expect(page.getByText(/Audio Volumes/i).first()).toBeVisible();
    await page.getByTestId('title-menu-settings-close-btn').click();
    await expect(page.getByTestId('title-menu-settings-modal')).not.toBeVisible();

    // 1.5 Character Vault navigation
    const vaultBtn = page.getByTestId('title-menu-vault-btn');
    await expect(vaultBtn).toBeVisible();
    await vaultBtn.click();
    await expect(page.getByTestId('party-roster-view')).toBeVisible();

    // Return to Title Menu via header nav
    await page.getByTestId('app-nav-title').click();
    await expect(page.getByTestId('title-menu-view')).toBeVisible();

    // 1.6 Compendium Browser navigation
    const compendiumBtn = page.getByTestId('title-menu-compendium-btn');
    await expect(compendiumBtn).toBeVisible();
    await compendiumBtn.click();
    await expect(page.getByTestId('compendium-browser')).toBeVisible();

    // Return to Title Menu via header nav
    await page.getByTestId('app-nav-title').click();
    await expect(page.getByTestId('title-menu-view')).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
  });

  test('2. 4-Stage Campaign Setup Wizard, Party Customization, and Sunken Crypt Launch', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    // Launch New Game Wizard
    await page.getByTestId('title-menu-new-game-btn').click();
    const wizard = page.getByTestId('campaign-setup-wizard');
    await expect(wizard).toBeVisible();

    // --- STAGE 1: Adventure & Game Mode Selection (exactly 3 tiles, SRD-806) ---
    await expect(page.getByTestId('wizard-mode-card-campaign_kaelen')).toBeVisible();
    await expect(page.getByTestId('wizard-mode-card-realm')).toBeVisible();
    await expect(page.getByTestId('wizard-mode-card-arena')).toBeVisible();
    await expect(page.getByTestId('wizard-mode-card-deep_descent')).toHaveCount(0);

    // Select Campaign Mode and proceed
    await page.getByTestId('wizard-mode-card-campaign_kaelen').click();
    await page.getByTestId('wizard-nav-next').click();

    // --- STAGE 2: Difficulty & Ruleset Configuration ---
    await expect(page.getByTestId('wizard-preset-standard')).toBeVisible();
    await page.getByTestId('wizard-preset-tactician').click();
    await page.getByTestId('wizard-preset-standard').click();

    // Toggle custom rules drawer
    await page.getByTestId('wizard-custom-rules-toggle').click();
    const customPanel = page.getByTestId('wizard-custom-rules-panel');
    await expect(customPanel).toBeVisible();
    await page.getByTestId('wizard-toggle-permadeath').click();
    await page.getByTestId('wizard-nav-next').click();

    // --- STAGE 3: 4-Slot Campfire Party Assembly ---
    await expect(page.getByTestId('wizard-party-slot-0')).toBeVisible();
    await expect(page.getByTestId('wizard-party-slot-1')).toBeVisible();
    await expect(page.getByTestId('wizard-party-slot-2')).toBeVisible();
    await expect(page.getByTestId('wizard-party-slot-3')).toBeVisible();

    // Verify synergy ribbon
    await expect(page.getByTestId('wizard-synergy-ribbon')).toBeVisible();
    await expect(page.getByTestId('wizard-synergy-frontline')).toBeVisible();
    await expect(page.getByTestId('wizard-synergy-scout')).toBeVisible();
    await expect(page.getByTestId('wizard-synergy-divine')).toBeVisible();
    await expect(page.getByTestId('wizard-synergy-arcane')).toBeVisible();

    // Test Clear All Slots
    await page.getByTestId('wizard-clear-all-slots-btn').click();
    await expect(page.getByTestId('wizard-party-empty-warning')).toBeVisible();

    // Test Reset to 4 Iconic SRD Pregens
    await page.getByTestId('wizard-reset-iconics-btn').click();
    await expect(page.getByTestId('wizard-party-empty-warning')).not.toBeVisible();
    await expect(page.getByTestId('wizard-synergy-frontline')).toBeVisible();

    // Test "Roll New Hero" from Slot 2
    await page.getByTestId('wizard-roll-hero-slot-2').click();
    await expect(page.getByTestId('character-builder-wizard')).toBeVisible();

    // Load pregen wizard template, go to review step, rename, and finalize
    await page.getByTestId('builder-load-template-pregen-wizard').click();
    await page.getByTestId('builder-step-tab-review').click();
    const nameInput = page.getByTestId('builder-character-name-input');
    await expect(nameInput).toBeVisible();
    await nameInput.fill('Aldus the Wise');
    await page.getByTestId('builder-finalize-btn').click();

    // Verified: returned back to CampaignSetupWizard at Stage 3 with custom hero in Slot 2
    await expect(page.getByTestId('campaign-setup-wizard')).toBeVisible();
    const slot2 = page.getByTestId('wizard-party-slot-2');
    await expect(slot2).toContainText('Aldus the Wise');

    // Advance to Stage 4
    await page.getByTestId('wizard-nav-next').click();

    // --- STAGE 4: Narrative Prologue & Quest Hook ---
    await expect(page.getByTestId('wizard-narrative-parchment')).toBeVisible();
    await expect(page.getByText(/Sunken Crypt of Kaelen/i).first()).toBeVisible();
    await expect(page.getByTestId('wizard-summary-card')).toBeVisible();
    await expect(page.getByTestId('wizard-summary-card')).toContainText('Aldus the Wise');

    // Launch Campaign
    const launchCta = page.getByTestId('wizard-launch-cta');
    await expect(launchCta).toBeVisible();
    await launchCta.click();

    // Verified: Dungeon View is active
    await expect(page.getByTestId('dungeon-view-container')).toBeVisible({ timeout: 10000 });

    // --- Universal In-Game Pause Menu Integration ---
    // Press Escape to open Pause Menu
    await page.keyboard.press('Escape');
    const pauseMenu = page.getByTestId('pause-menu-modal');
    await expect(pauseMenu).toBeVisible();

    // Resume gameplay
    await page.getByTestId('pause-menu-resume-btn').click();
    await expect(pauseMenu).not.toBeVisible();

    // Press Escape again to reopen and Exit to Main Menu
    await page.keyboard.press('Escape');
    await expect(pauseMenu).toBeVisible();
    await page.getByTestId('pause-menu-exit-btn').click();

    // Confirm Exit dialog
    const confirmDialog = page.getByTestId('pause-exit-confirm-dialog');
    await expect(confirmDialog).toBeVisible();
    await page.getByTestId('pause-exit-confirm-btn').click();

    // Verified: Safely returned to TitleMenuView
    await expect(page.getByTestId('title-menu-view')).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
  });

  test('3. Launch The Realm (with Endless Delve) and The Arena Modes', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    // 3.1 The Realm Mode Launch (SRD-806: Deep Descent folded into the Realm)
    await page.getByTestId('title-menu-new-game-btn').click();
    await page.getByTestId('wizard-mode-card-realm').click();
    await page.getByTestId('wizard-nav-next').click(); // Difficulty
    await page.getByTestId('wizard-nav-next').click(); // Party
    await page.getByTestId('wizard-nav-next').click(); // Prologue
    await page.getByTestId('wizard-launch-cta').click();

    // Verify the Realm overworld view mounted
    await expect(page.getByTestId('realm-view-container')).toBeVisible({ timeout: 10000 });

    // SRD-1106: new Realm war campaigns launch with the banner-pick modal.
    // Select a nation to dismiss it before using the Realm HUD.
    const nationModal = page.getByTestId('realm-nation-select-modal');
    if (await nationModal.isVisible()) {
      await page.getByTestId('realm-nation-option-dawn-crown').click();
      await expect(nationModal).not.toBeVisible();
    }

    // The unbounded Endless Delve quick option remains launchable from the Realm.
    await expect(page.getByTestId('realm-hud-endless-delve-btn')).toBeVisible();
    await page.getByTestId('realm-hud-endless-delve-btn').click();
    await expect(page.getByTestId('dungeon-view-container')).toBeVisible({ timeout: 10000 });

    // Exit the Endless Delve back to the Realm, then to title via the pause menu.
    await page.keyboard.press('Escape');
    await page.getByTestId('pause-menu-exit-btn').click();
    await page.getByTestId('pause-exit-confirm-btn').click();
    await expect(page.getByTestId('realm-view-container')).toBeVisible({ timeout: 10000 });
    await page.keyboard.press('Escape');
    await page.getByTestId('realm-pause-exit-btn').click();
    await expect(page.getByTestId('title-menu-view')).toBeVisible();

    // 3.2 The Arena Mode Launch
    await page.getByTestId('title-menu-new-game-btn').click();
    await page.getByTestId('wizard-mode-card-arena').click();
    await page.getByTestId('wizard-nav-next').click(); // Difficulty
    await page.getByTestId('wizard-nav-next').click(); // Party
    await page.getByTestId('wizard-nav-next').click(); // Prologue
    await page.getByTestId('wizard-launch-cta').click();

    // Verify Arena Setup View is active
    await expect(page.getByTestId('arena-setup-view')).toBeVisible();

    // Return to title menu via top nav
    await page.getByTestId('app-nav-title').click();
    await expect(page.getByTestId('title-menu-view')).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
  });

  test('4. Steam Deck 1280x800 Layout Ergonomics: No clipping, horizontal overflow or broken controls', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    // Check Title Screen body dimensions
    const bodyScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(bodyScrollWidth).toBeLessThanOrEqual(1280);

    // Open Campaign Setup Wizard
    await page.getByTestId('title-menu-new-game-btn').click();
    await expect(page.getByTestId('campaign-setup-wizard')).toBeVisible();

    // Check Wizard Stages 1-4 for horizontal bounds and action button ergonomics
    for (let stage = 1; stage <= 4; stage++) {
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(1280);

      const navBtn =
        stage < 4
          ? page.getByTestId('wizard-nav-next')
          : page.getByTestId('wizard-launch-cta');

      await expect(navBtn).toBeVisible();
      await navBtn.scrollIntoViewIfNeeded();
      await expect(navBtn).toBeInViewport();

      const box = await navBtn.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        // Minimum touch target size on handheld
        expect(box.height).toBeGreaterThanOrEqual(36);
        expect(box.width).toBeGreaterThanOrEqual(48);
      }

      if (stage < 4) {
        await navBtn.click();
      }
    }

    expect(consoleErrors).toHaveLength(0);
  });
});
