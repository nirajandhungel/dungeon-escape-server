import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

let mongo: MongoMemoryServer;
let app: ReturnType<typeof createApp>;
const provider = { fetchPuzzle: async () => ({ imageUrl: 'http://img.test/p.png', solution: 4 }) };
const pw = 'correct-horse-battery';

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  const cfg = loadConfig({ NODE_ENV: 'test', MONGO_URI: mongo.getUri(), SESSION_SECRET: 'x'.repeat(32), MIN_COMPLETION_S: '0', MAX_ATTEMPTS: '2' });
  await mongoose.connect(cfg.MONGO_URI);
  app = createApp(cfg, provider);
});
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

const signup = async (email: string) => {
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/register').send({ email, displayName: 'Tester', password: pw }).expect(201);
  return agent;
};

describe('virtual identity', () => {
  it('rejects unauthenticated access and wrong passwords', async () => {
    await request(app).post('/api/v1/games').expect(401);
    await signup('a@test.dev');
    await request(app).post('/api/v1/auth/login').send({ email: 'a@test.dev', password: 'wrong-password-123' }).expect(401);
  });
  it('sets an HttpOnly cookie', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ email: 'cookie@test.dev', displayName: 'Cookie', password: pw });
    expect(res.status).toBe(201);
    expect(res.headers['set-cookie']?.[0]).toMatch(/HttpOnly/);
  });
});

describe('puzzle flow', () => {
  it('never exposes the solution and enforces the full chain', async () => {
    const u = await signup('p@test.dev');
    const { body: game } = await u.post('/api/v1/games').expect(201);
    await u.post(`/api/v1/games/${game.id}/puzzles`).expect(409); // key not collected
    await u.post(`/api/v1/games/${game.id}/key`).expect(200);
    const { body: puzzle } = await u.post(`/api/v1/games/${game.id}/puzzles`).expect(201);
    expect(puzzle).not.toHaveProperty('solution');
    expect(Object.keys(puzzle).sort()).toEqual(['attemptsRemaining', 'expiresAt', 'id', 'imageUrl']);
    await u.post(`/api/v1/games/${game.id}/complete`).expect(409); // door still locked
    await u.post(`/api/v1/puzzles/${puzzle.id}/verify`).send({ answer: 9 }).expect(200).then((r) => expect(r.body).toEqual({ correct: false, attemptsRemaining: 1 }));
    await u.post(`/api/v1/puzzles/${puzzle.id}/verify`).send({ answer: 4 }).expect(200).then((r) => expect(r.body.correct).toBe(true));
    await u.post(`/api/v1/games/${game.id}/complete`).expect(200);
    await u.post(`/api/v1/games/${game.id}/complete`).expect(409); // single use
    const board = await request(app).get('/api/v1/leaderboard').expect(200);
    expect(board.body[0]).toHaveProperty('displayName');
    expect(board.body[0]).not.toHaveProperty('_id');
  });
  it('locks out after max attempts and blocks other users', async () => {
    const u = await signup('q@test.dev');
    const other = await signup('r@test.dev');
    const { body: game } = await u.post('/api/v1/games').expect(201);
    await u.post(`/api/v1/games/${game.id}/key`);
    const { body: puzzle } = await u.post(`/api/v1/games/${game.id}/puzzles`);
    await other.get(`/api/v1/games/${game.id}`).expect(404);
    await other.post(`/api/v1/puzzles/${puzzle.id}/verify`).send({ answer: 4 }).expect(404);
    await u.post(`/api/v1/puzzles/${puzzle.id}/verify`).send({ answer: 1 });
    await u.post(`/api/v1/puzzles/${puzzle.id}/verify`).send({ answer: 2 });
    await u.post(`/api/v1/puzzles/${puzzle.id}/verify`).send({ answer: 4 }).expect(410);
    await u.post(`/api/v1/games/${game.id}/puzzles`).expect(429);
  });
});
