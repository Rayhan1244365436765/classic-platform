/**
 * 3D Dice — exact verification by enumerating all 6³ = 216 rolls.
 *
 *   node backend/scripts/verify-dice3d.cjs
 *
 * Checks the outcome table, every payout, the triple-loses-high/low rule and the
 * RTP of all 18 bet types against an independent implementation.
 */
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const FACES = 6;
const DICE = 3;
const OUTCOMES = FACES ** DICE;

/** Payout per total, as multiples of the stake. */
const SUM_PAYS = {
  3: 210, 4: 70, 5: 35, 6: 21, 7: 14, 8: 10, 9: 8.4,
  10: 7.8, 11: 7.8, 12: 8.4, 13: 10, 14: 14, 15: 21, 16: 35, 17: 70, 18: 210,
};

const EXPECTED_COUNTS = {
  3: 1, 4: 3, 5: 6, 6: 10, 7: 15, 8: 21, 9: 25, 10: 27, 11: 27,
  12: 25, 13: 21, 14: 15, 15: 10, 16: 6, 17: 3, 18: 1,
};

/** Every roll, as [a, b, c]. */
const ROLLS = [];
for (let a = 1; a <= FACES; a += 1) {
  for (let b = 1; b <= FACES; b += 1) {
    for (let c = 1; c <= FACES; c += 1) ROLLS.push([a, b, c]);
  }
}

const isTriple = (dice) => dice[0] === dice[1] && dice[1] === dice[2];
const total = (dice) => dice[0] + dice[1] + dice[2];

