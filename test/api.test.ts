import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { Game, Puzzle } from '../src/models.js';
import { UpstreamError, type PuzzleProvider } from '../src/integrations/banana/banana.client.js';

type Agent = ReturnType<typeof request.agent>;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const pw = 'correct-horse-battery';
const API = '/api/v1';
const SOLUTION = 4;

let mongo: MongoMemoryServer;
let app: ReturnType<typeof createApp>;
let upstreamFailures = 0; // the next N provider calls throw UpstreamError
const provider: PuzzleProvider = {
  fetchPuzzle: async () => {
    if (upstreamFailures-- > 0) throw new UpstreamError('down');
    return { image: PNG, contentType: 'image/png', solution: SOLUTION };
  },
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  // A tiny campaign: chapter 1 has 1 door, chapter 2 has 2 doors (3 keys + 3 Banana puzzles per run).
  const cfg = loadConfig({
    NODE_ENV: 'test', MONGO_URI: mongo.getUri(), SESSION_SECRET: 'x'.repeat(32),
    MIN_COMPLETION_S: '0', MAX_ATTEMPTS: '3', HARD_MAX_ATTEMPTS: '2', CHAPTER_DOORS: '1,2', RESUME_WINDOW_S: '60',
  });
  await mongoose.connect(cfg.MONGO_URI);
  app = createApp(cfg, provider);
});
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

const signup = async (email: string, displayName = 'Tester'): Promise<Agent> => {
  const agent = request.agent(app);
  await agent.post(`${API}/auth/register`).send({ email, displayName, password: pw }).expect(201);
  return agent;
};
const newGame = async (u: Agent, body: object = {}) => (await u.post(`${API}/games`).send(body).expect(201)).body;
const verify = (u: Agent, puzzleId: string, body: unknown) => u.post(`${API}/puzzles/${puzzleId}/verify`).send(body as object);
/** New game with the first key collected and a live puzzle for door 0. */
const armedGame = async (u: Agent, body: object = {}) => {
  const game = await newGame(u, body);
  await u.post(`${API}/games/${game.id}/key`).send({ index: 0 }).expect(200);
  const puzzle = (await u.post(`${API}/games/${game.id}/puzzles`).expect(201)).body;
  return { game, puzzle };
};
/** key → puzzle → correct answer for one door (optionally after some wrong answers). */
const openDoor = async (u: Agent, gameId: string, index: number, wrong = 0) => {
  await u.post(`${API}/games/${gameId}/key`).send({ index }).expect(200);
  const puzzle = (await u.post(`${API}/games/${gameId}/puzzles`).expect(201)).body;
  for (let i = 0; i < wrong; i++) await verify(u, puzzle.id, { answer: 9 }).expect(200);
  const result = (await verify(u, puzzle.id, { answer: SOLUTION }).expect(200)).body;
  return { puzzle, result };
};
const setStarted = (gameId: string, msAgo: number) =>
  Game.collection.updateOne({ _id: new mongoose.Types.ObjectId(gameId) }, { $set: { startedAt: new Date(Date.now() - msAgo) } });
/** A whole campaign: 3 doors over 2 chapters, then completion. */
const playRun = async (u: Agent, o: { difficulty?: 'hard'; msAgo?: number; wrongOnFirst?: number } = {}) => {
  const game = await newGame(u, o.difficulty ? { difficulty: o.difficulty } : {});
  await openDoor(u, game.id, 0, o.wrongOnFirst ?? 0);
  await u.post(`${API}/games/${game.id}/advance`).expect(200);
  await openDoor(u, game.id, 0);
  await openDoor(u, game.id, 1);
  await setStarted(game.id, o.msAgo ?? 100_000);
  const done = (await u.post(`${API}/games/${game.id}/complete`).expect(200)).body;
  return { game, done };
};
const ids = (list: { id: string }[]) => list.map((x) => x.id).sort();

