/**
 * UK Find a Tender Service (FTS) — successor to OJEU for UK public procurement.
 * Includes FCDO contracts. Publishes OCDS releases.
 * Free, no API key. Docs: https://www.find-tender.service.gov.uk/apidocumentation
 */
import { type RawTender, type CrawlResult, withRetry, fetchWithTimeout } from "./types";
import { ocdsToRawTender, type OCDSRelease } from "./ocds";

const FTS_API = "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages";
const MAX_PAGES = 3;

interface OCDSPackage {
  releases?: OCDSRelease[];
  links?: { next?: string };
}

async function fetchPage(url: string): Promise<OCDSPackage> {
  const resp = await fetchWithTimeout(url, {
    headers: { Accept: "application/json", "User-Agent": "TenderPath/1.0" },
  });
  if (!resp.ok) throw new Error(`UK FTS ${resp.status}`);
  return (await resp.json()) as OCDSPackage;
}

export async function crawlUKFTS(): Promise<CrawlResult> {
  const start = Date.now();
  try {
    const tenders: RawTender[] = [];
    // Last 7 days of releases.
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    let url: string | undefined = `${FTS_API}?updatedFrom=${since}&stages=tender`;

    for (let p = 0; p < MAX_PAGES && url; p++) {
      const pkg: OCDSPackage = await withRetry(() => fetchPage(url!));
      for (const r of pkg.releases ?? []) {
        const t = ocdsToRawTender(r, {
          sourcePrefix: "UKFTS",
          sourceName: "UK Find a Tender",
          sourceTier: 1,
          urlBuilder: (rel) => rel.ocid
            ? `https://www.find-tender.service.gov.uk/Notice/${rel.ocid.replace("ocds-h6vhtk-", "")}`
            : null,
        });
        if (t) tenders.push(t);
      }
      url = pkg.links?.next;
    }

    return { platform: "UK FTS", status: "success", tenders, durationMs: Date.now() - start };
  } catch (err) {
    return {
      platform: "UK FTS", status: "failure", tenders: [], durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
