import type { ReactNode } from 'react';

interface Props {
  index: string;
  eyebrow: string;
  id: string;
  title: ReactNode;
  lead?: ReactNode;
}

/** Numbered editorial section header: index · eyebrow, large title, lead paragraph. */
export function SectionHead({ index, eyebrow, id, title, lead }: Props) {
  return (
    <header className="section-head">
      <p className="section-head__eyebrow label">
        <span className="section-head__index">{index}</span>
        <span className="section-head__rule" aria-hidden="true" />
        {eyebrow}
      </p>
      <h2 id={id} className="section-head__title">{title}</h2>
      {lead && <p className="section-head__lead">{lead}</p>}
    </header>
  );
}
