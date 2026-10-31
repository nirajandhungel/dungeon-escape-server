/**
 * Central router — mounts all versioned routes under /api/v1.
 * Import this once in app.ts; add new route files here as the API grows.
 */
import { Router } from 'express';
import { authRouter } from './auth.routes.js';
import { gamesRouter } from './games.routes.js';
import { getLeaderboard } from '../controllers/leaderboard.controller.js';
import type { Config } from '../config/index.js';
import type { PuzzleProvider } from '../integrations/banana/banana.client.js';

export function buildRouter(cfg: Config, provider: PuzzleProvider) {
  const v1 = Router();

  v1.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));
  v1.get('/leaderboard', getLeaderboard);
  v1.use('/auth',  authRouter(cfg));
  v1.use(gamesRouter(cfg, provider));

  return v1;
}
