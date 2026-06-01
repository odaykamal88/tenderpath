"use client";

/**
 * AssessmentResults — Sprint 7 / readiness-output-ux.md S1–S4 implementation.
 *
 * The FREE top-of-funnel report shown immediately after the assessment
 * wizard completes. Repurposed in Sprint 7 from a legacy readiness-score +
 * 4-dimension layout to the spec's four required sections:
 *
 *   S1  Readiness summary first — honest verdict + 0-100 score + band
 *   S4  Founder-credibility line — surfaces the 6yr WFP P4/P5 positioning
 *       at the trust moment (between S1 and S2)
 *   S2  Per-gap routed — every gap maps to ONE named paid SKU with one
 *       action. Source of routing is the shared gap-routing module that
 *       the $299 page also consumes (single-sourced per spec).
 *   S3  ONE primary CTA — derived from summary.primaryAction (the SKU
 *       most gaps route to, with band-based tie-breaks). No scattered
 *       buttons; the bottom slab is the single conversion target.
 *
 * Sprint 6c locked "no SKU pitch" for the POST-payment $299 page. This
 * is the inverse case — the FREE pre-payment page must pitch. The
 * readiness spec R1 is explicit: a gap without a routed service is not
 * done. Confirmed in Sprint 7 STEP-0.
 *
 * The legacy matched-tenders / matched-grants / strengths sections are
 * preserved below the routed-gaps block as supplementary "while you're
 * here" content — they help conversion even though the spec doesn't
 * require them.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Gap, MatchedTender, MatchedGrant, ReadinessDimensions, TierSlug } from "@/lib/types";
import { isComingSoonTier } from "@/lib/pricing";
import { decodeHtmlEntities } from "@/lib/text/entities";
import { scoreReadiness } from "@/lib/proposal-package/readiness-engine";
import type { ApplicantContext } from "@/lib/proposal-package/applicant-context";
import type { ServiceSku, RoutedGap } from "@/lib/proposal-package/scoring-engine";
import { enrichApplicantContextFromLibrary } from "@/lib/proposal-package/library-enrichment";
import type { LibraryContextResponse } from "@/lib/proposal-package/library-context";

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

// ============================================================================
// SKU display catalog — client-side mirror of gap-routing.SERVICE_CATALOG
// + pay-page slug mapping. Kept inline so the page doesn't pull the routing
// rules module (server-side regex tables) into the client bundle.
// ============================================================================

interface SkuDisplay {
  label: string;
  price: string;
  paySlug: string;
}

const SKU_META: Record<ServiceSku, SkuDisplay> = {
  bid_no_bid:     { label: "Bid/No-Bid Analyst",     price: "$39",    paySlug: "bid-no-bid" },
  matching:       { label: "Matching Subscription",  price: "$49/mo", paySlug: "grants-tenders-matching" },
  proposal_draft: { label: "Proposal Draft",         price: "$299",   paySlug: "proposal-draft" },
  roster:         { label: "Roster Fast-Track",      price: "$749",   paySlug: "roster-fast-track" },
};

// ============================================================================
// Legacy AssessmentData → ApplicantContext bridge
//
// The wizard's AssessmentData shape predates the new engine. Map what we
// have onto ApplicantContext fields the readiness rubric reads; leave the
// rest as defaults (the engine surfaces missing fields as `gap` provenance
// — exactly what the routing wants to flag and pitch a SKU against).
// ============================================================================

function applicantFromLegacyAssessment(data: AssessmentData): ApplicantContext {
  const sectorsCovered = [data.sector, ...data.sectors, ...data.capabilities]
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    // Dedupe — sector often appears in sectors[] too
    .filter((s, i, arr) => arr.indexOf(s) === i);

  return {
    companyName: data.company_name || "Vendor",
    countryOfRegistration: "Unknown", // not surfaced in AssessmentData; Sprint 8 will plumb
    yearsOfExperience: 0,             // ditto
    sectorsCovered,
    keyPersonnel: [],
    pastPerformance: [],
    certifications: data.certifications_detected ?? [],
    geographicReach: [],
    capabilityNarrative: data.summary || undefined,
  };
}

const BAND_LABEL: Record<"high" | "medium" | "low", string> = {
  high: "Strong fit",
  medium: "Workable fit",
  low: "Foundational gaps",
};

const BAND_NEXT: Record<"high" | "medium" | "low", string> = {
  high: "Bid-ready in 14 days with focused fixes",
  medium: "Bid-ready in 30–60 days as gaps close",
  low: "Foundation work first — register and document before bidding",
};

export default function AssessmentResults({
  data,
  onReset,
}: {
  data: AssessmentData;
  onReset: () => void;
}) {
  // Sprint 8c. Anonymous-wizard library carry-forward.
  //
  // GET /api/assessment/library-context fires on mount and tells us three
  // things: whether the typed email matches a registered user, how many
  // enrichable evidence docs that user has on file, and (only when the
  // current viewer is authenticated AS that user) the library payload
  // itself. The three states drive:
  //
  //   - no email match → libraryContext.doc_count === 0 → no banner, no
  //     enrichment (Sprint 7 behaviour preserved verbatim)
  //   - email match, viewer unauthed → banner: "you have N docs on file,
  //     sign in to factor them in"
  //   - email match, viewer signed in → silent enrichment + small badge:
  //     "including N documents from your vault in this readiness"
  //
  // The fetch is best-effort; failure leaves libraryContext null and the
  // page degrades to Sprint 7 behaviour silently.
  const [libraryContext, setLibraryContext] = useState<LibraryContextResponse | null>(null);

  useEffect(() => {
    if (!data.email) return;
    let cancelled = false;
    fetch(`/api/assessment/library-context?email=${encodeURIComponent(data.email)}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? (r.json() as Promise<LibraryContextResponse>) : null))
      .then((j) => {
        if (!cancelled && j) setLibraryContext(j);
      })
      .catch(() => {
        // Silent — Sprint 7 behaviour is the safe fallback.
      });
    return () => {
      cancelled = true;
    };
  }, [data.email]);

  // When the viewer is signed in as the email-matched user, the response
  // includes the library payload and we enrich the ApplicantContext
  // before scoring. Otherwise the context is the wizard's data alone.
  const applicant = useMemo(() => {
    const base = applicantFromLegacyAssessment(data);
    if (libraryContext?.library && libraryContext.library.length > 0) {
      return enrichApplicantContextFromLibrary(base, libraryContext.library);
    }
    return base;
  }, [data, libraryContext]);

  const readiness = useMemo(() => scoreReadiness(applicant), [applicant]);
  const { summary, score, founderCredibility } = readiness;
  const primaryMeta = SKU_META[summary.primaryAction];

  // Group routed gaps by destination SKU. Stable display order:
  // bid_no_bid (urgent admin gates) → matching (recurring quick wins)
  //   → roster (long-arc structural fix) → proposal_draft (per-tender)
  const groupedBySku = useMemo(() => {
    const m = new Map<ServiceSku, RoutedGap[]>();
    for (const g of score.routedGaps) {
      if (!m.has(g.routedTo)) m.set(g.routedTo, []);
      m.get(g.routedTo)!.push(g);
    }
    const order: ServiceSku[] = ["bid_no_bid", "matching", "roster", "proposal_draft"];
    return order.filter((s) => m.has(s)).map((s) => ({ sku: s, gaps: m.get(s)! }));
  }, [score.routedGaps]);

  return (
    <div>
      {/* Masthead — preserved from prior layout */}
      <header className="border-b border-ink pb-8 mb-10">
        <div className="flex items-baseline justify-between mb-3">
          <p className="font-mono text-[10px] tracking-[0.18em] uppercase text-accent">
            Vendor readiness report · No. {String(data.id).padStart(4, "0")}
          </p>
          <div className="flex items-baseline gap-5 print:hidden">
            <button
              onClick={() => window.print()}
              className="font-mono text-[10px] tracking-[0.1em] uppercase text-ink-3 hover:text-ink border-b border-rule hover:border-ink pb-0.5"
            >
              Download PDF ↓
            </button>
            <button
              onClick={onReset}
              className="font-mono text-[10px] tracking-[0.1em] uppercase text-ink-3 hover:text-ink border-b border-rule hover:border-ink pb-0.5"
            >
              Run another →
            </button>
          </div>
        </div>
        <h1 className="font-serif text-[40px] lg:text-[48px] font-normal leading-[1.0] tracking-[-0.02em] text-ink mb-3">
          {data.company_name}
        </h1>
        <p className="font-mono text-[11px] tracking-[0.06em] text-ink-3">
          {data.sectors.slice(0, 4).join(" · ")}
          {data.sectors.length > 4 && ` · +${data.sectors.length - 4}`}
        </p>
      </header>

      {/* S1 — Readiness summary first */}
      <section className="grid lg:grid-cols-[1fr_1.4fr] gap-10 lg:gap-14 mb-12 pb-12 border-b border-rule">
        <div>
          <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-mute mb-2">
            UN procurement readiness
          </p>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="font-serif text-[120px] lg:text-[144px] font-normal leading-[0.85] tracking-[-0.04em] text-ink tabular-nums">
              {summary.overallScore}
            </span>
            <span className="font-serif text-[36px] text-ink-3 leading-none">/100</span>
          </div>
          <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-accent mb-1">
            {BAND_LABEL[summary.band]}
          </p>
          <p className="text-[13px] text-ink-2">{BAND_NEXT[summary.band]}</p>
        </div>

        {/* Honest summary verdict — the spec's "useful, not vanity" read */}
        <div className="flex flex-col justify-center">
          <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-mute mb-4">
            The read
          </p>
          <p className="font-serif text-[22px] lg:text-[24px] leading-[1.4] text-ink">
            {summary.headline}
          </p>
          {data.summary && (
            <p className="text-[13.5px] text-ink-2 leading-[1.6] mt-5 pt-5 border-t border-rule">
              {data.summary}
            </p>
          )}
        </div>
      </section>

      {/* Sprint 8c — library carry-forward signal.
       *
       * Two states render, always between the S1 hero and the S4 founder
       * line — that's the highest-impact placement (immediately after the
       * score, before the user has fully consumed the gaps).
       *
       *   signed_in_match=true  → small badge confirming enrichment ran
       *   signed_in_match=false → banner inviting sign-in to enrich
       *
       * The banner is conversion-relevant: it surfaces a real reason to
       * sign in (factor existing evidence into the score) without lying
       * about what the lift would be (we don't run the enriched score
       * client-side for an unauthed viewer).
       */}
      {libraryContext && libraryContext.doc_count > 0 && (
        libraryContext.signed_in_match ? (
          <section className="mb-10 pb-6 border-b border-rule">
            <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-accent">
              Library applied · {libraryContext.doc_count} document{libraryContext.doc_count === 1 ? "" : "s"} factored into this readiness
            </p>
          </section>
        ) : (
          <section className="mb-10 pb-6 border-b border-rule">
            <div className="grid lg:grid-cols-[180px_1fr_auto] gap-4 lg:gap-10 items-baseline">
              <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-mute">
                Evidence on file
              </p>
              <p className="font-serif text-[16px] lg:text-[17px] leading-[1.5] text-ink">
                You have {libraryContext.doc_count} evidence document{libraryContext.doc_count === 1 ? "" : "s"} on file from a previous session. Sign in to factor {libraryContext.doc_count === 1 ? "it" : "them"} into this score.
              </p>
              <Link
                href={`/login?next=${encodeURIComponent("/assessment")}`}
                className="font-mono text-[10px] tracking-[0.12em] uppercase text-ink border-b border-ink hover:text-accent hover:border-accent pb-0.5 whitespace-nowrap"
              >
                Sign in →
              </Link>
            </div>
          </section>
        )
      )}

      {/* S4 — Founder-credibility line at the trust moment */}
      <section className="mb-14 pb-10 border-b border-rule">
        <div className="grid lg:grid-cols-[180px_1fr] gap-6 lg:gap-10">
          <div>
            <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-mute mb-2">
              Who built this
            </p>
            <p className="font-mono text-[11px] tracking-[0.06em] text-ink-3">
              {founderCredibility.yearsExperience}yr · {founderCredibility.agencies.join(", ")} · {founderCredibility.seniorityLevel}
            </p>
          </div>
          <p className="font-serif text-[16px] lg:text-[17px] leading-[1.6] text-ink italic">
            {founderCredibility.line}
          </p>
        </div>
      </section>

      {/* S2 — Per-gap routed. Every gap maps to one paid SKU. */}
      {groupedBySku.length > 0 && (
        <section className="mb-14">
          <div className="flex items-baseline justify-between mb-6 pb-3 border-b border-ink">
            <h2 className="font-serif text-[28px] lg:text-[32px] font-normal leading-tight tracking-[-0.02em] text-ink">
              Gaps to close
            </h2>
            <p className="font-mono text-[10px] tracking-[0.12em] uppercase text-mute tabular-nums">
              {score.routedGaps.length} {score.routedGaps.length === 1 ? "gap" : "gaps"}
            </p>
          </div>
          <div className="space-y-6">
            {groupedBySku.map(({ sku, gaps }) => (
              <SkuGapPanel key={sku} sku={sku} gaps={gaps} isPrimary={sku === summary.primaryAction} />
            ))}
          </div>
        </section>
      )}

      {/* Matched tenders — preserved supplementary content */}
      {data.matched_tenders.length > 0 && (
        <section className="mb-14">
          <div className="flex items-baseline justify-between mb-6 pb-3 border-b border-ink">
            <h2 className="font-serif text-[28px] lg:text-[32px] font-normal leading-tight tracking-[-0.02em] text-ink">
              Live opportunities · Tenders
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
                    {decodeHtmlEntities(t.title)}
                  </p>
                  <p className="font-mono text-[10px] tracking-[0.04em] text-ink-3">
                    {decodeHtmlEntities(t.agency)}
                    {t.country ? ` · ${t.country}` : ""}
                    {t.reference_id ? ` · ${t.reference_id}` : ""}
                  </p>
                </div>
                <p className="hidden lg:block font-mono text-[10px] tracking-[0.04em] text-ink-3">
                  {t.deadline ? new Date(t.deadline).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—"}
                </p>
                <div className="text-right">
                  <p className="font-serif text-[20px] leading-none text-ink tabular-nums">
                    {t.score ?? "—"}
                  </p>
                  <p className="font-mono text-[9px] tracking-[0.08em] uppercase text-mute mt-0.5">
                    Fit
                  </p>
                </div>
                {t.source_url && (
                  <a
                    href={t.source_url}
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

      {/* Matched grants — preserved */}
      {data.matched_grants.length > 0 && (
        <section className="mb-14">
          <div className="flex items-baseline justify-between mb-6 pb-3 border-b border-ink">
            <h2 className="font-serif text-[28px] lg:text-[32px] font-normal leading-tight tracking-[-0.02em] text-ink">
              Live opportunities · Grants
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
                  <p className="text-[14px] text-ink mb-1">{decodeHtmlEntities(g.title)}</p>
                  <p className="font-mono text-[10px] tracking-[0.04em] text-ink-3">
                    {decodeHtmlEntities(g.agency)}{g.sector ? ` · ${g.sector}` : ""}
                  </p>
                </div>
                {g.source_url && (
                  <a
                    href={g.source_url}
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

      {/* Strengths — preserved */}
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

      {/* S3 — ONE primary CTA. summary.primaryAction is the engine's single
          conversion target derived from gap-routing distribution + band. */}
      <section className="bg-ink text-paper p-8 lg:p-10 mt-14">
        <p className="font-mono text-[10px] tracking-[0.18em] uppercase text-accent-2 mb-4">
          Recommended next step
        </p>
        <h2 className="font-serif text-[32px] lg:text-[40px] font-normal leading-[1.05] tracking-[-0.02em] mb-3">
          {primaryMeta.label}
        </h2>
        <p className="text-[14px] text-paper-2/70 leading-[1.55] mb-6 max-w-xl">
          {summary.primaryActionRationale}
        </p>
        <div className="flex flex-wrap items-baseline gap-6 pt-6 border-t border-paper-2/15">
          <div className="flex items-baseline gap-1">
            <span className="font-serif text-[40px] leading-none tabular-nums">{primaryMeta.price}</span>
          </div>
          {isComingSoonTier(primaryMeta.paySlug) ? (
            <span className="font-mono text-[11px] tracking-[0.14em] uppercase text-paper-2/60 border border-paper-2/20 px-7 py-3.5">
              Coming soon
            </span>
          ) : (
            <Link
              href={`/pay?plan=${primaryMeta.paySlug}`}
              className="bg-paper text-ink font-mono text-[11px] tracking-[0.14em] uppercase px-7 py-3.5 hover:bg-accent-2 transition-colors"
            >
              Start {primaryMeta.label} →
            </Link>
          )}
          <Link
            href="/login"
            className="font-mono text-[11px] tracking-[0.12em] uppercase text-paper-2/70 hover:text-paper border-b border-paper-2/30 hover:border-paper pb-0.5"
          >
            Save report → sign up
          </Link>
        </div>
      </section>

      <p className="font-mono text-[10px] tracking-[0.06em] text-mute mt-10 text-center">
        A full PDF copy of this report has been emailed to {data.email}.
      </p>
    </div>
  );
}

// ============================================================================
// SkuGapPanel — one panel per destination SKU, with a SKU header + per-gap
// rows. The primary-action panel gets a subtle accent border so the user's
// eye lands there first; non-primary panels are still visible but read as
// "also useful" rather than "the main path".
// ============================================================================

function SkuGapPanel({
  sku,
  gaps,
  isPrimary,
}: {
  sku: ServiceSku;
  gaps: RoutedGap[];
  isPrimary: boolean;
}) {
  const meta = SKU_META[sku];
  // First gap's rationale doubles as the panel-level explainer ("why this
  // SKU closes this kind of gap"). It's the engine's own rationale string,
  // not invented client-side.
  const rationale = gaps[0]?.rationale ?? "";
  return (
    <article
      className={`border ${isPrimary ? "border-ink" : "border-rule"} p-5 lg:p-6`}
    >
      <header className="flex items-baseline justify-between gap-4 flex-wrap mb-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span
            className={`font-mono text-[10px] tracking-[0.14em] uppercase px-2 py-0.5 border ${
              isPrimary ? "bg-ink text-paper border-ink" : "text-ink border-ink"
            }`}
          >
            {meta.label} · {meta.price}
          </span>
          <span className="font-mono text-[10px] tracking-[0.06em] text-ink-3 tabular-nums">
            {gaps.length} {gaps.length === 1 ? "gap" : "gaps"}
          </span>
          {isPrimary && (
            <span className="font-mono text-[9px] tracking-[0.18em] uppercase text-accent">
              · primary fix
            </span>
          )}
        </div>
        {isComingSoonTier(meta.paySlug) ? (
          <span className="font-mono text-[10px] tracking-[0.12em] uppercase pb-0.5 text-mute">
            Coming soon
          </span>
        ) : (
          <Link
            href={`/pay?plan=${meta.paySlug}`}
            className={`font-mono text-[10px] tracking-[0.12em] uppercase pb-0.5 border-b ${
              isPrimary
                ? "text-ink border-ink hover:text-accent hover:border-accent"
                : "text-ink-3 border-rule hover:text-ink hover:border-ink"
            }`}
          >
            Start {meta.label} →
          </Link>
        )}
      </header>
      {rationale && (
        <p className="text-[13px] text-ink-2 leading-[1.6] mb-4 italic">{rationale}</p>
      )}
      <ul className="space-y-3">
        {gaps.slice(0, 6).map((g, i) => (
          <li key={i} className="grid grid-cols-[24px_1fr] gap-3 text-[13px]">
            <span className="font-mono text-[10px] text-mute tabular-nums">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <p className="text-ink leading-[1.55]">{g.text}</p>
              {g.criterionId && (
                <p className="font-mono text-[9.5px] text-ink-3 mt-0.5 tracking-[0.04em]">
                  ↳ {g.criterionId}
                </p>
              )}
            </div>
          </li>
        ))}
        {gaps.length > 6 && (
          <li className="font-mono text-[11px] text-ink-3 italic">
            + {gaps.length - 6} more close with this service
          </li>
        )}
      </ul>
    </article>
  );
}
