import { expect, test, type Page } from '@playwright/test';

// Most interaction tests run with ?nowebgl (fast, deterministic). WebGL-specific checks are separate.
const NOGL = './?nowebgl';

const collectErrors = (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()}: ${r.url()}`); });
  return errors;
};

test('loads from a sub-path with no errors and no task files on first paint', async ({ page }) => {
  const errors = collectErrors(page);
  const taskRequests: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/data/tasks/')) taskRequests.push(r.url()); });
  await page.goto('./', { waitUntil: 'networkidle' });
  await expect(page.locator('#hero-title')).toContainText('coding-agent setup');
  await page.waitForTimeout(1000);
  expect(taskRequests).toEqual([]);
  expect(errors).toEqual([]);
  expect(page.url()).toContain('/uplift/');
});

test('hero states the null result and the four study numbers from the data', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  await expect(page.locator('.hero__lead')).toContainText('No setup was shown to differ from no setup');
  const stats = page.locator('.hero__stats .stat__num');
  await expect(stats).toHaveText(['924', '77', '6', '$21.31']);
  await expect(page.locator('.hero__models')).toContainText('Muse Code');
  await expect(page.locator('.hero__models')).toContainText('Muse Spark');
});

test('navigation jumps to sections and marks the current one', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  for (const [label, id] of [['Trust', 'trust'], ['Results', 'results'], ['Method', 'method']] as const) {
    await page.locator('.nav__links a', { hasText: label }).click();
    await page.waitForTimeout(1600);
    const top = await page.locator(`#${id}`).evaluate((el) => el.getBoundingClientRect().top);
    expect(Math.abs(top)).toBeLessThan(120);
    await expect(page.locator('.nav__links a[aria-current]')).toHaveText(label);
  }
});

test('results chart: five intervals, a zero baseline, the detectable effect, and compare', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  await page.locator('#results').scrollIntoViewIfNeeded();
  await expect(page.locator('.ic-row')).toHaveCount(5);
  await expect(page.locator('.ic-zero-label')).toHaveText('No setup (72.7%)');
  await expect(page.locator('.results__notes')).toContainText('5.4–9.1');
  await expect(page.locator('.arm-table tbody tr')).toHaveCount(6);
  await expect(page.locator('.arm-table tbody tr').nth(4)).toContainText('107/154');
  await expect(page.locator('.arm-table tbody tr').nth(4)).toContainText('4 / 7');
  await page.locator('.ic-row').nth(0).click();
  await page.locator('.ic-row').nth(3).click();
  await expect(page.locator('.compare__col')).toHaveCount(2);
  await expect(page.locator('.compare')).toContainText('Generic copied tips file');
});

test('matrix: 77 rows in 43/23/11 bands, working filters, and cell opens the explorer', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  await page.locator('#matrix').scrollIntoViewIfNeeded();
  const rows = page.locator('.mx-grid .mx-row:not(.mx-row--head)');
  await expect(rows).toHaveCount(77);
  await expect(page.locator('.mx-band__title')).toHaveText([/43\s*Always solved/, /23\s*Mixed/, /11\s*Never solved/]);
  await page.locator('.seg__btn', { hasText: 'Mixed (23)' }).click();
  await expect(rows).toHaveCount(23);
  await page.locator('.seg__btn', { hasText: 'Fresh' }).click();
  const fresh = await rows.count();
  expect(fresh).toBeGreaterThan(0);
  expect(fresh).toBeLessThan(23);
  await page.locator('.seg__btn', { hasText: /^All$/ }).nth(0).click();
  await page.locator('.seg__btn', { hasText: /^All$/ }).nth(1).click();
  await page.locator('.mx-search input').fill('WINDOW');
  await expect(rows.first()).toContainText('WINDOW');
  await page.locator('.mx-search input').fill('');
  await page.locator('.seg__btn', { hasText: 'Hooks fired' }).click();
  expect(await rows.count()).toBeLessThan(77);
  await page.locator('.seg__btn', { hasText: /^All$/ }).nth(2).click();

  // Opening a specific bug from a cell loads exactly that task.
  const target = page.locator('.mx-row', { hasText: 'IS NOT NULL incorrect transformation' });
  await target.locator('.mx-cell').first().click();
  await expect(page.locator('.ex-head__title')).toHaveText('IS NOT NULL incorrect transformation', { timeout: 10_000 });
  await expect(page.locator('.ex-head__link')).toHaveAttribute('href', 'https://github.com/tobymao/sqlglot/pull/4331');
});

