/**
 * Express application factory.
 *
 * Responsibilities:
 *  - Security middleware (helmet, CORS, CSRF-in-depth)
 *  - HTTP-only session cookies backed by MongoDB
 *  - Route mounting: /auth, /games, /puzzles, /leaderboard, /users
 *  - Image proxy: /api/v1/puzzle-image?url=… — fetches Banana puzzle images
 *    server-side so the browser never makes an HTTP request (mixed-content fix)
 *  - Centralised error handling: ZodError → 400, HttpError → status, else 500
 */
import express, { type ErrorRequestHandler } from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import helmet from 'helmet';
import cors from 'cors';
import { ZodError, z } from 'zod';
import { authRouter } from './auth.js';
import { gamesRouter, leaderboard } from './games.js';
import { HttpError } from './errors.js';
import type { Config } from './config.js';
import type { PuzzleProvider } from './integrations/banana/banana.client.js';

export function createApp(cfg: Config, provider: PuzzleProvider) {
  const app = express();
  const prod = cfg.NODE_ENV === 'production';
  if (prod) app.set('trust proxy', 1); // needed for Secure cookies behind Nginx/Docker

  app.use(helmet({
    // Allow the puzzle images (from sanfoh.com) to load after the server proxies them.
    contentSecurityPolicy: false,
  }));
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
    if (req.method !== 'GET' && origin && origin !== cfg.CLIENT_ORIGIN) return next(new HttpError(403, 'bad_origin', 'Origin not allowed'));
    next();
  });

  const v1 = express.Router();
  v1.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

  /**
   * Image Proxy — Interoperability boundary note:
   * The Banana API returns image URLs that use HTTP (even after the API itself moved to HTTPS).
   * A browser loading an HTTPS page cannot request HTTP images (mixed-content policy).
   * This proxy fetches the upstream image server-side and streams it to the client, so
   * the browser makes a same-origin HTTPS request instead.
   *
   * Protocol: HTTP GET to the upstream (external) server, pipe response to client.
   * Only URLs from the known Banana image host (sanfoh.com) are allowed to prevent
   * this endpoint being used as an open proxy.
   *
   * Event-driven note: this route is called reactively when the PuzzleModal component
   * mounts and needs to render the puzzle image.
   */
  v1.get('/puzzle-image', async (req, res, next) => {
    try {
      const { url } = z.object({ url: z.string().url() }).parse(req.query);
      const parsed = new URL(url);
      // Allowlist: only proxy images from the Banana puzzle image host.
      if (!parsed.hostname.endsWith('sanfoh.com') && !parsed.hostname.endsWith('marcconrad.com')) {
        return void res.status(403).json({ error: 'forbidden_host', message: 'Image host not allowed' });
      }
      const upstream = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!upstream.ok) return void res.status(502).json({ error: 'upstream_error' });
      const ct = upstream.headers.get('content-type') ?? 'image/png';
      res.setHeader('content-type', ct);
      res.setHeader('cache-control', 'public, max-age=300'); // 5 min — puzzle TTL matches
      // Stream the upstream body to the response
      if (upstream.body) {
        const reader = upstream.body.getReader();
        const pump = async () => {
          const { done, value } = await reader.read();
          if (done) { res.end(); return; }
          res.write(value);
          await pump();
        };
        await pump();
      } else {
        res.end();
      }
    } catch (err) {
      next(err);
    }
  });

  v1.use('/auth', authRouter(cfg));
  v1.get('/leaderboard', async (req, res) => {
    const q = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(10) }).parse(req.query);
    res.json(await leaderboard(q.page, q.limit));
  });
  v1.use(gamesRouter(cfg, provider));
  app.use('/api/v1', v1);

  const onError: ErrorRequestHandler = (err, req, res, _next) => {
    if (err instanceof ZodError) return void res.status(400).json({ error: 'validation_error', issues: err.issues.map((i) => ({ path: i.path, message: i.message })) });
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.code, message: err.message });
    console.error(JSON.stringify({ level: 'error', msg: err instanceof Error ? err.message : 'unknown', path: req.path }));
    res.status(500).json({ error: 'internal_error' });
  };
  app.use(onError);
  return app;
}
