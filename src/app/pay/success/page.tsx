"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { TIERS } from "@/lib/pricing";

function SuccessContent() {
  const searchParams = useSearchParams();
  const plan = searchParams.get("plan");
  const tender = searchParams.get("tender");
  const agency = searchParams.get("agency");
  const pipelineItemId = searchParams.get("pipeline_item_id");
  const tier = TIERS.find((t) => t.slug === plan);

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-100">
        <div className="mx-auto max-w-xl px-6 flex h-14 items-center justify-between">
          <Link href="/" className="text-base font-semibold text-gray-900">
            Tender<span className="text-gold">Path</span>
          </Link>
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-900">
            Dashboard
          </Link>
        </div>
      </nav>

      <main className="mx-auto max-w-xl px-4 py-12">
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-700">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Payment received</h1>
          <p className="mt-2 text-sm text-gray-600">
            {tier
              ? `Your ${tier.name} purchase is confirmed.`
              : "Your TenderPath purchase is confirmed."}
          </p>

          {(tender || agency || pipelineItemId) && (
            <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-3">Work context</p>
              {tender && <p className="text-sm font-medium text-gray-900">{tender}</p>}
              <p className="mt-1 text-xs text-gray-500">
                {agency ?? "Agency not specified"}
                {pipelineItemId ? ` · Pipeline item #${pipelineItemId}` : ""}
              </p>
            </div>
          )}

          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">What happens next</p>
            <p className="mt-1 text-amber-800">
              We will review the tender context, confirm any missing documents, and move the work through the fulfillment queue.
            </p>
          </div>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <Link
              href="/dashboard/pipeline"
              className="rounded-xl bg-gray-900 px-5 py-3 text-center text-sm font-semibold text-white hover:bg-gray-700"
            >
              Back to pipeline
            </Link>
            <Link
              href="/dashboard/vault"
              className="rounded-xl border border-gray-200 px-5 py-3 text-center text-sm font-semibold text-gray-700 hover:border-gray-400"
            >
              Upload documents
            </Link>
          </div>
        </div>
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
