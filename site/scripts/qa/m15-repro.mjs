import { chromium } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Replays the owner's recording in a headed browser: 924 runs, switch to 77 bugs, then scroll to the
// story, reading the stage's real pixels at each point (QA helper).
//   node scripts/qa/m15-repro.mjs [trials] [base-url] [--chrome] [--headless]
const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith('--'));
const [trials = '3', base = 'http://localhost:4173/uplift/'] = argv.filter((a) => !a.startsWith('--'));

async function trial(n) {
  const profile = mkdtempSync(join(tmpdir(), 'uplift-repro-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: flags.includes('--headless'), channel: flags.includes('--chrome') ? 'chrome' : undefined,
    viewport: { width: 1878, height: 902 },
  });
  try {
    const decoder = await ctx.newPage();
    const page = await ctx.newPage();
    await page.bringToFront();
    const lit = async (sel) => {
      const box = await page.locator(sel).first().boundingBox();
      if (!box) return 'no-element';
      const y = Math.max(0, box.y), h = Math.min(box.y + box.height, 902) - y;
      if (h < 20) return 'off-screen';
      const png = await page.screenshot({ clip: { x: box.x, y, width: Math.min(box.width, 1878 - box.x), height: h } });
      return decoder.evaluate(async (b64) => {
        const s = atob(b64), u = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
        const m = await createImageBitmap(new Blob([u], { type: 'image/png' }));
        const c = new OffscreenCanvas(m.width, m.height), x = c.getContext('2d');
        x.drawImage(m, 0, 0);
        const d = x.getImageData(0, 0, m.width, m.height).data;
        let k = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 150) k++;
        return +((100 * k) / (d.length / 4)).toFixed(1);
      }, png.toString('base64'));
    };
    const diag = () => page.evaluate(() => {
      const d = window.__upliftDiag;
      return { scenes: d?.scenes().map((s) => `${s.id}:${s.phase}`).join(' '), exp: document.querySelector('.experience')?.style.visibility, frames: d?.frames() };
    });
    await page.goto(`${base}?diag&hero=runs`, { waitUntil: 'load' });
    await page.waitForTimeout(5000);
    console.log(n, 'lattice', await lit('.lattice__canvas-wrap'), JSON.stringify(await diag()));
    await page.locator('.herosw button', { hasText: '77 bugs' }).click();
    await page.waitForTimeout(5000);
    console.log(n, 'nebula ', await lit('.lattice__canvas-wrap'), JSON.stringify(await diag()));
    await page.mouse.move(600, 500);
    for (let i = 0; i < 60; i++) {
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(60);
      if ((await page.evaluate(() => document.querySelector('.story__stage')?.getBoundingClientRect().top ?? 9999)) < 80) break;
    }
    await page.waitForTimeout(4000);
    console.log(n, 'story  ', await lit('.story__canvas'), JSON.stringify(await diag()));
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(5000);
    console.log(n, 'after reload', await lit('.story__canvas'), JSON.stringify(await diag()), await page.evaluate(() => Math.round(scrollY)));
  } finally {
    await ctx.close();
    rmSync(profile, { recursive: true, force: true });
  }
}
for (let i = 0; i < +trials; i++) await trial(i + 1);
