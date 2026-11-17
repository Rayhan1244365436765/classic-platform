import { Router } from 'express';

import { authGuard } from '../../../common/middleware/authGuard.js';
import { getConfig, play } from './boxing_king.controller.js';

export const boxingKingRouter = Router();

// A player must be authenticated; the wallet owner comes from the JWT.
boxingKingRouter.use(authGuard);

// Symbols + cluster paytable (used to paint the ring).
boxingKingRouter.get('/config', getConfig);

// Drop the gloves: spin the 3×3 board.
boxingKingRouter.post('/play', play);

export default boxingKingRouter;
