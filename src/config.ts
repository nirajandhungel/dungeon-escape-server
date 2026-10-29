import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGO_URI: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  // Live verified 2026-10-29: plain HTTP answers 301 → HTTPS, so use HTTPS directly.
  // We call it with base64=yes: { "question": "<base64 PNG>", "solution": <0-9> } (see docs/banana-integration.md).
  BANANA_URL: z.string().url().default('https://marcconrad.com/uob/banana/api.php'),
  MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  HARD_MAX_ATTEMPTS: z.coerce.number().int().positive().default(2),
  PUZZLE_TTL_S: z.coerce.number().int().positive().default(300),
  COOLDOWN_S: z.coerce.number().int().nonnegative().default(30),
  MIN_COMPLETION_S: z.coerce.number().int().nonnegative().default(5),
  // Doors per chapter, e.g. '2,2,3,3,3' = 5 chapters, 13 doors (each door = one key + one Banana puzzle).
  CHAPTER_DOORS: z.string().default('2,2,3,3,3')
    .transform((s) => s.split(',').map((x) => Number(x.trim())))
    .pipe(z.array(z.number().int().min(1).max(4)).min(1).max(5)),
  RESUME_WINDOW_S: z.coerce.number().int().positive().default(1800),
});

export type Config = z.infer<typeof schema>;
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => schema.parse(env);
