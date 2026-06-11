import Link from "next/link";
import { notFound } from "next/navigation";
import { TIERS, isComingSoonTier } from "@/lib/pricing";
import ServiceIntakeForm from "../ServiceIntakeForm";
import SampleOutputPreview, { type SamplePreviewType } from "@/components/SampleOutputPreview";
import { getCurrentUserAssessment } from "@/lib/assessment";

type ServiceSlug = "bid-no-bid" | "digest" | "proposal" | "lta-roster";

interface ServiceConfig {
  slug: ServiceSlug;
  tierSlug: string;
  eyebrow: string;
  title: string;
  lead: string;
  output: string[];
  workflow: string[];
  caveat: string;
  cta: string;
  deliverySla: string;
  intakePrompt: string;
  sampleLines: string[];
}

const SERVICES: Record<ServiceSlug, ServiceConfig> = {
  "bid-no-bid": {
    slug: "bid-no-bid",
    tierSlug: "bid-no-bid",
    eyebrow: "Per-tender decision",
    title: "Bid/no-bid analysis",
    lead: "Use this before the team spends serious time on a proposal. Tenderpath checks the tender against your saved profile, match evidence, deadline pressure, and likely blockers.",
    output: [
      "Pursue / skip recommendation with reasoning",
      "Fit evidence and risk flags",
      "Required documents and missing readiness items",
      "Estimated effort and timeline",
    ],
    workflow: [
      "Confirm the selected tender from your pipeline",
      "Paste in any requirements or TOR excerpts you have — the more context, the sharper the analysis",
      "Complete checkout — the analysis runs instantly on confirmation",
    ],
    deliverySla: "Analysis delivered instantly after payment",
    intakePrompt: "The analysis is grounded in the tender data we already have plus whatever you add below. If the tender description on the source page is thin, paste key eligibility criteria or evaluation criteria here — otherwise the recommendation will be too general to act on.",
    caveat: "Best when the tender has enough requirements or source detail for a grounded recommendation. Adding context in the form below significantly improves output quality.",
    cta: "Start bid/no-bid",
    sampleLines: [
      "RECOMMENDATION: Pursue — Strong fit",
      "FIT SCORE: 78% — Sector, geography, and capability match confirmed",
      "RISK FLAGS: D-U-N-S number not detected on file; Financial statements may be required",
      "EFFORT ESTIMATE: ~3 person-days; 14 days to deadline",
      "DECISION: Proceed if D-U-N-S can be resolved within 48 hours. Deprioritise if not.",
      "NEXT STEP: Open proposal package or confirm eligibility before deadline",
      "[This is a redacted sample — actual output is grounded in your profile and the specific tender.]",
    ],
  },
  digest: {
    slug: "digest",
    tierSlug: "grants-tenders-matching",
    eyebrow: "Subscription · $49/mo",
    title: "Daily matched digest",
    lead: "A live subscription, not a one-off task. The crawler runs daily against your profile and emails you a scored shortlist of tenders and grants worth your time. Cancel anytime — no contract, no minimum term.",
    output: [
      "Daily email when new matches are found (silent days stay silent)",
      "Scored shortlist with deadline, agency, and value context",
      "Fit reasons and caveats so you can skim or skip in seconds",
      "Matches synced to your dashboard pipeline automatically",
    ],
    workflow: [
      "Confirm preferences below (what to prioritize, what to skip)",
      "Complete checkout — billing starts today, cancel anytime",
      "First digest lands within 24 hours; daily after that when there's something to send",
      "Use the dashboard to mark items relevant or not — the digest tunes itself",
    ],
    deliverySla: "Billing starts on checkout. First digest within 24 hours. Cancel anytime from settings.",
    intakePrompt: "Two short preferences sharpen your digest immediately. You can edit these anytime from settings — they take effect on the next run.",
    caveat: "Digest quality depends on a current assessment profile and feedback. If your company profile shifts, re-run the assessment to keep matches accurate.",
    cta: "Subscribe · $49/mo",
    sampleLines: [
      "Subject: TenderPath Digest — 4 new matches this week",
      "TOP MATCH: UNICEF Supply Division — Laboratory equipment procurement | Fit: 81% | Deadline: 12 May",
      "MATCH 2: UNDP Kenya — ICT infrastructure services | Fit: 74% | Deadline: 19 May",
      "MATCH 3: WHO AFRO — Health data systems support | Fit: 67% | Deadline: 26 May",
      "EXCLUDED: 2 watchlist items (sector adjacent, low deadline pressure)",
      "[Sample redacted — actual digest reflects your live profile and matched sources.]",
    ],
  },
  proposal: {
    slug: "proposal",
    tierSlug: "proposal-draft",
    eyebrow: "Submission support",
    title: "Proposal / application package",
    lead: "Use this for a live tender you already want to pursue. Tenderpath prepares the proposal structure so the team can review, price, and finalize faster.",
    output: [
      "Technical proposal draft",
      "Compliance checklist",
      "Cover letter and executive summary",
      "Financial template aligned to the tender",
    ],
    workflow: [
      "Confirm tender and agency context",
      "Upload the TOR or RFP if you have it — the draft will be grounded in the actual requirements",
      "Complete checkout — the package is generated and ready for your review the same day",
    ],
    deliverySla: "Draft delivered within 2 hours of payment and intake confirmation",
    intakePrompt: "Upload the TOR or RFP document if you have access to it. The more requirements and context you provide, the less revision the package will need before submission.",
    caveat: "This does not submit on your behalf unless separately agreed; it prepares the working package for your review and sign-off.",
    cta: "Start proposal package",
    sampleLines: [
      "SECTION 1 — Understanding of Requirements: [Agency] seeks a qualified vendor to deliver [scope]. Key deliverables include…",
      "SECTION 2 — Technical Approach: Our methodology is structured in three phases: (1) Inception and stakeholder alignment, (2) Implementation, (3) Handover and reporting…",
      "SECTION 3 — Team Composition: Project Lead (15 yrs experience), Technical Specialist, Field Coordinator…",
      "COMPLIANCE CHECKLIST: ✓ Company registration ✓ Tax clearance ✗ UNGM registration (required) ✗ Audited financials (last 2 years)",
      "COVER LETTER: [Draft included — review agency name, values reference, and signatory before submission]",
      "[Redacted sample — actual draft is grounded in the TOR or RFP you provide at intake.]",
    ],
  },
  "lta-roster": {
    slug: "lta-roster",
    tierSlug: "roster-fast-track",
    eyebrow: "Eligibility and readiness",
    title: "LTA / roster readiness",
    lead: "Use this when agency registration or long-term agreement readiness is the bottleneck. Tenderpath scores you against 8 UN procurement portals — UNGM, WFP, UNICEF, UNDP, IOM, FAO, UNOPS, WHO — and tells you which one to register with first based on your evidence library and capabilities. Then it prepares the vendor-facing package for that agency.",
    output: [
      "Per-agency readiness leaderboard across 8 UN portals (start_here / viable / blocked + cited missing docs)",
      "Agency-specific registration checklist tied to the highest-readiness agency",
      "Capability statement and cover letter tailored to that agency",
      "Document-renaming rules following UN procurement best practice",
      "Submission and follow-up support for the tender window",
    ],
    workflow: [
      "Pick the agency you're most interested in (or let us recommend) — Tenderpath scores all 8 portals against your evidence library",
      "Upload any call documents, vendor guides, or company evidence if available",
      "Complete checkout — initial package is generated same day, with support throughout the tender window",
    ],
    deliverySla: "Initial package within 3 business days; support active for the full tender window",
    intakePrompt: "Upload the agency's call for applications, vendor registration guide, or any LTA documents you have. You can return to add more information at any time while the tender is open.",
    caveat: "Roster approval remains with the agency. Access to this service and its deliverables stays active as long as the tender window is open.",
    cta: "Start roster readiness",
    sampleLines: [
      "AGENCY READINESS · 8 agencies scored",
      "★ UNGM   7/10  start_here  (docs 7/10 · category 8/10 · geo 7/10) — 7 of 10 required docs already in your evidence library; gaps are tax certificate, BCP, QA policy.",
      "• FAO    7/10  viable      (docs 7/10 · category 9/10 · geo 6/10) — exceptional category fit; gaps are food-safety policy + anti-fraud declaration.",
      "• UNDP   7/10  viable      (docs 8/10 · category 7/10 · geo 7/10) — prior 2022 engagement is leverageable; need formal UNDP reference letter.",
      "✗ UNICEF 4/10  blocked     (cat 2/10) — UNICEF supply categories (NFI, WASH, cold-chain) do not match an advisory firm.",
      "✗ WHO    4/10  blocked     (cat 3/10) — WHO procurement is for manufacturers with WHO prequalification; not applicable.",
      "PRIMARY AGENCY: UNGM (gateway). Full registration checklist, capability statement, document-renaming rules, and submission instructions included.",
      "[Redacted sample — actual leaderboard is specific to your evidence library and capabilities.]",
    ],
  },
};

