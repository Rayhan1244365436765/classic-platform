import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { api, getApiErrorMessage } from '../api/client';
import type { LoginResponse } from '../api/types';
import { useAuth } from '../context/auth-context';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Set by <Register /> after a successful sign-up.
  const justRegistered =
    (location.state as { registered?: boolean } | null)?.registered === true;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const { data } = await api.post<LoginResponse>('/auth/login', {
        phone: phone.trim(),
        password,
      });

      login(data.token, data.user);
      navigate('/', { replace: true });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Invalid phone number or password.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="shell">
      <section className="card">
        <h1>Sign in</h1>
        <p className="subtitle">Casino Platform</p>

        <form onSubmit={handleSubmit}>
          <label className="field">
            <span>Phone</span>
            <input
              type="tel"
              name="phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+8801700000000"
              autoComplete="tel"
              minLength={10}
              required
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              name="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              minLength={6}
              required
            />
          </label>

          <button type="submit" className="button-primary button-block" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>

          {error && <p className="error">{error}</p>}
          {!error && justRegistered && <p className="notice">Account created — please sign in.</p>}
        </form>

        <p className="hint">
          No account yet? <Link to="/register">Create one</Link>
        </p>
      </section>
    </main>
  );
}