describe('virtual identity', () => {
  it('rejects unauthenticated access and wrong passwords', async () => {
    await request(app).post(`${API}/games`).expect(401);
    await request(app).get(`${API}/puzzles/${new mongoose.Types.ObjectId()}/image`).expect(401);
    await request(app).put(`${API}/users/me/cape`).send({ cape: 'crimson' }).expect(401);
    await signup('a@test.dev');
    await request(app).post(`${API}/auth/login`).send({ email: 'a@test.dev', password: 'wrong-password-123' }).expect(401);
  });
  it('sets an HttpOnly cookie', async () => {
    const res = await request(app).post(`${API}/auth/register`).send({ email: 'cookie@test.dev', displayName: 'Cookie', password: pw });
    expect(res.status).toBe(201);
    expect(res.headers['set-cookie']?.[0]).toMatch(/HttpOnly/);
  });
  it('gives a brand-new player empty stats with only the default cape', async () => {
    const u = await signup('fresh@test.dev');
    const { body } = await u.get(`${API}/users/me/stats`).expect(200);
    expect(Object.keys(body).sort()).toEqual(['achievements', 'bestScore', 'bestTimeMs', 'cape', 'capes', 'completed', 'hardUnlocked', 'levelsCleared', 'puzzlesSolved', 'recent', 'relicsTotal', 'runs', 'totalScore']);
    expect(body).toMatchObject({ completed: 0, runs: 0, totalScore: 0, bestScore: null, bestTimeMs: null, puzzlesSolved: 0, relicsTotal: 0, levelsCleared: 0, achievements: [], cape: 'crimson', hardUnlocked: false, recent: [] });
    expect(body.capes).toHaveLength(8);
    expect(body.capes.filter((c: { unlocked: boolean }) => c.unlocked).map((c: { id: string }) => c.id)).toEqual(['crimson']);
    expect(Object.keys(body.capes[0]).sort()).toEqual(['color', 'id', 'name', 'unlocked']);
  });
  it('no longer exposes the old client-URL image proxy', async () => {
    const u = await signup('proxy@test.dev');
    await u.get(`${API}/puzzle-image?url=${encodeURIComponent('https://www.sanfoh.com/x.png')}`).expect(404);
  });
});

