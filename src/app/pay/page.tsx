"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { TIERS, isComingSoonTier } from "@/lib/pricing";
import { isSubmissionCode, submissionType, type SubmissionCode } from "@/lib/workbench/pricing";
import { CheckoutCard } from "@/components/checkout/CheckoutCard";

const MONO = "var(--font-jetbrains), ui-monospace, Menlo, monospace";
const SERIF = "var(--font-fraunces), Georgia, serif";

const SUPPORT_EMAIL = "info@tenderpath.me";

interface PayContext {
  tender: string | null;
  agency: string | null;
  pipelineItemId: string | null;
  workOrderId: string | null;
  submissionType: string | null;
  /** Submissions-workflow order attached to this checkout (EOI/RFQ/ITB/RFP wizard). */
  submissionOrderId: string | null;
}

interface FulfillmentReadiness {
  mode: "self_serve" | "human_review" | "blocked";
  payment_allowed: boolean;
  auto_fulfill_allowed: boolean;
  score_0_10: number | null;
  missing_inputs: string[];
  warnings: string[];
  code: string | null;
  message: string;
}

/** Server-resolved price for a submission checkout (EOI/RFQ/ITB/RFP). Mirrors
 *  exactly what /api/pay/checkout charges, so the summary never disagrees with
 *  the card total. */
interface SubmissionPricing {
  code: string;
  name: string;
  price: number;
  period: string;
  perType: boolean;
}

function authHeaders(extra: HeadersInit = {}): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token ? { ...extra, authorization: `Bearer ${token}` } : extra;
}

/* ── Readiness notice ──────────────────────────────────────────────────── */

