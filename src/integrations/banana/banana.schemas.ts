import { z } from 'zod';

/**
 * Banana API — live-verified response contract (2026-10-29), see docs/banana-integration.md
 *
 * GET https://marcconrad.com/uob/banana/api.php?out=json&base64=yes
 *   { "question" : "<base64 PNG, ~36KB, 660x360>" , "solution" : 4 }
 *
 * We deliberately use base64=yes: with base64=no `question` is an image URL whose filename
 * ends in n<NUM> where the last digit of NUM equals the solution (30/30 live samples), so
 * handing that URL to a browser would leak the answer.
 */
export const bananaResponseSchema = z.object({
  question: z.string().min(1),                       // base64 image bytes
  solution: z.coerce.number().int().min(0).max(9),   // single digit
});

/** Internal, provider-independent model — decoupled from upstream field names. */
export interface ProviderPuzzle {
  image: Buffer;
  contentType: string;
  solution: number;
}
