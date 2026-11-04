import { expect, test, type Page } from '@playwright/test';

// The story must be seen, not just reported. Every check here reads real pixels from the stage. These run
// against the production build and, with E2E_URL, the dev server, where StrictMode runs effects twice.

const STATES = ['single-bug', 'six-conditions', 'two-repeats', 'every-bug', 'full-atlas'];
const LIT_MIN = [5, 4, 5, 8, 10];     // well under what each state shows, far over a blank stage
const q = (p: Page, key: string) => p.evaluate((k) => (window as any).__upliftDiag?.[k]?.(), key);

async function lit(page: Page): Promise<number> {
  const box = (await page.locator('#story .story__stage').boundingBox())!;
  const vp = page.viewportSize()!;
  const y = Math.max(0, box.y), height = Math.min(box.y + box.height, vp.height) - y;
  const png = await page.screenshot({ clip: { x: 0, y, width: vp.width, height } });
  const decoder = await page.context().newPage();
  const share = await decoder.evaluate(async (b64) => {
    const s = atob(b64), u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    const m = await createImageBitmap(new Blob([u], { type: 'image/png' }));
    const c = new OffscreenCanvas(m.width, m.height), x = c.getContext('2d')!;
    x.drawImage(m, 0, 0);
    // The left part only: the step text sits on the right and is not the model.
    const d = x.getImageData(0, 0, Math.round(m.width * 0.66), m.height).data;
    let k = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 150) k++;
    return (100 * k) / (d.length / 4);
  }, png.toString('base64'));
  await decoder.close();
  await page.bringToFront();
  return share;
}

const go = (page: Page, i: number) => page.locator(`#story .story__step[data-step="${i}"]`).evaluate((el) => el.scrollIntoView({ behavior: 'instant', block: 'center' }));

/** The state is active, the scene settled on it, the 3D drew it and no fallback stands in for it. */
async function expectState(page: Page, i: number) {
  await expect(page.locator('#story .story')).toHaveAttribute('data-state', STATES[i]);
  await expect(page.locator('#story .story__step.is-active')).toHaveAttribute('data-step', String(i));
  await expect.poll(async () => (await q(page, 'story'))?.settledAt, { timeout: 15_000 }).toBe(i);
  await expect(page.locator('#story .story__canvas .story__figure')).toHaveCount(0);
  const draw = (await q(page, 'draws')).find((d: { id: string }) => d.id === 'cohort');
  expect(draw.objects).toBeGreaterThan(0);
  await expect.poll(() => lit(page), { timeout: 6000, message: `${STATES[i]} is lit` }).toBeGreaterThan(LIT_MIN[i]);
  const view = (await q(page, 'story')).view;
  expect(view).toBe([0, 1, 1, 2, 2][i]);
  await expect(page.locator('#story .story__formula')).toHaveCount(i === 2 || i === 4 ? 1 : 0);
  const labels = await page.locator('#story .story__label.is-on').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.top, r.bottom]; }));
  expect(labels.length).toBe(i === 1 || i === 2 ? 6 : i === 0 ? 1 : 0);
  labels.sort((a, b) => a[0] - b[0]);
  for (let n = 1; n < labels.length; n++) expect(labels[n][0]).toBeGreaterThanOrEqual(labels[n - 1][1]);
}

