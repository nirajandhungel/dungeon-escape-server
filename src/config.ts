import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGO_URI: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  // Live verified 2026-10-26: HTTP 301 → HTTPS. Using HTTPS directly avoids the redirect round-trip.
  // JSON response: { "question": "<image_url>", "solution": <number> }
  // Images served from sanfoh.com — proxied server-side to avoid mixed-content browser blocks.
  BANANA_URL: z.string().url().default('https://marcconrad.com/uob/banana/api.php'),
  MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  PUZZLE_TTL_S: z.coerce.number().int().positive().default(300),
  COOLDOWN_S: z.coerce.number().int().nonnegative().default(30),
  MIN_COMPLETION_S: z.coerce.number().int().nonnegative().default(5),
});

export type Config = z.infer<typeof schema>;
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => schema.parse(env);
