import { Router } from 'express';

import { authGuard } from '../../../common/middleware/authGuard.js';
import { getConfig, play } from './slots.controller.js';

export const slotsRouter = Router();

// A player must be authenticated; the wallet owner comes from the JWT.
slotsRouter.use(authGuard);

// Symbols + paytable (used to draw the cabinet).
slotsRouter.get('/config', getConfig);

// Spin the reels.
slotsRouter.post('/play', play);

export default slotsRouter;
