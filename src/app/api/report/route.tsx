import { NextRequest, NextResponse } from "next/server";
import { getAssessment } from "@/lib/assessment";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const data = await getAssessment(id);
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (data.status !== "ready") return NextResponse.json({ error: "not ready" }, { status: 409 });

  // Dynamically import so the build doesn't fail when packages aren't installed
  let chromiumMod: { default: { args: string[]; defaultViewport: unknown; executablePath: () => Promise<string> } };
  let puppeteerMod: { launch: (opts: unknown) => Promise<{ newPage: () => Promise<{ setContent: (html: string, opts: unknown) => Promise<void>; pdf: (opts: unknown) => Promise<Uint8Array> }>; close: () => Promise<void> }> };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    chromiumMod = require("@sparticuz/chromium");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    puppeteerMod = require("puppeteer-core");
  } catch {
    return NextResponse.json({ error: "pdf renderer not available" }, { status: 503 });
  }

  const { renderToStaticMarkup } = await import("react-dom/server");
  const { ReportDocument } = await import("@/components/assessment/pdf/ReportDocument");

  const reportData = {
    reportId: data.reportId,
    preparedAt: data.preparedAt,
    companyName: data.companyName,
    sector: data.sector,
    score: data.score,
    scoreDelta: data.scoreDelta,
    tier: data.tier,
    dimensions: data.dimensions,
    gaps: data.pdfGaps,
    tenders: data.pdfTenders,
    grants: data.pdfGrants,
    plan: data.plan,
    citations: data.citations,
  };

  const bodyHtml = renderToStaticMarkup(<ReportDocument data={reportData} />);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>TenderPath Report — ${data.companyName}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
  :root {
    --tp2-ink:#0f1620;--tp2-ink-2:#2b3543;--tp2-paper:#f6f3ec;
    --tp2-paper-2:#ece6d5;--tp2-rule:#d8d1bf;--tp2-mute:#6b6557;
    --tp2-accent:#9c6b1f;--tp2-pos:#1f6b3d;--tp2-neg:#9c2a2a;
    --tp2-display:"Fraunces",Georgia,serif;
    --tp2-sans:"Inter",sans-serif;
    --tp2-mono:"JetBrains Mono",monospace;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:var(--tp2-sans);background:var(--tp2-paper);color:var(--tp2-ink);font-size:12px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .tp2-pdf-doc{width:100%}
  @page{size:A4;margin:0}
</style>
</head>
<body>${bodyHtml}</body>
</html>`;

  try {
    const chromium = chromiumMod.default;
    const browser = await puppeteerMod.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBytes = await page.pdf({ format: "A4", printBackground: true });
    await browser.close();

    const slug = data.companyName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="tenderpath-${slug}-${data.reportId}.pdf"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "pdf generation failed" }, { status: 500 });
  }
}
