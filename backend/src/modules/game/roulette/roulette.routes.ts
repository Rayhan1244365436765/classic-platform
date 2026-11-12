import { Router } from 'express';

import { authGuard } from '../../../common/middleware/authGuard';
import { play } from './roulette.controller';

export const rouletteRouter = Router();

// A player must be authenticated; the wallet owner comes from the JWT.
rouletteRouter.use(authGuard);

rouletteRouter.post('/play', play);

export default rouletteRouter;
