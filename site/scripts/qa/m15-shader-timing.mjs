import { chromium } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// How long the GPU takes to link each shader program, and how long the page goes without a frame, in a
// cold headed browser (QA helper). Nothing in the site is changed: WebGL calls are wrapped from outside.
//   node scripts/qa/m15-shader-timing.mjs <label> [base-url] [--chrome] [--headless]
const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith('--'));
const [label = 'run', base = 'http://localhost:4173/uplift/'] = argv.filter((a) => !a.startsWith('--'));
const profile = mkdtempSync(join(tmpdir(), 'uplift-cold-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: flags.includes('--headless'), channel: flags.includes('--chrome') ? 'chrome' : undefined,
  viewport: { width: 1878, height: 902 },
});
try {
  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.addInitScript(() => {
    const log = (window.__sh = { links: [], sync: [], gaps: [], marks: [] });
    const P = WebGL2RenderingContext.prototype;
    const link = P.linkProgram, get = P.getProgramParameter;
    const pending = new Map();
    P.linkProgram = function (p) {
      const t = performance.now();
      link.call(this, p);
      pending.set(p, { t, gl: this, called: performance.now() - t });
    };
    P.getProgramParameter = function (p, n) {
      const t = performance.now();
      const r = get.call(this, p, n);
      const d = performance.now() - t;
      if (d > 5) log.sync.push([Math.round(t), Math.round(d), n === this.LINK_STATUS ? 'LINK_STATUS' : n]);
      return r;
    };
    let prev = 0;
    const tick = (now) => {
      if (prev && now - prev > 50) log.gaps.push([Math.round(prev), Math.round(now - prev)]);
      prev = now;
      for (const [p, e] of pending) {
        const x = e.gl.getExtension('KHR_parallel_shader_compile');
        const done = x ? get.call(e.gl, p, x.COMPLETION_STATUS_KHR) : true;
        if (done) { log.links.push([Math.round(e.t), Math.round(now - e.t), !!x]); pending.delete(p); }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const mark = (name) => page.evaluate((n) => window.__sh.marks.push([n, Math.round(performance.now())]), name);
  await page.goto(`${base}?diag&hero=runs`, { waitUntil: 'load' });
  await page.waitForTimeout(9000);
  await mark('switch to 77 bugs');
  await page.locator('.herosw button', { hasText: '77 bugs' }).click();
  await page.waitForTimeout(12000);
  await mark('scroll to story');
  await page.evaluate(() => document.querySelector('.story__step[data-step="0"]').scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(12000);
  const r = await page.evaluate(() => {
    const g = document.querySelector('canvas').getContext('webgl2');
    const d = g.getExtension('WEBGL_debug_renderer_info');
    return { ...window.__sh, renderer: d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?' };
  });
  console.log(label, 'renderer', r.renderer);
  console.log('marks', JSON.stringify(r.marks));
  console.log('programs linked', r.links.length, 'slowest', JSON.stringify([...r.links].sort((a, b) => b[1] - a[1]).slice(0, 10)));
  console.log('total link ms', r.links.reduce((a, l) => a + l[1], 0));
  console.log('blocking status reads', JSON.stringify(r.sync.slice(0, 14)));
  console.log('frame gaps >50ms', JSON.stringify(r.gaps.sort((a, b) => b[1] - a[1]).slice(0, 10)));
} finally {
  await ctx.close();
  rmSync(profile, { recursive: true, force: true });
}
