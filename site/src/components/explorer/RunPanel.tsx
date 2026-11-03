import type { Run } from '../../data/types';
import { usd } from '../../data/format';
import { DiffViewer } from './DiffViewer';

export function StatusBadge({ resolved }: { resolved: boolean }) {
  return resolved
    ? <span className="status status--ok"><span aria-hidden="true">✓</span> Resolved</span>
    : <span className="status status--fail"><span aria-hidden="true">✗</span> Failed</span>;
}

/** Hook output as the agent received it. Each message opens with "Uplift checks:". */
export function HookMessages({ hooks }: { hooks: string[] }) {
  if (!hooks.length) return <p className="hooks-empty">No hook spoke to the agent in this run.</p>;
  return (
    <div className="terminal" role="region" aria-label="Hook messages sent to the agent">
      <div className="terminal__bar"><span className="terminal__dots" aria-hidden="true"><i /><i /><i /></span><span className="label">hook → agent · {hooks.length} message{hooks.length === 1 ? '' : 's'}</span></div>
      {hooks.map((h, i) => (
        <pre key={i} className="terminal__msg">
          {h.split('\n').map((line, j) => {
            const kind = /^Uplift checks:/.test(line) ? 'head' : /^co-change:/.test(line) ? 'cochange' : /^ruff/.test(line) ? 'lint' : /^verify|test/i.test(line) ? 'verify' : 'text';
            return <span key={j} className={`tl tl--${kind}`}>{line}{'\n'}</span>;
          })}
        </pre>
      ))}
    </div>
  );
}

export function RunPanel({ run, armLabel, runIndex }: { run: Run; armLabel: string; runIndex: number }) {
  return (
    <article className="run" aria-label={`${armLabel}, run ${runIndex + 1}`}>
      <header className="run__head">
        <StatusBadge resolved={run.resolved} />
        <dl className="run__facts">
          <div><dt className="label">Setup</dt><dd>{armLabel}</dd></div>
          <div><dt className="label">Repeat</dt><dd className="mono">{run.seed}</dd></div>
          <div><dt className="label">Cost</dt><dd className="mono">{usd(run.cost_usd, 4)}</dd></div>
          <div><dt className="label">Hook messages</dt><dd className="mono">{run.hooks.length}</dd></div>
        </dl>
      </header>
      <p className="run__grade">Graded by sqlglot's own tests: the bug's FAIL_TO_PASS tests must pass and its PASS_TO_PASS tests must still pass.</p>
      <HookMessages hooks={run.hooks} />
      <DiffViewer diff={run.diff} label={`${armLabel}, run ${runIndex + 1}`} />
    </article>
  );
}
