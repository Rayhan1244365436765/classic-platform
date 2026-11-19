/**
 * Fortune Gems — cluster-frequency + RTP measurement.
 *
 *   node backend/scripts/verify-fortune-gems.cjs [samples]
 *
 * A 4×3 board has 8¹² = 68,719,476,736 possible grids, so unlike Boxing King
 * (6⁹) this cannot enumerate every board. It samples instead — with a
 * deterministic PRNG, an independent flood fill, and enough draws that the
 * standard error on the hit rate is below 0.01 pp — then prints the mean number
 * of paying clusters per tier and the RTP of both the brief's paytable and the
 * shipped one.
 *
 * `frequency` in the service is baked from this run, so the constants there and
 * the numbers here must agree; the script also imports the built service and
 * checks that they do.
 */
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SYMBOLS = 8;
const COLS = 4;
const ROWS = 3;
const CELLS = COLS * ROWS; // 12
const TOTAL = SYMBOLS ** CELLS; // 68,719,476,736

/** Orthogonal neighbours, computed rather than typed (same rule as the service). */
const NEIGHBOURS = [];
for (let cell = 0; cell < CELLS; cell += 1) {
  const row = Math.floor(cell / COLS);
  const col = cell % COLS;
  const list = [];
  if (row > 0) list.push(cell - COLS);
  if (row < ROWS - 1) list.push(cell + COLS);
  if (col > 0) list.push(cell - 1);
  if (col < COLS - 1) list.push(cell + 1);
  NEIGHBOURS.push(list);
}

/** Independent cluster finder: sizes of every 4+ orthogonal group. */
function clusterSizes(grid, seen, stack) {
  const sizes = [];
  seen.fill(0);

  for (let start = 0; start < CELLS; start += 1) {
    if (seen[start] === 1) continue;

    const symbol = grid[start];
    let top = 0;
    let size = 0;
    stack[top++] = start;
    seen[start] = 1;

    while (top > 0) {
      const cell = stack[--top];
      size += 1;

      for (const next of NEIGHBOURS[cell]) {
        if (seen[next] === 0 && grid[next] === symbol) {
          seen[next] = 1;
          stack[top++] = next;
        }
      }
    }

    if (size >= 4) sizes.push(size);
  }

  return sizes;
}

