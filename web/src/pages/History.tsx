import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, getApiErrorMessage } from '../api/client';
import type { PaymentRequest, PaymentsResponse } from '../api/types';
import { ArrowLeftIcon } from '../components/Icons';

function money(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `$${rounded.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export default function History() {
  const navigate = useNavigate();
  const [payments, setPayments] = useState<PaymentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPayments() {
      try {
        const { data } = await api.get<PaymentsResponse>('/payment/mine');
        if (cancelled) return;
        setPayments(data.payments ?? []);
      } catch (requestError) {
        if (!cancelled) setError(getApiErrorMessage(requestError, 'Could not load your history.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadPayments();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="history">
      <header className="history__top">
        <button type="button" className="history__back" onClick={() => navigate('/')}>
          <ArrowLeftIcon className="icon icon--sm" />
          <span>Lobby</span>
        </button>
        <h1 className="history__title">History</h1>
      </header>

      <main className="history__main">
        {error && <p className="error">{error}</p>}

        <section className="history-section">
          <h2>Deposits &amp; Withdrawals</h2>
          {payments.length === 0 ? (
            <p className="history-empty">{loading ? 'Loading…' : 'No deposit or withdrawal requests yet.'}</p>
          ) : (
            <ul className="history-list">
              {payments.map((payment) => (
                <li key={payment.id} className="history-row">
                  <span className={`history-badge history-badge--${payment.type}`}>{payment.type}</span>
                  <span className="history-amount">{money(payment.amount)}</span>
                  <span className="history-status">{payment.status}</span>
                  <span className="history-date">{formatDate(payment.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
