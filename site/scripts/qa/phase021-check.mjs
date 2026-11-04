import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Phase 02.1 closeout (QA helper, not part of the build): the real network requests at each width
// through a full page scroll, and responsive screenshots of the lattice and the Workbench.
//   node scripts/qa/phase021-check.mjs <base-url> <out-dir>
const [,, base = 'http://localhost:4173/uplift/', out = 'qa-screenshots/phase021'] = process.argv;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const result = {};
const problems = [];
for (const [w, h] of [[375, 812], [390, 844], [600, 900], [768, 1024], [1024, 800], [1440, 900], [1920, 1080]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => problems.push(`${w}: pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${w}: console ${m.text()}`); });
  const reqs = [];
  page.on('response', async (r) => {
    const u = r.url().split('/').pop();
    if (!/\.(js|css)$/.test(u)) return;
    const s = await r.request().sizes().catch(() => null);
    reqs.push({ file: u.replace(/-[\w-]{8}\./, '.'), kB: s ? +((s.responseBodySize + s.responseHeadersSize) / 1024).toFixed(1) : null });
  });
  await page.goto(`${base}?diag`, { waitUntil: 'networkidle' });
  await page.locator('.lattice__canvas-wrap').scrollIntoViewIfNeeded();
  await page.waitForTimeout(3500);
  await page.screenshot({ path: join(out, `${w}-lattice.png`) });
  const atHero = reqs.map((r) => r.file);
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < height; y += 700) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(80); }
  await page.evaluate(() => document.querySelector('#method .wb')?.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(1800);
  await page.screenshot({ path: join(out, `${w}-workbench.png`) });
  result[w] = {
    atHero, afterFullScroll: reqs,
    canvases: await page.evaluate(() => document.querySelectorAll('canvas').length),
    contexts: await page.evaluate(() => window.__upliftDiag?.contexts()),
    scenes: await page.evaluate(() => window.__upliftDiag?.scenes().map((s) => `${s.id}:${s.phase}`)),
    bounds: await page.evaluate(() => window.__upliftDiag?.workbenchBounds()),
    overflowX: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  };
  console.log(w, JSON.stringify(result[w]));
  await page.close();
}
await browser.close();
writeFileSync(join(out, 'network.json'), JSON.stringify(result, null, 2));
console.log(problems.length ? problems.join('\n') : 'no console errors');
