import { chromium } from '@playwright/test';

// Historical Lattice comparison at one viewport, from real builds of each revision (QA helper).
//   node scripts/qa/m15-history.mjs <matrix-url> <first-lattice-url> <current-url>
const [matrixUrl, firstUrl, currentUrl] = process.argv.slice(2);
const dir = 'qa-screenshots/m15/gate1';
const viewport = { width: 1440, height: 900 };
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });

// MatrixSurface: a scroll-pinned sequence, so it is captured at the same points of its unfold.
{
  const page = await browser.newPage({ viewport });
  await page.goto(matrixUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const range = await page.evaluate(() => {
    const e = document.querySelector('.matrix-intro') ?? document.getElementById('matrix');
    const pin = e.closest('.pin-spacer') ?? e;
    const top = pin.getBoundingClientRect().top + window.scrollY;
    return { top, height: pin.getBoundingClientRect().height };
  });
  console.log('matrix pin', range);
  for (const [label, p] of [['curved', 0.1], ['mid', 0.32]]) {
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), range.top + (range.height - viewport.height) * p);
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${dir}/history-1-matrixsurface-${label}.png` });
  }
  await page.close();
}

// First RunLattice: outcomes, at the top of the page.
{
  const page = await browser.newPage({ viewport });
  await page.goto(firstUrl, { waitUntil: 'networkidle' });
  await page.mouse.move(2, 898);
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `${dir}/history-2-first-runlattice.png` });
  await page.close();
}

{
  const page = await browser.newPage({ viewport });
  await page.goto(`${currentUrl}?hero=runs`, { waitUntil: 'networkidle' });
  await page.mouse.move(2, 898);
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `${dir}/history-3-current.png` });
  await page.close();
}
await browser.close();
