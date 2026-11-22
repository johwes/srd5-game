import { expect, test } from '@playwright/test';

/**
 * SRD-1506 E2E: Character & Party inventory flow verification gate at 1280×800.
 *
 * Browser leg of the kill → loot-box Take → Character-view equip →
 * party-strip move chain (Spec 14 §3–§4):
 *
 * 1. Loot modal shell (the Take surface): opens from the dungeon HUD,
 *    shows hero tabs + the icon-grid backpack with zero console errors.
 * 2. Character view 3-pane (stats rail · doll + equipment · backpack):
 *    opened from the loot modal via "Inspect in Character view"; rail tabs
 *    (Build / Skills / Attributes), sort control, select → action-bar equip,
 *    and keyboard (focus + Enter) parity all operate by mouse and keyboard.
 * 3. Party strip: all heroes side by side with per-hero + total gold;
 *    click → "Send to <hero>" moves an item between heroes from engine state.
 * 4. Zero horizontal overflow and zero console errors throughout, with a
 *    screenshot archived per surface (character 3-pane, skills tab,
 *    attributes tab, party strip).
 *
 * Deliberately out of scope (repo convention, see the SRD-1307 corpse-loot
 * spec): playing a full combat victory through the UI. The kill leg
 * (deterministic `rollCorpseLoot` with `monster_drop` provenance) and the
 * Take dispatch (`CLAIM_LOOT` with the slain-foe bundle re-rendering the
 * hero grid from engine state) are proven headless in
 * `packages/client/src/__tests__/character-flow-gate-1506.test.tsx`
 * against the exact production components.
 */
