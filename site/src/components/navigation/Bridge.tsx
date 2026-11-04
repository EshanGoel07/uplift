import { jumpTo } from './Nav';

/** The one-line hand-off at the end of a section, to the next step of the story. */
export function Bridge({ to, children }: { to: string; children: string }) {
  return (
    <p className="bridge">
      <a href={`#${to}`} onClick={(e) => { e.preventDefault(); jumpTo(to); }}>{children}</a>
    </p>
  );
}
