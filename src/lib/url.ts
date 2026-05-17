/**
 * Normalize an arbitrary string into a safe http(s) href, or null.
 *
 * Blocks `javascript:`, `data:`, `file:`, `mailto:`, etc. so that user- or
 * crawler-supplied URLs cannot execute script when rendered as an anchor href.
 * Also trims empty strings to null so callers can use `||` fallbacks cleanly.
 */
export function safeUrl(input?: string | null): string | null {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
