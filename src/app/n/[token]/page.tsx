import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { loadProspectBriefing, type ProspectBriefing, type BriefingTender } from "@/lib/network/briefing";
import { annotateProspectTender, type ProspectTenderSignals } from "@/lib/network/prospect-signals";
import type { ContestabilityBand } from "@/lib/tenders/contestability";

// Read-only, request-time render (DB-backed, deadlines are time-sensitive).
export const dynamic = "force-dynamic";

// One DB load per request, shared by generateMetadata + the page.
const getBriefing = cache((token: string) => loadProspectBriefing(token));

export async function generateMetadata(
  { params }: { params: Promise<{ token: string }> },
): Promise<Metadata> {
  const { token } = await params;
  const b = await getBriefing(token);
  // Always noindex — these are private, shared 1:1 with a prospect.
  const robots = { index: false, follow: false } as const;
  if (!b) return { title: "Briefing not found · TenderPath", robots };
  return {
    title: `${b.companyName} — tenders worth checking`,
    description: `A short private note with live tenders that may be worth checking for ${b.companyName}.`,
    robots,
  };
}

const INK = "#0f1620";
const PAPER = "#f7f4ee";
const CARD = "#ffffff";
const BORDER = "rgba(15,22,32,0.12)";
const MUTED = "#5b6470";
const MS_PER_DAY = 86_400_000;

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const deadline = new Date(iso);
  if (Number.isNaN(deadline.getTime())) return null;
  const today = new Date();
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const target = Date.UTC(deadline.getUTCFullYear(), deadline.getUTCMonth(), deadline.getUTCDate());
  return Math.round((target - start) / MS_PER_DAY);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function deadlinePhrase(iso: string | null): { text: string; urgent: boolean } {
  const days = daysUntil(iso);
  const date = fmtDate(iso);
  if (days === null) return { text: "Deadline on the notice", urgent: false };
  if (days < 0) return { text: `Closed ${date}`, urgent: false };
  if (days === 0) return { text: `Closes today (${date})`, urgent: true };
  return { text: `Closes ${date} · ${days} day${days === 1 ? "" : "s"} left`, urgent: days <= 7 };
}

function companyInSentence(companyName: string): string {
  return companyName.trim().replace(/[.!?]+$/, "") || "your team";
}

function chip(text: string, bg: string, fg: string) {
  return (
    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 999, background: bg, color: fg, fontSize: 12, fontWeight: 600, lineHeight: 1.4 }}>
      {text}
    </span>
  );
}

// Contestability chip colours. Orthogonal to fit — this reads the practical /
// political layer, never the merit score. Conservative palette: Open reassures,
// Constrained cautions, Mixed stays neutral (the honest default).
const BAND_STYLE: Record<ContestabilityBand, { bg: string; fg: string; label: string }> = {
  Open: { bg: "rgba(22,101,52,0.10)", fg: "#166534", label: "Open field" },
  Mixed: { bg: "rgba(15,22,32,0.06)", fg: INK, label: "Mixed field" },
  Constrained: { bg: "rgba(180,83,9,0.12)", fg: "#9a3412", label: "Constrained field" },
};

/** One honest, prospect-safe registration line — only when it's actionable. */
function registrationNote(sig: ProspectTenderSignals): { text: string; caution: boolean } | null {
  const c = sig.compliance;
  if (c.registrationRisk === "very-tight") {
    return { text: `Tight window — start ${c.portalName} registration now (${c.leadTimeLabel}).`, caution: true };
  }
  if (c.registrationRisk === "tight") {
    return { text: `Leave time for ${c.portalName} registration (${c.leadTimeLabel}).`, caution: false };
  }
  if (c.isUngm) {
    return { text: "Submitted via UNGM — a free UNGM Basic account is usually enough to bid.", caution: false };
  }
  return null;
}

