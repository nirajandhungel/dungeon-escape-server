/**
 * Pure reward rules: score, rank, achievements and cape cosmetics. No I/O here except `playerTotals`, which is the single
 * aggregate query everything else (stats, completion rewards, cape equip) is derived from — nothing is stored twice.
 */
import { Types } from 'mongoose';
import { Game } from './models.js';

/** Score = (time/mistake-based base + first-try bonus) × difficulty multiplier. Rank uses the un-multiplied score. */
export function scoreRun(durationMs: number, wrongAttempts: number, firstTryDoors: number, hard: boolean) {
  const base = Math.max(500, 8000 - 3 * Math.floor(durationMs / 1000) - 120 * wrongAttempts);
  const mult = hard ? 1.5 : 1;
  const score = Math.round((base + 150 * firstTryDoors) * mult);
  const s = score / mult;
  return { score, rank: s >= 8000 ? 'S' : s >= 6000 ? 'A' : s >= 4000 ? 'B' : 'C' } as const;
}

export interface Totals {
  runs: number; completed: number; flawless: number; hardWon: number; rankS: number; totalScore: number;
  bestScore: number | null; bestTimeMs: number | null; puzzlesSolved: number; relicsTotal: number; levelsCleared: number;
}

export const ACHIEVEMENTS = [
  { id: 'first-escape', title: 'First Escape', description: 'Complete a full campaign.', ok: (t: Totals) => t.completed >= 1 },
  { id: 'flawless', title: 'Flawless', description: 'Finish a campaign without a single wrong answer.', ok: (t: Totals) => t.flawless >= 1 },
  { id: 'speed-runner', title: 'Speed Runner', description: 'Finish a campaign in under 12 minutes.', ok: (t: Totals) => t.bestTimeMs !== null && t.bestTimeMs < 720_000 },
  { id: 'oracle-friend', title: "Oracle's Friend", description: 'Solve 25 Banana puzzles across all runs.', ok: (t: Totals) => t.puzzlesSolved >= 25 },
  { id: 'veteran', title: 'Veteran', description: 'Complete 3 campaigns.', ok: (t: Totals) => t.completed >= 3 },
  { id: 'hard-won', title: 'Hard Won', description: 'Complete a campaign on Hard.', ok: (t: Totals) => t.hardWon >= 1 },
  { id: 'relic-hunter', title: 'Relic Hunter', description: 'Collect 10 relics (chapters cleared) across all runs.', ok: (t: Totals) => t.relicsTotal >= 10 },
  { id: 'rank-s', title: 'Rank S', description: 'Finish a campaign with rank S.', ok: (t: Totals) => t.rankS >= 1 },
];

/** `by` = the achievement that unlocks the cape (null = always available). */
export const CAPES = [
  { id: 'crimson', name: 'Crimson', color: '#8a2a2a', by: null },
  { id: 'gold', name: 'Gilded', color: '#d6a84f', by: 'first-escape' },
  { id: 'emerald', name: 'Emerald', color: '#2f9e6e', by: 'flawless' },
  { id: 'azure', name: 'Azure', color: '#3a6fd8', by: 'veteran' },
  { id: 'violet', name: 'Violet', color: '#7a4fd6', by: 'hard-won' },
  { id: 'ember', name: 'Ember', color: '#e0702a', by: 'relic-hunter' },
  { id: 'ivory', name: 'Ivory', color: '#e8e2d0', by: 'rank-s' },
  { id: 'obsidian', name: 'Obsidian', color: '#23252e', by: 'oracle-friend' },
] as const;

export function earned(t: Totals) {
  const achievements = ACHIEVEMENTS.filter((a) => a.ok(t)).map(({ id, title, description }) => ({ id, title, description }));
  const ids = new Set(achievements.map((a) => a.id));
  const capes = CAPES.map(({ id, name, color, by }) => ({ id, name, color, unlocked: by === null || ids.has(by) }));
  return { achievements, capes };
}

/** One aggregate over all of a player's runs. `levelCount` = chapters per run (CHAPTER_DOORS.length). */
export async function playerTotals(uid: string | Types.ObjectId | undefined, levelCount: number): Promise<Totals> {
  const done = { $eq: ['$status', 'COMPLETED'] };
  const one = (cond: unknown) => ({ $sum: { $cond: [cond, 1, 0] } });
  const [row] = await Game.aggregate([
    { $match: { user: new Types.ObjectId(String(uid)) } },
    { $group: {
      _id: null,
      runs: { $sum: 1 },
      completed: one(done),
      flawless: one({ $and: [done, { $eq: ['$wrongAttempts', 0] }] }),
      hardWon: one({ $and: [done, { $eq: ['$difficulty', 'hard'] }] }),
      rankS: one({ $and: [done, { $eq: ['$rank', 'S'] }] }),
      totalScore: { $sum: { $ifNull: ['$score', 0] } },
      bestScore: { $max: '$score' },
      bestTimeMs: { $min: '$durationMs' }, // only completed runs carry a duration
      puzzlesSolved: { $sum: { $ifNull: ['$puzzlesSolved', 0] } },
      relicsTotal: { $sum: { $cond: [done, levelCount, { $ifNull: ['$level', 0] }] } },
      levelsCleared: { $sum: { $cond: [done, levelCount, { $add: [{ $ifNull: ['$level', 0] }, { $cond: [{ $eq: ['$status', 'DOOR_UNLOCKED'] }, 1, 0] }] }] } },
    } },
  ]);
  const { _id, ...sums } = row ?? {};
  void _id;
  return { runs: 0, completed: 0, flawless: 0, hardWon: 0, rankS: 0, totalScore: 0, bestScore: null, bestTimeMs: null, puzzlesSolved: 0, relicsTotal: 0, levelsCleared: 0, ...sums } as Totals;
}
