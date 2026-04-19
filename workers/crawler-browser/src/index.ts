/**
 * Cloudflare Browser Rendering Worker — bypasses Cloudflare bot protection
 * on UN/MDB procurement sites by running requests through a real Chromium
 * instance (proper TLS/JA3 fingerprint).
 *
 * Endpoints:
 *   POST /fetch        — single request (launch, warmup, one fetch, close)
 *   POST /fetch-many   — batch request (launch, warmup ONCE, N fetches, close).
 *                        Critical for paginated crawls: re-warming per page
 *                        wastes ~15s × N on re-launching Chromium + clearing
 *                        Cloudflare, which blows through Vercel's 300s cron
 *                        budget. Amortize warmup across all pages in one call.
 *
 * Auth: X-Crawler-Key header must match CRAWLER_KEY secret.
 */
import puppeteer from "@cloudflare/puppeteer";

export interface Env {
  BROWSER: Fetcher;           // browser_rendering binding
  CRAWLER_KEY: string;        // wrangler secret
}

interface FetchRequest {
  url: string;
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
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

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== "POST") return new Response("Not found", { status: 404 });
    if (req.headers.get("X-Crawler-Key") !== env.CRAWLER_KEY) {
      return new Response("Unauthorized", { status: 401 });
    }
    const path = new URL(req.url).pathname;
    if (path === "/fetch") return handleFetch(req, env);
    if (path === "/fetch-many") return handleFetchMany(req, env);
    return new Response("Not found", { status: 404 });
  },
};

async function handleFetch(req: Request, env: Env): Promise<Response> {
  let input: FetchBody;
  try { input = await req.json(); } catch { return json({ ok: false, status: 0, body: "invalid JSON body" }, 400); }
  if (!input.url) return json({ ok: false, status: 0, body: "url required" }, 400);

  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await setupPage(page);
    const warmup = input.warmupUrl ?? new URL(input.url).origin;
    await page.goto(warmup, { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise((r) => setTimeout(r, input.waitMs ?? 1500));

    const result = await runFetchInPage(page, {
      url: input.url,
      method: input.method,
      body: input.body,
      headers: input.headers,
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
    await page.goto(input.warmupUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise((r) => setTimeout(r, input.waitMs ?? 2000));

    const results: PageResult[] = [];
    const baseDelay = input.delayMs ?? 800;
    for (let i = 0; i < input.requests.length; i++) {
      if (i > 0) {
        const jitter = baseDelay * (0.75 + Math.random() * 0.5);
        await new Promise((r) => setTimeout(r, jitter));
      }
      try {
        const r = await runFetchInPage(page, input.requests[i]);
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

async function setupPage(page: Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>["newPage"]>>): Promise<void> {
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  );
}

async function runFetchInPage(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>["newPage"]>>,
  r: FetchRequest,
): Promise<PageResult> {
  return await page.evaluate(
    async (url, method, body, headers) => {
      // Runs in browser context — `fetch` here is the DOM fetch, which
      // accepts `credentials`. TS sees the Workers fetch signature because
      // of our tsconfig env, hence the cast.
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