function TenderCard({ t }: { t: BriefingTender }) {
  const dl = deadlinePhrase(t.deadline);
  const where = [t.agency, t.country, t.sector].filter(Boolean).join(" · ");
  // Pure, no-side-effect annotation (same function the admin artifact uses). The
  // prospect only ever sees the qualitative band, never the raw match score.
  const sig = annotateProspectTender({
    title: t.title,
    agency: t.agency,
    deadline: t.deadline,
    isUngm: t.isUngm,
    fit: { kind: "band", band: t.fitBand },
  });
  const band = BAND_STYLE[sig.contestability.band];
  const reg = registrationNote(sig);
  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, background: CARD, padding: "16px 18px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 6 }}>
        {t.isUngm && chip("via UNGM", "rgba(15,22,32,0.06)", INK)}
        {chip(t.fitBand, "rgba(156,107,31,0.12)", "#7a5214")}
        {chip(band.label, band.bg, band.fg)}
        <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 600, color: dl.urgent ? "#b3261e" : MUTED }}>{dl.text}</span>
      </div>
      <div style={{ fontSize: 16, fontWeight: 650, color: INK, lineHeight: 1.35 }}>
        {t.source_url ? (
          <a href={t.source_url} target="_blank" rel="noreferrer" style={{ color: INK, textDecoration: "none" }}>{t.title}</a>
        ) : t.title}
      </div>
      {where && <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>{where}</div>}
      {t.value && <div style={{ fontSize: 13, color: INK, marginTop: 4 }}>{`Estimated value: ${t.value}`}</div>}

      {/* Insider read — the augmentation value: a quick, honest take, not a full adjudication. */}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${BORDER}`, display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ fontSize: 13, fontWeight: 650, color: INK }}>{sig.verdict.headline}</div>
        <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5 }}>{sig.contestability.line}</div>
        {reg && (
          <div style={{ fontSize: 12.5, color: reg.caution ? "#9a3412" : MUTED, lineHeight: 1.5 }}>{reg.text}</div>
        )}
      </div>
    </div>
  );
}

function Briefing({ b }: { b: ProspectBriefing }) {
  const subline = [b.industry, b.countries.slice(0, 4).join(", ")].filter(Boolean).join(" · ");

  return (
    <main style={{ minHeight: "100vh", background: PAPER, color: INK, padding: "0 16px 64px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        {/* Masthead */}
        <header style={{ padding: "28px 0 18px", borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, letterSpacing: 0.4, textTransform: "uppercase", color: MUTED, fontWeight: 700 }}>
            Private note
            <span style={{ color: MUTED, fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>· Opportunity links</span>
          </div>
          <h1 style={{ fontSize: 28, lineHeight: 1.2, margin: "14px 0 6px", fontWeight: 700 }}>{b.companyName}</h1>
          {subline && <div style={{ color: MUTED, fontSize: 14 }}>{subline}</div>}
        </header>

        <p style={{ fontSize: 15, lineHeight: 1.6, color: INK, margin: "20px 0 0" }}>
          I came across these and thought they were worth putting in front of {companyInSentence(b.companyName)}. Each link goes to the original notice so you can check quickly.
        </p>

        {/* Live tenders — the hook */}
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>
            {b.tenders.length > 0
              ? `Tenders worth checking (${b.tenders.length})`
              : "Live tenders"}
          </h2>
          {b.tenders.length > 0 && (
            <p style={{ fontSize: 13, color: MUTED, margin: "6px 0 0", lineHeight: 1.5 }}>
              Each has a quick read: how well it fits, how open the field looks, and what to do about registration.
              These are fast takes to help you triage — not a full bid assessment.
            </p>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
            {b.tenders.map((t) => <TenderCard key={t.id} t={t} />)}
          </div>
        </section>

        {/* Honest provenance footer */}
        <footer style={{ marginTop: 28, paddingTop: 16, borderTop: `1px solid ${BORDER}`, fontSize: 12, color: MUTED, lineHeight: 1.6 }}>
          {`Shared privately for ${b.companyName} from publicly available tender notices`}
          {b.lastMatchedAt ? `, last refreshed ${fmtDate(b.lastMatchedAt)}` : ""}
          {`. Deadlines and values can change; confirm against the official notice before acting. `}
          <a href="https://www.tenderpath.me" style={{ color: INK, textDecoration: "none" }}>tenderpath.me</a>
        </footer>
      </div>
    </main>
  );
}

export default async function ProspectBriefingPage(
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const briefing = await getBriefing(token);
  if (!briefing) notFound();
  return <Briefing b={briefing} />;
}
