// Teen Patti hand ranking + exact head-to-head odds.
// Run: node scripts/verify-teenpatti.cjs
//
// Reads (highest → lowest): trail > pure sequence > sequence > colour > pair > high card.
// A is high; A-2-3 is the lowest run, Q-K-A the highest. Suits never break a tie.
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['S', 'H', 'D', 'C'];

const rankValue = (card) => RANKS.indexOf(card.slice(0, -1)) + 2; // 2 … 14
const suitOf = (card) => card.slice(-1);

const CATEGORY = {
  HIGH: 1,
  PAIR: 2,
  COLOUR: 3,
  SEQUENCE: 4,
  PURE: 5,
  TRAIL: 6,
};

const CATEGORY_NAME = {
  1: 'high card',
  2: 'pair',
  3: 'colour',
  4: 'sequence',
  5: 'pure sequence',
  6: 'trail',
};

/** Score a 3-card hand → [category, tiebreak…], compared lexicographically. */
function score(cards) {
  const values = cards.map(rankValue).sort((a, b) => b - a); // descending
  const suits = cards.map(suitOf);
  const flush = suits[0] === suits[1] && suits[1] === suits[2];
  const [high, mid, low] = values;

  const isTrail = high === low;
  const isPair = !isTrail && (high === mid || mid === low);

  // Consecutive, with A-2-3 as the lowest run.
  let runHigh = 0;
  if (!isTrail && !isPair) {
    if (high === 14 && mid === 3 && low === 2) {
      runHigh = 3; // A-2-3
    } else if (high === mid + 1 && mid === low + 1) {
      runHigh = high;
    }
  }

  if (isTrail) return [CATEGORY.TRAIL, high, 0, 0];
  if (runHigh && flush) return [CATEGORY.PURE, runHigh, 0, 0];
  if (runHigh) return [CATEGORY.SEQUENCE, runHigh, 0, 0];
  if (flush) return [CATEGORY.COLOUR, high, mid, low];
  if (isPair) {
    const pairRank = high === mid ? high : mid;
    const kicker = high === mid ? low : high;
    return [CATEGORY.PAIR, pairRank, kicker, 0];
  }

  return [CATEGORY.HIGH, high, mid, low];
}

function compare(a, b) {
  for (let i = 0; i < 4; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

// --- all hands -------------------------------------------------------------
const deck = RANKS.flatMap((rank) => SUITS.map((suit) => `${rank}${suit}`));
const hands = [];

for (let i = 0; i < deck.length; i += 1) {
  for (let j = i + 1; j < deck.length; j += 1) {
    for (let k = j + 1; k < deck.length; k += 1) {
      const cards = [deck[i], deck[j], deck[k]];
      // Card *indices*, not a bitmask: 1 << 51 overflows JavaScript's 32-bit
      // bitwise ops and silently made different cards look identical.
      hands.push({ cards, score: score(cards), index: [i, j, k] });
    }
  }
}

console.log(`hands ${hands.length.toLocaleString('en-US')} (expect ${(52 * 51 * 50) / 6})`);

// Category distribution.
const byCategory = new Map();
for (const hand of hands) {
  const key = hand.score[0];
  byCategory.set(key, (byCategory.get(key) ?? 0) + 1);
}
for (const key of [6, 5, 4, 3, 2, 1]) {
  const count = byCategory.get(key) ?? 0;
  console.log(
    `${CATEGORY_NAME[key].padEnd(13)} ${String(count).padStart(6)}  ${((count / hands.length) * 100).toFixed(2)}%`,
  );
}

// --- ties: same score, no shared card --------------------------------------
const groups = new Map();
for (const hand of hands) {
  const key = hand.score.join(',');
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(hand);
}

const totalCards = deck.length;
const C49_3 = (49 * 48 * 47) / 6;
const totalPairs = hands.length * C49_3; // ordered (player hand, dealer hand)

let tiePairs = 0;
const disjoint = (a, b) =>
  a[0] !== b[0] &&
  a[0] !== b[1] &&
  a[0] !== b[2] &&
  a[1] !== b[0] &&
  a[1] !== b[1] &&
  a[1] !== b[2] &&
  a[2] !== b[0] &&
  a[2] !== b[1] &&
  a[2] !== b[2];

for (const group of groups.values()) {
  for (const a of group) {
    for (const b of group) {
      if (disjoint(a.index, b.index)) tiePairs += 1;
    }
  }
}

const tieRate = tiePairs / totalPairs;
console.log(`\nordered hand pairs ${totalPairs.toLocaleString('en-US')}`);
console.log(`tie pairs ${tiePairs.toLocaleString('en-US')}`);
console.log(`P(tie)  ${(tieRate * 100).toFixed(4)}%`);

// By symmetry P(player win) = P(dealer win).
const pWin = (1 - tieRate) / 2;
console.log(`P(player win) = P(dealer win) ${(pWin * 100).toFixed(4)}%`);

// --- economics -------------------------------------------------------------
const rtpLiteral = 2 * pWin + tieRate; // spec: 2× win, tie refunds
const rtpRaked = 1.95 * pWin + tieRate; // 5% rake on the win
console.log(`\nspec as written (2× win, tie refunds) → RTP ${(rtpLiteral * 100).toFixed(4)}%  edge ${((1 - rtpLiteral) * 100).toFixed(4)}%`);
console.log(`5% rake (1.95× win, tie refunds)    → RTP ${(rtpRaked * 100).toFixed(4)}%  edge ${((1 - rtpRaked) * 100).toFixed(4)}%`);

for (const [label, multiplier] of [
  ['1.90×', 1.9],
  ['1.95×', 1.95],
  ['1.97×', 1.97],
  ['1.99×', 1.99],
]) {
  console.log(`  ${label} → RTP ${((multiplier * pWin + tieRate) * 100).toFixed(4)}%`);
}

// A sanity check on the evaluator: the best and worst possible hands.
const best = hands.reduce((x, y) => (compare(y.score, x.score) > 0 ? y : x));
const worst = hands.reduce((x, y) => (compare(y.score, x.score) < 0 ? y : x));
console.log(`\nbest hand  ${best.cards.join(' ')} → ${CATEGORY_NAME[best.score[0]]} ${best.score.slice(1).join(',')}`);
console.log(`worst hand ${worst.cards.join(' ')} → ${CATEGORY_NAME[worst.score[0]]} ${worst.score.slice(1).join(',')}`);
