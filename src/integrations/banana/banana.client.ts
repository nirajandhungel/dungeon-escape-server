import { bananaResponseSchema, type ProviderPuzzle } from './banana.schemas.js';

export interface PuzzleProvider {
  fetchPuzzle(): Promise<ProviderPuzzle>;
}

export class UpstreamError extends Error {}

interface Options {
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch; // injectable for deterministic tests
}

export function createBananaClient({ baseUrl, timeoutMs = 5000, fetchImpl = fetch }: Options): PuzzleProvider {
  return {
    async fetchPuzzle() {
      const url = `${baseUrl}?out=json&base64=no`;
      let res: Response;
      try {
        res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
      } catch (err) {
        throw new UpstreamError(`Banana request failed: ${(err as Error).name}`);
      }
      if (!res.ok) throw new UpstreamError(`Banana responded with HTTP ${res.status}`);

      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new UpstreamError('Banana returned a non-JSON body');
      }
      const parsed = bananaResponseSchema.safeParse(body);
      if (!parsed.success) throw new UpstreamError('Banana response did not match the expected contract');

      // Resolve relative links and refuse anything that is not http(s) (blocks javascript:/data: injection).
      const imageUrl = new URL(parsed.data.question, baseUrl);
      if (imageUrl.protocol !== 'http:' && imageUrl.protocol !== 'https:') {
        throw new UpstreamError('Banana image link has an unsupported scheme');
      }
      return { imageUrl: imageUrl.href, solution: parsed.data.solution };
    },
  };
}