describe('Banana puzzle: answer and image protection', () => {
  it('returns only public fields, and the image only to its owner', async () => {
    const u = await signup('p@test.dev');
    const other = await signup('r@test.dev');
    const { game, puzzle } = await armedGame(u);

    expect(Object.keys(puzzle).sort()).toEqual(['attemptsRemaining', 'expiresAt', 'id', 'imageUrl', 'maxAttempts']);
    expect(puzzle.imageUrl).toBe(`${API}/puzzles/${puzzle.id}/image`);
    expect(puzzle.maxAttempts).toBe(3);
    const wire = JSON.stringify(puzzle);
    expect(wire).not.toContain('solution');
    expect(wire).not.toContain(PNG.toString('base64'));
    expect(wire).not.toContain('sanfoh');

    const img = await u.get(puzzle.imageUrl).expect(200);
    expect(img.headers['content-type']).toMatch(/image\/png/);
    expect(img.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.compare(img.body, PNG)).toBe(0);
    await request(app).get(puzzle.imageUrl).expect(401);
    await other.get(puzzle.imageUrl).expect(404);

    // idempotent: re-requesting returns the same live puzzle and does not reset attempts
    const again = await u.post(`${API}/games/${game.id}/puzzles`).expect(200);
    expect(again.body.id).toBe(puzzle.id);
  });

  it('answers 400 to malformed answers without burning an attempt', async () => {
    const u = await signup('bad@test.dev');
    const { game, puzzle } = await armedGame(u);
    for (const body of [{}, { answer: '4' }, { answer: 4.5 }, { answer: 10 }, { answer: -1 }, { answer: null }, { answer: 4, isCorrect: true }]) {
      await verify(u, puzzle.id, body).expect(400);
    }
    const { body } = await u.post(`${API}/games/${game.id}/puzzles`).expect(200);
    expect(body.attemptsRemaining).toBe(3);
  });

  it('opens a door exactly once: replays and concurrent double-submits cannot double-count', async () => {
    const u = await signup('once@test.dev');
    const { game, puzzle } = await armedGame(u);
    await verify(u, puzzle.id, { answer: 9 }).expect(200).then((r) => expect(r.body).toEqual({ correct: false, attemptsRemaining: 2 }));
    await verify(u, puzzle.id, { answer: SOLUTION }).expect(200)
      .then((r) => expect(r.body).toEqual({ correct: true, doorsOpened: 1, doorsInLevel: 1, chapterUnlocked: true }));
    expect((await u.get(`${API}/games/${game.id}`)).body).toMatchObject({ status: 'DOOR_UNLOCKED', doorsOpened: 1, doorsOpenedTotal: 1 });

    await verify(u, puzzle.id, { answer: SOLUTION }).expect(410); // duplicate submission
    await u.get(puzzle.imageUrl).expect(410);                     // solved puzzles stop serving their image
    expect((await u.get(`${API}/games/${game.id}`)).body).toMatchObject({ doorsOpened: 1, doorsOpenedTotal: 1 }); // not counted twice
    await u.post(`${API}/games/${game.id}/advance`).expect(200);
    await verify(u, puzzle.id, { answer: SOLUTION }).expect(410); // replay cannot open a door in the next chapter
    expect((await u.get(`${API}/games/${game.id}`)).body).toMatchObject({ doorsOpened: 0, doorsOpenedTotal: 1 });

    // two simultaneous correct answers for the same door: exactly one wins
    await u.post(`${API}/games/${game.id}/key`).send({ index: 0 }).expect(200);
    const p = (await u.post(`${API}/games/${game.id}/puzzles`).expect(201)).body;
    const [a, b] = await Promise.all([verify(u, p.id, { answer: SOLUTION }), verify(u, p.id, { answer: SOLUTION })]);
    expect([a.status, b.status].sort()).toEqual([200, 410]);
    expect((await u.get(`${API}/games/${game.id}`)).body).toMatchObject({ doorsOpened: 1, doorsOpenedTotal: 2, status: 'IN_PROGRESS' });
  });

  it('rejects expired puzzles and issues a fresh one', async () => {
    const u = await signup('expired@test.dev');
    const { game, puzzle } = await armedGame(u);
    await Puzzle.updateOne({ _id: puzzle.id }, { expiresAt: new Date(Date.now() - 1000) });
    await verify(u, puzzle.id, { answer: SOLUTION }).expect(410);
    await u.get(puzzle.imageUrl).expect(410);
    const fresh = await u.post(`${API}/games/${game.id}/puzzles`).expect(201);
    expect(fresh.body.id).not.toBe(puzzle.id);
  });

  it('survives an upstream outage and a retry creates exactly one puzzle', async () => {
    const u = await signup('outage@test.dev');
    const game = await newGame(u);
    await u.post(`${API}/games/${game.id}/key`).send({ index: 0 }).expect(200);
    upstreamFailures = 1;
    const down = await u.post(`${API}/games/${game.id}/puzzles`).expect(502);
    expect(down.body.error).toBe('puzzle_service_unavailable');
    expect(await Puzzle.countDocuments({ game: game.id })).toBe(0);
    const retry = await u.post(`${API}/games/${game.id}/puzzles`).expect(201);
    expect(await Puzzle.countDocuments({ game: game.id })).toBe(1);
    expect((await u.post(`${API}/games/${game.id}/puzzles`).expect(200)).body.id).toBe(retry.body.id);
    expect(await Puzzle.countDocuments({ game: game.id })).toBe(1);
  });

  it('enforces the key-first rule, the attempt limit and the cooldown (Normal: 3 attempts)', async () => {
    const u = await signup('q@test.dev');
    const game = await newGame(u);
    await u.post(`${API}/games/${game.id}/puzzles`).expect(409); // key not collected
    await u.post(`${API}/games/${game.id}/key`).send({ index: 0 }).expect(200);
    const puzzle = (await u.post(`${API}/games/${game.id}/puzzles`).expect(201)).body;
    await verify(u, puzzle.id, { answer: 1 });
    await verify(u, puzzle.id, { answer: 2 }).then((r) => expect(r.body).toEqual({ correct: false, attemptsRemaining: 1 }));
    await verify(u, puzzle.id, { answer: 3 }).then((r) => expect(r.body).toEqual({ correct: false, attemptsRemaining: 0 }));
    await verify(u, puzzle.id, { answer: SOLUTION }).expect(410);
    await u.get(puzzle.imageUrl).expect(410);
    await u.post(`${API}/games/${game.id}/puzzles`).expect(429);
  });

  it("stops other players from reading or touching someone else's game and puzzle", async () => {
    const u = await signup('owner@test.dev');
    const other = await signup('intruder@test.dev');
    const { game, puzzle } = await armedGame(u);
    await other.get(`${API}/games/${game.id}`).expect(404);
    await other.post(`${API}/games/${game.id}/key`).send({ index: 0 }).expect(404);
    await other.post(`${API}/games/${game.id}/puzzles`).expect(404);
    await other.post(`${API}/games/${game.id}/advance`).expect(404);
    await other.post(`${API}/games/${game.id}/complete`).expect(404);
    await verify(other, puzzle.id, { answer: SOLUTION }).expect(404);
    await other.get(puzzle.imageUrl).expect(404);
    expect(await Puzzle.findById(puzzle.id).then((p) => p?.status)).toBe('ACTIVE'); // still untouched
    await other.get(`${API}/games/current`).expect(204);                            // never sees the owner's run
  });
});

