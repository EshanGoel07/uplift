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

// Engine diagnostics (available with ?diag). Each key is a getter on window.__upliftDiag.
const diag = <T = unknown>(page: Page, key: string): Promise<T> =>
  page.evaluate((k) => (window as unknown as { __upliftDiag: Record<string, () => T> }).__upliftDiag[k](), key);
/** Frames rendered during `ms` with no input. */
const framesDuring = async (page: Page, ms: number): Promise<number> => {
  const a = await diag<number>(page, 'frames');
  await page.waitForTimeout(ms);
  return (await diag<number>(page, 'frames')) - a;
};
/** Waits until rendering has stopped. */
const settled = (page: Page) => expect.poll(() => framesDuring(page, 300), { timeout: 15_000 }).toBe(0);

test('loads from a sub-path with no errors and no task files on first paint', async ({ page }) => {
  const errors = collectErrors(page);
  const taskRequests: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/data/tasks/')) taskRequests.push(r.url()); });
  await page.goto('./', { waitUntil: 'networkidle' });
  await expect(page.locator('#hero-title')).toHaveText(/Do coding.agent setups actually make agents better/);
  await page.waitForTimeout(1000);
  expect(taskRequests).toEqual([]);
  expect(errors).toEqual([]);
  expect(page.url()).toContain('/uplift/');
});

test('hero states the null result and the four study numbers from the data', async ({ page }) => {
  await page.goto('./?nowebgl&hero=runs', { waitUntil: 'networkidle' });
  await expect(page.locator('.hero__title')).toContainText('make agents better at fixing real bugs?');
  await expect(page.locator('.hero__finding')).toContainText('No setup was shown to differ from no setup.');
  await expect(page.locator('.hero__finding')).toContainText('5.4–9.1 percentage points at 80% power. Smaller effects remain unresolved.');
  await expect(page.locator('.hero__byline')).toHaveText('By Eshan Goel and Aryan Kansal · November 2026');
  // The hero figure is drawn from the data: 6 condition rows over 77 bug columns.
  await expect(page.locator('.overview__svg .ov-runs')).toHaveCount(6);
  await expect(page.locator('.overview__svg .ov-task')).toHaveCount(77);
  await expect(page.locator('.overview__svg')).toContainText('924 runs');
  await expect(page.locator('.hero__models')).toContainText('Muse Code');
  await expect(page.locator('.hero__models')).toContainText('Muse Spark');
});

test('navigation jumps to sections and marks the current one', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  await expect(page.locator('.nav__links a')).toHaveText(['Overview', 'How it works', 'Findings', 'Explore bugs', 'Research details']);
  for (const [label, id] of [['Research details', 'details'], ['Findings', 'findings'], ['How it works', 'how'], ['Explore bugs', 'explore']] as const) {
    await page.locator('.nav__links a', { hasText: label }).click();
    await expect.poll(() => page.locator(`#${id}`).evaluate((el) => Math.abs(el.getBoundingClientRect().top)), { timeout: 6000 }).toBeLessThan(120);
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
  // Details live in a readout below the plot (never over it): click, then keyboard.
  await expect(page.locator('.ic-readout')).toContainText('Every interval crosses zero');
  await page.locator('.ic-row').nth(3).click();
  await page.mouse.move(0, 0);
  await expect(page.locator('.ic-readout')).toContainText('Generic tips file');
  await expect(page.locator('.ic-readout')).toContainText('−9.1 to +1.3');
  await expect(page.locator('.ic-readout')).toContainText('not shown to differ from No setup');
  await page.locator('.ic-row').nth(0).focus();
  await expect(page.locator('.ic-readout')).toContainText('Tips file (generated)');
  // Rows share one colour: no setup is drawn as an improvement.
  const fills = await page.locator('.ic-row:not(.is-pinned) .ic-dot').evaluateAll((els) => [...new Set(els.map((e) => getComputedStyle(e).fill))]);
  expect(fills).toHaveLength(1);
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
  await page.locator('#matrix .mx-search input').fill('WINDOW');
  await expect(rows.first()).toContainText('WINDOW');
  await page.locator('#matrix .mx-search input').fill('');
  await page.locator('.seg__btn', { hasText: 'Hooks fired' }).click();
  expect(await rows.count()).toBeLessThan(77);
  await page.locator('.seg__btn', { hasText: /^All$/ }).nth(2).click();

  // Opening a specific bug from a cell loads exactly that task.
  const target = page.locator('.mx-row', { hasText: 'IS NOT NULL incorrect transformation' });
  await target.locator('.mx-cell').first().click();
  await expect(page.locator('.ex-head__title')).toHaveText('IS NOT NULL incorrect transformation', { timeout: 10_000 });
  await expect(page.locator('.ex-head__link')).toHaveAttribute('href', 'https://github.com/tobymao/sqlglot/pull/4331');
});

test('Bug Atlas: three views over one filtered dataset, sort, density and shareable filters', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  await page.locator('#matrix').scrollIntoViewIfNeeded();
  await page.locator('.seg__btn', { hasText: 'Mixed (23)' }).click();
  await expect(page).toHaveURL(/group=mixed/);
  await page.getByRole('group', { name: 'Atlas view' }).getByRole('button', { name: 'Task list' }).click();
  await expect(page.locator('.tasklist li')).toHaveCount(23);
  await page.getByRole('group', { name: 'Atlas view' }).getByRole('button', { name: 'Lattice' }).click();
  await expect(page.locator('.minilat__bug')).toHaveCount(23);
  await expect(page.locator('.minilat__bug i')).toHaveCount(276);
  await page.getByRole('group', { name: 'Density' }).getByRole('button', { name: 'Compact' }).click();
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#matrix').scrollIntoViewIfNeeded();
  await expect(page.locator('.minilat__bug')).toHaveCount(23);
  await page.locator('.minilat__bug').first().click();
  await expect(page.locator('.insp')).toContainText('Task passport');
});

test('deep links and Back/Forward restore the selection', async ({ page }) => {
  await page.goto('./?nowebgl&task=4347&panel=task', { waitUntil: 'networkidle' });
  await expect(page.locator('.insp .insp__id')).toHaveText('4347');
  await expect(page.locator('.attempts tbody tr')).toHaveCount(6);
  await page.locator('.attempts .run-cell').first().click();
  await expect(page).toHaveURL(/cond=none/);
  await expect(page.locator('.insp')).toContainText('Run record');
  await expect(page.locator('.insp')).toContainText('NOT INCLUDED IN PUBLISHED EXPORT');
  await page.goBack();
  await expect(page.locator('.insp')).toContainText('Task passport');
  await page.getByRole('button', { name: 'Close the inspector' }).click();
  await expect(page.locator('.insp')).toHaveCount(0);
  await page.goBack();
  await expect(page.locator('.insp')).toHaveCount(1);
});

