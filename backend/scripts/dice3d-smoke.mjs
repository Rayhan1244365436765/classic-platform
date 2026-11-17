/**
 * 3D Dice — live smoke test against a running backend.
 *
 *   node backend/scripts/dice3d-smoke.mjs [rolls]
 *
 * Every response is re-scored here from the three dice with an independent
 * implementation of the rules (including "a triple loses high/low"), so a bug in
 * the service cannot hide behind its own maths.
 */
const BASE = 'http://localhost:3000/api';
const ROLLS = Number(process.argv[2] ?? 180);

const SUM_PAYS = {
  3: 210, 4: 70, 5: 35, 6: 21, 7: 14, 8: 10, 9: 8.4,
  10: 7.8, 11: 7.8, 12: 8.4, 13: 10, 14: 14, 15: 21, 16: 35, 17: 70, 18: 210,
};

let failures = 0;
function check(label, condition, detail) {
  if (condition) console.log(`  PASS  ${label}`);
  else {
    console.log(`  FAIL  ${label} -> ${detail}`);
    failures += 1;
  }
}

async function request(method, path, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  return { status: response.status, data };
}

const round2 = (value) => Math.round(value * 100) / 100;

/** Independent scorer for one roll. */
function score(dice, bet) {
  const sum = dice[0] + dice[1] + dice[2];
  const triple = dice[0] === dice[1] && dice[1] === dice[2];

  if (bet === 'high' || bet === 'low') {
    const inRange = bet === 'high' ? sum >= 11 : sum <= 10;
    const won = inRange && !triple;

    return { sum, triple, won, multiplier: won ? 2 : 0, tripleVoided: triple && inRange };
  }

  const won = sum === bet;

  return { sum, triple, won, multiplier: won ? SUM_PAYS[bet] : 0, tripleVoided: false };
}

