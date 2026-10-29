import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { Game, Puzzle } from './models.js';
import { HttpError } from './errors.js';
import { requireAuth } from './auth.js';
import { UpstreamError, type PuzzleProvider } from './integrations/banana/banana.client.js';
import type { Config } from './config.js';

const oid = (id: string | string[] | undefined) => {
  if (typeof id !== 'string' || !Types.ObjectId.isValid(id)) throw new HttpError(404, 'not_found', 'Not found');
  return new Types.ObjectId(id);
};
const publicGame = (g: InstanceType<typeof Game>) => ({
  id: g.id, status: g.status, keyCollected: !!g.keyCollectedAt, startedAt: g.startedAt,
  wrongAttempts: g.wrongAttempts, lockedUntil: g.lockedUntil ?? null, score: g.score ?? null,
});
// Only these fields ever reach the browser. The solution is deliberately absent.
const publicPuzzle = (p: InstanceType<typeof Puzzle>, max: number) => ({
  id: p.id, imageUrl: p.imageUrl, expiresAt: p.expiresAt, attemptsRemaining: Math.max(0, max - p.attempts),
});

export function gamesRouter(cfg: Config, provider: PuzzleProvider) {
  const r = Router();
  r.use(requireAuth);

  // Ownership is part of every query: another user's id yields 404, not 403 (no existence leak).
  const ownedGame = async (id: string | string[] | undefined, userId: string | undefined) => {
    const game = await Game.findOne({ _id: oid(id), user: userId });
    if (!game) throw new HttpError(404, 'not_found', 'Game not found');
    return game;
  };

  r.post('/games', async (req, res) => {
    const game = await Game.create({ user: req.session.userId });
    res.status(201).json(publicGame(game));
  });

  r.get('/games/:gameId', async (req, res) => res.json(publicGame(await ownedGame(req.params.gameId, req.session.userId))));

  r.post('/games/:gameId/key', async (req, res) => {
    const game = await ownedGame(req.params.gameId, req.session.userId);
    if (game.status !== 'IN_PROGRESS') throw new HttpError(409, 'invalid_state', 'Game is not in progress');
    game.keyCollectedAt ??= new Date();
    await game.save();
    res.json(publicGame(game));
  });

  r.post('/games/:gameId/puzzles', async (req, res) => {
    const game = await ownedGame(req.params.gameId, req.session.userId);
    if (game.status !== 'IN_PROGRESS' || !game.keyCollectedAt) throw new HttpError(409, 'invalid_state', 'Collect the key first');
    if (game.lockedUntil && game.lockedUntil > new Date()) {
      throw new HttpError(429, 'cooldown', `Locked out until ${game.lockedUntil.toISOString()}`);
    }
    // Idempotent: reuse the live puzzle so re-requesting cannot be used to dodge the attempt limit.
    const live = await Puzzle.findOne({ game: game._id, status: 'ACTIVE', expiresAt: { $gt: new Date() } });
    if (live) return void res.json(publicPuzzle(live, cfg.MAX_ATTEMPTS));

    let upstream;
    try {
      upstream = await provider.fetchPuzzle();
    } catch (err) {
      if (err instanceof UpstreamError) throw new HttpError(502, 'puzzle_service_unavailable', 'Puzzle service unavailable, try again');
      throw err;
    }
    const puzzle = await Puzzle.create({
      game: game._id, user: game.user, imageUrl: upstream.imageUrl, solution: upstream.solution,
      expiresAt: new Date(Date.now() + cfg.PUZZLE_TTL_S * 1000),
    });
    res.status(201).json(publicPuzzle(puzzle, cfg.MAX_ATTEMPTS));
  });

  r.post('/puzzles/:puzzleId/verify', async (req, res) => {
    const { answer } = z.object({ answer: z.number().int().min(0).max(99) }).strict().parse(req.body);
    const now = new Date();
    // Atomic claim of one attempt: concurrent submissions cannot exceed MAX_ATTEMPTS.
    const puzzle = await Puzzle.findOneAndUpdate(
      { _id: oid(req.params.puzzleId), user: req.session.userId, status: 'ACTIVE', expiresAt: { $gt: now }, attempts: { $lt: cfg.MAX_ATTEMPTS } },
      { $inc: { attempts: 1 } }, { new: true },
    ).select('+solution');
    if (!puzzle) {
      const exists = await Puzzle.exists({ _id: oid(req.params.puzzleId), user: req.session.userId });
      throw exists ? new HttpError(410, 'puzzle_closed', 'Puzzle expired, solved or out of attempts') : new HttpError(404, 'not_found', 'Puzzle not found');
    }

    if (puzzle.solution === answer) {
      puzzle.status = 'SOLVED';
      await puzzle.save();
      await Game.updateOne({ _id: puzzle.game, user: puzzle.user, status: 'IN_PROGRESS' }, { status: 'DOOR_UNLOCKED' });
      return void res.json({ correct: true });
    }

    await Game.updateOne({ _id: puzzle.game }, { $inc: { wrongAttempts: 1 } });
    const attemptsRemaining = cfg.MAX_ATTEMPTS - puzzle.attempts;
    if (attemptsRemaining <= 0) {
      puzzle.status = 'FAILED';
      await puzzle.save();
      await Game.updateOne({ _id: puzzle.game }, { lockedUntil: new Date(Date.now() + cfg.COOLDOWN_S * 1000) });
    }
    res.json({ correct: false, attemptsRemaining });
  });

  r.post('/games/:gameId/complete', async (req, res) => {
    const game = await ownedGame(req.params.gameId, req.session.userId);
    const durationMs = Date.now() - game.startedAt.getTime();
    if (durationMs < cfg.MIN_COMPLETION_S * 1000) throw new HttpError(409, 'too_fast', 'Completion rejected');
    // Score is computed here, never accepted from the client. The status filter makes completion single-use.
    const score = Math.max(100, 1000 - Math.floor(durationMs / 1000) * 2 - game.wrongAttempts * 50);
    const done = await Game.findOneAndUpdate(
      { _id: game._id, user: game.user, status: 'DOOR_UNLOCKED' },
      { status: 'COMPLETED', completedAt: new Date(), durationMs, score }, { new: true },
    );
    if (!done) throw new HttpError(409, 'invalid_state', 'Door has not been unlocked');
    res.json({ ...publicGame(done), durationMs });
  });

  r.get('/users/me/stats', async (req, res) => {
    const [row] = await Game.aggregate([
      { $match: { user: new Types.ObjectId(req.session.userId), status: 'COMPLETED' } },
      { $group: { _id: null, completed: { $sum: 1 }, totalScore: { $sum: '$score' }, bestTimeMs: { $min: '$durationMs' } } },
    ]);
    const recent = await Game.find({ user: req.session.userId }).sort({ startedAt: -1 }).limit(10);
    res.json({ completed: row?.completed ?? 0, totalScore: row?.totalScore ?? 0, bestTimeMs: row?.bestTimeMs ?? null, recent: recent.map(publicGame) });
  });

  return r;
}

/** Ranking: best score per player, then faster time, then user id (deterministic tie-break). */
export async function leaderboard(page: number, limit: number) {
  return Game.aggregate([
    { $match: { status: 'COMPLETED' } },
    { $sort: { score: -1, durationMs: 1 } },
    { $group: { _id: '$user', score: { $first: '$score' }, durationMs: { $first: '$durationMs' } } },
    { $sort: { score: -1, durationMs: 1, _id: 1 } },
    { $skip: (page - 1) * limit }, { $limit: limit },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
    { $project: { _id: 0, displayName: { $first: '$u.displayName' }, score: 1, durationMs: 1 } },
  ]);
}
