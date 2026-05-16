import Link from "next/link";
import { notFound } from "next/navigation";
import { TIERS } from "@/lib/pricing";
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
    lead: "Use this when agency registration or long-term agreement readiness is the bottleneck. Tenderpath prepares the vendor-facing package for the target agency and supports you through the process.",
    output: [
      "Agency-specific readiness checklist",
      "Vendor registration document pack",
      "Capability statement",
      "Submission and follow-up support for the tender window",
    ],
    workflow: [
      "Confirm the agency or roster target and your current registration status",
      "Upload any call documents or vendor guides if available",
      "Complete checkout — initial package is generated same day, with support throughout the tender window",
    ],
    deliverySla: "Initial package within 3 business days; support active for the full tender window",
    intakePrompt: "Upload the agency's call for applications, vendor registration guide, or any LTA documents you have. You can return to add more information at any time while the tender is open.",
    caveat: "Roster approval remains with the agency. Access to this service and its deliverables stays active as long as the tender window is open.",
    cta: "Start roster readiness",
    sampleLines: [
      "TARGET AGENCY: UNDP — Professional Services Roster (ICT & Digital)",
      "WINDOW: Open for applications until 30 June 2025",
      "CHECKLIST: ✓ Company registration certificate ✓ Capability statement ✗ UNGM registration (step-by-step guide included) ✗ Financial statements (last 2 years) ✗ Reference list (min. 3 contracts, last 5 years)",
      "CAPABILITY STATEMENT: [Draft included — confirm sector alignment, key personnel, and past performance before submitting]",
      "SUBMISSION NOTES: Applications submitted via UNGM Vendor Portal. Expected response time: 6–8 weeks after close.",
      "[Redacted sample — actual package is specific to the agency and roster you confirm at intake.]",
    ],
  },
};

const SERVICE_PREVIEW_MAP: Record<ServiceSlug, SamplePreviewType> = {
  "bid-no-bid": "bid-no-bid",
  "digest": "digest",
  "proposal": "proposal",
  "lta-roster": "roster",
};

