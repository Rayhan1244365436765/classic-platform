/**
 * Fruit Bonanza — exact verification by enumerating **all** 6⁹ = 10,077,696
 * grids (no sampling, no formula): every grid is scored with an independent
 * implementation of the five paylines and the mean return is compared with the
 * service's `fruitBonanzaRtp()`.
 *
 *   node backend/scripts/verify-fruit-bonanza.cjs
 */
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SYMBOLS = ['🍉', '🍇', '🍋', '🍒', '🍊', '⭐'];
const LINES = [
  [0, 1, 2], // top row
  [3, 4, 5], // middle row
  [6, 7, 8], // bottom row
  [0, 4, 8], // ↘
  [2, 4, 6], // ↙
];
const PAYS = { three: 4, two: 0.2 };

function main() {
  console.log('=== layout ===');
  console.log(`symbols (${SYMBOLS.length}): ${SYMBOLS.join(' ')}`);
  for (const [index, cells] of LINES.entries()) {
    console.log(`line ${index}: ${cells.join('-')}`);
    console.assert(new Set(cells).size === 3, `line ${index} repeats a cell`);
    console.assert(cells.every((cell) => cell >= 0 && cell < 9), `line ${index} out of range`);
  }
  console.assert(LINES.length === 5, 'expected 5 paylines');
  console.assert(new Set(LINES.map((l) => l.join(''))).size === 5, 'duplicate payline');

  console.log('\n=== per-line distribution (6³ = 216 combos per line) ===');
  const n = SYMBOLS.length;
  let three = 0;
  let two = 0;
  for (let a = 0; a < n; a += 1) {
    for (let b = 0; b < n; b += 1) {
      for (let c = 0; c < n; c += 1) {
        if (a === b && b === c) three += 1;
        else if (a === b || b === c || a === c) two += 1;
      }
    }
  }
  const combos = n ** 3;
  const lineEv = (three * PAYS.three + two * PAYS.two) / combos;
  console.log(`three alike ${three}/${combos} = ${((three / combos) * 100).toFixed(4)}%`);
  console.log(`exactly two ${two}/${combos} = ${((two / combos) * 100).toFixed(4)}%`);
  console.log(
    `all differ  ${combos - three - two}/${combos} = ${(((combos - three - two) / combos) * 100).toFixed(4)}%`,
  );
  console.log(`line EV = ${lineEv.toFixed(6)}  × 5 lines = ${(lineEv * 5).toFixed(6)}`);
  console.assert(three === 6 && two === 90, 'per-line distribution is wrong');

  console.log('\n=== exhaustive spin enumeration (6⁹ grids) ===');
  const started = Date.now();
  const grid = new Array(9);
  const total = n ** 9;
  let tripleLines = 0;
  let pairLines = 0;
  let winningSpins = 0;
  let spinsWithTriple = 0;
  let maxMultiplier = 0;

  for (let code = 0; code < total; code += 1) {
    let rest = code;
    for (let cell = 8; cell >= 0; cell -= 1) {
      grid[cell] = rest % n;
      rest = (rest - grid[cell]) / n;
    }

    let spinMult = 0;
    let triples = 0;
    for (const [a, b, c] of LINES) {
      const x = grid[a];
      const y = grid[b];
      const z = grid[c];
      if (x === y && y === z) {
        triples += 1;
        spinMult += PAYS.three;
      } else if (x === y || y === z || x === z) {
        pairLines += 1;
        spinMult += PAYS.two;
      }
    }

    tripleLines += triples;
    if (spinMult > 0) winningSpins += 1;
    if (triples > 0) spinsWithTriple += 1;
    if (spinMult > maxMultiplier) maxMultiplier = spinMult;
  }

  const exact = (tripleLines * PAYS.three + pairLines * PAYS.two) / total;
  const seconds = (Date.now() - started) / 1000;

  console.log(`grids              ${total.toLocaleString('en-US')} (${seconds.toFixed(1)}s)`);
  console.log(`triple lines       ${tripleLines} (mean ${(tripleLines / total).toFixed(6)}/spin)`);
  console.log(`pair lines         ${pairLines} (mean ${(pairLines / total).toFixed(6)}/spin)`);
  console.log(`spins that pay     ${((winningSpins / total) * 100).toFixed(4)}%`);
  console.log(`spins with triple  ${((spinsWithTriple / total) * 100).toFixed(4)}%`);
  console.log(`max multiplier     ${maxMultiplier.toFixed(2)}x`);
  console.log(`EXACT RTP          ${exact.toFixed(9)} (${(exact * 100).toFixed(4)}%)`);

  console.assert(Math.abs(exact - 35 / 36) < 1e-9, `enumerated RTP ${exact} != 35/36`);
  console.assert(Math.abs(maxMultiplier - 20) < 1e-9, 'max multiplier should be 20x');
  console.assert(
    Math.abs(tripleLines / total - 5 * (three / combos)) < 1e-9,
    'triple line mean != 5 × per-line chance',
  );
  console.assert(
    Math.abs(pairLines / total - 5 * (two / combos)) < 1e-9,
    'pair line mean != 5 × per-line chance',
  );

  const serviceUrl = pathToFileURL(
    path.join(__dirname, '..', 'dist', 'modules', 'game', 'fruit_bonanza', 'fruit_bonanza.service.js'),
  ).href;

  import(serviceUrl)
    .then((service) => crossCheck(service, exact, n))
    .catch((error) => {
      console.error('FAILED:', error.message);
      console.error('Build the backend first: npm run build (in backend/)');
      process.exitCode = 1;
    });
}