/** mulberry32 — deterministic so two runs of this script agree exactly. */
function makeRandom(seed) {
  let a = seed >>> 0;
  return function random() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const samples = Number(process.argv[2] ?? 4_000_000);

const grid = new Int8Array(CELLS);
const seen = new Int8Array(CELLS);
const stack = new Int32Array(CELLS + 1);
const random = makeRandom(0x9e3779b9);

console.log(
  `symbols=${SYMBOLS} cells=${COLS}x${ROWS}=${CELLS} boards=${TOTAL.toLocaleString('en-US')}`,
);
console.log(`=== sampling ${samples.toLocaleString('en-US')} boards ===`);

const started = Date.now();
let small = 0; // clusters of 4-5
let medium = 0; // clusters of 6-7
let large = 0; // clusters of 8-9
let huge = 0; // clusters of 10+
let boardsWithWin = 0;
let maxClusters = 0;
let maxSize = 0;
const sizeHistogram = new Map();

for (let draw = 0; draw < samples; draw += 1) {
  for (let cell = 0; cell < CELLS; cell += 1) {
    grid[cell] = (random() * SYMBOLS) | 0;
  }

  const sizes = clusterSizes(grid, seen, stack);

  if (sizes.length > 0) {
    boardsWithWin += 1;
    if (sizes.length > maxClusters) maxClusters = sizes.length;
  }

  for (const size of sizes) {
    if (size >= 10) huge += 1;
    else if (size >= 8) large += 1;
    else if (size >= 6) medium += 1;
    else small += 1;
    if (size > maxSize) maxSize = size;
    sizeHistogram.set(size, (sizeHistogram.get(size) ?? 0) + 1);
  }
}

const seconds = (Date.now() - started) / 1000;
const mean = (count) => count / samples;

const frequency = {
  small: mean(small),
  medium: mean(medium),
  large: mean(large),
  huge: mean(huge),
};
const hitRate = boardsWithWin / samples;
const standardError = Math.sqrt((hitRate * (1 - hitRate)) / samples);

console.log(`done in ${seconds.toFixed(1)}s`);
console.log('\ncluster size histogram (total clusters):');
for (const size of [...sizeHistogram.keys()].sort((a, b) => a - b)) {
  console.log(`  size ${String(size).padStart(2)}: ${String(sizeHistogram.get(size)).padStart(10)}`);
}
console.log(`\nE[clusters 4-5]  = ${frequency.small.toFixed(6)}`);
console.log(`E[clusters 6-7]  = ${frequency.medium.toFixed(6)}`);
console.log(`E[clusters 8-9]  = ${frequency.large.toFixed(6)}`);
console.log(`E[clusters 10+]  = ${frequency.huge.toFixed(6)}`);
console.log(
  `hit rate (>=1 cluster) = ${hitRate.toFixed(6)}  (±${(standardError * 100).toFixed(3)} pp)`,
);
console.log(`max clusters on one board = ${maxClusters}, biggest cluster = ${maxSize}`);

/** RTP of a paytable: sum of tier frequency × payoff. */
function rtpOf(pays, table = frequency) {
  return (
    pays.small * table.small +
    pays.medium * table.medium +
    pays.large * table.large +
    pays.huge * table.huge
  );
}

const BRIEF = { small: 2, medium: 5, large: 15, huge: 50 };
const briefRtp = rtpOf(BRIEF);
const target = 0.97;
const scale = target / briefRtp;

console.log(`\nRTP of the brief's paytable (2/5/15/50) = ${(briefRtp * 100).toFixed(2)}%`);
console.log(`scale needed on every payoff to reach 97% = ${scale.toFixed(2)}x`);
console.log(
  `scaled table = ${BRIEF.small * scale}/${BRIEF.medium * scale}/` +
    `${BRIEF.large * scale}/${BRIEF.huge * scale}`,
);

for (const candidate of [
  { name: 'A 24/60/180/600', pays: { small: 24, medium: 60, large: 180, huge: 600 } },
  { name: 'B 20/50/150/500', pays: { small: 20, medium: 50, large: 150, huge: 500 } },
  { name: 'C 22/55/165/550', pays: { small: 22, medium: 55, large: 165, huge: 550 } },
  { name: 'D 18/45/135/450', pays: { small: 18, medium: 45, large: 135, huge: 450 } },
  { name: 'E 26/65/195/650', pays: { small: 26, medium: 65, large: 195, huge: 650 } },
]) {
  console.log(`RTP of candidate ${candidate.name} = ${(rtpOf(candidate.pays) * 100).toFixed(2)}%`);
}

// ---------------------------------------------------------------------------
// Compare with the built service, when dist exists.
const serviceUrl = pathToFileURL(
  path.join(__dirname, '..', 'dist', 'modules', 'game', 'fortune_gems', 'fortune_gems.service.js'),
).href;

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` -> ${detail}`}`);
  if (!ok) failures += 1;
};

import(serviceUrl)
  .then((service) => {
    const config = service.fortuneGemsConfig();
    console.log('\n=== shipped service vs this measurement ===');

    check(
      'small frequency',
      Math.abs(config.frequency.small - frequency.small) < 5e-4,
      `${config.frequency.small} vs ${frequency.small.toFixed(6)}`,
    );
    check(
      'medium frequency',
      Math.abs(config.frequency.medium - frequency.medium) < 1e-4,
      `${config.frequency.medium} vs ${frequency.medium.toFixed(6)}`,
    );
    check(
      'large frequency',
      Math.abs(config.frequency.large - frequency.large) < 1e-5,
      `${config.frequency.large} vs ${frequency.large.toFixed(6)}`,
    );
    check(
      'huge frequency',
      Math.abs(config.frequency.huge - frequency.huge) < 1e-6,
      `${config.frequency.huge} vs ${frequency.huge.toFixed(6)}`,
    );
    check(
      'paytable is monotonic',
      config.pays.small < config.pays.medium &&
        config.pays.medium < config.pays.large &&
        config.pays.large < config.pays.huge,
      JSON.stringify(config.pays),
    );
    check(
      'config RTP equals its own pays x frequency',
      Math.abs(config.rtp - rtpOf(config.pays, config.frequency)) < 1e-12,
      `${config.rtp} vs ${rtpOf(config.pays, config.frequency).toFixed(9)}`,
    );
    check(
      'RTP within the platform band 96-98%',
      config.rtp > 0.96 && config.rtp < 0.98,
      `${(config.rtp * 100).toFixed(2)}%`,
    );

    console.log(
      failures === 0
        ? `\nOK - RTP ${(config.rtp * 100).toFixed(2)}%, hit rate ${(config.hitRate * 100).toFixed(2)}%`
        : `\n${failures} check(s) failed`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.log(`\n(service not built yet: ${error.code ?? error.message})`);
  });
