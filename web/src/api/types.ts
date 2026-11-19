/** Shapes returned by the Casino Platform API (see docs/ARCHITECTURE.md). */

export type AuthUser = {
  id: string;
  phone: string;
  role: string;
};

export type LoginResponse = {
  token: string;
  user: AuthUser;
};

export type RegisterResponse = {
  user: AuthUser;
};

export type BalanceResponse = {
  balance: number;
};

/** A manual deposit/withdraw request (awaiting admin approval). */
export type PaymentRequest = {
  id: string;
  userId: string;
  amount: number;
  type: 'deposit' | 'withdraw';
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  updatedAt: string;
};

export type PaymentResponse = {
  payment: PaymentRequest;
};

/** Colour language for wheel segments (0x = gray, high multipliers = gold). */
export type SegmentColor = 'gray' | 'blue' | 'green' | 'gold';

/** Response of POST /game/roulette/play ("Spin to Win"). */
export type SpinResult = {
  /** Which of the 20 segments the wheel stopped on. */
  segmentIndex: number;
  multiplier: number;
  segmentColor: SegmentColor;
  won: boolean;
  /** multiplier × betAmount (0 when the wheel lands on 0x). */
  payout: number;
  betAmount: number;
  balanceAfter: number;
  serverSeedHash: string;
  roundId: string;
  /** Legacy aliases (segment index + colour key). */
  resultNumber: number;
  resultColor: string;
};

/** One multiplier bucket of the wheel, with its true odds. */
export type WheelPayout = {
  multiplier: number;
  color: SegmentColor;
  /** Probability of landing on this multiplier (0–1). */
  chance: number;
};

/** Response of GET /game/roulette/segments. */
export type WheelConfig = {
  segments: number[];
  segmentCount: number;
  /** Theoretical return to player, e.g. 0.7 for a 30% house edge. */
  rtp: number;
  payouts: WheelPayout[];
};

/** One slot symbol (emoji). */
export type SlotSymbol = string;

/** Response of POST /game/slots/play. */
export type SlotsResult = {
  /** Nine symbols, row-major (0–2 top line, 3–5 middle, 6–8 bottom). */
  grid: SlotSymbol[];
  /** Indices of the rows that paid (0 = top, 1 = middle, 2 = bottom). */
  winningLines: number[];
  /** Multiplier earned per completed line (10.8). */
  lineMultiplier: number;
  /** winningLines.length × lineMultiplier. */
  multiplier: number;
  won: boolean;
  payout: number;
  betAmount: number;
  balanceAfter: number;
  serverSeedHash: string;
  roundId: string;
};

/** Response of GET /game/slots/config. */
export type SlotsConfig = {
  symbols: SlotSymbol[];
  paytable: {
    /** Payout per completed line, as a multiple of the total bet. */
    lineMultiplier: number;
    lines: number;
  };
  /** Cell indices of each payline (row-major). */
  lines: number[][];
  cells: number;
  outcomes: number;
};

/** Which side of the dice table the player called. */
export type DicePrediction = 'high' | 'low';

/** Response of POST /game/dice/play. */
export type DiceResult = {
  /** The rolled number, 1–100. */
  roll: number;
  prediction: DicePrediction;
  won: boolean;
  multiplier: number;
  payout: number;
  betAmount: number;
  balanceAfter: number;
  serverSeedHash: string;
  roundId: string;
};

/** Response of GET /game/dice/config. */
export type DiceConfig = {
  faces: number;
  min: number;
  max: number;
  multiplier: number;
  /** The single number that loses for both sides (50). */
  houseNumber: number;
  high: { min: number; max: number };
  low: { min: number; max: number };
};

/** Response of GET /game/aviator/config. */
export type AviatorConfig = {
  /** Exponential climb constant: multiplier = e^(elapsed / growthTauMs). */
  growthTauMs: number;
  /** Highest multiplier a round can reach. */
  crashCap: number;
  /** Lowest multiplier that can be cashed out. */
  minCashout: number;
};

