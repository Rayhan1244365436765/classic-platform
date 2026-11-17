// Cluster / collapse unit checks **and** an RTP re-measurement, both through the
// service's own exported functions (so the tuned numbers are verifiably shipped).
// Run: node scripts/verify-cascade-service.mjs [rounds]
const service = await import('../dist/modules/game/cascade/cascade.service.js');

const { findClusters, collapseGrid, clusterPay, CASCADE_MULTIPLIERS, MAX_CASCADES, GRID_CELLS } =
  service;

const assert = (condition, message) => {
  if (!condition) {
    console.error(`FAILED: ${message}`);
    process.exit(1);
  }
};

// --- 1. cluster detection --------------------------------------------------
const row = (values) => values.flat();

// A single horizontal 3-run of WHISKEY at cells 0,1,2.
const gridA = row([
  ['WHISKEY', 'WHISKEY', 'WHISKEY', 'HAT', 'GUN'],
  ['HAT', 'GUN', 'HORSE', 'BADGE', 'HAT'],
  ['GUN', 'HORSE', 'BADGE', 'HAT', 'GUN'],
  ['HORSE', 'BADGE', 'HAT', 'GUN', 'HORSE'],
]);
let clusters = findClusters(gridA);
assert(clusters.length === 1, `gridA should hold 1 cluster, got ${clusters.length}`);
assert(clusters[0].symbol === 'WHISKEY', 'gridA cluster symbol');
assert(clusters[0].cells.join(',') === '0,1,2', `gridA cells ${clusters[0].cells.join(',')}`);

// An L of WHISKEY: 0,1 across the top plus 0,5,10 down the left column → one 4-cell cluster.
const gridB = row([
  ['WHISKEY', 'WHISKEY', 'HORSE', 'GUN', 'HAT'],
  ['WHISKEY', 'BADGE', 'GUN', 'HAT', 'HORSE'],
  ['WHISKEY', 'HORSE', 'HAT', 'GUN', 'BADGE'],
  ['HORSE', 'BADGE', 'GUN', 'HAT', 'HORSE'],
]);
clusters = findClusters(gridB);
assert(clusters.length === 1, `gridB should hold 1 cluster, got ${clusters.length}`);
assert(clusters[0].cells.length === 4, `gridB cluster size ${clusters[0].cells.length} != 4`);
assert(clusters[0].cells.join(',') === '0,1,5,10', `gridB cells ${clusters[0].cells.join(',')}`);

// Two disjoint pairs — below the 3 minimum.
const gridC = row([
  ['WHISKEY', 'WHISKEY', 'HAT', 'HAT', 'GUN'],
  ['GUN', 'HAT', 'BADGE', 'HORSE', 'HAT'],
  ['HORSE', 'GUN', 'WHISKEY', 'BADGE', 'GUN'],
  ['BADGE', 'HAT', 'HORSE', 'GUN', 'HORSE'],
]);
assert(findClusters(gridC).length === 0, 'gridC should hold no cluster');

// Diagonals must not connect.
const gridD = row([
  ['WHISKEY', 'HAT', 'GUN', 'HORSE', 'BADGE'],
  ['HAT', 'WHISKEY', 'GUN', 'HORSE', 'BADGE'],
  ['GUN', 'HORSE', 'WHISKEY', 'BADGE', 'HAT'],
  ['HORSE', 'BADGE', 'HAT', 'GUN', 'HORSE'],
]);
assert(findClusters(gridD).length === 0, 'diagonals must not form a cluster');

// --- 2. collapse ------------------------------------------------------------
const collapsed = collapseGrid(gridA, [0, 1, 2], () => 'DYNAMITE');
const expected = row([
  ['DYNAMITE', 'DYNAMITE', 'DYNAMITE', 'HAT', 'GUN'],
  ['HAT', 'GUN', 'HORSE', 'BADGE', 'HAT'],
  ['GUN', 'HORSE', 'BADGE', 'HAT', 'GUN'],
  ['HORSE', 'BADGE', 'HAT', 'GUN', 'HORSE'],
]);
assert(
  collapsed.join(',') === expected.join(','),
  `collapse produced ${collapsed.join(',')} (expected ${expected.join(',')})`,
);
assert(collapsed.length === GRID_CELLS, 'collapse must keep 20 cells');

