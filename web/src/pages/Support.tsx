import { PageShell } from '../components/PageShell';

/**
 * Support contacts. Fill these in to enable the buttons:
 *   WHATSAPP_NUMBER   — digits only with country code, e.g. '8801700000000'
 *   TELEGRAM_USERNAME — without the @, e.g. 'rb1920_support'
 * While empty, the buttons render as disabled instead of dead links.
 */
const WHATSAPP_NUMBER = '';
const TELEGRAM_USERNAME = '';

const FAQ: { q: string; a: string }[] = [
  {
    q: 'How do I deposit?',
    a: 'Open the Lobby, tap Deposit, enter an amount and send the request. An operator reviews it and credits your balance once approved.',
  },
  {
    q: 'How do I withdraw?',
    a: 'Tap Withdraw in the Cashier. The amount is held from your balance right away and refunded automatically if the request is rejected.',
  },
  {
    q: 'Are the games fair?',
    a: 'Every round is provably fair: the server commits to a hash of its seed before you play, so results cannot be changed afterwards.',
  },
  {
    q: 'I forgot my password.',
    a: 'Contact customer service on WhatsApp or Telegram with your registered phone number.',
  },
];

export default function Support() {
  const whatsappUrl = WHATSAPP_NUMBER ? `https://wa.me/${WHATSAPP_NUMBER}` : null;
  const telegramUrl = TELEGRAM_USERNAME ? `https://t.me/${TELEGRAM_USERNAME}` : null;

  return (
    <PageShell title="Customer Service">
      <section className="pg__contacts" aria-label="Contact us">
        {whatsappUrl ? (
          <a className="pg__contact pg__contact--wa" href={whatsappUrl} target="_blank" rel="noopener noreferrer">
            <span aria-hidden="true">💬</span>
            <strong>WhatsApp</strong>
            <small>Chat with support</small>
          </a>
        ) : (
          <span className="pg__contact pg__contact--wa pg__contact--off" aria-disabled="true">
            <span aria-hidden="true">💬</span>
            <strong>WhatsApp</strong>
            <small>Not configured yet</small>
          </span>
        )}

        {telegramUrl ? (
          <a className="pg__contact pg__contact--tg" href={telegramUrl} target="_blank" rel="noopener noreferrer">
            <span aria-hidden="true">✈️</span>
            <strong>Telegram</strong>
            <small>Chat with support</small>
          </a>
        ) : (
          <span className="pg__contact pg__contact--tg pg__contact--off" aria-disabled="true">
            <span aria-hidden="true">✈️</span>
            <strong>Telegram</strong>
            <small>Not configured yet</small>
          </span>
        )}
      </section>

      <section className="pg__card" aria-label="FAQ">
        <h2 className="pg__h2">FAQ</h2>
        {FAQ.map((item) => (
          <details key={item.q} className="pg__faq">
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </section>
    </PageShell>
  );
}
