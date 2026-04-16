export interface RawTender {
  reference_id: string;
  title: string;
  description: string | null;
  agency: string;
  country: string;
  country_code: string | null;
  region: string | null;
  sector: string | null;
  deadline: string | null;
  estimated_value: string | null;
  source_url: string | null;
  opportunity_type: string;
  eligibility_summary: string | null;
  experience_level: string | null;
  submission_language: string;
  source_tier: number;
  source_name: string;
  category?: string | null;
}

export interface CrawlResult {
  platform: string;
  status: "success" | "failure";
  tenders: RawTender[];
  durationMs: number;
  error?: string;
}

const BACKOFF_BASE_MS = 1000;

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts - 1) {
        const delay = BACKOFF_BASE_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

export function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 30000,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timeout),
  );
}

/**
 * Lightweight HEAD check. Returns true if the URL is reachable (2xx or 3xx).
 * Used post-crawl to flag broken source links.
 */
export async function verifyLink(url: string, timeoutMs = 8000): Promise<boolean> {
  try {
    const resp = await fetchWithTimeout(
      url,
      { method: "HEAD", redirect: "follow", headers: { "User-Agent": "TenderPath/1.0" } },
      timeoutMs,
    );
    if (resp.ok) return true;
    if (resp.status === 405 || resp.status === 403) {
      const g = await fetchWithTimeout(
        url,
        { method: "GET", redirect: "follow", headers: { "User-Agent": "TenderPath/1.0" } },
        timeoutMs,
      );
      return g.ok;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Stable dedup key. Different sources publish the same tender under different IDs;
 * matching on (normalized title + agency + deadline) catches the cross-posts.
 */
export function dedupKey(t: { title: string; agency: string; deadline: string | null }): string {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 120);
  return `${norm(t.title)}|${norm(t.agency)}|${t.deadline ?? ""}`;
}
