import { Router } from 'express';

import { authGuard } from '../../../common/middleware/authGuard.js';
import { getConfig, play } from './dragontiger.controller.js';

export const dragontigerRouter = Router();

// A player must be authenticated; the wallet owner comes from the JWT.
dragontigerRouter.use(authGuard);

// Shoe size, payouts + exact odds (used to print the table card).
dragontigerRouter.get('/config', getConfig);

// Deal one hand: one card each.
dragontigerRouter.post('/play', play);

export default dragontigerRouter;
