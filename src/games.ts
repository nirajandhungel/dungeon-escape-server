import { randomInt } from 'node:crypto';
import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { Game, Puzzle, User } from './models.js';
import { HttpError } from './errors.js';
import { requireAuth } from './auth.js';
import { CAPES, earned, playerTotals, scoreRun } from './rewards.js';
import { UpstreamError, type PuzzleProvider } from './integrations/banana/banana.client.js';
import type { Config } from './config.js';

const oid = (id: string | string[] | undefined) => {
  if (typeof id !== 'string' || !Types.ObjectId.isValid(id)) throw new HttpError(404, 'not_found', 'Not found');
  return new Types.ObjectId(id);
};
const ACTIVE_STATES = ['IN_PROGRESS', 'DOOR_UNLOCKED'];

/**
 * A run is a campaign: CHAPTER_DOORS.length chapters, each with N sealed doors. Every door needs its own key
 * (collected in that room) AND its own Banana puzzle; all state transitions below are atomic and filter-guarded,
 * so replays and concurrent requests can never double-count a door or skip one.
 */
export function gamesRouter(cfg: Config, provider: PuzzleProvider) {
  const r = Router();
  r.use(requireAuth);

  const levelCount = cfg.CHAPTER_DOORS.length;
  const doorsTotal = cfg.CHAPTER_DOORS.reduce((a, b) => a + b, 0);
  const doorsIn = (g: { level: number }) => cfg.CHAPTER_DOORS[g.level] ?? 0;

  const publicGame = (g: InstanceType<typeof Game>) => ({
    id: g.id, status: g.status, level: g.level, levelCount, doorsInLevel: doorsIn(g),
    keysCollected: g.keysCollected, doorsOpened: g.doorsOpened, doorsTotal, doorsOpenedTotal: g.doorsOpenedTotal,
    seed: g.seed, difficulty: g.difficulty, startedAt: g.startedAt, wrongAttempts: g.wrongAttempts,
    lockedUntil: g.lockedUntil ?? null, score: g.score ?? null, rank: g.rank ?? null,
    relics: g.status === 'COMPLETED' ? levelCount : g.level,   // chapters cleared
  });
  // Only these fields ever reach the browser. Neither the solution nor the image bytes are in the JSON;
  // the image is fetched from an owner-checked route, so no upstream URL (which encodes the answer) is exposed.
  const publicPuzzle = (p: InstanceType<typeof Puzzle>) => ({
    id: p.id, imageUrl: `/api/v1/puzzles/${p.id}/image`, expiresAt: p.expiresAt,
    attemptsRemaining: Math.max(0, p.maxAttempts - p.attempts), maxAttempts: p.maxAttempts,
  });

  // Ownership is part of every query: another user's id yields 404, not 403 (no existence leak).
  const ownedGame = async (id: string | string[] | undefined, userId: string | undefined) => {
    const game = await Game.findOne({ _id: oid(id), user: userId });
    if (!game) throw new HttpError(404, 'not_found', 'Game not found');
    return game;
  };
  // A puzzle that exists for this user but is no longer ACTIVE is 410; anything else is 404.
  const puzzleClosed = async (puzzleId: Types.ObjectId, userId: string | undefined) =>
    (await Puzzle.exists({ _id: puzzleId, user: userId }))
      ? new HttpError(410, 'puzzle_closed', 'Puzzle expired, solved or out of attempts')
      : new HttpError(404, 'not_found', 'Puzzle not found');

  r.post('/games', async (req, res) => {
    const { difficulty } = z.object({ difficulty: z.enum(['normal', 'hard']).default('normal') }).strict().parse(req.body ?? {});
    // Meta-progression: Hard is unlocked by completing one campaign.
    if (difficulty === 'hard' && !(await Game.exists({ user: req.session.userId, status: 'COMPLETED' }))) {
      throw new HttpError(403, 'hard_locked', 'Complete a campaign on Normal to unlock Hard');
    }
    // One live run per player: starting a new one abandons the old one.
    await Game.updateMany({ user: req.session.userId, status: { $in: ACTIVE_STATES } }, { status: 'ABANDONED' });
    const game = await Game.create({ user: req.session.userId, difficulty, seed: randomInt(1, 2_147_483_648) });
    res.status(201).json(publicGame(game));
  });

  // Declared before /games/:gameId. 204 (not 404) when there is nothing to resume.
  r.get('/games/current', async (req, res) => {
    const since = new Date(Date.now() - cfg.RESUME_WINDOW_S * 1000);
    const game = await Game.findOne({ user: req.session.userId, status: { $in: ACTIVE_STATES }, updatedAt: { $gte: since } })
      .sort({ updatedAt: -1 });
    if (!game) return void res.status(204).end();
    res.json(publicGame(game));
  });

  r.get('/games/:gameId', async (req, res) => res.json(publicGame(await ownedGame(req.params.gameId, req.session.userId))));

  // A key can only be collected for the next unopened door of the current chapter.
  r.post('/games/:gameId/key', async (req, res) => {
    const { index } = z.object({ index: z.number().int().min(0) }).strict().parse(req.body);
    const game = await ownedGame(req.params.gameId, req.session.userId);
    if (game.status !== 'IN_PROGRESS') throw new HttpError(409, 'invalid_state', 'Game is not in progress');
    if (index < game.keysCollected) return void res.json(publicGame(game)); // idempotent
    if (index !== game.doorsOpened || index >= doorsIn(game)) throw new HttpError(409, 'invalid_state', 'That key is not available yet');
    const next = await Game.findOneAndUpdate(
      { _id: game._id, user: game.user, status: 'IN_PROGRESS', doorsOpened: index, keysCollected: index },
      { keysCollected: index + 1 }, { new: true },
    );
    if (!next) throw new HttpError(409, 'invalid_state', 'That key is not available yet');
    res.json(publicGame(next));
  });

  r.post('/games/:gameId/puzzles', async (req, res) => {
    const game = await ownedGame(req.params.gameId, req.session.userId);
    if (game.status !== 'IN_PROGRESS' || game.keysCollected <= game.doorsOpened) throw new HttpError(409, 'invalid_state', 'Collect the key first');
    if (game.lockedUntil && game.lockedUntil > new Date()) {
      throw new HttpError(429, 'cooldown', `Locked out until ${game.lockedUntil.toISOString()}`);
    }
    // Idempotent: reuse the live puzzle so re-requesting cannot be used to dodge the attempt limit.
    const live = await Puzzle.findOne({ game: game._id, door: game.doorsOpened, status: 'ACTIVE', expiresAt: { $gt: new Date() } });
    if (live) return void res.json(publicPuzzle(live));

    let upstream;
    try {
      upstream = await provider.fetchPuzzle();
    } catch (err) {
      if (err instanceof UpstreamError) throw new HttpError(502, 'puzzle_service_unavailable', 'Puzzle service unavailable, try again');
      throw err;
    }
    const puzzle = await Puzzle.create({
      game: game._id, user: game.user, door: game.doorsOpened, image: upstream.image, imageType: upstream.contentType,
      solution: upstream.solution, maxAttempts: game.difficulty === 'hard' ? cfg.HARD_MAX_ATTEMPTS : cfg.MAX_ATTEMPTS,
      expiresAt: new Date(Date.now() + cfg.PUZZLE_TTL_S * 1000),
    });
    await Game.updateOne({ _id: game._id }, { $set: { updatedAt: new Date() } }); // activity keeps the run resumable
    res.status(201).json(publicPuzzle(puzzle));
  });

  r.get('/puzzles/:puzzleId/image', async (req, res) => {
    const id = oid(req.params.puzzleId);
    const puzzle = await Puzzle.findOne({ _id: id, user: req.session.userId, status: 'ACTIVE', expiresAt: { $gt: new Date() } }).select('+image');
    if (!puzzle) throw await puzzleClosed(id, req.session.userId);
    res.set({ 'content-type': puzzle.imageType, 'cache-control': 'private, no-store' }).send(puzzle.image);
  });

  r.post('/puzzles/:puzzleId/verify', async (req, res) => {
    const { answer } = z.object({ answer: z.number().int().min(0).max(9) }).strict().parse(req.body);
    const id = oid(req.params.puzzleId);
    const now = new Date();
    // Atomic claim of one attempt: concurrent submissions cannot exceed the puzzle's limit (3 Normal / 2 Hard).
    const puzzle = await Puzzle.findOneAndUpdate(
      { _id: id, user: req.session.userId, status: 'ACTIVE', expiresAt: { $gt: now }, $expr: { $lt: ['$attempts', '$maxAttempts'] } },
      { $inc: { attempts: 1 } }, { new: true },
    ).select('+solution');
    if (!puzzle) throw await puzzleClosed(id, req.session.userId);

    if (puzzle.solution === answer) {
      // Seal the puzzle first (only one concurrent winner), then open exactly the door it was issued for.
      if (!(await Puzzle.updateOne({ _id: id, status: 'ACTIVE' }, { status: 'SOLVED' })).modifiedCount) throw await puzzleClosed(id, req.session.userId);
      const g = await Game.findOneAndUpdate(
        { _id: puzzle.game, user: puzzle.user, status: 'IN_PROGRESS', doorsOpened: puzzle.door },
        { $inc: { doorsOpened: 1, doorsOpenedTotal: 1, puzzlesSolved: 1, firstTryDoors: puzzle.attempts === 1 ? 1 : 0 } }, { new: true },
      );
      if (!g) throw new HttpError(409, 'invalid_state', 'This run is no longer active');
      const chapterUnlocked = g.doorsOpened >= doorsIn(g);
      if (chapterUnlocked) await Game.updateOne({ _id: g._id, status: 'IN_PROGRESS' }, { status: 'DOOR_UNLOCKED' });
      return void res.json({ correct: true, doorsOpened: g.doorsOpened, doorsInLevel: doorsIn(g), chapterUnlocked });
    }

    await Game.updateOne({ _id: puzzle.game }, { $inc: { wrongAttempts: 1 } });
    const attemptsRemaining = puzzle.maxAttempts - puzzle.attempts;
    if (attemptsRemaining <= 0) {
      puzzle.status = 'FAILED';
      await puzzle.save();
      await Game.updateOne({ _id: puzzle.game }, { lockedUntil: new Date(Date.now() + cfg.COOLDOWN_S * 1000) });
    }
    res.json({ correct: false, attemptsRemaining });
  });

  // Next chapter. The status/level filter makes it single-use; it needs EVERY door of the chapter open.
  r.post('/games/:gameId/advance', async (req, res) => {
    const game = await ownedGame(req.params.gameId, req.session.userId);
    const next = await Game.findOneAndUpdate(
      { _id: game._id, user: game.user, status: 'DOOR_UNLOCKED', level: { $lt: levelCount - 1 } },
      { $inc: { level: 1 }, status: 'IN_PROGRESS', keysCollected: 0, doorsOpened: 0 }, { new: true },
    );
    if (!next) throw new HttpError(409, 'invalid_state', 'Chapter not cleared or no further chapter');
    await Puzzle.updateMany({ game: game._id, status: 'ACTIVE' }, { status: 'EXPIRED' }); // nothing from the old chapter stays live
    res.json(publicGame(next));
  });

  r.post('/games/:gameId/complete', async (req, res) => {
    const game = await ownedGame(req.params.gameId, req.session.userId);
    const durationMs = Date.now() - game.startedAt.getTime();
    if (durationMs < cfg.MIN_COMPLETION_S * 1000) throw new HttpError(409, 'too_fast', 'Completion rejected');
    // Score and rank are computed here, never accepted from the client. The status/level filter makes completion single-use.
    const { score, rank } = scoreRun(durationMs, game.wrongAttempts, game.firstTryDoors, game.difficulty === 'hard');
    const before = earned(await playerTotals(game.user, levelCount));
    const done = await Game.findOneAndUpdate(
      { _id: game._id, user: game.user, status: 'DOOR_UNLOCKED', level: levelCount - 1 },
      { status: 'COMPLETED', completedAt: new Date(), durationMs, score, rank }, { new: true },
    );
    if (!done) throw new HttpError(409, 'invalid_state', 'The final door has not been opened');
    const after = earned(await playerTotals(game.user, levelCount));
    const seenA = new Set(before.achievements.map((a) => a.id));
    const seenC = new Set(before.capes.filter((c) => c.unlocked).map((c) => c.id));
    res.json({
      ...publicGame(done), durationMs,
      rewards: {
        score, rank, relics: levelCount,
        newAchievements: after.achievements.filter((a) => !seenA.has(a.id)),
        newCapes: after.capes.filter((c) => c.unlocked && !seenC.has(c.id)).map(({ id, name, color }) => ({ id, name, color })),
      },
    });
  });

  r.get('/users/me/stats', async (req, res) => {
    const t = await playerTotals(req.session.userId, levelCount);
    const { achievements, capes } = earned(t);
    const [user, recent] = await Promise.all([
      User.findById(req.session.userId),
      Game.find({ user: req.session.userId }).sort({ startedAt: -1 }).limit(10),
    ]);
    res.json({
      completed: t.completed, runs: t.runs, totalScore: t.totalScore, bestScore: t.bestScore, bestTimeMs: t.bestTimeMs,
      puzzlesSolved: t.puzzlesSolved, relicsTotal: t.relicsTotal, levelsCleared: t.levelsCleared,
      achievements, capes, cape: user?.cape ?? 'crimson', hardUnlocked: t.completed >= 1, recent: recent.map(publicGame),
    });
  });

  r.put('/users/me/cape', async (req, res) => {
    const { cape } = z.object({ cape: z.string().min(1).max(32) }).strict().parse(req.body);
    if (!CAPES.some((c) => c.id === cape)) throw new HttpError(400, 'unknown_cape', 'Unknown cape');
    const { capes } = earned(await playerTotals(req.session.userId, levelCount));
    if (!capes.find((c) => c.id === cape)?.unlocked) throw new HttpError(403, 'cape_locked', 'That cape is not unlocked yet');
    await User.updateOne({ _id: req.session.userId }, { cape });
    res.json({ cape });
  });

  return r;
}

/** Ranking: best score per player, then faster time, then user id (deterministic tie-break). Hard scores carry the 1.5× multiplier. */
export async function leaderboard(page: number, limit: number) {
  return Game.aggregate([
    { $match: { status: 'COMPLETED' } },
    { $sort: { score: -1, durationMs: 1 } },
    { $group: { _id: '$user', score: { $first: '$score' }, durationMs: { $first: '$durationMs' }, rank: { $first: '$rank' }, difficulty: { $first: '$difficulty' } } },
    { $sort: { score: -1, durationMs: 1, _id: 1 } },
    { $skip: (page - 1) * limit }, { $limit: limit },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
    { $project: { _id: 0, displayName: { $first: '$u.displayName' }, score: 1, durationMs: 1, rank: 1, difficulty: 1 } },
  ]);
}
