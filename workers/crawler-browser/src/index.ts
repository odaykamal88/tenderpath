/**
 * Cloudflare Browser Rendering Worker — bypasses Cloudflare bot protection
 * on UN/MDB procurement sites by running requests through a real Chromium
 * instance (proper TLS/JA3 fingerprint).
 *
 * Protocol:
 *   POST /fetch
 *   Header: X-Crawler-Key: <shared secret>
 *   Body:   { "url": string,
 *             "method"?: "GET"|"POST",
 *             "body"?: string,            // JSON-stringified if POST
 *             "headers"?: Record<string,string>,
 *             "warmupUrl"?: string,        // page to visit first (for CF cookies)
 *             "waitMs"?: number            // extra wait after warmup (default 1500)
 *           }
 *   Reply:  { ok: boolean, status: number, body: string, finalUrl?: string }
 */
import puppeteer from "@cloudflare/puppeteer";

export interface Env {
  BROWSER: Fetcher;           // browser_rendering binding
  CRAWLER_KEY: string;        // wrangler secret
}

interface FetchBody {
  url: string;
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
  warmupUrl?: string;
  waitMs?: number;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== "POST" || new URL(req.url).pathname !== "/fetch") {
      return new Response("Not found", { status: 404 });
    }
    if (req.headers.get("X-Crawler-Key") !== env.CRAWLER_KEY) {
      return new Response("Unauthorized", { status: 401 });
    }

    let input: FetchBody;
    try {
      input = await req.json();
    } catch {
      return json({ ok: false, status: 0, body: "invalid JSON body" }, 400);
    }
    if (!input.url) return json({ ok: false, status: 0, body: "url required" }, 400);

    const browser = await puppeteer.launch(env.BROWSER);
    try {
      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      );

      // Warm up on the site's origin first so Cloudflare clears us and sets cookies.
      const warmup = input.warmupUrl ?? new URL(input.url).origin;
      await page.goto(warmup, { waitUntil: "domcontentloaded", timeout: 30000 });
      await new Promise((r) => setTimeout(r, input.waitMs ?? 1500));

      // Run the actual request from inside the page context — real Chrome fetch,
      // real TLS fingerprint, carries whatever cookies CF just set.
      const result = await page.evaluate(
        async (url, method, body, headers) => {
          const resp = await fetch(url, {
            method: method ?? "GET",
            headers: headers ?? {},
            body: body ?? undefined,
            credentials: "include",
          });
          const text = await resp.text();
          return { status: resp.status, body: text, finalUrl: resp.url };
        },
        input.url,
        input.method ?? "GET",
        input.body ?? null,
        input.headers ?? {},
      );

      return json({
        ok: result.status >= 200 && result.status < 400,
        status: result.status,
        body: result.body,
        finalUrl: result.finalUrl,
      });
    } catch (err) {
      return json(
        { ok: false, status: 0, body: err instanceof Error ? err.message : String(err) },
        502,
      );
    } finally {
      await browser.close();
    }
  },
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
