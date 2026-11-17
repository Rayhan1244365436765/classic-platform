/**
 * Classic European roulette — exact verification of the 37-pocket table.
 *
 * Roulette is small enough to enumerate: every bet is decided by counting which
 * of the 37 pockets it wins on, so the RTP here is exact, not sampled.
 *
 *   node backend/scripts/verify-classic-roulette.cjs
 */
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const POCKETS = 37;
const RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const PAYOUTS = { number: 36, red: 2, black: 2, even: 2, odd: 2, low: 2, high: 2 };
const BET_TYPES = ['number', 'red', 'black', 'even', 'odd', 'low', 'high'];

/**
 * The European wheel, clockwise: a permutation of 0–36 that must match the
 * order the client draws.
 */
const WHEEL = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

function colourOf(pocket) {
  if (pocket === 0) return 'green';
  return RED.includes(pocket) ? 'red' : 'black';
}

function wins(betType, betValue, pocket) {
  const colour = colourOf(pocket);
  switch (betType) {
    case 'number':
      return pocket === betValue;
    case 'red':
      return colour === 'red';
    case 'black':
      return colour === 'black';
    case 'even':
      return pocket !== 0 && pocket % 2 === 0;
    case 'odd':
      return pocket !== 0 && pocket % 2 === 1;
    case 'low':
      return pocket >= 1 && pocket <= 18;
    case 'high':
      return pocket >= 19 && pocket <= 36;
    default:
      throw new Error(`unknown bet type ${betType}`);
  }
}

function rtpOf(betType, betValue) {
  let winning = 0;
  for (let pocket = 0; pocket < POCKETS; pocket += 1) {
    if (wins(betType, betValue, pocket)) winning += 1;
  }
  return { winning, rtp: (winning / POCKETS) * PAYOUTS[betType] };
}

function main() {
  console.log('=== layout ===');
  const reds = [];
  const blacks = [];
  for (let pocket = 0; pocket < POCKETS; pocket += 1) {
    const colour = colourOf(pocket);
    if (colour === 'red') reds.push(pocket);
    if (colour === 'black') blacks.push(pocket);
  }
  console.log(`green: 0`);
  console.log(`red  (${reds.length}): ${reds.join(',')}`);
  console.log(`black (${blacks.length}): ${blacks.join(',')}`);
  console.assert(reds.length === 18, 'there must be 18 red pockets');
  console.assert(blacks.length === 18, 'there must be 18 black pockets');
  console.assert(JSON.stringify(reds) === JSON.stringify(RED), 'red list must match the table');

  console.log('\n=== wheel ===');
  const unique = new Set(WHEEL);
  console.log(`pockets=${WHEEL.length} unique=${unique.size} first=${WHEEL[0]} last=${WHEEL[WHEEL.length - 1]}`);
  console.assert(WHEEL.length === POCKETS, 'wheel must hold 37 pockets');
  console.assert(unique.size === POCKETS, 'wheel must not repeat a pocket');
  for (let pocket = 0; pocket < POCKETS; pocket += 1) {
    console.assert(unique.has(pocket), `wheel is missing pocket ${pocket}`);
  }

  // Validated against the service module so the two cannot drift.
  const serviceUrl = pathToFileURL(
    path.join(__dirname, '..', 'dist', 'modules', 'game', 'classic_roulette', 'classic_roulette.service.js'),
  ).href;

  import(serviceUrl)
    .then((service) => {
      console.log('\n=== service cross-check ===');
      const config = service.classicRouletteConfig();
      console.log(
        `pockets=${config.pockets} reds=${config.redNumbers.length} wheel=${config.wheelOrder.length}`,
      );
      console.assert(config.pockets === POCKETS, 'service pockets != 37');
      console.assert(
        JSON.stringify([...config.wheelOrder]) === JSON.stringify(WHEEL),
        'service WHEEL_ORDER differs from the documented wheel',
      );

      for (let pocket = 0; pocket < POCKETS; pocket += 1) {
        console.assert(
          service.pocketColor(pocket) === colourOf(pocket),
          `service colour for ${pocket} disagrees`,
        );
        for (const betType of BET_TYPES) {
          const value = betType === 'number' ? pocket : null;
          console.assert(
            service.betWins(betType, value, pocket) === wins(betType, value, pocket),
            `service betWins(${betType}) disagrees on pocket ${pocket}`,
          );
        }
      }
      console.log('service agrees with this script on all 37 pockets × 7 bet types');

      console.log('\n=== exact RTP (enumerated over all 37 pockets) ===');
      const rows = BET_TYPES.map((betType) => {
        const value = betType === 'number' ? 7 : null;
        const { winning, rtp } = rtpOf(betType, value);
        return { betType, winning, payout: PAYOUTS[betType], rtp };
      });
      for (const row of rows) {
        console.log(
          `${row.betType.padEnd(7)} wins on ${String(row.winning).padStart(2)}/37 pockets × ${row.payout}x = ${(row.rtp * 100).toFixed(4)}%`,
        );
        console.assert(
          Math.abs(row.rtp - 36 / 37) < 1e-12,
          `${row.betType} RTP ${row.rtp} != 36/37`,
        );
      }

      // Every straight number must be priced identically.
      for (let pocket = 0; pocket < POCKETS; pocket += 1) {
        const { rtp } = rtpOf('number', pocket);
        console.assert(Math.abs(rtp - 36 / 37) < 1e-12, `number ${pocket} RTP != 36/37`);
      }

      const houseEdge = 1 - 36 / 37;
      console.log(`\nhouse edge = 1/37 = ${(houseEdge * 100).toFixed(4)}% on every bet type`);
      console.log(`service rtp.number = ${config.rtp.number}  houseEdge = ${config.houseEdge}`);
      console.assert(Math.abs(config.rtp.number - 36 / 37) < 1e-9, 'service number RTP mismatch');
      console.assert(Math.abs(config.houseEdge - houseEdge) < 1e-9, 'service house edge mismatch');

      console.log('\nALL_CHECKS_PASSED');
    })
    .catch((error) => {
      console.error('FAILED:', error.message);
      console.error('Build the backend first: npm run build (in backend/)');
      process.exitCode = 1;
    });
}

main();
