import { PageShell } from '../components/PageShell';
import { useAuth } from '../context/auth-context';

/** Read-only account details. The API exposes only id, phone and role. */
export default function Account() {
  const { user } = useAuth();

  const rows: { label: string; value: string }[] = [
    { label: 'Phone number', value: user?.phone ?? '—' },
    { label: 'Account type', value: user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : '—' },
    { label: 'Player ID', value: user?.id ?? '—' },
  ];

  return (
    <PageShell title="My Account">
      <section className="pg__card">
        <dl className="pg__list">
          {rows.map((row) => (
            <div key={row.label} className="pg__row">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        <p className="pg__note">Join date is not available yet — the server does not return it.</p>
      </section>
    </PageShell>
  );
}