for (const [width, height] of [[1440, 900], [1920, 1080]]) {
  test.describe(`story reliability at ${width}×${height}`, () => {
    test.use({ viewport: { width, height } });

    test('A fresh load, D forward through every state', async ({ page }) => {
      await page.goto('./?diag', { waitUntil: 'networkidle' });
      for (let i = 0; i < 5; i++) { await go(page, i); await expectState(page, i); }
    });

    test('E reverse through every state', async ({ page }) => {
      await page.goto('./?diag', { waitUntil: 'networkidle' });
      await go(page, 4);
      await expectState(page, 4);
      for (let i = 3; i >= 0; i--) { await go(page, i); await expectState(page, i); }
    });

    test('a scene switch first: 924 runs to 77 bugs to the story', async ({ page }) => {
      await page.goto('./?diag&hero=runs', { waitUntil: 'networkidle' });
      await page.locator('.herosw button', { hasText: '77 bugs' }).click();
      await page.waitForTimeout(1500);
      await go(page, 0);
      await expectState(page, 0);
    });

    test('C direct to #how, B and H refresh in every state', async ({ page }) => {
      test.setTimeout(180_000);
      await page.goto('./?diag#how', { waitUntil: 'networkidle' });
      await expect(page.locator('#story-title')).toBeInViewport();
      for (let i = 0; i < 5; i++) {
        await go(page, i);
        await expectState(page, i);
        await page.reload({ waitUntil: 'networkidle' });
        // No scrolling here: a refresh must keep the reader on the same step by itself.
        await expectState(page, i);
      }
    });

    test('F rapid forward and reverse, interrupted mid-transition', async ({ page }) => {
      await page.goto('./?diag', { waitUntil: 'networkidle' });
      await go(page, 0);
      await expectState(page, 0);
      for (let n = 0; n < 6; n++) for (const i of [4, 1, 3, 0, 2]) { await go(page, i); await page.waitForTimeout(60); }
      await expectState(page, 2);
    });

    test('G manual selection goes through the same state', async ({ page }) => {
      await page.goto('./?diag', { waitUntil: 'networkidle' });
      await go(page, 0);
      for (const i of [3, 1, 4, 0]) {
        await page.locator('#story').getByRole('button', { name: new RegExp(`^Step ${i + 1}:`) }).click();
        await expectState(page, i);
      }
    });

    test('I resize during a scene', async ({ page }) => {
      await page.goto('./?diag', { waitUntil: 'networkidle' });
      await go(page, 2);
      await expectState(page, 2);
      await page.setViewportSize({ width: 1100, height: 700 });
      await go(page, 2);
      await expectState(page, 2);
      await page.setViewportSize({ width, height });
      await go(page, 2);
      await expectState(page, 2);
    });

    test('J another tab and back', async ({ page, context }) => {
      await page.goto('./?diag', { waitUntil: 'networkidle' });
      await go(page, 3);
      await expectState(page, 3);
      const other = await context.newPage();
      await other.bringToFront();
      await other.waitForTimeout(800);
      await other.close();
      await page.bringToFront();
      await expectState(page, 3);
    });

    test('a lost and restored WebGL context comes back', async ({ page }) => {
      await page.goto('./?diag', { waitUntil: 'networkidle' });
      await go(page, 1);
      await expectState(page, 1);
      await page.evaluate(() => {
        const ext = document.querySelector('canvas')!.getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
        (window as any).__lose = ext;
        ext.loseContext();
      });
      await page.waitForTimeout(400);
      await page.evaluate(() => (window as any).__lose.restoreContext());
      await expect.poll(() => lit(page), { timeout: 8000 }).toBeGreaterThan(LIT_MIN[1]);
    });
  });
}

test('K reduced motion reaches every state at once', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL, reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('./?diag', { waitUntil: 'networkidle' });
  for (const i of [4, 1, 3]) { await go(page, i); await expectState(page, i); }
  await ctx.close();
});

test('L no WebGL: the 2D figure carries every state, with no canvas', async ({ page }) => {
  await page.goto('./?nowebgl', { waitUntil: 'networkidle' });
  await expect(page.locator('canvas')).toHaveCount(0);
  for (let i = 0; i < 5; i++) {
    await go(page, i);
    await expect(page.locator('#story .story')).toHaveAttribute('data-state', STATES[i]);
    await expect(page.locator('#story .story__canvas .story__figure')).toHaveCount(1);
    await expect(page.locator('#story .story__canvas .story__figure')).toHaveAttribute('aria-label', await page.locator('#story .story__step.is-active .story__title').textContent() as string);
  }
});

test('phones: a 2D figure in every step, and no scene', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./?diag', { waitUntil: 'networkidle' });
  await expect(page.locator('#story .story__step .story__figure')).toHaveCount(5);
  await expect(page.locator('#story .story__stage')).toHaveCount(0);
  await expect(page.locator('canvas')).toHaveCount(0);
});