/** Response of POST /game/aviator/start (the crash point stays hidden). */
export type AviatorStart = {
  roundId: string;
  serverSeedHash: string;
  /** Server timestamp of the round start (ISO). */
  startedAt: string;
  /** How long the plane flies before bursting (ms). */
  durationMs: number;
  betAmount: number;
  balanceAfter: number;
  growthTauMs: number;
  minCashout: number;
};

/** Response of POST /game/aviator/cashout and /crash. */
export type AviatorOutcome = {
  roundId: string;
  status: 'cashed_out' | 'crashed';
  /** Multiplier actually paid (0 when crashed). */
  multiplier: number;
  payout: number;
  /** The hidden crash point, revealed once the round has settled. */
  crashPoint: number;
  betAmount: number;
  balanceAfter: number;
};

/** Response of POST /game/mines/start (the mine layout stays hidden). */
export type MinesStart = {
  gameId: string;
  betAmount: number;
  minesCount: number;
  multiplier: number;
  balanceAfter: number;
  serverSeedHash: string;
};

/** Response of POST /game/mines/reveal. */
export type MinesReveal = {
  status: 'active' | 'won' | 'lost';
  multiplier: number;
  revealedTiles: number[];
  safeTiles: number;
  /** Only present once the game has settled. */
  mines?: number[];
  /** Index of the mine that was hit (lost only). */
  bombIndex?: number;
  payout: number;
  balanceAfter: number;
};

/** Response of POST /game/mines/cashout. */
export type MinesCashout = {
  status: 'won';
  multiplier: number;
  payout: number;
  revealedTiles: number[];
  safeTiles: number;
  mines: number[];
  balanceAfter: number;
};

/** One step of the Plinko ball. */
export type PlinkoStep = 'L' | 'R';

/** Response of POST /game/plinko/play. */
export type PlinkoResult = {
  rows: number;
  /** The route the ball took, one entry per row. */
  path: PlinkoStep[];
  /** Landing slot: 0 (far left) … 8 (far right). */
  slot: number;
  multiplier: number;
  payout: number;
  betAmount: number;
  balanceAfter: number;
  serverSeedHash: string;
  roundId: string;
};

/** Response of GET /game/plinko/config. */
export type PlinkoConfig = {
  rows: number;
  slots: number;
  multipliers: number[];
  rtp: number;
};

/** Card code, e.g. "AS" (ace of spades) or "TH" (ten of hearts). */
export type BlackjackCard = string;

/** Response of the blackjack endpoints. */
export type BlackjackState = {
  gameId: string;
  betAmount: number;
  playerHand: BlackjackCard[];
  playerTotal: number;
  /** Only the up-card while the hand is active. */
  dealerHand: BlackjackCard[];
  dealerTotal: number | null;
  status: 'active' | 'won' | 'lost' | 'push';
  playerBlackjack: boolean;
  dealerBlackjack: boolean;
  payout: number;
  balanceAfter: number;
  serverSeedHash: string;
};

/** Response of POST /game/keno/play. */
export type KenoResult = {
  /** The numbers the player picked, ascending. */
  picked: number[];
  /** The 20 numbers the house drew, ascending. */
  drawn: number[];
  /** Picks that were drawn — the winning numbers. */
  matches: number[];
  hits: number;
  multiplier: number;
  payout: number;
  betAmount: number;
  balanceAfter: number;
  serverSeedHash: string;
  roundId: string;
};

/** One prize ladder of GET /game/keno/config. */
export type KenoPayTable = {
  picks: number;
  /** Index = number of catches (0 … picks); 0 means "pays nothing". */
  multipliers: number[];
  /** First catch level that pays anything. */
  minHits: number;
  rtp: number;
};

/** Response of GET /game/keno/config. */
export type KenoConfig = {
  pool: number;
  drawn: number;
  minPicks: number;
  maxPicks: number;
  payTables: KenoPayTable[];
};

/** The side a baccarat player backs. */
export type BaccaratBet = 'player' | 'banker' | 'tie';

/** Which side won (`'tie'` when both totals match). */
export type BaccaratWinner = BaccaratBet;