describe('campaign: doors, chapters and run state', () => {
  it('issues a seed and a public game with exactly the contracted fields', async () => {
    const u = await signup('seed@test.dev');
    const g1 = await newGame(u);
    expect(Object.keys(g1).sort()).toEqual(['difficulty', 'doorsInLevel', 'doorsOpened', 'doorsOpenedTotal', 'doorsTotal', 'id', 'keysCollected', 'level', 'levelCount', 'lockedUntil', 'rank', 'relics', 'score', 'seed', 'startedAt', 'status', 'wrongAttempts']);
    expect(g1).toMatchObject({ status: 'IN_PROGRESS', level: 0, levelCount: 2, doorsInLevel: 1, doorsTotal: 3, keysCollected: 0, doorsOpened: 0, doorsOpenedTotal: 0, difficulty: 'normal', score: null, rank: null, relics: 0, lockedUntil: null });
    expect(Number.isInteger(g1.seed) && g1.seed >= 1 && g1.seed <= 2_147_483_647).toBe(true);
    const g2 = await newGame(u);
    expect(g2.seed).not.toBe(g1.seed);
    // stable across reads
    expect((await u.get(`${API}/games/${g2.id}`).expect(200)).body.seed).toBe(g2.seed);
    expect((await u.get(`${API}/games/current`).expect(200)).body.seed).toBe(g2.seed);
  });

  it('only lets a key be collected for the next unopened door', async () => {
    const u = await signup('keys@test.dev');
    const game = await newGame(u);
    const key = (body: unknown) => u.post(`${API}/games/${game.id}/key`).send(body as object);
    for (const bad of [{}, { index: -1 }, { index: 1.5 }, { index: '0' }, { index: 0, extra: 1 }]) await key(bad).expect(400);
    await u.post(`${API}/games/${game.id}/key`).expect(400);     // no body at all
    await key({ index: 1 }).expect(409);                         // door 1 does not exist in chapter 1, and door 0 is not open
    expect((await key({ index: 0 }).expect(200)).body).toMatchObject({ keysCollected: 1, doorsOpened: 0 });
    expect((await key({ index: 0 }).expect(200)).body.keysCollected).toBe(1); // idempotent
    const puzzle = (await u.post(`${API}/games/${game.id}/puzzles`).expect(201)).body;
    await verify(u, puzzle.id, { answer: SOLUTION }).expect(200);

    await u.post(`${API}/games/${game.id}/advance`).expect(200);
    await key({ index: 1 }).expect(409);                         // chapter 2: door 0 is still sealed
    await key({ index: 0 }).expect(200);
  });

  it('runs a multi-door chapter: every door needs its own key and puzzle', async () => {
    const u = await signup('chain@test.dev');
    const game = await newGame(u);
    await u.post(`${API}/games/${game.id}/advance`).expect(409);   // nothing open
    await u.post(`${API}/games/${game.id}/complete`).expect(409);
    const first = await openDoor(u, game.id, 0);
    expect(first.result).toMatchObject({ correct: true, doorsOpened: 1, doorsInLevel: 1, chapterUnlocked: true });
    await u.post(`${API}/games/${game.id}/complete`).expect(409);  // not the final chapter
    expect((await u.post(`${API}/games/${game.id}/advance`).expect(200)).body).toMatchObject({ status: 'IN_PROGRESS', level: 1, doorsInLevel: 2, keysCollected: 0, doorsOpened: 0, doorsOpenedTotal: 1, relics: 1 });
    await u.post(`${API}/games/${game.id}/advance`).expect(409);   // single use

    // chapter 2 has two doors
    await u.post(`${API}/games/${game.id}/puzzles`).expect(409);   // puzzle before key
    const d0 = await openDoor(u, game.id, 0);
    expect(d0.result).toMatchObject({ correct: true, doorsOpened: 1, doorsInLevel: 2, chapterUnlocked: false });
    expect(await Puzzle.findById(d0.puzzle.id).then((p) => p?.door)).toBe(0);
    expect((await u.get(`${API}/games/${game.id}`)).body.status).toBe('IN_PROGRESS');
    await u.post(`${API}/games/${game.id}/advance`).expect(409);   // door 1 still sealed
    await u.post(`${API}/games/${game.id}/complete`).expect(409);
    await u.post(`${API}/games/${game.id}/puzzles`).expect(409);   // door 1 has no key yet
    await u.post(`${API}/games/${game.id}/key`).send({ index: 2 }).expect(409); // beyond the chapter
    const d1 = await openDoor(u, game.id, 1);
    expect(d1.puzzle.id).not.toBe(d0.puzzle.id);
    expect(await Puzzle.findById(d1.puzzle.id).then((p) => p?.door)).toBe(1);
    expect(d1.result).toMatchObject({ doorsOpened: 2, chapterUnlocked: true });
    await u.post(`${API}/games/${game.id}/advance`).expect(409);   // no chapter 3

    const done = (await u.post(`${API}/games/${game.id}/complete`).expect(200)).body;
    expect(done).toMatchObject({ status: 'COMPLETED', level: 1, doorsOpenedTotal: 3, relics: 2 });
    await u.post(`${API}/games/${game.id}/complete`).expect(409);  // single use
    await u.get(`${API}/games/current`).expect(204);
  });

  it('resumes an unfinished run, abandons it on a new one, and lets it go stale', async () => {
    const u = await signup('resume@test.dev');
    await u.get(`${API}/games/current`).expect(204);

    const first = await newGame(u);
    expect((await u.get(`${API}/games/current`).expect(200)).body.id).toBe(first.id);

    const second = await newGame(u);
    expect(second.id).not.toBe(first.id);
    expect((await u.get(`${API}/games/${first.id}`)).body.status).toBe('ABANDONED');
    expect((await u.get(`${API}/games/current`).expect(200)).body.id).toBe(second.id);

    // outside the 60s test window -> nothing to resume; activity (collecting the key) revives it
    await Game.collection.updateOne({ _id: new mongoose.Types.ObjectId(second.id) }, { $set: { updatedAt: new Date(Date.now() - 120_000) } });
    await u.get(`${API}/games/current`).expect(204);
    await u.post(`${API}/games/${second.id}/key`).send({ index: 0 }).expect(200);
    expect((await u.get(`${API}/games/current`).expect(200)).body.keysCollected).toBe(1);
  });
});

