"use client";

import Link from "next/link";
import type { TierSlug, Gap, MatchedTender, MatchedGrant, ReadinessDimensions } from "@/lib/types";
import { TIER_INFO_BY_SLUG } from "@/lib/pricing";

/* ============================================================
   AssessmentResults — Direction A (paper, serif, mono)
   Editorial readiness report. Same data contract as before:
   - readiness_score, grant_readiness_score
   - readiness_dimensions (5 axes)
   - gaps[], matched_tenders[], matched_grants[]
   - recommended_tier (drives the bottom CTA)
   ============================================================ */

interface AssessmentData {
  id: number;
  company_name: string;
  email: string;
  sector: string;
  sectors: string[];
  readiness_score: number;
  grant_readiness_score: number;
  recommended_tier: TierSlug;
  summary: string;
  strengths: string[];
  capabilities: string[];
  certifications_detected: string[];
  readiness_dimensions: ReadinessDimensions;
  gaps: Gap[];
  matched_tenders: MatchedTender[];
  matched_grants: MatchedGrant[];
}

const SCORE_LABEL = (s: number) =>
  s >= 80 ? "Strong fit" : s >= 60 ? "Workable fit" : s >= 40 ? "Foundational gaps" : "Major gaps";

const SCORE_NEXT = (s: number) =>
  s >= 80
    ? "Bid-ready in 14 days"
    : s >= 60
    ? "Bid-ready in 30 days with focused fixes"
    : s >= 40
    ? "60–90 day readiness pathway"
    : "Foundation work required first";

const SEVERITY_TONE: Record<string, string> = {
  high: "border-red-700 text-red-900",
  medium: "border-accent text-accent",
  low: "border-mute text-ink-3",
};