/** Card code, e.g. "AS" (ace of spades) or "TH" (ten of hearts). */
export type BaccaratCard = string;

/** Response of POST /game/baccarat/play. */
export type BaccaratResult = {
  playerHand: BaccaratCard[];
  bankerHand: BaccaratCard[];
  /** Both totals mod 10. */
  playerTotal: number;
  bankerTotal: number;
  /** Either side was dealt 8 or 9 — no third cards. */
  natural: boolean;
  winner: BaccaratWinner;
  betOn: BaccaratBet;
  outcome: 'won' | 'lost' | 'push';
  /** 2 / 1.95 / 8 on a win, 1 on a push, 0 on a loss. */
  multiplier: number;
  payout: number;
  betAmount: number;
  balanceAfter: number;
  serverSeedHash: string;
  roundId: string;
};

/** Response of GET /game/baccarat/config. */
export type BaccaratConfig = {
  deckSize: number;
  naturalTotal: number;
  playerDrawsAt: number;
  payouts: { player: number; banker: number; tie: number };
  bankerCommission: number;
  pushOnTie: boolean;
  probabilities: { player: number; banker: number; tie: number };
  rtp: { player: number; banker: number; tie: number };
};

/** The side a Dragon Tiger player backs. */
export type DragonTigerBet = 'dragon' | 'tiger' | 'tie';

/** Response of POST /game/dragontiger/play. */
export type DragonTigerResult = {
  dragonCard: string;
  tigerCard: string;
  /** Rank values, A = 1 … K = 13. */
  dragonRank: number;
  tigerRank: number;
  winner: DragonTigerBet;
  betOn: DragonTigerBet;
  /** A tie loses Dragon and Tiger bets — there is no push. */
  outcome: 'won' | 'lost';
  /** 2 (dragon/tiger) or 8 (tie) on a win, 0 on a loss. */
  multiplier: number;
  payout: number;
  betAmount: number;
  balanceAfter: number;
  serverSeedHash: string;
  roundId: string;
};

/** Response of GET /game/dragontiger/config. */
export type DragonTigerConfig = {
  decks: number;
  shoeSize: number;
  payouts: { dragon: number; tiger: number; tie: number };
  tieLosesSides: boolean;
  probabilities: { dragon: number; tiger: number; tie: number };
  rtp: { dragon: number; tiger: number; tie: number };
  /** RTP at other shoe sizes (1 deck / 8 decks). */
  alternatives: {
    decks: number;
    rtp: { dragon: number; tiger: number; tie: number };
  }[];
};

/** Teen Patti hand categories, best first. */
export type TeenPattiCategory =
  | 'trail'
  | 'pureSequence'
  | 'sequence'
  | 'colour'
  | 'pair'
  | 'high';

/** Response of POST /game/teenpatti/play. */
export type TeenPattiResult = {
  playerHand: string[];
  dealerHand: string[];
  playerCategory: TeenPattiCategory;
  dealerCategory: TeenPattiCategory;
  playerHandLabel: string;
  dealerHandLabel: string;
  winner: 'player' | 'dealer' | 'tie';
  /** A tie refunds the stake, so `push` is possible. */
  outcome: 'won' | 'lost' | 'push';
  /** 1.95 on a win, 1 on a tie, 0 on a loss. */
  multiplier: number;
  payout: number;
  betAmount: number;
  balanceAfter: number;
  serverSeedHash: string;
  roundId: string;
};

/** Exact head-to-head odds, recomputed from the deck by the server. */
export type TeenPattiOdds = {
  tieRate: number;
  winRate: number;
  loseRate: number;
  rtp: number;
  houseEdge: number;
  /** RTP with the rake removed — the literal 2× (exactly 1.0). */
  rtpWithoutRake: number;
  hands: number;
  orderedPairs: number;
  tiePairs: number;
  frequencies: Record<TeenPattiCategory, number>;
};

/** Response of GET /game/teenpatti/config. */
export type TeenPattiConfig = {
  deckSize: number;
  handSize: number;
  winMultiplier: number;
  rake: number;
  payoutMultiplier: number;
  tieRefunds: boolean;
  ranking: { id: TeenPattiCategory; label: string }[];
  odds: TeenPattiOdds;
};

