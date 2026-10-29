# Banana API integration record

Verified live on **2026-10-29** from the development machine (commands below are reproducible).
Official documentation: https://marcconrad.com/uob/banana/doc.php

## Contract (observed)

| Item | Observed |
|---|---|
| Endpoint | `https://marcconrad.com/uob/banana/api.php` |
| Plain HTTP | `http://…` answers `HTTP/1.1 301 Moved Permanently` with `Location: https://…` (same path and query). We call HTTPS directly. |
| HTTPS | `HTTP/2 200`, `server: Apache` |
| Response `content-type` | **`text/html`**, even for JSON. The client therefore reads the body as text and parses it itself. |
| CORS | `access-control-allow-origin: *` (a browser could call it directly; we still do not, see design decisions) |
| Query options | `out=json` (default) or `out=csv`; `base64=no` (default) or `base64=yes` |
| `out=json&base64=no` | `{ "question" : "https://www.sanfoh.com/uob/banana/data/t…n115.png" , "solution" : 5 }` |
| `out=json&base64=yes` | `{ "question" : "<base64 PNG>" , "solution" : 4 }`. Sample: 48 292 bytes of JSON, a 36 191-byte **660×360 PNG**, chunks `IHDR, sRGB, IDAT, IEND` only (no text/metadata chunks). |
| `out=csv&base64=no` | `https://www.sanfoh.com/uob/banana/data/t…n43.png,3` |
| `solution` | integer digit 0-9 |

Reproduce:

    curl -sI  "http://marcconrad.com/uob/banana/api.php?out=json&base64=no"     # 301 -> https
    curl -sIL "https://marcconrad.com/uob/banana/api.php?out=json&base64=yes"   # 200, text/html
    curl -sL  "https://marcconrad.com/uob/banana/api.php?out=json&base64=no"
    BANANA_LIVE=1 npx vitest run test/banana.live.test.ts                       # our adapter against the real service

## Security finding: the image URL encodes the answer

With `base64=no` the image filename ends in `n<NUM>.png`. Over **30 consecutive live samples (30/30)** the last digit of
`<NUM>` equalled `solution` (for example `…n115.png` → 5, `…n82.png` → 2, `…n50.png` → 0). This is an *observed correlation*, not
documented behaviour, but it is consistent enough that a browser which receives the upstream image URL can read the answer
from the network tab. The first version of this project sent exactly that URL to the client, which defeated the
"solution never reaches the browser" rule.

**Fix:** call the API with `base64=yes`. The image arrives inline, so no upstream filename is ever stored or sent.

## Design decisions (for the video)

- **Server-side adapter** (`src/integrations/banana/`): the only code that knows the provider's field names. It enforces a 5 s timeout,
  checks the HTTP status, caps the body (3 MB text) and the decoded image (2 MB), validates the JSON with zod, decodes base64 strictly,
  and identifies the image by magic bytes (PNG/JPEG/GIF) rather than trusting any declared type. Failures become `UpstreamError`, which the
  route turns into `502 puzzle_service_unavailable`; no fake puzzle is ever substituted.
- **Image stored in MongoDB and served by us** (`GET /api/v1/puzzles/:id/image`): the route requires a session, filters by owner
  in the query, and only answers while the puzzle is `ACTIVE` and unexpired (otherwise 410, or 404 if the id is unknown or someone else's).
  The browser never sees an upstream URL, so there is no mixed-content problem and no open proxy. This replaces the old
  `/api/v1/puzzle-image?url=` proxy, which was unauthenticated, accepted a client-supplied URL and used `hostname.endsWith('sanfoh.com')`
  (which also matches `evilsanfoh.com`).
- **Answer protection:** `solution` and `image` are `select: false` in the Puzzle model, are never part of `publicPuzzle`, and verification is
  an atomic `findOneAndUpdate` that claims one attempt, so concurrent requests cannot exceed `MAX_ATTEMPTS`.
- **TTL index** on `Puzzle.expiresAt` (`expireAfterSeconds: 3600`): stored answers and images are purged one hour after expiry.
- **Idempotent requests:** asking again while a puzzle is live returns the same puzzle (200), so retrying cannot dodge the attempt limit;
  an upstream failure creates no document, so a retry cannot create duplicates.

## Trade-offs and limitations

- Each puzzle adds about 36 KB to MongoDB (bounded by the TTL index).
- The server is an extra hop and a single point of failure; if Banana is down the player sees a retryable error and cannot unlock doors.
- The provider documents no rate limits or caching rules. We make one upstream request per new puzzle.
- Terms from the provider: service is provided "as is", may be discontinued without notice, and is not for commercial use. This is an educational project.
- The `question`/`solution` field names and the filename correlation are observations of a live service; if the provider changes them,
  only `banana.schemas.ts` and `banana.client.ts` change (the contract tests and `test/banana.live.test.ts` will fail first).
