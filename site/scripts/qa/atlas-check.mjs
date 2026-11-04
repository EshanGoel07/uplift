import { chromium } from '@playwright/test';

// Width sweep over the finished page: horizontal overflow, elements past the viewport, console errors.
//   node scripts/qa/atlas-check.mjs [base url]
const base = process.argv[2] ?? 'http://localhost:4173/uplift/';
const browser = await chromium.launch();
const bad = [];
for (const width of [375, 390, 600, 768, 1024, 1440, 1920]) {
  const page = await browser.newPage({ viewport: { width, height: width >= 1024 ? 900 : 844 }, reducedMotion: 'reduce' });
  page.on('pageerror', (e) => bad.push(`${width} error: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') bad.push(`${width} console: ${m.text()}`); });
  await page.goto(`${base}?nowebgl`, { waitUntil: 'networkidle' });
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height + 3000; y += 900) { await page.evaluate((t) => window.scrollTo(0, t), y); await page.waitForTimeout(90); }
  await page.waitForTimeout(600);
  const out = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const inScroller = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return true; } return false; };
    const hits = [];
    for (const el of document.querySelectorAll('main *')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > vw + 1 || r.left < -1) && !inScroller(el) && !el.closest('svg') && getComputedStyle(el).position !== 'fixed') hits.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${Math.round(r.right)}`);
    }
    return { sw: document.documentElement.scrollWidth, vw, hits: hits.slice(0, 6), h: document.documentElement.scrollHeight };
  });
  console.log(width, 'scrollW', out.sw, 'height', out.h, out.hits.length ? out.hits : 'clean');
  if (out.sw > out.vw) bad.push(`${width} page overflows by ${out.sw - out.vw}`);
  await page.close();
}
await browser.close();
console.log(bad.length ? bad.join('\n') : 'no problems');
