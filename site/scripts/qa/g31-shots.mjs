import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Gate 3.1 review captures. Each item is `step` or `step:object`, selecting that object by its title.
//   node scripts/qa/g31-shots.mjs <section> <items, comma separated> [label] [widths] [query] [base]
const [section = 'workspace', list = '0', label = 'g31/wip', widths = '1440', query = '', base = 'http://localhost:4173/uplift/'] = process.argv.slice(2);
const dir = `qa-screenshots/m15/${label}`;
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  for (const w of widths.split(',').map(Number)) {
    const page = await browser.newPage({ viewport: { width: w, height: w === 1920 ? 1080 : 900 } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
    await page.goto(`${base}?diag${query ? `&${query}` : ''}`, { waitUntil: 'networkidle' });
    for (const item of list.split(',')) {
      const [s, obj] = item.split(':');
      await page.evaluate(([id, i]) => document.querySelector(`#${id} .story__step[data-step="${i}"]`).scrollIntoView({ behavior: 'instant', block: 'center' }), [section, s]);
      await page.waitForTimeout(2600);
      if (obj) {
        await page.locator(`#${section} .assembly__parts button`).filter({ hasText: obj }).first().evaluate((b) => b.click());
        await page.waitForTimeout(2400);
      }
      await page.screenshot({ path: `${dir}/${section}-${w}-${item.replace(/[^a-zA-Z0-9-]+/g, '_')}.png` });
      if (obj) { await page.locator(`#${section} .assembly__parts button`).filter({ hasText: obj }).first().evaluate((b) => b.click()); await page.waitForTimeout(300); }
    }
    console.log(w, JSON.stringify(await page.evaluate((id) => window.__upliftDiag?.assembly(id), section)), 'errors', errors.slice(0, 3));
    await page.close();
  }
} finally { await browser.close(); }