describe('scoring, rank and rewards', () => {
  it('computes the exact score and rank on the server (Normal)', async () => {
    const u = await signup('score@test.dev');
    const slow = await playRun(u, { msAgo: 1_000_000 });                   // 8000-3000 +150×3 first-try doors
    expect(slow.done.rewards).toMatchObject({ score: 5450, rank: 'B', relics: 2 });
    expect(slow.done).toMatchObject({ score: 5450, rank: 'B', difficulty: 'normal', wrongAttempts: 0 });

    const mistake = await playRun(u, { msAgo: 100_000, wrongOnFirst: 1 }); // 8000-300-120 +150×2
    expect(mistake.done.rewards).toMatchObject({ score: 7880, rank: 'A' });
    expect(mistake.done.wrongAttempts).toBe(1);

    const fast = await playRun(u, { msAgo: 100_000 });                     // 8000-300 +450
    expect(fast.done.rewards).toMatchObject({ score: 8150, rank: 'S' });
    expect(Object.keys(fast.done.rewards).sort()).toEqual(['newAchievements', 'newCapes', 'rank', 'relics', 'score']);
  });

  it('locks Hard until a campaign is completed, then applies fewer attempts and the 1.5× multiplier', async () => {
    const u = await signup('hard@test.dev');
    const locked = await u.post(`${API}/games`).send({ difficulty: 'hard' }).expect(403);
    expect(locked.body.error).toBe('hard_locked');
    await u.post(`${API}/games`).send({ difficulty: 'nightmare' }).expect(400);
    await u.post(`${API}/games`).send({ difficulty: 'normal', extra: true }).expect(400);
    expect((await u.get(`${API}/users/me/stats`)).body.hardUnlocked).toBe(false);

    await playRun(u);                                                      // unlocks Hard
    expect((await u.get(`${API}/users/me/stats`)).body.hardUnlocked).toBe(true);

    const { game, puzzle } = await armedGame(u, { difficulty: 'hard' });
    expect(game.difficulty).toBe('hard');
    expect(puzzle.maxAttempts).toBe(2);
    await verify(u, puzzle.id, { answer: 1 }).then((r) => expect(r.body).toEqual({ correct: false, attemptsRemaining: 1 }));
    await verify(u, puzzle.id, { answer: 2 }).then((r) => expect(r.body).toEqual({ correct: false, attemptsRemaining: 0 })); // the second wrong answer locks
    await verify(u, puzzle.id, { answer: SOLUTION }).expect(410);
    await u.post(`${API}/games/${game.id}/puzzles`).expect(429);

    const run = await playRun(u, { difficulty: 'hard', msAgo: 1_000_000 }); // (5000+450) × 1.5; rank from the un-multiplied 5450
    expect(run.done).toMatchObject({ difficulty: 'hard', score: 8175, rank: 'B' });
    expect(run.done.rewards).toMatchObject({ score: 8175, rank: 'B' });
    expect(ids(run.done.rewards.newAchievements)).toContain('hard-won');
    expect(ids(run.done.rewards.newCapes)).toContain('violet');
  });

  it('reports achievements and capes unlocked by THIS completion only', async () => {
    const u = await signup('rewards@test.dev');
    const one = await playRun(u);                                          // S rank, flawless, fast
    expect(ids(one.done.rewards.newAchievements)).toEqual(['first-escape', 'flawless', 'rank-s', 'speed-runner']);
    expect(ids(one.done.rewards.newCapes)).toEqual(['emerald', 'gold', 'ivory']);
    expect(Object.keys(one.done.rewards.newCapes[0]).sort()).toEqual(['color', 'id', 'name']);
    expect(Object.keys(one.done.rewards.newAchievements[0]).sort()).toEqual(['description', 'id', 'title']);

    const two = await playRun(u);                                          // identical run: nothing new
    expect(two.done.rewards.newAchievements).toEqual([]);
    expect(two.done.rewards.newCapes).toEqual([]);

    const three = await playRun(u);                                        // third completion: Veteran + Azure
    expect(ids(three.done.rewards.newAchievements)).toEqual(['veteran']);
    expect(ids(three.done.rewards.newCapes)).toEqual(['azure']);

    const stats = (await u.get(`${API}/users/me/stats`).expect(200)).body;
    expect(stats).toMatchObject({ completed: 3, runs: 3, puzzlesSolved: 9, relicsTotal: 6, levelsCleared: 6, bestScore: 8150, totalScore: 3 * 8150, hardUnlocked: true });
    expect(typeof stats.bestTimeMs).toBe('number');
    expect(ids(stats.achievements)).toEqual(['first-escape', 'flawless', 'rank-s', 'speed-runner', 'veteran']);
    expect(ids(stats.capes.filter((c: { unlocked: boolean }) => c.unlocked))).toEqual(['azure', 'crimson', 'emerald', 'gold', 'ivory']);
    expect(stats.recent).toHaveLength(3);
    expect(Object.keys(stats.recent[0])).toContain('doorsOpenedTotal');
  });

  it('does not award flawless after a wrong answer', async () => {
    const u = await signup('sloppy@test.dev');
    const { done } = await playRun(u, { wrongOnFirst: 1 });
    expect(ids(done.rewards.newAchievements)).not.toContain('flawless');
    expect(ids(done.rewards.newAchievements)).toContain('first-escape');
  });
});

