/**
 * Fruit Bonanza — live smoke test against a running backend.
 *
 * Written in Node rather than PowerShell because every symbol is an emoji:
 * PowerShell 5.1 reads UTF-8 `.ps1` files as ANSI and would compare mojibake.
 *
 *   node backend/scripts/fruit-bonanza-smoke.mjs [spins]
 *
 * The grid is re-scored here with an independent implementation of the five
 * paylines, so a bug in the service cannot hide behind its own maths.
 */
const BASE = 'http://localhost:3000/api';
const SPINS = Number(process.argv[2] ?? 200);

const SYMBOLS = ['🍉', '🍇', '🍋', '🍒', '🍊', '⭐'];
const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 4, 8],
  [2, 4, 6],
];
const PAYS = { three: 4, two: 0.2 };

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
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

/** Independent line scorer for a 9-symbol grid. */
function score(grid) {
  return LINES.map(([a, b, c], line) => {
    const symbols = [grid[a], grid[b], grid[c]];
    const [x, y, z] = symbols;
    const match = x === y && y === z ? 'three' : x === y || y === z || x === z ? 'two' : 'none';

    return {
      line,
      symbols,
      match,
      multiplier: match === 'three' ? PAYS.three : match === 'two' ? PAYS.two : 0,
    };
  });
}

