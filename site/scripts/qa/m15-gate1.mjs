import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Gate 1 visual review: the 924-run Lattice in every state, and the responsive set (QA helper).
//   node scripts/qa/m15-gate1.mjs [base-url]
const [base = 'http://localhost:4173/uplift/'] = process.argv.slice(2);
const dir = 'qa-screenshots/m15/gate1';
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const SETTLE = 7500;
const log = [];

async function open(width, height, query = 'hero=runs') {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)));
  await page.goto(`${base}?${query}`, { waitUntil: 'networkidle' });
  await page.mouse.move(2, height - 2);
  await page.waitForTimeout(SETTLE);
  return { page, errors };
}

async function selected(page) {
  return page.locator('.herosw button[aria-pressed="true"]').textContent();
}

for (const [width, height] of [[1440, 900], [1920, 1080]]) {
  const name = (s) => `${dir}/${width}-${s}.png`;
  let { page, errors } = await open(width, height);
  const hero = await selected(page);
  await page.screenshot({ path: name('1-default') });

  await page.locator('.seg-dark button', { hasText: 'Design' }).click();
  await page.waitForTimeout(2200);
  await page.screenshot({ path: name('2-design') });

  await page.locator('.seg-dark button', { hasText: 'Outcomes' }).click();
  await page.waitForTimeout(2600);
  await page.screenshot({ path: name('3-outcomes') });

  // One selected bug: the stepper moves the selection to the next bug.
  const next = page.locator('.lattice').getByRole('button', { name: 'Next bug' });
  for (let i = 0; i < 8; i++) await next.click();
  await page.waitForTimeout(900);
  const picked = await page.locator('.lattice__bug-id').textContent();
  await page.screenshot({ path: name('4-selected') });

  // One hovered column, away from the selection.
  const stage = await page.locator('.lattice__canvas-wrap').boundingBox();
  await page.mouse.move(stage.x + stage.width * 0.42, stage.y + stage.height * 0.5);
  await page.waitForTimeout(900);
  const over = await page.locator('.lattice__bug-id').textContent();
  await page.screenshot({ path: name('5-hovered') });
  await page.mouse.move(2, height - 2);
  await page.waitForTimeout(500);

  await page.getByRole('group', { name: 'Isolate a condition' }).getByRole('button', { name: 'Tips + hooks' }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: name('6-condition') });

  await page.getByRole('group', { name: 'Isolate a condition' }).getByRole('button', { name: 'All' }).click();
  await page.getByRole('group', { name: 'Isolate a repeat' }).getByRole('button', { name: 'R2' }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: name('7-repeat') });

  log.push({ width, hero, picked, over, errors });
  await page.close();
}

for (const [width, height] of [[375, 812], [390, 844], [600, 900], [768, 1024], [1024, 768], [1440, 900], [1920, 1080]]) {
  const { page, errors } = await open(width, height);
  const fig = page.locator('.lattice').first();
  await fig.scrollIntoViewIfNeeded();
  await page.evaluate(() => { const e = document.querySelector('.lattice'); window.scrollTo({ top: e.getBoundingClientRect().top + window.scrollY - 76, behavior: 'instant' }); });
  await page.waitForTimeout(1200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const webgl = await page.locator('canvas').count();
  await page.screenshot({ path: `${dir}/responsive-${width}.png` });
  log.push({ width, responsive: true, hero: await selected(page), overflow, canvases: webgl, errors });
  await page.close();
}
console.log(JSON.stringify(log, null, 1));
await browser.close();
