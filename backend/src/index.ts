import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { errorHandler } from './common/middleware/errorHandler';
import { PORT } from './config/env';
import { adminRouter } from './modules/admin/admin.routes';
import { authRouter } from './modules/auth/auth.routes';
import { rouletteRouter } from './modules/game/roulette/roulette.routes';
import { paymentRouter } from './modules/payment/payment.routes';
import { walletRouter } from './modules/wallet/wallet.routes';

/**
 * `req.user` is populated by `authGuard` after a successful JWT verification.
 * Declared globally so every route handler and middleware sees the same type.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; role: string };
    }
  }
}

const app: Application = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/api/auth', authRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/payment', paymentRouter);
app.use('/api/game/roulette', rouletteRouter);
app.use('/api/admin', adminRouter);

// Must stay last: Express only treats it as an error handler after all routes.
app.use(errorHandler);

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Casino Platform API listening on port ${PORT}`);
});

export default app;

