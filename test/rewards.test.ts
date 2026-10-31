import { describe, it, expect } from 'vitest';
import { ACHIEVEMENTS, CAPES, earned, scoreRun, type Totals } from '../src/services/rewards.service.js';

const zero: Totals = { runs: 0, completed: 0, flawless: 0, hardWon: 0, rankS: 0, totalScore: 0, bestScore: null, bestTimeMs: null, puzzlesSolved: 0, relicsTotal: 0, levelsCleared: 0 };

describe('scoreRun', () => {
  it('applies time, mistakes, first-try bonus and the Hard multiplier exactly', () => {
    expect(scoreRun(100_000, 0, 3, false)).toEqual({ score: 8150, rank: 'S' });   // 8000-300 +450
    expect(scoreRun(1_000_999, 0, 3, false)).toEqual({ score: 5450, rank: 'B' }); // floor(seconds) = 1000
    expect(scoreRun(100_000, 1, 2, false)).toEqual({ score: 7880, rank: 'A' });   // 8000-300-120 +300
    expect(scoreRun(1_000_000, 0, 3, true)).toEqual({ score: 8175, rank: 'B' });  // 5450 × 1.5; rank from the un-multiplied 5450
  });
  it('floors the base at 500 and ranks C below 4000', () => {
    expect(scoreRun(99_999_999, 50, 0, false)).toEqual({ score: 500, rank: 'C' });
    expect(scoreRun(1_334_000, 0, 0, false)).toEqual({ score: 3998, rank: 'C' }); // 8000 - 3*1334
  });
  it('uses inclusive rank thresholds (S 8000, A 6000, B 4000)', () => {
    expect(scoreRun(0, 0, 0, false)).toEqual({ score: 8000, rank: 'S' });
    expect(scoreRun(0, 1, 0, false)).toEqual({ score: 7880, rank: 'A' });
    expect(scoreRun(666_000, 0, 0, false)).toEqual({ score: 6002, rank: 'A' });   // 8000 - 3*666
    expect(scoreRun(667_000, 0, 0, false)).toEqual({ score: 5999, rank: 'B' });   // just under 6000
    expect(scoreRun(1_333_000, 0, 0, false)).toEqual({ score: 4001, rank: 'B' });
  });
});

describe('achievements and capes', () => {
  it('a new player has only the default cape', () => {
    const e = earned(zero);
    expect(e.achievements).toEqual([]);
    expect(e.capes.filter((c) => c.unlocked).map((c) => c.id)).toEqual(['crimson']);
    expect(e.capes).toHaveLength(8);
  });
  it('every cape is unlocked by a real achievement', () => {
    const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
    for (const c of CAPES) if (c.by !== null) expect(ids.has(c.by)).toBe(true);
  });
  it('unlocks follow the thresholds', () => {
    const t = { ...zero, completed: 3, flawless: 1, hardWon: 1, rankS: 1, puzzlesSolved: 25, relicsTotal: 10, bestTimeMs: 719_999 };
    expect(earned(t).achievements).toHaveLength(8);
    expect(earned(t).capes.every((c) => c.unlocked)).toBe(true);
    expect(earned({ ...zero, completed: 2, bestTimeMs: 720_000 }).achievements.map((a) => a.id)).toEqual(['first-escape']); // 720000 is NOT under 12 min
  });
});
