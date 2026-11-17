import { Router } from 'express';

import { authGuard } from '../../../common/middleware/authGuard.js';
import { cashout, crash, getConfig, start } from './aviator.controller.js';

export const aviatorRouter = Router();

// A player must be authenticated; the wallet owner comes from the JWT.
aviatorRouter.use(authGuard);

// Growth curve constants (used to animate the flight).
aviatorRouter.get('/config', getConfig);

// Open a round (debits the stake) …
aviatorRouter.post('/start', start);

// … and settle it before the plane bursts.
aviatorRouter.post('/cashout', cashout);

// Forfeit a round whose flight time already ran out on the client.
aviatorRouter.post('/crash', crash);

export default aviatorRouter;
