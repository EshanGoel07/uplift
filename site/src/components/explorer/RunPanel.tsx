import type { Run } from '../../data/types';
import { usd } from '../../data/format';
import { DiffViewer } from './DiffViewer';

export function StatusBadge({ resolved }: { resolved: boolean }) {
  return resolved
    ? <span className="status status--ok"><span aria-hidden="true">✓</span> Resolved</span>
    : <span className="status status--fail"><span aria-hidden="true">✗</span> Not resolved</span>;
}

/**
 * Hook output exactly as the agent received it, styled as a message (not code). Each message opens
 * with "Uplift checks:"; lines are tagged by the check that produced them.
 */
export function HookMessages({ hooks, hasHooks = true }: { hooks: string[]; hasHooks?: boolean }) {
  if (!hooks.length) {
    return <p className="hooks-empty">{hasHooks ? 'No hook message reached the agent in this run.' : 'This condition has no hooks.'}</p>;
  }
  return (
    <div className="hookmsg" role="region" aria-label="Hook messages sent to the agent">
      <p className="hookmsg__head">Message to the agent · {hooks.length} hook message{hooks.length === 1 ? '' : 's'}</p>
      {hooks.map((h, i) => (
        <pre key={i} className="hookmsg__body">
          {h.split('\n').map((line, j) => {
            const kind = /^Uplift checks:/.test(line) ? 'head' : /^co-change:/.test(line) ? 'cochange' : /^ruff/.test(line) ? 'lint' : /^verify\b/i.test(line) ? 'verify' : 'text';
            return <span key={j} className={`tl tl--${kind}`}>{line}{'\n'}</span>;
          })}
        </pre>
      ))}
    </div>
  );
}

interface PanelProps { run: Run; armLabel: string; runIndex: number; taskId?: string; hasHooks?: boolean; collapsible?: boolean }

/** One run: identity, outcome, cost, hook messages and the patch. */
export function RunPanel({ run, armLabel, runIndex, taskId, hasHooks = true, collapsible = false }: PanelProps) {
  const hooks = <HookMessages hooks={run.hooks} hasHooks={hasHooks} />;
  const patch = <DiffViewer diff={run.diff} label={`${armLabel}, repeat ${runIndex + 1}`} />;
  return (
    <article className="run" aria-label={`${armLabel}, repeat ${runIndex + 1}`}>
      <header className="run__head">
        <div className="run__id">
          {taskId && <span className="run__task">{taskId}</span>}
          <span className="run__name">{armLabel} · repeat {runIndex + 1}</span>
        </div>
        <StatusBadge resolved={run.resolved} />
      </header>
      <dl className="run__facts">
        <div><dt>Repeat label</dt><dd>{run.seed}</dd></div>
        <div><dt>Cost</dt><dd>{usd(run.cost_usd, 4)}</dd></div>
        <div><dt>Hook messages</dt><dd>{hasHooks ? run.hooks.length : 'none (no hooks)'}</dd></div>
      </dl>
      <p className="run__grade">Graded by sqlglot's own tests: the bug's FAIL_TO_PASS tests must pass and its PASS_TO_PASS tests must still pass. The per-run pytest output is not part of the published data.</p>
      {collapsible ? (
        <>
          <details className="run__acc"><summary>Hook messages ({hasHooks ? run.hooks.length : 'no hooks'})</summary>{hooks}</details>
          <details className="run__acc" open><summary>Agent patch</summary>{patch}</details>
        </>
      ) : <>{hooks}{patch}</>}
    </article>
  );
}
