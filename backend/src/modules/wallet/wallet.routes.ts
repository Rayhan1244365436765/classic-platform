import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';

import { authGuard } from '../../common/middleware/authGuard.js';
import { AppError } from '../../common/utils/AppError.js';
import { ENABLE_DEV_WALLET_ENDPOINTS, isProduction } from '../../config/env.js';
import { deposit, getMyBalance, withdraw } from './wallet.controller.js';

export const walletRouter = Router();

// Every wallet route requires a valid JWT; `req.user.id` is the ledger owner.
walletRouter.use(authGuard);

walletRouter.get('/balance', getMyBalance);

/**
 * Direct ledger credit/debit is a development convenience used to fund the
 * smoke-test accounts. In production these endpoints must be unreachable —
 * they skip the operator-reviewed `payment/*` flow, so a player could otherwise
 * credit their own wallet. Hidden behind 404 (not 403) so the routes are not
 * discoverable. Re-enable explicitly with `ENABLE_DEV_WALLET_ENDPOINTS=true`.
 */
function devWalletOnly(_req: Request, _res: Response, next: NextFunction): void {
  if (isProduction && !ENABLE_DEV_WALLET_ENDPOINTS) {
    next(new AppError('NOT_FOUND', 404, 'Not found'));
    return;
  }

  next();
}

walletRouter.post('/deposit', devWalletOnly, deposit);
walletRouter.post('/withdraw', devWalletOnly, withdraw);

export default walletRouter;
