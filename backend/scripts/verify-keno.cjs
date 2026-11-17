// Keno pay-table design check (run: node scripts/verify-keno.cjs)
const C = (n, k) => {
  if (k < 0 || k > n) return 0;
  let v = 1;
  for (let i = 0; i < k; i += 1) v = (v * (n - i)) / (i + 1);
  return Math.round(v);
};
const P = (p, k) => (C(20, k) * C(60, p - k)) / C(80, p);
const floor2 = (v) => Math.floor(v * 100) / 100;

const TARGET = 0.97;
const RATIO = 3;
/** The lowest winning tier must at least return the stake. */
const MIN_LOWEST = 1;

/**
 * Prize ladder: `3^(k - t)` weights spread the RTP so higher catches pay more,
 * and `t` is the most generous threshold whose lowest prize still pays ≥ 1×.
 */
function buildTable(picks) {
  const probs = Array.from({ length: picks + 1 }, (_, k) => P(picks, k));

  for (let t = 1; t <= picks; t += 1) {
    const weight = (k) => RATIO ** (k - t);
    let denom = 0;
    for (let k = t; k <= picks; k += 1) denom += probs[k] * weight(k);

    const scale = TARGET / denom;
    if (scale * weight(t) >= MIN_LOWEST || t === picks) {
      return {
        table: Array.from({ length: picks + 1 }, (_, k) => (k < t ? 0 : floor2(scale * weight(k)))),
        from: t,
      };
    }
  }

  return { table: Array.from({ length: picks + 1 }, () => 0), from: picks };
}

for (let picks = 1; picks <= 10; picks += 1) {
  const { table, from } = buildTable(picks);
  let rtp = 0;
  for (let k = 0; k <= picks; k += 1) rtp += P(picks, k) * table[k];
  console.log(
    `picks ${String(picks).padStart(2)} | pays from ${from} | ${table.slice(from).join(', ').padEnd(56)} | RTP ${(rtp * 100).toFixed(2)}%`,
  );
}

