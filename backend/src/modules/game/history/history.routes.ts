import { Router } from 'express';

import { authGuard } from '../../../common/middleware/authGuard.js';
import { getHistory } from './history.controller.js';

export const historyRouter = Router();

// A player must be authenticated; the owner comes from the JWT.
historyRouter.use(authGuard);

historyRouter.get('/', getHistory);

export default historyRouter;