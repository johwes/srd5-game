import { expect, test } from '@playwright/test';

/**
 * Automated Playtest E2E Suite (Tier 2):
 * 1. The Realm War Campaign flow: Nation Selection -> Overworld HUD -> War Room
 *    (Ledger, Special-Ops Missions, Diplomacy & Sub-Factions) -> Accept Mission.
 * 2. Combat HUD regression probes: zero raw `@variable` tokens in spell tooltips
 *    and zero raw `enc_*` instance IDs in the Combat Log, zero console errors,
 *    and zero horizontal overflow at 1280×800 Steam Deck viewport.
 */
test.describe('Automated Playtest: Realm War Campaign & Combat UI Invariants', () => {
  test('1. The Realm War flow: Nation Selection, War Room Ledger/Missions/Diplomacy, zero console errors', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    // Launch New Game -> The Realm
    await page.getByTestId('title-menu-new-game-btn').click();
    await expect(page.getByTestId('campaign-setup-wizard')).toBeVisible();
    await page.getByTestId('wizard-mode-card-realm').click();
    await page.getByTestId('wizard-nav-next').click();
    await page.getByTestId('wizard-nav-next').click();
    await page.getByTestId('wizard-nav-next').click();
    await page.getByTestId('wizard-launch-cta').click();

    // Realm HUD loads; Nation Select modal should appear (or open via banner button)
    await expect(page.getByTestId('realm-hud-top-bar')).toBeVisible({ timeout: 15000 });

    const nationModal = page.getByTestId('realm-nation-select-modal');
    if (!(await nationModal.isVisible())) {
      const chooseBannerBtn = page.getByTestId('realm-hud-choose-banner-btn');
      if (await chooseBannerBtn.isVisible()) {
        await chooseBannerBtn.click();
      }
    }

    if (await nationModal.isVisible()) {
      const nationOptions = nationModal.locator('[data-testid^="realm-nation-option-"]');
      const count = await nationOptions.count();
      expect(count).toBeGreaterThanOrEqual(3);
      // Select the first nation archetype banner
      await nationOptions.first().click();
      await expect(nationModal).not.toBeVisible();
    }

    // War Power strip should now be visible on the top HUD
    await expect(page.getByTestId('realm-hud-war-strip')).toBeVisible();
    const warRoomBtn = page.getByTestId('realm-hud-war-room-btn');
    await expect(warRoomBtn).toBeVisible();

    // Open War Room and verify all 3 tabs (Ledger, Missions, Diplomacy)
    await warRoomBtn.click();
    const warRoom = page.getByTestId('realm-war-room-modal');
    await expect(warRoom).toBeVisible();
    await expect(page.getByTestId('realm-war-room-ledger')).toBeVisible();

    // Switch to Diplomacy & Sub-Factions tab and verify controls render
    await page.getByTestId('realm-war-room-tab-diplomacy').click();
    await expect(page.getByTestId('realm-war-room-diplomacy')).toBeVisible();
    await expect(page.getByTestId('realm-war-hire-mercenaries-btn')).toBeVisible();
    await expect(page.getByTestId('realm-war-hire-thieves-btn')).toBeVisible();

    // Switch to Special-Ops Missions tab and accept the first available mission
    await page.getByTestId('realm-war-room-tab-missions').click();
    await expect(page.getByTestId('realm-war-room-missions')).toBeVisible();
    const acceptBtns = warRoom.locator('[data-testid^="realm-war-mission-accept-"]');
    if ((await acceptBtns.count()) > 0) {
      await acceptBtns.first().click();
      // Accepting a mission launches the Mission Approach modal (or closes War Room)
      await expect(page.getByTestId('realm-mission-approach-modal')).toBeVisible({ timeout: 5000 });
    } else {
      await page.getByTestId('realm-war-room-close-btn').click();
      await expect(warRoom).not.toBeVisible();
    }

    // Verify no horizontal overflow at 1280×800
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 2,
    );
    expect(overflow).toBe(false);
    expect(consoleErrors).toHaveLength(0);
  });

  test('2. Arena Combat UI Invariants: resolved spell tooltips (no raw @vars) and clean Combat Log', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    // Launch The Arena for an immediate combat encounter with the iconic party
    await page.getByTestId('title-menu-new-game-btn').click();
    await page.getByTestId('wizard-mode-card-arena').click();
    await page.getByTestId('wizard-nav-next').click();
    await page.getByTestId('wizard-nav-next').click();
    await page.getByTestId('wizard-nav-next').click();
    await page.getByTestId('wizard-launch-cta').click();

    const startFightBtn = page.getByRole('button', { name: /Enter Arena Skirmish/i });
    await expect(startFightBtn).toBeVisible({ timeout: 10000 });
    await startFightBtn.click();

    // Wait for combat HUD hotbar
    await expect(page.getByTestId('hotbar-tab-spells')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('hotbar-tab-spells').click();

    // Inspect all spell tooltips currently mounted in the DOM: none may leak raw `@spellMod` etc.
    const rawVarCount = await page.evaluate(() => {
      const tooltips = Array.from(document.querySelectorAll('[data-testid^="spell-tooltip-"]'));
      return tooltips.filter((el) => /@[a-zA-Z0-9_]+/.test(el.textContent ?? '')).length;
    });
    expect(rawVarCount).toBe(0);

    // Verify Combat Log never displays raw `enc_*` instance IDs
    const combatLog = page.getByTestId('combat-log');
    if (await combatLog.isVisible()) {
      const logText = (await combatLog.textContent()) ?? '';
      expect(logText).not.toMatch(/enc_[a-z0-9_]+-/i);
    }

    expect(consoleErrors).toHaveLength(0);
  });
});
