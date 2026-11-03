import { chromium } from '@playwright/test';
// node qa-shot.mjs <url> <out.png> <w> <h> <target> <wait>
// target: a pixel offset, '#id', or 'pin:<selector>:<fraction>' (fraction of that pin's scroll length)
const [,, url, out, w = '1440', h = '900', target = '0', wait = '2500', extra = ''] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-features=Vulkan'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, reducedMotion: extra === 'reduce' ? 'reduce' : 'no-preference' });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/THREE.Clock/.test(m.text())) logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.evaluate(async (t) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  if (t.startsWith('pin:')) {
    const [, sel, frac] = t.split(':');
    const el = document.querySelector(sel);
    const spacer = el.parentElement.classList.contains('pin-spacer') ? el.parentElement : el;
    const top = spacer.getBoundingClientRect().top + window.scrollY;
    const len = spacer.offsetHeight - window.innerHeight;
    const y = top + len * +frac;
    for (let i = 1; i <= 6; i++) { window.scrollTo(0, y * i / 6); await sleep(120); }
  } else if (t.startsWith('#')) { document.querySelector(t)?.scrollIntoView(); }
  else window.scrollTo(0, +t);
}, target);
await page.waitForTimeout(+wait);
await page.screenshot({ path: out, timeout: 90000, animations: "allow", caret: "initial" });
console.log(logs.slice(0, 15).join('\n') || 'ok');
await browser.close();
