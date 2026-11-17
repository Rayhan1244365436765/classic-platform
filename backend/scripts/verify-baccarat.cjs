// Baccarat economics check (run: node scripts/verify-baccarat.cjs)
//
// Single 52-card deck, simplified third-card rule as specified:
//   * either side at 8–9 → natural, both stand
//   * otherwise Player draws on 0–5, then Banker draws on 0–5
//   * Player/Banker bets PUSH on a tie (standard Punto Banco)
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
const SUITS = ['S', 'H', 'D', 'C'];

const value = (card) => {
  const rank = card.slice(0, -1);
  if (rank === 'A') return 1;
  if (rank === 'T' || rank === 'J' || rank === 'Q' || rank === 'K') return 0;
  return Number(rank);
};
const total = (cards) => cards.reduce((sum, card) => sum + value(card), 0) % 10;

function round(rng) {
  const deck = RANKS.flatMap((rank) => SUITS.map((suit) => `${rank}${suit}`));
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  const draw = () => deck.pop();
  const player = [draw(), draw()];
  const banker = [draw(), draw()];

  const natural = total(player) >= 8 || total(banker) >= 8;
  if (!natural) {
    if (total(player) <= 5) player.push(draw());
    if (total(banker) <= 5) banker.push(draw());
  }

  const p = total(player);
  const b = total(banker);

  return { player: p, banker: b, outcome: p > b ? 'player' : b > p ? 'banker' : 'tie' };
}

// Deterministic PRNG so the numbers are reproducible.
let seed = 123456789;
const rng = () => {
  seed = (seed * 1103515245 + 12345) % 2 ** 31;
  return seed / 2 ** 31;
};

const N = 3_000_000;
const counts = { player: 0, banker: 0, tie: 0 };
const naturals = { player: 0, banker: 0, tie: 0 };
let naturalRounds = 0;

for (let i = 0; i < N; i += 1) {
  const r = round(rng);
  counts[r.outcome] += 1;
}

const P = {
  player: counts.player / N,
  banker: counts.banker / N,
  tie: counts.tie / N,
};

console.log(`rounds ${N.toLocaleString('en-US')}`);
console.log(`P(player win) ${(P.player * 100).toFixed(3)}%`);
console.log(`P(banker win) ${(P.banker * 100).toFixed(3)}%`);
console.log(`P(tie)        ${(P.tie * 100).toFixed(3)}%`);

const RTP = {
  // tie pushes → stake returned
  player: P.tie + 2 * P.player,
  banker: P.tie + 1.95 * P.banker,
  tie: 8 * P.tie,
};

for (const [bet, rtp] of Object.entries(RTP)) {
  console.log(
    `${bet.padEnd(6)} RTP ${(rtp * 100).toFixed(2)}%  edge ${((1 - rtp) * 100).toFixed(2)}%`,
  );
}

const tieLoses = {
  player: 2 * P.player,
  banker: 1.95 * P.banker,
  tie: 8 * P.tie,
};
console.log('\n--- if a tie instead LOSES the player/banker stakes ---');
for (const [bet, rtp] of Object.entries(tieLoses)) {
  console.log(
    `${bet.padEnd(6)} RTP ${(rtp * 100).toFixed(2)}%  edge ${((1 - rtp) * 100).toFixed(2)}%`,
  );
}

// ---------------------------------------------------------------------------
// Exact enumeration. A card is fully described by its baccarat value, and the
// deck holds 4 cards of each value 1–9 plus 16 zeros (T/J/Q/K), so the whole
// game can be summed over value sequences instead of 52 physical cards.
// ---------------------------------------------------------------------------
const COUNTS = [16, 4, 4, 4, 4, 4, 4, 4, 4, 4];
const DECK = 52;

