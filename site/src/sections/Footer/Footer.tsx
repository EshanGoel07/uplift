import { DEMO_VIDEO_URL, DOC_LINKS, NOTICE_URL, REPO_URL } from '../../data/links';

const BASE = import.meta.env.BASE_URL;
const ext = { target: '_blank', rel: 'noopener noreferrer' } as const;

export function Footer() {
  return (
    <footer className="footer">
      <div className="pub-container footer__inner">
        <div className="footer__brand">
          <p className="footer__name">Uplift</p>
          <p className="footer__claim">A measured study of coding-agent setups. Demonstrated on sqlglot; the method is repo-independent.</p>
          <p className="footer__fine">Built by Eshan Goel (pipeline, grading, experiments, analysis) and Aryan Kansal (results website) for the Meta Global AI Developer Hackathon, Oct 27 – Nov 4, 2026. Only Meta models were called: Muse Code and Muse Spark. This page calls no models.</p>
        </div>
        <nav className="footer__cols" aria-label="Footer">
          <div>
            <p className="footer__k">Study</p>
            <ul>
              <li><a href={`${BASE}data/results.json`} download>Raw results (results.json)</a></li>
              <li><a href={`${BASE}data/summary.json`}>Summary used by this page</a></li>
              <li><a href={DOC_LINKS.report} {...ext}>Full report (reports/main.md)</a></li>
              <li><a href={DOC_LINKS.phaseLog} {...ext}>Engineering log (PHASE_LOG.md)</a></li>
              <li><a href={DOC_LINKS.readme} {...ext}>README</a></li>
            </ul>
          </div>
          <div>
            <p className="footer__k">Code</p>
            <ul>
              <li><a href={REPO_URL} {...ext}>Source repository ↗</a></li>
              <li><a href={NOTICE_URL} {...ext}>NOTICE.md (credits and licences) ↗</a></li>
              <li><a href={DOC_LINKS.license} {...ext}>Apache-2.0 licence ↗</a></li>
              <li className="footer__demo">{DEMO_VIDEO_URL ? <a href={DEMO_VIDEO_URL} {...ext}>Demo video ↗</a> : <span>Demo video: coming soon</span>}</li>
            </ul>
          </div>
          <div>
            <p className="footer__k">Data credits</p>
            <ul>
              <li><a href="https://github.com/tobymao/sqlglot" {...ext}>sqlglot</a>, MIT, © Toby Mao</li>
              <li><a href="https://huggingface.co/datasets/nebius/SWE-rebench" {...ext}>SWE-rebench</a> (Nebius), CC-BY-4.0, <a href="https://arxiv.org/abs/2505.20411" {...ext}>arXiv:2505.20411</a></li>
            </ul>
          </div>
        </nav>
      </div>
      <div className="pub-container footer__base">
        <span>Uplift · Apache-2.0</span>
        <span>Static page · no trackers · no model calls</span>
      </div>
    </footer>
  );
}
