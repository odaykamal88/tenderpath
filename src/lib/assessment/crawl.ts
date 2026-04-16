import type { CrawledData } from "@/lib/types";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const ACCEPT_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/** Paths to probe beyond the homepage for richer company context. */
const SUBPATHS = ["/about", "/about-us", "/services", "/what-we-do"];

const CONTENT_CAP = 8000;
const FETCH_TIMEOUT_MS = 12000;

function normalizeUrl(raw: string): string {
  let url = raw.trim();
  if (!url.match(/^https?:\/\//)) url = "https://" + url;
  // Strip trailing slash for consistent subpath appending
  return url.replace(/\/+$/, "");
}

async function fetchPage(url: string): Promise<string | null> {
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

    return await res.text();
  } catch {
    return null;
  }
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
 * Crawl a company website. Fetches homepage plus up to 2 subpages for richer
 * context. Returns structured data for the AI analysis stage.
 */
export async function crawlWebsite(
  url: string
): Promise<CrawledData | null> {
  const base = normalizeUrl(url);

  // Fetch homepage
  const homeHtml = await fetchPage(base);
  if (!homeHtml) return null;

  const meta = extractMeta(homeHtml);
  let combinedText = htmlToText(homeHtml);

  // Probe subpages concurrently — take first 2 that return content
  const subResults = await Promise.allSettled(
    SUBPATHS.map((p) => fetchPage(base + p))
  );

  let subPagesAdded = 0;
  for (const result of subResults) {
    if (subPagesAdded >= 2) break;
    if (result.status === "fulfilled" && result.value) {
      const subText = htmlToText(result.value);
      if (subText.length > 100) {
        combinedText += "\n\n--- Additional Page ---\n" + subText;
        subPagesAdded++;
      }
    }
  }

  const content = combinedText.substring(0, CONTENT_CAP);
  const isThinContent = combinedText.length < 300;

  return {
    title: meta.title,
    metaDescription: meta.metaDescription,
    ogDescription: meta.ogDescription,
    content,
    isThinContent,
  };
}