test('search palette: keyboard open, real records, no invented results', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  await page.keyboard.press('Control+k');
  const input = page.getByRole('combobox', { name: 'Search the study' });
  await expect(input).toBeFocused();
  await input.fill('zzz-not-a-bug');
  await expect(page.locator('.palette')).toContainText('No matching records');
  await input.fill('4347 tuned 2');
  await page.keyboard.press('Enter');
  await expect(page.locator('.insp')).toContainText('Run record');
  await expect(page).toHaveURL(/task=4347/);
  await page.keyboard.press('Control+k');
  await input.fill('grade');
  await expect(page.locator('.palette li', { hasText: 'grade' }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.palette')).toHaveCount(0);
});

test('comparison tray: runs of different bugs are refused as a matched pair', async ({ page }) => {
  await page.goto('./?nowebgl&task=4347&cond=none&rep=1&panel=run', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Add to comparison' }).click();
  // Beside the open inspector, never under it.
  const inspector = (await page.locator('.insp').boundingBox())!;
  const pill = (await page.locator('.tray__pill').boundingBox())!;
  expect(pill.x + pill.width).toBeLessThan(inspector.x);
  await page.locator('.tray__pill').click();
  await expect(page.locator('.tray')).toContainText('Add one more');
  await page.goto('./?nowebgl&cmp=4347~none~0,fresh-63296846~none~0&panel=compare', { waitUntil: 'networkidle' });
  await expect(page.locator('.insp')).toContainText('not a matched pair');
  await page.goto('./?nowebgl&cmp=4347~none~0,4347~tuned~1&panel=compare', { waitUntil: 'networkidle' });
  await expect(page.locator('.insp .cmp section')).toHaveCount(2);
});

test('findings: sensitivity views use the report figures, and the chart explains itself', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  await page.locator('#results').scrollIntoViewIfNeeded();
  await expect(page.locator('.findstrip')).toContainText('5 intervals cross zero');
  await page.getByRole('button', { name: 'The zero line' }).click();
  await expect(page.locator('.ic-readout')).toContainText('Zero means no difference');
  await page.getByRole('group', { name: 'Sensitivity view' }).getByRole('button', { name: 'Exposed runs counted as failed' }).click();
  await expect(page.locator('.ic-row').nth(3)).toContainText('−3.9');
  await expect(page.locator('.ic-tools__status')).toContainText('5 of 5');
  await page.getByRole('button', { name: 'Compare two conditions' }).click();
  await page.locator('.ic-row').nth(0).click();
  await page.locator('.ic-row').nth(4).click();
  await expect(page.locator('.ic-pair')).toContainText('not a test of one against the other');
});

test('conditions: real artifacts, honest gaps, and the paired explorer', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  const c = page.locator('#conditions');
  await c.scrollIntoViewIfNeeded();
  await c.locator('.cc__pick', { hasText: 'Generic tips file' }).click();
  await c.locator('.cc__files button', { hasText: 'AGENTS.md' }).click();
  await expect(c.locator('.artifact__text')).toContainText('Guidelines for AI coding agents');
  await c.locator('.cc__pick', { hasText: 'Tips file (generated)' }).click();
  await c.locator('.cc__files button', { hasText: 'AGENTS.md' }).click();
  await expect(c.locator('.artifact')).toContainText('NOT INCLUDED IN PUBLISHED EXPORT');
  await c.getByRole('button', { name: 'Compare conditions' }).click();
  await c.getByLabel('Compare with').selectOption('sensors');
  await expect(c.locator('.cc__col')).toHaveCount(2);
  await expect(c.locator('.paired__rows li')).toHaveCount(6);
});

test('WINDOW investigation: trace, approach selector, two-run comparison and reading mode', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  const w = page.locator('#explorer');
  await w.scrollIntoViewIfNeeded();
  await expect(w.locator('.trace li')).toHaveCount(5);
  await w.getByRole('group', { name: 'Approach' }).getByRole('button', { name: /Look-ahead/ }).click();
  await expect(w.locator('.approach')).toHaveCount(1);
  await expect(w.locator('.wcmp .diff')).toHaveCount(2);
  await w.getByRole('button', { name: 'Reading mode' }).click();
  await expect(w.locator('.wcmp.is-reading')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(w.locator('.wcmp.is-reading')).toHaveCount(0);
});

test('architecture: real source, import lens, lineage, topology', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  const a = page.locator('#architecture');
  await a.scrollIntoViewIfNeeded();
  await expect(a.locator('.srcx__tree li')).toHaveCount(20, { timeout: 10_000 });
  await expect(a.locator('.src__code')).toContainText('def grade', { timeout: 10_000 });
  await a.locator('.srcx__fns button', { hasText: 'check_output' }).click();
  await expect(a.locator('tr.is-hit')).toContainText('check_output');
  await a.locator('.ribbon button', { hasText: 'Workspace' }).click();
  await expect(a.locator('.srcx__head code')).toHaveText('src/uplift/workspace.py');
  await expect(a.locator('.ribbon__detail')).toContainText('no history');
  await a.getByRole('group', { name: 'Topology mode' }).getByRole('button', { name: 'Evidence focus' }).click();
  await expect(a.locator('.topo__chain')).toContainText('Not published');
  await a.getByRole('group', { name: 'Topology mode' }).getByRole('button', { name: 'Condition focus' }).click();
  await expect(a.locator('.topo__dots button')).toHaveCount(77);
});

test('integrity: ledger, policy comparison, FAQ; guided tour can be stopped at any point', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  await page.locator('#evidence-ledger').scrollIntoViewIfNeeded();
  await page.getByRole('group', { name: 'Evidence status' }).getByRole('button', { name: 'Unavailable' }).click();
  await expect(page.locator('.ledger__table tbody tr')).toHaveCount(3);
  await expect(page.locator('.policy')).toContainText('The 924 reported runs');
  await expect(page.locator('.faq details')).toHaveCount(6);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: 'Guided tour' }).click();
  await expect(page.locator('.tour')).toContainText('Step 1 of 9');
  await page.locator('.tour').getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('.tour')).toContainText('77 bugs');
  await page.locator('.tour').getByRole('button', { name: 'Skip tour' }).click();
  await expect(page.locator('.tour')).toHaveCount(0);
});

