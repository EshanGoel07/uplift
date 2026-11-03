import type { Arm, ArmId, Task } from '../../data/types';
import { APPROACH_INFO, type Approach } from '../../data/reportFigures';
import { CONDITIONS } from '../../data/method';

export interface RunPick { arm: ArmId; run: number }

interface Props {
  task: Task;
  arms: Arm[];
  /** Selected runs (A, and B in compare mode). Nothing is selected by default. */
  a: RunPick | null;
  b?: RunPick | null;
  onSelect: (p: RunPick) => void;
  /** Worked example only: each run's approach. */
  approaches?: Record<ArmId, [Approach, Approach]>;
  /** Phones: each condition becomes an accordion. */
  accordion?: boolean;
}

const same = (p: RunPick | null | undefined, arm: ArmId, run: number) => !!p && p.arm === arm && p.run === run;

/** Six equal condition groups, two runs each. Every run is a button; outcomes are words, not colour alone. */
export function RunBoard({ task, arms, a, b, onSelect, approaches, accordion }: Props) {
  return (
    <div className={`rboard${accordion ? ' rboard--acc' : ''}`} role="group" aria-label="Six conditions, two repeats each">
      {arms.map((arm) => {
        const runs = task.results[arm.id].runs;
        const solved = runs.filter((r) => r.resolved).length;
        const head = (
          <>
            <span className="rboard__name">{arm.label}</span>
            <span className="rboard__score" aria-label={`${solved} of ${runs.length} solved`}>{solved}/{runs.length}</span>
          </>
        );
        const body = (
          <div className="rboard__runs">
            {runs.map((r, i) => {
              const isA = same(a, arm.id, i), isB = same(b, arm.id, i);
              const ap = approaches?.[arm.id][i];
              return (
                <button key={i} type="button" className={`run-pill ${r.resolved ? 'is-ok' : 'is-fail'}${isA ? ' is-a' : ''}${isB ? ' is-b' : ''}`}
                  aria-pressed={isA || isB}
                  aria-label={`${arm.label}, repeat ${i + 1}: ${r.resolved ? 'solved' : 'not resolved'}${ap ? `, ${APPROACH_INFO[ap].name} approach` : ''}${r.hooks.length ? `, ${r.hooks.length} hook message${r.hooks.length > 1 ? 's' : ''}` : ''}`}
                  onClick={() => onSelect({ arm: arm.id, run: i })}>
                  <span className="run-pill__rep">Repeat {i + 1}</span>
                  <span className="run-pill__status">{r.resolved ? '✓ Solved' : '✗ Not resolved'}</span>
                  {ap && <span className={`run-pill__ap ap-${ap}`}>{APPROACH_INFO[ap].name}</span>}
                  {CONDITIONS[arm.id].hasHooks && r.hooks.length > 0 && <span className="run-pill__hook" title="A hook message reached the agent">hook message</span>}
                  {(isA || isB) && b !== undefined && <span className="run-pill__tag" aria-hidden="true">{isA ? 'A' : 'B'}</span>}
                </button>
              );
            })}
          </div>
        );
        return accordion ? (
          <details key={arm.id} className="rboard__group ex-arm">
            <summary className="rboard__head">{head}</summary>
            {body}
          </details>
        ) : (
          <div key={arm.id} className="rboard__group ex-arm">
            <p className="rboard__head">{head}</p>
            {body}
          </div>
        );
      })}
    </div>
  );
}