const MONO_FONT = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";
const SERIF_FONT = "'Fraunces', 'Times New Roman', serif";

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
    <div className="px-8 py-8 max-w-[1400px]">
      {/* Back link */}
      <Link
        href="/dashboard/services"
        className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500 hover:text-stone-900 transition-colors"
        style={{ fontFamily: MONO_FONT }}
      >
        ← All service paths
      </Link>

      {/* Header */}
      <header className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <div className="flex items-center gap-3 text-[11px] text-stone-500">
            <span
              className="font-semibold uppercase tracking-[0.18em] text-stone-400"
              style={{ fontFamily: MONO_FONT }}
            >
              Workbench · Service path
            </span>
            <span className="text-stone-300">·</span>
            <span style={{ fontFamily: MONO_FONT }}>{service.eyebrow}</span>
          </div>
          <h1
            className="mt-1 text-[56px] leading-[1.05] font-medium text-stone-900 tracking-tight"
            style={{ fontFamily: SERIF_FONT, fontFeatureSettings: "'ss01'" }}
          >
            {service.title}
          </h1>
          <p className="mt-2 text-[15.5px] leading-relaxed text-stone-600">
            {service.lead}
          </p>
        </div>
        {tier && (
          <div className="shrink-0 rounded-md border border-stone-200/70 bg-white px-5 py-4 min-w-[200px]">
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400"
              style={{ fontFamily: MONO_FONT }}
            >
              Price
            </div>
            <div className="mt-1.5 flex items-baseline gap-1">
              <span
                className="text-[36px] leading-none font-medium tabular-nums text-stone-900"
                style={{ fontFamily: SERIF_FONT }}
              >
                {tier.price}
              </span>
              <span
                className="text-[12px] text-stone-500"
                style={{ fontFamily: MONO_FONT }}
              >
                {tier.billingPeriod}
              </span>
            </div>
            <div className="mt-1 text-[11.5px] text-stone-500 leading-snug">{tier.billingNote}</div>
          </div>
        )}
      </header>

      {/* Two-column layout */}
      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.9fr)]">
        {/* LEFT — what you get + how it works */}
        <section className="space-y-7">
          {/* What you get */}
          <div className="rounded-md border border-stone-200/70 bg-white p-6">
            <h2
              className="text-[22px] font-medium text-stone-900 mb-4"
              style={{ fontFamily: SERIF_FONT }}
            >
              <span
                className="text-[11px] font-semibold tabular-nums text-stone-400 mr-2 align-middle"
                style={{ fontFamily: MONO_FONT }}
              >
                01 ·
              </span>
              Deliverables
            </h2>
            <ul className="grid grid-cols-1 gap-px bg-stone-200/70 rounded-sm overflow-hidden sm:grid-cols-2">
              {service.output.map((item, idx) => (
                <li
                  key={item}
                  className="bg-stone-50/60 px-4 py-3.5 text-[13.5px] leading-relaxed text-stone-800 flex gap-3"
                >
                  <span
                    className="shrink-0 text-[10px] font-semibold tabular-nums text-stone-400 mt-0.5"
                    style={{ fontFamily: MONO_FONT }}
                  >
                    {(idx + 1).toString().padStart(2, "0")}
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* How it works */}
          <div className="rounded-md border border-stone-200/70 bg-white p-6">
            <h2
              className="text-[22px] font-medium text-stone-900 mb-4"
              style={{ fontFamily: SERIF_FONT }}
            >
              <span
                className="text-[11px] font-semibold tabular-nums text-stone-400 mr-2 align-middle"
                style={{ fontFamily: MONO_FONT }}
              >
                02 ·
              </span>
              How it works
            </h2>
            <ol className="space-y-3">
              {service.workflow.map((item, index) => (
                <li key={item} className="flex gap-4 text-[14px] text-stone-700 leading-relaxed">
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-stone-300 bg-white text-[10px] font-semibold text-stone-700 tabular-nums mt-0.5"
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
          <div className="rounded-md border-l-2 border-amber-600 bg-amber-50/40 px-4 py-3.5">
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700"
              style={{ fontFamily: MONO_FONT }}
            >
              Note · before you order
            </div>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-amber-950">{service.caveat}</p>
          </div>

          {/* Sample output */}
          <details className="group rounded-md border border-stone-200/70 bg-white">
            <summary className="cursor-pointer list-none flex items-center gap-3 px-6 py-4 text-[13px] font-semibold uppercase tracking-[0.15em] text-stone-700 hover:text-stone-900 select-none">
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
            <div className="border-t border-stone-200/70 px-6 py-5">
              <SampleOutputPreview
                type={SERVICE_PREVIEW_MAP[service.slug]}
                variant="light"
              />
            </div>
          </details>
        </section>

        {/* RIGHT — order */}
        <aside className="rounded-md border border-stone-200/70 bg-white p-6 self-start lg:sticky lg:top-6">
          {/* SLA badge */}
          <div className="rounded-sm border-l-2 border-emerald-600 bg-emerald-50/40 px-3.5 py-2.5">
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700"
              style={{ fontFamily: MONO_FONT }}
            >
              Delivery SLA
            </div>
            <p className="mt-0.5 text-[12.5px] leading-snug text-emerald-900">{service.deliverySla}</p>
          </div>

          {/* Work context */}
          <h2
            className="mt-6 text-[18px] font-medium text-stone-900"
            style={{ fontFamily: SERIF_FONT }}
          >
            <span
              className="text-[10px] font-semibold tabular-nums text-stone-400 mr-2 align-middle"
              style={{ fontFamily: MONO_FONT }}
            >
              03 ·
            </span>
            Work context
          </h2>
          {hasContext ? (
            <dl className="mt-3.5 space-y-3">
              {context.tender && (
                <div>
                  <dt
                    className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400"
                    style={{ fontFamily: MONO_FONT }}
                  >
                    Tender
                  </dt>
                  <dd className="mt-0.5 text-[13px] text-stone-900 leading-snug">{context.tender}</dd>
                </div>
              )}
              {context.agency && (
                <div>
                  <dt
                    className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400"
                    style={{ fontFamily: MONO_FONT }}
                  >
                    Agency
                  </dt>
                  <dd className="mt-0.5 text-[13px] text-stone-900">{context.agency}</dd>
                </div>
              )}
              {context.pipelineItemId && (
                <div>
                  <dt
                    className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400"
                    style={{ fontFamily: MONO_FONT }}
                  >
                    Pipeline item
                  </dt>
                  <dd
                    className="mt-0.5 text-[13px] text-stone-900"
                    style={{ fontFamily: MONO_FONT }}
                  >
                    #{context.pipelineItemId}
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="mt-3 text-[12.5px] leading-relaxed text-stone-500">
              No tender attached yet. Open a matched tender from the dashboard or pipeline to carry context into checkout.
            </p>
          )}

          {/* Intake prompt */}
          <div className="mt-5 rounded-sm border-l-2 border-stone-700 bg-stone-50/60 px-3.5 py-2.5 text-[12px] leading-relaxed text-stone-700">
            {service.intakePrompt}
          </div>

          {/* Intake form */}
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
          />
        </aside>
      </div>
    </div>
  );
}
