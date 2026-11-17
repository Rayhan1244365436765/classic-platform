import { Router } from 'express';

import { authGuard } from '../../../common/middleware/authGuard.js';
import { getConfig, play } from './classic_roulette.controller.js';

export const classicRouletteRouter = Router();

// A player must be authenticated; the wallet owner comes from the JWT.
classicRouletteRouter.use(authGuard);

// Pocket layout, colours + payouts (used to draw the table and the wheel).
classicRouletteRouter.get('/config', getConfig);

// Place one bet and spin the wheel.
classicRouletteRouter.post('/play', play);

export default classicRouletteRouter;
