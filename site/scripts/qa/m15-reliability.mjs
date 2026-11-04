import { chromium } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Cold loads and full forward/reverse cycles in headed Chrome with real wheel input, reading the stage's
// real pixels. Every failure is recorded individually (QA helper). One browser at a time.
//   node scripts/qa/m15-reliability.mjs <out.json> <base-url> [--cold=20] [--cycles=10] [--chrome]
const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith('--'));
const [out = 'qa-screenshots/m15/reliability.json', base = 'http://localhost:4173/uplift/'] = argv.filter((a) => !a.startsWith('--'));
const flag = (n, d) => +(flags.find((f) => f.startsWith(`--${n}=`))?.split('=')[1] ?? d);
const channel = flags.includes('--chrome') ? 'chrome' : undefined;
const LIT_MIN = [5, 4, 5, 8, 10];
const viewport = { width: 1440, height: 900 };

async function open() {
  const profile = mkdtempSync(join(tmpdir(), 'uplift-rel-'));
  const ctx = await chromium.launchPersistentContext(profile, { headless: false, channel, viewport });
  const decoder = await ctx.newPage();
  const page = await ctx.newPage();
  await page.bringToFront();
  const lit = async () => {
    const box = await page.locator('#story .story__stage').boundingBox();
    const y = Math.max(0, box.y), h = Math.min(box.y + box.height, viewport.height) - y;
    const png = await page.screenshot({ clip: { x: 0, y, width: viewport.width, height: h } });
    return decoder.evaluate(async (b64) => {
      const s = atob(b64), u = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
      const m = await createImageBitmap(new Blob([u], { type: 'image/png' }));
      const c = new OffscreenCanvas(m.width, m.height), x = c.getContext('2d');
      x.drawImage(m, 0, 0);
      const d = x.getImageData(0, 0, Math.round(m.width * 0.66), m.height).data;
      let k = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 150) k++;
      return +((100 * k) / (d.length / 4)).toFixed(1);
    }, png.toString('base64'));
  };
  const close = async () => { await ctx.close(); rmSync(profile, { recursive: true, force: true }); };
  return { page, lit, close };
}

const active = (page) => page.evaluate(() => +(document.querySelector('#story .story__step.is-active')?.dataset.step ?? -1));
const story = (page) => page.evaluate(() => window.__upliftDiag?.story?.() ?? null);

async function wheelTo(page, step, dir) {
  await page.mouse.move(400, 450);
  for (let i = 0; i < 160 && (await active(page)) !== step; i++) { await page.mouse.wheel(0, dir * 120); await page.waitForTimeout(70); }
}

/** Waits for the scene to settle on the step, then requires its pixels. */
async function check(page, lit, step, where, failures) {
  const t0 = Date.now();
  let s = null;
  while (Date.now() - t0 < 12000) { s = await story(page); if (s?.settledAt === step) break; await page.waitForTimeout(100); }
  const share = await lit();
  const fallback = await page.locator('#story .story__canvas .story__figure').count();
  const ok = s?.settledAt === step && share >= LIT_MIN[step] && !fallback;
  if (!ok) failures.push({ where, step, settledAt: s?.settledAt ?? null, view: s?.view ?? null, lit: share, fallback });
  return { ok, share, ms: Date.now() - t0 };
}

const results = { base, channel: channel ?? 'bundled', cold: [], cycles: [], failures: [] };
const coldN = flag('cold', 20), cycleN = flag('cycles', 10);

for (let n = 1; n <= coldN; n++) {
  const { page, lit, close } = await open();
  try {
    await page.goto(`${base}?diag${n % 2 ? '' : '&hero=runs'}`, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    if (n % 2 === 0) { await page.locator('.herosw button', { hasText: '77 bugs' }).click(); await page.waitForTimeout(1000); }
    await page.mouse.move(400, 450);
    for (let i = 0; i < 60 && (await page.evaluate(() => document.querySelector('#story .story__stage').getBoundingClientRect().top)) > 90; i++) { await page.mouse.wheel(0, 140); await page.waitForTimeout(60); }
    const a = await check(page, lit, await active(page), `cold ${n}`, results.failures);
    results.cold.push({ n, ...a });
    console.log('cold', n, JSON.stringify(a));
  } catch (e) { results.failures.push({ where: `cold ${n}`, error: String(e).slice(0, 200) }); console.log('cold', n, 'ERROR', String(e).slice(0, 120)); }
  await close();
}

if (cycleN) {
  const { page, lit, close } = await open();
  try {
    await page.goto(`${base}?diag`, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    await page.mouse.move(400, 450);
    for (let i = 0; i < 60 && (await page.evaluate(() => document.querySelector('#story .story__stage').getBoundingClientRect().top)) > 90; i++) { await page.mouse.wheel(0, 140); await page.waitForTimeout(60); }
    for (let c = 1; c <= cycleN; c++) {
      let good = 0;
      for (const [steps, dir] of [[[0, 1, 2, 3, 4], 1], [[3, 2, 1, 0], -1]]) {
        for (const step of steps) {
          await wheelTo(page, step, dir);
          if ((await check(page, lit, step, `cycle ${c} ${dir > 0 ? 'forward' : 'reverse'}`, results.failures)).ok) good++;
        }
      }
      results.cycles.push({ c, good, of: 9 });
      console.log('cycle', c, `${good}/9`);
    }
  } catch (e) { results.failures.push({ where: 'cycles', error: String(e).slice(0, 200) }); console.log('cycles ERROR', String(e).slice(0, 120)); }
  await close();
}

writeFileSync(out, JSON.stringify(results, null, 2));
console.log('SUMMARY cold', results.cold.filter((r) => r.ok).length, '/', coldN, 'cycles', results.cycles.reduce((a, c) => a + c.good, 0), '/', cycleN * 9, 'failures', results.failures.length);
for (const f of results.failures.slice(0, 12)) console.log('FAIL', JSON.stringify(f));
