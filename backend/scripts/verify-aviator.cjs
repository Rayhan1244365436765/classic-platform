// Aviator crash-point maths (run: node scripts/verify-aviator.cjs)
const svc = require('../dist/modules/game/aviator/aviator.service.js');

console.log('tau(ms)  :', svc.GROWTH_TAU_MS, '| cap:', svc.CRASH_CAP, '| min cashout:', svc.MIN_CASHOUT);

// Analytic: P(crash >= m) = 0.95 / m  ⇒  EV = P·m − 1 = −0.05
for (const m of [1.01, 1.5, 2, 5, 10, 50]) {
  const p = 0.95 / m;
  console.log(
    `cash@${String(m).padEnd(5)} P(win)=${p.toFixed(4)}  RTP=${(p * m * 100).toFixed(2)}%  edge=${((1 - p * m) * 100).toFixed(2)}%`,
  );
}

// Empirical: sweep uniform rolls through the real crash-point function.
const N = 2_000_000;
const rolls = [];
for (let i = 0; i < N; i += 1) {
  rolls.push(svc.computeCrashPoint(((i + 0.5) / N) * 100));
}

const buckets = { atOne: 0, under2: 0, over2: 0, over5: 0, over10: 0, capped: 0 };
for (const c of rolls) {
  if (c === 1) buckets.atOne += 1;
  if (c < 2) buckets.under2 += 1;
  if (c > 2) buckets.over2 += 1;
  if (c > 5) buckets.over5 += 1;
  if (c > 10) buckets.over10 += 1;
  if (c === svc.CRASH_CAP) buckets.capped += 1;
}

console.log('empirical: P(crash=1.00)=', (buckets.atOne / N).toFixed(4), '(expect 0.0500)');
console.log('           P(crash>2.00)=', (buckets.over2 / N).toFixed(4), '(expect 0.4750)');
console.log('           P(crash>5.00)=', (buckets.over5 / N).toFixed(4), '(expect 0.1900)');
console.log('           P(crash>10.0)=', (buckets.over10 / N).toFixed(4), '(expect 0.0950)');
console.log('           P(capped 100)=', (buckets.capped / N).toFixed(4));
console.log(
  '           RTP cashing at 2.00 =',
  ((buckets.over2 / N) * 2 * 100).toFixed(2) + '%',
);

console.log('flight: 2x ->', svc.flightMs(2), 'ms | 10x ->', svc.flightMs(10), 'ms | 100x ->', svc.flightMs(100), 'ms');
console.log(
  'curve : multiplier at 1s/2s/5s =',
  [1000, 2000, 5000].map((t) => svc.multiplierAt(t).toFixed(2)).join('x / ') + 'x',
);
