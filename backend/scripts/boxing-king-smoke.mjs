/**
 * Boxing King — live smoke test against a running backend.
 *
 *   node backend/scripts/boxing-king-smoke.mjs [spins]
 *
 * Clusters are recomputed here with a **union-find** over the 12 orthogonal edges
 * (the server uses a DFS), so the win detection is genuinely independent.
 */
const BASE = 'http://localhost:3000/api';
const SPINS = Number(process.argv[2] ?? 180);

const SYMBOLS = ['🥊', '🏆', '🤴', '💪', '💥', '🩳'];
const PAYS = { small: 2, medium: 8.5, large: 30 };
const EDGES = [
  [0, 1], [1, 2], [3, 4], [4, 5], [6, 7], [7, 8],
  [0, 3], [3, 6], [1, 4], [4, 7], [2, 5], [5, 8],
];

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

/** Union-find over the orthogonal edges — a different algorithm to the server's. */
function clustersOf(board) {
  const parent = [...Array(9).keys()];
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (const [a, b] of EDGES) {
    if (board[a] === board[b]) union(a, b);
  }

  const groups = new Map();
  for (let cell = 0; cell < 9; cell += 1) {
    const root = find(cell);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(cell);
  }

  return [...groups.values()]
    .filter((cells) => cells.length >= 3)
    .map((cells) => ({
      cells: cells.sort((a, b) => a - b),
      size: cells.length,
      pay: cells.length >= 7 ? PAYS.large : cells.length >= 5 ? PAYS.medium : PAYS.small,
    }));
}

async function main() {
  const phone = `9${Math.floor(100000000 + Math.random() * 899999999)}`;
  const creds = { phone, password: 'BoxingKing1!' };

  console.log('== register / login / deposit ==');
  await request('POST', '/auth/register', creds);
  const login = await request('POST', '/auth/login', creds);
  const token = login.data?.token;
  if (!token) throw new Error(`login failed: ${JSON.stringify(login.data)}`);
  console.log(`user=${login.data.user.id}`);
  await request('POST', '/wallet/deposit', { amount: 400 }, token);

  console.log('\n== config ==');
  const config = (await request('GET', '/game/boxing_king/config', undefined, token)).data;
  console.log(`symbols=${config.symbols.join(' ')} cells=${config.cells} outcomes=${config.outcomes}`);
  console.log(
    `pays 3-4=${config.pays.small}x 5-6=${config.pays.medium}x 7+=${config.pays.large}x · hit=${config.hitRate} · rtp=${config.rtp}`,
  );

  check('six symbols as briefed', config.symbols.join('') === SYMBOLS.join(''), config.symbols.join(''));
  check('nine cells', config.cells === 9, config.cells);
  check('cluster minimum is 3', config.minCluster === 3, config.minCluster);
  check('pays rise by tier', config.pays.small < config.pays.medium && config.pays.medium < config.pays.large, JSON.stringify(config.pays));
  check('rtp is 97.42%', Math.abs(config.rtp - 0.974219) < 1e-5, config.rtp);
  check('house edge is 2.58%', Math.abs(config.houseEdge - 0.025781) < 1e-5, config.houseEdge);
  check('hit rate ~38%', Math.abs(config.hitRate - 0.378676) < 1e-6, config.hitRate);

  const balance = await spinLoop(token, config);
  await tail(token, balance);
}

main().catch((error) => {
  console.error('FAILED:', error.message);
  process.exitCode = 1;
});


