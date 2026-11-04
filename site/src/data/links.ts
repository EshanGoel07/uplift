// External links shown across the page. One place to change them; every path below is a file tracked
// in the public repository's main branch (checked with git ls-files).

/** The public Uplift repository (Apache-2.0). */
export const REPO_URL = 'https://github.com/EshanGoel07/uplift';

const blob = (path: string): string => `${REPO_URL}/blob/main/${path}`;

/** Third-party credits and licences (SWE-rebench CC-BY-4.0, sqlglot MIT). */
export const NOTICE_URL = blob('NOTICE.md');

/** Study documents and the source files the method description points to. */
export const DOC_LINKS = {
  readme: blob('README.md'),
  phaseLog: blob('PHASE_LOG.md'),
  report: blob('reports/main.md'),
  license: blob('LICENSE'),
  genericAgents: blob('arms/handwritten/AGENTS.md'),
} as const;

export const SOURCE_LINKS = {
  split: blob('src/uplift/split.py'),
  mine: blob('src/uplift/mine.py'),
  runner: blob('src/uplift/runner.py'),
  screen: blob('src/uplift/screen.py'),
  generate: blob('src/uplift/generate.py'),
  tune: blob('src/uplift/tune.py'),
  workspace: blob('src/uplift/workspace.py'),
  grade: blob('src/uplift/grade.py'),
  analysis: blob('src/uplift/analysis.py'),
  webaudit: blob('src/uplift/webaudit.py'),
  budgetProxy: blob('tools/budget_guard/budget_proxy.py'),
} as const;

// TODO(team): set this to the demo video URL once it is published. While it is null, the page
// shows a "coming soon" note (never an empty or "#" link).
export const DEMO_VIDEO_URL: string | null = null;
