import type { CrawledData } from "@/lib/types";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const ACCEPT_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/**
 * Ordered by business-description value: identity/about pages first,
 * then service/capability pages. Probed concurrently; best 2 kept.
 */
const SUBPATHS = [
  "/about-us",
  "/about",
  "/who-we-are",
  "/company",
  "/services",
  "/what-we-do",
  "/our-work",
  "/expertise",
  "/solutions",
  "/capabilities",
  "/mission",
];

const CONTENT_CAP = 8000;
const FETCH_TIMEOUT_MS = 12000;
const BROWSER_FALLBACK_TIMEOUT_MS = 20000;
/** Text-to-HTML ratio below which a page is considered a JS shell. */
const SPA_RATIO_THRESHOLD = 0.04;
/** Max visible-text length for a page to be classified as an SPA shell. */
const SPA_TEXT_MAX = 600;
/** Minimum chars a subpage must produce to count. */
const SUBPAGE_MIN_CHARS = 300;
/** Leading chars checked for homepage-mirror deduplication. */
const SUBPAGE_DUPE_PREFIX = 300;

interface FetchResult {
  html: string;
  finalUrl: string;
}

function normalizeUrl(raw: string): string {
  let url = raw.trim();
  if (!url.match(/^https?:\/\//)) url = "https://" + url;
  return url.replace(/\/+$/, "");
}

/** eTLD+1 approximation — last two dot-segments of the hostname. */
function etld1(url: string): string {
  try {
    const parts = new URL(url).hostname.split(".");
    return parts.slice(-2).join(".");
  } catch {
    return "";
  }
}

/** Origin (scheme+host) of a resolved URL, used as the subpath base. */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

async function fetchPage(url: string): Promise<FetchResult | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: ACCEPT_HEADERS,
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) return null;

    return { html: await res.text(), finalUrl: res.url };
  } catch {
    return null;
  }
}

