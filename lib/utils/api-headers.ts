/**
 * API Header Utilities
 *
 * Provides Base64 encoding/decoding for HTTP headers that may contain
 * non-ISO-8859-1 characters (e.g., Chinese in model names, custom base URLs).
 */

/**
 * Base64 encode a header value.
 * Handles non-ASCII characters by encoding to UTF-8 first.
 *
 * Client usage: encodeHeader(value)
 * Server usage: decodeHeaderValue(value)
 */
export function encodeHeader(value: string): string {
  try {
    return btoa(unescape(encodeURIComponent(value)));
  } catch {
    // Fallback: strip non-ASCII characters
    return value.replace(/[^\x20-\x7E]/g, '');
  }
}

/**
 * Base64 decode a header value.
 * Recovers the original UTF-8 string from Base64 encoding.
 *
 * Server usage: decodeHeaderValue(value)
 */
export function decodeHeaderValue(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(escape(atob(value)));
  } catch {
    return value;
  }
}
