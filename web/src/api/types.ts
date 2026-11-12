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

/** Response of POST /game/roulette/play. */
export type RouletteResult = {
  resultNumber: number;
  resultColor: 'green' | 'red' | 'black';
  won: boolean;
  payout: number;
  serverSeedHash: string;
  roundId: string;
  betAmount: number;
  betType: 'red' | 'black' | 'green' | 'number';
  betValue: string | null;
  balanceAfter: number;
};

/** Every API error uses this envelope. */
export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
  };
};
