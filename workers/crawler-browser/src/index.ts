/**
 * Cloudflare Browser Rendering Worker — bypasses Cloudflare bot protection
 * on UN/MDB procurement sites by running requests through a real Chromium
 * instance (proper TLS/JA3 fingerprint).
 *
 * Endpoints:
 *   GET  /health      — health probe (launches Chromium when authorized)
 *   POST /fetch        — single request (launch, warmup, one fetch, close)
 *   POST /fetch-many   — batch request (launch, warmup ONCE, N fetches, close).
 *                        Critical for paginated crawls: re-warming per page
 *                        wastes ~15s × N on re-launching Chromium + clearing
 *                        Cloudflare, which blows through Vercel's 300s cron
 *                        budget. Amortize warmup across all pages in one call.
 *
 * Two fetch modes per request:
 *   - "fetch"    (default) DOM fetch from warmup-page context. Fast, rides
 *                cf_clearance cookies. Good for JSON/static-HTML endpoints.
 *   - "navigate" Real page.goto() to the target URL, optional selector wait,
 *                returns page.content(). Required for SPA sites (EBRD/ECEPP)
 *                where the listing is populated by post-load Ajax.
 *
 * Auth: X-Crawler-Key header must match CRAWLER_KEY secret.
 */
import puppeteer from "@cloudflare/puppeteer";

export interface Env {
  BROWSER: Fetcher;           // browser_rendering binding
  CRAWLER_KEY: string;        // wrangler secret
}

const WORKER_VERSION = "crawler-browser@0.1.0";

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];

type FetchMode = "fetch" | "navigate";

interface FetchRequest {
  url: string;
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
  /** "fetch" (default) = DOM fetch from warmup ctx. "navigate" = page.goto(url). */
  mode?: FetchMode;
  /** navigate-mode only: wait for this CSS selector before capturing content. */
  waitForSelector?: string;
  /** navigate-mode only: extra ms after nav/selector before capturing. Default 0. */
  waitAfterNav?: number;
}

interface FetchBody extends FetchRequest {
  warmupUrl?: string;
  waitMs?: number;
}

interface FetchManyBody {
  warmupUrl: string;
  waitMs?: number;
  requests: FetchRequest[];
  delayMs?: number; // delay between requests, jittered ±25%
}

interface PageResult { status: number; body: string; finalUrl?: string }

type PuppeteerPage = Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>["newPage"]>>;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path === "/health" && req.method === "GET") return handleHealth(req, env);
    if (req.method !== "POST") return new Response("Not found", { status: 404 });
    if (req.headers.get("X-Crawler-Key") !== env.CRAWLER_KEY) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (path === "/fetch") return handleFetch(req, env);
    if (path === "/fetch-many") return handleFetchMany(req, env);
    return new Response("Not found", { status: 404 });
  },
};

async function handleHealth(req: Request, env: Env): Promise<Response> {
  const startedAt = Date.now();
  const authorized = req.headers.get("X-Crawler-Key") === env.CRAWLER_KEY;

  if (!authorized) {
    return json({
      ok: true,
      status: "alive",
      browser: "not_checked",
      version: WORKER_VERSION,
      checkedAt: new Date().toISOString(),
    });
  }

  let browserOk = false;
  let browserError: string | null = null;
  try {
    const browser = await puppeteer.launch(env.BROWSER);
    try {
      const page = await browser.newPage();
      await setupPage(page);
      await page.close().catch(() => {});
      browserOk = true;
    } finally {
      await browser.close();
    }
  } catch (err) {
    browserError = err instanceof Error ? err.message : String(err);
  }

  return json({
    ok: browserOk,
    status: browserOk ? "healthy" : "degraded",
    browser: browserOk ? "ok" : "failed",
    browserError,
    version: WORKER_VERSION,
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
  }, browserOk ? 200 : 503);
}

async function handleFetch(req: Request, env: Env): Promise<Response> {
  let input: FetchBody;
  try { input = await req.json(); } catch { return json({ ok: false, status: 0, body: "invalid JSON body" }, 400); }
  if (!input.url) return json({ ok: false, status: 0, body: "url required" }, 400);

  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await setupPage(page);
    const warmup = input.warmupUrl ?? new URL(input.url).origin;
    await warmupAndClearCF(page, warmup, input.waitMs ?? 1500);

    const result = await runRequest(page, {
      url: input.url,
      method: input.method,
      body: input.body,
      headers: input.headers,
      mode: input.mode,
      waitForSelector: input.waitForSelector,
      waitAfterNav: input.waitAfterNav,
    });

    return json({
      ok: result.status >= 200 && result.status < 400,
      status: result.status,
      body: result.body,
      finalUrl: result.finalUrl,
    });
  } catch (err) {
    return json({ ok: false, status: 0, body: err instanceof Error ? err.message : String(err) }, 502);
  } finally {
    await browser.close();
  }
}

