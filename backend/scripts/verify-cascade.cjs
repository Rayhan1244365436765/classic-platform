// Cascade (cluster-pays) slot: paytable design + RTP measurement.
// Run: node scripts/verify-cascade.cjs [rounds]
//
// 5×4 grid, 8 symbols. A "cluster" is 3+ orthogonally adjacent matching symbols.
// Winning cells are removed, everything above drops, the top is refilled, and the
// cascade multiplier doubles each step: 1×, 2×, 4×, 8×, 16× (max 5 cascades).
const COLS = 5;
const ROWS = 4;
const CELLS = COLS * ROWS;
const MAX_CASCADES = 5;
const MULTIPLIERS = [1, 2, 4, 8, 16];

const SYMBOLS = [
  // Wild West tiering: low → mid → high, rarer as they get richer.
  { id: 'WHISKEY', weight: 26 },
  { id: 'HAT', weight: 24 },
  { id: 'GUN', weight: 22 },
  { id: 'HORSE', weight: 13 },
  { id: 'BADGE', weight: 11 },
  { id: 'DYNAMITE', weight: 8 },
  { id: 'FIRE', weight: 6 },
];

// Pay per cluster, as a multiple of the bet, indexed by [size 3,4,5,6,7,8+].
// Re-tuned for the 7-symbol pool (fewer symbols ⇒ more clusters ⇒ smaller pays).
const BASE_PAYS = {
  WHISKEY: [0.06, 0.12, 0.25, 0.47, 0.82, 1.4],
  HAT: [0.07, 0.15, 0.3, 0.59, 1.07, 1.75],
  GUN: [0.09, 0.19, 0.37, 0.72, 1.28, 2.13],
  HORSE: [0.12, 0.25, 0.47, 0.94, 1.63, 2.57],
  BADGE: [0.16, 0.31, 0.59, 1.19, 2.13, 3.51],
  DYNAMITE: [0.34, 0.72, 1.4, 2.82, 4.69, 7.64],
  FIRE: [0.59, 1.19, 2.35, 4.69, 8.2, 14.08],
};

const SCALE = Number(process.env.SCALE ?? 1);

function payFor(symbol, size) {
  const row = BASE_PAYS[symbol];
  const index = Math.min(size, 8) - 3;
  return Math.round(row[index] * SCALE * 10000) / 10000;
}

// --- deterministic PRNG (mulberry32) ---------------------------------------
let seed = Number(process.env.SEED ?? 20260515);
function random() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const TOTAL_WEIGHT = SYMBOLS.reduce((sum, symbol) => sum + symbol.weight, 0);

function randomSymbol() {
  let roll = random() * TOTAL_WEIGHT;
  for (const symbol of SYMBOLS) {
    roll -= symbol.weight;
    if (roll < 0) return symbol.id;
  }
  return SYMBOLS[SYMBOLS.length - 1].id;
}

// --- clusters ---------------------------------------------------------------
function findClusters(grid) {
  const seen = new Array(CELLS).fill(false);
  const clusters = [];

  for (let start = 0; start < CELLS; start += 1) {
    if (seen[start]) continue;

    const symbol = grid[start];
    const stack = [start];
    const cells = [];
    seen[start] = true;

    while (stack.length > 0) {
      const cell = stack.pop();
      cells.push(cell);

      const col = cell % COLS;
      const row = (cell - col) / COLS;

      const neighbours = [];
      if (col > 0) neighbours.push(cell - 1);
      if (col < COLS - 1) neighbours.push(cell + 1);
      if (row > 0) neighbours.push(cell - COLS);
      if (row < ROWS - 1) neighbours.push(cell + COLS);

      for (const next of neighbours) {
        if (!seen[next] && grid[next] === symbol) {
          seen[next] = true;
          stack.push(next);
        }
      }
    }

    if (cells.length >= 3) clusters.push({ symbol, cells });
  }

  return clusters;
}

