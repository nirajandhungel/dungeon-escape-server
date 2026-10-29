# Banana API integration record

## Contract (from the official documentation supplied by the author, last updated June 2024)
- Base URL: `http://marcconrad.com/uob/banana/api.php` (plain HTTP)
- Optional params: `out` = `json` (default) | `csv`; `base64` = `no` (default) | `yes`
- JSON mode returns "a link to an image and the solution"; `base64=yes` returns the image base64-encoded.
- Terms: provided "as is", may be discontinued without notice, not for commercial use.

## Verification status
| Item | Status |
|---|---|
| Endpoint, params, defaults | Taken from official docs |
| Live request, status, headers, content type | NOT VERIFIED (sandbox could not resolve marcconrad.com on 2026-10-15) |
| JSON field names (`question`, `solution`) | NOT VERIFIED, assumed from the CSV wording; isolated in `banana.schemas.ts` |
| Rate limits / caching rules | Not documented |

### To verify (record the output here with the date)
    curl -i "http://marcconrad.com/uob/banana/api.php?out=json&base64=no"
Adjust `banana.schemas.ts` if the field names differ. Then run the same call from the browser to confirm
whether CORS allows direct calls (this decides nothing for the design, the proxy stays, but it is a good video point).

## Design decisions to discuss in the video
- Server-side adapter: validates the upstream payload, keeps the solution private, isolates field names, enables mocking, adds a timeout.
- Trade-off: the server is a new dependency and a single point of failure, and the provider can still be down (we return 502 and the UI retries).
- The provider uses http, so an https frontend would block its image as mixed content. Options: `base64=yes` (needs a verified payload format) or an image proxy route.
