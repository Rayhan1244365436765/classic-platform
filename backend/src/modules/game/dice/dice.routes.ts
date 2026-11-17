import { Router } from 'express';

import { authGuard } from '../../../common/middleware/authGuard.js';
import { getConfig, play } from './dice.controller.js';

export const diceRouter = Router();

// A player must be authenticated; the wallet owner comes from the JWT.
diceRouter.use(authGuard);

// Payout multiplier + winning ranges (used to draw the table).
diceRouter.get('/config', getConfig);

// Roll the dice.
diceRouter.post('/play', play);

export default diceRouter;
