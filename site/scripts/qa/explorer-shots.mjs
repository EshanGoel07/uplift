import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Review captures of the worked example (#explorer) and the full explorer (#explorer-all).
//   node scripts/qa/explorer-shots.mjs <base-url> <out-dir>
const [,, base = 'http://localhost:5173/', outDir = 'qa-screenshots/explorer'] = process.argv;
mkdirSync(outDir, { recursive: true });
const HIDE_FIXED = '.nav, .skip-link, .to-top { visibility: hidden !important; }';
const browser = await chromium.launch();
const problems = [];

for (const vp of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  page.on('pageerror', (e) => problems.push(`${vp.name}: pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${vp.name}: console ${m.text()}`); });
  await page.goto(base + '?nowebgl', { waitUntil: 'networkidle' });
  const worked = page.locator('#explorer');
  await worked.scrollIntoViewIfNeeded();
  await page.locator('#explorer .rboard').waitFor();
  await page.locator('#explorer .approach .diff').first().waitFor();
  await page.waitForTimeout(400);
  await worked.screenshot({ path: join(outDir, `${vp.name}-worked.png`), style: HIDE_FIXED });
  await page.locator('#explorer .approaches').screenshot({ path: join(outDir, `${vp.name}-approaches.png`), style: HIDE_FIXED });
  await page.locator('#explorer .worked__why').screenshot({ path: join(outDir, `${vp.name}-why.png`), style: HIDE_FIXED });
  // A selected run (on phones, open its condition first).
  if (vp.name === 'mobile') await page.locator('#explorer .rboard__group summary').nth(1).click();
  await page.locator('#explorer .run-pill').nth(vp.name === 'mobile' ? 2 : 4).click();
  await page.waitForTimeout(300);
  await page.locator('#explorer .worked__board').screenshot({ path: join(outDir, `${vp.name}-board-run.png`), style: HIDE_FIXED });
  // Full explorer.
  const all = page.locator('#explorer-all');
  await all.scrollIntoViewIfNeeded();
  await page.locator('#explorer-all .ex-head__title').waitFor();
  await page.waitForTimeout(400);
  await all.screenshot({ path: join(outDir, `${vp.name}-explorer.png`), style: HIDE_FIXED });
  await page.close();
}
await browser.close();
console.log(problems.length ? problems.join('\n') : 'ok: no console errors');