for (const width of [1241, 1280, 1366, 1440, 1600, 1920, 2560]) {
  test(`header items do not overlap at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(NOGL, { waitUntil: 'networkidle' });
    const items = await page.evaluate(() => [...document.querySelectorAll('.nav__brand, .nav__links a, .nav__search, .viewtog, .nav__ext, .nav__status')]
      .map((e) => e.getBoundingClientRect()).filter((r) => r.width).map((r) => [r.left, r.right] as const));
    for (let i = 1; i < items.length; i++) expect(items[i][0], `item ${i}`).toBeGreaterThanOrEqual(items[i - 1][1] - 0.5);
    expect(items[items.length - 1][1]).toBeLessThanOrEqual(width);
  });
}

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

test('worked example: twelve runs, three approaches from the real diffs, hook evidence, provenance', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  const w = page.locator('#explorer');
  await w.scrollIntoViewIfNeeded();
  await expect(w.locator('#worked-title')).toHaveText('One bug. Twelve attempts. Two fundamentally different approaches.');
  await expect(w).toContainText('SELECT col window FROM t');
  // Six equal condition groups with their real results; no run preselected.
  const groups = w.locator('.rboard__group');
  await expect(groups).toHaveCount(6, { timeout: 10_000 });
  await expect(w.locator('.rboard__score')).toHaveText(['0/2', '0/2', '0/2', '2/2', '1/2', '1/2']);
  await expect(w.locator('.rboard .run-pill')).toHaveCount(12);
  await expect(w.locator('.rboard .run-pill[aria-pressed="true"]')).toHaveCount(0);
  await expect(w.locator('.rboard .run-pill__ap')).toHaveText(['Shortcut', 'Shortcut', 'Shortcut', 'Other', 'Shortcut', 'Shortcut', 'Look-ahead', 'Look-ahead', 'Look-ahead', 'Shortcut', 'Shortcut', 'Look-ahead']);
  // Approaches: counts computed from the data, real patches.
  await expect(w.locator('.approach--shortcut .approach__count')).toHaveText('7 runs · 0 solved');
  await expect(w.locator('.approach--lookahead .approach__count')).toHaveText('4 runs · 4 solved');
  await expect(w.locator('.approach--other .approach__count')).toHaveText('1 run · 0 solved');
  await expect(w.locator('.approach--shortcut .diff__body')).toContainText('ALIAS_TOKENS: t.ClassVar = ID_VAR_TOKENS - {TokenType.WINDOW}');
  await expect(w.locator('.approach--lookahead .diff__body')).toContainText('def _is_window_clause(self) -> bool:');
  await expect(w.locator('.approach--other .diff__body')).toContainText('AMBIGUOUS_ALIAS_TOKENS');
  await expect(w.locator('.approach--shortcut')).toContainText('The full pytest log is not part of the published data.');
  // Switch the look-ahead panel to another look-ahead run.
  await w.locator('.approach--lookahead .approach__runs button', { hasText: 'Tips + hooks · R2' }).click();
  await expect(w.locator('.approach--lookahead .approach__diff-id')).toContainText('Tips + hooks · repeat 2');
  // Hook evidence: the real co-change message and the four runs that received it.
  await expect(w.locator('.worked__evidence .hookmsg')).toContainText('co-change: you edited sqlglot/parser.py but not sqlglot/generator.py. New AST shape needs generator support or transpilation will regress.');
  await expect(w.locator('.worked__evidence .hookmsg')).toContainText('sqlglot/expressions.py');
  await expect(w.locator('.worked__warned li')).toHaveText([/Hooks \(generated\) · repeat 1.*Not resolved/, /Hooks \(generated\) · repeat 2.*Not resolved/, /Tips \+ hooks · repeat 1.*Solved/, /Tips \+ hooks · repeat 2.*Solved/]);
  await expect(w.locator('.worked__web')).toContainText('None of the 12 runs accessed the web, according to the documented web audit.');
  await expect(w.locator('.worked__web')).toContainText('The published JSON does not include the raw traces');
  await expect(w.locator('.worked__point')).toHaveText('Different approaches produced different outcomes. This one task cannot establish a causal benefit of any setup.');
  // Open a run from the board.
  await w.locator('.rboard__group', { hasText: 'Hooks (generated)' }).locator('.run-pill').first().click();
  await expect(w.locator('.worked__detail .run__name')).toHaveText('Hooks (generated) · repeat 1');
  await expect(w.locator('.worked__detail .hookmsg')).toContainText('co-change');
  await expect(w.locator('.ex-issue .md img, .ex-issue .md script, .ex-issue .md iframe')).toHaveCount(0);
});

test('explorer: any of the 77 bugs, search, twelve runs, neutral default, compare, safe markdown', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  const x = page.locator('#explorer-all');
  await x.scrollIntoViewIfNeeded();
  await expect(x.locator('.tp-item')).toHaveCount(77);
  await expect(x.locator('.ex-head__title')).toContainText('WINDOW', { timeout: 10_000 });
  await expect(x.locator('.run-pill')).toHaveCount(12);
  await expect(x.locator('.ex-head__nolink')).toBeVisible();
  // Neutral default: the baseline's first repeat.
  await expect(x.locator('.run__name')).toHaveText('No setup · repeat 1');
  await expect(x.locator('.run .status')).toHaveText(/Not resolved/);
  await expect(x.locator('.diff__body')).toContainText('TokenType.WINDOW');
  // A hooks run shows its messages, styled apart from the code.
  await x.locator('.ex-arm', { hasText: 'Hooks (generated)' }).locator('.run-pill').first().click();
  await expect(x.locator('.hookmsg')).toContainText('co-change');
  // Search and select another bug.
  await x.locator('.tp__search input').fill('IS NOT NULL');
  await expect(x.locator('.tp-item')).toHaveCount(1);
  await x.locator('.tp-item').first().click();
  await expect(x.locator('.ex-head__title')).toHaveText('IS NOT NULL incorrect transformation', { timeout: 10_000 });
  await expect(x.locator('.ex-head__link')).toHaveAttribute('href', 'https://github.com/tobymao/sqlglot/pull/4331');
  // Compare mode.
  await x.locator('button', { hasText: 'Compare two runs' }).click();
  await x.locator('.ex-arm', { hasText: 'Tuned by Muse Spark' }).locator('.run-pill').nth(1).click();
  await expect(x.locator('.ex-detail.is-compare .run')).toHaveCount(2);
  await expect(x.locator('.ex-issue .md img, .ex-issue .md script, .ex-issue .md iframe')).toHaveCount(0);
});

test('worked example and explorer on a phone: stacked approaches and condition accordions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  const w = page.locator('#explorer');
  await w.scrollIntoViewIfNeeded();
  await expect(w.locator('details.rboard__group')).toHaveCount(6, { timeout: 10_000 });
  await expect(w.locator('.rboard .run-pill').first()).toBeHidden();
  await w.locator('details.rboard__group summary', { hasText: 'Tips + hooks' }).click();
  await expect(w.locator('details.rboard__group[open] .run-pill')).toHaveCount(2);
  const [a, b] = await Promise.all([w.locator('.approach--shortcut').boundingBox(), w.locator('.approach--lookahead').boundingBox()]);
  expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
  const x = page.locator('#explorer-all');
  await x.scrollIntoViewIfNeeded();
  await expect(x.locator('.ex-picker-acc')).toBeVisible();
  await expect(x.locator('.ex-head__title')).toContainText('WINDOW', { timeout: 10_000 });
});

test('trust: retitled web-leak card and the investigation', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  await expect(page.locator('.trust-card__title')).toHaveCount(6);
  await expect(page.locator('.trust-card__title').nth(4)).toHaveText('We caught and measured web leaks');
  // The card stays short and points to the investigation, which carries the detail.
  await expect(page.locator('.trust-card').nth(4)).toContainText('New runs are now blocked from the network.');
  await expect(page.locator('.trust-card').nth(4).locator('a')).toHaveAttribute('href', '#web-leak-investigation');
  const inv = page.locator('#web-leak-investigation');
  await expect(inv).toBeVisible();
  await expect(inv).toContainText('80 of 924 runs reached the real fix or newer upstream code');
  await expect(inv.locator('.tier-table tbody tr')).toHaveCount(5);
  await expect(inv.locator('.robust-table tbody tr')).toHaveCount(4);
  await expect(inv).toContainText('every 95% interval still crosses zero');
  // The timeline, in order: default network, audit, sensitivity, probe-verified block, not re-run, filesystem.
  const steps = inv.locator('.timeline > li h4');
  await expect(steps).toHaveCount(6);
  await expect(steps.nth(3)).toContainText('verified with a probe');
  await expect(inv.locator('.probe')).toContainText('Could not resolve host: github.com');
  await expect(steps.nth(4)).toContainText('not repeated under the block');
  await expect(steps.nth(5)).toContainText('filesystem');
  await expect(inv).toContainText('37 runs got there through web fetch alone, 30 through the shell alone and 13 through both');
  // Checks below the investigation, each linked to its source file.
  await expect(page.locator('#trust .check')).toHaveCount(5);
  for (const f of ['grade.py', 'screen.py', 'split.py', 'workspace.py', 'tune.py', 'budget_proxy.py']) {
    await expect(page.locator('#trust .check a', { hasText: f })).toHaveAttribute('href', /github\.com\/EshanGoel07\/uplift\//);
  }
  await expect(page.locator('#trust .check--wide tbody tr')).toHaveCount(6);
});

test('matrix ceiling bar shows the 43 / 23 / 11 split from the data', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  const segs = page.locator('.ceiling__seg b');
  await expect(segs).toHaveText(['43', '23', '11']);
  await expect(page.locator('#ceiling-cap')).toContainText('only the 23 mixed bugs can show');
});

test('limitations: four groups, numbered in reading order', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  await expect(page.locator('.limits__name')).toHaveText(['Scope', 'Power', 'Artifacts', 'Measurement']);
  await expect(page.locator('.limit__n')).toHaveText(Array.from({ length: 13 }, (_, i) => String(i + 1).padStart(2, '0')));
  for (const k of ['One repository', 'Limited power', 'Ceiling effect', 'Web exposure in the 924 runs', 'Not re-run under the network block',
    'Filesystem access', 'Repeats, not seeds', 'Tuned on development runs', 'Detailed artifacts are not published']) {
    await expect(page.locator('.limit__t', { hasText: k })).toHaveCount(1);
  }
});

test('footer links point at the real study files', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  const f = page.locator('.footer');
  const repo = 'https://github.com/EshanGoel07/uplift';
  for (const [text, href] of [
    ['Full report', `${repo}/blob/main/reports/main.md`],
    ['Engineering log', `${repo}/blob/main/PHASE_LOG.md`],
    ['README', `${repo}/blob/main/README.md`],
    ['Apache-2.0 licence', `${repo}/blob/main/LICENSE`],
  ] as const) {
    await expect(f.locator('a', { hasText: text }).first()).toHaveAttribute('href', href);
  }
  await expect(f.locator('a', { hasText: 'arXiv:2505.20411' })).toHaveAttribute('href', /arxiv\.org\/abs\/2505\.20411/);
  await expect(f.locator('a[href="#"], a:not([href])')).toHaveCount(0);
});

test('required research content is present', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  await expect(page.locator('.limit')).toHaveCount(13);
  await expect(page.locator('.future__item')).toHaveCount(5);
  await expect(page.locator('.footer')).toContainText('Demonstrated on sqlglot; the method is repo-independent.');
  await expect(page.locator('.built-team')).toContainText('Aryan Kansal');
  await expect(page.locator('.built-team')).toContainText('Eshan Goel');
  await expect(page.locator('.method-step')).toHaveCount(8);
  const body = await page.locator('body').innerText();
  for (const banned of ['production-ready', 'secure', 'faster', 'copied', 'oct 29', 'could not be verified']) expect(body.toLowerCase()).not.toContain(banned);
  // Dates, licence wording and links.
  await expect(page.locator('#built')).toContainText('Oct 27 – Nov 4, 2026');
  await expect(page.locator('#built')).toContainText('The issue texts of the 39 SWE-rebench tasks are included under CC-BY-4.0 with attribution');
  await expect(page.locator('.arm-table')).toContainText('A generic best-practice file, written by us in the style commonly shared online.');
  const repo = 'https://github.com/EshanGoel07/uplift';
  await expect(page.locator('.nav__externals a', { hasText: 'GitHub' })).toHaveAttribute('href', repo);
  await expect(page.locator('.footer a', { hasText: 'Source repository' })).toHaveAttribute('href', repo);
  await expect(page.locator('.footer a', { hasText: 'NOTICE.md' })).toHaveAttribute('href', `${repo}/blob/main/NOTICE.md`);
  await expect(page.locator('.footer__demo')).toContainText('Demo video');
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

test('without WebGL the hero and findings are complete', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.locator('.nebmap button')).toHaveCount(77);
  await page.locator('.herosw button', { hasText: '924 runs' }).click();
  await expect(page.locator('.overview__svg')).toBeVisible();
  await page.locator('#results').scrollIntoViewIfNeeded();
  await expect(page.locator('.ic-svg')).toBeVisible();
  await expect(page.locator('.arm-table')).toBeVisible();
});

test('moving between destinations is browser history, and old section links still land', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  await page.locator('.nav__links a', { hasText: 'Findings' }).click();
  await expect(page).toHaveURL(/#findings$/);
  await expect.poll(() => page.locator('#findings').evaluate((el) => Math.abs(el.getBoundingClientRect().top)), { timeout: 6000 }).toBeLessThan(120);
  await page.locator('.nav__links a', { hasText: 'Research details' }).click();
  await expect(page).toHaveURL(/#details$/);
  await page.goBack();
  await expect(page).toHaveURL(/#findings$/);
  await expect.poll(() => page.locator('#findings').evaluate((el) => Math.abs(el.getBoundingClientRect().top)), { timeout: 6000 }).toBeLessThan(160);
  await page.goBack();
  await expect(page).not.toHaveURL(/#/);

  await page.goto(`${NOGL}#trust`, { waitUntil: 'networkidle' });
  await expect.poll(() => page.locator('#trust').evaluate((el) => Math.abs(el.getBoundingClientRect().top)), { timeout: 6000 }).toBeLessThan(120);
});

