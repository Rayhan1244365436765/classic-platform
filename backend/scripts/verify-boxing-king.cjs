/**
 * Boxing King — exact measurement by enumerating all 6⁹ = 10,077,696 boards.
 *
 *   node backend/scripts/verify-boxing-king.cjs
 *
 * Cluster frequency on a 3×3 board is not analytic (shapes overlap and stack), so
 * this walks every board with an independent flood fill, prints the mean number
 * of paying clusters per tier and the hit rate, then compares them with the
 * constants the service prices its RTP against.
 */
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SYMBOLS = 6;
const CELLS = 9;
const TOTAL = SYMBOLS ** CELLS; // 10,077,696

/** Orthogonal neighbours, computed rather than typed, as a cross-check. */
const NEIGHBOURS = [];
for (let cell = 0; cell < CELLS; cell += 1) {
  const row = Math.floor(cell / 3);
  const col = cell % 3;
  const list = [];
  if (row > 0) list.push(cell - 3);
  if (row < 2) list.push(cell + 3);
  if (col > 0) list.push(cell - 1);
  if (col < 2) list.push(cell + 1);
  NEIGHBOURS.push(list);
}

/** Independent cluster finder: returns the sizes of every cluster of 3+. */
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

    if (size >= 3) sizes.push(size);
  }

  return sizes;
}

const grid = new Int8Array(CELLS);
const seen = new Int8Array(CELLS);
const stack = new Int32Array(CELLS + 1);

console.log(`symbols=${SYMBOLS} cells=${CELLS} boards=${TOTAL.toLocaleString('en-US')}`);
console.log('=== enumerating every board ===');

const started = Date.now();
let small = 0; // clusters of 3-4
let medium = 0; // clusters of 5-6
let large = 0; // clusters of 7+
let boardsWithWin = 0;
let maxClusters = 0;
let maxSize = 0;
const sizeHistogram = new Map();

for (let code = 0; code < TOTAL; code += 1) {
  // Odometer increment — cheaper than decoding base-6 digits every time.
  for (let cell = 0; cell < CELLS; cell += 1) {
    grid[cell] += 1;
    if (grid[cell] < SYMBOLS) break;
    grid[cell] = 0;
  }

  const sizes = clusterSizes(grid, seen, stack);

  if (sizes.length > 0) {
    boardsWithWin += 1;
    if (sizes.length > maxClusters) maxClusters = sizes.length;
  }

  for (const size of sizes) {
    if (size >= 7) large += 1;
    else if (size >= 5) medium += 1;
    else small += 1;
    if (size > maxSize) maxSize = size;
    sizeHistogram.set(size, (sizeHistogram.get(size) ?? 0) + 1);
  }
}

const seconds = (Date.now() - started) / 1000;
const mean = (count) => count / TOTAL;

console.log(`done in ${seconds.toFixed(1)}s`);
console.log(`\ncluster size histogram (total clusters):`);
for (const size of [...sizeHistogram.keys()].sort((a, b) => a - b)) {
  console.log(`  size ${String(size).padStart(2)}: ${String(sizeHistogram.get(size)).padStart(10)}`);
}
console.log(`\nE[clusters 3-4] = ${mean(small).toFixed(6)}`);
console.log(`E[clusters 5-6] = ${mean(medium).toFixed(6)}`);
console.log(`E[clusters 7+]  = ${mean(large).toFixed(6)}`);
console.log(`hit rate (>=1 cluster) = ${(boardsWithWin / TOTAL).toFixed(6)}`);
console.log(`max clusters on one board = ${maxClusters}, biggest cluster = ${maxSize}`);

