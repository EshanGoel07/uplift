import { SectionHead } from '../../components/interface/SectionHead';

const FUTURE: [string, string][] = [
  ['Repos with little history', 'Most repos lack hundreds of past fixes. Borrow tasks and guidance from similar same-stack projects.'],
  ['Synthetic bugs', 'Inject realistic bugs where history is thin, and grade them with the same fail-closed tests.'],
  ['Live measurement', 'Measure setups on real coding-agent pull requests as they happen, not only on replayed bugs.'],
  ['Adapters for other agents', 'Run the same arms through other coding agents, such as Claude Code and Codex.'],
  ['More repositories', 'Repeat the study across many repos to see whether any setup effect generalises, and with more power to detect small effects.'],
];

export function FutureWork() {
  return (
    <section id="future" className="section future-section" aria-labelledby="future-title">
      <div className="container">
        <SectionHead index="08" eyebrow="Future work · not built yet" id="future-title" title="Where this goes next."
          lead="Ideas, not results. Nothing in this section has been built or measured." />
        <ul className="future">
          {FUTURE.map(([t, d]) => (
            <li key={t} className="future__item">
              <span className="future__tag label">Planned</span>
              <h3>{t}</h3>
              <p>{d}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