/** Symbols of the Showdown cascade slot (Wild West set). */
export type CascadeSymbolId =
  | 'WHISKEY'
  | 'HAT'
  | 'GUN'
  | 'HORSE'
  | 'BADGE'
  | 'DYNAMITE'
  | 'FIRE';

/** One paid cluster of a cascade step (bet multiples). */
export type CascadeCluster = {
  symbol: CascadeSymbolId;
  /** Grid indices, row-major, 0 = top-left. */
  cells: number[];
  size: number;
  pay: number;
  win: number;
};

/** One cascade: the grid that won, what paid, and what got cleared. */
export type CascadeStep = {
  step: number;
  multiplier: number;
  grid: CascadeSymbolId[];
  clusters: CascadeCluster[];
  removed: number[];
  win: number;
};

/** Response of POST /game/cascade/play. */
export type CascadeResult = {
  grid: CascadeSymbolId[];
  finalGrid: CascadeSymbolId[];
  steps: CascadeStep[];
  cascadeCount: number;
  maxMultiplier: number;
  /** Total win in bet multiples. */
  totalWin: number;
  betAmount: number;
  payout: number;
  balanceAfter: number;
  serverSeedHash: string;
  roundId: string;
};

/** Response of GET /game/cascade/config. */
export type CascadeConfig = {
  cols: number;
  rows: number;
  cells: number;
  minCluster: number;
  maxCascades: number;
  multipliers: number[];
  symbols: { id: CascadeSymbolId; glyph: string }[];
  pays: Record<CascadeSymbolId, number[]>;
  rtp: number;
  rtpRounds: number;
};

/** The bets a classic roulette table accepts. */
export type RouletteBetType = 'number' | 'red' | 'black' | 'even' | 'odd' | 'low' | 'high';

/** Pocket colour: 0 is green, 18 numbers red, 18 black. */
export type PocketColor = 'green' | 'red' | 'black';

/** Response of POST /game/classic_roulette/play. */
export type ClassicRouletteResult = {
  /** The pocket that came up, 0–36. */
  pocket: number;
  pocketColor: PocketColor;
  betType: RouletteBetType;
  /** The chosen number for a straight bet, otherwise null. */
  betValue: number | null;
  won: boolean;
  /** 36 (number), 2 (even-money) or 0. */
  multiplier: number;
  payout: number;
  betAmount: number;
  balanceAfter: number;
  /** Where the pocket sits in `wheelOrder`, for the ball animation. */
  wheelIndex: number;
  serverSeedHash: string;
  roundId: string;
};

/** Response of GET /game/classic_roulette/config. */
export type ClassicRouletteConfig = {
  pockets: number;
  redNumbers: number[];
  /** Physical pocket order (clockwise) — how the wheel is drawn. */
  wheelOrder: number[];
  payouts: Record<RouletteBetType, number>;
  betTypes: RouletteBetType[];
  rtp: Record<RouletteBetType, number>;
  houseEdge: number;
};

/** Fruit Bonanza: one payline's verdict. */
export type FruitLineResult = {
  /** Index into the config's `lines`. */
  line: number;
  /** The three grid cells this line reads, row-major. */
  cells: [number, number, number];
  /** The three symbols on the line, left to right. */
  symbols: string[];
  match: 'three' | 'two' | 'none';
  /** Multiple of the bet; 0 on a losing line. */
  multiplier: number;
};

/** Response of POST /game/fruit_bonanza/play. */
export type FruitBonanzaResult = {
  /** Nine symbols, row-major. */
  grid: string[];
  lines: FruitLineResult[];
  winningLines: number[];
  /** Sum of the winning lines' multipliers. */
  lineMultiplier: number;
  multiplier: number;
  won: boolean;
  payout: number;
  betAmount: number;
  balanceAfter: number;
  serverSeedHash: string;
  roundId: string;
};

