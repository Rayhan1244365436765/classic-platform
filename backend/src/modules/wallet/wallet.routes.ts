import { Router } from 'express';

import { authGuard } from '../../common/middleware/authGuard.js';
import { deposit, getMyBalance, withdraw } from './wallet.controller.js';

export const walletRouter = Router();

// Every wallet route requires a valid JWT; `req.user.id` is the ledger owner.
walletRouter.use(authGuard);

walletRouter.get('/balance', getMyBalance);
walletRouter.post('/deposit', deposit);
walletRouter.post('/withdraw', withdraw);

export default walletRouter;
