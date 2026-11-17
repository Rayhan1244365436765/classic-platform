import { Router } from 'express';

import { authGuard } from '../../../common/middleware/authGuard.js';
import { current, hitCard, standHand, start } from './blackjack.controller.js';

export const blackjackRouter = Router();

// A player must be authenticated; the wallet owner comes from the JWT.
blackjackRouter.use(authGuard);

// The hand to resume, if the player reloaded mid-hand.
blackjackRouter.get('/current', current);

// Deal a hand (debits the stake, hides the hole card) …
blackjackRouter.post('/start', start);

// … take a card …
blackjackRouter.post('/hit', hitCard);

// … or stand and let the dealer play out.
blackjackRouter.post('/stand', standHand);

export default blackjackRouter;
