/**
 * Client for the Cloudflare Browser Rendering Worker.
 * Used by crawlers whose target sites sit behind Cloudflare bot protection
 * (UNGM, UNICEF, UNHCR, IOM, AfDB, IDB, ADB).
 *
 * Requires CRAWLER_WORKER_URL and CRAWLER_WORKER_KEY in the environment.
 */
import { fetchWithTimeout } from "./types";
import { assertSafeHttpUrl } from "@/lib/security/safe-url";

export interface BrowserFetchOpts {
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
  /** URL to visit first so Cloudflare sets clearance cookies. Defaults to target origin. */
  warmupUrl?: string;
  /** Extra wait after warmup before the real request (ms). Default 1500. */
  waitMs?: number;
  /** Overall timeout (ms). Browser cold-start adds ~3–5s. Default 60000. */
  timeoutMs?: number;
  /**
   * "fetch" (default) — DOM fetch from the warmup page context. Fast; rides
   * cf_clearance cookies. Good for JSON/static-HTML endpoints.
   * "navigate" — actually navigate Chromium to the target URL, run its JS,
   * then return page.content(). Required for SPA sites where the listing is
   * populated by post-load Ajax (EBRD/ECEPP, anything Angular/React/JSF).
   */
  mode?: "fetch" | "navigate";
  /** navigate-mode only: CSS selector to wait for before capturing HTML. */
  waitForSelector?: string;
  /** navigate-mode only: extra ms after nav/selector before capturing. */
  waitAfterNav?: number;
}

export interface BrowserFetchResult {
  ok: boolean;
  status: number;
  body: string;
  finalUrl?: string;
}

export function browserAvailable(): boolean {
  return !!(process.env.CRAWLER_WORKER_URL && process.env.CRAWLER_WORKER_KEY);
}

export async function fetchViaBrowser(
  url: string,
  opts: BrowserFetchOpts = {},
): Promise<BrowserFetchResult> {
  await assertSafeHttpUrl(url);
  if (opts.warmupUrl) await assertSafeHttpUrl(opts.warmupUrl);

  const workerUrl = process.env.CRAWLER_WORKER_URL;
  const key = process.env.CRAWLER_WORKER_KEY;
  if (!workerUrl || !key) {
    throw new Error(
      "CRAWLER_WORKER_URL / CRAWLER_WORKER_KEY not set — deploy workers/crawler-browser first",
    );
  }

  const payload = {
    url,
    method: opts.method ?? "GET",
    body: opts.body,
    headers: opts.headers,
    warmupUrl: opts.warmupUrl,
    waitMs: opts.waitMs,
    mode: opts.mode,
    waitForSelector: opts.waitForSelector,
    waitAfterNav: opts.waitAfterNav,
  };

  const resp = await fetchWithTimeout(
    workerUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Crawler-Key": key,
      },
      body: JSON.stringify(payload),
    },
    opts.timeoutMs ?? 60000,
  );

  if (!resp.ok && resp.status !== 502) {
    throw new Error(`Crawler worker ${resp.status}: ${await resp.text().catch(() => "")}`);
  }
  const data = (await resp.json()) as BrowserFetchResult;
  return data;
}
