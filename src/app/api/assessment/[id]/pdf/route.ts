import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

function esc(s: unknown): string {
  if (typeof s !== "string") return String(s ?? "");
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function scoreLabel(s: number): string {
  return s >= 80 ? "Strong fit" : s >= 60 ? "Workable fit" : s >= 40 ? "Foundational gaps" : "Major gaps";
}

function deadlineLabel(d: string | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const assessmentId = parseInt(id, 10);
  if (isNaN(assessmentId)) {
    return new NextResponse("Invalid assessment ID", { status: 400 });
  }

  const rows = await sql`SELECT * FROM assessments WHERE id = ${assessmentId}`;
  if (rows.length === 0) {
    return new NextResponse("Assessment not found", { status: 404 });
  }

  const row = rows[0];
  const analysis = (row.ai_analysis ?? {}) as Record<string, unknown>;
  const summary = typeof analysis.summary === "string" ? analysis.summary : "";
  const strengths = Array.isArray(analysis.strengths) ? (analysis.strengths as string[]) : [];
  const dims = (analysis.readiness_dimensions ?? {}) as Record<string, number | undefined>;

  // Gap fields: gap, fix, action_steps[], severity
  const gaps = Array.isArray(row.gaps)
    ? (row.gaps as Array<{ gap?: string; fix?: string; action_steps?: string[]; severity?: string }>)
    : [];
  const tenders = Array.isArray(row.matched_tenders)
    ? (row.matched_tenders as Array<Record<string, unknown>>)
    : [];
  const grants = Array.isArray(row.matched_grants)
    ? (row.matched_grants as Array<Record<string, unknown>>)
    : [];

  const dimensionRows = [
    { label: "Sector fit",    score: Number(dims.sector_fit ?? dims.sector ?? 0) },
    { label: "Geography",     score: Number(dims.geography ?? 0) },
    { label: "Compliance",    score: Number(dims.compliance ?? 0) },
    { label: "Track record",  score: Number(dims.experience ?? 0) },
    { label: "Documentation", score: Number(dims.documentation ?? 0) },
  ];

  const dimBars = dimensionRows.map((d) => {
    const pct = Math.round(d.score);
    const color = pct < 50 ? "#b8463f" : pct < 75 ? "#b08530" : "#1a1a1a";
    return `
    <tr>
      <td style="font-family:monospace;font-size:10px;color:#4a4a4a;padding:7px 14px 7px 0;white-space:nowrap;width:110px;vertical-align:middle;">${esc(d.label)}</td>
      <td style="padding:7px 14px 7px 0;vertical-align:middle;">
        <div style="height:3px;background:#d8d0bd;width:100%;">
          <div style="height:3px;background:${color};width:${pct}%;"></div>
        </div>
      </td>
      <td style="font-family:monospace;font-size:11px;color:#1a1a1a;text-align:right;padding:7px 0;width:32px;vertical-align:middle;">${pct}</td>
    </tr>`;
  }).join("");

  const gapRows = gaps.slice(0, 8).map((g, i) => {
    const sev = g.severity ?? "low";
    const sevColor = sev === "high" ? "#b8463f" : sev === "medium" ? "#b08530" : "#8a8377";
    const firstStep = g.action_steps?.[0];
    return `
    <tr style="border-bottom:1px solid #e8e4da;">
      <td style="font-family:monospace;font-size:10px;color:#b08530;padding:13px 14px 13px 0;vertical-align:top;width:28px;">${String(i + 1).padStart(2, "0")}</td>
      <td style="padding:13px 0;vertical-align:top;">
        <div style="font-family:Georgia,serif;font-size:14px;font-weight:400;color:#1a1a1a;margin-bottom:4px;">${esc(g.gap ?? "")}</div>
        <div style="font-size:12px;color:#4a4a4a;line-height:1.55;">${esc(g.fix ?? "")}</div>
        ${firstStep ? `<div style="font-family:monospace;font-size:11px;color:#8a8377;margin-top:5px;">→ ${esc(firstStep)}</div>` : ""}
      </td>
      <td style="font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:${sevColor};padding:13px 0 13px 14px;vertical-align:top;text-align:right;white-space:nowrap;width:60px;">${esc(sev)}</td>
    </tr>`;
  }).join("");

  const tenderRows = tenders.slice(0, 10).map((t, i) => `
    <tr style="border-bottom:1px solid #e8e4da;">
      <td style="font-family:monospace;font-size:10px;color:#8a8377;padding:11px 14px 11px 0;vertical-align:top;width:26px;">${String(i + 1).padStart(2, "0")}</td>
      <td style="padding:11px 0;vertical-align:top;">
        <div style="font-family:Georgia,serif;font-size:13px;color:#1a1a1a;margin-bottom:3px;">${esc(String(t.title ?? ""))}</div>
        <div style="font-family:monospace;font-size:10px;color:#8a8377;">${esc(String(t.agency ?? ""))}${t.country ? ` · ${esc(String(t.country))}` : ""}</div>
      </td>
      <td style="font-family:monospace;font-size:10px;color:#8a8377;padding:11px 0 11px 14px;vertical-align:top;text-align:right;white-space:nowrap;">${deadlineLabel(t.deadline as string | null)}</td>
      <td style="font-family:Georgia,serif;font-size:16px;color:#1a1a1a;padding:11px 0 11px 12px;vertical-align:top;text-align:right;white-space:nowrap;width:38px;">${t.match_score ?? t.score ?? "—"}</td>
    </tr>`).join("");

  const grantRows = grants.slice(0, 6).map((g, i) => `
    <tr style="border-bottom:1px solid #e8e4da;">
      <td style="font-family:monospace;font-size:10px;color:#8a8377;padding:11px 14px 11px 0;vertical-align:top;width:26px;">${String(i + 1).padStart(2, "0")}</td>
      <td style="padding:11px 0;vertical-align:top;">
        <div style="font-family:Georgia,serif;font-size:13px;color:#1a1a1a;margin-bottom:3px;">${esc(String(g.title ?? ""))}</div>
        <div style="font-family:monospace;font-size:10px;color:#8a8377;">${esc(String(g.donor ?? g.agency ?? ""))}${(g.theme ?? g.region) ? ` · ${esc(String(g.theme ?? g.region))}` : ""}</div>
      </td>
      <td style="font-family:monospace;font-size:10px;color:#8a8377;padding:11px 0 11px 14px;vertical-align:top;text-align:right;white-space:nowrap;">${deadlineLabel(g.deadline as string | null)}</td>
    </tr>`).join("");

  const strengthList = strengths.slice(0, 6).map((s, i) => `
    <tr>
      <td style="font-family:monospace;font-size:10px;color:#b08530;padding:5px 14px 5px 0;vertical-align:top;width:26px;">${String(i + 1).padStart(2, "0")}</td>
      <td style="font-size:13px;color:#4a4a4a;line-height:1.55;padding:5px 0;">${esc(s)}</td>
    </tr>`).join("");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.tenderpath.me";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Vendor Readiness Report — ${esc(String(row.company_name))}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #f5f1e8;
      color: #1a1a1a;
      font-family: Georgia, serif;
      font-size: 14px;
      line-height: 1.5;
    }
    .page {
      max-width: 780px;
      margin: 0 auto;
      padding: 48px 44px;
    }
    .no-print {
      margin-bottom: 32px;
    }
    h2 {
      font-family: Georgia, serif;
      font-size: 22px;
      font-weight: 400;
      letter-spacing: -0.01em;
    }
    @media print {
      body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none !important; }
      .page { padding: 0; max-width: 100%; }
      tr, div { page-break-inside: avoid; }
      table { width: 100% !important; }
    }
  </style>
