import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Redesign Phase 01 review screenshots (QA helper, not part of the build): every major section at
// the five review widths, plus a whole-page strip per width to check surface continuity.
//   node scripts/qa/identity-shots.mjs <base-url> <out-dir> [--nowebgl]
const [,, base = 'http://localhost:4173/uplift/', outDir = 'qa-screenshots/identity', flag = ''] = process.argv;
mkdirSync(outDir, { recursive: true });

const WIDTHS = [
  { name: '375', width: 375, height: 812 },
  { name: '390', width: 390, height: 844 },
  { name: '768', width: 768, height: 1024 },
  { name: '1440', width: 1440, height: 900 },
  { name: '1920', width: 1920, height: 1080 },
];
const SECTIONS = ['overview', 'results', 'method', 'explorer', 'matrix', 'explorer-all', 'trust', 'built', 'limitations', 'future'];

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const problems = [];
for (const vp of WIDTHS) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  page.on('pageerror', (e) => problems.push(`${vp.name}: pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${vp.name}: console ${m.text()}`); });
  await page.goto(base + (flag === '--nowebgl' ? '?nowebgl' : ''), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  for (const id of SECTIONS) {
    await page.evaluate((i) => document.getElementById(i)?.scrollIntoView({ block: 'start' }), id);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(outDir, `${vp.name}-${id}.png`) });
  }
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(outDir, `${vp.name}-footer.png`) });
  // Background continuity: the computed background of every top-level section and the footer.
  const bgs = await page.evaluate(() => [...document.querySelectorAll('main > section, footer')]
    .map((el) => `${el.id || el.tagName.toLowerCase()}: ${getComputedStyle(el).backgroundColor}`));
  console.log(vp.name, bgs.join(' | '));
  await page.close();
}
await browser.close();
console.log(problems.length ? problems.join('\n') : 'no page errors');
