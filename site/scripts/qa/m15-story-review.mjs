import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

// Story review (QA helper): real wheel scrolling through the story at each viewport, a capture of each
// state, the share of the stage that is lit, and how much of the viewport the stage covers.
//   node scripts/qa/m15-story-review.mjs <label> <steps, e.g. 0,1,2,3,4> [base-url]
const [label = 'after', list = '0,1,2,3,4', base = 'http://localhost:4173/uplift/'] = process.argv.slice(2);
const steps = list.split(',').map(Number);
const dir = `qa-screenshots/m15/review/${label}`;
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const out = [];
try {
  const decoder = await browser.newPage();
  const litShare = (png) => decoder.evaluate(async (b64) => {
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const img = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = new OffscreenCanvas(img.width, img.height), x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, img.width, img.height).data;
    let n = 0;
    for (let k = 0; k < d.length; k += 4) if (d[k] + d[k + 1] + d[k + 2] > 150) n++;
    return +((100 * n) / (d.length / 4)).toFixed(2);
  }, png.toString('base64'));

  for (const [width, height] of [[1440, 900], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    await page.goto(`${base}?diag`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.mouse.move(width / 3, height / 2);
    const active = () => page.evaluate(() => +(document.querySelector('#story .story__step.is-active')?.dataset.step ?? -1));
    const top = () => page.evaluate(() => document.querySelector('#story .story__stage')?.getBoundingClientRect().top ?? 1e6);
    // The story has started once its stage has reached its sticky position.
    for (let i = 0; i < 80 && (await top()) > 120; i++) { await page.mouse.wheel(0, 200); await page.waitForTimeout(140); }
    let n = 0;
    for (const step of steps) {
      for (let i = 0; i < 140 && (await active()) < step; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(90); }
      await page.waitForTimeout(3000);
      const shot = `${dir}/${width}-${++n}-step${step}.png`;
      await page.screenshot({ path: shot });
      const box = await page.locator('#story .story__stage').boundingBox();
      const clip = { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(box.width, width), height: Math.max(4, Math.min(box.y + box.height, height) - Math.max(0, box.y)) };
      const lit = await litShare(await page.screenshot({ clip }));
      const row = { width, step, active: await active(), lit, stageOfViewport: +((100 * clip.width * clip.height) / (width * height)).toFixed(1) };
      out.push(row);
      console.log(JSON.stringify(row));
    }
    console.log('errors', errors.slice(0, 3));
    await page.close();
  }
  writeFileSync(`${dir}/metrics.json`, JSON.stringify(out, null, 2));
} finally {
  await browser.close();
}
