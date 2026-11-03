// The Uplift repository was not publicly reachable when this page was built (HTTP 404 on 2026-11-02).
// TODO(team): once https://github.com/EshanGoel07/uplift is public, set REPO_URL to it.
const REPO_URL: string | null = null;

const BASE = import.meta.env.BASE_URL;

export function Footer() {
  return (
    <footer className="footer">
      <div className="container footer__inner">
        <div className="footer__brand">
          <p className="nav__brand">UPLIFT<span className="nav__caret">_</span></p>
          <p className="footer__claim">Demonstrated on sqlglot; the method is repo-independent.</p>
          <p className="fine">Built for the Meta Global AI Developer Hackathon · Indie track · Push the Frontier. Only Meta models were called: Muse Code (agent under test) and Muse Spark (setups, tuning, failure labels). This page calls no models.</p>
        </div>
        <div className="footer__cols">
          <div>
            <p className="label">Data</p>
            <ul>
              <li><a href={`${BASE}data/results.json`} download>Raw results (results.json)</a></li>
              <li><a href={`${BASE}data/summary.json`}>Summary used by this page</a></li>
              {REPO_URL && <li><a href={REPO_URL} target="_blank" rel="noopener noreferrer">Source repository ↗</a></li>}
            </ul>
          </div>
          <div>
            <p className="label">Credits</p>
            <ul>
              <li><a href="https://github.com/tobymao/sqlglot" target="_blank" rel="noopener noreferrer">sqlglot</a>, MIT, © Toby Mao</li>
              <li><a href="https://huggingface.co/datasets/nebius/SWE-rebench" target="_blank" rel="noopener noreferrer">SWE-rebench</a> (Nebius), CC-BY-4.0, <a href="https://arxiv.org/abs/2505.20411" target="_blank" rel="noopener noreferrer">arXiv:2505.20411</a></li>
              <li>Full credits and licences in NOTICE.md in the Uplift repository</li>
            </ul>
          </div>
          <div>
            <p className="label">Team</p>
            <ul>
              <li>Aryan Kansal</li>
              <li>Eshan Goel</li>
            </ul>
          </div>
        </div>
      </div>
      <div className="container footer__base">
        <span className="mono">Uplift · Apache-2.0</span>
        <span className="mono">Static page · no trackers · no model calls</span>
      </div>
    </footer>
  );
}