export default function AssessmentResults({
  data, onReset,
}: { data: AssessmentData; onReset: () => void }) {
  const tier = TIER_INFO_BY_SLUG[data.recommended_tier];
  const dims = data.readiness_dimensions as Partial<ReadinessDimensions> & Record<string, number | undefined>;
  const dimensionEntries = [
    { label: "Sector fit", score: dims.sector_fit ?? dims.sector ?? 0 },
    { label: "Geography", score: dims.geography ?? 0 },
    { label: "Compliance", score: dims.compliance ?? 0 },
    { label: "Track record", score: dims.experience ?? 0 },
    { label: "Documentation", score: dims.documentation ?? 0 },
  ];

  return (
    <div>
      {/* Masthead */}
      <header className="border-b border-ink pb-8 mb-10">
        <div className="flex items-baseline justify-between mb-3">
          <p className="font-mono text-[10px] tracking-[0.18em] uppercase text-accent">
            Vendor readiness report · No. {String(data.id).padStart(4, "0")}
          </p>
          <button
            onClick={onReset}
            className="font-mono text-[10px] tracking-[0.1em] uppercase text-ink-3 hover:text-ink border-b border-rule hover:border-ink pb-0.5"
          >
            Run another →
          </button>
        </div>
        <h1 className="font-serif text-[40px] lg:text-[48px] font-normal leading-[1.0] tracking-[-0.02em] text-ink mb-3">
          {data.company_name}
        </h1>
        <p className="font-mono text-[11px] tracking-[0.06em] text-ink-3">
          {data.sectors.slice(0, 4).join(" · ")}
          {data.sectors.length > 4 && ` · +${data.sectors.length - 4}`}
        </p>
      </header>

      {/* HERO SCORE */}
      <section className="grid lg:grid-cols-[1fr_1.4fr] gap-10 lg:gap-14 mb-14 pb-12 border-b border-rule">
        <div>
          <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-mute mb-2">
            Overall readiness
          </p>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="font-serif text-[120px] lg:text-[144px] font-normal leading-[0.85] tracking-[-0.04em] text-ink tabular-nums">
              {data.readiness_score}
            </span>
            <span className="font-serif text-[36px] text-ink-3 leading-none">/100</span>
          </div>
          <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-accent mb-1">
            {SCORE_LABEL(data.readiness_score)}
          </p>
          <p className="text-[13px] text-ink-2">{SCORE_NEXT(data.readiness_score)}</p>

          {data.grant_readiness_score > 0 && (
            <div className="mt-6 pt-5 border-t border-rule">
              <p className="font-mono text-[10px] tracking-[0.12em] uppercase text-mute mb-1">
                Grant readiness
              </p>
              <p className="font-serif text-[32px] leading-none text-ink tabular-nums">
                {data.grant_readiness_score}<span className="text-ink-3 text-[18px]">/100</span>
              </p>
            </div>
          )}
        </div>

        {/* Dimension breakdown */}
        <div>
          <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-mute mb-5">
            By dimension
          </p>
          <div className="space-y-4">
            {dimensionEntries.map((d) => (
              <div key={d.label} className="grid grid-cols-[140px_1fr_auto] gap-4 items-baseline">
                <span className="text-[13px] text-ink">{d.label}</span>
                <div className="h-[3px] bg-rule">
                  <div
                    className={
                      d.score < 50
                        ? "h-full bg-red-700"
                        : d.score < 75
                        ? "h-full bg-accent"
                        : "h-full bg-ink"
                    }
                    style={{ width: `${d.score}%` }}
                  />
                </div>
                <span className="font-mono text-[12px] text-ink-2 tabular-nums w-10 text-right">
                  {d.score}
                </span>
              </div>
            ))}
          </div>

          <p className="font-serif text-[18px] leading-[1.5] text-ink mt-8 pt-6 border-t border-rule italic">
            &ldquo;{data.summary}&rdquo;
          </p>
        </div>
      </section>

      {/* GAPS */}
      {data.gaps.length > 0 && (
        <section className="mb-14">
          <div className="flex items-baseline justify-between mb-6 pb-3 border-b border-ink">
            <h2 className="font-serif text-[28px] lg:text-[32px] font-normal leading-tight tracking-[-0.02em] text-ink">
              Compliance gaps to fix
            </h2>
            <p className="font-mono text-[10px] tracking-[0.12em] uppercase text-mute tabular-nums">
              {data.gaps.length} {data.gaps.length === 1 ? "gap" : "gaps"}
            </p>
          </div>
          <div>
            {data.gaps.map((gap, i) => (
              <article
                key={i}
                className="grid lg:grid-cols-[60px_1fr_140px] gap-4 lg:gap-6 py-6 border-b border-rule"
              >
                <span className="font-mono text-[11px] tracking-[0.06em] text-accent tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="font-serif text-[18px] text-ink leading-snug mb-1.5">
                    {gap.title}
                  </h3>
                  <p className="text-[13px] text-ink-2 leading-[1.6]">
                    {gap.description}
                  </p>
                  {gap.action && (
                    <p className="font-mono text-[10px] tracking-[0.04em] text-ink-3 mt-2">
                      → {gap.action}
                    </p>
                  )}
                </div>
                <div className="lg:text-right">
                  <span
                    className={`inline-block font-mono text-[10px] tracking-[0.16em] uppercase border px-2 py-0.5 ${
                      SEVERITY_TONE[gap.severity ?? "low"] ?? SEVERITY_TONE.low
                    }`}
                  >
                    {gap.severity ?? "Low"}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* MATCHED TENDERS */}
      {data.matched_tenders.length > 0 && (
        <section className="mb-14">
          <div className="flex items-baseline justify-between mb-6 pb-3 border-b border-ink">
            <h2 className="font-serif text-[28px] lg:text-[32px] font-normal leading-tight tracking-[-0.02em] text-ink">
              Matched tenders
            </h2>
            <p className="font-mono text-[10px] tracking-[0.12em] uppercase text-mute tabular-nums">
              {data.matched_tenders.length} live
            </p>
          </div>
          <ul>
            {data.matched_tenders.slice(0, 8).map((t, i) => (
              <li
                key={i}
                className="grid grid-cols-[40px_1fr_auto] lg:grid-cols-[40px_2fr_1fr_auto_auto] gap-3 lg:gap-5 py-5 border-b border-rule items-baseline"
              >
                <span className="font-mono text-[11px] text-mute tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <p className="text-[14px] text-ink leading-snug font-medium mb-1">
                    {t.title}
                  </p>
                  <p className="font-mono text-[10px] tracking-[0.04em] text-ink-3">
                    {t.agency}
                    {t.country ? ` · ${t.country}` : ""}
                    {t.reference ? ` · ${t.reference}` : ""}
                  </p>
                </div>
                <p className="hidden lg:block font-mono text-[10px] tracking-[0.04em] text-ink-3">
                  {t.deadline ? new Date(t.deadline).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—"}
                </p>
                <div className="text-right">
                  <p className="font-serif text-[20px] leading-none text-ink tabular-nums">
                    {t.match_score ?? "—"}
                  </p>
                  <p className="font-mono text-[9px] tracking-[0.08em] uppercase text-mute mt-0.5">
                    Fit
                  </p>
                </div>
                {t.url && (
                  <a
                    href={t.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[10px] tracking-[0.1em] uppercase text-ink hover:text-accent border-b border-ink hover:border-accent pb-0.5 whitespace-nowrap"
                  >
                    View →
                  </a>
                )}
              </li>
            ))}
          </ul>
          {data.matched_tenders.length > 8 && (
            <p className="font-mono text-[11px] text-ink-3 mt-5">
              + {data.matched_tenders.length - 8} more in your full report (sent to {data.email}).
            </p>
          )}
        </section>
      )}

      {/* GRANTS */}
      {data.matched_grants.length > 0 && (
        <section className="mb-14">
          <div className="flex items-baseline justify-between mb-6 pb-3 border-b border-ink">
            <h2 className="font-serif text-[28px] lg:text-[32px] font-normal leading-tight tracking-[-0.02em] text-ink">
              Matched grants
            </h2>
            <p className="font-mono text-[10px] tracking-[0.12em] uppercase text-mute tabular-nums">
              {data.matched_grants.length} open
            </p>
          </div>
          <ul>
            {data.matched_grants.slice(0, 5).map((g, i) => (
              <li key={i} className="grid grid-cols-[40px_1fr_auto] gap-4 py-5 border-b border-rule items-baseline">
                <span className="font-mono text-[11px] text-mute tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <p className="text-[14px] text-ink mb-1">{g.title}</p>
                  <p className="font-mono text-[10px] tracking-[0.04em] text-ink-3">
                    {g.donor}{g.theme ? ` · ${g.theme}` : ""}
                  </p>
                </div>
                {g.url && (
                  <a
                    href={g.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[10px] tracking-[0.1em] uppercase text-ink hover:text-accent border-b border-ink hover:border-accent pb-0.5"
                  >
                    View →
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* STRENGTHS */}
      {data.strengths.length > 0 && (
        <section className="mb-14">
          <h2 className="font-serif text-[24px] font-normal leading-tight tracking-[-0.02em] text-ink mb-5 pb-3 border-b border-ink">
            What you have going for you
          </h2>
          <ul className="space-y-3">
            {data.strengths.map((s, i) => (
              <li key={i} className="flex items-baseline gap-4">
                <span className="font-mono text-[10px] text-accent tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-[14px] text-ink-2 leading-[1.55]">{s}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* RECOMMENDED NEXT STEP — bottom CTA */}
      {tier && (
        <section className="bg-ink text-paper p-8 lg:p-10 mt-14">
          <p className="font-mono text-[10px] tracking-[0.18em] uppercase text-accent-2 mb-4">
            Recommended next step
          </p>
          <h2 className="font-serif text-[32px] lg:text-[40px] font-normal leading-[1.05] tracking-[-0.02em] mb-3">
            {tier.name}
          </h2>
          <p className="text-[14px] text-paper-2/70 leading-[1.55] mb-6 max-w-xl">
            {tier.tagline}
          </p>
          <div className="flex flex-wrap items-baseline gap-6 pt-6 border-t border-paper-2/15">
            <div className="flex items-baseline gap-1">
              <span className="font-serif text-[40px] leading-none tabular-nums">{tier.price}</span>
              <span className="font-mono text-[12px] text-paper-2/60">{tier.billingPeriod}</span>
            </div>
            <Link
              href={`/pay?plan=${data.recommended_tier}`}
              className="bg-paper text-ink font-mono text-[11px] tracking-[0.14em] uppercase px-7 py-3.5 hover:bg-accent-2 transition-colors"
            >
              {tier.cta} →
            </Link>
            <Link
              href="/login"
              className="font-mono text-[11px] tracking-[0.12em] uppercase text-paper-2/70 hover:text-paper border-b border-paper-2/30 hover:border-paper pb-0.5"
            >
              Save report → sign up
            </Link>
          </div>
        </section>
      )}

      <p className="font-mono text-[10px] tracking-[0.06em] text-mute mt-10 text-center">
        A full PDF copy of this report has been emailed to {data.email}.
      </p>
    </div>
  );
}
