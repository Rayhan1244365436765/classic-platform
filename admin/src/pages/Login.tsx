import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { ADMIN_TOKEN_KEY, ADMIN_USER_KEY, api, getApiErrorMessage } from '../api/client';
import type { LoginResponse } from '../api/types';

export default function Login() {
  const navigate = useNavigate();

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const { data } = await api.post<LoginResponse>('/auth/login', {
        phone: phone.trim(),
        password,
      });

      if (data.user?.role !== 'admin') {
        // Never keep a player token in the admin app.
        setError('This account does not have administrator access.');
        return;
      }

      localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(data.user));
      navigate('/', { replace: true });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Invalid phone number or password.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth">
      <section className="card auth__card">
        <h1>Admin sign in</h1>
        <p className="muted">Casino Platform · operators only</p>

        <form onSubmit={handleSubmit}>
          <label className="field">
            <span>Phone</span>
            <input
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+8801700000000"
              autoComplete="username"
              minLength={10}
              required
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              minLength={6}
              required
            />
          </label>

          <button type="submit" className="button button--primary button--block" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>

          {error && <p className="error">{error}</p>}
        </form>

        <p className="hint">
          An admin account is a normal user whose <code>role</code> is <code>admin</code>.
        </p>
      </section>
    </main>
  );
}
