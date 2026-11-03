import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Review screenshots of the redesigned sections (QA helper, not part of the build).
//   node scripts/qa/review-shots.mjs <base-url> <out-dir> [--nowebgl]
// For each viewport it saves the first screen, plus every listed section in full.
const [,, base = 'http://localhost:5173/', outDir = 'qa-screenshots/review', flag = ''] = process.argv;
mkdirSync(outDir, { recursive: true });

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'mobile-small', width: 375, height: 667 },
];
const SECTIONS = ['overview', 'results'];
const FIGURES = [['figure-1', '.lattice'], ['figure-2', '.results__figure']];
// Fixed chrome would be stitched into tall element captures, so it is hidden for those.
const HIDE_FIXED = '.nav, .skip-link, .to-top { visibility: hidden !important; }';

// GPU flags as in shot.mjs, so the hero's WebGL lattice renders on this machine.
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const problems = [];
for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  page.on('pageerror', (e) => problems.push(`${vp.name}: pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${vp.name}: console ${m.text()}`); });
  const url = base + (flag === '--nowebgl' ? '?nowebgl' : '');
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('.lattice__canvas canvas, .overview__svg');
  // Let the lattice build and reveal its outcomes (it does so once, on its own).
  await page.locator('.seg-dark button[aria-pressed="true"]', { hasText: 'Outcomes' }).waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1800);
  await page.waitForSelector('.ic-svg');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(outDir, `${vp.name}-first-screen.png`) });
  for (const id of SECTIONS) {
    const el = page.locator(`#${id}`);
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1600); // the chart draws itself in
    await el.screenshot({ path: join(outDir, `${vp.name}-${id}.png`), style: HIDE_FIXED });
  }
  for (const [name, sel] of FIGURES) {
    const el = page.locator(sel).first();
    await el.scrollIntoViewIfNeeded();
    await el.screenshot({ path: join(outDir, `${vp.name}-${name}.png`), style: HIDE_FIXED });
  }
  // Interaction states: a selected chart row (readout filled), and the small-screen menu.
  const row = page.locator('.ic-row').nth(3);
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await page.locator('.results__figure').screenshot({ path: join(outDir, `${vp.name}-figure-2-selected.png`), style: HIDE_FIXED });
  if (await page.locator('.nav__menu-btn').isVisible()) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('.nav__menu-btn').click();
    await page.screenshot({ path: join(outDir, `${vp.name}-menu-open.png`) });
    await page.keyboard.press('Escape');
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) problems.push(`${vp.name}: page overflows horizontally by ${overflow}px`);
  await page.close();
}
await browser.close();
console.log(problems.length ? problems.join('\n') : 'ok: no console errors, no horizontal overflow');
