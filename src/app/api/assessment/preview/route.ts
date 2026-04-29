import { NextResponse } from "next/server";
import { crawlWebsite } from "@/lib/assessment/crawl";
import { classifyIndustry, inferProfileExtras } from "@/lib/assessment/analyze";

function inferConfidence(
  crawl: Awaited<ReturnType<typeof crawlWebsite>> | null
): "high" | "medium" | "low" {
  if (!crawl) return "low";
  if (crawl.renderMethod === "parked" || crawl.renderMethod === "failed") return "low";
  if (crawl.isThinContent) return "low";
  const hasGoodMeta = Boolean(crawl.metaDescription || crawl.ogDescription);
  const hasContent = (crawl.content ?? "").length > 200;
  if (hasGoodMeta && hasContent) return "high";
  if (hasContent) return "medium";
  return "low";
}

export async function POST(request: Request) {
  const body = await request.json() as { website?: string };
  if (!body.website?.trim()) {
    return NextResponse.json({ error: "website is required" }, { status: 400 });
  }

  try {
    const crawl = await crawlWebsite(body.website.trim());
    const confidence = inferConfidence(crawl);

    let detectedSectors: string[] = [];
    let detectedServices: string[] = [];
    const detectedName: string | null = crawl?.title ?? null;
    let detectedOrgType: string | null = null;
    let detectedCountries: string[] = [];
    let detectedLanguage: string | null = null;

    const description = crawl
      ? [crawl.title, crawl.metaDescription, crawl.ogDescription, (crawl.content ?? "").slice(0, 600)]
          .filter(Boolean).join(" — ").trim()
      : "";

    if (description) {
      if (confidence !== "low" && crawl) {
        const [classification, extras] = await Promise.all([
          classifyIndustry(crawl, description, [], undefined, undefined),
          inferProfileExtras(crawl, description),
        ]);
        detectedSectors = classification.sectors ?? [];
        detectedServices = classification.services ?? [];
        detectedOrgType = extras.orgType;
        detectedCountries = extras.operatingCountries;
        detectedLanguage = extras.submissionLanguage;
      } else {
        const extras = await inferProfileExtras(crawl, description);
        detectedOrgType = extras.orgType;
        detectedCountries = extras.operatingCountries;
        detectedLanguage = extras.submissionLanguage;
      }
    }

    const detectedDescription =
      crawl?.metaDescription?.trim() ||
      crawl?.ogDescription?.trim() ||
      (crawl?.content ? crawl.content.slice(0, 220).trim() : null) ||
      null;

    return NextResponse.json({
      confidence,
      detectedName,
      detectedDescription,
      detectedSectors,
      detectedServices,
      detectedOrgType,
      detectedCountries,
      detectedLanguage,
      isThinContent: crawl?.isThinContent ?? true,
      renderMethod: crawl?.renderMethod ?? "failed",
      finalUrl: crawl?.finalUrl ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Preview failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
