import { chromium } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Cold loads and full forward/reverse cycles over the three story models, in headed Chrome with real wheel
// input, reading the stage's real pixels. Every failure is recorded individually (QA helper).
//   node scripts/qa/g5-models.mjs <out.json> <base-url> [--cold=20] [--cycles=10]
const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith('--'));
const [out = 'qa-screenshots/m15/g5-models.json', base = 'http://localhost:4173/uplift/'] = argv.filter((a) => !a.startsWith('--'));
const flag = (n, d) => +(flags.find((f) => f.startsWith(`--${n}=`))?.split('=')[1] ?? d);
const viewport = { width: 1440, height: 900 };
const MODELS = [['workspace', 6], ['cutaway', 6], ['grading', 10]];

async function open() {
  const profile = mkdtempSync(join(tmpdir(), 'uplift-g5-'));
  const ctx = await chromium.launchPersistentContext(profile, { headless: false, viewport });
  const decoder = await ctx.newPage();
  const page = await ctx.newPage();
  await page.bringToFront();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  const lit = async (id) => {
    const box = await page.locator(`#${id} .story__stage`).boundingBox();
    const y = Math.max(0, box.y), h = Math.min(box.y + box.height, viewport.height) - y;
    if (h < 300) return -1;
    const png = await page.screenshot({ clip: { x: 0, y, width: viewport.width, height: h } });
    return decoder.evaluate(async (b64) => {
      const s = atob(b64), u = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
      const m = await createImageBitmap(new Blob([u], { type: 'image/png' }));
      const c = new OffscreenCanvas(m.width, m.height), x = c.getContext('2d');
      x.drawImage(m, 0, 0);
      const d = x.getImageData(0, 0, Math.round(m.width * 0.66), m.height).data;
      let k = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 70) k++;
      return +((100 * k) / (d.length / 4)).toFixed(1);
    }, png.toString('base64'));
  };
  const close = async () => { await ctx.close(); rmSync(profile, { recursive: true, force: true }); };
  return { page, lit, close, errors };
}

const active = (page, id) => page.evaluate((k) => +(document.querySelector(`#${k} .story__step.is-active`)?.dataset.step ?? -1), id);

async function reach(page, id, step) {
  await page.mouse.move(420, 480);
  await page.locator(`#${id} .story__step[data-step="${step}"]`).evaluate((el) => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
  for (let i = 0; i < 30 && (await active(page, id)) !== step; i++) {
    await page.mouse.wheel(0, (await active(page, id)) < step ? 120 : -120);
    await page.waitForTimeout(60);
  }
}

async function check(s, id, step, where, failures) {
  const t0 = Date.now();
  let a = null;
  while (Date.now() - t0 < 15000) { a = await s.page.evaluate((k) => window.__upliftDiag?.assembly?.(k) ?? null, id); if (a?.settledAt === step) break; await s.page.waitForTimeout(100); }
  const share = await s.lit(id);
  const fallback = await s.page.locator(`#${id} .story__canvas .story__figure`).count();
  const ok = a?.settledAt === step && share >= 1.5 && !fallback;
  if (!ok) failures.push({ where, id, step, settledAt: a?.settledAt ?? null, lit: share, fallback });
  return ok;
}

const failures = [];
let coldOk = 0, cycleOk = 0, cycleAll = 0;
const cold = flag('cold', 20), cycles = flag('cycles', 10);
for (let i = 0; i < cold; i++) {
  const s = await open();
  await s.page.goto(`${base}?diag`, { waitUntil: 'networkidle' });
  let ok = true;
  for (const [id] of MODELS) { await reach(s.page, id, 1); ok = (await check(s, id, 1, `cold ${i}`, failures)) && ok; }
  if (s.errors.length) { ok = false; failures.push({ where: `cold ${i}`, errors: s.errors.slice(0, 2) }); }
  coldOk += ok ? 1 : 0;
  await s.close();
  console.log('cold', i + 1, ok);
}
const s = await open();
await s.page.goto(`${base}?diag`, { waitUntil: 'networkidle' });
for (let c = 0; c < cycles; c++) {
  for (const [id, n] of MODELS) {
    const order = [...Array(n).keys(), ...[...Array(n - 1).keys()].reverse()];
    for (const step of order) {
      await reach(s.page, id, step);
      cycleAll++;
      if (await check(s, id, step, `cycle ${c}`, failures)) cycleOk++;
    }
  }
  console.log('cycle', c + 1, `${cycleOk}/${cycleAll}`);
}
await s.close();
const result = { base, cold: `${coldOk}/${cold}`, cycles: `${cycleOk}/${cycleAll}`, failures };
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, failures: failures.length }));
