import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import argon2 from 'argon2';
import { z } from 'zod';
import { User } from '../models/index.js';
import { HttpError } from '../errors.js';
import type { Config } from '../config/index.js';

// Compared against when the email is unknown so response time does not reveal which emails exist.
const DUMMY_HASH = await argon2.hash('dummy-password-for-timing');

const credentials = z.object({ email: z.string().email().max(254), password: z.string().min(12).max(128) });
const registration = credentials.extend({ displayName: z.string().trim().min(2).max(32) });

const startSession = (req: Express.Request, userId: string): Promise<void> =>
  new Promise((resolve, reject) =>
    // regenerate() issues a fresh session id on login, defeating session fixation
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      req.session.createdAt = Date.now();
      resolve();
    }));

export function buildLoginLimiter(cfg: Config) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: cfg.NODE_ENV === 'test' ? 1000 : 10,
    standardHeaders: true,
    legacyHeaders: false,
  });
}

export const register: RequestHandler = async (req, res) => {
  const input = registration.parse(req.body);
  try {
    const user = await User.create({
      email: input.email,
      displayName: input.displayName,
      passwordHash: await argon2.hash(input.password),
    });
    await startSession(req, user.id);
    res.status(201).json({ id: user.id, displayName: user.displayName });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw new HttpError(409, 'email_taken', 'Email already registered');
    throw err;
  }
};

export const login: RequestHandler = async (req, res) => {
  const input = credentials.parse(req.body);
  const user = await User.findOne({ email: input.email.toLowerCase() }).select('+passwordHash');
  const ok = await argon2.verify(user?.passwordHash ?? DUMMY_HASH, input.password);
  if (!user || !ok) throw new HttpError(401, 'invalid_credentials', 'Invalid email or password');
  await startSession(req, user.id);
  res.json({ id: user.id, displayName: user.displayName });
};

export const logout: RequestHandler = (req, res) => {
  req.session.destroy(() => res.clearCookie('de.sid').status(204).end());
};

export const me: RequestHandler = async (req, res) => {
  const user = await User.findById(req.session.userId);
  if (!user) throw new HttpError(401, 'unauthenticated', 'Login required');
  res.json({ id: user.id, displayName: user.displayName, email: user.email });
};
