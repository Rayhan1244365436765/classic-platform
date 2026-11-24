import { useState } from 'react';

import { PageShell } from '../components/PageShell';
import { useAuth } from '../context/auth-context';

/**
 * Referral link page.
 *
 * The link carries the player id (not the phone number) so a shared link does
 * not leak a phone number. The Register page and backend do not read `?ref=`
 * yet, so no referral reward is tracked until that is built.
 */
export default function Invite() {
  const { user } = useAuth();
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);

  const link = `${window.location.origin}/register${user ? `?ref=${encodeURIComponent(user.id)}` : ''}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
    window.setTimeout(() => setCopied(null), 2000);
  }

  return (
    <PageShell title="Invite Friends">
      <section className="pg__card">
        <h2 className="pg__h2">Your referral link</h2>
        <input className="pg__link" type="text" value={link} readOnly onFocus={(event) => event.target.select()} />
        <button type="button" className="button-primary button-block" onClick={() => void copyLink()}>
          {copied === 'ok' ? 'Copied ✓' : 'Copy link'}
        </button>
        {copied === 'fail' && <p className="error">Could not copy — select the link and copy it manually.</p>}
      </section>

      <section className="pg__card">
        <h2 className="pg__h2">How it works</h2>
        <ol className="pg__steps">
          <li>Share your link with friends.</li>
          <li>They sign up through it and start playing.</li>
          <li>Referral rewards will be credited to you once the program launches.</li>
        </ol>
        <p className="pg__note">Referral rewards are not active yet — invitations are not tracked for now.</p>
      </section>
    </PageShell>
  );
}
