import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

function esc(s: unknown): string {
  if (typeof s !== "string") return "";
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
  const gaps = Array.isArray(row.gaps) ? row.gaps as Array<{ title?: string; description?: string; action?: string; severity?: string }> : [];
  const tenders = Array.isArray(row.matched_tenders) ? row.matched_tenders as Array<Record<string, unknown>> : [];
  const grants = Array.isArray(row.matched_grants) ? row.matched_grants as Array<Record<string, unknown>> : [];

  const dimensionRows = [
    { label: "Sector fit",    score: dims.sector_fit ?? dims.sector ?? 0 },
    { label: "Geography",     score: dims.geography ?? 0 },
    { label: "Compliance",    score: dims.compliance ?? 0 },
    { label: "Track record",  score: dims.experience ?? 0 },
    { label: "Documentation", score: dims.documentation ?? 0 },
  ];

  const dimBars = dimensionRows.map((d) => {
    const pct = Math.round(d.score as number);
    const color = pct < 50 ? "#b8463f" : pct < 75 ? "#b08530" : "#1a1a1a";
    return `
    <tr>
      <td style="font-family:monospace;font-size:11px;color:#4a4a4a;padding:6px 12px 6px 0;white-space:nowrap;width:120px;">${esc(d.label)}</td>
      <td style="padding:6px 12px 6px 0;">
        <div style="height:3px;background:#d8d0bd;width:100%;">
          <div style="height:3px;background:${color};width:${pct}%;"></div>
        </div>
      </td>
      <td style="font-family:monospace;font-size:12px;color:#1a1a1a;text-align:right;padding:6px 0;width:36px;">${pct}</td>
    </tr>`;
  }).join("");

  const gapRows = gaps.slice(0, 8).map((g, i) => `
    <tr style="border-bottom:1px solid #d8d0bd;">
      <td style="font-family:monospace;font-size:10px;color:#b08530;padding:12px 14px 12px 0;vertical-align:top;width:32px;">${String(i + 1).padStart(2, "0")}</td>
      <td style="padding:12px 0;vertical-align:top;">
        <div style="font-size:13px;font-weight:600;color:#1a1a1a;margin-bottom:3px;">${esc(g.title ?? "")}</div>
        <div style="font-size:12px;color:#4a4a4a;line-height:1.5;">${esc(g.description ?? "")}</div>
        ${g.action ? `<div style="font-family:monospace;font-size:11px;color:#8a8377;margin-top:4px;">→ ${esc(g.action)}</div>` : ""}
      </td>
      <td style="font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:${(g.severity === "high") ? "#b8463f" : (g.severity === "medium") ? "#b08530" : "#8a8377"};padding:12px 0 12px 14px;vertical-align:top;text-align:right;width:64px;">${esc(g.severity ?? "low")}</td>
    </tr>`).join("");

  const tenderRows = tenders.slice(0, 10).map((t, i) => `
    <tr style="border-bottom:1px solid #d8d0bd;">
      <td style="font-family:monospace;font-size:11px;color:#8a8377;padding:11px 14px 11px 0;vertical-align:top;width:28px;">${String(i + 1).padStart(2, "0")}</td>
      <td style="padding:11px 0;vertical-align:top;">
        <div style="font-size:13px;font-weight:600;color:#1a1a1a;margin-bottom:2px;">${esc(String(t.title ?? ""))}</div>
        <div style="font-family:monospace;font-size:11px;color:#8a8377;">${esc(String(t.agency ?? ""))}${t.country ? ` · ${esc(String(t.country))}` : ""}</div>
      </td>
      <td style="font-family:monospace;font-size:11px;color:#8a8377;padding:11px 0 11px 14px;vertical-align:top;text-align:right;white-space:nowrap;">${deadlineLabel(t.deadline as string | null)}</td>
      <td style="font-family:Georgia,serif;font-size:18px;color:#1a1a1a;padding:11px 0 11px 14px;vertical-align:top;text-align:right;width:40px;">${t.match_score ?? t.score ?? "—"}</td>
    </tr>`).join("");

  const grantRows = grants.slice(0, 6).map((g, i) => `
    <tr style="border-bottom:1px solid #d8d0bd;">
      <td style="font-family:monospace;font-size:11px;color:#8a8377;padding:11px 14px 11px 0;vertical-align:top;width:28px;">${String(i + 1).padStart(2, "0")}</td>
      <td style="padding:11px 0;vertical-align:top;">
        <div style="font-size:13px;font-weight:600;color:#1a1a1a;margin-bottom:2px;">${esc(String(g.title ?? ""))}</div>
        <div style="font-family:monospace;font-size:11px;color:#8a8377;">${esc(String(g.donor ?? g.agency ?? ""))}${(g.theme ?? g.region) ? ` · ${esc(String(g.theme ?? g.region))}` : ""}</div>
      </td>
      <td style="font-family:monospace;font-size:11px;color:#8a8377;padding:11px 0 11px 14px;vertical-align:top;text-align:right;white-space:nowrap;">${deadlineLabel(g.deadline as string | null)}</td>
    </tr>`).join("");

  const strengthList = strengths.slice(0, 6).map((s, i) => `
    <tr>
      <td style="font-family:monospace;font-size:10px;color:#b08530;padding:5px 14px 5px 0;vertical-align:top;width:28px;">${String(i + 1).padStart(2, "0")}</td>
      <td style="font-size:13px;color:#4a4a4a;line-height:1.55;padding:5px 0;">${esc(s)}</td>
    </tr>`).join("");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://tenderpath.me";

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
    .page { max-width: 720px; margin: 0 auto; padding: 48px 40px; }
    .no-print { margin-bottom: 24px; }
    @media print {
      body { background: #fff; }
      .no-print { display: none !important; }
      .page { padding: 0; max-width: 100%; }
      tr { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
<div class="page">

  <!-- Print / download button — hidden when printing -->
  <div class="no-print" style="display:flex;align-items:center;gap:16px;padding:14px 0;border-bottom:1px solid #d8d0bd;margin-bottom:36px;">
    <button onclick="window.print()" style="background:#1a1a1a;color:#f5f1e8;border:none;cursor:pointer;padding:10px 22px;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.12em;">
      Save as PDF
    </button>
    <span style="font-family:monospace;font-size:11px;color:#8a8377;">
      Print → Save as PDF · or use your browser's print shortcut
    </span>
  </div>

  <!-- Masthead -->
  <div style="border-bottom:2px solid #1a1a1a;padding-bottom:20px;margin-bottom:32px;">
    <p style="font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.18em;color:#b08530;margin-bottom:8px;">
      Vendor readiness report · No. ${String(assessmentId).padStart(4, "0")}
    </p>
    <h1 style="font-family:Georgia,serif;font-size:38px;font-weight:400;letter-spacing:-0.02em;line-height:1.05;margin-bottom:6px;">
      ${esc(String(row.company_name))}
    </h1>
    <p style="font-family:monospace;font-size:11px;color:#8a8377;">
      ${esc(String(row.sector ?? ""))}
    </p>
  </div>

  <!-- Score + dimensions -->
  <div style="display:grid;grid-template-columns:1fr 1.4fr;gap:40px;margin-bottom:36px;padding-bottom:28px;border-bottom:1px solid #d8d0bd;">
    <div>
      <p style="font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.14em;color:#8a8377;margin-bottom:8px;">Overall readiness</p>
      <div style="font-family:Georgia,serif;font-size:72px;font-weight:400;line-height:0.9;letter-spacing:-0.03em;color:#1a1a1a;">
        ${row.readiness_score}<span style="font-size:24px;color:#8a8377;">/100</span>
      </div>
      <p style="font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.12em;color:#b08530;margin-top:8px;">
        ${scoreLabel(row.readiness_score as number)}
      </p>
      ${(row.grant_readiness_score as number) > 0 ? `
      <div style="margin-top:18px;padding-top:14px;border-top:1px solid #d8d0bd;">
        <p style="font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:#8a8377;margin-bottom:4px;">Grant readiness</p>
        <p style="font-family:Georgia,serif;font-size:28px;font-weight:400;color:#1a1a1a;">${row.grant_readiness_score}<span style="font-size:16px;color:#8a8377;">/100</span></p>
      </div>` : ""}
    </div>
    <div>
      <p style="font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.14em;color:#8a8377;margin-bottom:14px;">By dimension</p>
      <table style="width:100%;border-collapse:collapse;">${dimBars}</table>
      ${summary ? `
      <p style="font-family:Georgia,serif;font-size:14px;line-height:1.65;color:#1a1a1a;margin-top:20px;padding-top:16px;border-top:1px solid #d8d0bd;font-style:italic;">
        &ldquo;${esc(summary)}&rdquo;
      </p>` : ""}
    </div>
  </div>

  ${gaps.length ? `
  <!-- Gaps -->
  <div style="margin-bottom:32px;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #1a1a1a;padding-bottom:8px;margin-bottom:4px;">
      <h2 style="font-family:Georgia,serif;font-size:22px;font-weight:400;letter-spacing:-0.01em;">Compliance gaps</h2>
      <span style="font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#8a8377;">${gaps.length} gap${gaps.length !== 1 ? "s" : ""}</span>
    </div>
    <table style="width:100%;border-collapse:collapse;">${gapRows}</table>
  </div>` : ""}

  ${tenders.length ? `
  <!-- Matched tenders -->
  <div style="margin-bottom:32px;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #1a1a1a;padding-bottom:8px;margin-bottom:4px;">
      <h2 style="font-family:Georgia,serif;font-size:22px;font-weight:400;letter-spacing:-0.01em;">Matched tenders</h2>
      <span style="font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#8a8377;">${tenders.length} live</span>
    </div>
    <table style="width:100%;border-collapse:collapse;">${tenderRows}</table>
    ${tenders.length > 10 ? `<p style="font-family:monospace;font-size:11px;color:#8a8377;margin-top:10px;">+ ${tenders.length - 10} more in your dashboard</p>` : ""}
  </div>` : ""}

  ${grants.length ? `
  <!-- Matched grants -->
  <div style="margin-bottom:32px;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #1a1a1a;padding-bottom:8px;margin-bottom:4px;">
      <h2 style="font-family:Georgia,serif;font-size:22px;font-weight:400;letter-spacing:-0.01em;">Matched grants</h2>
      <span style="font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#8a8377;">${grants.length} open</span>
    </div>
    <table style="width:100%;border-collapse:collapse;">${grantRows}</table>
  </div>` : ""}

  ${strengths.length ? `
  <!-- Strengths -->
  <div style="margin-bottom:32px;">
    <h2 style="font-family:Georgia,serif;font-size:22px;font-weight:400;letter-spacing:-0.01em;border-bottom:2px solid #1a1a1a;padding-bottom:8px;margin-bottom:4px;">
      What you have going for you
    </h2>
    <table style="width:100%;border-collapse:collapse;margin-top:8px;">${strengthList}</table>
  </div>` : ""}

  <!-- Footer -->
  <div style="border-top:1px solid #d8d0bd;padding-top:16px;margin-top:24px;display:flex;justify-content:space-between;align-items:baseline;">
    <p style="font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#8a8377;">TenderPath · ${appUrl}</p>
    <p style="font-family:monospace;font-size:10px;color:#8a8377;">${esc(String(row.email ?? ""))}</p>
  </div>

</div>
<script>
  // Auto-open print dialog on load so users can immediately save as PDF
  window.addEventListener("load", function () {
    setTimeout(function () { window.print(); }, 300);
  });
</script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}
