import { chromium } from '@playwright/test';
import { mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

// Review captures of the experiment workbench (QA helper, not part of the build).
//   node scripts/qa/workbench-shots.mjs <base-url> <out-dir> [--video]
// Saves the 3D workbench in several selection states, the 2D diagram, and a phone view. With
// --video it also records the key interaction (lane → run → agent/evaluator switch → analysis).
const [,, base = 'http://localhost:5173/', outDir = 'qa-screenshots/workbench', flag = ''] = process.argv;
mkdirSync(outDir, { recursive: true });
const GPU = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: GPU });
const problems = [];

async function open(page, url) {
  page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console ${m.text()}`); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  // Bring the workbench toolbar just under the header.
  await page.evaluate(() => {
    const el = document.querySelector('.wb__toolbar');
    const nav = document.querySelector('.nav')?.getBoundingClientRect().height ?? 64;
    window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - nav - 16);
  });
  await page.waitForTimeout(1800);
}
const shot = (page, name) => page.screenshot({ path: join(outDir, `${name}.png`) });
const label = (page, text) => page.locator('.wb-label button', { hasText: text }).first();

// Desktop 3D, several states.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await open(page, base);
  await shot(page, 'desktop-3d-overview');
  await label(page, 'Tips + hooks').click(); await page.waitForTimeout(700);
  await shot(page, 'desktop-3d-lane');
  await page.locator('.seg-dark button', { hasText: 'What the agent sees' }).click(); await page.waitForTimeout(900);
  await shot(page, 'desktop-3d-agent');
  await page.locator('.seg-dark button', { hasText: 'What the evaluator sees' }).click(); await page.waitForTimeout(900);
  await shot(page, 'desktop-3d-evaluator');
  await label(page, 'F · Paired analysis').click(); await page.waitForTimeout(700);
  await shot(page, 'desktop-3d-analysis');
  await page.locator('.seg-dark button', { hasText: '2D diagram' }).click(); await page.waitForTimeout(600);
  await page.locator('.wbd__run').nth(6).click(); await page.waitForTimeout(900);
  await shot(page, 'desktop-2d-run');
  await page.close();
}
// Phone: the 2D diagram is the default.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await open(page, base);
  await shot(page, 'mobile-2d');
  await page.locator('.wb').screenshot({ path: join(outDir, 'mobile-2d-full.png') });
  await page.close();
}
// Interaction video.
if (flag === '--video') {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: outDir, size: { width: 1440, height: 900 } } });
  const page = await ctx.newPage();
  await open(page, base);
  const pause = (ms) => page.waitForTimeout(ms);
  await pause(800);
  await label(page, 'A · Task source').click(); await pause(1300);
  await label(page, 'Hooks (generated)').click(); await pause(1300);
  await label(page, 'Tips + hooks').click(); await pause(1300);
  await page.locator('.seg-dark button', { hasText: 'What the agent sees' }).click(); await pause(1800);
  await page.locator('.seg-dark button', { hasText: 'What the evaluator sees' }).click(); await pause(1800);
  await label(page, 'F · Paired analysis').click(); await pause(1500);
  await page.locator('.wb').getByRole('button', { name: 'Next bug' }).click(); await pause(1300);
  await page.locator('.seg-dark button', { hasText: '2D diagram' }).click(); await pause(1500);
  await page.locator('.seg-dark button', { hasText: '3D view' }).click(); await pause(1200);
  await page.close();
  await ctx.close();
  const vid = readdirSync(outDir).find((f) => f.endsWith('.webm') && !f.startsWith('workbench-'));
  if (vid) renameSync(join(outDir, vid), join(outDir, 'workbench-interaction.webm'));
}
await browser.close();
console.log(problems.length ? problems.join('\n') : 'ok: no console errors');
