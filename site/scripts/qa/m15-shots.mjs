import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Section captures at the M15 viewports (QA helper, not part of the build).
//   node scripts/qa/m15-shots.mjs <label> [base-url] [--only=1440x900,390x844] [--query=hero=runs]
const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith('--'));
const [label = 'before', base = 'http://localhost:4173/uplift/'] = argv.filter((a) => !a.startsWith('--'));
const only = flags.find((f) => f.startsWith('--only='))?.slice(7).split(',');
const query = flags.find((f) => f.startsWith('--query='))?.slice(8) ?? '';
const VIEWPORTS = [[375, 812], [390, 844], [600, 900], [768, 1024], [900, 900], [1024, 768], [1240, 800], [1440, 900], [1920, 1080], [2560, 1300]]
  .filter(([w, h]) => !only || only.includes(`${w}x${h}`));

const dir = `qa-screenshots/m15/${label}`;
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const [width, height] of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await page.goto(base + (query ? `?${query}` : ''), { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${dir}/${width}-00-top.png` });
  const ids = await page.evaluate(() => [...document.querySelectorAll('main section[id], main [data-chapter], section[id]')].map((e) => e.id).filter(Boolean));
  let n = 1;
  for (const id of [...new Set(ids)]) {
    await page.evaluate((i) => document.getElementById(i)?.scrollIntoView({ behavior: 'instant', block: 'start' }), id);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${dir}/${width}-${String(n++).padStart(2, '0')}-${id}.png` });
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(`${width}x${height}`, 'sections', ids.length, 'overflow', overflow, 'errors', errors.length, errors.slice(0, 2));
  await page.close();
}
await browser.close();
