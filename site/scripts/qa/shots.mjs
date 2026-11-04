import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Screenshots for review (QA helper, not part of the build).
//   node scripts/qa/shots.mjs <out-dir> [widths comma list] [urlquery] [selectors comma list]
const [,, out = 'qa-screenshots/atlas', widths = '1440', query = '', sels = 'overview'] = process.argv;
mkdirSync(out, { recursive: true });
const base = 'http://localhost:4173/uplift/';
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const problems = [];
for (const w of widths.split(',').map(Number)) {
  const page = await browser.newPage({ viewport: { width: w, height: w >= 1920 ? 1080 : w >= 1024 ? 900 : 844 } });
  page.on('pageerror', (e) => problems.push(`${w}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${w}: ${m.text()}`); });
  await page.goto(base + query, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  for (const id of sels.split(',')) {
    await page.evaluate((i) => document.getElementById(i)?.scrollIntoView({ block: 'start' }), id);
    await page.waitForTimeout(1600);
    if (process.env.FULL) await page.locator(`#${id}`).screenshot({ path: join(out, `${w}-${id}.png`) });
    else await page.screenshot({ path: join(out, `${w}-${id}.png`) });
  }
  await page.close();
}
await browser.close();
console.log(problems.length ? problems.join('\n') : 'no console errors');