async function main() {
  const phone = `9${Math.floor(100000000 + Math.random() * 899999999)}`;
  const creds = { phone, password: 'FruitBonanza1!' };

  console.log('== register / login / deposit ==');
  await request('POST', '/auth/register', creds);
  const login = await request('POST', '/auth/login', creds);
  const token = login.data?.token;
  if (!token) throw new Error(`login failed: ${JSON.stringify(login.data)}`);
  console.log(`user=${login.data.user.id}`);
  await request('POST', '/wallet/deposit', { amount: 400 }, token);

  console.log('\n== config ==');
  const config = await request('GET', '/game/fruit_bonanza/config', undefined, token);
  const cfg = config.data;
  console.log(
    `symbols=${cfg.symbols.join(' ')} lines=${cfg.lineCount} pays=${JSON.stringify(cfg.pays)}`,
  );
  console.log(`rtp=${cfg.rtp} houseEdge=${cfg.houseEdge}`);
  console.log(
    `P(three)=${cfg.probabilities.three} P(two)=${cfg.probabilities.two} P(none)=${cfg.probabilities.none}`,
  );

  check('config is 200', config.status === 200, config.status);
  check('six symbols, exactly as briefed', cfg.symbols.join('') === SYMBOLS.join(''), cfg.symbols);
  check('five paylines', cfg.lineCount === 5, cfg.lineCount);
  check(
    'paylines are rows then diagonals',
    JSON.stringify(cfg.lines.map((line) => [...line])) === JSON.stringify(LINES),
    JSON.stringify(cfg.lines),
  );
  check('triple pays 4x, pair 0.2x', cfg.pays.three === 4 && cfg.pays.two === 0.2, cfg.pays);
  check('rtp is 35/36', Math.abs(cfg.rtp - 35 / 36) < 1e-12, cfg.rtp);
  check('house edge is 1/36', Math.abs(cfg.houseEdge - 1 / 36) < 1e-12, cfg.houseEdge);
  check(
    'probabilities sum to 1',
    Math.abs(cfg.probabilities.three + cfg.probabilities.two + cfg.probabilities.none - 1) < 1e-12,
    JSON.stringify(cfg.probabilities),
  );

  await spinLoop(token);
  console.log(failures === 0 ? '\nALL_CHECKS_PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

/** Plays SPINS rounds at $1 and validates every field against the local scorer. */
async function spinLoop(token) {
  console.log(`\n== ${SPINS} spins at $1 ==`);

  let balance = 400;
  let staked = 0;
  let paid = 0;
  let tripleLines = 0;
  let pairLines = 0;
  let spinsWithWin = 0;
  let statusErrors = 0;
  let gridErrors = 0;
  let lineErrors = 0;
  let winLineErrors = 0;
  let multiplierErrors = 0;
  let payoutErrors = 0;
  let driftErrors = 0;
  let samples = 0;

  for (let spin = 0; spin < SPINS; spin += 1) {
    const { status, data } = await request(
      'POST',
      '/game/fruit_bonanza/play',
      { betAmount: 1 },
      token,
    );

    if (status !== 201 || !Array.isArray(data?.grid) || data.grid.length !== 9) {
      statusErrors += 1;
      console.log(`  spin ${spin}: bad response ${status} ${JSON.stringify(data)}`);
      continue;
    }
    if (!data.grid.every((symbol) => SYMBOLS.includes(symbol))) {
      gridErrors += 1;
      console.log(`  spin ${spin}: unknown symbol in ${data.grid.join('')}`);
    }

    const expected = score(data.grid);
    let multiplier = 0;

    if (!Array.isArray(data.lines) || data.lines.length !== 5) {
      lineErrors += 1;
    } else {
      for (const [index, want] of expected.entries()) {
        const got = data.lines[index];
        const ok =
          got.line === index &&
          got.match === want.match &&
          got.symbols.join('') === want.symbols.join('') &&
          Math.abs(got.multiplier - want.multiplier) < 1e-9 &&
          got.cells.join('-') === LINES[index].join('-');
        if (!ok) {
          lineErrors += 1;
          if (lineErrors <= 5) {
            console.log(`  spin ${spin} line ${index}: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`);
          }
        }
        multiplier += want.multiplier;
        if (want.match === 'three') tripleLines += 1;
        if (want.match === 'two') pairLines += 1;
      }
    }

    const wantWinning = expected.filter((line) => line.multiplier > 0).map((line) => line.line);
    if (JSON.stringify(data.winningLines) !== JSON.stringify(wantWinning)) {
      winLineErrors += 1;
    }
    if (Math.abs(data.multiplier - multiplier) > 1e-9) {
      multiplierErrors += 1;
    }

    const wantPayout = Math.round(multiplier * 100) / 100;
    if (Math.abs(data.payout - wantPayout) > 0.001 || data.won !== wantPayout > 0) {
      payoutErrors += 1;
      if (payoutErrors <= 5) {
        console.log(`  spin ${spin}: payout ${data.payout} (won=${data.won}) vs ${wantPayout}`);
      }
    }

    balance = Math.round((balance - 1 + data.payout) * 100) / 100;
    if (Math.abs(data.balanceAfter - balance) > 0.001) {
      driftErrors += 1;
      if (driftErrors <= 5) {
        console.log(`  spin ${spin}: balance ${data.balanceAfter} vs expected ${balance}`);
      }
    }

    staked += 1;
    paid += data.payout;
    if (wantPayout > 0) spinsWithWin += 1;

    if (samples < 4) {
      console.log(
        `  ${data.grid.slice(0, 3).join('')} / ${data.grid.slice(3, 6).join('')} / ${data.grid.slice(6).join('')} | lines ${data.winningLines.join(',') || '-'} | ${data.multiplier}x → $${data.payout}`,
      );
      samples += 1;
    }
  }

  const observed = paid / staked;
  console.log(`\nstaked=$${staked} paid=$${paid.toFixed(2)} observed RTP=${(observed * 100).toFixed(2)}%`);
  console.log(
    `spins paying=${spinsWithWin}/${SPINS} | triple lines=${tripleLines} | pair lines=${pairLines}`,
  );
  console.log(
    `expected over ${SPINS} spins: triple lines ${((SPINS * 5) / 36).toFixed(1)}, pair lines ${(SPINS * 5 * (5 / 12)).toFixed(1)}`,
  );

  check('every spin returned 201', statusErrors === 0, statusErrors);
  check('every grid holds nine known symbols', gridErrors === 0, gridErrors);
  check('every line matches the independent scorer', lineErrors === 0, lineErrors);
  check('winningLines matches', winLineErrors === 0, winLineErrors);
  check('multiplier equals the line sum', multiplierErrors === 0, multiplierErrors);
  check('payout equals stake × multiplier', payoutErrors === 0, payoutErrors);
  check('balance never drifts', driftErrors === 0, driftErrors);
  check('the reels actually pay sometimes', spinsWithWin > 0, spinsWithWin);
  check('observed RTP is plausible for 97.22%', observed > 0.5 && observed < 1.6, observed);

  console.log('\n== balance ==');
  const wallet = await request('GET', '/wallet/balance', undefined, token);
  console.log(`expected=${balance} reported=${wallet.data.balance}`);
  check('ledger equals the replayed balance', Math.abs(wallet.data.balance - balance) < 0.001, wallet.data.balance);

  console.log('\n== validation ==');
  const cases = [
    ['missing betAmount', {}, 400, 'VALIDATION_ERROR'],
    ['zero bet', { betAmount: 0 }, 400, 'INVALID_BET_AMOUNT'],
    ['negative bet', { betAmount: -5 }, 400, 'INVALID_BET_AMOUNT'],
    ['non-numeric bet', { betAmount: 'abc' }, 400, 'VALIDATION_ERROR'],
    ['insufficient funds', { betAmount: 999999 }, 400, 'INSUFFICIENT_FUNDS'],
  ];
  for (const [label, body, status, code] of cases) {
    const result = await request('POST', '/game/fruit_bonanza/play', body, token);
    check(
      `${label} → ${status} ${code}`,
      result.status === status && result.data?.error?.code === code,
      `${result.status} ${JSON.stringify(result.data)}`,
    );
  }

  const anonymous = await request('POST', '/game/fruit_bonanza/play', { betAmount: 1 });
  check('unauthenticated → 401', anonymous.status === 401, anonymous.status);
}

main().catch((error) => {
  console.error('FAILED:', error.message);
  process.exitCode = 1;
});
