import { Router } from 'express';

import { authGuard } from '../../../common/middleware/authGuard.js';
import { getConfig, play } from './baccarat.controller.js';

export const baccaratRouter = Router();

// A player must be authenticated; the wallet owner comes from the JWT.
baccaratRouter.use(authGuard);

// Payouts, third-card rules + exact odds (used to print the table limit card).
baccaratRouter.get('/config', getConfig);

// Deal one hand.
baccaratRouter.post('/play', play);

export default baccaratRouter;
