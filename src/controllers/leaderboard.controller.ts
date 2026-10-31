import type { RequestHandler } from 'express';
import { z } from 'zod';
import { Game } from '../models/index.js';

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

export const getLeaderboard: RequestHandler = async (req, res) => {
  const q = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  }).parse(req.query);
  res.json(await leaderboard(q.page, q.limit));
};
