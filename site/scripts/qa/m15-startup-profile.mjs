import { chromium } from '@playwright/test';

// Where the main thread spends page startup (QA helper): CPU profile of the first seconds in a cold
// browser, with the heaviest functions by self time and the long tasks it saw.
//   node scripts/qa/m15-startup-profile.mjs <url> [--trials=3] [--ms=2500]
const argv = process.argv.slice(2);
const flag = (n, d) => argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const url = argv.find((a) => !a.startsWith('--'));
const trials = +flag('trials', 3), ms = +flag('ms', 2500);
const totals = new Map();
const longest = [];
for (let t = 0; t < trials; t++) {
  const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => { window.__long = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ entryTypes: ['longtask'] }); });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await cdp.send('Profiler.start');
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForTimeout(ms);
  const { profile } = await cdp.send('Profiler.stop');
  longest.push(await page.evaluate(() => window.__long));
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  profile.samples.forEach((id, i) => {
    const n = byId.get(id), f = n.callFrame;
    const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop().replace(/-[\w-]{8}\.js/, '.js')}:${f.lineNumber}:${f.columnNumber}`;
    totals.set(key, (totals.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000 / trials);
  });
  await browser.close();
}
console.log('long tasks per trial [start, ms]:', JSON.stringify(longest));
const rows = [...totals].filter(([k]) => !/^\((idle|root)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 16);
for (const [k, v] of rows) console.log(v.toFixed(0).padStart(6), 'ms', k.slice(0, 80));
