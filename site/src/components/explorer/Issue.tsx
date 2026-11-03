import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// marked + DOMPurify load with the explorer, not with the first paint.
let mdModule: Promise<typeof import('../../utils/markdown')> | null = null;
const loadMarkdown = () => (mdModule ??= import('../../utils/markdown'));

/** The GitHub issue text the agent saw, sanitised (no images, scripts or handlers), collapsible. */
export function Issue({ text, title = 'GitHub issue · what the agent saw' }: { text: string; title?: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadMarkdown().then((m) => { if (live) setHtml(m.renderIssueMarkdown(text)); });
    return () => { live = false; };
  }, [text]);
  const body = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const el = body.current;
    if (el) setLong(el.scrollHeight > el.clientHeight + 4);
  }, [html]);
  return (
    <div className="ex-issue">
      <p className="ex-issue__bar">{title}</p>
      {html === null
        ? <pre className="md md--plain is-collapsed">{text}</pre>
        : <div ref={body} className={`md${open ? '' : ' is-collapsed'}${long && !open ? ' has-more' : ''}`}
               // Sanitised by DOMPurify in renderIssueMarkdown: no images, scripts, handlers or unsafe links.
               dangerouslySetInnerHTML={{ __html: html }} />}
      {(long || open) && (
        <button type="button" className="ex-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Collapse the issue' : 'Show the full issue'}
        </button>
      )}
    </div>
  );
}
