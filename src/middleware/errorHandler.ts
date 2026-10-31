import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../errors.js';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    return void res.status(400).json({
      error: 'validation_error',
      issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }
  if (err instanceof HttpError) {
    return void res.status(err.status).json({ error: err.code, message: err.message });
  }
  console.error(JSON.stringify({ level: 'error', msg: err instanceof Error ? err.message : 'unknown', path: req.path }));
  res.status(500).json({ error: 'internal_error' });
};
