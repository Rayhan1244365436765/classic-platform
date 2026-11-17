import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { errorHandler } from './common/middleware/errorHandler.js';
import { CORS_ORIGIN, NODE_ENV, PORT, isProduction } from './config/env.js';
import { pool } from './config/db.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { blackjackRouter } from './modules/game/blackjack/blackjack.routes.js';
import { boxingKingRouter } from './modules/game/boxing_king/boxing_king.routes.js';
import { baccaratRouter } from './modules/game/baccarat/baccarat.routes.js';
import { cascadeRouter } from './modules/game/cascade/cascade.routes.js';
import { classicRouletteRouter } from './modules/game/classic_roulette/classic_roulette.routes.js';
import { rouletteRouter } from './modules/game/roulette/roulette.routes.js';
import { aviatorRouter } from './modules/game/aviator/aviator.routes.js';
import { diceRouter } from './modules/game/dice/dice.routes.js';
import { dice3dRouter } from './modules/game/dice3d/dice3d.routes.js';
import { fruitBonanzaRouter } from './modules/game/fruit_bonanza/fruit_bonanza.routes.js';
import { dragontigerRouter } from './modules/game/dragontiger/dragontiger.routes.js';
import { kenoRouter } from './modules/game/keno/keno.routes.js';
import { minesRouter } from './modules/game/mines/mines.routes.js';
import { plinkoRouter } from './modules/game/plinko/plinko.routes.js';
import { slotsRouter } from './modules/game/slots/slots.routes.js';
import { teenpattiRouter } from './modules/game/teenpatti/teenpatti.routes.js';
import { paymentRouter } from './modules/payment/payment.routes.js';
import { walletRouter } from './modules/wallet/wallet.routes.js';

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

// Behind nginx: trust exactly one hop so `req.ip` and `req.protocol` reflect the
// real client instead of the proxy container.
if (isProduction) {
  app.set('trust proxy', 1);
}

app.use(helmet());
// Same-origin in production (nginx serves the apps and proxies /api), so this only
// matters when CORS_ORIGIN lists extra hosts.
app.use(CORS_ORIGIN.length > 0 ? cors({ origin: CORS_ORIGIN }) : cors());
app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/api/auth', authRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/payment', paymentRouter);
app.use('/api/game/roulette', rouletteRouter);
app.use('/api/game/slots', slotsRouter);
app.use('/api/game/dice', diceRouter);
app.use('/api/game/aviator', aviatorRouter);
app.use('/api/game/mines', minesRouter);
app.use('/api/game/plinko', plinkoRouter);
app.use('/api/game/blackjack', blackjackRouter);
app.use('/api/game/keno', kenoRouter);
app.use('/api/game/baccarat', baccaratRouter);
app.use('/api/game/dragontiger', dragontigerRouter);
app.use('/api/game/teenpatti', teenpattiRouter);
app.use('/api/game/cascade', cascadeRouter);
app.use('/api/game/classic_roulette', classicRouletteRouter);
app.use('/api/game/fruit_bonanza', fruitBonanzaRouter);
app.use('/api/game/dice3d', dice3dRouter);
app.use('/api/game/boxing_king', boxingKingRouter);
app.use('/api/admin', adminRouter);

// Must stay last: Express only treats it as an error handler after all routes.
app.use(errorHandler);

const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Casino Platform API listening on port ${PORT} (${NODE_ENV})`);
});

/**
 * Finish in-flight requests before exiting.
 *
 * `docker compose up -d --build` sends SIGTERM; without this, a bet could be cut
 * mid-transaction. New connections stop immediately, the process waits up to 10 s
 * for the open ones and closes the pool, then exits.
 */
function shutdown(signal: string): void {
  // eslint-disable-next-line no-console
  console.log(`[server] ${signal} received — draining connections…`);

  server.close(() => {
    void pool
      .end()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  });

  // Never hang a deploy on a stuck socket.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;

