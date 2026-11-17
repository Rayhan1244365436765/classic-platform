// Quick logic check for the 3×3 slots paytable (run: node scripts/verify-slots.cjs)
const svc = require('../dist/modules/game/slots/slots.service.js');

const S = svc.SLOT_SYMBOLS;
const [a, b, c] = [S[0], S[1], S[2]];

console.log('symbols  :', S.join(' '), `(${S.length})`);
console.log('cells    :', svc.SLOT_CELLS, '| lines:', JSON.stringify(svc.SLOT_LINES));
console.log('outcomes :', svc.SLOT_OUTCOMES, `(6^9)`);
console.log('paytable :', JSON.stringify(svc.SLOT_PAYTABLE));
console.log('RTP      :', (svc.slotsRtp() * 100).toFixed(2) + '%');
console.log('edge     :', ((1 - svc.slotsRtp()) * 100).toFixed(2) + '%');

// One winning middle line, everything else blank.
const oneLine = [a, b, c, a, a, a, b, c, a];
// Top + bottom winning, middle blank.
const twoLines = [a, a, a, a, b, c, b, b, b];
// All three lines winning.
const threeLines = [a, a, a, b, b, b, c, c, c];
// None.
const none = [a, b, c, a, b, c, a, b, c];

for (const [name, grid] of [
  ['1 line ', oneLine],
  ['2 lines', twoLines],
  ['3 lines', threeLines],
  ['no win ', none],
]) {
  console.log(name, '->', JSON.stringify(svc.evaluateGrid(grid)));
}

// P(line has 3 alike) = 6 / 6^3, so the RTP identity is:
// lines × P(line) × lineMultiplier === slotsRtp()
const lineChance = S.length / S.length ** 3;
const identity = svc.SLOT_LINES.length * lineChance * svc.SLOT_PAYTABLE.lineMultiplier;
console.log(
  `check    : 3 × (1/36) × ${svc.SLOT_PAYTABLE.lineMultiplier} = ${identity.toFixed(4)} (RTP ${(identity * 100).toFixed(2)}%)`,
);
