import { Router } from 'express';

import { authGuard } from '../../../common/middleware/authGuard.js';
import { getConfig, play } from './cascade.controller.js';

export const cascadeRouter = Router();

// A player must be authenticated; the wallet owner comes from the JWT.
cascadeRouter.use(authGuard);

// Symbols, multipliers + pay table (used to draw the cabinet).
cascadeRouter.get('/config', getConfig);

// Spin the grid and run the cascade chain.
cascadeRouter.post('/play', play);

export default cascadeRouter;
