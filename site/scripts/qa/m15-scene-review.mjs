import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Captures every state of one story model at each desktop size, with real wheel scrolling (QA helper).
//   node scripts/qa/m15-scene-review.mjs <section-id> <steps> [label] [base-url]
const [section = 'workspace', list = '0,1,2,3,4', label = 'g3', base = 'http://localhost:4173/uplift/'] = process.argv.slice(2);
const dir = `qa-screenshots/m15/${label}`;
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  for (const [width, height] of [[1440, 900], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    await page.goto(`${base}?diag`, { waitUntil: 'networkidle' });
    for (const s of list.split(',')) {
      await page.evaluate(([id, i]) => document.querySelector(`#${id} .story__step[data-step="${i}"]`).scrollIntoView({ behavior: 'instant', block: 'center' }), [section, s]);
      await page.waitForTimeout(2800);
      await page.screenshot({ path: `${dir}/${section}-${width}-${s}.png` });
    }
    console.log(width, JSON.stringify(await page.evaluate((id) => window.__upliftDiag.assembly(id), section)), 'errors', errors.slice(0, 2));
    await page.close();
  }
} finally { await browser.close(); }
