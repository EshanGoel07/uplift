import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Phase 5 review screenshots (QA helper, not part of the build).
//   node scripts/qa/page-shots.mjs <base-url> <out-dir> [--nowebgl]
// For each viewport it saves every later section in full, then the whole page.
const [,, base = 'http://localhost:5173/', outDir = 'qa-screenshots/page', flag = ''] = process.argv;
mkdirSync(outDir, { recursive: true });

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];
const SECTIONS = ['matrix', 'trust', 'limitations', 'built', 'future'];
const HIDE_FIXED = '.nav, .skip-link, .to-top { visibility: hidden !important; }';

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const problems = [];
for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  page.on('pageerror', (e) => problems.push(`${vp.name}: pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${vp.name}: console ${m.text()}`); });
  await page.goto(base + (flag === '--nowebgl' ? '?nowebgl' : ''), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  for (const id of SECTIONS) {
    const el = page.locator(`#${id}`);
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(900);
    await el.screenshot({ path: join(outDir, `${vp.name}-${id}.png`), style: HIDE_FIXED });
  }
  const footer = page.locator('footer').last();
  await footer.scrollIntoViewIfNeeded();
  await footer.screenshot({ path: join(outDir, `${vp.name}-footer.png`), style: HIDE_FIXED });
  // Walk the page once so every scroll-triggered reveal has fired before the full capture.
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += vp.height) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(250); }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(outDir, `${vp.name}-full.png`), fullPage: true, style: HIDE_FIXED });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) problems.push(`${vp.name}: page overflows horizontally by ${overflow}px`);
  await page.close();
}
await browser.close();
console.log(problems.length ? problems.join('\n') : 'ok: no console errors, no horizontal overflow');
