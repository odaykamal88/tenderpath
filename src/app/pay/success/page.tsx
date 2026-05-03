"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { TIERS } from "@/lib/pricing";

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";
const SERIF = "'Fraunces', 'Times New Roman', serif";

function SuccessContent() {
  const searchParams = useSearchParams();
  const plan = searchParams.get("plan");
  const tender = searchParams.get("tender");
  const agency = searchParams.get("agency");
  const pipelineItemId = searchParams.get("pipeline_item_id");
  const tier = TIERS.find((t) => t.slug === plan);

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#fafaf7" }}>
      <nav className="border-b border-stone-200/70 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto max-w-xl px-6 flex h-14 items-center justify-between">
          <Link
            href="/"
            className="text-[15px] font-semibold text-stone-900"
            style={{ fontFamily: SERIF }}
          >
            Tender<span style={{ color: "#ea580c" }}>·</span>Path
          </Link>
          <Link
            href="/dashboard"
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500 hover:text-stone-900 transition-colors"
            style={{ fontFamily: MONO }}
          >
            Dashboard →
          </Link>
        </div>
      </nav>

      <main className="mx-auto max-w-xl px-4 py-12">
        <div className="rounded-md border border-stone-200/70 bg-white p-7">
          {/* Status */}
          <div className="flex items-center gap-3 mb-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-emerald-300 bg-emerald-50/60">
              <svg
                className="h-5 w-5 text-emerald-700"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700"
              style={{ fontFamily: MONO }}
            >
              Payment received
            </div>
          </div>

          <h1
            className="text-[40px] leading-[1.05] font-medium text-stone-900 tracking-tight"
            style={{ fontFamily: SERIF, fontFeatureSettings: "'ss01'" }}
          >
            You&apos;re in.
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-stone-600">
            {tier
              ? `Your ${tier.name} purchase is confirmed.`
              : "Your TenderPath purchase is confirmed."}
          </p>

          {/* Work context */}
          {(tender || agency || pipelineItemId) && (
            <div className="mt-6 rounded-sm border-l-2 border-stone-300 bg-stone-50/60 px-4 py-3.5">
              <div
                className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400"
                style={{ fontFamily: MONO }}
              >
                Work context
              </div>
              {tender && (
                <p
                  className="mt-1.5 text-[14px] font-medium text-stone-900 leading-snug"
                  style={{ fontFamily: SERIF }}
                >
                  {tender}
                </p>
              )}
              <p
                className="mt-1 text-[11px] text-stone-500"
                style={{ fontFamily: MONO }}
              >
                {agency ?? "Agency not specified"}
                {pipelineItemId ? `  ·  Pipeline item #${pipelineItemId}` : ""}
              </p>
            </div>
          )}

          {/* What happens next */}
          <div className="mt-6 rounded-sm border-l-2 border-orange-600 bg-orange-50/40 px-4 py-3.5">
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-700"
              style={{ fontFamily: MONO }}
            >
              What happens next
            </div>
            <p className="mt-1 text-[13px] text-stone-700 leading-relaxed">
              We&apos;ll review the tender context, confirm any missing documents, and move the work through the fulfillment queue. You&apos;ll receive an email update at every stage.
            </p>
          </div>

          {/* Actions */}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <Link
              href="/dashboard/work-orders"
              className="rounded-sm bg-stone-900 px-4 py-2.5 text-center text-[12.5px] font-semibold text-white hover:bg-stone-800 transition-colors"
            >
              View work orders →
            </Link>
            <Link
              href="/dashboard/pipeline"
              className="rounded-sm border border-stone-300 px-4 py-2.5 text-center text-[12.5px] font-semibold text-stone-700 hover:border-stone-700 hover:text-stone-900 transition-colors"
            >
              Back to pipeline
            </Link>
            <Link
              href="/dashboard/vault"
              className="rounded-sm border border-stone-300 px-4 py-2.5 text-center text-[12.5px] font-semibold text-stone-700 hover:border-stone-700 hover:text-stone-900 transition-colors"
            >
              Upload documents
            </Link>
          </div>
        </div>

        <p
          className="mt-5 text-center text-[10.5px] font-semibold uppercase tracking-[0.18em] text-stone-400"
          style={{ fontFamily: MONO }}
        >
          Receipt sent to your email · Ref will appear in Work orders
        </p>
      </main>
    </div>
  );
}

export default function PaySuccessPage() {
  return (
    <Suspense>
      <SuccessContent />
    </Suspense>
  );
}
