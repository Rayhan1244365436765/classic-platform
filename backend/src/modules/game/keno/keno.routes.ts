import { Router } from 'express';

import { authGuard } from '../../../common/middleware/authGuard.js';
import { getConfig, play } from './keno.controller.js';

export const kenoRouter = Router();

// A player must be authenticated; the wallet owner comes from the JWT.
kenoRouter.use(authGuard);

// Board size, pick limits + pay tables (used to draw the board and the ladder).
kenoRouter.get('/config', getConfig);

// Draw 20 numbers against the player's picks.
kenoRouter.post('/play', play);

export default kenoRouter;
