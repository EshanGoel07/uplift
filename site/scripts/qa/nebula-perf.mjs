import { chromium } from '@playwright/test';

// Nebula frame timing: ambient drift, then pointer sweeps across the stage, on real GPU flags.
//   node scripts/qa/nebula-perf.mjs [base url]
const base = process.argv[2] ?? 'http://localhost:4173/uplift/';
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${base}?diag`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);
const box = await page.locator('.lattice__stage').boundingBox();
const record = () => page.evaluate(() => new Promise((done) => {
  const d = []; let last = performance.now(); let on = true;
  const tick = (t) => { d.push(t - last); last = t; if (on) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.__stop = () => { on = false; done(d.slice(1)); };
}));
const stats = (d) => { const s = [...d].sort((a, b) => a - b); const p = (q) => +s[Math.floor(q * (s.length - 1))].toFixed(1); return { n: s.length, median: p(0.5), p95: p(0.95), p99: p(0.99), worst: +s[s.length - 1].toFixed(1), over50: s.filter((x) => x > 50).length }; };
const all = [];
for (let i = 0; i < 6; i++) {
  await page.mouse.move(5, 895);
  await page.waitForTimeout(500);
  const rec = record();
  for (let k = 0; k <= 80; k++) { await page.mouse.move(box.x + (box.width * k) / 80, box.y + box.height * (0.35 + 0.25 * Math.sin(k / 9))); await page.waitForTimeout(16); }
  await page.evaluate(() => window.__stop());
  const d = await rec; all.push(...d);
  console.log(`sweep ${i + 1}`, JSON.stringify(stats(d)));
}
console.log('pooled', JSON.stringify(stats(all)));
await page.mouse.move(5, 895);
await page.waitForTimeout(11000);
const f0 = await page.evaluate(() => window.__upliftDiag.frames());
await page.waitForTimeout(1500);
console.log('idle frames after drift ends:', (await page.evaluate(() => window.__upliftDiag.frames())) - f0);
await browser.close();