const storyStep = (page: Page) => page.locator('.story__step.is-active').getAttribute('data-step');
const toStep = (page: Page, i: number) => page.locator(`.story__step[data-step="${i}"]`).evaluate((el) => el.scrollIntoView({ behavior: 'instant', block: 'center' }));

test('the story reads in full without WebGL, as text and figures', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  await expect(page.locator('.story__step')).toHaveCount(5);
  await expect(page.locator('.story__title')).toHaveText(['One real bug.', 'Six conditions.', 'Two repeats.', 'Now every bug.', '924 runs.']);
  await expect(page.locator('.story__canvas .story__figure')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.story__stage')).toHaveCount(0);
  await expect(page.locator('.story__step .story__figure')).toHaveCount(5);
});

test('the story follows native scrolling forward, backward and through skipped steps', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  await toStep(page, 1);
  await expect.poll(() => storyStep(page)).toBe('1');
  await toStep(page, 4);
  await expect.poll(() => storyStep(page)).toBe('4');
  await expect(page.locator('.story__formula')).toContainText('77 bugs × 6 conditions × 2 repeats = 924 runs');
  await toStep(page, 0);
  await expect.poll(() => storyStep(page)).toBe('0');
  await expect(page.locator('.story__formula')).toHaveCount(0);
  await page.getByRole('button', { name: /^Step 3:/ }).click();
  await expect.poll(() => storyStep(page)).toBe('2');
  await expect(page.locator('.story__formula')).toContainText('= 12 attempts');
  const y = await page.evaluate(() => window.scrollY);
  await page.mouse.move(300, 400);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(y);
});

test('resizing inside the story keeps its place', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  await toStep(page, 3);
  await expect.poll(() => storyStep(page)).toBe('3');
  await page.setViewportSize({ width: 1100, height: 700 });
  await expect.poll(() => storyStep(page)).toBe('3');
});

test('a clean first load opens no inspector and keeps the Nebula clear, and deep links still open one', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('./?nowebgl', { waitUntil: 'networkidle' });
  await expect(page.locator('.insp')).toHaveCount(0);
  await expect(page.locator('.tray')).toHaveCount(0);
  await page.goto('./?nowebgl&task=4347&panel=task', { waitUntil: 'networkidle' });
  await expect(page.locator('.insp')).toContainText('Task passport');
  await ctx.close();
});

test('comparison tray: a small pill that opens only on request', async ({ page }) => {
  await page.goto('./?nowebgl&cmp=4347~none~0,4347~tuned~1', { waitUntil: 'networkidle' });
  const pill = page.locator('.tray__pill');
  await expect(pill).toContainText('2');
  await expect(page.locator('.tray__go')).toHaveCount(0);
  await pill.click();
  await expect(page.locator('.tray__go')).toHaveText('Compare');
  await page.getByRole('button', { name: 'Collapse the comparison tray' }).click();
  await expect(page.locator('.tray__go')).toHaveCount(0);
  await expect(page).toHaveURL(/cmp=/);
});

test('small-screen menu works with pointer and keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  const btn = page.locator('.nav__menu-btn');
  await expect(page.locator('.nav__links')).toBeHidden();
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#nav-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#nav-menu')).toBeHidden();
  await expect(btn).toBeFocused();
  await page.keyboard.press('Enter');
  await page.locator('#nav-menu a', { hasText: 'Findings' }).click();
  await expect(page.locator('#nav-menu')).toBeHidden();
  await page.waitForTimeout(1600);
  // The heading lands below the sticky header, not under it.
  const header = await page.locator('.nav').evaluate((el) => el.getBoundingClientRect().bottom);
  const heading = await page.locator('#results-title').evaluate((el) => el.getBoundingClientRect().top);
  expect(heading).toBeGreaterThanOrEqual(header);
});

