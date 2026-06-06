import type { CrawledData } from "./types";
import { assertSafeHttpUrl, UnsafeUrlError } from "./security/safe-url";

export async function crawlWebsite(url: string): Promise<CrawledData | null> {
  try {
    let normalizedUrl = url;
    if (!normalizedUrl.match(/^https?:\/\//)) {
      normalizedUrl = "https://" + normalizedUrl;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let currentUrl = normalizedUrl;
    let response: Response | null = null;
    for (let hop = 0; hop <= 5; hop += 1) {
      const safeUrl = await assertSafeHttpUrl(currentUrl);
      response = await fetch(safeUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "manual",
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location) return null;
      currentUrl = new URL(location, safeUrl).toString();
    }

    if (!response) return null;

    clearTimeout(timeout);

    const html = await response.text();

    const title = html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]?.trim() ?? null;
    const metaDescription =
      html.match(/<meta[^>]*name=["']description["'][^>]*content=["'](.*?)["']/is)?.[1] ?? null;
    const ogDescription =
      html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["'](.*?)["']/is)?.[1] ?? null;

    const textContent = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const content = textContent.substring(0, 5000);
    const isThinContent = textContent.length < 200;

    return { title, metaDescription, ogDescription, content, isThinContent };
  } catch (err) {
    if (err instanceof UnsafeUrlError) {
      console.warn("[crawl:simple] Unsafe URL blocked", { code: err.code });
    }
    return null;
  }
}