/** Remove the winning cells, drop the rest, refill from the top. */
function collapse(grid, removedCells) {
  const next = [...grid];
  for (const cell of removedCells) next[cell] = null;

  for (let col = 0; col < COLS; col += 1) {
    const survivors = [];
    for (let row = ROWS - 1; row >= 0; row -= 1) {
      const value = next[row * COLS + col];
      if (value !== null) survivors.push(value);
    }

    for (let row = ROWS - 1; row >= 0; row -= 1) {
      const index = ROWS - 1 - row;
      next[row * COLS + col] = index < survivors.length ? survivors[index] : randomSymbol();
    }
  }

  return next;
}

// --- one round --------------------------------------------------------------
function playRound() {
  let grid = Array.from({ length: CELLS }, () => randomSymbol());
  let totalWin = 0;
  let cascades = 0;
  let maxMultiplier = 1;

  for (let step = 0; step < MAX_CASCADES; step += 1) {
    const clusters = findClusters(grid);
    if (clusters.length === 0) break;

    const multiplier = MULTIPLIERS[step];
    maxMultiplier = multiplier;

    let stepWin = 0;
    const removed = new Set();
    for (const cluster of clusters) {
      stepWin += payFor(cluster.symbol, cluster.cells.length) * multiplier;
      for (const cell of cluster.cells) removed.add(cell);
    }

    totalWin += stepWin;
    cascades += 1;
    grid = collapse(grid, [...removed]);
  }

  return { totalWin, cascades, maxMultiplier, grid };
}

// --- run --------------------------------------------------------------------
const rounds = Number(process.argv[2] ?? 500000);
let sumWin = 0;
let hits = 0;
let totalCascades = 0;
let maxWin = 0;
const cascadeHistogram = new Map();
const multiplierHistogram = new Map();

const started = Date.now();

for (let round = 0; round < rounds; round += 1) {
  const result = playRound();
  sumWin += result.totalWin;
  if (result.totalWin > 0) hits += 1;
  totalCascades += result.cascades;
  if (result.totalWin > maxWin) maxWin = result.totalWin;

  cascadeHistogram.set(result.cascades, (cascadeHistogram.get(result.cascades) ?? 0) + 1);
  multiplierHistogram.set(
    result.maxMultiplier,
    (multiplierHistogram.get(result.maxMultiplier) ?? 0) + 1,
  );
}

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
const rtp = sumWin / rounds;

console.log(`scale ${SCALE} · rounds ${rounds.toLocaleString('en-US')} · ${elapsed}s`);
console.log(`RTP ${(rtp * 100).toFixed(2)}%  ·  hit rate ${((hits / rounds) * 100).toFixed(2)}%`);
console.log(`avg cascades ${(totalCascades / rounds).toFixed(3)}  ·  max win ${maxWin.toFixed(2)}× bet`);
console.log(
  `cascades: ${[...cascadeHistogram.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([depth, count]) => `${depth}:${((count / rounds) * 100).toFixed(2)}%`)
    .join('  ')}`,
);
console.log(
  `max multiplier reached: ${[...multiplierHistogram.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([mult, count]) => `${mult}x:${((count / rounds) * 100).toFixed(2)}%`)
    .join('  ')}`,
);

// --- suggest a scaled paytable ---------------------------------------------
const target = Number(process.env.TARGET ?? 0.965);
const factor = target / rtp;
console.log(`\nto hit ${(target * 100).toFixed(1)}% multiply every pay by ${factor.toFixed(4)}`);

console.log('\nrounded paytable at that scale (bet multiples, sizes 3,4,5,6,7,8+):');
for (const symbol of SYMBOLS) {
  const row = BASE_PAYS[symbol.id].map((pay) => Math.max(0.02, Math.round(pay * factor * 100) / 100));
  console.log(`  ${symbol.id.padEnd(6)} [${row.map((pay) => pay.toFixed(2)).join(', ')}]`);
}
