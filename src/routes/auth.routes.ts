import { Router } from 'express';
import { register, login, logout, me, buildLoginLimiter } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/requireAuth.js';
import type { Config } from '../config/index.js';

export function authRouter(cfg: Config) {
  const r = Router();
  const limiter = buildLoginLimiter(cfg);

  r.post('/register', limiter, register);
  r.post('/login',    limiter, login);
  r.post('/logout',   logout);
  r.get('/me',        requireAuth, me);

  return r;
}
