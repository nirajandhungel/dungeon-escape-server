import { describe, it, expect } from 'vitest';
import { createBananaClient, UpstreamError } from '../src/integrations/banana/banana.client.js';

const BASE = 'https://marcconrad.com/uob/banana/api.php';
// 1x1 PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
// The provider labels its JSON as text/html, so the client must not depend on the content type.
const asProvider = (body: unknown, init: ResponseInit = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { headers: { 'content-type': 'text/html' }, ...init });
const reply = (body: unknown, init?: ResponseInit) => (async () => asProvider(body, init)) as unknown as typeof fetch;
const client = (f: typeof fetch, timeoutMs?: number) => createBananaClient({ baseUrl: BASE, fetchImpl: f, timeoutMs });
const ok = (question: string, solution: unknown = 3) => client(reply({ question, solution })).fetchPuzzle();

describe('Banana client', () => {
  it('decodes a base64 image and calls the documented URL', async () => {
    let called = '';
    const f = (async (u: string) => { called = u; return asProvider({ question: PNG_B64, solution: '7' }); }) as unknown as typeof fetch;
    const puzzle = await client(f).fetchPuzzle();
    expect(called).toBe(`${BASE}?out=json&base64=yes`);
    expect(puzzle.solution).toBe(7);
    expect(puzzle.contentType).toBe('image/png');
    expect(Buffer.compare(puzzle.image, Buffer.from(PNG_B64, 'base64'))).toBe(0);
  });
  it('rejects invalid base64', async () => {
    await expect(ok('***not base64***')).rejects.toThrow(/base64/);
    await expect(ok('abc')).rejects.toThrow(/base64/); // length not a multiple of 4
  });
  it('rejects bytes that are not a PNG, JPEG or GIF', async () => {
    await expect(ok(Buffer.from('definitely not an image').toString('base64'))).rejects.toThrow(/PNG, JPEG or GIF/);
  });
  it('rejects an oversized image and an oversized body', async () => {
    const big = Buffer.concat([Buffer.from(PNG_B64, 'base64').subarray(0, 8), Buffer.alloc(2_100_000)]).toString('base64');
    await expect(ok(big)).rejects.toThrow(/too large/);
    await expect(ok('A'.repeat(3_100_000))).rejects.toThrow(/too large/);
  });
  it('rejects payloads that break the contract', async () => {
    await expect(client(reply({ foo: 1 })).fetchPuzzle()).rejects.toBeInstanceOf(UpstreamError);
    await expect(ok('', 3)).rejects.toBeInstanceOf(UpstreamError);
    await expect(ok(PNG_B64, 10)).rejects.toBeInstanceOf(UpstreamError);
    await expect(ok(PNG_B64, 'x')).rejects.toBeInstanceOf(UpstreamError);
  });
  it('rejects a non-JSON body', async () => {
    await expect(client(reply('<html>maintenance</html>')).fetchPuzzle()).rejects.toThrow(/non-JSON/);
  });
  it('maps upstream HTTP errors', async () => {
    await expect(client(reply({}, { status: 503 })).fetchPuzzle()).rejects.toThrow(/503/);
  });
  it('maps network errors', async () => {
    const down = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    await expect(client(down).fetchPuzzle()).rejects.toThrow(/request failed/);
  });
  it('times out', async () => {
    const hang = ((_u: string, init: RequestInit) => new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('t', 'TimeoutError'))))) as unknown as typeof fetch;
    await expect(client(hang, 20).fetchPuzzle()).rejects.toBeInstanceOf(UpstreamError);
  });
});