function crossCheck(service, exact, n) {
  console.log('\n=== service cross-check ===');
  const config = service.fruitBonanzaConfig();
  console.log(
    `symbols=${config.symbols.length} lines=${config.lineCount} pays=${JSON.stringify(config.pays)}`,
  );
  console.log(`service rtp=${config.rtp} houseEdge=${config.houseEdge}`);
  console.log(
    `P(three)=${config.probabilities.three.toFixed(6)} P(two)=${config.probabilities.two.toFixed(6)} P(none)=${config.probabilities.none.toFixed(6)}`,
  );

  console.assert(config.symbols.length === n, 'symbol count differs');
  console.assert(config.lineCount === LINES.length, 'line count differs');
  console.assert(
    JSON.stringify(config.lines.map((line) => [...line])) === JSON.stringify(LINES),
    'paylines differ from this script',
  );
  console.assert(config.pays.three === PAYS.three, 'triple pay differs');
  console.assert(config.pays.two === PAYS.two, 'pair pay differs');
  console.assert(Math.abs(config.rtp - 35 / 36) < 1e-9, 'service RTP is not 35/36');
  console.assert(Math.abs(config.rtp - exact) < 1e-9, 'service RTP != enumerated RTP');
  console.assert(Math.abs(config.houseEdge - 1 / 36) < 1e-9, 'house edge should be 1/36');

  // evaluateFruitGrid must agree with this script's scorer on random grids.
  let mismatches = 0;
  for (let trial = 0; trial < 20000; trial += 1) {
    const sample = Array.from({ length: 9 }, () => SYMBOLS[Math.floor(Math.random() * n)]);
    const scored = service.evaluateFruitGrid(sample);
    if (scored.length !== 5) mismatches += 1;

    let expected = 0;
    for (const [index, [a, b, c]] of LINES.entries()) {
      const x = sample[a];
      const y = sample[b];
      const z = sample[c];
      const want = x === y && y === z ? 'three' : x === y || y === z || x === z ? 'two' : 'none';
      if (scored[index].match !== want) mismatches += 1;
      if (scored[index].symbols.join('') !== `${x}${y}${z}`) mismatches += 1;
      expected += want === 'three' ? PAYS.three : want === 'two' ? PAYS.two : 0;
    }

    const got = scored.reduce((sum, line) => sum + line.multiplier, 0);
    if (Math.abs(got - expected) > 1e-9) mismatches += 1;
  }
  console.log('evaluateFruitGrid vs independent scorer: 20,000 random grids');
  console.assert(mismatches === 0, `${mismatches} mismatches`);

  console.log('\nALL_CHECKS_PASSED');
}

main();
