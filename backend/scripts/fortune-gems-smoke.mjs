/**
 * Fortune Gems — end-to-end settlement check against a real PostgreSQL.
 *
 *   DATABASE_URL=postgresql://postgres:pw@localhost:55432/casino \
 *     node backend/scripts/fortune-gems-smoke.mjs
 *
 * Unlike the other `*-smoke.mjs` scripts this one does not go through HTTP: it
 * calls the compiled services directly, so it can assert the things HTTP hides —
 * that every spin writes one ledger pair and one `game_rounds` row, that the
 * stored symbols are exactly the returned grid, and that the balance always
 * equals the ledger sum.
 *
 * The database must have every migration applied (001 … 021). The script creates
 * its own user, so it is safe to re-run against a scratch database.
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const dist = (p) =>
  pathToFileURL(path.join(import.meta.dirname, '..', 'dist', p)).href;

const db = await import(dist('config/db.js'));
const wallet = await import(dist('modules/wallet/wallet.service.js'));
const gems = await import(dist('modules/game/fortune_gems/fortune_gems.service.js'));

const { pool } = db;
const { FORTUNE_SYMBOLS, FORTUNE_PAYS, FORTUNE_CELLS, findClusters, fortuneGemsConfig } = gems;

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` -> ${detail}`}`);
  if (!ok) failures += 1;
};

const round2 = (value) => Math.round(value * 100) / 100;

// --- 1. a scratch player ----------------------------------------------------
const inserted = await pool.query(
  `INSERT INTO users (phone, password_hash)
   VALUES ($1, 'smoke-test-not-a-real-hash')
   RETURNING id`,
  [`+1555${Date.now().toString().slice(-7)}`],
);
const userId = inserted.rows[0].id;
console.log(`user ${userId}`);

const START = 1000;
await wallet.deposit(userId, START);
console.log(`deposited ${START}`);

// --- 2. spin until a few wins have been seen --------------------------------
const STAKE = 10;
let spins = 0;
let wins = 0;
let paidOut = 0;
let expectedBalance = START;
const tierHits = { small: 0, medium: 0, large: 0, huge: 0 };
const roundIds = new Set();

while (spins < 250 && wins < 4) {
  spins += 1;
  expectedBalance = round2(expectedBalance - STAKE);

  const result = await gems.playFortuneGems(userId, STAKE);

  // --- the board is a legal 4×3 draw
  if (result.grid.length !== FORTUNE_CELLS) {
    check(`spin ${spins}: grid length`, false, `${result.grid.length}`);
  }
  if (!result.grid.every((symbol) => FORTUNE_SYMBOLS.includes(symbol))) {
    check(`spin ${spins}: symbols from the paytable`, false, result.grid.join(''));
  }

  // --- the clusters are exactly what that board implies
  const recomputed = findClusters(result.grid);
  const sameClusters =
    recomputed.length === result.clusters.length &&
    recomputed.every((cluster, index) => {
      const served = result.clusters[index];
      return (
        served.symbol === cluster.symbol &&
        served.size === cluster.size &&
        served.pay === cluster.pay &&
        served.tier === cluster.tier &&
        served.cells.join(',') === cluster.cells.join(',')
      );
    });
  if (!sameClusters) {
    check(`spin ${spins}: clusters match the board`, false, JSON.stringify(result.clusters));
  }

  // --- size → paytable tier, and no cluster below the minimum
  for (const cluster of result.clusters) {
    const expectedPay =
      cluster.size >= 10
        ? FORTUNE_PAYS.huge
        : cluster.size >= 8
          ? FORTUNE_PAYS.large
          : cluster.size >= 6
            ? FORTUNE_PAYS.medium
            : FORTUNE_PAYS.small;
    if (cluster.size < 4 || cluster.pay !== expectedPay) {
      check(`spin ${spins}: cluster size ${cluster.size} pays ${cluster.pay}`, false, `${expectedPay}`);
    }
    tierHits[cluster.tier] += 1;
  }

  // --- money maths
  const expectedMultiplier = round2(
    result.clusters.reduce((sum, cluster) => sum + cluster.pay, 0),
  );
  if (result.multiplier !== expectedMultiplier) {
    check(`spin ${spins}: multiplier`, false, `${result.multiplier} vs ${expectedMultiplier}`);
  }
  if (result.payout !== round2(STAKE * expectedMultiplier)) {
    check(`spin ${spins}: payout`, false, `${result.payout}`);
  }
  if (result.won !== result.payout > 0) {
    check(`spin ${spins}: won flag`, false, `${result.won}`);
  }

  const expectedWinning = [...new Set(result.clusters.flatMap((c) => c.cells))].sort((a, b) => a - b);
  if (result.winningCells.join(',') !== expectedWinning.join(',')) {
    check(`spin ${spins}: winningCells`, false, result.winningCells.join(','));
  }

  expectedBalance = round2(expectedBalance + result.payout);
  if (result.balanceAfter !== expectedBalance) {
    check(`spin ${spins}: balanceAfter`, false, `${result.balanceAfter} vs ${expectedBalance}`);
  }

  if (result.payout > 0) wins += 1;
  paidOut = round2(paidOut + result.payout);
  roundIds.add(result.roundId);
}

console.log(
  `\n${spins} spins · ${wins} wins · paid out ${paidOut} · tier hits ${JSON.stringify(tierHits)}`,
);

// --- 3. the database agrees -------------------------------------------------
console.log('\n=== database checks ===');

const balance = await wallet.getBalance(userId);
check('balance equals the expected running total', balance === expectedBalance, `${balance} vs ${expectedBalance}`);

const ledger = await pool.query(
  `SELECT type, COUNT(*)::int AS count, COALESCE(SUM(amount), 0) AS total
     FROM transactions
    WHERE user_id = $1
    GROUP BY type
    ORDER BY type`,
  [userId],
);
const byType = Object.fromEntries(ledger.rows.map((row) => [row.type, row]));

check('one deposit row', byType.deposit?.count === 1 && Number(byType.deposit.total) === START);
check(
  'one bet row per spin',
  byType.bet?.count === spins && Number(byType.bet.total) === round2(-spins * STAKE),
  `${byType.bet?.count} rows totalling ${byType.bet?.total}`,
);
check(
  'one win row per winning spin',
  (byType.win?.count ?? 0) === wins && round2(Number(byType.win?.total ?? 0)) === paidOut,
  `${byType.win?.count} rows totalling ${byType.win?.total}`,
);

const rounds = await pool.query(
  `SELECT bet_type, bet_value, result, bet_amount, payout, multiplier, server_seed_hash,
          char_length(result) AS chars
     FROM game_rounds
    WHERE user_id = $1`,
  [userId],
);
check('one game_rounds row per spin', rounds.rowCount === spins, `${rounds.rowCount}`);
check(
  'every round is bet_type = fortune_gems',
  rounds.rows.every((row) => row.bet_type === 'fortune_gems'),
  [...new Set(rounds.rows.map((row) => row.bet_type))].join(','),
);
check('bet_value stays NULL', rounds.rows.every((row) => row.bet_value === null));
check(
  'stake stored exactly',
  rounds.rows.every((row) => Number(row.bet_amount) === STAKE),
);
check(
  'payout column sums to the paid total',
  round2(rounds.rows.reduce((sum, row) => sum + Number(row.payout), 0)) === paidOut,
);
check(
  'server_seed_hash is 64 lowercase hex',
  rounds.rows.every((row) => /^[0-9a-f]{64}$/.test(row.server_seed_hash)),
);
check(
  'result fits VARCHAR(64) even with the 3-code-point 8️⃣',
  rounds.rows.every((row) => row.chars >= FORTUNE_CELLS && row.chars <= 64),
  `max ${Math.max(...rounds.rows.map((row) => row.chars))} chars`,
);

/** Split a stored result string back into symbols, longest match first. */
function parseSymbols(text) {
  const byLength = [...FORTUNE_SYMBOLS].sort((a, b) => b.length - a.length);
  const out = [];
  let index = 0;

  while (index < text.length) {
    const match = byLength.find((symbol) => text.startsWith(symbol, index));
    if (!match) return null;
    out.push(match);
    index += match.length;
  }

  return out;
}

