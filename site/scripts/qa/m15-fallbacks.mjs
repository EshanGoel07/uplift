import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Story fallbacks and the first screen (QA helper): phones, tablets, no WebGL, reduced motion.
//   node scripts/qa/m15-fallbacks.mjs [base-url]
const [base = 'http://localhost:4173/uplift/'] = process.argv.slice(2);
const dir = 'qa-screenshots/m15/review/fallbacks';
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const step = (page, i) => page.locator(`.story__step[data-step="${i}"]`).evaluate((el) => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
  for (const [name, width, height, query, opts] of [
    ['phone-375', 375, 812, '', {}], ['phone-390', 390, 844, '', {}], ['tablet-768', 768, 1024, '', {}], ['small-1024', 1024, 768, '', {}],
    ['nowebgl-1440', 1440, 900, '?nowebgl', {}], ['reduced-1440', 1440, 900, '', { reducedMotion: 'reduce' }],
  ]) {
    const ctx = await browser.newContext({ viewport: { width, height }, ...opts });
    const page = await ctx.newPage();
    await page.goto(base + query, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    for (const i of [0, 2, 4]) {
      await step(page, i);
      await page.waitForTimeout(1600);
      await page.screenshot({ path: `${dir}/${name}-step${i}.png` });
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(name, 'overflow', overflow, 'canvases', await page.locator('canvas').count());
    await ctx.close();
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${dir}/first-load-1440.png` });
  await page.evaluate(() => document.getElementById('conditions').scrollIntoView({ behavior: 'instant' }));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/conditions-1440.png` });
  await page.close();
} finally {
  await browser.close();
}
