import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { api, getApiErrorMessage } from '../api/client';
import type { RegisterResponse } from '../api/types';

export default function Register() {
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
      await api.post<RegisterResponse>('/auth/register', {
        phone: phone.trim(),
        password,
      });

      // Registration returns the user but no token: sign in explicitly next.
      navigate('/login', { replace: true, state: { registered: true } });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not create your account.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="shell">
      <section className="card">
        <h1>Create account</h1>
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
              autoComplete="new-password"
              minLength={6}
              required
            />
          </label>

          <button type="submit" className="button-primary button-block" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create account'}
          </button>

          {error && <p className="error">{error}</p>}
        </form>

        <p className="hint">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
