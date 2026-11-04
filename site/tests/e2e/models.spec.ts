import { expect, test, type Page } from '@playwright/test';

// The Gate 3 story models. Each must draw, follow its story both ways and be truly inspectable.

interface Spec { section: string; id: string; states: string[] }
const MODELS: Spec[] = [
  { section: 'workspace', id: 'workspace', states: ['assembled', 'exploded', 'issue', 'setup', 'running', 'patch'] },
  { section: 'cutaway', id: 'cutaway', states: ['received', 'working', 'exit', 'hidden', 'grading', 'result'] },
  { section: 'grading', id: 'grading', states: ['overview', 'check-the-run-finished', 'reset-the-test-files', 'apply-the-hidden-tests', 'clear-stale-bytecode', 'run-pytest', 'parse-each-test', 'cross-check-the-counts', 'check-both-test-lists', 'record-the-verdict'] },
];

const go = (page: Page, section: string, i: number) => page.locator(`#${section} .story__step[data-step="${i}"]`).evaluate((el) => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
// The Canvas, and so the diagnostics, may not have mounted yet; polling callers simply try again.
const assembly = (page: Page, id: string) => page.evaluate((k) => (window as any).__upliftDiag?.assembly(k) ?? { settledAt: -1, selected: null }, id);

async function litPixels(page: Page, section: string): Promise<number> {
  const box = (await page.locator(`#${section} .story__stage`).boundingBox())!;
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
    const d = x.getImageData(0, Math.round(m.height * 0.25), Math.round(m.width * 0.66), Math.round(m.height * 0.75)).data;
    let k = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 70) k++;
    return (100 * k) / (d.length / 4);
  }, png.toString('base64'));
  await decoder.close();
  await page.bringToFront();
  return share;
}

async function expectState(page: Page, m: Spec, i: number) {
  await expect(page.locator(`#${m.section} .story`)).toHaveAttribute('data-state', m.states[i]);
  await expect.poll(async () => (await assembly(page, m.id)).settledAt, { timeout: 15_000 }).toBe(i);
  await expect(page.locator(`#${m.section} .story__canvas .story__figure`)).toHaveCount(0);
  await expect.poll(() => litPixels(page, m.section), { timeout: 6000, message: `${m.states[i]} is drawn` }).toBeGreaterThan(1.5);
}

for (const [width, height] of [[1440, 900], [1920, 1080]]) {
  for (const m of MODELS) {
    test.describe(`${m.section} at ${width}×${height}`, () => {
      test.use({ viewport: { width, height } });

      test('draws every state forward and back, and after a refresh', async ({ page }) => {
        test.setTimeout(200_000);
        await page.goto('./?diag', { waitUntil: 'networkidle' });
        for (let i = 0; i < m.states.length; i++) { await go(page, m.section, i); await expectState(page, m, i); }
        for (let i = m.states.length - 2; i >= 0; i--) { await go(page, m.section, i); await expectState(page, m, i); }
        await go(page, m.section, 2);
        await expectState(page, m, 2);
        await page.reload({ waitUntil: 'networkidle' });
        await expectState(page, m, 2);
      });

      test('survives rapid scrolling', async ({ page }) => {
        await page.goto('./?diag', { waitUntil: 'networkidle' });
        for (let n = 0; n < 5; n++) for (const i of [4, 0, 3, 1, 2]) { await go(page, m.section, i); await page.waitForTimeout(60); }
        await expectState(page, m, 2);
      });
    });
  }
}

