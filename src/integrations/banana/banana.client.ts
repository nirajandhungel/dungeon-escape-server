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

const MAX_BODY_CHARS = 3_000_000; // text guard before parsing
const MAX_IMAGE_BYTES = 2_000_000;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Identify the image by magic bytes — never trust a declared type. */
function sniff(b: Buffer): string | null {
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  return null;
}

export function createBananaClient({ baseUrl, timeoutMs = 5000, fetchImpl = fetch }: Options): PuzzleProvider {
  return {
    async fetchPuzzle() {
      const url = `${baseUrl}?out=json&base64=yes`;
      let res: Response;
      let text: string;
      try {
        res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
        if (!res.ok) throw new UpstreamError(`Banana responded with HTTP ${res.status}`);
        text = await res.text(); // the provider labels JSON as text/html, so parse the text ourselves
      } catch (err) {
        if (err instanceof UpstreamError) throw err;
        throw new UpstreamError(`Banana request failed: ${(err as Error).name}`);
      }
      if (text.length > MAX_BODY_CHARS) throw new UpstreamError('Banana response too large');

      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new UpstreamError('Banana returned a non-JSON body');
      }
      const parsed = bananaResponseSchema.safeParse(body);
      if (!parsed.success) throw new UpstreamError('Banana response did not match the expected contract');

      const b64 = parsed.data.question.replace(/\s+/g, '');
      if (!B64.test(b64) || b64.length % 4 !== 0) throw new UpstreamError('Banana image is not valid base64');
      const image = Buffer.from(b64, 'base64');
      if (image.length > MAX_IMAGE_BYTES) throw new UpstreamError('Banana image too large');
      const contentType = sniff(image);
      if (!contentType) throw new UpstreamError('Banana image is not a PNG, JPEG or GIF');
      return { image, contentType, solution: parsed.data.solution };
    },
  };
}
