import { describe, it, expect } from 'vitest';
import { createBananaClient } from '../src/integrations/banana/banana.client.js';

// Hits the real University of Bedfordshire service. Opt in with:  BANANA_LIVE=1 npx vitest run test/banana.live.test.ts
// Solutions are checked for range only and never printed.
describe.skipIf(process.env.BANANA_LIVE !== '1')('Banana API (live)', () => {
  const client = createBananaClient({ baseUrl: process.env.BANANA_URL ?? 'https://marcconrad.com/uob/banana/api.php', timeoutMs: 15_000 });

  it('returns a real PNG and a 0-9 answer on two consecutive calls', async () => {
    for (let i = 0; i < 2; i++) {
      const p = await client.fetchPuzzle();
      expect(p.contentType).toBe('image/png');
      expect(p.image.subarray(1, 4).toString('latin1')).toBe('PNG');
      expect(p.image.length).toBeGreaterThan(1024);
      expect(Number.isInteger(p.solution)).toBe(true);
      expect(p.solution).toBeGreaterThanOrEqual(0);
      expect(p.solution).toBeLessThanOrEqual(9);
    }
  }, 40_000);
});