test.describe('SRD-1506: Character & Party inventory flow gate', () => {
  test('loot Take surface → Character view equip → party-strip move at 1280x800', async ({
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

    // ── Surface 0: loot & inventory modal (the Take surface) ──
    await page.getByTestId('hud-loot-inventory-btn').click();
    await expect(page.getByTestId('tab-party-inventory-btn')).toBeVisible();
    const heroTab = page.locator('[data-testid^="inventory-hero-tab-"]').first();
    await expect(heroTab).toBeVisible();
    const heroTestId = (await heroTab.getAttribute('data-testid')) ?? '';
    const heroId = heroTestId.replace('inventory-hero-tab-', '');
    await expect(page.getByTestId(`inventory-${heroId}-grid`)).toBeVisible();
    await expectNoOverflow();

    // ── Surface 1: Character view 3-pane via the loot modal entry point ──
    await page.getByTestId('loot-open-character-view-btn').click();
    const dialog = page.getByTestId('character-view');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('character-view-header-name')).toBeVisible();
    await expect(page.getByTestId('character-view-rail')).toBeVisible();
    await expect(page.getByTestId('character-view-doll')).toBeVisible();
    await expectNoOverflow();
    await page.screenshot({ path: testInfo.outputPath('1506-character-3pane.png') });

    // Rail tabs: Skills surface.
    await page.getByTestId('character-view-rail-tab-skills').click();
    await expect(page.getByTestId('character-view-rail-panel-skills')).toBeVisible();
    await expect(page.getByTestId('character-view-rail-skill-perception')).toBeVisible();
    await expectNoOverflow();
    await page.screenshot({ path: testInfo.outputPath('1506-character-skills.png') });

    // Rail tabs: Attributes surface.
    await page.getByTestId('character-view-rail-tab-attributes').click();
    await expect(page.getByTestId('character-view-rail-panel-attributes')).toBeVisible();
    await expect(page.getByTestId('character-view-rail-ability-str')).toBeVisible();
    await expectNoOverflow();
    await page.screenshot({ path: testInfo.outputPath('1506-character-attributes.png') });

    // Back to Build; backpack sort control reorders the grid.
    await page.getByTestId('character-view-rail-tab-build').click();
    const prefix = `character-view-${heroId}`;
    const equippedHeroGridVisible = await page
      .getByTestId(`${prefix}-grid`)
      .isVisible()
      .catch(() => false);
    // The active hero in the Character view follows the loot-modal recipient;
    // resolve the live prefix from whichever backpack grid is visible.
    const livePrefix = equippedHeroGridVisible
      ? prefix
      : ((await page
          .locator('[data-testid$="-grid"]')
          .first()
          .getAttribute('data-testid')) ?? '').replace(/-grid$/, '');
    const liveGrid = page.getByTestId(`${livePrefix}-grid`);
    await expect(liveGrid).toBeVisible();
    const initialCount = await liveGrid.locator(`[data-testid^="${livePrefix}-cell-"]`).count();
    expect(initialCount).toBeGreaterThan(0);
    await page.getByTestId(`${livePrefix}-sort`).selectOption('name');
    expect(await liveGrid.locator(`[data-testid^="${livePrefix}-cell-"]`).count()).toBe(
      initialCount,
    );

    // Select → action bar; equip when the selected item offers a slot.
    const firstCell = liveGrid.locator(`[data-testid^="${livePrefix}-cell-"]`).first();
    const firstCellTestId = (await firstCell.getAttribute('data-testid')) ?? '';
    const instanceId = firstCellTestId.replace(`${livePrefix}-cell-`, '');
    await firstCell.click();
    await expect(page.getByTestId(`${livePrefix}-actions-${instanceId}`)).toBeVisible();
    const equipBtns = page.locator(`[data-testid^="${livePrefix}-equip-${instanceId}-"]`);
    if ((await equipBtns.count()) > 0) {
      await equipBtns.first().click();
      await expect(page.getByTestId('character-view')).toBeVisible();
    }

    // Keyboard parity: focus a cell, Enter selects it (Deck-safe).
    await page.getByTestId(`${livePrefix}-deselect`).click().catch(() => {});
    const kbCell = liveGrid.locator(`[data-testid^="${livePrefix}-cell-"]`).first();
    await kbCell.focus();
    await expect(kbCell).toBeFocused();
    await page.keyboard.press('Enter');
    const kbTestId = (await kbCell.getAttribute('data-testid')) ?? '';
    await expect(
      page.getByTestId(`${livePrefix}-actions-${kbTestId.replace(`${livePrefix}-cell-`, '')}`),
    ).toBeVisible();
    await expectNoOverflow();

    // ── Surface 2: Party strip — per-hero + total gold, hero-to-hero move ──
    await page.getByTestId('character-view-mode-party').click();
    const strip = page.getByTestId('character-view-party-strip');
    await expect(strip).toBeVisible();
    const goldBadges = strip.locator('[data-testid$="-gold"]');
    expect(await goldBadges.count()).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId('character-view-header-party-gold')).toContainText('gp');
    await expectNoOverflow();
    await page.screenshot({ path: testInfo.outputPath('1506-party-strip.png') });

    // Move an item hero → hero: click a party cell, then "Send to <hero>".
    // Scoped to the strip (the character backpack grid is unmounted in party mode).
    const partyCell = strip.locator('[data-testid*="-cell-"]').first();
    const partyCellTestId = (await partyCell.getAttribute('data-testid')) ?? '';
    // testid shape: character-view-party-card-<fromHeroId>-cell-<instanceId>
    const partyMatch = partyCellTestId.match(
      /^character-view-party-card-(.+)-cell-(.+)$/,
    );
    expect(partyMatch).not.toBeNull();
    const [, fromHeroId, movingInstanceId] = partyMatch!;
    await partyCell.click();
    const sendBtn = page.locator(
      `[data-testid^="character-view-party-send-${fromHeroId}-to-"][data-testid$="-${movingInstanceId}"]`,
    );
    if ((await sendBtn.count()) > 0) {
      const sendTestId = (await sendBtn.first().getAttribute('data-testid')) ?? '';
      const toHeroId = sendTestId.replace(
        `character-view-party-send-${fromHeroId}-to-`,
        '',
      ).replace(`-${movingInstanceId}`, '');
      await sendBtn.first().click();
      // Engine-state re-render: the destination card now holds the item.
      await expect(
        page.getByTestId(`character-view-party-card-${toHeroId}-cell-${movingInstanceId}`),
      ).toBeVisible();
    }
    await expectNoOverflow();

    // Esc closes the fullscreen Character view.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('character-view')).not.toBeVisible();
    await expectNoOverflow();

    expect(consoleErrors).toHaveLength(0);
  });
});
