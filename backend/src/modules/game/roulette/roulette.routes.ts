import { Router } from 'express';

import { authGuard } from '../../../common/middleware/authGuard.js';
import { getSegments, play } from './roulette.controller.js';

export const rouletteRouter = Router();

// A player must be authenticated; the wallet owner comes from the JWT.
rouletteRouter.use(authGuard);

// Wheel layout + odds (so clients draw the same table the server uses).
rouletteRouter.get('/segments', getSegments);

// Spin the wheel.
rouletteRouter.post('/play', play);

export default rouletteRouter;