</head>
<body>
<div class="page">

  <!-- Print prompt — hidden when printing -->
  <div class="no-print" style="padding:14px 18px;background:#1a1a1a;display:flex;align-items:center;justify-content:space-between;gap:16px;">
    <span style="font-family:monospace;font-size:11px;color:#d8d0bd;letter-spacing:0.06em;">
      Vendor Readiness Report · No. ${String(assessmentId).padStart(4, "0")}
    </span>
    <button onclick="window.print()" style="background:#b08530;color:#f5f1e8;border:none;cursor:pointer;padding:9px 20px;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.12em;white-space:nowrap;">
      Save as PDF ↓
    </button>
  </div>

  <!-- Masthead -->
  <div style="border-bottom:2px solid #1a1a1a;padding-bottom:22px;margin-bottom:32px;">
    <p style="font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.18em;color:#b08530;margin-bottom:10px;">
      Vendor readiness report · No. ${String(assessmentId).padStart(4, "0")}
    </p>
    <h1 style="font-family:Georgia,serif;font-size:36px;font-weight:400;letter-spacing:-0.02em;line-height:1.05;margin-bottom:8px;color:#1a1a1a;">
      ${esc(String(row.company_name))}
    </h1>
    <p style="font-family:monospace;font-size:11px;color:#8a8377;letter-spacing:0.04em;">
      ${esc(String(row.sector ?? ""))}
    </p>
  </div>

  <!-- Score + dimensions — table layout for print reliability -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:32px;padding-bottom:24px;border-bottom:1px solid #d8d0bd;">
    <tr>
      <td style="width:44%;vertical-align:top;padding-right:36px;">
        <p style="font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.14em;color:#8a8377;margin-bottom:10px;">Overall readiness</p>
        <div style="font-family:Georgia,serif;font-size:80px;font-weight:400;line-height:0.88;letter-spacing:-0.03em;color:#1a1a1a;margin-bottom:10px;">
          ${row.readiness_score}<span style="font-size:28px;color:#8a8377;">/100</span>
        </div>
        <p style="font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.12em;color:#b08530;margin-bottom:4px;">
          ${scoreLabel(row.readiness_score as number)}
        </p>
        ${(row.grant_readiness_score as number) > 0 ? `
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid #d8d0bd;">
          <p style="font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:#8a8377;margin-bottom:5px;">Grant readiness</p>
          <p style="font-family:Georgia,serif;font-size:30px;font-weight:400;color:#1a1a1a;">${row.grant_readiness_score}<span style="font-size:16px;color:#8a8377;">/100</span></p>
        </div>` : ""}
      </td>
      <td style="width:56%;vertical-align:top;padding-left:8px;">
        <p style="font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.14em;color:#8a8377;margin-bottom:14px;">By dimension</p>
        <table style="width:100%;border-collapse:collapse;">${dimBars}</table>
        ${summary ? `
        <p style="font-family:Georgia,serif;font-size:13px;line-height:1.65;color:#1a1a1a;margin-top:20px;padding-top:16px;border-top:1px solid #d8d0bd;font-style:italic;">
          &ldquo;${esc(summary)}&rdquo;
        </p>` : ""}
      </td>
    </tr>
  </table>

  ${gaps.length ? `
  <!-- Gaps -->
  <div style="margin-bottom:32px;">
    <table style="width:100%;border-collapse:collapse;margin-bottom:6px;">
      <tr>
        <td><h2 style="border-bottom:2px solid #1a1a1a;padding-bottom:8px;margin-bottom:0;">Compliance gaps to fix</h2></td>
        <td style="text-align:right;vertical-align:bottom;border-bottom:2px solid #1a1a1a;padding-bottom:8px;">
          <span style="font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#8a8377;">${gaps.length} gap${gaps.length !== 1 ? "s" : ""}</span>
        </td>
      </tr>
    </table>
    <table style="width:100%;border-collapse:collapse;">${gapRows}</table>
  </div>` : ""}

  ${tenders.length ? `
  <!-- Matched tenders -->
  <div style="margin-bottom:32px;">
    <table style="width:100%;border-collapse:collapse;margin-bottom:6px;">
      <tr>
        <td><h2 style="border-bottom:2px solid #1a1a1a;padding-bottom:8px;margin-bottom:0;">Matched tenders</h2></td>
        <td style="text-align:right;vertical-align:bottom;border-bottom:2px solid #1a1a1a;padding-bottom:8px;">
          <span style="font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#8a8377;">${tenders.length} live</span>
        </td>
      </tr>
    </table>
    <table style="width:100%;border-collapse:collapse;">${tenderRows}</table>
    ${tenders.length > 10 ? `<p style="font-family:monospace;font-size:11px;color:#8a8377;margin-top:10px;padding-top:8px;">+ ${tenders.length - 10} more in your dashboard at ${appUrl}</p>` : ""}
  </div>` : ""}

  ${grants.length ? `
  <!-- Matched grants -->
  <div style="margin-bottom:32px;">
    <table style="width:100%;border-collapse:collapse;margin-bottom:6px;">
      <tr>
        <td><h2 style="border-bottom:2px solid #1a1a1a;padding-bottom:8px;margin-bottom:0;">Matched grants</h2></td>
        <td style="text-align:right;vertical-align:bottom;border-bottom:2px solid #1a1a1a;padding-bottom:8px;">
          <span style="font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#8a8377;">${grants.length} open</span>
        </td>
      </tr>
    </table>
    <table style="width:100%;border-collapse:collapse;">${grantRows}</table>
  </div>` : ""}

  ${strengths.length ? `
  <!-- Strengths -->
  <div style="margin-bottom:32px;">
    <h2 style="border-bottom:2px solid #1a1a1a;padding-bottom:8px;margin-bottom:8px;">What you have going for you</h2>
    <table style="width:100%;border-collapse:collapse;margin-top:8px;">${strengthList}</table>
  </div>` : ""}

  <!-- Footer -->
  <div style="border-top:1px solid #d8d0bd;padding-top:16px;margin-top:24px;">
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#8a8377;">TenderPath · ${appUrl}</td>
        <td style="font-family:monospace;font-size:10px;color:#8a8377;text-align:right;">${esc(String(row.email ?? ""))}</td>
      </tr>
    </table>
  </div>

</div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}