function ReadinessCard({ readiness }: { readiness: FulfillmentReadiness | null }) {
  if (!readiness || readiness.mode === "self_serve") return null;
  const blocked = !readiness.payment_allowed;
  return (
    <div className={`rounded-none border-l-2 px-3.5 py-3 text-[12px] leading-relaxed ${
      blocked ? "border-[#9c2a2a] bg-[#f6e9e9]/50 text-[#7a2020]" : "border-[#b3691a] bg-[#f7efe0]/60 text-[#7a4711]"
    }`}>
      <div
        className="text-[10px] font-semibold uppercase tracking-[0.18em]"
        style={{ fontFamily: MONO }}
      >
        Fulfillment readiness · {readiness.mode.replace(/_/g, " ")}
      </div>
      <p className="mt-1">{readiness.message}</p>
      {readiness.score_0_10 != null && (
        <p className="mt-1 font-semibold tabular-nums" style={{ fontFamily: MONO }}>
          Source score · {readiness.score_0_10}/10
        </p>
      )}
      {readiness.missing_inputs.length > 0 && (
        <ul className="mt-2 space-y-1">
          {readiness.missing_inputs.slice(0, 5).map((item) => (
            <li key={item}>Missing: {item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Context card ──────────────────────────────────────────────────────── */

function ContextCard({ context }: { context: PayContext }) {
  if (!context.tender && !context.agency && !context.pipelineItemId && !context.workOrderId) return null;
  return (
    <div className="rounded-none border border-[#d8d1bf]/70 bg-white p-5">
      <div
        className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8c8676] mb-3"
        style={{ fontFamily: MONO }}
      >
        Work context
      </div>
      <div className="space-y-3">
        {context.tender && (
          <div>
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6b6557]"
              style={{ fontFamily: MONO }}
            >
              Tender
            </div>
            <p
              className="mt-0.5 text-[14px] font-medium text-[#0f1620] leading-snug"
              style={{ fontFamily: SERIF }}
            >
              {context.tender}
            </p>
          </div>
        )}
        {context.agency && (
          <div>
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6b6557]"
              style={{ fontFamily: MONO }}
            >
              Agency
            </div>
            <p className="mt-0.5 text-[13px] text-[#2b3543]">{context.agency}</p>
          </div>
        )}
        {(context.pipelineItemId || context.workOrderId) && (
          <p
            className="text-[11px] text-[#6b6557]"
            style={{ fontFamily: MONO }}
          >
            {context.pipelineItemId ? `Pipeline item · #${context.pipelineItemId}` : null}
            {context.pipelineItemId && context.workOrderId ? "  ·  " : null}
            {context.workOrderId ? `Work order · #${context.workOrderId}` : null}
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

function PayPage() {
  const searchParams = useSearchParams();
  const planSlug = searchParams.get("plan");
  const context: PayContext = {
    tender: searchParams.get("tender"),
    agency: searchParams.get("agency"),
    pipelineItemId: searchParams.get("pipeline_item_id"),
    workOrderId: searchParams.get("work_order_id"),
    submissionType: searchParams.get("submission_type"),
    submissionOrderId: searchParams.get("submission_order_id"),
  };
  const [selectedSlug, setSelectedSlug] = useState<string | null>(planSlug);
  const [readiness, setReadiness] = useState<FulfillmentReadiness | null>(null);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [freeEligible, setFreeEligible] = useState(false);
  const [submissionPricing, setSubmissionPricing] = useState<SubmissionPricing | null>(null);

  // When a user arrives from a service intake (e.g. the submission wizard or a
  // subscribe CTA) the plan is already chosen — render a compact summary card
  // instead of the tier grid.
  const planPrelocked = Boolean(planSlug);
  // The new flat-subscription slugs aren't TIERS entries; give them a display
  // shape so the checkout shows a locked summary (not the tier grid).
  const EXTRA_PLAN_DISPLAY: Record<string, { name: string; price: string; billingPeriod: string; featured: boolean }> = {
    "sub-monthly": { name: "Workbench subscription", price: "$49", billingPeriod: "/mo", featured: false },
    "sub-annual": { name: "Workbench subscription", price: "$324", billingPeriod: "/yr", featured: true },
  };
  const preselectedTier = planSlug
    ? (TIERS.find((t) => t.slug === planSlug) ?? EXTRA_PLAN_DISPLAY[planSlug] ?? null)
    : null;

  // Submission checkouts arrive as ?plan=proposal-draft&submission_type=RFP — so
  // the raw plan would show the generic "Proposal Draft · $299". When a valid
  // submission type is present, show the actual product (e.g. "Request for
  // Proposal · $349"). The price shown is the catalog rate until the readiness
  // endpoint confirms the authoritative figure, so it can never disagree with
  // the card total.
  const submissionCode: SubmissionCode | null = isSubmissionCode(context.submissionType)
    ? (context.submissionType.toUpperCase() as SubmissionCode)
    : null;
  const summary = submissionCode
    ? {
        name: submissionType(submissionCode).name,
        price: `$${submissionPricing?.price ?? submissionType(submissionCode).price}`,
        billingPeriod: submissionPricing?.period ?? "/submission",
        featured: false,
      }
    : preselectedTier
      ? {
          name: preselectedTier.name,
          price: preselectedTier.price,
          billingPeriod: preselectedTier.billingPeriod,
          featured: preselectedTier.featured,
        }
      : null;

  useEffect(() => {
    if (!selectedSlug) return;
    let cancelled = false;
    const params = new URLSearchParams({ plan: selectedSlug });
    if (context.workOrderId) params.set("work_order_id", context.workOrderId);
    // Pass the submission-workflow context so the readiness endpoint can skip
    // the proposal-draft gate (the wizard already gated intake) and return the
    // authoritative per-type price — keeping the pay UI and checkout in agreement.
    if (context.submissionOrderId) params.set("submission_order_id", context.submissionOrderId);
    if (context.submissionType) params.set("submission_type", context.submissionType);
    fetch(`/api/pay/readiness?${params.toString()}`, { headers: authHeaders() })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          readiness?: FulfillmentReadiness;
          free_submission_eligible?: boolean;
          pricing?: SubmissionPricing | null;
          error?: string;
        };
        if (!res.ok || !data.readiness) throw new Error(data.error ?? "Could not check fulfillment readiness.");
        if (!cancelled) {
          setReadiness(data.readiness);
          setFreeEligible(Boolean(data.free_submission_eligible));
          setSubmissionPricing(data.pricing ?? null);
          setReadinessError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setReadiness(null);
          setFreeEligible(false);
          setSubmissionPricing(null);
          setReadinessError(err instanceof Error ? err.message : "Could not check fulfillment readiness.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [context.workOrderId, context.submissionOrderId, context.submissionType, selectedSlug]);

  // Product-wide "coming soon" gate (e.g. Roster/LTA). When the selected plan is
  // held back, disabledReason disables the card button. The /api/pay/checkout
  // route is the hard server-side backstop.
  const planComingSoon = isComingSoonTier(selectedSlug);
  const disabledReason = planComingSoon
    ? "This service is coming soon — checkout is paused. We'll announce when it opens."
    : readiness && !readiness.payment_allowed
      ? readiness.message
      : undefined;

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#f6f3ec" }}>
      {/* Nav */}
      <nav className="border-b border-[#d8d1bf]/70 bg-white/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="mx-auto max-w-lg px-5 sm:px-6 flex h-14 items-center justify-between">
          <Link
            href="/"
            className="text-[15px] font-semibold text-[#0f1620]"
            style={{ fontFamily: SERIF }}
          >
            Tender<span style={{ color: "#9c6b1f" }}>·</span>Path
          </Link>
          <Link
            href="/dashboard"
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b6557] hover:text-[#0f1620] transition-colors"
            style={{ fontFamily: MONO }}
          >
            ← Dashboard
          </Link>
        </div>
      </nav>

      <div className="mx-auto max-w-lg px-4 sm:px-5 py-8 sm:py-10 space-y-5">
        {/* Header */}
        <div className="px-1">
          <div
            className="text-[10.5px] sm:text-[11px] font-semibold uppercase tracking-[0.16em] sm:tracking-[0.18em] text-[#8c8676]"
            style={{ fontFamily: MONO }}
          >
            Checkout · payment
          </div>
          <h1
            className="mt-1 text-[30px] sm:text-[36px] leading-[1.05] font-medium text-[#0f1620] tracking-tight"
            style={{ fontFamily: SERIF, fontFeatureSettings: "'ss01'" }}
          >
            Complete your purchase
          </h1>
          <p className="mt-1.5 text-[13px] text-[#6b6557]">
            Review your order and pay securely by card.
          </p>
        </div>

        <ContextCard context={context} />
        {planComingSoon && (
          <div className="rounded-none border-l-2 border-[#b3691a] bg-[#f7efe0]/80 px-4 py-3.5">
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#b3691a]"
              style={{ fontFamily: MONO }}
            >
              Coming soon
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-[#7a4711]">
              {preselectedTier?.name ?? "This service"} isn&rsquo;t available for purchase yet — we&rsquo;ve paused checkout. Explore the other services in the meantime, and we&rsquo;ll announce when this one opens.
            </p>
          </div>
        )}
        {freeEligible && !planComingSoon && (
          <div className="rounded-none border-l-2 border-[#1f6b3d] bg-[#f3f8f4]/80 px-4 py-3.5">
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#1f6b3d]"
              style={{ fontFamily: MONO }}
            >
              First submission · on us
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-[#174d2b]">
              Your first proposal submission is free while you&rsquo;re on trial — no card needed. Claim it below and we&rsquo;ll start assembling it right away.
            </p>
          </div>
        )}
        {!planComingSoon && <ReadinessCard readiness={readiness} />}
        {!planComingSoon && readinessError && (
          <div className="rounded-none border-l-2 border-[#b3691a] bg-[#f7efe0]/60 px-3.5 py-3 text-[12px] text-[#8a5114] leading-relaxed">
            {readinessError}
          </div>
        )}

        {/* Step 1 — plan. A compact summary when the plan is already chosen,
            else the tier grid for a bare /pay visit. */}
        {planPrelocked && summary ? (
          <div className="rounded-none border border-[#d8d1bf]/70 bg-white p-4 sm:p-5">
            <div className="flex items-baseline gap-2.5 mb-3">
              <span
                className="text-[10px] font-semibold tabular-nums text-[#8c8676]"
                style={{ fontFamily: MONO }}
              >
                01
              </span>
              <h2
                className="text-[13px] sm:text-[15px] font-semibold uppercase tracking-[0.13em] sm:tracking-[0.15em] text-[#2b3543]"
                style={{ fontFamily: MONO }}
              >
                Your selected service
              </h2>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p
                  className="text-[14px] font-medium text-[#0f1620] leading-snug truncate"
                  style={{ fontFamily: SERIF }}
                >
                  {summary.name}
                </p>
                {summary.featured && (
                  <span
                    className="inline-block mt-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[#9c6b1f]"
                    style={{ fontFamily: MONO }}
                  >
                    · Popular ·
                  </span>
                )}
              </div>
              <p
                className="text-[22px] font-medium text-[#0f1620] tabular-nums tracking-tight shrink-0"
                style={{ fontFamily: SERIF }}
              >
                {summary.price}
                <span
                  className="text-[10px] font-medium text-[#6b6557] ml-1"
                  style={{ fontFamily: MONO }}
                >
                  {summary.billingPeriod}
                </span>
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-none border border-[#d8d1bf]/70 bg-white p-4 sm:p-5">
            <div className="flex items-baseline gap-2.5 mb-4">
              <span
                className="text-[10px] font-semibold tabular-nums text-[#8c8676]"
                style={{ fontFamily: MONO }}
              >
                01
              </span>
              <h2
                className="text-[13px] sm:text-[15px] font-semibold uppercase tracking-[0.13em] sm:tracking-[0.15em] text-[#2b3543]"
                style={{ fontFamily: MONO }}
              >
                Select your plan
              </h2>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {TIERS.map((t) => (
                <button
                  key={t.slug}
                  onClick={() => setSelectedSlug(t.slug)}
                  className={`rounded-none border p-3.5 text-left transition-colors ${
                    selectedSlug === t.slug
                      ? "border-[#0f1620] bg-[#ece6d5]/40"
                      : "border-[#d8d1bf]/70 hover:border-[#8c8676] bg-white"
                  }`}
                >
                  {t.featured && (
                    <span
                      className="inline-block text-[9px] font-semibold uppercase tracking-[0.18em] text-[#9c6b1f] mb-1.5"
                      style={{ fontFamily: MONO }}
                    >
                      · Popular ·
                    </span>
                  )}
                  <p
                    className="text-[12px] font-medium text-[#2b3543] leading-snug"
                    style={{ fontFamily: MONO }}
                  >
                    {t.name}
                  </p>
                  <p
                    className="mt-1.5 text-[20px] font-medium text-[#0f1620] tabular-nums tracking-tight"
                    style={{ fontFamily: SERIF }}
                  >
                    {t.price}
                    <span
                      className="text-[10px] font-medium text-[#6b6557] ml-1"
                      style={{ fontFamily: MONO }}
                    >
                      {t.billingPeriod}
                    </span>
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2 — pay by card */}
        <div className="rounded-none border border-[#d8d1bf]/70 bg-white p-4 sm:p-5">
          <div className="flex items-baseline gap-2.5 mb-4">
            <span
              className="text-[10px] font-semibold tabular-nums text-[#8c8676]"
              style={{ fontFamily: MONO }}
            >
              02
            </span>
            <h2
              className="text-[13px] sm:text-[15px] font-semibold uppercase tracking-[0.13em] sm:tracking-[0.15em] text-[#2b3543]"
              style={{ fontFamily: MONO }}
            >
              {freeEligible ? "Claim your free submission" : "Pay by card"}
            </h2>
          </div>
          {/* key={selectedSlug} forces a remount when the plan changes — clears
              stale error state and tears down any half-mounted Stripe iframe. */}
          <CheckoutCard key={selectedSlug ?? "no-plan"} plan={selectedSlug} context={context} disabledReason={disabledReason} freeEligible={freeEligible} />
          <p className="mt-3 text-[11px] leading-relaxed text-[#8c8676]" style={{ fontFamily: MONO }}>
            Payments are processed securely by Stripe. Questions?{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-2 hover:text-[#2b3543]">
              {SUPPORT_EMAIL}
            </a>
          </p>
        </div>
      </div>

      <footer className="py-7 text-center">
        <p
          className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#8c8676]"
          style={{ fontFamily: MONO }}
        >
          © {new Date().getFullYear()} Tender·Path ·{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="underline underline-offset-2 hover:text-[#2b3543]"
          >
            {SUPPORT_EMAIL}
          </a>
        </p>
      </footer>
    </div>
  );
}

export default function PayPageWrapper() {
  return (
    <Suspense>
      <PayPage />
    </Suspense>
  );
}
