import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Rendering-cost probe (QA helper, not part of the build). It instruments WebGL from outside the app
// with an init script, so the same measurement runs on any build, old or new:
//   WebGL contexts created, <canvas> count, draw calls, rendered frames (rAF ticks with >= 1 draw),
//   GPU buffer uploads (bufferData/bufferSubData bytes), rAF rate and JS heap.
//   node scripts/qa/perf.mjs <base-url> <out.json> [shots-dir]
const [,, base = 'http://localhost:4173/uplift/', out = 'qa-screenshots/perf.json', shots = ''] = process.argv;

const probe = () => {
  const p = (window.__perf = { contexts: 0, draws: 0, uploads: 0, uploadBytes: 0 });
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...a) {
    const c = gc.call(this, type, ...a);
    if (c && /webgl/.test(String(type)) && !this.__perfCounted) { this.__perfCounted = true; p.contexts++; }
    return c;
  };
  for (const P of [window.WebGL2RenderingContext?.prototype, window.WebGLRenderingContext?.prototype].filter(Boolean)) {
    for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const o = P[f]; if (!o) continue;
      P[f] = function (...a) { p.draws++; return o.apply(this, a); };
    }
    for (const f of ['bufferData', 'bufferSubData']) {
      const o = P[f]; if (!o) continue;
      P[f] = function (...a) {
        p.uploads++;
        const d = a[f === 'bufferSubData' ? 2 : 1];
        if (d && typeof d === 'object') p.uploadBytes += a[4] !== undefined && d.BYTES_PER_ELEMENT ? a[4] * d.BYTES_PER_ELEMENT : (d.byteLength || 0);
        return o.apply(this, a);
      };
    }
  }
};

/** Samples for `ms`: rAF/s, rendered frames/s (rAF ticks in which WebGL drew), draws/s, upload KB/s. */
const sample = (page, ms = 3000) => page.evaluate((ms) => new Promise((res) => {
  const p = window.__perf; const d0 = p.draws, u0 = p.uploadBytes, n0 = p.uploads;
  let ticks = 0, renders = 0, last = p.draws, worst = 0, prev = performance.now(); const t0 = prev;
  const f = () => {
    const now = performance.now(); worst = Math.max(worst, now - prev); prev = now; ticks++;
    if (p.draws !== last) { renders++; last = p.draws; }
    if (now - t0 < ms) requestAnimationFrame(f);
    else {
      const s = (now - t0) / 1000;
      res({ rafPerS: +(ticks / s).toFixed(1), renderFramesPerS: +(renders / s).toFixed(1), drawsPerS: Math.round((p.draws - d0) / s),
        uploadKBPerS: +((p.uploadBytes - u0) / 1024 / s).toFixed(1), uploadsPerS: Math.round((p.uploads - n0) / s), worstFrameMs: Math.round(worst) });
    }
  };
  requestAnimationFrame(f);
}), ms);

const state = (page) => page.evaluate(() => ({
  canvases: document.querySelectorAll('canvas').length, contexts: window.__perf.contexts,
  heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
}));

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(probe);
await page.goto(base, { waitUntil: 'networkidle' });
const results = { url: base, scenarios: {} };
const go = async (sel) => { await page.evaluate((s) => (s === 'top' ? window.scrollTo(0, 0) : s === 'bottom' ? window.scrollTo(0, document.body.scrollHeight) : document.querySelector(s)?.scrollIntoView({ block: 'start' })), sel); };
const moving = async (fn) => {
  // Sweep the pointer across the middle of the viewport while sampling.
  let on = true;
  const mover = (async () => { let i = 0; while (on) { await page.mouse.move(500 + (i % 40) * 20, 380 + ((i * 7) % 120)); i++; await page.waitForTimeout(16); } })();
  const r = await fn(); on = false; await mover; return r;
};
const record = async (name, sel, opts = {}) => {
  await go(sel); await page.mouse.move(5, 895); await page.waitForTimeout(opts.settle ?? 3000);
  results.scenarios[name] = { ...(opts.pointer ? await moving(() => sample(page)) : await sample(page)), ...(await state(page)) };
  console.log(name.padEnd(22), JSON.stringify(results.scenarios[name]));
};

await record('hero idle', 'top', { settle: 7000 });
await record('hero pointer moving', 'top', { settle: 500, pointer: true });
await record('results idle', '#results');
await record('results pointer moving', '#results', { settle: 500, pointer: true });
await record('workbench idle', '#method', { settle: 3500 });
await record('workbench pointer', '#method', { settle: 500, pointer: true });
await record('footer idle', 'bottom');

// Switching: five hero <-> workbench round trips, then the context/canvas count and heap.
const before = await state(page);
for (let i = 0; i < 5; i++) { await go('#method'); await page.waitForTimeout(700); await go('top'); await page.waitForTimeout(700); }
await page.waitForTimeout(1500);
results.switching = { before, after: await state(page) };
console.log('switching x5'.padEnd(22), JSON.stringify(results.switching));

if (shots) {
  mkdirSync(shots, { recursive: true });
  for (const vp of [{ w: 1440, h: 900 }, { w: 390, h: 844 }]) {
    const p = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
    await p.goto(base, { waitUntil: 'networkidle' }); await p.waitForTimeout(6000);
    await p.screenshot({ path: join(shots, `${vp.w}-hero.png`) });
    await p.evaluate(() => document.querySelector('#method')?.scrollIntoView({ block: 'start' })); await p.waitForTimeout(2500);
    await p.screenshot({ path: join(shots, `${vp.w}-method.png`) });
    await p.close();
  }
}
await browser.close();
writeFileSync(out, JSON.stringify(results, null, 2));