/** Response of GET /game/fruit_bonanza/config. */
export type FruitBonanzaConfig = {
  symbols: string[];
  lines: [number, number, number][];
  cells: number;
  lineCount: number;
  pays: { three: number; two: number };
  rtp: number;
  houseEdge: number;
  probabilities: { three: number; two: number; none: number };
};

/** 3D Dice: one row of the per-total paytable. */
export type Dice3dSumEntry = {
  sum: number;
  combos: number;
  /** Multiple of the stake. */
  pay: number;
  chance: number;
  rtp: number;
};

/** Response of GET /game/dice3d/config. */
export type Dice3dConfig = {
  dice: number;
  faces: number;
  outcomes: number;
  /** A triple loses high and low (Sic Bo rule). */
  triplesLoseHighLow: boolean;
  high: { from: number; to: number; pay: number; chance: number; rtp: number };
  low: { from: number; to: number; pay: number; chance: number; rtp: number };
  sums: Dice3dSumEntry[];
};

/** Response of POST /game/dice3d/play. */
export type Dice3dResult = {
  /** The three dice, 1–6 each. */
  dice: number[];
  sum: number;
  triple: boolean;
  /** `'high'`, `'low'` or the backed total as a string. */
  betType: string;
  /** The backed total, or null for high/low. */
  betSum: number | null;
  won: boolean;
  multiplier: number;
  payout: number;
  betAmount: number;
  balanceAfter: number;
  /** A triple wiped out a high/low bet that would have won. */
  tripleVoided: boolean;
  serverSeedHash: string;
  roundId: string;
};

/** Boxing King: one paying cluster. */
export type BoxingKingCluster = {
  /** The shared symbol. */
  symbol: string;
  /** Its cells, row-major. */
  cells: number[];
  size: number;
  /** Multiple of the bet this cluster pays. */
  pay: number;
};

/** Response of POST /game/boxing_king/play. */
export type BoxingKingResult = {
  grid: string[];
  clusters: BoxingKingCluster[];
  winningCells: number[];
  /** Sum of the clusters' pays. */
  multiplier: number;
  payout: number;
  won: boolean;
  betAmount: number;
  balanceAfter: number;
  biggestCluster: number;
  serverSeedHash: string;
  roundId: string;
};

/** Response of GET /game/boxing_king/config. */
export type BoxingKingConfig = {
  symbols: string[];
  cells: number;
  outcomes: number;
  minCluster: number;
  pays: { small: number; medium: number; large: number };
  frequency: { small: number; medium: number; large: number };
  hitRate: number;
  rtp: number;
  houseEdge: number;
};

/** A paying 4+ cluster on the Fortune Gems board. */
export type FortuneCluster = {
  symbol: string;
  cells: number[];
  size: number;
  tier: 'small' | 'medium' | 'large' | 'huge';
  /** Multiple of the bet this cluster pays. */
  pay: number;
};

/** Response of POST /game/fortune_gems/play. */
export type FortuneGemsResult = {
  /** Twelve symbols, row-major, 4 per row. */
  grid: string[];
  clusters: FortuneCluster[];
  /** Cells belonging to a paying cluster (the golden pulse). */
  winningCells: number[];
  /** Sum of the clusters' pays. */
  multiplier: number;
  payout: number;
  won: boolean;
  betAmount: number;
  balanceAfter: number;
  biggestCluster: number;
  serverSeedHash: string;
  roundId: string;
};

/** Cluster paytable: payoff by cluster size, as a multiple of the bet. */
export type FortunePays = {
  small: number;
  medium: number;
  large: number;
  huge: number;
};

/** Response of GET /game/fortune_gems/config. */
export type FortuneGemsConfig = {
  symbols: string[];
  cols: number;
  rows: number;
  cells: number;
  outcomes: number;
  minCluster: number;
  pays: FortunePays;
  /** The table as briefed (2/5/15/50), kept so the calibration stays visible. */
  briefPays: FortunePays;
  frequency: FortunePays;
  hitRate: number;
  rtp: number;
  houseEdge: number;
};

/** Every API error uses this envelope. */
export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
  };
};

