import { z } from 'zod';

/**
 * Banana API — live-verified response contract (2026-10-26)
 *
 * Endpoint: GET https://marcconrad.com/uob/banana/api.php?out=json&base64=no
 * Live response example:
 *   { "question" : "https://www.sanfoh.com/uob/banana/data/tbd7cb181717219de77152dcde9n53.png" , "solution" : 3 }
 *
 * Fields:
 *   question  — absolute HTTPS URL to a PNG puzzle image
 *   solution  — integer digit 0–9 that is the correct answer
 *
 * The API previously documented using plain HTTP; it now redirects (HTTP 301) to HTTPS.
 * The BANANA_URL config default has been updated to use HTTPS directly.
 *
 * Images are hosted at sanfoh.com. Because legacy URLs may still use http://, the server
 * proxies them via /api/v1/puzzle-image to ensure the browser always uses HTTPS.
 *
 * To re-verify, run:
 *   curl -sL "https://marcconrad.com/uob/banana/api.php?out=json&base64=no"
 */
export const bananaResponseSchema = z.object({
  question: z.string().min(1),   // image URL (absolute or relative to base URL)
  solution: z.coerce.number().int().min(0).max(9), // single digit 0-9
});

/** Internal, provider-independent model — decoupled from upstream field names. */
export interface ProviderPuzzle {
  imageUrl: string;
  solution: number;
}