test('matrix cells are keyboard navigable', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  await page.locator('#matrix').scrollIntoViewIfNeeded();
  const first = page.locator('.mx-task[tabindex="0"]');
  await first.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.mx-cell[data-r="0"][data-c="1"]')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.mx-cell[data-r="1"][data-c="1"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.ex-head__title')).toBeVisible({ timeout: 10_000 });
});

test('explorer: featured task, 12 runs, diff, hooks, compare, safe markdown', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  await page.locator('#explorer').scrollIntoViewIfNeeded();
  await expect(page.locator('.featured-note')).toContainText('does not show that hooks caused the fix');
  await expect(page.locator('.featured-note')).toContainText('could not be verified');
  await expect(page.locator('.ex-head__title')).toContainText('WINDOW', { timeout: 10_000 });
  await expect(page.locator('.run-pill')).toHaveCount(12);
  await expect(page.locator('.ex-head__nolink')).toBeVisible();
  await expect(page.locator('.ex-head__link')).toHaveCount(0);
  // Default run: Tips + hooks, run 1 (resolved, with hook messages).
  await expect(page.locator('.run .status')).toHaveText(/Resolved/);
  await expect(page.locator('.terminal__msg')).toContainText('co-change');
  await expect(page.locator('.diff__table')).toContainText('TokenType.WINDOW');
  // A failed run.
  await page.locator('.ex-arm', { hasText: 'No setup' }).locator('.run-pill').first().click();
  await expect(page.locator('.run .status')).toHaveText(/Failed/);
  // Compare mode.
  await page.locator('button', { hasText: 'Compare two runs' }).click();
  await page.locator('.ex-arm', { hasText: 'Tuned by Muse Spark' }).locator('.run-pill').nth(1).click();
  await expect(page.locator('.ex-detail.is-compare .run')).toHaveCount(2);
  // Untrusted content stays inert.
  await expect(page.locator('.ex-issue .md img, .ex-issue .md script, .ex-issue .md iframe')).toHaveCount(0);
});

test('trust: retitled web-leak card and the investigation', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  await expect(page.locator('.trust-card__title')).toHaveCount(6);
  await expect(page.locator('.trust-card__title').nth(4)).toHaveText('We caught and measured web leaks');
  await expect(page.locator('#web-leak-investigation')).toBeHidden();
  await page.locator('button', { hasText: 'Open the investigation' }).click();
  const inv = page.locator('#web-leak-investigation');
  await expect(inv).toBeVisible();
  await expect(inv).toContainText('80 of 924 runs reached the real fix or newer upstream code');
  await expect(inv.locator('.tier-table tbody tr')).toHaveCount(5);
  await expect(inv.locator('.robust-table tbody tr')).toHaveCount(4);
  await expect(inv).toContainText('every 95% interval still crosses zero');
});

test('required research content is present', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  await expect(page.locator('.limit')).toHaveCount(8);
  await expect(page.locator('.future__item')).toHaveCount(5);
  await expect(page.locator('.footer')).toContainText('Demonstrated on sqlglot; the method is repo-independent.');
  await expect(page.locator('.built-team')).toContainText('Aryan Kansal');
  await expect(page.locator('.built-team')).toContainText('Eshan Goel');
  await expect(page.locator('.method-step')).toHaveCount(5);
  const body = await page.locator('body').innerText();
  for (const banned of ['production-ready', 'secure', 'faster']) expect(body.toLowerCase()).not.toContain(banned);
});

