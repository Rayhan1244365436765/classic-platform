import { Router } from 'express';

import { authGuard } from '../../common/middleware/authGuard.js';
import { deposit, myPayments, withdraw } from './payment.controller.js';

export const paymentRouter = Router();

// Deposit / withdraw requests belong to the authenticated player.
paymentRouter.use(authGuard);

paymentRouter.post('/deposit', deposit);
paymentRouter.post('/withdraw', withdraw);
paymentRouter.get('/mine', myPayments);

export default paymentRouter;
