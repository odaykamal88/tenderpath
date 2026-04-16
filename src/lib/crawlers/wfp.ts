import { type RawTender, type CrawlResult, withRetry, fetchWithTimeout } from "./types";

const WFP_URL = "https://www.wfp.org/procurement";

function parseHTML(html: string): RawTender[] {
  const tenders: RawTender[] = [];
  const blockRegex =
    /<(?:tr|div|article|li)[^>]*class="[^"]*(?:procurement|tender|views-row|node)[^"]*"[^>]*>([\s\S]*?)<\/(?:tr|div|article|li)>/gi;
  let match;

  while ((match = blockRegex.exec(html)) !== null) {
    const block = match[1];
    const titleMatch = block.match(
      /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!titleMatch) continue;

    const href = titleMatch[1];
    const title = titleMatch[2].replace(/<[^>]+>/g, "").trim();
    if (!title || title.length < 5) continue;

    const idMatch = href.match(/[\/-](\d{4,})/);
    const dateMatch = block.match(
      /(\d{1,2}[\s/-]\w{3,}[\s/-]\d{4}|\d{4}-\d{2}-\d{2})/,
    );
    const countryMatch = block.match(
      /(?:country|location)[:\s]*([^<,]+)/i,
    );

    tenders.push({
      reference_id: `WFP-${idMatch?.[1] ?? title.slice(0, 20).replace(/\s+/g, "-")}`,
      title,
      description: null,
      agency: "WFP",
      country: countryMatch?.[1]?.trim() ?? "Global",
      country_code: null,
      region: null,
      sector: null,
      deadline: parseDate(dateMatch?.[1] ?? ""),
      estimated_value: null,
      source_url: href.startsWith("http")
        ? href
        : `https://www.wfp.org${href}`,
      opportunity_type: "RFP",
      eligibility_summary: null,
      experience_level: null,
      submission_language: "English",
      source_tier: 1,
      source_name: "WFP",
    });
  }
  return tenders;
}

function parseDate(raw: string): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
}

export async function crawlWFP(): Promise<CrawlResult> {
  const start = Date.now();
  try {
    const html = await withRetry(async () => {
      const resp = await fetchWithTimeout(WFP_URL, {
        headers: {
          "User-Agent": "TenderPath/1.0 (procurement-aggregator)",
          Accept: "text/html",
        },
      });
      if (!resp.ok) throw new Error(`WFP ${resp.status}`);
      return resp.text();
    });

    const tenders = parseHTML(html);

    return {
      platform: "WFP",
      status: "success",
      tenders,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      platform: "WFP",
      status: "failure",
      tenders: [],
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
