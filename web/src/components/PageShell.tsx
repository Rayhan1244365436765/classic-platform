import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { ArrowLeftIcon } from './Icons';

type PageShellProps = {
  title: string;
  children: ReactNode;
  /** Where the back button goes (default: the Member Center). */
  backTo?: string;
  backLabel?: string;
};

/** Shared frame of the Member Center sub-pages: back button, title, content. */
export function PageShell({
  title,
  children,
  backTo = '/profile',
  backLabel = 'Back to Member Center',
}: PageShellProps) {
  return (
    <div className="pg">
      <header className="pg__top">
        <Link to={backTo} className="pg__back" aria-label={backLabel}>
          <ArrowLeftIcon className="icon icon--sm" />
          <span>Back</span>
        </Link>
        <h1 className="pg__title">{title}</h1>
      </header>
      <main className="pg__main">{children}</main>
    </div>
  );
}
