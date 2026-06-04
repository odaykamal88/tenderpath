import { NextRequest, NextResponse } from "next/server";
import { getAssessment } from "@/lib/assessment";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    console.warn("[report:pdf:no_id]");
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const data = await getAssessment(id);
  if (!data) {
    console.warn("[report:pdf:not_found]", { idPrefix: id.slice(0, 8) });
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (data.status !== "ready") {
    console.warn("[report:pdf:not_ready]", { reportId: data.reportId, status: data.status });
    return NextResponse.json({ error: "not ready" }, { status: 409 });
  }

  // HTML+print fallback. When chromium/puppeteer can't render — module missing,
  // launch fail, render timeout — we redirect here so the user always lands on
  // a printable report instead of a dead JSON error tab.
  const fallbackUrl = new URL(`/api/assessment/${data.reportId}/pdf`, req.url);

  // Dynamically import so the build doesn't fail when packages aren't installed
  let chromiumMod: { default: { args: string[]; defaultViewport: unknown; executablePath: () => Promise<string> } };
  let puppeteerMod: { launch: (opts: unknown) => Promise<{ newPage: () => Promise<{ setContent: (html: string, opts: unknown) => Promise<void>; pdf: (opts: unknown) => Promise<Uint8Array> }>; close: () => Promise<void> }> };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    chromiumMod = require("@sparticuz/chromium");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    puppeteerMod = require("puppeteer-core");
  } catch (err) {
    console.warn("[report:pdf:module_unavailable]", {
      reportId: data.reportId,
      errorName: err instanceof Error ? err.name : "unknown",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.redirect(fallbackUrl, 307);
  }

  // Render the SAME fully-inline-styled HTML the print fallback serves, then
  // turn it into a real downloadable PDF. The previous ReportDocument variant
  // relied on CSS-module class names that never make it into setContent's HTML
  // (modules are extracted to a separate bundle), so it rendered unstyled AND
  // edge-to-edge. The fallback markup carries every style inline; page margins
  // come from its print `.page` padding (the route below keeps puppeteer's own
  // margins at 0 so they don't stack).
  let html: string;
  try {
    const htmlRes = await fetch(fallbackUrl.toString(), { cache: "no-store" });
    if (!htmlRes.ok) {
      console.warn("[report:pdf:fallback_html_unavailable]", {
        reportId: data.reportId,
        status: htmlRes.status,
      });
      return NextResponse.redirect(fallbackUrl, 307);
    }
    html = await htmlRes.text();
    // Guard against a 200 that isn't our report — e.g. a Vercel deployment-
    // protection interstitial intercepting the self-fetch. Rendering that into
    // a PDF would ship a broken file; instead hand the user the printable page
    // directly (their browser session is already authorized).
    if (!html.toLowerCase().includes("readiness report")) {
      console.warn("[report:pdf:fallback_html_unexpected]", { reportId: data.reportId });
      return NextResponse.redirect(fallbackUrl, 307);
    }
  } catch (err) {
    console.warn("[report:pdf:fallback_html_fetch_failed]", {
      reportId: data.reportId,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.redirect(fallbackUrl, 307);
  }

  // Track which phase failed so the log line names the failing stage. A flat
  // `try { ... } catch (err) { log(err) }` only tells us "something inside the
  // try block threw", which makes the difference between a launch fail, a
  // setContent fail, and a pdf() timeout invisible in prod logs.
  let stage = "init";
  try {
    stage = "launch";
    const chromium = chromiumMod.default;
    const browser = await puppeteerMod.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
    stage = "new_page";
    const page = await browser.newPage();
    stage = "set_content";
    await page.setContent(html, { waitUntil: "networkidle0" });
    stage = "render_pdf";
    // margin:0 — the report HTML supplies its own page padding (14mm via the
    // print `.page` rule), so content stays inset while the background still
    // fills the sheet. Setting margins here too would double the gutter.
    const pdfBytes = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    stage = "close";
    await browser.close();

    const slug = data.companyName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="tenderpath-${slug}-${data.displayNumber}.pdf"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    console.error("[report:pdf:render_failed]", {
      reportId: data.reportId,
      stage,
      errorName: err instanceof Error ? err.name : "unknown",
      errorMessage: err instanceof Error ? err.message : String(err),
      errorCode: (err as { code?: string | number })?.code,
    });
    // Graceful degrade: send the user to the HTML+print fallback instead of a
    // dead JSON error tab. Their dashboard PDF button always lands on
    // something printable.
    return NextResponse.redirect(fallbackUrl, 307);
  }
}
