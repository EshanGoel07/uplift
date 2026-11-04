import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
// Phone captures of each model's first, middle and last steps (QA helper).
const dir = 'qa-screenshots/m15/g31/phone';
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:4173/uplift/', { waitUntil: 'networkidle' });
for (const [id, steps] of [['workspace', [1, 3, 5]], ['cutaway', [1, 3, 5]], ['grading', [0, 4, 9]]]) {
  for (const s of steps) {
    await page.evaluate(([i, n]) => document.querySelector(`#${i} .story__step[data-step="${n}"]`).scrollIntoView({ behavior: 'instant', block: 'start' }), [id, s]);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${dir}/${id}-${s}.png` });
  }
}
console.log('canvases', await page.locator('canvas').count());
await browser.close();