/** Independent scorer: the brief's ranges plus the triple rule. */
function expected(dice, bet) {
  const sum = total(dice);
  if (bet === 'high' || bet === 'low') {
    const inRange = bet === 'high' ? sum >= 11 : sum <= 10;
    const won = inRange && !isTriple(dice);

    return { won, multiplier: won ? 2 : 0 };
  }

  const won = sum === bet;

  return { won, multiplier: won ? SUM_PAYS[bet] : 0 };
}

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` -> ${detail}`}`);
  if (!ok) failures += 1;
};

console.log('=== outcome table ===');
const counts = {};
for (const dice of ROLLS) counts[total(dice)] = (counts[total(dice)] ?? 0) + 1;
for (const sum of Object.keys(EXPECTED_COUNTS)) {
  check(`sum ${sum} has ${EXPECTED_COUNTS[sum]} combos`, counts[sum] === EXPECTED_COUNTS[sum], counts[sum]);
}
check('216 rolls in total', ROLLS.length === OUTCOMES, ROLLS.length);
console.log(Object.keys(counts).map((k) => `${k}:${counts[k]}`).join(' '));

console.log('\n=== high / low ===');
const triples = ROLLS.filter(isTriple);
check('there are 6 triples', triples.length === 6, triples.length);
const highWins = ROLLS.filter((d) => expected(d, 'high').won).length;
const lowWins = ROLLS.filter((d) => expected(d, 'low').won).length;
console.log(`high wins ${highWins}/216, low wins ${lowWins}/216, triples ${triples.length}`);
check('high wins 105 of 216', highWins === 105, highWins);
check('low wins 105 of 216', lowWins === 105, lowWins);
check('halves are symmetric', highWins === lowWins, `${highWins} vs ${lowWins}`);
check(
  'a triple never pays high or low',
  triples.every((d) => !expected(d, 'high').won && !expected(d, 'low').won),
  'a triple paid',
);

const highRtp = (highWins * 2) / OUTCOMES;
console.log(`RTP high = ${highRtp.toFixed(6)} (${(highRtp * 100).toFixed(4)}%)`);
check('high/low RTP is 35/36', Math.abs(highRtp - 35 / 36) < 1e-12, highRtp);

console.log('\n=== totals ===');
for (const sum of Object.keys(SUM_PAYS).map(Number)) {
  const combos = counts[sum];
  const pay = SUM_PAYS[sum];
  const rtp = (combos * pay) / OUTCOMES;
  console.log(
    `  sum ${String(sum).padStart(2)} | ${String(combos).padStart(2)} combos × ${String(pay).padStart(3)}x = ${(rtp * 100).toFixed(4)}%`,
  );
  check(`sum ${sum} returns 96-98%`, rtp > 0.96 && rtp < 0.98, rtp);
}

console.log('\n=== service cross-check ===');
const serviceUrl = pathToFileURL(
  path.join(__dirname, '..', 'dist', 'modules', 'game', 'dice3d', 'dice3d.service.js'),
).href;

import(serviceUrl)
  .then((service) => {
    const config = service.dice3dConfig();
    console.log(
      `config: dice=${config.dice} faces=${config.faces} outcomes=${config.outcomes} triplesLoseHighLow=${config.triplesLoseHighLow}`,
    );
    console.log(`config high: pay=${config.high.pay} chance=${config.high.chance} rtp=${config.high.rtp}`);
    check('config outcomes 216', config.outcomes === OUTCOMES, config.outcomes);
    check('config flags the triple rule', config.triplesLoseHighLow === true, config.triplesLoseHighLow);
    check('config pays 2x both halves', config.high.pay === 2 && config.low.pay === 2, config.high.pay);
    check('config lists 16 totals', config.sums.length === 16, config.sums.length);

    for (const entry of config.sums) {
      check(
        `config total ${entry.sum}`,
        entry.pay === SUM_PAYS[entry.sum] && entry.combos === counts[entry.sum],
        `${entry.pay}/${entry.combos}`,
      );
    }

    let mismatches = 0;
    const bets = ['high', 'low', ...Object.keys(SUM_PAYS).map(Number)];
    for (const dice of ROLLS) {
      for (const raw of bets) {
        const bet = typeof raw === 'number' ? { kind: 'sum', sum: raw } : { kind: raw };
        const got = service.evaluateDice3d(dice, bet);
        const want = expected(dice, raw);
        if (got.won !== want.won || Math.abs(got.multiplier - want.multiplier) > 1e-9) {
          if (mismatches < 5) {
            console.log(
              `  mismatch: ${dice.join(',')} bet ${raw} -> ${JSON.stringify(got)} vs ${JSON.stringify(want)}`,
            );
          }
          mismatches += 1;
        }
      }
    }
    console.log(`evaluateDice3d: 216 rolls × 18 bets = ${OUTCOMES * 18} comparisons`);
    check('service scorer agrees everywhere', mismatches === 0, mismatches);

    // parseBet normalises the accepted shapes and rejects the rest.
    let parseErrors = 0;
    for (const [input, want] of [['high', 'high'], ['LOW', 'low'], [15, 15], ['3', 3], [18, 18]]) {
      const parsed = service.parseBet(input);
      const label = parsed.kind === 'sum' ? parsed.sum : parsed.kind;
      if (label !== want) parseErrors += 1;
    }
    check('parseBet accepts high/low/3..18', parseErrors === 0, parseErrors);

    const rejected = [2, 19, 'zero', '', null, 15.5, 'abc'];
    const accepted = rejected.filter((bad) => {
      try {
        service.parseBet(bad);
        return true;
      } catch {
        return false;
      }
    });
    check('parseBet rejects bad input', accepted.length === 0, accepted.join(','));

    const rtpHigh = service.dice3dRtp({ kind: 'high' });
    const rtp15 = service.dice3dRtp({ kind: 'sum', sum: 15 });
    check('service high RTP = 35/36', Math.abs(rtpHigh - 35 / 36) < 1e-12, rtpHigh);
    check('service total-15 RTP = 35/36', Math.abs(rtp15 - 35 / 36) < 1e-12, rtp15);

    console.log(failures === 0 ? '\nALL_CHECKS_PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exitCode = failures === 0 ? 0 : 1;
  })
  .catch((error) => {
    console.error('FAILED:', error.message);
    console.error('Build the backend first: npm run build (in backend/)');
    process.exitCode = 1;
  });
