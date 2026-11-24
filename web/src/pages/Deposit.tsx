import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { api, getApiErrorMessage } from '../api/client';
import type { PaymentResponse } from '../api/types';
import { PageShell } from '../components/PageShell';

type Method = 'bkash' | 'nagad';

/** Operator accounts players send money to. */
const ACCOUNTS: { method: Method; name: string; number: string; kind: string }[] = [
  { method: 'bkash', name: 'bKash', number: '01972227996', kind: 'Personal' },
  { method: 'nagad', name: 'Nagad', number: '01972227996', kind: 'Personal' },
];

// Mirrors the server rules in backend/src/modules/payment/payment.schema.ts.
const BD_MOBILE = /^01[3-9]\d{8}$/;
const TRX_ID = /^[A-Z0-9]{6,20}$/;

/** "+880 1972-227996" → "01972227996". */
function cleanPhone(value: string): string {
  return value.replace(/[\s-]/g, '').replace(/^\+?88(?=01)/, '');
}

export default function Deposit() {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<Method>('bkash');
  const [sender, setSender] = useState('');
  const [trxId, setTrxId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [copied, setCopied] = useState<Method | 'fail' | null>(null);

  const methodName = method === 'bkash' ? 'bKash' : 'Nagad';

  async function copyNumber(account: (typeof ACCOUNTS)[number]) {
    try {
      await navigator.clipboard.writeText(account.number);
      setCopied(account.method);
    } catch {
      setCopied('fail');
    }
    window.setTimeout(() => setCopied(null), 2000);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const value = Number(amount);
    const senderNumber = cleanPhone(sender);
    const trx = trxId.trim().toUpperCase();

    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter an amount greater than 0.');
      return;
    }
    if (!BD_MOBILE.test(senderNumber)) {
      setError('Enter the bKash/Nagad number you paid from (e.g. 01712345678).');
      return;
    }
    if (!TRX_ID.test(trx)) {
      setError('Transaction ID must be 6–20 letters or digits.');
      return;
    }

    setBusy(true);
    try {
      await api.post<PaymentResponse>('/payment/deposit', {
        amount: value,
        paymentMethod: method,
        senderNumber,
        trxId: trx,
      });
      setSubmitted(true);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not submit your deposit.'));
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <PageShell title="Deposit" backTo="/" backLabel="Back to Lobby">
        <section className="pg__card dep__done">
          <span className="dep__done-icon" aria-hidden="true">
            ✓
          </span>
          <h2>Request submitted</h2>
          <p>
            We will verify your {methodName} payment and credit your balance as soon as an operator
            approves it.
          </p>
          <Link to="/" className="button-primary button-block dep__done-btn">
            Back to Lobby
          </Link>
          <Link to="/history" className="dep__link">
            View request status
          </Link>
        </section>
      </PageShell>
    );
  }

  return (
    <PageShell title="Deposit" backTo="/" backLabel="Back to Lobby">
      <section className="pg__card dep__step">
        <h2 className="dep__step-title">
          <span className="dep__num">1</span> Send money to
        </h2>

        <div className="dep__accounts">
          {ACCOUNTS.map((account) => (
            <div
              key={account.method}
              className={`dep__account dep__account--${account.method}${
                method === account.method ? ' dep__account--active' : ''
              }`}
            >
              <div className="dep__account-info">
                <strong>{account.name}</strong>
                <span className="dep__kind">{account.kind}</span>
                <span className="dep__number">{account.number}</span>
              </div>
              <button type="button" className="dep__copy" onClick={() => void copyNumber(account)}>
                {copied === account.method ? 'Copied ✓' : 'Copy'}
              </button>
            </div>
          ))}
        </div>
        {copied === 'fail' && (
          <p className="error">Could not copy — select the number and copy it manually.</p>
        )}
      </section>

      <section className="pg__card dep__step">
        <h2 className="dep__step-title">
          <span className="dep__num">2</span> Instructions
        </h2>
        <p className="dep__text">
          Send your desired amount to the number above. Then fill out the form below.
        </p>
      </section>

      <form className="pg__card dep__step" onSubmit={handleSubmit}>
        <h2 className="dep__step-title">
          <span className="dep__num">3</span> Payment details
        </h2>

        <label className="field">
          <span>Amount (৳)</span>
          <input
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            min={0.01}
            step="any"
            placeholder="e.g. 50"
            required
          />
        </label>

        <label className="field">
          <span>Payment method</span>
          <select value={method} onChange={(event) => setMethod(event.target.value as Method)}>
            <option value="bkash">bKash</option>
            <option value="nagad">Nagad</option>
          </select>
        </label>

        <label className="field">
          <span>Sender number (your {methodName} number)</span>
          <input
            type="tel"
            inputMode="tel"
            value={sender}
            onChange={(event) => setSender(event.target.value)}
            placeholder="01XXXXXXXXX"
            autoComplete="tel"
            required
          />
        </label>

        <label className="field">
          <span>Transaction ID (TrxID)</span>
          <input
            type="text"
            value={trxId}
            onChange={(event) => setTrxId(event.target.value)}
            placeholder="e.g. 8N7A6D5E4C"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            required
          />
        </label>

        <button type="submit" className="button-primary button-block dep__submit" disabled={busy}>
          {busy ? 'Submitting…' : 'Submit deposit'}
        </button>

        {error && <p className="error">{error}</p>}
        <p className="pg__note">
          Your balance is credited after an operator verifies the TrxID. Each TrxID can only be
          used once.
        </p>
      </form>
    </PageShell>
  );
}