/** True when the HTML is a JS-rendered shell with near-no visible text. */
function isSpaShell(html: string, visibleText: string): boolean {
  if (/(<div[^>]+id=["'](?:root|app|__next|__nuxt)["'])/i.test(html)) {
    if (visibleText.length < SPA_TEXT_MAX) return true;
  }
  const ratio = html.length > 0 ? visibleText.length / html.length : 0;
  return ratio < SPA_RATIO_THRESHOLD && visibleText.length < SPA_TEXT_MAX;
}

/** True when the page redirected to a login/auth wall. */
function isLoginWall(html: string, finalUrl: string): boolean {
  if (!/<input[^>]+type=["']?password/i.test(html)) return false;
  const path = (() => {
    try {
      return new URL(finalUrl).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();
  return /\/(login|auth|signin|sign-in|account|sso)\b/.test(path);
}

/**
 * Call the Cloudflare browser worker in navigate mode for JS-rendered pages.
 * Returns null and logs when the worker is unavailable, errors, or times out.
 */
async function fetchViaBrowserWorker(url: string): Promise<FetchResult | null> {
  const workerUrl = process.env.CRAWLER_WORKER_URL;
  const crawlerKey = process.env.CRAWLER_WORKER_KEY;

  if (!workerUrl || !crawlerKey) {
    console.warn("[crawl] CRAWLER_WORKER_URL or CRAWLER_WORKER_KEY not set — skipping browser fallback");
    return null;
  }

  const fetchPromise = fetch(`${workerUrl}/fetch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Crawler-Key": crawlerKey,
    },
    body: JSON.stringify({
      url,
      mode: "navigate",
      warmupUrl: originOf(url),
      waitMs: 1500,
    }),
  })
    .then(async (res) => {
      if (!res.ok) {
        console.warn(`[crawl] Browser worker responded ${res.status} for ${url}`);
        return null;
      }
      const data = (await res.json()) as {
        ok: boolean;
        body?: string;
        finalUrl?: string;
      };
      if (!data.ok || !data.body) return null;
      return { html: data.body, finalUrl: data.finalUrl ?? url } satisfies FetchResult;
    })
    .catch((err) => {
      console.warn(
        "[crawl] Browser worker error:",
        err instanceof Error ? err.message : String(err)
      );
      return null;
    });

  const timeoutPromise = new Promise<null>((resolve) =>
    setTimeout(() => {
      console.warn(
        `[crawl] Browser worker timed out after ${BROWSER_FALLBACK_TIMEOUT_MS}ms for ${url}`
      );
      resolve(null);
    }, BROWSER_FALLBACK_TIMEOUT_MS)
  );

  return Promise.race([fetchPromise, timeoutPromise]);
}

function extractMeta(html: string) {
  const title =
    html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]?.trim() ?? null;
  const metaDescription =
    html.match(
      /<meta[^>]*name=["']description["'][^>]*content=["'](.*?)["']/is
    )?.[1] ??
    html.match(
      /<meta[^>]*content=["'](.*?)["'][^>]*name=["']description["']/is
    )?.[1] ??
    null;
  const ogDescription =
    html.match(
      /<meta[^>]*property=["']og:description["'][^>]*content=["'](.*?)["']/is
    )?.[1] ?? null;

  return { title, metaDescription, ogDescription };
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Crawl a company website and return structured data for AI analysis.
 *
 * Improvements over the previous version:
 * - Captures finalUrl from redirect resolution; aborts on domain drift.
 * - Detects SPA shells and login walls; falls back to browser worker when
 *   CRAWLER_WORKER_URL + CRAWLER_KEY are available.
 * - Probes a broader subpath list and deduplicates homepage mirrors.
 * - Assembles content with about/services text first, homepage body second
 *   so the CONTENT_CAP budget is spent on business-description material.
 */
export async function crawlWebsite(url: string): Promise<CrawledData | null> {
  const inputBase = normalizeUrl(url);

  // --- Stage 1: static homepage fetch ---
  let homeResult = await fetchPage(inputBase);
  if (!homeResult) return null;

  // --- Stage 2: domain-drift guard ---
  const inputEtld = etld1(inputBase);
  const resolvedEtld = etld1(homeResult.finalUrl);
  if (inputEtld && resolvedEtld && inputEtld !== resolvedEtld) {
    console.warn(
      `[crawl] Domain drift: ${inputBase} → ${homeResult.finalUrl} — marking as failed`
    );
    const meta = extractMeta(homeResult.html);
    return {
      title: meta.title,
      metaDescription: meta.metaDescription,
      ogDescription: meta.ogDescription,
      content: "",
      isThinContent: true,
      finalUrl: homeResult.finalUrl,
      renderMethod: "failed",
    };
  }

  // --- Stage 3: SPA-shell / login-wall → browser worker fallback ---
  const homeText = htmlToText(homeResult.html);
  let renderMethod: CrawledData["renderMethod"] = "static";

  if (isSpaShell(homeResult.html, homeText) || isLoginWall(homeResult.html, homeResult.finalUrl)) {
    const browserResult = await fetchViaBrowserWorker(homeResult.finalUrl);
    if (browserResult) {
      homeResult = browserResult;
      renderMethod = "browser";
    } else {
      // Worker unavailable or timed out — return thin static result rather than null
      const meta = extractMeta(homeResult.html);
      return {
        title: meta.title,
        metaDescription: meta.metaDescription,
        ogDescription: meta.ogDescription,
        content: homeText.substring(0, CONTENT_CAP),
        isThinContent: true,
        finalUrl: homeResult.finalUrl,
        renderMethod: "failed",
      };
    }
  }

  // Re-extract text if browser rendering replaced the HTML
  const finalHomeText =
    renderMethod === "browser" ? htmlToText(homeResult.html) : homeText;
  const meta = extractMeta(homeResult.html);

  // Probe subpaths against the resolved origin (avoids repeated redirect overhead)
  const subBase = originOf(homeResult.finalUrl);

  // --- Stage 4: subpath probing ---
  const subResults = await Promise.allSettled(
    SUBPATHS.map((p) => fetchPage(subBase + p))
  );

  const subTexts: string[] = [];
  for (const result of subResults) {
    if (subTexts.length >= 2) break;
    if (result.status !== "fulfilled" || !result.value) continue;

    const subText = htmlToText(result.value.html);

    // Quality gate: skip thin pages
    if (subText.length < SUBPAGE_MIN_CHARS) continue;

    // Dedup: skip pages that are mirrors of the homepage
    const prefix = subText.substring(0, SUBPAGE_DUPE_PREFIX);
    if (finalHomeText.includes(prefix)) continue;

    subTexts.push(subText);
  }

  // --- Stage 5: content assembly — subpages before homepage body ---
  // Subpages come first so business-description material leads the context.
  // A final substring enforces CONTENT_CAP even when a single subpage is large.
  let content: string;
  if (subTexts.length > 0) {
    const subContent = subTexts.join("\n\n--- Additional Page ---\n");
    const remaining = Math.max(0, CONTENT_CAP - subContent.length);
    content =
      subContent +
      (remaining > 0
        ? "\n\n--- Homepage ---\n" + finalHomeText.substring(0, remaining)
        : "");
  } else {
    content = finalHomeText.substring(0, CONTENT_CAP);
  }
  content = content.substring(0, CONTENT_CAP);

  const isThinContent = content.trim().length < 300;

  return {
    title: meta.title,
    metaDescription: meta.metaDescription,
    ogDescription: meta.ogDescription,
    content,
    isThinContent,
    finalUrl: homeResult.finalUrl,
    renderMethod,
  };
}
