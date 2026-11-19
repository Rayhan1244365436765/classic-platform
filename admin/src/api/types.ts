/** Response shapes of the admin API (backend/src/modules/admin). */

export type AdminStats = {
  totalUsers: number;
  /** Absolute value of all completed `bet` rows. */
  totalWagered: number;
  /** Sum of all completed `win` rows. */
  totalPayouts: number;
};

export type AdminUser = {
  id: string;
  phone: string;
  role: string;
  createdAt: string;
  balance: number;
};

export type AdminTransaction = {
  id: string;
  phone: string;
  type: string;
  amount: number;
  status: string;
  referenceId: string | null;
  createdAt: string;
};

export type AdminUsersResponse = {
  users: AdminUser[];
};

export type AdminTransactionsResponse = {
  transactions: AdminTransaction[];
};

/** A manual deposit/withdraw request awaiting review. */
export type PaymentRequest = {
  id: string;
  userId: string;
  amount: number;
  type: 'deposit' | 'withdraw';
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  phone?: string;
};

export type AdminPaymentsResponse = {
  payments: PaymentRequest[];
};

export type AdminPaymentResponse = {
  payment: PaymentRequest;
};

export type AuthUser = {
  id: string;
  phone: string;
  role: string;
};

export type LoginResponse = {
  token: string;
  user: AuthUser;
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
  };
};

/** Game configuration (admin RTP control) — see backend/src/modules/config. */
export type SlotsGameConfig = {
  lineMultiplier: number;
};

export type RouletteGameConfig = {
  segments: number[];
};

export type GameConfigSummary = {
  id: string;
  config: unknown;
  rtp: number;
  houseEdge: number;
};

export type AdminGamesResponse = {
  games: GameConfigSummary[];
};

export type AdminGameConfigResponse = {
  game: GameConfigSummary;
};
