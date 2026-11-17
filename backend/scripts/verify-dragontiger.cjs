// Dragon Tiger economics (run: node scripts/verify-dragontiger.cjs)
//
// One card each, ranks A=1 … K=13, higher card wins, equal ranks = tie.
// By symmetry P(dragon) = P(tiger); only P(tie) depends on the shoe size.
//
//   P(tie)   = 13 · (perRank / totalCards) · ((perRank − 1) / (totalCards − 1))
//   P(side)  = (1 − P(tie)) / 2
const DECK = 52;

function odds(decks) {
  const perRank = 4 * decks;
  const total = DECK * decks;
  const tie = 13 * (perRank / total) * ((perRank - 1) / (total - 1));

  return { tie, side: (1 - tie) / 2 };
}

function report(decks, sidePayout, tiePayout, tieLoses = true) {
  const p = odds(decks);
  // Tie either loses the whole side bet (as specified) or returns it.
  const sideRtp = tieLoses
    ? sidePayout * p.side
    : sidePayout * p.side + p.tie;
  const tieRtp = tiePayout * p.tie;

  console.log(`decks ${String(decks).padStart(2)} | P(tie) ${(p.tie * 100).toFixed(4)}% · P(dragon)=P(tiger) ${(p.side * 100).toFixed(4)}%`);
  console.log(
    `          | dragon/tiger ${sidePayout}× ${tieLoses ? '(tie loses)' : '(tie pushes)'} → RTP ${(sideRtp * 100).toFixed(2)}%  edge ${((1 - sideRtp) * 100).toFixed(2)}%`,
  );
  console.log(
    `          | tie ${tiePayout}× → RTP ${(tieRtp * 100).toFixed(2)}%  edge ${((1 - tieRtp) * 100).toFixed(2)}%`,
  );
}

console.log('=== the spec as written: 52-card deck, 2× sides, 8× tie, tie loses ===');
report(1, 2, 8);

console.log('\n=== the 8-deck shoe the spec calls "standard" (same payouts) ===');
report(8, 2, 8);

console.log('\n=== 8 decks, tie paid 9× (8:1 profit — the real casino price) ===');
report(8, 2, 9);

console.log('\n=== 1 deck, tie priced for a real-game ~67% RTP ===');
for (const multiplier of [11, 12, 16]) {
  const p = odds(1);
  console.log(
    `          | tie ${multiplier}× → RTP ${(multiplier * p.tie * 100).toFixed(2)}%  edge ${((1 - multiplier * p.tie) * 100).toFixed(2)}%`,
  );
}

console.log('\n=== for reference: real Dragon Tiger (8 decks, tie loses half) ===');
const real = odds(8);
const halfEdge = real.side * 2 + (real.tie * 0.5);
console.log(`          | dragon/tiger 2×, tie loses half → RTP ${(halfEdge * 100).toFixed(2)}%  edge ${((1 - halfEdge) * 100).toFixed(2)}%`);
