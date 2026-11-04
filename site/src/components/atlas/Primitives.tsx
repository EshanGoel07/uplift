import type { ReactNode } from 'react';
import type { ArmId } from '../../data/types';
import { condStyle } from '../../utils/condition';
import { Icon } from './Icon';

/** The label for evidence the study holds but did not publish, or never recorded. */
export const NOT_PUBLISHED = 'NOT INCLUDED IN PUBLISHED EXPORT';

export function Unavailable({ children = NOT_PUBLISHED }: { children?: ReactNode }) {
  return <span className="unavail">{children}</span>;
}

/** A solved or failed run: colour plus a glyph, never colour alone. */
export function OutcomeMarker({ solved, label }: { solved: boolean; label?: string }) {
  return (
    <span className={`outcome ${solved ? 'outcome--ok' : 'outcome--fail'}`}>
      <span aria-hidden="true">{solved ? '✓' : '✗'}</span>
      <span className={label ? undefined : 'visually-hidden'}>{label ?? (solved ? 'Solved' : 'Failed')}</span>
    </span>
  );
}

/** A condition's name with its spectral identity mark. */
export function ConditionTag({ id, label }: { id: ArmId; label: string }) {
  return <span className="cond-tag" style={condStyle(id)}><i aria-hidden="true" />{label}</span>;
}

/** Monospace technical label, the site's small heading. */
export function Kicker({ children, as: As = 'p' }: { children: ReactNode; as?: 'p' | 'h3' | 'h4' }) {
  return <As className="kicker">{children}</As>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty" role="status">
      <Icon name="info" />
      <p className="empty__title">{title}</p>
      {children && <p className="empty__body">{children}</p>}
    </div>
  );
}

/** A quiet pill button for panels and toolbars. */
export function ToolButton({ icon, children, onClick, pressed, title, disabled, 'aria-label': ariaLabel }: {
  icon?: string; children?: ReactNode; onClick?: () => void; pressed?: boolean; title?: string; disabled?: boolean; 'aria-label'?: string;
}) {
  return (
    <button type="button" className={`tool${children ? '' : ' tool--icon'}`} onClick={onClick} aria-pressed={pressed} title={title} disabled={disabled} aria-label={ariaLabel}>
      {icon && <Icon name={icon} />}{children}
    </button>
  );
}
