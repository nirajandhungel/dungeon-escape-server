import { Router } from 'express';
import { buildGameHandlers } from '../controllers/games.controller.js';
import { requireAuth } from '../middleware/requireAuth.js';
import type { Config } from '../config/index.js';
import type { PuzzleProvider } from '../integrations/banana/banana.client.js';

export function gamesRouter(cfg: Config, provider: PuzzleProvider) {
  const r = Router();
  const h = buildGameHandlers(cfg, provider);

  // All game routes require authentication
  r.use(requireAuth);

  // Game lifecycle
  r.post('/games',                   h.createGame);
  r.get('/games/current',            h.currentGame);   // declared before /:gameId
  r.get('/games/:gameId',            h.getGame);
  r.post('/games/:gameId/key',       h.collectKey);
  r.post('/games/:gameId/puzzles',   h.requestPuzzle);
  r.post('/games/:gameId/advance',   h.advanceChapter);
  r.post('/games/:gameId/complete',  h.completeGame);

  // Puzzle image — owner-checked
  r.get('/puzzles/:puzzleId/image',  h.getPuzzleImage);
  r.post('/puzzles/:puzzleId/verify', h.verifyAnswer);

  // Player stats & cosmetics
  r.get('/users/me/stats', h.getStats);
  r.put('/users/me/cape',  h.setCape);

  return r;
}
