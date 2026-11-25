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
  /** bKash/Nagad Transaction ID (deposits only). */
  trxId: string | null;
  /** Number the player paid from (deposits only). */
  senderNumber: string | null;
  /** Deposits: provider paid through. Withdrawals: provider to pay out through. */
  paymentMethod: 'bkash' | 'nagad';
  /** Number a withdrawal must be paid out to (null for deposits / pre-026 withdrawals). */
  receiverNumber: string | null;
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

/** How the form renders one editable value of a game's config. */
export type FieldSpec = {
  key: string;
  label: string;
  kind: 'number' | 'numberList' | 'json';
  help?: string;
  min?: number;
  max?: number;
  step?: number;
  length?: number;
  optional?: boolean;
};

/** One RTP figure, e.g. `{ label: 'Banker', rtp: 0.9894 }`. */
export type RtpLine = { label: string; rtp: number };

export type GameConfigSummary = {
  id: string;
  label: string;
  description: string;
  /** Current values (the saved row, or the built-in defaults). */
  config: Record<string, unknown>;
  /** True when no row is saved and the built-in defaults are in effect. */
  isDefault: boolean;
  defaults: Record<string, unknown>;
  fields: FieldSpec[];
  lines: RtpLine[];
  /** Highest RTP of the game's bets; null when it cannot be computed. */
  rtp: number | null;
  houseEdge: number | null;
  note: string | null;
  updatedAt: string | null;
};

export type GameConfigPreview = Pick<
  GameConfigSummary,
  'id' | 'config' | 'lines' | 'rtp' | 'houseEdge' | 'note'
>;

export type AdminGamesResponse = {
  games: GameConfigSummary[];
};

export type AdminGameConfigResponse = {
  game: GameConfigSummary;
};

export type AdminGamePreviewResponse = {
  preview: GameConfigPreview;
};
