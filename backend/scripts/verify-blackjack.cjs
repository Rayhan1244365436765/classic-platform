// Blackjack rule check (run: node scripts/verify-blackjack.cjs)
const svc = require('../dist/modules/game/blackjack/blackjack.service.js');

const s = (...cards) => svc.handScore(cards);

console.log('hand scoring:');
for (const hand of [
  ['AS', 'KH'],
  ['AS', '5H', 'AD'],
  ['AS', 'AH', '9D'],
  ['AS', 'AH', '9D', 'AD'],
  ['KS', 'QH', '2D'],
  ['TS', '6H', '5D'],
]) {
  console.log(' ', hand.join(' '), '=>', JSON.stringify(s(...hand)));
}

// --- Monte-Carlo of the implemented rules -----------------------------------
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
const SUITS = ['S', 'H', 'D', 'C'];

function freshShoe() {
  const shoe = RANKS.flatMap((r) => SUITS.map((su) => `${r}${su}`));
  for (let i = shoe.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

const N = 300000;
let net = 0;
let wins = 0;
let losses = 0;
let pushes = 0;
let naturals = 0;

for (let hand = 0; hand < N; hand += 1) {
  const shoe = freshShoe();
  const player = [shoe.pop(), shoe.pop()];
  const dealer = [shoe.pop(), shoe.pop()];

  const natural = player.length === 2 && s(...player).total === 21;
  const dealerNatural = dealer.length === 2 && s(...dealer).total === 21;

  if (natural || dealerNatural) {
    if (natural) naturals += 1;
    if (natural && dealerNatural) {
      pushes += 1;
    } else if (natural) {
      wins += 1;
      net += 1;
    } else {
      losses += 1;
      net -= 1;
    }
    continue;
  }

  // Simple strategy: hit until 17+ (auto-stand is equivalent to this).
  while (s(...player).total < 17) {
    player.push(shoe.pop());
  }

  const playerTotal = s(...player).total;

  if (playerTotal > 21) {
    losses += 1;
    net -= 1;
    continue;
  }

  while (s(...dealer).total < 17) {
    dealer.push(shoe.pop());
  }

  const dealerTotal = s(...dealer).total;

  if (dealerTotal > 21 || playerTotal > dealerTotal) {
    wins += 1;
    net += 1;
  } else if (playerTotal < dealerTotal) {
    losses += 1;
    net -= 1;
  } else {
    pushes += 1;
  }
}

console.log('\n300k hands, strategy = hit below 17, dealer stands on 17:');
console.log(`  wins ${(wins / N * 100).toFixed(2)}% · losses ${(losses / N * 100).toFixed(2)}% · pushes ${(pushes / N * 100).toFixed(2)}%`);
console.log(`  naturals ${(naturals / N * 100).toFixed(2)}%`);
console.log(`  RTP ${((1 + net / N) * 100).toFixed(2)}%  →  house edge ${(-net / N * 100).toFixed(2)}%`);
