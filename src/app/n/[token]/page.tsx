import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { loadProspectBriefing, type ProspectBriefing, type BriefingTender } from "@/lib/network/briefing";

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

function TenderCard({ t }: { t: BriefingTender }) {
  const dl = deadlinePhrase(t.deadline);
  const where = [t.agency, t.country, t.sector].filter(Boolean).join(" · ");
  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, background: CARD, padding: "16px 18px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 6 }}>
        {t.isUngm && chip("via UNGM", "rgba(15,22,32,0.06)", INK)}
        <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 600, color: dl.urgent ? "#b3261e" : MUTED }}>{dl.text}</span>
      </div>
      <div style={{ fontSize: 16, fontWeight: 650, color: INK, lineHeight: 1.35 }}>
        {t.source_url ? (
          <a href={t.source_url} target="_blank" rel="noreferrer" style={{ color: INK, textDecoration: "none" }}>{t.title}</a>
        ) : t.title}
      </div>
      {where && <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>{where}</div>}
      {t.value && <div style={{ fontSize: 13, color: INK, marginTop: 4 }}>{`Estimated value: ${t.value}`}</div>}
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
