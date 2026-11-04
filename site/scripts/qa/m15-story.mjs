import { chromium } from '@playwright/test';

// Captures each beat of the one-bug story, scrolling back to check nothing goes stale (QA helper).
//   node scripts/qa/m15-story.mjs <label> [base-url]
const [label = 'story', base = 'http://localhost:4173/uplift/'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)); });
page.on('pageerror', (e) => errors.push(String(e).slice(0, 240)));
await page.goto(`${base}?diag`, { waitUntil: 'networkidle' });
const go = (i) => page.locator(`.story__step[data-step="${i}"]`).evaluate((el) => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
await go(0);
await page.waitForTimeout(2500);
for (const i of [0, 3, 6, 8, 9]) {
  await go(i);
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `qa-screenshots/m15/${label}-${i}.png` });
}
await go(2);
await page.waitForTimeout(2600);
await page.screenshot({ path: `qa-screenshots/m15/${label}-back-2.png` });
console.log('errors', errors);
console.log('scenes', JSON.stringify(await page.evaluate(() => window.__upliftDiag?.scenes().map((s) => [s.id, s.phase]))), 'contexts', await page.evaluate(() => window.__upliftDiag?.contexts()));
await browser.close();
