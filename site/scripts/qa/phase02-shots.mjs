import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Phase 02 review (QA helper, not part of the build): hero and workbench at every review width, the
// no-WebGL path, a resize check, and a frame sequence while scrolling from the hero to the workbench.
//   node scripts/qa/phase02-shots.mjs <base-url> <out-dir>
const [,, base = 'http://localhost:4173/uplift/', out = 'qa-screenshots/phase02/after'] = process.argv;
mkdirSync(out, { recursive: true });
const SIZES = [[1440, 900], [1920, 1080], [768, 1024], [390, 844], [375, 812]];
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const problems = [];
const watch = (page, tag) => {
  page.on('pageerror', (e) => problems.push(`${tag}: pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${tag}: console ${m.text()}`); });
};

for (const [w, h] of SIZES) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  watch(page, `${w}`);
  await page.goto(`${base}?diag`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: join(out, `${w}-hero.png`) });
  await page.locator('.lattice').scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(out, `${w}-lattice.png`) });
  await page.evaluate(() => document.querySelector('#method .wb')?.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(out, `${w}-workbench.png`) });
  const d = await page.evaluate(() => ({ canvases: document.querySelectorAll('canvas').length, contexts: window.__upliftDiag.contexts(), scenes: window.__upliftDiag.scenes().map((s) => `${s.id}:${s.phase}`), renderer: window.__upliftDiag.renderer() }));
  console.log(w, JSON.stringify(d));
  const nav = await page.evaluate(() => getComputedStyle(document.querySelector('.nav')).backgroundColor);
  console.log('  nav', nav);
  await page.close();

  const no = await browser.newPage({ viewport: { width: w, height: h } });
  watch(no, `${w} nowebgl`);
  await no.goto(`${base}?nowebgl`, { waitUntil: 'networkidle' });
  await no.locator('.lattice--svg').scrollIntoViewIfNeeded();
  await no.waitForTimeout(500);
  await no.screenshot({ path: join(out, `${w}-nowebgl.png`) });
  await no.close();
}

// Resize: the lattice must refit, with no second canvas.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(page, 'resize');
  await page.goto(`${base}?diag`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(5500);
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.waitForTimeout(800);
  await page.locator('.lattice').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, 'resize-1024.png') });
  await page.setViewportSize({ width: 600, height: 900 });
  await page.waitForTimeout(800);
  await page.locator('.lattice').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, 'resize-600.png') });
  console.log('resize', await page.evaluate(() => ({ canvases: document.querySelectorAll('canvas').length, contexts: window.__upliftDiag.contexts() })));
  await page.close();
}

// Switching: frames while scrolling smoothly from the hero to the workbench, and back.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(page, 'switch');
  await page.goto(`${base}?diag`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(6000);
  const target = await page.evaluate(() => document.querySelector('#method .wb').getBoundingClientRect().top + scrollY - 60);
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), Math.round((target * i) / steps));
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(out, `switch-${String(i).padStart(2, '0')}.png`) });
  }
  console.log('switch', await page.evaluate(() => JSON.stringify(window.__upliftDiag.scenes().map((s) => [s.id, s.phase, s.mounts, s.disposals]))));
  await page.close();
}
await browser.close();
console.log(problems.length ? problems.join('\n') : 'no console errors');