test('experiment workbench (2D): sources, lanes, runs, the information barrier and the analysis', async ({ page }) => {
  await page.goto(NOGL, { waitUntil: 'networkidle' });
  const wbx = page.locator('#method');
  await wbx.scrollIntoViewIfNeeded();
  // Without WebGL the 2D diagram carries everything; no 3D switch is offered.
  await expect(wbx.locator('.wbd')).toBeVisible();
  await expect(wbx.locator('.seg-dark button', { hasText: '3D view' })).toHaveCount(0);
  await expect(wbx.locator('.wbd__row')).toHaveCount(6);
  await expect(wbx.locator('.wbd__run')).toHaveCount(12);
  await expect(wbx.locator('.wbd__tiles i')).toHaveCount(77);
  await expect(wbx.locator('.wbd__sel')).toContainText('fresh-63296846');
  // Dev tasks are a separate source.
  await wbx.locator('.wbd__module--dev').click();
  await expect(wbx.locator('.wb-inspector')).toContainText('40 dev tasks, kept out of the main experiment');
  // A condition: receives / does not receive / files / why, plus this bug's real runs.
  await wbx.locator('.wbd__lane', { hasText: 'Tips + hooks' }).click();
  const insp = wbx.locator('.wb-inspector');
  await expect(insp.locator('.wb-inspector__title')).toHaveText('Tips + hooks');
  for (const t of ['Receives', 'Does not receive', 'Files installed', 'Why it exists', '.muse/hooks.json']) await expect(insp).toContainText(t);
  await expect(insp.locator('.wb-runs .r-ok')).toHaveCount(2);
  // A run, loaded from the task file.
  await wbx.locator('.wbd__run').nth(0).click();
  await expect(insp).toContainText('No setup, repeat 1');
  await expect(insp).toContainText('Not resolved');
  // The barrier switch.
  await wbx.locator('.seg-dark button', { hasText: 'What the agent sees' }).click();
  await expect(wbx.locator('.wbd')).toHaveClass(/is-agent/);
  await expect(insp).toContainText('Fix the issue below so the code behaves as described.');
  await expect(insp).toContainText('Never given to the agent');
  await wbx.locator('.seg-dark button', { hasText: 'What the evaluator sees' }).click();
  await expect(wbx.locator('.wbd')).toHaveClass(/is-evaluator/);
  await expect(insp).toContainText('FAIL_TO_PASS');
  await expect(insp).toContainText('Apply the hidden tests');
  // Paired analysis for this bug, then another bug.
  await wbx.locator('.wbd__score').first().click();
  await expect(insp.locator('.wb-table tbody tr')).toHaveCount(6);
  await expect(insp.locator('.wb-table tbody tr').nth(3)).toContainText('+1.0');
  await wbx.getByRole('button', { name: 'Next bug' }).click();
  await expect(wbx.locator('.wbd__sel')).not.toContainText('fresh-63296846');
  await wbx.getByRole('button', { name: 'Reset to overview' }).click();
  await expect(insp.locator('.wb-inspector__title')).toHaveText('One bug, six conditions, two repeats each.');
  // No pin: the section scrolls normally.
  await expect(page.locator('#method .pin-spacer, .pin-spacer:has(#method)')).toHaveCount(0);
});