async function main() {
  const phone = `9${Math.floor(100000000 + Math.random() * 899999999)}`;
  const creds = { phone, password: 'Dice3D1!' };

  console.log('== register / login / deposit ==');
  await request('POST', '/auth/register', creds);
  const login = await request('POST', '/auth/login', creds);
  const token = login.data?.token;
  if (!token) throw new Error(`login failed: ${JSON.stringify(login.data)}`);
  console.log(`user=${login.data.user.id}`);
  await request('POST', '/wallet/deposit', { amount: 500 }, token);

  console.log('\n== config ==');
  const cfg = (await request('GET', '/game/dice3d/config', undefined, token)).data;
  console.log(
    `dice=${cfg.dice} faces=${cfg.faces} outcomes=${cfg.outcomes} triplesLoseHighLow=${cfg.triplesLoseHighLow}`,
  );
  console.log(`high ${cfg.high.from}-${cfg.high.to} pays ${cfg.high.pay}x, chance ${cfg.high.chance}`);
  console.log(
    `totals: ${cfg.sums.map((s) => `${s.sum}:${s.pay}x`).join(' ')}`,
  );

  check('three dice', cfg.dice === 3, cfg.dice);
  check('six faces', cfg.faces === 6, cfg.faces);
  check('216 outcomes', cfg.outcomes === 216, cfg.outcomes);
  check('triple rule published', cfg.triplesLoseHighLow === true, cfg.triplesLoseHighLow);
  check('high pays 2x', cfg.high.pay === 2 && cfg.low.pay === 2, cfg.high.pay);
  check('high/low chance is 105/216', Math.abs(cfg.high.chance - 105 / 216) < 1e-12, cfg.high.chance);
  check('high RTP is 35/36', Math.abs(cfg.high.rtp - 35 / 36) < 1e-12, cfg.high.rtp);
  check('16 totals', cfg.sums.length === 16, cfg.sums.length);
  for (const entry of cfg.sums) {
    if (entry.pay !== SUM_PAYS[entry.sum]) {
      check(`total ${entry.sum} pays ${SUM_PAYS[entry.sum]}x`, false, entry.pay);
    }
    if (!(entry.rtp > 0.96 && entry.rtp < 0.98)) {
      check(`total ${entry.sum} RTP in range`, false, entry.rtp);
    }
  }

/** Rolls through every bet type and validates each response field. */
async function rollLoop(token) {
  console.log(`\n== ${ROLLS} rolls at $1 (bet types rotating) ==`);

  const bets = ['high', 'low'];
  for (let sum = 3; sum <= 18; sum += 1) bets.push(sum);

  let balance = 500;
  let staked = 0;
  let paid = 0;
  let wins = 0;
  let triples = 0;
  let voided = 0;
  let diceErrors = 0;
  let sumErrors = 0;
  let tripleErrors = 0;
  let betEchoErrors = 0;
  let winErrors = 0;
  let payErrors = 0;
  let driftErrors = 0;

  for (let i = 0; i < ROLLS; i += 1) {
    const bet = bets[i % bets.length];
    const { status, data } = await request(
      'POST',
      '/game/dice3d/play',
      { betAmount: 1, betType: bet },
      token,
    );

    if (status !== 201 || !Array.isArray(data?.dice) || data.dice.length !== 3) {
      console.log(`  roll ${i}: bad response ${status} ${JSON.stringify(data)}`);
      diceErrors += 1;
      continue;
    }

    const want = score(data.dice, bet);
    const label = typeof bet === 'number' ? String(bet) : bet;

    if (!data.dice.every((die) => Number.isInteger(die) && die >= 1 && die <= 6)) {
      diceErrors += 1;
      console.log(`  roll ${i}: dice out of range ${data.dice.join(',')}`);
    }
    if (data.sum !== want.sum) sumErrors += 1;
    if (data.triple !== want.triple) tripleErrors += 1;
    if (data.betType !== label) {
      betEchoErrors += 1;
      if (betEchoErrors <= 3) console.log(`  roll ${i}: betType ${data.betType} != ${label}`);
    }
    if (data.betSum !== (typeof bet === 'number' ? bet : null)) betEchoErrors += 1;
    if (data.won !== want.won || data.tripleVoided !== want.tripleVoided) {
      winErrors += 1;
      if (winErrors <= 3) {
        console.log(`  roll ${i}: ${data.dice.join(',')} bet ${label} -> ${JSON.stringify(data)} vs ${JSON.stringify(want)}`);
      }
    }

    const wantPayout = round2(1 * want.multiplier);
    if (Math.abs(data.multiplier - want.multiplier) > 1e-9 || Math.abs(data.payout - wantPayout) > 0.001) {
      payErrors += 1;
      if (payErrors <= 3) console.log(`  roll ${i}: paid ${data.payout} (${data.multiplier}x) vs ${wantPayout}`);
    }

    balance = round2(balance - 1 + data.payout);
    if (Math.abs(data.balanceAfter - balance) > 0.001) {
      driftErrors += 1;
      if (driftErrors <= 3) console.log(`  roll ${i}: balance ${data.balanceAfter} vs ${balance}`);
    }

    staked += 1;
    paid += data.payout;
    if (want.won) wins += 1;
    if (want.triple) triples += 1;
    if (want.tripleVoided) voided += 1;
  }

  const observed = paid / staked;
  console.log(
    `staked=$${staked} paid=$${paid.toFixed(2)} observed RTP=${(observed * 100).toFixed(2)}% (long-run 97.2%)`,
  );
  console.log(`wins=${wins} triples=${triples} (expected ~${(ROLLS / 36).toFixed(1)}) voided=${voided}`);

  check('every roll returned 201 with three dice', diceErrors === 0, diceErrors);
  check('sum always matches the dice', sumErrors === 0, sumErrors);
  check('triple flag always matches', tripleErrors === 0, tripleErrors);
  check('betType/betSum echo the call', betEchoErrors === 0, betEchoErrors);
  check('won + tripleVoided match the rules', winErrors === 0, winErrors);
  check('multiplier and payout match', payErrors === 0, payErrors);
  check('balance never drifts', driftErrors === 0, driftErrors);
  check('observed RTP is plausible', observed > 0.5 && observed < 1.6, observed);

  console.log('\n=== fractional stake ===');
  const fractional = await request(
    'POST',
    '/game/dice3d/play',
    { betAmount: 1.5, betType: 'high' },
    token,
  );
  const fractionalWant = round2(1.5 * (fractional.data.won ? 2 : 0));
  console.log(
    `${fractional.data.dice.join(',')} = ${fractional.data.sum} → ${fractional.data.won ? 'won' : 'lost'} $${fractional.data.payout}`,
  );
  check('a 1.5 stake pays 3.00 on a win', Math.abs(fractional.data.payout - fractionalWant) < 0.001, fractional.data.payout);
  balance = round2(balance - 1.5 + fractional.data.payout);
  staked += 1.5;
  paid += fractional.data.payout;

  console.log('\n== balance ==');
  const wallet = await request('GET', '/wallet/balance', undefined, token);
  console.log(`expected=${balance} reported=${wallet.data.balance}`);
  check('ledger equals the replayed balance', Math.abs(wallet.data.balance - balance) < 0.001, wallet.data.balance);

  console.log('\n== validation ==');
  const cases = [
    ['missing betType', { betAmount: 1 }, 400, 'VALIDATION_ERROR'],
    ['total 2', { betAmount: 1, betType: 2 }, 400, 'VALIDATION_ERROR'],
    ['total 19', { betAmount: 1, betType: 19 }, 400, 'VALIDATION_ERROR'],
    ['fractional total', { betAmount: 1, betType: 15.5 }, 400, 'VALIDATION_ERROR'],
    ['word bet', { betAmount: 1, betType: 'middle' }, 400, 'VALIDATION_ERROR'],
    ['zero stake', { betAmount: 0, betType: 'high' }, 400, 'INVALID_BET_AMOUNT'],
    ['insufficient funds', { betAmount: 999999, betType: 'high' }, 400, 'INSUFFICIENT_FUNDS'],
  ];
  for (const [label, body, status, code] of cases) {
    const result = await request('POST', '/game/dice3d/play', body, token);
    check(
      `${label} → ${status} ${code}`,
      result.status === status && result.data?.error?.code === code,
      `${result.status} ${JSON.stringify(result.data)}`,
    );
  }

  const anonymous = await request('POST', '/game/dice3d/play', { betAmount: 1, betType: 'high' });
  check('unauthenticated → 401', anonymous.status === 401, anonymous.status);
}

  await rollLoop(token);
  console.log(failures === 0 ? '\nALL_CHECKS_PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('FAILED:', error.message);
  process.exitCode = 1;
});