// ---------------------------------------------------------------------------
const serviceUrl = pathToFileURL(
  path.join(__dirname, '..', 'dist', 'modules', 'game', 'boxing_king', 'boxing_king.service.js'),
).href;

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` -> ${detail}`}`);
  if (!ok) failures += 1;
};

import(serviceUrl)
  .then((service) => {
    const config = service.boxingKingConfig();
    const measured = { small: mean(small), medium: mean(medium), large: mean(large) };

    console.log('\n=== baked constants vs measurement ===');
    console.log(
      `service: pays=${JSON.stringify(config.pays)} freq=${JSON.stringify(config.frequency)} hit=${config.hitRate} rtp=${config.rtp}`,
    );
    for (const tier of ['small', 'medium', 'large']) {
      check(
        `baked ${tier} frequency = measured`,
        Math.abs(config.frequency[tier] - measured[tier]) < 1e-6,
        `${config.frequency[tier]} vs ${measured[tier]}`,
      );
    }
    check(
      'baked hit rate = measured',
      Math.abs(config.hitRate - boardsWithWin / TOTAL) < 1e-6,
      `${config.hitRate} vs ${boardsWithWin / TOTAL}`,
    );

    const rtpMeasured =
      config.pays.small * measured.small +
      config.pays.medium * measured.medium +
      config.pays.large * measured.large;
    console.log(`\nRTP from the measured board: ${(rtpMeasured * 100).toFixed(4)}%`);
    console.log(
      `(the brief's 2/5/15 table would return ${((2 * measured.small + 5 * measured.medium + 15 * measured.large) * 100).toFixed(2)}%)`,
    );
    check('RTP is 97.42%', Math.abs(rtpMeasured - 0.974219) < 1e-4, rtpMeasured);
    check('RTP sits in the 95-98% band', rtpMeasured > 0.95 && rtpMeasured < 0.98, rtpMeasured);
    // The baked frequencies are rounded to 6 dp, so ~1e-5 is the expected gap.
    check('service RTP equals measured RTP', Math.abs(config.rtp - rtpMeasured) < 5e-5, config.rtp);
    check(
      'pays rise with cluster size',
      config.pays.small < config.pays.medium && config.pays.medium < config.pays.large,
      JSON.stringify(config.pays),
    );
    check('hit rate is ~38%', Math.abs(config.hitRate - 0.378676) < 1e-6, config.hitRate);

    console.log('\n=== unit shapes ===');
    const S = service.BOXING_SYMBOLS;
    const board = (text) => text.split('').map((index) => S[Number(index)]);
    const shapes = [
      ['row of three (0,1,2)', board('000123453'), [3]],
      ['L shape (0,1,3)', board('001023452'), [3]],
      ['diagonal (0,4,8) only', board('012123450'), []],
      ['two separate rows', board('000234111'), [3, 3]],
      ['plus shape (1,3,4,5,7)', board('010111010'), [5]],
      ['pair only (0,1)', board('001534253'), []],
      ['whole board', board('000000000'), [9]],
    ];
    for (const [label, grid, expected] of shapes) {
      const sizes = service.findClusters(grid).map((c) => c.size);
      if (expected === null) {
        console.log(`  INFO  ${label}: ${sizes.join(',') || 'none'}`);
        continue;
      }
      check(
        `${label} -> [${expected.join(',')}]`,
        JSON.stringify(sizes) === JSON.stringify(expected),
        sizes.join(',') || 'none',
      );
    }

    console.log('\n=== findClusters vs the independent finder (20k boards) ===');
    let mismatches = 0;
    let clustersSeen = 0;
    const scratch = new Int8Array(CELLS);
    for (let trial = 0; trial < 20000; trial += 1) {
      const codes = Array.from({ length: CELLS }, () => Math.floor(Math.random() * SYMBOLS));
      const want = clusterSizes(Int8Array.from(codes), seen, stack).sort((a, b) => a - b);
      const got = service.findClusters(codes.map((code) => S[code]));

      if (JSON.stringify(want) !== JSON.stringify(got.map((c) => c.size).sort((a, b) => a - b))) {
        mismatches += 1;
        continue;
      }

      for (const cluster of got) {
        clustersSeen += 1;
        const expectPay =
          cluster.size >= 7 ? config.pays.large : cluster.size >= 5 ? config.pays.medium : config.pays.small;
        if (cluster.pay !== expectPay) mismatches += 1;
        // all cells share the symbol, are distinct, and are connected to each other
        if (new Set(cluster.cells).size !== cluster.size) mismatches += 1;
        if (cluster.cells.some((cell) => codes[cell] !== codes[cluster.cells[0]])) mismatches += 1;
        scratch.fill(0);
        const local = [cluster.cells[0]];
        scratch[cluster.cells[0]] = 1;
        let reached = 1;
        while (local.length > 0) {
          const cell = local.pop();
          for (const next of NEIGHBOURS[cell]) {
            if (cluster.cells.includes(next) && scratch[next] === 0) {
              scratch[next] = 1;
              reached += 1;
              local.push(next);
            }
          }
        }
        if (reached !== cluster.size) mismatches += 1;
      }
    }
    console.log(`clusters inspected: ${clustersSeen}`);
    check('service finder matches on every board', mismatches === 0, mismatches);

    console.log(failures === 0 ? '\nALL_CHECKS_PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exitCode = failures === 0 ? 0 : 1;
  })
  .catch((error) => {
    console.error('FAILED:', error.message);
    console.error('Build the backend first: npm run build (in backend/)');
    process.exitCode = 1;
  });
