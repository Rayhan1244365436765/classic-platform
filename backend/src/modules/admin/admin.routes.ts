import { Router } from 'express';

import { adminGuard } from '../../common/middleware/adminGuard';
import { authGuard } from '../../common/middleware/authGuard';
import {
  approvePayment,
  getPayments,
  getStats,
  getTransactions,
  getUsers,
  rejectPayment,
} from './admin.controller';

export const adminRouter = Router();

// 1. valid JWT, then 2. role === 'admin' (403 otherwise).
adminRouter.use(authGuard, adminGuard);

adminRouter.get('/stats', getStats);
adminRouter.get('/users', getUsers);
adminRouter.get('/transactions', getTransactions);

// Payment review queue.
adminRouter.get('/payments', getPayments);
adminRouter.post('/payments/:id/approve', approvePayment);
adminRouter.post('/payments/:id/reject', rejectPayment);

export default adminRouter;