function exact() {
  const prob = { player: 0, banker: 0, tie: 0 };

  const tally = (p, b, weight) => {
    if (p > b) prob.player += weight;
    else if (b > p) prob.banker += weight;
    else prob.tie += weight;
  };

  for (let v1 = 0; v1 <= 9; v1 += 1) {
    const w1 = COUNTS[v1] / DECK;
    if (!w1) continue;

    for (let v2 = 0; v2 <= 9; v2 += 1) {
      const w2 = (COUNTS[v2] - (v2 === v1 ? 1 : 0)) / (DECK - 1);
      if (w2 <= 0) continue;

      for (let v3 = 0; v3 <= 9; v3 += 1) {
        const used3 = (v1 === v3 ? 1 : 0) + (v2 === v3 ? 1 : 0);
        const w3 = (COUNTS[v3] - used3) / (DECK - 2);
        if (w3 <= 0) continue;

        for (let v4 = 0; v4 <= 9; v4 += 1) {
          const used4 = [v1, v2, v3].filter((v) => v === v4).length;
          const w4 = (COUNTS[v4] - used4) / (DECK - 3);
          if (w4 <= 0) continue;

          const wBase = w1 * w2 * w3 * w4;
          const p0 = (v1 + v3) % 10;
          const b0 = (v2 + v4) % 10;

          // Naturals (8 or 9): both sides stand.
          if (p0 >= 8 || b0 >= 8) {
            tally(p0, b0, wBase);
            continue;
          }

          const afterPlayer = [];
          if (p0 <= 5) {
            for (let v5 = 0; v5 <= 9; v5 += 1) {
              const used5 = [v1, v2, v3, v4].filter((v) => v === v5).length;
              const w5 = (COUNTS[v5] - used5) / (DECK - 4);
              if (w5 <= 0) continue;
              afterPlayer.push({ p: (p0 + v5) % 10, w: wBase * w5, used: [...[v1, v2, v3, v4], v5] });
            }
          } else {
            afterPlayer.push({ p: p0, w: wBase, used: [v1, v2, v3, v4] });
          }

          for (const state of afterPlayer) {
            if (b0 > 5) {
              tally(state.p, b0, state.w);
              continue;
            }

            for (let v6 = 0; v6 <= 9; v6 += 1) {
              const used6 = state.used.filter((v) => v === v6).length;
              const remaining = DECK - state.used.length;
              const w6 = (COUNTS[v6] - used6) / remaining;
              if (w6 <= 0) continue;

              tally(state.p, (b0 + v6) % 10, state.w * w6);
            }
          }
        }
      }
    }
  }

  return prob;
}

const exactProb = exact();
const sum = exactProb.player + exactProb.banker + exactProb.tie;

console.log('\n--- exact enumeration (simplified: both draw on 0-5) ---');
console.log(`P(player win) ${(exactProb.player * 100).toFixed(4)}%`);
console.log(`P(banker win) ${(exactProb.banker * 100).toFixed(4)}%`);
console.log(`P(tie)        ${(exactProb.tie * 100).toFixed(4)}%`);
console.log(`total mass    ${(sum * 100).toFixed(6)}%`);

console.log('\n--- exact RTP (tie pushes) ---');
const exactRtp = {
  player: exactProb.tie + 2 * exactProb.player,
  banker: exactProb.tie + 1.95 * exactProb.banker,
  tie: 8 * exactProb.tie,
};
for (const [bet, rtp] of Object.entries(exactRtp)) {
  console.log(
    `${bet.padEnd(6)} RTP ${(rtp * 100).toFixed(2)}%  edge ${((1 - rtp) * 100).toFixed(2)}%`,
  );
}

// ---------------------------------------------------------------------------
// Same enumeration with the full standard banker tableau (the banker's draw
// depends on the player's third card). This is the asymmetric game.
// ---------------------------------------------------------------------------
function bankerDraws(bankerTotal, playerThird) {
  // Player stood (6-7 or a natural): the banker draws on 0-5.
  if (playerThird === null) return bankerTotal <= 5;

  if (bankerTotal <= 2) return true;
  if (bankerTotal === 3) return playerThird !== 8;
  if (bankerTotal === 4) return playerThird >= 2 && playerThird <= 7;
  if (bankerTotal === 5) return playerThird >= 4 && playerThird <= 7;
  if (bankerTotal === 6) return playerThird === 6 || playerThird === 7;
  return false;
}

