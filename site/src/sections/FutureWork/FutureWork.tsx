// README.md "## Future work". Nothing here is built or measured.
const FUTURE: [string, string][] = [
  ['Repos with little history: borrow tasks', 'Most repositories lack hundreds of past fixes. Borrow tasks from similar projects on the same stack.'],
  ['Repos with little history: synthetic bugs', 'Generate synthetic bugs where history is thin, and grade them with the same fail-closed tests.'],
  ['Live measurement', "Measure setups on the agent's real pull requests as they happen, not only on replayed bugs."],
  ['Other agents', 'Adapters for other coding agents, so the same exam compares agents as well as setups.'],
  ['Muse Spark Open', 'Run the same study with Muse Spark Open, to test whether setups help a smaller or self-hosted model more than a strong one.'],
];

export function FutureWork() {
  return (
    <section id="future" className="pub about" aria-labelledby="future-title">
      <div className="pub-container">
        <header className="pub-head">
          <p className="pub-eyebrow">Future work</p>
          <h2 id="future-title" className="pub-title">Where this goes next.</h2>
          <p className="pub-lead">Plans, not results. Nothing in this section has been built or measured.</p>
        </header>
        <ul className="future">
          {FUTURE.map(([t, d]) => (
            <li key={t} className="future__item">
              <span className="future__tag">Planned, not built</span>
              <h3>{t}</h3>
              <p>{d}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
