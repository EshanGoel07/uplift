import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

// Fresh-page first-hover probe (QA helper). Every trial is a new page; only the first sweep counts.
// A control hides the readout, which earlier traces implicated. Same machine and flags as sweep.mjs.
//   node scripts/qa/m15-firsthover.mjs <out.json> [base-url] [--trials=6] [--query=hero=runs]
const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith('--'));
const [out = 'qa-screenshots/m15/firsthover.json', base = 'http://localhost:4173/uplift/'] = argv.filter((a) => !a.startsWith('--'));
const trials = +(flags.find((f) => f.startsWith('--trials='))?.slice(9) ?? 6);
const query = flags.find((f) => f.startsWith('--query='))?.slice(8) ?? 'hero=runs';
const pct = (s, p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
const stats = (d) => { const s = [...d].sort((a, b) => a - b); return { frames: s.length, median: +pct(s, 50).toFixed(1), p95: +pct(s, 95).toFixed(1), p99: +pct(s, 99).toFixed(1), worst: +s[s.length - 1].toFixed(1), over50: s.filter((x) => x > 50).length, over100: s.filter((x) => x > 100).length }; };

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
async function trial(hideReadout) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}?${query}`, { waitUntil: 'networkidle' });
  if (hideReadout) await page.addStyleTag({ content: '.lattice__readout{visibility:hidden!important}' });
  await page.mouse.move(5, 895);
  await page.waitForTimeout(8000);
  const box = await page.locator('.lattice__canvas-wrap').boundingBox();
  await page.evaluate(() => {
    const r = (window.__sw = { d: [], long: [], prev: 0 });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) r.long.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] });
    const f = (t) => { if (r.prev) r.d.push(t - r.prev); r.prev = t; requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  const N = 120;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    await page.mouse.move(box.x + box.width * t, box.y + box.height * (0.3 + 0.4 * (0.5 + 0.5 * Math.sin(t * Math.PI * 6))));
    await page.waitForTimeout(12);
  }
  const r = await page.evaluate(() => window.__sw);
  await page.close();
  return { ...stats(r.d), longTasks: r.long };
}
const result = { url: `${base}?${query}`, withReadout: [], readoutHidden: [] };
for (let i = 0; i < trials; i++) {
  result.withReadout.push(await trial(false)); console.log('readout ', JSON.stringify(result.withReadout.at(-1)));
  result.readoutHidden.push(await trial(true)); console.log('hidden  ', JSON.stringify(result.readoutHidden.at(-1)));
}
await browser.close();
writeFileSync(out, JSON.stringify(result, null, 2));
