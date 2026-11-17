import { Router } from 'express';

import { authGuard } from '../../../common/middleware/authGuard.js';
import { getConfig, play } from './plinko.controller.js';

export const plinkoRouter = Router();

// A player must be authenticated; the wallet owner comes from the JWT.
plinkoRouter.use(authGuard);

// Board layout + pay table (used to draw the pyramid).
plinkoRouter.get('/config', getConfig);

// Drop a ball.
plinkoRouter.post('/play', play);

export default plinkoRouter;
