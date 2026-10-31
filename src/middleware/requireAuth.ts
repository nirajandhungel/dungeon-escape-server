import type { RequestHandler } from 'express';
import { HttpError } from '../errors.js';

declare module 'express-session' {
  interface SessionData { userId?: string; createdAt?: number }
}

const ABSOLUTE_SESSION_MS = 24 * 60 * 60 * 1000;

export const requireAuth: RequestHandler = (req, _res, next) => {
  const { userId, createdAt } = req.session;
  if (!userId || !createdAt || Date.now() - createdAt > ABSOLUTE_SESSION_MS) {
    return req.session.destroy(() => next(new HttpError(401, 'unauthenticated', 'Login required')));
  }
  next();
};
