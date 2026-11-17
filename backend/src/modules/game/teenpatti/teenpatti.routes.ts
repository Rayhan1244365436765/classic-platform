import { Router } from 'express';

import { authGuard } from '../../../common/middleware/authGuard.js';
import { getConfig, play } from './teenpatti.controller.js';

export const teenpattiRouter = Router();

// A player must be authenticated; the wallet owner comes from the JWT.
teenpattiRouter.use(authGuard);

// Ranking, payouts + exact odds (used to print the hand-order card).
teenpattiRouter.get('/config', getConfig);

// Deal one hand: 3 cards each against the dealer.
teenpattiRouter.post('/play', play);

export default teenpattiRouter;