describe('capes', () => {
  it('equips only unlocked capes, validates input, and keeps each player separate', async () => {
    const u = await signup('cape@test.dev');
    const other = await signup('cape2@test.dev');
    const put = (a: Agent, body: unknown) => a.put(`${API}/users/me/cape`).send(body as object);

    await put(u, { cape: 'crimson' }).expect(200).then((r) => expect(r.body).toEqual({ cape: 'crimson' }));
    expect((await put(u, { cape: 'gold' }).expect(403)).body.error).toBe('cape_locked');
    await put(u, { cape: 'nope' }).expect(400);
    await put(u, {}).expect(400);
    await put(u, { cape: 'gold', extra: 1 }).expect(400);
    await put(u, { cape: 7 }).expect(400);

    await playRun(u);                                                      // unlocks gold, emerald, ivory
    await put(u, { cape: 'gold' }).expect(200).then((r) => expect(r.body).toEqual({ cape: 'gold' }));
    expect((await u.get(`${API}/users/me/stats`)).body.cape).toBe('gold');
    await put(u, { cape: 'violet' }).expect(403);                          // Hard not won yet

    await put(other, { cape: 'gold' }).expect(403);                        // locked for them even though u owns it
    expect((await other.get(`${API}/users/me/stats`)).body.cape).toBe('crimson');
  });
});

describe('leaderboard', () => {
  it('lists rank and difficulty alongside score and time', async () => {
    const u = await signup('champ@test.dev', 'Champion');
    await playRun(u);
    await playRun(u, { difficulty: 'hard' });                              // 8150 × 1.5 = 12225
    const board = (await request(app).get(`${API}/leaderboard?limit=50`).expect(200)).body;
    const mine = board.find((r: { displayName: string }) => r.displayName === 'Champion');
    expect(mine).toEqual({ displayName: 'Champion', score: 12225, durationMs: expect.any(Number), rank: 'S', difficulty: 'hard' });
    expect(Object.keys(board[0]).sort()).toEqual(['difficulty', 'displayName', 'durationMs', 'rank', 'score']);
    expect(board[0]).not.toHaveProperty('_id');
    const scores = board.map((r: { score: number }) => r.score);
    expect(scores).toEqual([...scores].sort((a: number, b: number) => b - a));
  });
});
