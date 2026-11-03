// Captures a still of the live Signal Field for browsers without WebGL.
// Usage: npm run build && npm run preview (in another shell), then: node scripts/capture-poster.mjs
import { chromium } from '@playwright/test';

const url = process.env.UPLIFT_URL ?? 'http://localhost:4173/uplift/';
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: 'main, .nav, .scene-controls, .hotspots, .to-top, .footer { visibility: hidden !important; } body::before { display: none; } body { background: #090A0C; }' });
await page.waitForTimeout(3500);
const box = await page.evaluate(() => {
  // The field sits slightly right of the stage centre (see SignalField layout).
  const r = document.querySelector('.hero__stage').getBoundingClientRect();
  return { cx: r.left + r.width * 0.58, cy: r.top + r.height / 2 };
});
const size = 900;
await page.screenshot({
  path: 'public/assets/signal-field-fallback.jpg', type: 'jpeg', quality: 86,
  clip: { x: Math.max(0, box.cx - size / 2), y: Math.max(0, box.cy - size / 2), width: size, height: size },
});
await browser.close();
console.log('wrote public/assets/signal-field-fallback.jpg');