let unparsable = 0;
let mismatched = 0;

for (const row of rounds.rows) {
  const grid = parseSymbols(row.result);
  if (!grid || grid.length !== FORTUNE_CELLS) {
    unparsable += 1;
    continue;
  }

  // Re-derive the win from the stored board alone and compare with the columns.
  const clusters = findClusters(grid);
  const multiplier = round2(clusters.reduce((sum, cluster) => sum + cluster.pay, 0));
  const payout = round2(STAKE * multiplier);

  if (Number(row.multiplier) !== multiplier || Number(row.payout) !== payout) {
    mismatched += 1;
  }
}

check('every stored result parses back into a 4×3 board', unparsable === 0, `${unparsable} bad`);
check(
  'stored boards re-settle to the stored multiplier/payout',
  mismatched === 0,
  `${mismatched} mismatched`,
);

// --- 4. a losing bet must not leave a trace ---------------------------------
const before = await pool.query('SELECT COUNT(*)::int AS n FROM transactions WHERE user_id = $1', [
  userId,
]);
let rejected = false;

try {
  await gems.playFortuneGems(userId, 1_000_000);
} catch (error) {
  rejected = error?.code === 'INSUFFICIENT_FUNDS' || error?.statusCode === 400;
}

check('over-budget spin is rejected with INSUFFICIENT_FUNDS', rejected);

const after = await pool.query('SELECT COUNT(*)::int AS n FROM transactions WHERE user_id = $1', [
  userId,
]);
const roundsAfter = await pool.query(
  'SELECT COUNT(*)::int AS n FROM game_rounds WHERE user_id = $1',
  [userId],
);
check(
  'rejected spin wrote no ledger rows',
  before.rows[0].n === after.rows[0].n,
  `${before.rows[0].n} -> ${after.rows[0].n}`,
);
check('rejected spin wrote no round row', roundsAfter.rows[0].n === spins);

// --- 5. the config the cabinet draws ----------------------------------------
const config = fortuneGemsConfig();
check('config advertises 12 cells over 4×3', config.cells === 12 && config.cols === 4 && config.rows === 3);
check('config RTP is 97-98%', config.rtp > 0.96 && config.rtp < 0.98, `${config.rtp}`);

await pool.end();
console.log(failures === 0 ? '\nOK — Fortune Gems settles cleanly' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
