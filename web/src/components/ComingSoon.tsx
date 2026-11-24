import { PageShell } from './PageShell';

type ComingSoonProps = {
  title: string;
  icon: string;
  description: string;
};

/** Centered "Coming Soon" screen for Member Center features without a backend yet. */
export function ComingSoon({ title, icon, description }: ComingSoonProps) {
  return (
    <PageShell title={title}>
      <div className="pg__soon">
        <span className="pg__soon-icon" aria-hidden="true">
          {icon}
        </span>
        <h2>Coming Soon</h2>
        <p>{description}</p>
      </div>
    </PageShell>
  );
}
