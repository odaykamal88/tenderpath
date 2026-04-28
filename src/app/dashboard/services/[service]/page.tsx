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
      "Complete checkout if an analysis does not already exist",
      "Review the decision memo in the dashboard analysis view",
    ],
    caveat: "Best when the tender has enough requirements or source detail for a grounded recommendation.",
    cta: "Start bid/no-bid",
  },
  digest: {
    slug: "digest",
    tierSlug: "grants-tenders-matching",
    eyebrow: "Ongoing matching",
    title: "Weekly matched digest",
    lead: "Keep the sourcing engine running after assessment. Tenderpath sends a weekly shortlist of tenders and grants matched to the company profile, then routes the best ones back into the dashboard workflow.",
    output: [
      "5-10 scored opportunities per week",
      "Deadline and agency context",
      "Fit reasons and caveats",
      "Reminder-ready shortlist for the dashboard workflow",
    ],
    workflow: [
      "Subscribe with the company account email",
      "Tenderpath keeps monitoring matched sources against the latest assessment profile",
      "Strong matches are prepared for dashboard review and weekly email follow-up",
      "Use dashboard feedback to tune what stays relevant",
    ],
    caveat: "Digest quality depends on a current company profile and clear preference feedback.",
    cta: "Subscribe to digest",
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
      "Complete checkout with the work context attached",
      "Tenderpath prepares the package for review and final sign-off",
    ],
    caveat: "This does not submit on your behalf unless separately agreed; it prepares the working package.",
    cta: "Start proposal package",
  },
  "lta-roster": {
    slug: "lta-roster",
    tierSlug: "roster-fast-track",
    eyebrow: "Eligibility and readiness",
    title: "LTA / roster readiness",
    lead: "Use this when agency registration or long-term agreement readiness is the bottleneck. Tenderpath prepares the vendor-facing package for the target agency.",
    output: [
      "Agency-specific readiness checklist",
      "Vendor registration document pack",
      "Capability statement",
      "Submission and follow-up support",
    ],
    workflow: [
      "Confirm the agency or roster target",
      "Complete checkout with any tender context attached",
      "Tenderpath prepares the registration package and follow-up plan",
    ],
    caveat: "Roster approval remains with the agency; this service focuses on readiness, packaging, and submission support.",
    cta: "Start roster readiness",
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
        </section>

        <aside className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-base font-semibold text-gray-900">Work context</h2>
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

          <div className="mt-5">
            <ServiceIntakeForm
              service={service.slug}
              plan={service.tierSlug}
              pipelineItemId={context.pipelineItemId}
              tenderTitle={context.tender}
              agency={context.agency}
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
