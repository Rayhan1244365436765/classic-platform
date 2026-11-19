import { Router } from 'express';

import { authGuard } from '../../../common/middleware/authGuard.js';
import { getConfig, play } from './fortune_gems.controller.js';

export const fortuneGemsRouter = Router();

// A player must be authenticated; the wallet owner comes from the JWT.
fortuneGemsRouter.use(authGuard);

// Symbols, cluster paytable + measured odds (used to draw the cabinet).
fortuneGemsRouter.get('/config', getConfig);

// Spin the 4×3 reels.
fortuneGemsRouter.post('/play', play);

export default fortuneGemsRouter;
