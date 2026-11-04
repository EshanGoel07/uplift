import { chromium } from '@playwright/test';
import { mkdirSync, renameSync, readdirSync } from 'node:fs';

// One real interaction recording per model at 1440 by 900, and the review screenshots at both desktop sizes.
const base = process.argv[2] ?? 'http://localhost:4173/uplift/';
const dir = 'qa-screenshots/m15/g31/final';
mkdirSync(`${dir}/video`, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });

const scroll = (page, id, i) => page.evaluate(([k, n]) => document.querySelector(`#${k} .story__step[data-step="${n}"]`).scrollIntoView({ behavior: 'smooth', block: 'center' }), [id, i]);
const pick = (page, id, name) => page.locator(`#${id} .assembly__parts button`).filter({ hasText: name }).first().evaluate((b) => b.click());

const SCRIPTS = {
  async workspace(page, wait) {
    await scroll(page, 'workspace', 0); await wait(3200);
    await scroll(page, 'workspace', 1); await wait(3200);
    await pick(page, 'workspace', 'Repository'); await wait(2800); await pick(page, 'workspace', 'Repository'); await wait(1000);
    await scroll(page, 'workspace', 2); await wait(2600);
    await pick(page, 'workspace', 'Issue'); await wait(2600); await pick(page, 'workspace', 'Issue'); await wait(800);
    await scroll(page, 'workspace', 3); await wait(2800);
    for (const name of ['No setup', 'Generic tips file', 'Hooks (generated)', 'Tuned by Muse Spark', 'Tips + hooks']) { await page.getByRole('group', { name: 'Condition shown in this model' }).getByRole('button', { name }).click(); await wait(1800); }
    await pick(page, 'workspace', 'Hook'); await wait(2600); await pick(page, 'workspace', 'Hook'); await wait(800);
    await scroll(page, 'workspace', 4); await wait(3400);
    await scroll(page, 'workspace', 5); await wait(3200);
    await pick(page, 'workspace', 'Produced'); await wait(2800);
  },
  async cutaway(page, wait) {
    for (let i = 0; i < 6; i++) { await scroll(page, 'cutaway', i); await wait(3800); }
    await scroll(page, 'cutaway', 3); await wait(2800);
    await pick(page, 'cutaway', 'Hidden tests'); await wait(2800);
  },
  async grading(page, wait) {
    for (let i = 0; i < 10; i++) { await scroll(page, 'grading', i); await wait(3000); }
    await scroll(page, 'grading', 7); await wait(2600);
    await page.locator('#grading .story__step[data-step="7"] summary').click(); await wait(2800);
    await scroll(page, 'grading', 9); await wait(2600);
  },
};

for (const id of Object.keys(SCRIPTS)) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: `${dir}/video/tmp`, size: { width: 1440, height: 900 } } });
  const page = await ctx.newPage();
  await page.goto(`${base}?diag`, { waitUntil: 'networkidle' });
  await SCRIPTS[id](page, (ms) => page.waitForTimeout(ms));
  const v = page.video();
  await ctx.close();
  renameSync(await v.path(), `${dir}/video/${id}.webm`);
  console.log('recorded', id);
}

const SHOTS = {
  workspace: ['0', '1', '1:Repository', '1:Git history', '1:Original agent', '2:Issue', '3', '3:AGENTS', '3:Hook', '4', '4:Muse', '5', '5:Produced'],
  cutaway: ['0', '1', '2', '3', '4', '5', '1:Muse', '3:Hidden'],
  grading: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '7:Cross', '9:Verdict'],
};
for (const [width, height] of [[1440, 900], [1920, 1080]]) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(`${base}?diag`, { waitUntil: 'networkidle' });
  for (const [id, list] of Object.entries(SHOTS)) {
    for (const item of list) {
      const [s, obj] = item.split(':');
      await page.evaluate(([k, n]) => document.querySelector(`#${k} .story__step[data-step="${n}"]`).scrollIntoView({ behavior: 'instant', block: 'center' }), [id, s]);
      await page.waitForTimeout(2300);
      if (obj) { await pick(page, id, obj); await page.waitForTimeout(2200); }
      await page.screenshot({ path: `${dir}/${id}-${width}-${item.replace(/[^a-zA-Z0-9-]+/g, '_')}.png` });
      if (obj) { await pick(page, id, obj); await page.waitForTimeout(200); }
    }
  }
  await page.close();
}
await browser.close();
console.log(readdirSync(dir).length, 'files');