const SERVICE_PREVIEW_MAP: Record<ServiceSlug, SamplePreviewType> = {
  "bid-no-bid": "bid-no-bid",
  "digest": "digest",
  "proposal": "proposal",
  "lta-roster": "roster",
};

// Dossier fonts (match the Workbench: JetBrains mono + Fraunces serif).
const MONO_FONT = "var(--font-jetbrains), 'SF Mono', ui-monospace, monospace";
const SERIF_FONT = "var(--font-fraunces), 'Times New Roman', serif";

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function ServiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ service: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { service: serviceParam } = await params;
  const service = SERVICES[serviceParam as ServiceSlug];
  if (!service) notFound();

  const query = await searchParams;
  const context = {
    tender: firstValue(query.tender),
    agency: firstValue(query.agency),
    pipelineItemId: firstValue(query.pipeline_item_id),
    docId: firstValue(query.doc_id),
    tenderUrl: firstValue(query.tender_url),
  };
  const tier = TIERS.find((item) => item.slug === service.tierSlug);
  // Held-back services (e.g. Roster/LTA "coming soon") show a notice instead of
  // the order form. The checkout APIs are the hard backstop.
  const comingSoon = tier ? isComingSoonTier(tier.slug) : false;
  const hasContext = Boolean(context.tender || context.agency || context.pipelineItemId);

  // Fetch a slim view of the current assessment so the ConfidenceGate can
  // detect low-confidence / multi-bucket sector classifications and prompt
  // the user to confirm before the paid order. Server-side fetch keeps
  // ServiceIntakeForm free of additional API plumbing.
  const assessment = await getCurrentUserAssessment().catch(() => null);
  const assessmentSnapshot = assessment
    ? {
        companyName: assessment.companyName,
        sector: assessment.sector,
        description: assessment.summary,
      }
    : null;

  return (
    <div className="d2-scope px-8 py-8 max-w-[1400px]">
      {/* Back link */}
      <Link
        href="/dashboard/services"
        className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-3 hover:text-ink transition-colors"
        style={{ fontFamily: MONO_FONT }}
      >
        ← All service paths
      </Link>

      {/* Header */}
      <header className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <div className="flex items-center gap-3 text-[11px] text-ink-3">
            <span
              className="font-semibold uppercase tracking-[0.18em] text-mute"
              style={{ fontFamily: MONO_FONT }}
            >
              Workbench · Service path
            </span>
            <span className="text-mute">·</span>
            <span style={{ fontFamily: MONO_FONT }}>{service.eyebrow}</span>
          </div>
          <h1
            className="mt-1 text-[56px] leading-[1.05] font-medium text-ink tracking-tight"
            style={{ fontFamily: SERIF_FONT, fontFeatureSettings: "'ss01'" }}
          >
            {service.title}
          </h1>
          <p className="mt-2 text-[15.5px] leading-relaxed text-ink-2">
            {service.lead}
          </p>
        </div>
        {tier && (
          <div className="shrink-0 border border-rule bg-white px-5 py-4 min-w-[200px]">
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-mute"
              style={{ fontFamily: MONO_FONT }}
            >
              Price
            </div>
            <div className="mt-1.5 flex items-baseline gap-1">
              <span
                className="text-[36px] leading-none font-medium tabular-nums text-ink"
                style={{ fontFamily: SERIF_FONT }}
              >
                {tier.price}
              </span>
              <span
                className="text-[12px] text-ink-3"
                style={{ fontFamily: MONO_FONT }}
              >
                {tier.billingPeriod}
              </span>
            </div>
            <div className="mt-1 text-[11.5px] text-ink-3 leading-snug">
              {comingSoon ? "Coming soon" : tier.billingNote}
            </div>
          </div>
        )}
      </header>

      {/* Two-column layout */}
      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.9fr)]">
        {/* LEFT — how it works + caveat + sample */}
        <section className="space-y-7">
          <div className="border border-rule bg-white p-6">
            <h2
              className="text-[22px] font-medium text-ink mb-4"
              style={{ fontFamily: SERIF_FONT }}
            >
              <span
                className="text-[11px] font-semibold tabular-nums text-accent mr-2 align-middle"
                style={{ fontFamily: MONO_FONT }}
              >
                §01 ·
              </span>
              How it works
            </h2>
            <ol className="space-y-3">
              {service.workflow.map((item, index) => (
                <li key={item} className="flex gap-4 text-[14px] text-ink-2 leading-relaxed">
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-rule bg-white text-[10px] font-semibold text-ink-2 tabular-nums mt-0.5"
                    style={{ fontFamily: MONO_FONT }}
                  >
                    {index + 1}
                  </span>
                  <span className="pt-0.5">{item}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Caveat */}
          <div className="border-l-2 border-accent bg-[#f8f2e2] px-4 py-3.5">
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent"
              style={{ fontFamily: MONO_FONT }}
            >
              Note · before you order
            </div>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{service.caveat}</p>
          </div>

          {/* Sample output */}
          <details className="group border border-rule bg-white">
            <summary className="cursor-pointer list-none flex items-center gap-3 px-6 py-4 text-[13px] font-semibold uppercase tracking-[0.15em] text-ink-2 hover:text-ink select-none">
              <svg
                className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              <span style={{ fontFamily: MONO_FONT }}>Sample output · redacted preview</span>
            </summary>
            <div className="border-t border-rule px-6 py-5">
              <SampleOutputPreview
                type={SERVICE_PREVIEW_MAP[service.slug]}
                variant="light"
              />
            </div>
          </details>
        </section>

        {/* RIGHT — order */}
        <aside className="border border-rule bg-white p-6 self-start lg:sticky lg:top-6">
          <h2
            className="text-[18px] font-medium text-ink flex items-center gap-2"
            style={{ fontFamily: SERIF_FONT }}
          >
            <span
              className="text-[10px] font-semibold tabular-nums text-accent align-middle"
              style={{ fontFamily: MONO_FONT }}
            >
              §02 ·
            </span>
            <span>Work context</span>
            {service.intakePrompt && (
              <span
                className="ml-0.5 inline-flex h-[15px] w-[15px] cursor-help items-center justify-center rounded-full border border-rule text-[9px] font-bold text-ink-3 align-middle"
                style={{ fontFamily: MONO_FONT }}
                title={service.intakePrompt}
                aria-label={service.intakePrompt}
              >
                i
              </span>
            )}
          </h2>
          {hasContext ? (
            <dl className="mt-3.5 space-y-3">
              {context.tender && (
                <div>
                  <dt
                    className="text-[10px] font-semibold uppercase tracking-[0.18em] text-mute"
                    style={{ fontFamily: MONO_FONT }}
                  >
                    Tender
                  </dt>
                  <dd className="mt-0.5 text-[13px] text-ink leading-snug">{context.tender}</dd>
                </div>
              )}
              {context.agency && (
                <div>
                  <dt
                    className="text-[10px] font-semibold uppercase tracking-[0.18em] text-mute"
                    style={{ fontFamily: MONO_FONT }}
                  >
                    Agency
                  </dt>
                  <dd className="mt-0.5 text-[13px] text-ink">{context.agency}</dd>
                </div>
              )}
              {context.pipelineItemId && (
                <div>
                  <dt
                    className="text-[10px] font-semibold uppercase tracking-[0.18em] text-mute"
                    style={{ fontFamily: MONO_FONT }}
                  >
                    Pipeline item
                  </dt>
                  <dd
                    className="mt-0.5 text-[13px] text-ink"
                    style={{ fontFamily: MONO_FONT }}
                  >
                    #{context.pipelineItemId}
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">
              No tender attached yet. Open a matched tender from the dashboard or pipeline to carry context into checkout.
            </p>
          )}

          {/* Intake form — gated when the service is held back ("coming soon") */}
          {comingSoon ? (
            <div className="mt-4 border-l-2 border-accent bg-[#f8f2e2] px-4 py-4">
              <div
                className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent"
                style={{ fontFamily: MONO_FONT }}
              >
                Coming soon
              </div>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">
                This service isn&rsquo;t open for orders yet — we&rsquo;re putting the finishing
                touches on it. Explore the other service paths in the meantime, and we&rsquo;ll
                announce the moment it opens.
              </p>
              <Link
                href="/dashboard/services/bid-no-bid"
                className="mt-3 inline-block text-[11px] font-semibold uppercase tracking-[0.15em] text-ink-2 hover:text-ink"
                style={{ fontFamily: MONO_FONT }}
              >
                ← Browse available services
              </Link>
            </div>
          ) : (
            <ServiceIntakeForm
              service={service.slug}
              plan={service.tierSlug}
              pipelineItemId={context.pipelineItemId}
              tenderTitle={context.tender}
              agency={context.agency}
              docId={context.docId}
              initialTenderUrl={context.tenderUrl}
              label={service.cta}
              assessmentSnapshot={assessmentSnapshot}
              submissionType={typeof query.type === "string" ? query.type : null}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
