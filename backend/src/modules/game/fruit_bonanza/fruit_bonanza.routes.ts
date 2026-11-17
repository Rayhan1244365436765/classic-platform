import { Router } from 'express';

import { authGuard } from '../../../common/middleware/authGuard.js';
import { getConfig, play } from './fruit_bonanza.controller.js';

export const fruitBonanzaRouter = Router();

// A player must be authenticated; the wallet owner comes from the JWT.
fruitBonanzaRouter.use(authGuard);

// Symbols, paylines + paytable (used to draw the cabinet).
fruitBonanzaRouter.get('/config', getConfig);

// Spin the 3×3 reels.
fruitBonanzaRouter.post('/play', play);

export default fruitBonanzaRouter;
