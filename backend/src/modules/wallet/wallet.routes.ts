import { Router } from 'express';

import { authGuard } from '../../common/middleware/authGuard';
import { deposit, getMyBalance, withdraw } from './wallet.controller';

export const walletRouter = Router();

// Every wallet route requires a valid JWT; `req.user.id` is the ledger owner.
walletRouter.use(authGuard);

walletRouter.get('/balance', getMyBalance);
walletRouter.post('/deposit', deposit);
walletRouter.post('/withdraw', withdraw);

export default walletRouter;
