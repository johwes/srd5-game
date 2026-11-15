import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(__dirname, '../artifacts/playtest');

fs.mkdirSync(outputDir, { recursive: true });

async function checkServer(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitForServer(url: string, timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkServer(url)) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out waiting for dev server at ${url}`);
}

async function runPlaytest() {
  console.log('🚀 Starting Automated Playtest Bot...');
  console.log(`📸 Screenshots will be saved to: ${outputDir}`);

  let devServerProcess: ChildProcess | null = null;
  const isRunning = await checkServer('http://localhost:5173');
  if (!isRunning) {
    console.log('⚡ Client dev server is not running. Starting background dev server...');
    devServerProcess = spawn('pnpm', ['--filter', '@srd5/client', 'run', 'dev', '--port', '5173'], {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'ignore',
    });
    await waitForServer('http://localhost:5173');
    console.log('✅ Dev server is ready at http://localhost:5173.');
  } else {
    console.log('🔗 Connecting to existing dev server at http://localhost:5173.');
  }

  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--ignore-gpu-blocklist',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();

  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  const uncaughtExceptions: string[] = [];

  page.on('console', (msg) => {
    const text = msg.text();
    const type = msg.type();
    if (type === 'error') {
      consoleErrors.push(text);
      console.log(`❌ [CONSOLE ERROR] ${text}`);
    } else if (type === 'warning') {
      consoleWarnings.push(text);
    }
  });

  page.on('pageerror', (err) => {
    uncaughtExceptions.push(err.message);
    console.error(`💥 [UNCAUGHT EXCEPTION] ${err.message}\n${err.stack}`);
  });

  try {
    // -------------------------------------------------------------------------
    // 1. Initial Page Load
    // -------------------------------------------------------------------------
    console.log('🌐 Navigating to http://localhost:5173 ...');
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(outputDir, '01-initial-load.png') });
    console.log('✅ Initial page loaded successfully.');

    // -------------------------------------------------------------------------
    // 2. Party Roster
    // -------------------------------------------------------------------------
    console.log('👥 Testing Party Roster View...');
    const rosterNav = page.locator('[data-testid="app-nav-roster"]');
    if (await rosterNav.isVisible()) {
      await rosterNav.click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(outputDir, '02-party-roster.png') });
      console.log('✅ Party Roster rendered.');
    }

    // -------------------------------------------------------------------------
    // 3. The Arena
    // -------------------------------------------------------------------------
    console.log('⚔️ Testing The Arena...');
    const arenaNav = page.locator('[data-testid="app-nav-arena"]');
    await arenaNav.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(outputDir, '03-arena-setup.png') });

    const launchArenaBtn = page.locator('[data-testid="launch-arena-button"]');
    if (await launchArenaBtn.isVisible()) {
      console.log('⚔️ Launching Arena Combat...');
      await launchArenaBtn.click();
      await page.waitForSelector('[data-testid="arena-combat-view"]', { timeout: 10000 });
      await page.waitForTimeout(2000); // Allow PixiJS canvas to initialize and render
      await page.screenshot({ path: path.join(outputDir, '04-arena-combat-start.png') });

      // Verify canvas rendered with positive dimensions
      const canvas = page.locator('canvas');
      const box = await canvas.boundingBox();
      console.log(`🎨 Tactical Canvas bounding box: ${box?.width}x${box?.height}`);

      const arenaAssetDebug = await page.evaluate(async () => {
        const { assetRegistry } = await import('./src/canvas/assets/index.js');
        const resolvedGoblin = assetRegistry.resolveCreatureToken({ id: 'm1', name: 'Goblin #1', side: 'monster' });
        const resolvedValeros = assetRegistry.resolveCreatureToken({ id: 'p1', name: 'Valeros', side: 'party', classId: 'fighter' });
        return {
          isLoaded: assetRegistry.isLoaded,
          hasMonsterGoblin: assetRegistry.hasTexture('monster_goblin'),
          hasHeroFighter: assetRegistry.hasTexture('hero_fighter'),
          hasGoblinTexture: Boolean(resolvedGoblin.texture),
          hasValerosTexture: Boolean(resolvedValeros.texture),
        };
      });
      console.log('⚔️ Token Sprite Resolution:', arenaAssetDebug);
      if (!arenaAssetDebug.hasGoblinTexture || !arenaAssetDebug.hasValerosTexture) {
        throw new Error('Token sprites failed to load/resolve texture!');
      }
      console.log('🎨 Monster and Player Token Sprites verified successfully!');
      if (!box || box.width === 0 || box.height === 0) {
        throw new Error('Canvas bounding box is 0 or not found!');
      }

      // Check that Attack action card and Attack button are fully within the viewport
      const attackCard = page.locator('[data-testid^="attack-action-card-"]').first();
      if (await attackCard.isVisible()) {
        const cardBox = await attackCard.boundingBox();
        console.log('⚔️ First Attack Card bounding box:', cardBox);
        const attackBtn = page.locator('[data-testid^="attack-btn-"]').first();
        if (await attackBtn.isVisible()) {
          const btnBox = await attackBtn.boundingBox();
          console.log('⚔️ First Attack Button bounding box:', btnBox);
          if (btnBox && btnBox.y + btnBox.height > 800) {
            throw new Error(`Attack button is clipped outside 800px viewport! ${JSON.stringify(btnBox)}`);
          }
        }
      }

      // Check Spells Tab and Action Hotbar responsive layout at 1280x800
      const spellsTab = page.locator('[data-testid="hotbar-tab-spells"]');
      if (await spellsTab.isVisible()) {
        console.log('✨ Switching to Spells tab in Action Hotbar...');
        await spellsTab.click();
        await page.waitForTimeout(600);

        const spellsPanel = page.locator('[data-testid="hotbar-panel-spells"]');
        if (await spellsPanel.isVisible()) {
          const castBtns = page.locator('[data-testid^="spell-cast-btn-"]');
          const castCount = await castBtns.count();
          console.log(`✨ Found ${castCount} cast buttons in Spells tab.`);
          if (castCount > 0) {
            const firstCastBtn = castBtns.first();
            const castBox = await firstCastBtn.boundingBox();
            console.log('✨ First Cast Button bounding box:', castBox);
            if (!castBox || castBox.height < 20 || castBox.y + castBox.height > 800) {
              throw new Error(`Cast button is outside visible viewport (1280x800) or clipped! ${JSON.stringify(castBox)}`);
            }
          }

          // Test slot filter button (e.g. Cantrips)
          const cantripFilter = page.locator('[data-testid="spell-filter-0"]');
          if (await cantripFilter.isVisible()) {
            console.log('✨ Clicking Cantrips filter...');
            await cantripFilter.click();
            await page.waitForTimeout(300);
          }

          await page.screenshot({ path: path.join(outputDir, '04b-arena-spells-hotbar.png') });
          console.log('✅ Action Hotbar Spells & responsive layout verified at 1280x800.');
        }
      }

      // Check if auto-AI toggle or step AI button exists
      const autoAiToggle = page.locator('[data-testid="auto-ai-toggle"]');
      if (await autoAiToggle.isVisible()) {
        console.log('🤖 Auto AI toggle detected.');
      }

      const stepAiBtn = page.locator('[data-testid="step-ai-turn-button"]');
      if (await stepAiBtn.isVisible()) {
        console.log('🤖 Stepping AI turn...');
        await stepAiBtn.click();
        await page.waitForTimeout(1500);
      }

      await page.screenshot({ path: path.join(outputDir, '05-arena-combat-after-turn.png') });
      console.log('✅ Arena Combat executed cleanly.');
    }

    // -------------------------------------------------------------------------
    // 4. Dungeon Delve
    // -------------------------------------------------------------------------
    console.log('🏰 Testing Dungeon Delve...');
    const dungeonNav = page.locator('[data-testid="app-nav-dungeon"]');
    await dungeonNav.click();
    await page.waitForSelector('[data-testid="dungeon-view-container"]', { timeout: 10000 });
    await page.waitForTimeout(2500); // Allow dungeon procedural generation and Pixi rendering
    await page.screenshot({ path: path.join(outputDir, '06-dungeon-view.png') });

    // Click in the center of the viewport to move the party
    const dungeonCanvas = page.locator('[data-testid="dungeon-view-container"] canvas');
    const dBox = await dungeonCanvas.boundingBox();
    if (dBox) {
      console.log('🚶 Attempting party movement click in dungeon...');
      await page.mouse.click(dBox.x + dBox.width / 2 + 50, dBox.y + dBox.height / 2 + 50);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(outputDir, '07-dungeon-after-move.png') });
      console.log('✅ Dungeon movement interaction executed.');
    }

    // -------------------------------------------------------------------------
    // 5. Deep Descent (Roguelite)
    // -------------------------------------------------------------------------
    console.log('💀 Testing Deep Descent (Roguelite)...');
    const rogueliteNav = page.locator('[data-testid="app-nav-roguelite"]');
    await rogueliteNav.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(outputDir, '08-deep-descent.png') });
    console.log('✅ Deep Descent rendered.');

    // -------------------------------------------------------------------------
    // 6. Character Builder
    // -------------------------------------------------------------------------
    console.log('🛠️ Testing Character Builder Wizard...');
    const builderNav = page.locator('[data-testid="app-nav-builder"]');
    await builderNav.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(outputDir, '09-builder.png') });
    console.log('✅ Character Builder rendered.');

    console.log('\n📊 Playtest Run Summary:');
    console.log(`- Uncaught Exceptions: ${uncaughtExceptions.length}`);
    console.log(`- Console Errors: ${consoleErrors.length}`);
    console.log(`- Console Warnings: ${consoleWarnings.length}`);

    if (uncaughtExceptions.length > 0) {
      console.error('\n🚨 Failures detected:');
      for (const err of uncaughtExceptions) {
        console.error(`- ${err}`);
      }
      process.exitCode = 1;
    } else {
      console.log('\n🎉 ALL GAME MODES PLAYTESTED CLEANLY WITH NO CRASHES!');
    }
  } catch (err) {
    console.error('💥 Fatal error during playtest run:', err);
    await page.screenshot({ path: path.join(outputDir, '99-fatal-error.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
    if (devServerProcess) {
      console.log('🛑 Shutting down spawned dev server...');
      devServerProcess.kill('SIGTERM');
    }
  }
}

void runPlaytest();
