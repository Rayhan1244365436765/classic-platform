import { Router } from 'express';

import { adminGuard } from '../../common/middleware/adminGuard.js';
import { authGuard } from '../../common/middleware/authGuard.js';
import {
  approvePayment,
  getGameConfig,
  getPayments,
  getStats,
  getTransactions,
  getUsers,
  listGames,
  rejectPayment,
  updateGameConfig,
} from './admin.controller.js';

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

// Game configuration (RTP control).
adminRouter.get('/games', listGames);
adminRouter.get('/games/:id/config', getGameConfig);
adminRouter.put('/games/:id/config', updateGameConfig);

export default adminRouter;

