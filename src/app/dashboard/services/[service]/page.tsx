import Link from "next/link";
import { notFound } from "next/navigation";
import { TIERS } from "@/lib/pricing";
import ServiceIntakeForm from "../ServiceIntakeForm";

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
    eyebrow: "Ongoing matching",
    title: "Daily matched digest",
    lead: "Keep the sourcing engine running after assessment. Tenderpath sends daily notifications when the crawler finds relevant matches, and a curated shortlist back into your dashboard workflow.",
    output: [
      "Daily notifications when new matches are found",
      "Scored shortlist with deadline and agency context",
      "Fit reasons and caveats per opportunity",
      "Reminder-ready shortlist for the dashboard workflow",
    ],
    workflow: [
      "Subscribe with the company account email",
      "Tenderpath monitors matched sources daily against your assessment profile",
      "New matches trigger an email notification on the next digest run",
      "Use dashboard feedback to tune what stays relevant",
    ],
    deliverySla: "First digest within 24 hours; daily notifications of relevant matches",
    intakePrompt: "Tell us what to prioritize and what to ignore — the more specific you are, the less noise gets into your digest.",
    caveat: "Digest quality depends on a current company profile and clear preference feedback.",
    cta: "Subscribe to digest",
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
  };
  const tier = TIERS.find((item) => item.slug === service.tierSlug);
  const hasContext = Boolean(context.tender || context.agency || context.pipelineItemId);

  return (
    <div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {service.eyebrow}
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">{service.title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">{service.lead}</p>
        </div>
        {tier && (
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
            <div className="text-2xl font-bold text-gray-900">
              {tier.price}<span className="text-sm font-medium text-gray-500">{tier.billingPeriod}</span>
            </div>
            <div className="mt-1 text-xs text-gray-500">{tier.billingNote}</div>
          </div>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.9fr)]">
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-base font-semibold text-gray-900">What you get</h2>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {service.output.map((item) => (
              <div key={item} className="rounded-md bg-gray-50 px-3 py-3 text-sm text-gray-700">
                {item}
              </div>
            ))}
          </div>

          <h2 className="mt-6 text-base font-semibold text-gray-900">How it works</h2>
          <ol className="mt-3 space-y-2">
            {service.workflow.map((item, index) => (
              <li key={item} className="flex gap-3 text-sm text-gray-600">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white">
                  {index + 1}
                </span>
                <span className="pt-0.5">{item}</span>
              </li>
            ))}
          </ol>

          <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {service.caveat}
          </div>

          <details className="mt-6 group">
            <summary className="cursor-pointer list-none flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-gray-900 select-none">
              <svg className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              Sample output
            </summary>
            <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-4 py-3 space-y-1.5">
              {service.sampleLines.map((line, i) => (
                <p key={i} className={`text-xs leading-5 ${line.startsWith("[") ? "text-gray-400 italic" : "text-gray-700"}`}>{line}</p>
              ))}
            </div>
          </details>
        </section>

        <aside className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-2 rounded-md bg-green-50 px-3 py-2 text-xs font-medium text-green-800">
            <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm.75 4.25a.75.75 0 0 0-1.5 0v3.5l2 2a.75.75 0 1 0 1.06-1.06l-1.56-1.56V5.25z"/>
            </svg>
            {service.deliverySla}
          </div>

          <h2 className="mt-5 text-base font-semibold text-gray-900">Work context</h2>
          {hasContext ? (
            <dl className="mt-4 space-y-3 text-sm">
              {context.tender && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Tender</dt>
                  <dd className="mt-1 text-gray-900">{context.tender}</dd>
                </div>
              )}
              {context.agency && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Agency</dt>
                  <dd className="mt-1 text-gray-900">{context.agency}</dd>
                </div>
              )}
              {context.pipelineItemId && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Pipeline item</dt>
                  <dd className="mt-1 text-gray-900">#{context.pipelineItemId}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="mt-3 text-sm leading-6 text-gray-600">
              No tender is attached yet. Open a matched tender from the dashboard or pipeline to carry its context into checkout.
            </p>
          )}

          <div className="mt-5 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-900">
            {service.intakePrompt}
          </div>

          <div className="mt-4">
            <ServiceIntakeForm
              service={service.slug}
              plan={service.tierSlug}
              pipelineItemId={context.pipelineItemId}
              tenderTitle={context.tender}
              agency={context.agency}
              docId={context.docId}
              label={service.cta}
            />
          </div>

          <div className="mt-5 border-t border-gray-100 pt-4">
            <Link href="/dashboard/services" className="text-xs font-semibold text-gray-500 hover:text-gray-900 underline">
              View all service paths
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
