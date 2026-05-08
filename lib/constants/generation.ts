/**
 * Constants for PDF content generation
 * Shared between client and server code
 */

// PDF content truncation limit (characters) — default cap for prompts
export const MAX_PDF_CONTENT_CHARS = 50000;

/**
 * Server: optional `PDF_CONTEXT_MAX_CHARS` (10000–300000) to raise PDF context in outlines.
 * Client bundles use the default constant.
 */
export function getMaxPdfContextChars(): number {
  if (typeof process === 'undefined' || !process.env?.PDF_CONTEXT_MAX_CHARS) {
    return MAX_PDF_CONTENT_CHARS;
  }
  const n = Number(process.env.PDF_CONTEXT_MAX_CHARS);
  if (!Number.isFinite(n)) return MAX_PDF_CONTENT_CHARS;
  return Math.min(300_000, Math.max(10_000, Math.floor(n)));
}

// Maximum number of images to send as vision content parts
export const MAX_VISION_IMAGES = 20;
