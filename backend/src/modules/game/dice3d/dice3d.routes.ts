import { Router } from 'express';

import { authGuard } from '../../../common/middleware/authGuard.js';
import { getConfig, play } from './dice3d.controller.js';

export const dice3dRouter = Router();

// A player must be authenticated; the wallet owner comes from the JWT.
dice3dRouter.use(authGuard);

// Paytable + exact odds (used to print the felt).
dice3dRouter.get('/config', getConfig);

// Roll the three dice.
dice3dRouter.post('/play', play);

export default dice3dRouter;