async function handleFetchMany(req: Request, env: Env): Promise<Response> {
  let input: FetchManyBody;
  try { input = await req.json(); } catch { return json({ ok: false, results: [], error: "invalid JSON body" }, 400); }
  if (!input.warmupUrl || !Array.isArray(input.requests) || input.requests.length === 0) {
    return json({ ok: false, results: [], error: "warmupUrl and non-empty requests[] required" }, 400);
  }

  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await setupPage(page);

    // Warmup ONCE — Cloudflare challenge solved, cf_clearance cookie set.
    // All subsequent page.evaluate fetches ride the same cookies.
    await warmupAndClearCF(page, input.warmupUrl, input.waitMs ?? 2000);

    const results: PageResult[] = [];
    const baseDelay = input.delayMs ?? 800;
    for (let i = 0; i < input.requests.length; i++) {
      if (i > 0) {
        const jitter = baseDelay * (0.75 + Math.random() * 0.5);
        await new Promise((r) => setTimeout(r, jitter));
      }
      try {
        const r = await runRequest(page, input.requests[i]);
        results.push(r);
      } catch (err) {
        results.push({ status: 0, body: err instanceof Error ? err.message : String(err) });
      }
    }

    return json({ ok: true, results });
  } catch (err) {
    return json({ ok: false, results: [], error: err instanceof Error ? err.message : String(err) }, 502);
  } finally {
    await browser.close();
  }
}

async function setupPage(page: PuppeteerPage): Promise<void> {
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  await page.setUserAgent(ua);
}

/**
 * Visit warmupUrl and wait until Cloudflare has (likely) issued cf_clearance.
 * Strategy:
 *   1. goto with networkidle2 — DCL fires too early for CF's JS challenge.
 *      networkidle2 waits until there are <=2 network connections for 500ms,
 *      which is the earliest reliable signal that the challenge has settled.
 *   2. Then poll cookies for cf_clearance up to `maxWaitMs`. Site has no CF?
 *      We exit early on the goto resolution and the extra wait is skipped.
 *   3. Floor the wait at the caller's waitMs — some SPAs still want the
 *      explicit pause even after network goes idle.
 */
async function warmupAndClearCF(page: PuppeteerPage, warmupUrl: string, waitMs: number): Promise<void> {
  try {
    await page.goto(warmupUrl, { waitUntil: "networkidle2", timeout: 30000 });
  } catch {
    // networkidle2 can time out on sites that hold long-poll connections open.
    // Fall back to domcontentloaded so we still have a page to work with.
    await page.goto(warmupUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  }

  // Poll for cf_clearance. If the site isn't behind CF, the cookie never
  // appears — cap the poll at 8s so we don't waste the budget.
  const cookieDeadline = Date.now() + 8000;
  while (Date.now() < cookieDeadline) {
    const cookies = await page.cookies().catch(() => []);
    if (cookies.some((c) => c.name === "cf_clearance")) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  // Caller-requested floor (SPA Ajax init, etc.)
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
}

async function runRequest(page: PuppeteerPage, r: FetchRequest): Promise<PageResult> {
  if (r.mode === "navigate") return await navigateAndCapture(page, r);
  return await runFetchInPage(page, r);
}

/**
 * SPA mode: actually navigate the browser to the target URL so its JS runs,
 * then optionally wait for a selector that indicates the content has loaded,
 * and return the fully-rendered HTML.
 */
async function navigateAndCapture(page: PuppeteerPage, r: FetchRequest): Promise<PageResult> {
  const resp = await page.goto(r.url, { waitUntil: "networkidle2", timeout: 45000 }).catch((e) => {
    throw new Error(`navigate failed: ${e instanceof Error ? e.message : String(e)}`);
  });
  const status = resp?.status() ?? 0;

  if (r.waitForSelector) {
    await page.waitForSelector(r.waitForSelector, { timeout: 20000 }).catch(() => {
      // Don't throw — we still want to return whatever rendered. The caller
      // will see the status and empty parse and can decide.
    });
  }
  if (r.waitAfterNav && r.waitAfterNav > 0) {
    await new Promise((res) => setTimeout(res, r.waitAfterNav));
  }

  const body = await page.content();
  return { status, body, finalUrl: page.url() };
}

async function runFetchInPage(page: PuppeteerPage, r: FetchRequest): Promise<PageResult> {
  return await page.evaluate(
    async (url, method, body, headers) => {
      const init = {
        method: method ?? "GET",
        headers: headers ?? {},
        body: body ?? undefined,
        credentials: "include",
      } as unknown as RequestInit;
      const resp = await fetch(url, init);
      const text = await resp.text();
      return { status: resp.status, body: text, finalUrl: resp.url };
    },
    r.url,
    r.method ?? "GET",
    r.body ?? null,
    r.headers ?? {},
  );
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