// Clearing a whole column refills it entirely.
const emptyColumn = collapseGrid(gridA, [3, 8, 13, 18], () => 'FIRE');
assert(
  [3, 8, 13, 18].every((cell) => emptyColumn[cell] === 'FIRE'),
  'a cleared column must be refilled completely',
);

// --- 3. pay table ----------------------------------------------------------
assert(clusterPay('WHISKEY', 3) === 0.06, `whiskey×3 pays ${clusterPay('WHISKEY', 3)}`);
assert(clusterPay('FIRE', 8) === 14.08, `fire×8 pays ${clusterPay('FIRE', 8)}`);
assert(clusterPay('FIRE', 12) === 14.08, 'clusters above 8 pay the 8+ rate');
assert(
  clusterPay('WHISKEY', 5) < clusterPay('HAT', 5) &&
    clusterPay('HAT', 5) < clusterPay('GUN', 5) &&
    clusterPay('GUN', 5) < clusterPay('HORSE', 5) &&
    clusterPay('HORSE', 5) < clusterPay('BADGE', 5) &&
    clusterPay('BADGE', 5) < clusterPay('DYNAMITE', 5) &&
    clusterPay('DYNAMITE', 5) < clusterPay('FIRE', 5),
  'the ladder must rise from whiskey to fire',
);

// --- 4. RTP through the shipped functions -----------------------------------
let seed = 987654321;
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 2 ** 32;
  return seed / 2 ** 32;
};

const SYMBOLS = [
  ['WHISKEY', 26],
  ['HAT', 24],
  ['GUN', 22],
  ['HORSE', 13],
  ['BADGE', 11],
  ['DYNAMITE', 8],
  ['FIRE', 6],
];
const TOTAL = SYMBOLS.reduce((sum, [, weight]) => sum + weight, 0);

const nextSymbol = () => {
  let roll = random() * TOTAL;
  for (const [id, weight] of SYMBOLS) {
    roll -= weight;
    if (roll < 0) return id;
  }
  return 'BADGE';
};

const rounds = Number(process.argv[2] ?? 500000);
let sumWin = 0;
let hits = 0;
let cascades = 0;
let maxWin = 0;

for (let round = 0; round < rounds; round += 1) {
  let grid = Array.from({ length: GRID_CELLS }, () => nextSymbol());
  let totalWin = 0;

  for (let step = 0; step < MAX_CASCADES; step += 1) {
    const found = findClusters(grid);
    if (found.length === 0) break;

    const multiplier = CASCADE_MULTIPLIERS[step];
    const removed = new Set();

    for (const cluster of found) {
      totalWin += clusterPay(cluster.symbol, cluster.cells.length) * multiplier;
      for (const cell of cluster.cells) removed.add(cell);
    }

    cascades += 1;
    grid = collapseGrid(grid, [...removed], nextSymbol);
  }

  sumWin += totalWin;
  if (totalWin > 0) hits += 1;
  if (totalWin > maxWin) maxWin = totalWin;
}

const rtp = sumWin / rounds;
console.log('structural checks: cluster detection, collapse, pay table → OK');
console.log(`rounds ${rounds.toLocaleString('en-US')}`);
console.log(`RTP ${(rtp * 100).toFixed(2)}%  (header claims 95.72%)`);
console.log(`hit rate ${((hits / rounds) * 100).toFixed(2)}%  ·  avg cascades ${(cascades / rounds).toFixed(3)}`);
console.log(`max win ${maxWin.toFixed(2)}× bet`);
assert(rtp > 0.93 && rtp < 0.99, `RTP ${(rtp * 100).toFixed(2)}% is outside the expected band`);
console.log('ALL_CHECKS_PASSED');
