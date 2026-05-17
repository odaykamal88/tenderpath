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

/**
 * Append (or override) UTM tracking params on an already-sanitized URL.
 * Returns the input unchanged if it doesn't parse — callers should pass a
 * URL produced by `safeUrl()` to guarantee parsability.
 */
export function withUtm(
  url: string,
  campaign: string,
  source: string = "tenderpath",
  medium: string = "dashboard",
): string {
  try {
    const u = new URL(url);
    u.searchParams.set("utm_source", source);
    u.searchParams.set("utm_medium", medium);
    u.searchParams.set("utm_campaign", campaign);
    return u.toString();
  } catch {
    return url;
  }
}
