import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import {
  extractTenderRequirements,
  generateBidNoBidAnalysis,
} from "@/lib/bid-no-bid/llm";
import { renderBidNoBidPdf } from "@/lib/bid-no-bid/pdfDoc";
import { sendBidNoBidReadyEmail } from "@/lib/email/sendBidNoBidNotification";

export interface AdminBidNoBidRequest {
  // Tender fields
  tender_title?: string;
  tender_agency?: string;
  tender_url?: string;
  tender_description?: string;
  tender_deadline?: string;
  tender_value?: string;
  tender_sector?: string;
  tender_eligibility?: string;
  // Company / consortium fields
  company_name?: string;
  company_description?: string;
  company_sector?: string;
  company_countries?: string;
  company_capabilities?: string;
  intake_notes?: string;
  consortium_members?: Array<{
    name: string;
    url?: string;
    description?: string;
    capabilities?: string;
  }>;
  // Optional: email address to receive a PDF copy
  send_to?: string;
}

function buildTenderText(body: AdminBidNoBidRequest): string {
  const parts: string[] = [];
  if (body.tender_title) parts.push(`TITLE: ${body.tender_title}`);
  if (body.tender_agency) parts.push(`ISSUING AGENCY: ${body.tender_agency}`);
  if (body.tender_url) parts.push(`SOURCE URL: ${body.tender_url}`);
  if (body.tender_deadline) parts.push(`DEADLINE: ${body.tender_deadline}`);
  if (body.tender_value) parts.push(`ESTIMATED VALUE: ${body.tender_value}`);
  if (body.tender_sector) parts.push(`SECTOR: ${body.tender_sector}`);
  if (body.tender_eligibility) {
    parts.push(`\nELIGIBILITY CRITERIA:\n${body.tender_eligibility}`);
  }
  if (body.tender_description) {
    parts.push(`\nFULL DESCRIPTION:\n${body.tender_description}`);
  }
  return parts.join("\n");
}

function buildCompanyContext(body: AdminBidNoBidRequest): string {
  const parts: string[] = [];

  const name = body.company_name || "Unknown Organisation";
  parts.push(`ORGANISATION: ${name}`);

  if (body.company_sector) parts.push(`SECTOR: ${body.company_sector}`);
  if (body.company_countries) parts.push(`OPERATING COUNTRIES: ${body.company_countries}`);
  if (body.company_description) {
    parts.push(`\nORGANISATION DESCRIPTION:\n${body.company_description}`);
  }
  if (body.company_capabilities) {
    parts.push(`\nKEY CAPABILITIES:\n${body.company_capabilities}`);
  }

  const members = body.consortium_members ?? [];
  if (members.length > 0) {
    parts.push(`\nCONSORTIUM STRUCTURE (${members.length} member${members.length === 1 ? "" : "s"}):`);
    for (const m of members) {
      const lines = [`  - ${m.name}`];
      if (m.url) lines.push(`    URL: ${m.url}`);
      if (m.description) lines.push(`    Description: ${m.description}`);
      if (m.capabilities) lines.push(`    Capabilities: ${m.capabilities}`);
      parts.push(lines.join("\n"));
    }
  }

  return parts.join("\n");
}

export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  let body: AdminBidNoBidRequest;
  try {
    body = (await request.json()) as AdminBidNoBidRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const tenderText = buildTenderText(body).trim();
  if (!tenderText) {
    return NextResponse.json(
      { error: "Provide at least a tender title or description." },
      { status: 422 }
    );
  }

  const companyContext = buildCompanyContext(body).trim();
  const intakeSummary = body.intake_notes ?? "";

  try {
    const requirements = await extractTenderRequirements(tenderText);
    // Admin path runs in a sandbox — no user_id, no intake row, no
    // pasted/uploaded docs to gather. The structured-docs section is
    // intentionally empty; the LLM falls back to the company profile +
    // tender text alone. PR-F.
    const output = await generateBidNoBidAnalysis(
      {
        tenderText,
        companyContext,
        intakeSummary,
        applicantDocumentsContext: "",
        documentFileNames: [],
      },
      requirements
    );

    let emailSent = false;
    if (body.send_to) {
      try {
        const pdfBuffer = await renderBidNoBidPdf({
          workOrderId: 0,
          companyName: body.company_name ?? "Admin Test",
          tenderTitle: body.tender_title ?? null,
          agency: body.tender_agency ?? null,
          output,
          generatedAt: new Date().toISOString(),
        });
        await sendBidNoBidReadyEmail({
          email: body.send_to,
          workOrderId: 0,
          tenderTitle: body.tender_title ?? null,
          agency: body.tender_agency ?? null,
          recommendation: output.recommendation,
          winProbabilityBand: output.win_probability_band,
          pdfUrl: null,
          pdfBuffer,
        });
        emailSent = true;
      } catch (emailErr) {
        console.error("[admin:bid-no-bid:email-failed]", emailErr);
      }
    }

    return NextResponse.json({ output, requirements, emailSent });
  } catch (err) {
    console.error("[admin:bid-no-bid:failed]", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
