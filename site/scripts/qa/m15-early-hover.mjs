import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

// Early first-hover probe (QA helper). Every trial is a new browser, so nothing is warm: shaders, fonts
// and raster all start cold. The readout stays visible. The pointer enters a set time after the stage
// exists, and only frames from that contact onward count.
//   node scripts/qa/m15-early-hover.mjs <out.json> [base-url] [--trials=4] [--contacts=0,500,1500,3000]
//     [--query=hero=runs] [--headed] [--still]
const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith('--'));
const [out = 'qa-screenshots/m15/early-hover.json', base = 'http://localhost:4173/uplift/'] = argv.filter((a) => !a.startsWith('--'));
const flag = (name, d) => flags.find((f) => f.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? d;
const trials = +flag('trials', 4);
const contacts = flag('contacts', '0,500,1500,3000').split(',').map(Number);
const query = flag('query', 'hero=runs');
const headed = flags.includes('--headed');
const still = flags.includes('--still');   // control: same window, pointer never enters the stage

const pct = (s, p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
const stats = (d) => {
  const s = [...d].sort((a, b) => a - b);
  return { frames: s.length, median: +pct(s, 50).toFixed(1), p95: +pct(s, 95).toFixed(1), p99: +pct(s, 99).toFixed(1), worst: +s[s.length - 1].toFixed(1), over50: s.filter((x) => x > 50).length, over100: s.filter((x) => x > 100).length };
};

async function trial(contact) {
  const browser = await chromium.launch({ headless: !headed, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    const r = (window.__sw = { d: [], long: [], prev: 0, on: false });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (r.on) r.long.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] });
    const f = (t) => { if (r.on && r.prev) r.d.push(t - r.prev); r.prev = t; requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  await page.mouse.move(5, 895);
  const t0 = Date.now();
  await page.goto(`${base}?${query}`, { waitUntil: 'commit' });
  const stage = page.locator('.lattice__canvas-wrap');
  await stage.waitFor();
  const stageAt = Date.now() - t0;
  const box = await stage.boundingBox();
  if (contact) await page.waitForTimeout(contact);
  await page.evaluate(() => { window.__sw.on = true; window.__sw.prev = 0; });
  const N = 120;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    if (!still) await page.mouse.move(box.x + box.width * (0.15 + 0.8 * t), box.y + box.height * (0.25 + 0.5 * (0.5 + 0.5 * Math.sin(t * Math.PI * 6))));
    await page.waitForTimeout(12);
  }
  const r = await page.evaluate(() => window.__sw);
  await browser.close();
  return { contact, stageAt, ...stats(r.d), longTasks: r.long };
}

const rows = [];
for (const contact of contacts) {
  for (let i = 0; i < trials; i++) {
    const r = await trial(contact);
    rows.push(r);
    console.log(JSON.stringify(r));
  }
}
const summary = contacts.map((contact) => {
  const t = rows.filter((r) => r.contact === contact);
  return { contact, trials: t.length, worst: Math.max(...t.map((r) => r.worst)), over50: t.reduce((a, r) => a + r.over50, 0), over100: t.reduce((a, r) => a + r.over100, 0), trialsWithStall: t.filter((r) => r.over50 > 0).length, longTasks: t.flatMap((r) => r.longTasks) };
});
console.log('SUMMARY', JSON.stringify(summary));
writeFileSync(out, JSON.stringify({ url: `${base}?${query}`, headed, still, summary, rows }, null, 2));
