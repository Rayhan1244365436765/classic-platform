import axios from 'axios';
import { useState, type FormEvent } from 'react';

import { api, getApiErrorMessage } from '../api/client';
import { PageShell } from '../components/PageShell';
import { useAuth } from '../context/auth-context';

const MIN_PASSWORD_LENGTH = 6;

/**
 * Change-password form.
 *
 * Expects `POST /auth/change-password { currentPassword, newPassword }`.
 * The backend does not have this endpoint yet, so a 404 is reported as
 * "not available" instead of a generic failure.
 */
export default function Security() {
  const { user } = useAuth();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setDone(false);

    if (next.length < MIN_PASSWORD_LENGTH) {
      setError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (next !== confirm) {
      setError('New password and confirmation do not match.');
      return;
    }
    if (next === current) {
      setError('New password must be different from the current one.');
      return;
    }

    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 404) {
        setError('Changing the password is not available on the server yet.');
      } else {
        setError(getApiErrorMessage(requestError, 'Could not change your password.'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell title="Security Center">
      <form className="pg__card" onSubmit={handleSubmit}>
        <label className="field">
          <span>Phone number</span>
          <input type="tel" value={user?.phone ?? ''} readOnly disabled />
        </label>

        <label className="field">
          <span>Current password</span>
          <input
            type="password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        <label className="field">
          <span>New password</span>
          <input
            type="password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </label>

        <label className="field">
          <span>Confirm new password</span>
          <input
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </label>

        <button type="submit" className="button-primary button-block" disabled={busy}>
          {busy ? 'Saving…' : 'Change password'}
        </button>

        {error && <p className="error">{error}</p>}
        {done && <p className="notice">Password changed.</p>}
      </form>
    </PageShell>
  );
}
