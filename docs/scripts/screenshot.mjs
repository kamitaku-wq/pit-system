import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../assets/screenshots');
const URL_BASE = process.env.DESIGN_URL || 'http://localhost:5175';

await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1200 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

page.on('pageerror', (err) => process.stderr.write(`[page error] ${err.message}\n`));

process.stdout.write(`Navigating to ${URL_BASE}...\n`);
await page.goto(URL_BASE, { waitUntil: 'networkidle', timeout: 60000 });

// Wait for Babel-compiled JSX to render artboards
process.stdout.write('Waiting for artboards to render...\n');
await page.waitForSelector('[data-dc-slot]', { timeout: 60000 });
await page.waitForTimeout(4000);

const slotHandles = await page.locator('[data-dc-slot]').all();
process.stdout.write(`Found ${slotHandles.length} artboards.\n`);

let ok = 0;
let fail = 0;
for (const slot of slotHandles) {
  const id = await slot.getAttribute('data-dc-slot');
  if (!id) continue;

  const card = slot.locator('.dc-card').first();
  const hasCard = await card.count();
  if (!hasCard) {
    process.stdout.write(`-  ${id}: no .dc-card\n`);
    continue;
  }

  try {
    // Try the simple path first.
    await card.scrollIntoViewIfNeeded({ timeout: 4000 });
    await page.waitForTimeout(150);
    const outPath = path.join(OUT_DIR, `${id}.png`);
    await card.screenshot({ path: outPath, timeout: 10000 });
    process.stdout.write(`✓  ${id}\n`);
    ok++;
  } catch (err) {
    // Fallback: scrollIntoView via DOM API (in case design-canvas blocks viewport)
    try {
      await card.evaluate((el) => {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      });
      await page.waitForTimeout(250);
      const outPath = path.join(OUT_DIR, `${id}.png`);
      await card.screenshot({ path: outPath, timeout: 10000 });
      process.stdout.write(`✓* ${id} (fallback)\n`);
      ok++;
    } catch (err2) {
      process.stdout.write(`✗  ${id}: ${err2.message}\n`);
      fail++;
    }
  }
}

await browser.close();
process.stdout.write(`\nDone. OK=${ok}, FAIL=${fail}, OUT=${OUT_DIR}\n`);
