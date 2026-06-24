import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { loadProspectBriefing, type ProspectBriefing, type BriefingTender } from "@/lib/network/briefing";
import { prospectGapFixText, prospectGapIssueText } from "@/lib/network/outreach";
import type { Gap } from "@/lib/types";

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
    title: `${b.companyName} — opportunity briefing · TenderPath`,
    description: `Live UN & donor tenders ${b.companyName} is well placed to win, where they're strong, and what to check before bidding.`,
    robots,
  };
}

const INK = "#0f1620";
const GOLD = "#9c6b1f";
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

const SEVERITY_STYLE: Record<Gap["severity"], { bg: string; fg: string; label: string }> = {
  high: { bg: "#fdecea", fg: "#b3261e", label: "High priority" },
  medium: { bg: "#fff4e5", fg: "#9c6b1f", label: "Worth closing" },
  low: { bg: "#eef2f7", fg: "#5b6470", label: "Nice to have" },
};

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
        {chip(t.fitBand, "rgba(156,107,31,0.12)", GOLD)}
        {t.isUngm && chip("UN agency · via UNGM", "rgba(15,22,32,0.06)", INK)}
        <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 600, color: dl.urgent ? "#b3261e" : MUTED }}>{dl.text}</span>
      </div>
      <div style={{ fontSize: 16, fontWeight: 650, color: INK, lineHeight: 1.35 }}>
        {t.source_url ? (
          <a href={t.source_url} target="_blank" rel="noreferrer" style={{ color: INK, textDecoration: "none" }}>{t.title}</a>
        ) : t.title}
      </div>
      {where && <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>{where}</div>}
      {t.value && <div style={{ fontSize: 13, color: INK, marginTop: 4 }}>{`Estimated value: ${t.value}`}</div>}
      {t.reasons.length > 0 && (
        <div style={{ fontSize: 13, color: MUTED, marginTop: 8 }}>
          <span style={{ fontWeight: 650, color: INK }}>Why you: </span>{t.reasons.join("; ")}
        </div>
      )}
    </div>
  );
}

function Briefing({ b }: { b: ProspectBriefing }) {
  const subline = [b.industry, b.countries.slice(0, 4).join(", ")].filter(Boolean).join(" · ");
  const assessHref = b.website
    ? `/assessment?site=${encodeURIComponent(b.website)}`
    : "/assessment";

  return (
    <main style={{ minHeight: "100vh", background: PAPER, color: INK, padding: "0 16px 64px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        {/* Masthead */}
        <header style={{ padding: "28px 0 18px", borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, letterSpacing: 0.4, textTransform: "uppercase", color: GOLD, fontWeight: 700 }}>
            TenderPath
            <span style={{ color: MUTED, fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>· Opportunity briefing</span>
          </div>
          <h1 style={{ fontSize: 28, lineHeight: 1.2, margin: "14px 0 6px", fontWeight: 700 }}>{b.companyName}</h1>
          {subline && <div style={{ color: MUTED, fontSize: 14 }}>{subline}</div>}
        </header>

        {b.summary && (
          <p style={{ fontSize: 15, lineHeight: 1.6, color: INK, margin: "20px 0 0" }}>{b.summary}</p>
        )}

        {/* Live tenders — the hook */}
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>
            {b.tenders.length > 0
              ? `Live tenders you're well placed to win (${b.tenders.length})`
              : "Live tenders"}
          </h2>
          <p style={{ fontSize: 13, color: MUTED, margin: "0 0 14px" }}>
            {b.tenders.length > 0
              ? "Open opportunities we matched to what you do. Deadlines and values are from the source notice — confirm before you bid."
              : "No live matches right now — new opportunities are crawled and matched daily, so check back soon."}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {b.tenders.map((t) => <TenderCard key={t.id} t={t} />)}
          </div>
        </section>

        {/* UNGM readiness */}
        {b.ungm.line && (
          <section style={{ marginTop: 28, border: `1px solid ${BORDER}`, borderRadius: 12, background: CARD, padding: "16px 18px" }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 6px" }}>Registration readiness</h2>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: INK, margin: 0 }}>{b.ungm.line}</p>
          </section>
        )}

        {/* Strengths */}
        {b.strengths.length > 0 && (
          <section style={{ marginTop: 28 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 12px" }}>Where you&rsquo;re strong</h2>
            <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
              {b.strengths.map((s, i) => (
                <li key={i} style={{ fontSize: 14, lineHeight: 1.55, color: INK }}>{s}</li>
              ))}
            </ul>
          </section>
        )}

        {/* Practical bid checks — listed prominently */}
        {b.gaps.length > 0 && (
          <section style={{ marginTop: 28 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>Things to tighten before bidding</h2>
            <p style={{ fontSize: 13, color: MUTED, margin: "0 0 14px" }}>
              Practical checks to make before spending time on the bid. None are administrative box-ticking.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {b.gaps.map((g, i) => {
                const s = SEVERITY_STYLE[g.severity] ?? SEVERITY_STYLE.medium;
                const fix = prospectGapFixText(g.fix);
                return (
                  <div key={i} style={{ border: `1px solid ${BORDER}`, borderRadius: 12, background: CARD, padding: "14px 16px" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                      {chip(s.label, s.bg, s.fg)}
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 650, color: INK, lineHeight: 1.4 }}>{prospectGapIssueText(g)}</div>
                    {fix && <div style={{ fontSize: 14, color: MUTED, marginTop: 6, lineHeight: 1.55 }}>{`How to close it: ${fix}`}</div>}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* CTA — the on-ramp into the real product */}
        <section style={{ marginTop: 32, background: INK, color: "#fff", borderRadius: 14, padding: "22px 22px" }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 6px", color: "#fff" }}>Want the full read?</h2>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "rgba(255,255,255,0.82)", margin: "0 0 14px" }}>
            Run your own free TenderPath assessment in a few minutes — your readiness score, every matching tender, and exactly what to fix next.
          </p>
          <a
            href={assessHref}
            style={{ display: "inline-block", background: GOLD, color: "#fff", textDecoration: "none", fontWeight: 700, fontSize: 14, padding: "11px 18px", borderRadius: 9 }}
          >
            Get my free assessment →
          </a>
        </section>

        {/* Honest provenance footer */}
        <footer style={{ marginTop: 28, paddingTop: 16, borderTop: `1px solid ${BORDER}`, fontSize: 12, color: MUTED, lineHeight: 1.6 }}>
          {`Prepared by TenderPath for ${b.companyName} from publicly available information and the live tenders we track`}
          {b.lastMatchedAt ? `, last refreshed ${fmtDate(b.lastMatchedAt)}` : ""}
          {`. Fit, deadlines, and values are estimates to help you prioritise — always confirm against the official notice before bidding. `}
          <a href="https://www.tenderpath.me" style={{ color: GOLD, textDecoration: "none" }}>tenderpath.me</a>
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
