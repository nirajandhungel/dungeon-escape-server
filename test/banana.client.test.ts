import { describe, it, expect } from 'vitest';
import { createBananaClient, UpstreamError } from '../src/integrations/banana/banana.client.js';

const BASE = 'http://marcconrad.com/uob/banana/api.php';
const reply = (body: unknown, init?: ResponseInit) => (async () => new Response(JSON.stringify(body), init)) as unknown as typeof fetch;
const client = (f: typeof fetch, timeoutMs?: number) => createBananaClient({ baseUrl: BASE, fetchImpl: f, timeoutMs });

describe('Banana client', () => {
  it('normalises a valid response and calls the documented URL', async () => {
    let called = '';
    const f = (async (u: string) => { called = u; return new Response(JSON.stringify({ question: 'https://x.test/a.png', solution: '7' })); }) as unknown as typeof fetch;
    expect(await client(f).fetchPuzzle()).toEqual({ imageUrl: 'https://x.test/a.png', solution: 7 });
    expect(called).toBe(`${BASE}?out=json&base64=no`);
  });
  it('rejects malformed payloads', async () => {
    await expect(client(reply({ foo: 1 })).fetchPuzzle()).rejects.toBeInstanceOf(UpstreamError);
  });
  it('rejects non-http image links', async () => {
    await expect(client(reply({ question: 'javascript:alert(1)', solution: 1 })).fetchPuzzle()).rejects.toThrow(/scheme/);
  });
  it('maps upstream HTTP errors', async () => {
    await expect(client(reply({}, { status: 503 })).fetchPuzzle()).rejects.toThrow(/503/);
  });
  it('times out', async () => {
    const hang = ((_u: string, init: RequestInit) => new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('t', 'TimeoutError'))))) as unknown as typeof fetch;
    await expect(client(hang, 20).fetchPuzzle()).rejects.toBeInstanceOf(UpstreamError);
  });
});
