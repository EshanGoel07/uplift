import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

// Hero pointer-sweep frame timing (QA helper, not part of the build). Runs the same ten controlled
// sweeps across the lattice stage on any build, and reports frame-time percentiles from rAF deltas.
// With --trace it also records a Chrome trace and lists what ran during each long frame, per thread,
// which separates main-thread, compositor and GPU stalls.
//   node scripts/qa/sweep.mjs <base-url> <out.json> [--trace] [--steps] [--sweeps=10] [--rest=600] [--query=x=foo]
const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const [base = 'http://localhost:4173/uplift/', out = 'qa-screenshots/sweep.json'] = args.filter((a) => !a.startsWith('--'));
const trace = flags.includes('--trace');
const sweeps = +(flags.find((f) => f.startsWith('--sweeps='))?.split('=')[1] ?? 10);
const query = flags.find((f) => f.startsWith('--query='))?.slice(8) ?? '';
const rest = +(flags.find((f) => f.startsWith('--rest='))?.split('=')[1] ?? 600);

const pct = (s, p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
const stats = (d) => {
  const s = [...d].sort((a, b) => a - b);
  return { frames: s.length, median: +pct(s, 50).toFixed(1), p95: +pct(s, 95).toFixed(1), p99: +pct(s, 99).toFixed(1),
    worst: +s[s.length - 1].toFixed(1), over50: s.filter((x) => x > 50).length, over100: s.filter((x) => x > 100).length };
};

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base + (query ? `?${query}` : ''), { waitUntil: 'networkidle' });
await page.mouse.move(5, 895);
// Settle: build-in, the automatic switch to outcomes, and its colour sweep.
await page.waitForTimeout(8000);
const box = await page.locator('.lattice__canvas-wrap').boundingBox();

const cdp = await page.context().newCDPSession(page);
const events = [];
if (trace) {
  cdp.on('Tracing.dataCollected', (e) => events.push(...e.value));
  await cdp.send('Tracing.start', {
    transferMode: 'ReportEvents',
    traceConfig: { includedCategories: ['devtools.timeline', 'blink', 'cc', 'viz', 'gpu', 'toplevel', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'disabled-by-default-gpu.service'] },
  });
}

await page.evaluate(() => {
  const r = (window.__sw = { d: [], on: false, prev: 0 });
  const f = (t) => { if (r.on && r.prev) r.d.push(t - r.prev); r.prev = t; requestAnimationFrame(f); };
  requestAnimationFrame(f);
});

const per = [];
for (let s = 0; s < sweeps; s++) {
  // Rest off the stage, then one sweep: left to right through both blocks, gently weaving in y.
  await page.mouse.move(5, 895);
  await page.waitForTimeout(rest);
  await page.evaluate(() => { window.__sw.d = []; window.__sw.prev = 0; window.__sw.on = true; });
  const N = 120;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    await page.mouse.move(box.x + box.width * t, box.y + box.height * (0.3 + 0.4 * (0.5 + 0.5 * Math.sin(t * Math.PI * 6))));
    await page.waitForTimeout(12);
  }
  const d = await page.evaluate(() => { window.__sw.on = false; return window.__sw.d; });
  per.push(d);
  console.log(`sweep ${s + 1}`.padEnd(10), JSON.stringify(stats(d)));
}
const pooled = stats(per.flat());
console.log('pooled'.padEnd(10), JSON.stringify(pooled));

// Where each long frame fell, as a fraction of its sweep's duration (0 = stage left, 1 = stage right).
const stallsAt = per.map((d) => { const T = d.reduce((a, b) => a + b, 0); let t = 0; const o = []; for (const x of d) { if (x > 50) o.push([+(t / T).toFixed(2), Math.round(x)]); t += x; } return o; });
const result = { url: base + (query ? `?${query}` : ''), sweeps, pooled, perSweep: per.map(stats), stallsAt };

// The keyboard path: stepping through bugs in each view, and toggling the view. Long frames only.
if (flags.includes('--steps')) {
  await page.mouse.move(5, 895);
  await page.evaluate(() => { const g = (window.__g = []); let p = 0; const f = (t) => { if (p && t - p > 33) g.push(Math.round(t - p)); p = t; requestAnimationFrame(f); }; requestAnimationFrame(f); });
  const run = async (fn, n) => { await page.evaluate(() => { window.__g.length = 0; }); for (let i = 0; i < n; i++) { await fn(i); await page.waitForTimeout(700); } return page.evaluate(() => [...window.__g]); };
  const next = page.locator('.lattice').getByRole('button', { name: 'Next bug' });
  const seg = page.locator('.lattice .seg-dark button');
  result.steps = { outcomes: await run(() => next.click(), 8), toggle: await run((i) => seg.nth(i % 2).click(), 6) };
  await seg.nth(0).click(); await page.waitForTimeout(2500);
  result.steps.design = await run(() => next.click(), 8);
  console.log('long frames >33ms', JSON.stringify(result.steps));
}

if (trace) {
  await new Promise((res) => { cdp.once('Tracing.tracingComplete', res); cdp.send('Tracing.end'); });
  // Name the threads.
  const pName = new Map(), tName = new Map();
  for (const e of events) {
    if (e.ph !== 'M') continue;
    if (e.name === 'process_name') pName.set(e.pid, e.args.name);
    if (e.name === 'thread_name') tName.set(`${e.pid}:${e.tid}`, e.args.name);
  }
  const where = (e) => `${pName.get(e.pid) ?? e.pid}/${tName.get(`${e.pid}:${e.tid}`) ?? e.tid}`;
  // Long frames: gaps between successive animation frames on the page's main thread.
  const raf = events.filter((e) => e.ph === 'X' && e.name === 'FireAnimationFrame').sort((a, b) => a.ts - b.ts);
  const gaps = [];
  for (let i = 1; i < raf.length; i++) {
    const g = (raf[i].ts - raf[i - 1].ts) / 1000;
    if (g > 33) gaps.push({ from: raf[i - 1].ts, to: raf[i].ts, ms: Math.round(g) });
  }
  const slices = events.filter((e) => e.ph === 'X' && e.dur > 2000);
  const report = gaps.sort((a, b) => b.ms - a.ms).slice(0, 8).map((g) => {
    const byThread = {};
    for (const e of slices) {
      if (e.ts + e.dur < g.from || e.ts > g.to) continue;
      (byThread[where(e)] ??= []).push([e.name, +(e.dur / 1000).toFixed(1)]);
    }
    for (const k of Object.keys(byThread)) byThread[k] = byThread[k].sort((a, b) => b[1] - a[1]).slice(0, 7);
    return { gapMs: g.ms, byThread };
  });
  result.trace = { events: events.length, rafs: raf.length, gaps: gaps.length, worst: report };
  console.log(JSON.stringify(result.trace, null, 1));
  writeFileSync(out.replace(/\.json$/, '.trace.json'), JSON.stringify({ traceEvents: events }));
}
await browser.close();
writeFileSync(out, JSON.stringify(result, null, 2));
