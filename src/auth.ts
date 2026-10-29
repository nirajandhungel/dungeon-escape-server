import { Router, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import argon2 from 'argon2';
import { z } from 'zod';
import { User } from './models.js';
import { HttpError } from './errors.js';
import type { Config } from './config.js';

declare module 'express-session' {
  interface SessionData { userId?: string; createdAt?: number }
}

const ABSOLUTE_SESSION_MS = 24 * 60 * 60 * 1000;
// Compared against when the email is unknown so response time does not reveal which emails exist.
const DUMMY_HASH = await argon2.hash('dummy-password-for-timing');

const credentials = z.object({ email: z.string().email().max(254), password: z.string().min(12).max(128) });
const registration = credentials.extend({ displayName: z.string().trim().min(2).max(32) });

export const requireAuth: RequestHandler = (req, _res, next) => {
  const { userId, createdAt } = req.session;
  if (!userId || !createdAt || Date.now() - createdAt > ABSOLUTE_SESSION_MS) {
    return req.session.destroy(() => next(new HttpError(401, 'unauthenticated', 'Login required')));
  }
  next();
};

const startSession: (req: Express.Request, userId: string) => Promise<void> = (req, userId) =>
  new Promise((resolve, reject) =>
    // regenerate() issues a fresh session id on login, defeating session fixation
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      req.session.createdAt = Date.now();
      resolve();
    }));

export function authRouter(cfg: Config) {
  const r = Router();
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: cfg.NODE_ENV === 'test' ? 1000 : 10,
    standardHeaders: true, legacyHeaders: false,
  });

  r.post('/register', loginLimiter, async (req, res) => {
    const input = registration.parse(req.body);
    try {
      const user = await User.create({
        email: input.email, displayName: input.displayName, passwordHash: await argon2.hash(input.password),
      });
      await startSession(req, user.id);
      res.status(201).json({ id: user.id, displayName: user.displayName });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new HttpError(409, 'email_taken', 'Email already registered');
      throw err;
    }
  });

  r.post('/login', loginLimiter, async (req, res) => {
    const input = credentials.parse(req.body);
    const user = await User.findOne({ email: input.email.toLowerCase() }).select('+passwordHash');
    const ok = await argon2.verify(user?.passwordHash ?? DUMMY_HASH, input.password);
    if (!user || !ok) throw new HttpError(401, 'invalid_credentials', 'Invalid email or password');
    await startSession(req, user.id);
    res.json({ id: user.id, displayName: user.displayName });
  });

  r.post('/logout', (req, res) => {
    req.session.destroy(() => res.clearCookie('de.sid').status(204).end());
  });

  r.get('/me', requireAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    if (!user) throw new HttpError(401, 'unauthenticated', 'Login required');
    res.json({ id: user.id, displayName: user.displayName, email: user.email });
  });

  return r;
}
