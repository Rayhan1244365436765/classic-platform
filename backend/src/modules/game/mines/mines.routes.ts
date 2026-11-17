import { Router } from 'express';

import { authGuard } from '../../../common/middleware/authGuard.js';
import { cashout, current, getTable, reveal, start } from './mines.controller.js';

export const minesRouter = Router();

// A player must be authenticated; the wallet owner comes from the JWT.
minesRouter.use(authGuard);

// Pay table (multiplier per reveal count).
minesRouter.get('/table', getTable);

// The board to resume, if the player reloaded mid-game.
minesRouter.get('/current', current);

// Start a board (debits the stake, hides the mines) …
minesRouter.post('/start', start);

// … open a tile …
minesRouter.post('/reveal', reveal);

// … and cash out the opened tiles.
minesRouter.post('/cashout', cashout);

export default minesRouter;