test.describe('WebGL', () => {
  test('experiment workbench (3D): the model mounts in the shared canvas and its labels drive the inspector', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./?hero=runs', { waitUntil: 'networkidle' });
    await page.locator('.wb__toolbar').scrollIntoViewIfNeeded();
    await expect(page.locator('.experience canvas')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator('.wb__stage')).toBeVisible();
    await expect(page.locator('.wb-label')).toHaveCount(17);
    await page.locator('.wb-label button', { hasText: 'F · Paired analysis' }).click();
    await expect(page.locator('.wb-inspector__title')).toHaveText('Each condition against No setup, on the same bug');
    await page.getByRole('group', { name: 'Camera preset' }).getByRole('button', { name: 'Full apparatus' }).click();
    await page.locator('.wb-label button', { hasText: '5 Generic tips file' }).click();
    await expect(page.locator('.wb-inspector__title')).toHaveText('Generic tips file');
    await expect(page.locator('.wb-inspector')).toContainText('A generic best-practice file, written by us in the style commonly shared online.');
    await page.locator('.seg-dark button', { hasText: '2D diagram' }).click();
    await expect(page.locator('.wbd')).toBeVisible();
    // Clicks on the 2D diagram must not reach the hidden 3D model behind it.
    await page.locator('.wbd__run').nth(6).click();
    await expect(page.locator('.wb-inspector__title')).toHaveText('Tips + hooks, repeat 1');
    await page.locator('.seg-dark button', { hasText: '3D view' }).click();
    await expect(page.locator('.wb__stage')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('hero run lattice: builds, reveals outcomes, and its readout follows the stepper', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./?hero=runs', { waitUntil: 'networkidle' });
    // The lattice draws in the one shared canvas: no canvas of its own, and exactly one on the page.
    await expect(page.locator('.experience canvas')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator('canvas')).toHaveCount(1);
    await expect(page.locator('.lattice__canvas-wrap canvas')).toHaveCount(0);
    await expect(page.locator('.scene-controls')).toHaveCount(0);
    // After the build-in, the results arrive on their own once.
    const outcomes = page.locator('.seg-dark button', { hasText: 'Outcomes' });
    await expect(outcomes).toHaveAttribute('aria-pressed', 'true', { timeout: 12_000 });
    await expect(page.locator('.lattice__caption')).toContainText('54 of 77');
    // Readout starts on the featured bug and follows the stepper; per-setup results come from the data.
    await expect(page.locator('.lattice__bug-id')).toHaveText('fresh-63296846');
    await expect(page.locator('.lattice__runs li')).toHaveCount(6);
    await expect(page.locator('.lattice__runs li').nth(3).locator('.d-solved')).toHaveCount(2); // Tips + hooks 2/2
    await expect(page.locator('.lattice__runs li').nth(2).locator('.d-failed')).toHaveCount(2); // Hooks 0/2
    await page.locator('.lattice').getByRole('button', { name: 'Next bug' }).click();
    await expect(page.locator('.lattice__pos')).toHaveText('Bug 52 of 77');
    // The reader's choice wins.
    await page.locator('.seg-dark button', { hasText: 'Design' }).click();
    await expect(page.locator('.lattice__caption')).toContainText('Six lanes, one per condition');
    await page.locator('#method').scrollIntoViewIfNeeded();
    await expect(page.locator('.experience canvas')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator('canvas')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('one canvas: Nebula, lattice and Workbench share one renderer, across scene switches', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./?diag', { waitUntil: 'networkidle' });
    await expect(page.locator('canvas')).toHaveCount(1, { timeout: 15_000 });
    await page.evaluate(() => { document.querySelector('canvas')!.dataset.first = 'yes'; });
    for (let i = 0; i < 2; i++) {
      await page.locator('.herosw button', { hasText: '924 runs' }).click();
      await page.waitForTimeout(400);
      await page.locator('.herosw button', { hasText: '77 bugs' }).click();
      await page.waitForTimeout(400);
      await page.locator('#method .wb__stage').scrollIntoViewIfNeeded();
      // The Workbench chunk loads as it approaches, so wait for it rather than for any one active scene.
      await expect.poll(async () => (await diag<{ id: string; mounts: number }[]>(page, 'scenes')).find((s) => s.id === 'workbench')?.mounts, { timeout: 15_000 }).toBe(1);
      await expect.poll(() => diag(page, 'activeScenes')).toBe(1);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
    }
    await expect(page.locator('canvas[data-first="yes"]')).toHaveCount(1);
    expect(await page.locator('canvas').count()).toBe(1);
    expect(await diag(page, 'contexts')).toBe(1);
    const list = await diag<{ id: string; mounts: number }[]>(page, 'scenes');
    expect(list.find((s) => s.id === 'workbench')?.mounts).toBe(1);
    expect(errors).toEqual([]);
  });

  test('Nebula: 77 selectable bugs, lenses, dock and the shared selection', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./?diag', { waitUntil: 'networkidle' });
    await expect(page.locator('.lattice__loading')).toHaveCount(0, { timeout: 15_000 });
    await settled(page);
    expect(await framesDuring(page, 1000)).toBe(0);
    const lens = page.getByRole('group', { name: 'Nebula lens' });
    await lens.getByRole('button', { name: 'Outcome' }).click();
    await expect(page.locator('.lattice__key')).toContainText('Always 43');
    await lens.getByRole('button', { name: 'Condition' }).click();
    await expect(page.locator('.lens-cond')).toHaveCount(6);
    await page.getByRole('button', { name: 'Focus the selected bug' }).click();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'Reset the view' }).click();
    await expect(lens.getByRole('button', { name: 'Explore' })).toHaveAttribute('aria-pressed', 'true');
    // The stepper moves the one selection, which the URL and the Bench both follow.
    await page.locator('.lattice').getByRole('button', { name: 'Next bug' }).click();
    await expect(page).toHaveURL(/task=/);
    await page.getByRole('button', { name: 'Guided', exact: true }).click();
    await expect(page.locator('.neb-guide')).toContainText('One node, one bug');
    await page.getByRole('button', { name: 'Exit guide' }).click();
    await expect(page.locator('.neb-guide')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('lattice: isolate a condition, a repeat and a bug, without any instance upload', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __up: number };
      w.__up = 0;
      const P = WebGL2RenderingContext.prototype, o = P.bufferSubData;
      P.bufferSubData = function (this: WebGL2RenderingContext, ...a: unknown[]) { w.__up++; return (o as (...x: unknown[]) => void).apply(this, a); } as typeof o;
    });
    await page.goto('./?diag&hero=runs', { waitUntil: 'networkidle' });
    await expect(page.locator('.seg-dark button', { hasText: 'Outcomes' })).toHaveAttribute('aria-pressed', 'true', { timeout: 12_000 });
    await settled(page);
    const before = await page.evaluate(() => (window as unknown as { __up: number }).__up);
    const iso = page.getByRole('group', { name: 'Isolate a condition' });
    await iso.getByRole('button', { name: 'Tips + hooks' }).click();
    await expect(page).toHaveURL(/cond=both/);
    await page.getByRole('group', { name: 'Isolate a repeat' }).getByRole('button', { name: 'R2' }).click();
    await expect(page).toHaveURL(/rep=2/);
    await page.getByRole('button', { name: 'Isolate this bug' }).click();
    await settled(page);
    expect(await page.evaluate(() => (window as unknown as { __up: number }).__up)).toBe(before);
    await iso.getByRole('button', { name: 'All' }).click();
    await expect(page).not.toHaveURL(/cond=/);
  });

  test('apparatus: presets, top-down, exploded workspace by condition, barrier cross-section', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./?diag', { waitUntil: 'networkidle' });
    await page.locator('#method .wb__stage').scrollIntoViewIfNeeded();
    await expect.poll(async () => (await diag<{ stageWidth: number }>(page, 'workbenchBounds')).stageWidth, { timeout: 15_000 }).toBeGreaterThan(0);
    const presets = page.getByRole('group', { name: 'Camera preset' });
    await expect(presets.getByRole('button')).toHaveCount(8);
    await presets.getByRole('button', { name: 'Top-down' }).click();
    await settled(page);
    await presets.getByRole('button', { name: 'Grading' }).click();
    await settled(page);
    await page.getByRole('button', { name: 'Explode workspace' }).click();
    const layers = page.locator('.wslayers__list li');
    await page.getByRole('group', { name: 'Condition of this workspace' }).getByRole('button', { name: 'No setup' }).click();
    await expect(layers).toHaveCount(6);     // no AGENTS.md, no hooks
    await page.getByRole('group', { name: 'Condition of this workspace' }).getByRole('button', { name: 'Tips + hooks' }).click();
    await expect(layers).toHaveCount(8);
    await layers.nth(5).locator('.wslayers__pick').click();
    await expect(page.locator('.wslayers__detail')).toContainText('Hooks that run');
    await page.getByRole('button', { name: 'Reassemble' }).click();
    await page.getByRole('button', { name: 'Barrier cross-section' }).click();
    await expect(page.locator('.barrier')).toContainText('Only the patch crosses');
    await expect(page.locator('.barrier__hidden')).toContainText('Never shown to the agent');
    await settled(page);
    await page.getByRole('button', { name: 'Reset to overview' }).click();
    await settled(page);
    const b = await diag<{ left: number; right: number; stageWidth: number }>(page, 'workbenchBounds');
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.right).toBeLessThanOrEqual(b.stageWidth);
    expect(errors).toEqual([]);
  });

  for (const width of [1024, 1280, 1440]) {
    test(`apparatus labels do not cover each other at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('./?diag&hero=runs', { waitUntil: 'networkidle' });
      await page.locator('#method .wb__stage').scrollIntoViewIfNeeded();
      await expect(page.locator('.wb-label').first()).toBeVisible({ timeout: 15_000 });
      // Labels stack at the origin until the Workbench chunk mounts and places them, so wait for that.
      await expect.poll(() => page.evaluate(() => {
        const r = [...document.querySelectorAll('.wb__labels .wb-label')].map((e) => e.getBoundingClientRect()).filter((b) => b.width);
        let hits = r.length > 8 ? 0 : 99;
        for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) if (r[i].left < r[j].right && r[i].right > r[j].left && r[i].top < r[j].bottom && r[i].bottom > r[j].top) hits++;
        return hits;
      }), { timeout: 15_000 }).toBe(0);
    });
  }

  test('rendering stops at rest: hero and workbench draw nothing while nothing changes', async ({ page }) => {
    await page.goto('./?diag&hero=runs', { waitUntil: 'networkidle' });
    await expect(page.locator('.seg-dark button', { hasText: 'Outcomes' })).toHaveAttribute('aria-pressed', 'true', { timeout: 12_000 });
    await settled(page);
    expect(await framesDuring(page, 1500)).toBe(0);
    await page.locator('#method .wb__stage').scrollIntoViewIfNeeded();
    // Over a real network the Workbench chunk can arrive after a quiet moment, then play its build-in.
    await expect.poll(async () => (await diag<{ id: string; mounts: number }[]>(page, 'scenes')).find((s) => s.id === 'workbench')?.mounts, { timeout: 15_000 }).toBe(1);
    await page.waitForTimeout(600);
    await settled(page);
    expect(await framesDuring(page, 1500)).toBe(0);
    expect(await diag(page, 'frameloop')).toBe('demand');
  });

  test('an animation requests frames only while it runs, then rendering settles', async ({ page }) => {
    await page.goto('./?diag&hero=runs', { waitUntil: 'networkidle' });
    const outcomes = page.locator('.seg-dark button', { hasText: 'Outcomes' });
    await expect(outcomes).toHaveAttribute('aria-pressed', 'true', { timeout: 12_000 });
    await settled(page);
    const before = await diag<number>(page, 'frames');
    await page.locator('.seg-dark button', { hasText: 'Design' }).click();
    await expect.poll(() => diag(page, 'frames')).toBeGreaterThan(before + 5);
    await settled(page);
    expect(await framesDuring(page, 1000)).toBe(0);
    expect(await diag(page, 'animating')).toBe(false);
  });

  test('off-screen scenes do not react to the pointer or to scrolling elsewhere', async ({ page }) => {
    await page.goto('./?diag&hero=runs', { waitUntil: 'networkidle' });
    await expect(page.locator('.seg-dark button', { hasText: 'Outcomes' })).toHaveAttribute('aria-pressed', 'true', { timeout: 12_000 });
    await page.evaluate(() => document.getElementById('results')!.scrollIntoView());
    await settled(page);
    const before = await diag<number>(page, 'frames');
    for (let i = 0; i < 40; i++) await page.mouse.move(200 + i * 20, 300 + (i % 7) * 30);
    await page.evaluate(() => window.scrollBy(0, 120));
    await page.waitForTimeout(400);
    expect(await diag<number>(page, 'frames')).toBe(before);
  });

  test('hovering a cube reads out its bug, and clicking opens it in the explorer', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./?hero=runs', { waitUntil: 'networkidle' });
    await expect(page.locator('.seg-dark button', { hasText: 'Outcomes' })).toHaveAttribute('aria-pressed', 'true', { timeout: 12_000 });
    const wrap = page.locator('.lattice__canvas-wrap');
    const box = (await wrap.boundingBox())!;
    const start = await page.locator('.lattice__pos').textContent();
    // The test bugs fill the left of the sheet; the gap before the fresh bugs has nothing to hover.
    await page.mouse.move(box.x + box.width * 0.43, box.y + box.height * 0.68);
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.68);
    await expect(page.locator('.lattice__pos')).not.toHaveText(start!);
    // The readout follows once the pointer pauses, and the lifted cube can move under a resting pointer.
    let id = '', prev = '-';
    await expect.poll(async () => {
      prev = id;
      await page.waitForTimeout(400);
      id = (await page.locator('.lattice__bug-id').textContent())!;
      return id === prev;
    }, { timeout: 8000 }).toBe(true);
    await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.68);
    await expect(page.locator('.insp .insp__id')).toContainText(id);
    await expect(page.locator('.insp')).toContainText('Task passport');
    expect(errors).toEqual([]);
  });

  test('a pointer sweep down all 77 columns never misses its bug', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto('./?diag&hero=runs', { waitUntil: 'networkidle' });
    await expect(page.locator('.seg-dark button', { hasText: 'Outcomes' })).toHaveAttribute('aria-pressed', 'true', { timeout: 12_000 });
    await page.waitForFunction(() => (window as any).__upliftDiag?.latticeColumn(0));
    const box = (await page.locator('.lattice__canvas-wrap').boundingBox())!;
    const missed: string[] = [];
    for (let bug = 0; bug < 77; bug++) {
      const [top, bottom] = await page.evaluate((b) => (window as any).__upliftDiag.latticeColumn(b), bug);
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        await page.mouse.move(box.x + top.x + (bottom.x - top.x) * t, box.y + top.y + (bottom.y - top.y) * t);
        // Two animation frames: the pointer event has been handled and React has committed.
        const hovered = await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done((window as any).__upliftDiag.latticeHovered())))));
        if (hovered !== bug) missed.push(`bug ${bug} at ${t.toFixed(2)}: ${hovered}`);
      }
    }
    expect(missed).toEqual([]);
  });

  test('phones: the 2D Atlas, no canvas, and no three.js download', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const errors = collectErrors(page);
    const js: string[] = [];
    page.on('request', (r) => { if (r.url().endsWith('.js')) js.push(r.url()); });
    await page.goto('./', { waitUntil: 'networkidle' });
    await expect(page.locator('.nebmap button')).toHaveCount(77);
    await page.locator('.nebmap button').first().click();
    await expect(page.locator('.insp')).toContainText('Task passport');
    await page.getByRole('button', { name: 'Close the inspector' }).click();
    await page.locator('#method').scrollIntoViewIfNeeded();
    await expect(page.locator('.wbd')).toBeVisible();
    expect(await page.locator('canvas').count()).toBe(0);
    expect(js.filter((u) => /ExperienceCanvas|WorkbenchLayer/.test(u))).toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('a WebGL failure leaves no blank stage: the SVG figure and the 2D diagram take over', async ({ page }) => {
    await page.addInitScript(() => {
      const real = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...a: unknown[]) {
        return /webgl/.test(type) ? null : (real as (...x: unknown[]) => unknown).call(this, type, ...a);
      } as typeof real;
    });
    await page.goto('./?hero=runs', { waitUntil: 'networkidle' });
    await expect(page.locator('.herosw button', { hasText: '924 runs' })).toBeVisible({ timeout: 15_000 });
    await page.locator('.herosw button', { hasText: '924 runs' }).click();
    await expect(page.locator('.overview__svg')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.lattice__canvas-wrap')).toHaveCount(0);
    await page.locator('#method').scrollIntoViewIfNeeded();
    await expect(page.locator('.wbd')).toBeVisible();
    await expect(page.locator('#results .ic-svg')).toBeVisible();
  });

  test('dynamic chunks: phones and tablets never download the Workbench layer', async ({ browser }) => {
    for (const width of [390, 768]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await ctx.newPage();
      const js: string[] = [];
      page.on('request', (r) => { if (r.url().endsWith('.js')) js.push(r.url()); });
      await page.goto('./?hero=runs', { waitUntil: 'networkidle' });
      await expect(page.locator('canvas')).toHaveCount(width > 760 ? 1 : 0, { timeout: 15_000 });
      // The whole page, top to bottom.
      const height = await page.evaluate(() => document.body.scrollHeight);
      for (let y = 0; y < height; y += 700) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(60); }
      await expect(page.locator('.wbd')).toBeVisible();
      expect(js.filter((u) => /WorkbenchLayer/.test(u)), `width ${width}`).toEqual([]);
      await ctx.close();
    }
  });

  test('dynamic chunks: desktop loads the Workbench layer only as it approaches', async ({ page }) => {
    const js: string[] = [];
    page.on('request', (r) => { if (r.url().endsWith('.js')) js.push(r.url()); });
    await page.goto('./?diag&hero=runs', { waitUntil: 'networkidle' });
    await expect(page.locator('canvas')).toHaveCount(1, { timeout: 15_000 });
    await page.waitForTimeout(800);
    expect(js.filter((u) => /WorkbenchLayer/.test(u))).toEqual([]);
    // The hero's canvas chunk carries no postprocessing or Workbench code.
    const canvasChunk = js.find((u) => /ExperienceCanvas/.test(u))!;
    const text = await (await page.request.get(canvasChunk)).text();
    expect(text).not.toMatch(/luminanceThreshold|mipmapBlur|Hidden tests/);
    await page.locator('#method .wb__stage').scrollIntoViewIfNeeded();
    await expect.poll(() => js.filter((u) => /WorkbenchLayer/.test(u)).length).toBe(1);
    await expect.poll(async () => (await diag<{ id: string; mounted: boolean }[]>(page, 'scenes')).find((s) => s.id === 'workbench')?.mounted).toBe(true);
    expect(await page.locator('canvas').count()).toBe(1);
    expect(await diag(page, 'contexts')).toBe(1);
  });

  test('the 3D story stage: large, drawn in the one canvas, correct under reversal and interruption', async ({ page }) => {
    await page.goto('./?diag', { waitUntil: 'networkidle' });
    await toStep(page, 0);
    await expect.poll(async () => (await diag<{ id: string; mounted: boolean }[]>(page, 'scenes')).find((s) => s.id === 'cohort')?.mounted, { timeout: 15_000 }).toBe(true);
    expect(await diag<number>(page, 'canvases')).toBe(1);
    const box = (await page.locator('.story__stage').boundingBox())!;
    expect((box.width * box.height) / (1440 * 900)).toBeGreaterThan(0.6);
    await expect(page.locator('.story__canvas .story__figure')).toHaveCount(0);
    // Fast through every step, then straight back: the labels and state follow the last position only.
    for (const i of [1, 2, 3, 4, 2]) await toStep(page, i);
    await expect.poll(() => storyStep(page)).toBe('2');
    await expect(page.locator('.story__label.is-on')).toHaveCount(6);
    await toStep(page, 0);
    await expect.poll(() => storyStep(page)).toBe('0');
    await expect(page.locator('.story__label--bug.is-on')).toHaveCount(1);
  });

  test('a failed story chunk leaves its 2D figure and the rest of the 3D running', async ({ page }) => {
    await page.route(/CohortScene/, (r) => r.abort());
    await page.goto('./?diag&hero=runs', { waitUntil: 'networkidle' });
    await toStep(page, 0);
    await expect(page.locator('.story__canvas .story__figure')).toHaveCount(1);
    await page.waitForTimeout(600);
    await expect(page.locator('.story__canvas .story__figure')).toHaveCount(1);
    expect(await diag<number>(page, 'contexts')).toBe(1);
  });

  test('reduced motion: the story reaches each state at once', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('./?diag', { waitUntil: 'networkidle' });
    await toStep(page, 4);
    await expect.poll(() => storyStep(page)).toBe('4');
    await expect(page.locator('.story__formula')).toContainText('924 runs');
    await settled(page);
    expect(await diag<boolean>(page, 'animating')).toBe(false);
    await ctx.close();
  });

  test('a failed Workbench chunk falls back to the 2D diagram and leaves the lattice running', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route(/WorkbenchLayer/, (r) => r.abort());
    await page.goto('./?diag&hero=runs', { waitUntil: 'networkidle' });
    await expect(page.locator('canvas')).toHaveCount(1, { timeout: 15_000 });
    await page.locator('#method').scrollIntoViewIfNeeded();
    await expect(page.locator('.wbd')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.wb__stage')).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator('.lattice__canvas-wrap')).toBeVisible();
    await expect(page.locator('.overview__svg')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('hover still lifts a bug: the picture changes under reduced motion, where nothing else moves', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('./?diag&hero=runs', { waitUntil: 'networkidle' });
    await expect(page.locator('.lattice__loading')).toHaveCount(0, { timeout: 10_000 });
    await settled(page);
    const wrap = page.locator('.lattice__canvas-wrap');
    const box = (await wrap.boundingBox())!;
    const clip = { x: box.x, y: box.y, width: box.width, height: box.height };
    const before = await page.screenshot({ clip });
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.68);
    await expect(page.locator('.lattice__pos')).not.toHaveText('Bug 51 of 77');
    await settled(page);
    expect((await page.screenshot({ clip })).equals(before)).toBe(false);
    await ctx.close();
  });

  test('the stepper changes the lattice without any instance upload', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __up: number };
      w.__up = 0;
      const P = WebGL2RenderingContext.prototype, o = P.bufferSubData;
      P.bufferSubData = function (this: WebGL2RenderingContext, ...a: unknown[]) { w.__up++; return (o as (...x: unknown[]) => void).apply(this, a); } as typeof o;
    });
    await page.goto('./?diag&hero=runs', { waitUntil: 'networkidle' });
    await page.locator('.seg-dark button', { hasText: 'Design' }).first().click();
    await settled(page);
    const before = await page.evaluate(() => (window as unknown as { __up: number }).__up);
    const framesBefore = await diag<number>(page, 'frames');
    for (let i = 0; i < 4; i++) await page.locator('.lattice').getByRole('button', { name: 'Next bug' }).click();
    await settled(page);
    expect(await diag<number>(page, 'frames')).toBeGreaterThan(framesBefore);
    expect(await page.evaluate(() => (window as unknown as { __up: number }).__up)).toBe(before);
  });

  for (const width of [768, 800, 1024, 1440]) {
    test(`lane labels stay inside the stage at ${width}px`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await ctx.newPage();
      await page.goto('./?diag&hero=runs', { waitUntil: 'networkidle' });
      await page.locator('.lattice__canvas-wrap').scrollIntoViewIfNeeded();
      await expect(page.locator('.lattice__loading')).toHaveCount(0, { timeout: 15_000 });
      await page.waitForTimeout(600);
      const out = await page.evaluate(() => {
        const s = document.querySelector('.lattice__canvas-wrap')!.getBoundingClientRect();
        return [...document.querySelectorAll('.lattice__lane b, .lattice__lane-name, .lattice__group')]
          .filter((e) => getComputedStyle(e).display !== 'none' && getComputedStyle(e.parentElement!).opacity !== '0' && e.getBoundingClientRect().width > 0)
          .map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent, over: Math.max(s.left - r.left, r.right - s.right) }; })
          .filter((x) => x.over > 1);
      });
      expect(out).toEqual([]);
      await ctx.close();
    });
  }

  for (const width of [1024, 1440, 1920]) {
    test(`the Workbench model stays inside its stage at ${width}px`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width, height: width === 1920 ? 1080 : 900 } });
      const page = await ctx.newPage();
      await page.goto('./?diag&hero=runs', { waitUntil: 'networkidle' });
      await page.locator('#method .wb__stage').scrollIntoViewIfNeeded();
      await expect.poll(async () => (await diag<{ stageWidth: number }>(page, 'workbenchBounds')).stageWidth, { timeout: 15_000 }).toBeGreaterThan(0);
      await settled(page);
      const b = await diag<{ left: number; right: number; top: number; bottom: number; stageWidth: number; stageHeight: number }>(page, 'workbenchBounds');
      expect(b.left).toBeGreaterThanOrEqual(0);
      expect(b.top).toBeGreaterThanOrEqual(0);
      expect(b.right).toBeLessThanOrEqual(b.stageWidth);
      expect(b.bottom).toBeLessThanOrEqual(b.stageHeight);
      await ctx.close();
    });
  }

  test('no horizontal overflow from the shared canvas at any review width', async ({ browser }) => {
    for (const width of [375, 390, 600, 768, 1024, 1440, 1920]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await ctx.newPage();
      await page.goto('./', { waitUntil: 'networkidle' });
      await expect(page.locator('.hero__finding')).toBeVisible();
      const { sw, w } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: document.documentElement.clientWidth }));
      expect(sw, `width ${width}`).toBeLessThanOrEqual(w);
      await ctx.close();
    }
  });

  test('reduced motion: the lattice draws a still frame and rendering stops at once', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('./?diag&hero=runs', { waitUntil: 'networkidle' });
    await expect(page.locator('canvas')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator('.lattice__loading')).toHaveCount(0, { timeout: 10_000 });
    await settled(page);
    expect(await framesDuring(page, 1000)).toBe(0);
    await page.mouse.move(600, 500);
    await page.mouse.move(800, 600);
    await page.waitForTimeout(300);
    expect(await framesDuring(page, 500)).toBe(0);
    await ctx.close();
  });

  test('reduced motion: no pinned sequences, still frame', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('./?hero=runs', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await expect(page.locator('.pin-spacer')).toHaveCount(0);
    const ui = await page.evaluate(() => (window as unknown as { __uplift: { ui: { get: () => { reducedMotion: boolean; paused: boolean } } } }).__uplift.ui.get());
    expect(ui.reducedMotion).toBe(true);
    expect(ui.paused).toBe(true);
    await ctx.close();
  });
});
