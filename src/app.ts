/**
 * Express application factory.
 *
 * Responsibilities:
 *  - Security middleware (helmet, CORS, CSRF-in-depth)
 *  - HTTP-only session cookies backed by MongoDB
 *  - Route mounting under /api/v1 via routes/index.ts
 *  - Centralised error handling via middleware/errorHandler.ts
 */
import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import helmet from 'helmet';
import cors from 'cors';
import { buildRouter } from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { HttpError } from './errors.js';
import type { Config } from './config/index.js';
import type { PuzzleProvider } from './integrations/banana/banana.client.js';

export function createApp(cfg: Config, provider: PuzzleProvider) {
  const app = express();
  const prod = cfg.NODE_ENV === 'production';
  if (prod) app.set('trust proxy', 1); // needed for Secure cookies behind Nginx/Docker

  app.use(helmet());
  app.use(cors({ origin: cfg.CLIENT_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '10kb' }));
  app.use(session({
    name: 'de.sid',
    secret: cfg.SESSION_SECRET,
    resave: false, saveUninitialized: false, rolling: true, // rolling = idle timeout
    store: MongoStore.create({ mongoUrl: cfg.MONGO_URI, ttl: 24 * 60 * 60 }),
    cookie: { httpOnly: true, secure: prod, sameSite: 'lax', maxAge: 2 * 60 * 60 * 1000 },
  }));

  // CSRF defence in depth: SameSite=Lax + JSON-only bodies + reject state-changing requests from foreign origins.
  app.use((req, _res, next) => {
    const origin = req.get('origin');
    if (req.method !== 'GET' && origin && origin !== cfg.CLIENT_ORIGIN)
      return next(new HttpError(403, 'bad_origin', 'Origin not allowed'));
    next();
  });

  app.use('/api/v1', buildRouter(cfg, provider));
  app.use(errorHandler);

  return app;
}