test('raw data link resolves under the sub-path', async ({ page, request }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  const href = await page.locator('.footer a', { hasText: 'Raw results' }).getAttribute('href');
  const url = new URL(href!, page.url()).toString();
  expect(url).toContain('/uplift/data/results.json');
  const res = await request.get(url);
  expect(res.status()).toBe(200);
  const json = await res.json();
  expect(json.summary.runs).toBe(924);
});

test('no page-level horizontal overflow on phones and tablets', async ({ page }) => {
  for (const width of [375, 390, 768]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(NOGL, { waitUntil: 'networkidle' });
    const { sw, w } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: document.documentElement.clientWidth }));
    expect(sw, `width ${width}`).toBeLessThanOrEqual(w);
  }
});

test('without WebGL the hero shows the still poster', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  await expect(page.locator('.experience canvas')).toHaveCount(0);
  const poster = page.locator('.hero__poster');
  await expect(poster).toBeVisible();
  expect(await poster.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(100);
});

test.describe('WebGL', () => {
  test('scene controls really pause, enter interact mode and reset', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./', { waitUntil: 'networkidle' });
    await expect(page.locator('.experience canvas')).toHaveCount(1);
    await expect(page.locator('.scene-controls')).toHaveClass(/is-visible/, { timeout: 15_000 });
    const ui = () => page.evaluate(() => (window as unknown as { __uplift: { ui: { get: () => Record<string, unknown> } } }).__uplift.ui.get());

    await page.getByRole('button', { name: 'Pause animation' }).click();
    expect((await ui()).paused).toBe(true);
    const t0 = await page.evaluate(() => (window as unknown as { __uplift: { live: { time: number } } }).__uplift.live.time);
    await page.waitForTimeout(600);
    const t1 = await page.evaluate(() => (window as unknown as { __uplift: { live: { time: number } } }).__uplift.live.time);
    expect(t1).toBe(t0);
    await page.getByRole('button', { name: 'Resume animation' }).click();
    expect((await ui()).paused).toBe(false);

    await page.getByRole('button', { name: 'Interact with the 3D scene' }).click();
    expect((await ui()).interact).toBe(true);
    await expect(page.locator('.interact-layer')).toBeVisible();
    await page.mouse.move(900, 450);
    await page.mouse.down();
    await page.mouse.move(1000, 480, { steps: 5 });
    await page.mouse.up();
    const rot = await page.evaluate(() => (window as unknown as { __uplift: { live: { rot: { hero: { y: number } } } } }).__uplift.live.rot.hero.y);
    expect(rot).not.toBe(0);
    await page.keyboard.press('Escape');
    expect((await ui()).interact).toBe(false);

    const tick = (await ui()).resetTick as number;
    await page.getByRole('button', { name: 'Reset the 3D view' }).click();
    expect((await ui()).resetTick).toBe(tick + 1);
    expect(await page.evaluate(() => (window as unknown as { __uplift: { live: { rot: { hero: { y: number } } } } }).__uplift.live.rot.hero.y)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('hero hotspots are real buttons that open a detail card', async ({ page }) => {
    await page.goto('./', { waitUntil: 'networkidle' });
    const spot = page.locator('.hotspot').first();
    await expect(spot).toBeVisible({ timeout: 15_000 });
    await spot.click();
    await expect(page.locator('.hotspot-card')).toContainText('SWE-rebench');
  });

  test('reduced motion: no pinned sequences, still frame', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('./', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await expect(page.locator('.pin-spacer')).toHaveCount(0);
    const ui = await page.evaluate(() => (window as unknown as { __uplift: { ui: { get: () => { reducedMotion: boolean; paused: boolean } } } }).__uplift.ui.get());
    expect(ui.reducedMotion).toBe(true);
    expect(ui.paused).toBe(true);
    // Resume is a real opt-in: time starts advancing.
    const time = () => page.evaluate(() => (window as unknown as { __uplift: { live: { time: number } } }).__uplift.live.time);
    const t0 = await time();
    await page.getByRole('button', { name: 'Resume animation' }).click();
    await page.waitForTimeout(700);
    expect(await time()).toBeGreaterThan(t0);
    await ctx.close();
  });
});