/** Plays SPINS rounds at $1, validates every field, and returns the balance. */
async function spinLoop(token, config) {
  console.log(`\n== ${SPINS} spins at $1 ==`);

  let balance = 400;
  let staked = 0;
  let paid = 0;
  let winningSpins = 0;
  let clustersSeen = 0;
  let biggest = 0;
  let gridErrors = 0;
  let clusterErrors = 0;
  let cellErrors = 0;
  let multiplierErrors = 0;
  let payoutErrors = 0;
  let driftErrors = 0;
  let samples = 0;

  for (let spin = 0; spin < SPINS; spin += 1) {
    const { status, data } = await request('POST', '/game/boxing_king/play', { betAmount: 1 }, token);

    if (status !== 201 || !Array.isArray(data?.grid) || data.grid.length !== 9) {
      gridErrors += 1;
      console.log(`  spin ${spin}: bad response ${status} ${JSON.stringify(data)}`);
      continue;
    }

    if (!data.grid.every((symbol) => SYMBOLS.includes(symbol))) {
      gridErrors += 1;
      console.log(`  spin ${spin}: unknown symbol ${data.grid.join('')}`);
    }

    const want = clustersOf(data.grid);
    const gotSizes = (data.clusters ?? []).map((cluster) => cluster.size).sort((a, b) => a - b);
    const wantSizes = want.map((cluster) => cluster.size).sort((a, b) => a - b);

    if (JSON.stringify(gotSizes) !== JSON.stringify(wantSizes)) {
      clusterErrors += 1;
      if (clusterErrors <= 3) {
        console.log(`  spin ${spin}: ${data.grid.join('')} clusters ${gotSizes} vs ${wantSizes}`);
      }
    }

    for (const cluster of data.clusters ?? []) {
      clustersSeen += 1;
      const expectPay =
        cluster.size >= 7 ? config.pays.large : cluster.size >= 5 ? config.pays.medium : config.pays.small;
      if (cluster.pay !== expectPay) clusterErrors += 1;
      if (cluster.cells.some((cell) => data.grid[cell] !== cluster.symbol)) clusterErrors += 1;
      if (new Set(cluster.cells).size !== cluster.size) clusterErrors += 1;
    }

    const wantCells = [...new Set(want.flatMap((cluster) => cluster.cells))].sort((a, b) => a - b);
    if (JSON.stringify(data.winningCells) !== JSON.stringify(wantCells)) cellErrors += 1;

    const wantMultiplier = round2(want.reduce((sum, cluster) => sum + cluster.pay, 0));
    if (Math.abs(data.multiplier - wantMultiplier) > 1e-9) {
      multiplierErrors += 1;
      if (multiplierErrors <= 3) console.log(`  spin ${spin}: multiplier ${data.multiplier} vs ${wantMultiplier}`);
    }

    const wantPayout = round2(1 * wantMultiplier);
    if (Math.abs(data.payout - wantPayout) > 0.001 || data.won !== wantPayout > 0) {
      payoutErrors += 1;
      if (payoutErrors <= 3) console.log(`  spin ${spin}: payout ${data.payout} (won=${data.won}) vs ${wantPayout}`);
    }

    const wantBiggest = want.reduce((max, cluster) => Math.max(max, cluster.size), 0);
    if (data.biggestCluster !== wantBiggest) clusterErrors += 1;
    if (wantBiggest > biggest) biggest = wantBiggest;

    balance = round2(balance - 1 + data.payout);
    if (Math.abs(data.balanceAfter - balance) > 0.001) driftErrors += 1;

    staked += 1;
    paid += data.payout;
    if (wantPayout > 0) winningSpins += 1;

    if (samples < 5) {
      const label = want.length
        ? want.map((cluster) => `${cluster.size}x${cluster.pay}`).join(' + ')
        : 'no cluster';
      console.log(
        `  ${data.grid.slice(0, 3).join('')} / ${data.grid.slice(3, 6).join('')} / ${data.grid.slice(6).join('')} | ${label} | ${data.multiplier}x → $${data.payout}`,
      );
      samples += 1;
    }
  }

  const observed = paid / staked;
  console.log(
    `\nstaked=$${staked} paid=$${paid.toFixed(2)} observed RTP=${(observed * 100).toFixed(2)}% (long-run 97.42%)`,
  );
  console.log(
    `spins paying=${winningSpins}/${SPINS} (expect ~${Math.round(SPINS * config.hitRate)}) | clusters=${clustersSeen} | biggest=${biggest}`,
  );

  check('every spin returned a nine-symbol board', gridErrors === 0, gridErrors);
  check('clusters match a union-find pass', clusterErrors === 0, clusterErrors);
  check('winningCells match', cellErrors === 0, cellErrors);
  check('multiplier equals the cluster sum', multiplierErrors === 0, multiplierErrors);
  check('payout equals stake x multiplier', payoutErrors === 0, payoutErrors);
  check('balance never drifts', driftErrors === 0, driftErrors);
  check('the board pays sometimes', winningSpins > 0, winningSpins);
  check('observed RTP is plausible', observed > 0.5 && observed < 1.8, observed);

  return balance;
}

/** Fractional stake, ledger reconciliation and validation. */
async function tail(token, balance) {
  console.log('\n=== fractional stake ===');
  const fractional = await request('POST', '/game/boxing_king/play', { betAmount: 2.5 }, token);
  const fractionalWant = round2(2.5 * fractional.data.multiplier);
  console.log(
    `${fractional.data.grid.join('')} → ${fractional.data.multiplier}x → $${fractional.data.payout}`,
  );
  check(
    'a 2.5 stake pays stake x multiplier',
    Math.abs(fractional.data.payout - fractionalWant) < 0.001,
    fractional.data.payout,
  );
  balance = round2(balance - 2.5 + fractional.data.payout);

  console.log('\n== balance ==');
  const wallet = await request('GET', '/wallet/balance', undefined, token);
  console.log(`expected=${balance} reported=${wallet.data.balance}`);
  check('ledger equals the replayed balance', Math.abs(wallet.data.balance - balance) < 0.001, wallet.data.balance);

  console.log('\n== validation ==');
  const cases = [
    ['missing betAmount', {}, 400, 'VALIDATION_ERROR'],
    ['zero stake', { betAmount: 0 }, 400, 'INVALID_BET_AMOUNT'],
    ['negative stake', { betAmount: -5 }, 400, 'INVALID_BET_AMOUNT'],
    ['non-numeric stake', { betAmount: 'abc' }, 400, 'VALIDATION_ERROR'],
    ['insufficient funds', { betAmount: 999999 }, 400, 'INSUFFICIENT_FUNDS'],
  ];
  for (const [label, body, status, code] of cases) {
    const result = await request('POST', '/game/boxing_king/play', body, token);
    check(
      `${label} → ${status} ${code}`,
      result.status === status && result.data?.error?.code === code,
      `${result.status} ${JSON.stringify(result.data)}`,
    );
  }

  const anonymous = await request('POST', '/game/boxing_king/play', { betAmount: 1 });
  check('unauthenticated → 401', anonymous.status === 401, anonymous.status);

  console.log(failures === 0 ? '\nALL_CHECKS_PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