test('workspace: objects can be inspected by list, keyboard and pointer, and reset', async ({ page }) => {
  await page.goto('./?diag', { waitUntil: 'networkidle' });
  await go(page, 'workspace', 2);
  await expect.poll(async () => (await assembly(page, 'workspace')).settledAt, { timeout: 15_000 }).toBe(2);
  const parts = page.locator('#workspace .assembly__parts button');
  await parts.filter({ hasText: 'Issue input' }).click();
  await expect(page.locator('#workspace .assembly__detail')).toContainText('fixed prompt');
  await expect(page.locator('#workspace .assembly__detail')).toContainText('src/uplift/runner.py');
  await parts.filter({ hasText: 'Issue input' }).press('Enter');
  await expect(page.locator('#workspace .assembly__detail')).toHaveCount(0);
  // A click on the model picks the object under the pointer: the repository, low in the frame.
  const box = (await page.locator('#workspace .story__canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.34, box.y + box.height * 0.8);
  await expect.poll(async () => (await assembly(page, 'workspace')).selected).not.toBeNull();
  await expect(page.locator('#workspace .assembly__detail')).toBeVisible();
  await page.locator('#workspace').getByRole('button', { name: 'Reset view' }).click();
  await expect(page.locator('#workspace .assembly__detail')).toHaveCount(0);
});

test('workspace: each condition shows only what it really installed', async ({ page }) => {
  await page.goto('./?diag', { waitUntil: 'networkidle' });
  await go(page, 'workspace', 3);
  const parts = page.locator('#workspace .assembly__parts:not(.assembly__all) button');
  const pick = page.getByRole('group', { name: 'Condition shown in this model' });
  await pick.getByRole('button', { name: 'No setup' }).click();
  await expect(parts).toHaveCount(0);
  await expect(page).toHaveURL(/cond=none/);
  await pick.getByRole('button', { name: 'Tips + hooks' }).click();
  await expect(parts).toHaveCount(2);
  await pick.getByRole('button', { name: 'Hooks (generated)' }).click();
  await expect(parts).toHaveCount(1);
  await expect(parts.filter({ hasText: 'AGENTS.md' })).toHaveCount(0);
  await expect(parts.filter({ hasText: 'Hook configuration' })).toHaveCount(1);
  // The picker belongs to this step alone.
  await go(page, 'workspace', 5);
  await expect(pick).toHaveCount(0);
});

test('cutaway: one workspace in two phases, and the hidden tests arrive only after the exit', async ({ page }) => {
  await page.goto('./?diag', { waitUntil: 'networkidle' });
  const caption = page.locator('#cutaway .assembly__caption');
  await go(page, 'cutaway', 1);
  await expect(caption).toContainText('Phase A');
  await expect(page.locator('#cutaway .story__step.is-active')).toContainText('not there');
  await go(page, 'cutaway', 2);
  await expect(page.locator('#cutaway .story__step.is-active')).toContainText('does not run again');
  await go(page, 'cutaway', 3);
  await expect(caption).toContainText('Phase B');
  await expect(page.locator('#cutaway .story__step.is-active')).toContainText('Only now');
  await page.locator('#cutaway .assembly__parts button').filter({ hasText: 'Hidden tests' }).first().evaluate((b: HTMLElement) => b.click());
  await expect(page.locator('#cutaway .assembly__detail')).toContainText('tests/test_parser.py');
});

test('grading: the verdict appears only at the end, and each step opens its real source', async ({ page }) => {
  await page.goto('./?diag', { waitUntil: 'networkidle' });
  const parts = page.locator('#grading .assembly__parts button');
  await go(page, 'grading', 3);
  await expect(page.locator('#grading .story')).toHaveAttribute('data-state', 'apply-the-hidden-tests');
  await expect(parts.filter({ hasText: /^Verdict$/ })).toHaveCount(0);
  await parts.filter({ hasText: 'Apply the hidden tests' }).first().evaluate((b: HTMLElement) => b.click());
  await expect(page.locator('#grading .assembly__detail')).toContainText('never in the agent');
  await expect(page.locator('#grading .assembly__source')).toContainText('src/uplift/grade.py:175');
  await go(page, 'grading', 7);
  const step = page.locator('#grading .story__step[data-step="7"]');
  await step.locator('summary').click();
  await expect(step.locator('pre')).toContainText('problem = check_output(text)');
  await expect(step).toContainText('If this fails');
  await go(page, 'grading', 9);
  await expect(parts.filter({ hasText: /^Verdict$/ })).toHaveCount(1);
});

test.describe('selection and motion', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('rapid selection, condition changes and scrolling leave a settled, drawn model', async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('./?diag', { waitUntil: 'networkidle' });
    await go(page, 'workspace', 3);
    await expect.poll(async () => (await assembly(page, 'workspace')).settledAt, { timeout: 15_000 }).toBe(3);
    const pick = page.getByRole('group', { name: 'Condition shown in this model' });
    for (let n = 0; n < 4; n++) {
      for (const name of ['No setup', 'Tips + hooks', 'Tuned by Muse Spark', 'Generic tips file']) await pick.getByRole('button', { name }).click();
      await page.locator('#workspace .assembly__parts button').first().evaluate((b: HTMLElement) => b.click());
      await go(page, 'workspace', n % 2 ? 2 : 4);
      await page.waitForTimeout(50);
      await go(page, 'workspace', 3);
    }
    await expect.poll(async () => (await assembly(page, 'workspace')).settledAt, { timeout: 15_000 }).toBe(3);
    await expect.poll(() => litPixels(page, 'workspace'), { timeout: 6000 }).toBeGreaterThan(1.5);
    expect(errors).toEqual([]);
  });

  test('selecting an object focuses it, and dragging turns the model until reset', async ({ page }) => {
    await page.goto('./?diag', { waitUntil: 'networkidle' });
    await go(page, 'cutaway', 1);
    await expect.poll(async () => (await assembly(page, 'cutaway')).settledAt, { timeout: 15_000 }).toBe(1);
    await page.locator('#cutaway .assembly__parts button').filter({ hasText: 'Muse Code' }).click();
    await expect(page.locator('#cutaway .assembly__detail')).toContainText('exits');
    await expect.poll(async () => (await assembly(page, 'cutaway')).selected).toBe('muse');
    await page.locator('#cutaway').getByRole('button', { name: 'Reset view' }).click();
    await expect(page.locator('#cutaway').getByRole('button', { name: 'Reset view' })).toHaveCount(0);
    const box = (await page.locator('#cutaway .story__canvas').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.08);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.12, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator('#cutaway').getByRole('button', { name: 'Reset view' })).toBeVisible();
  });

  test('reduced motion lands on each state at once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('./?diag', { waitUntil: 'networkidle' });
    for (const [section, i] of [['workspace', 4], ['cutaway', 3], ['grading', 5]] as const) {
      await go(page, section, i);
      await expect.poll(async () => (await assembly(page, section)).settledAt, { timeout: 8000 }).toBe(i);
      await expect.poll(() => litPixels(page, section), { timeout: 6000 }).toBeGreaterThan(1.5);
    }
  });

  test('uses one Canvas for all three models', async ({ page }) => {
    await page.goto('./?diag', { waitUntil: 'networkidle' });
    for (const section of ['workspace', 'cutaway', 'grading']) {
      await go(page, section, 1);
      await page.waitForTimeout(600);
      await expect(page.locator('canvas')).toHaveCount(1);
    }
  });

  test('a failed scene chunk falls back to the 2D figures', async ({ page }) => {
    await page.route('**/assets/AssemblyScene*', (r) => r.abort());
    await page.goto('./', { waitUntil: 'networkidle' });
    await go(page, 'grading', 2);
    await expect(page.locator('#grading .story__canvas .story__figure')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#grading .story__step.is-active')).toContainText('Reset the test files');
  });
});

for (const [section, step, shown] of [['workspace', 3, /AGENTS\.md/], ['cutaway', 3, /Hidden tests/], ['grading', 7, /Cross-check/]] as const) {
  test(`${section} tells its story with no WebGL`, async ({ page }) => {
    await page.goto('./?nowebgl', { waitUntil: 'networkidle' });
    await go(page, section, step);
    await expect(page.locator(`#${section} .story__canvas .story__figure`)).toHaveAttribute('aria-label', shown);
  });
}

test('models carry their full story with no WebGL, and on phones', async ({ page }) => {
  await page.goto('./?nowebgl', { waitUntil: 'networkidle' });
  await go(page, 'workspace', 3);
  await expect(page.locator('#workspace .story__canvas .story__figure')).toHaveAttribute('aria-label', /AGENTS\.md/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#workspace .story__step .story__figure')).toHaveCount(6);
  await expect(page.locator('canvas')).toHaveCount(0);
});