function exactFull() {
  const prob = { player: 0, banker: 0, tie: 0 };

  const tally = (p, b, weight) => {
    if (p > b) prob.player += weight;
    else if (b > p) prob.banker += weight;
    else prob.tie += weight;
  };

  for (let v1 = 0; v1 <= 9; v1 += 1) {
    const w1 = COUNTS[v1] / DECK;
    if (!w1) continue;

    for (let v2 = 0; v2 <= 9; v2 += 1) {
      const w2 = (COUNTS[v2] - (v2 === v1 ? 1 : 0)) / (DECK - 1);
      if (w2 <= 0) continue;

      for (let v3 = 0; v3 <= 9; v3 += 1) {
        const used3 = (v1 === v3 ? 1 : 0) + (v2 === v3 ? 1 : 0);
        const w3 = (COUNTS[v3] - used3) / (DECK - 2);
        if (w3 <= 0) continue;

        for (let v4 = 0; v4 <= 9; v4 += 1) {
          const used4 = [v1, v2, v3].filter((v) => v === v4).length;
          const w4 = (COUNTS[v4] - used4) / (DECK - 3);
          if (w4 <= 0) continue;

          const wBase = w1 * w2 * w3 * w4;
          const p0 = (v1 + v3) % 10;
          const b0 = (v2 + v4) % 10;

          if (p0 >= 8 || b0 >= 8) {
            tally(p0, b0, wBase);
            continue;
          }

          const branch = (playerTotal, playerThird, weight, used) => {
            if (!bankerDraws(b0, playerThird)) {
              tally(playerTotal, b0, weight);
              return;
            }

            for (let v6 = 0; v6 <= 9; v6 += 1) {
              const used6 = used.filter((v) => v === v6).length;
              const w6 = (COUNTS[v6] - used6) / (DECK - used.length);
              if (w6 <= 0) continue;

              tally(playerTotal, (b0 + v6) % 10, weight * w6);
            }
          };

          if (p0 <= 5) {
            for (let v5 = 0; v5 <= 9; v5 += 1) {
              const used5 = [v1, v2, v3, v4].filter((v) => v === v5).length;
              const w5 = (COUNTS[v5] - used5) / (DECK - 4);
              if (w5 <= 0) continue;

              branch(
                (p0 + v5) % 10,
                v5,
                wBase * w5,
                [[v1, v2, v3, v4], v5].flat(),
              );
            }
          } else {
            branch(p0, null, wBase, [v1, v2, v3, v4]);
          }
        }
      }
    }
  }

  return prob;
}

const fullProb = exactFull();
const fullSum = fullProb.player + fullProb.banker + fullProb.tie;

console.log('\n--- exact enumeration (full banker tableau) ---');
console.log(`P(player win) ${(fullProb.player * 100).toFixed(4)}%`);
console.log(`P(banker win) ${(fullProb.banker * 100).toFixed(4)}%`);
console.log(`P(tie)        ${(fullProb.tie * 100).toFixed(4)}%`);
console.log(`total mass    ${(fullSum * 100).toFixed(6)}%`);

const fullRtp = {
  player: fullProb.tie + 2 * fullProb.player,
  banker: fullProb.tie + 1.95 * fullProb.banker,
  tie: 8 * fullProb.tie,
};

console.log('\n--- exact RTP (full tableau, tie pushes) ---');
for (const [bet, rtp] of Object.entries(fullRtp)) {
  console.log(
    `${bet.padEnd(6)} RTP ${(rtp * 100).toFixed(2)}%  edge ${((1 - rtp) * 100).toFixed(2)}%`,
  );
}
