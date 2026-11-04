import { chromium } from '@playwright/test';

// Lattice look check at rest, on hover and isolated (QA helper).
//   node scripts/qa/m15-lattice.mjs <label> [base-url]
const [label = 'after', base = 'http://localhost:4173/uplift/'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.text().includes('THREE')) errors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
await page.goto(`${base}?hero=runs`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: `qa-screenshots/m15/${label}-1-design.png` });
await page.waitForTimeout(6000);
await page.screenshot({ path: `qa-screenshots/m15/${label}-2-outcomes.png` });
const box = await page.locator('.lattice__canvas-wrap').boundingBox();
await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5);
await page.waitForTimeout(700);
console.log('hover readout', await page.locator('.lattice__bug-id').textContent());
await page.locator('.lattice__canvas-wrap').screenshot({ path: `qa-screenshots/m15/${label}-3-hover.png` });
await page.mouse.move(5, 895);
await page.getByRole('group', { name: 'Isolate a condition' }).getByRole('button').nth(2).click();
await page.waitForTimeout(800);
await page.screenshot({ path: `qa-screenshots/m15/${label}-4-condition.png` });
console.log('errors', errors);
await browser.close();
