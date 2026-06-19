"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckoutCard, type CheckoutContext } from "@/components/checkout/CheckoutCard";

type ServiceSlug = "bid-no-bid" | "digest" | "proposal" | "lta-roster";

interface ServiceActionProps {
  service: ServiceSlug;
  pipelineItemId?: string | null;
  tenderTitle?: string | null;
  checkoutHref: string;
  label: string;
}

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };
}

export default function ServiceAction({
  service,
  pipelineItemId,
  tenderTitle,
  checkoutHref,
  label,
}: ServiceActionProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Once the "already analyzed?" check clears, reveal the shared embedded
  // checkout inline (no hop to a separate hosted Stripe page).
  const [embed, setEmbed] = useState<CheckoutContext | null>(null);

  if (service !== "bid-no-bid") {
    return (
      <Link
        href={checkoutHref}
        className="inline-flex w-full items-center justify-center rounded-sm bg-ink px-4 py-3 text-[13px] font-semibold text-white hover:bg-ink transition-colors"
      >
        {label}
      </Link>
    );
  }

  if (!pipelineItemId) {
    return (
      <div>
        <Link
          href="/dashboard/pipeline"
          className="inline-flex w-full items-center justify-center rounded-sm bg-ink px-4 py-3 text-[13px] font-semibold text-white hover:bg-ink transition-colors"
        >
          Select a tender in pipeline →
        </Link>
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
          Bid/no-bid analysis needs a pipeline tender so the recommendation can use your saved match evidence.
        </p>
      </div>
    );
  }

  async function startBidNoBid() {
    if (!pipelineItemId) return;
    setLoading(true);
    setError(null);

    try {
      // If the analysis already exists, skip payment and open it directly.
      const checkRes = await fetch(
        `/api/analysis/bid-no-bid?pipeline_item_id=${encodeURIComponent(pipelineItemId)}`,
        { headers: authHeaders() },
      );
      if (checkRes.ok) {
        router.push(`/dashboard/analysis/${pipelineItemId}`);
        return;
      }

      // Otherwise mount the shared embedded checkout inline. It posts to the
      // unified /api/pay/checkout (plan=bid-no-bid, pipeline-item anchored, no
      // work order) and, on payment, returns to /dashboard/analysis/{id} where
      // the analysis is generated — replacing the old hosted-redirect route.
      setEmbed({
        tender: tenderTitle ?? null,
        agency: null,
        pipelineItemId,
        workOrderId: null,
        submissionType: null,
        submissionOrderId: null,
      });
    } catch {
      setError("Could not start bid/no-bid checkout. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (embed) {
    return (
      <div>
        <div
          className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.15em] text-ink-3"
          style={{ fontFamily: MONO }}
        >
          Secure payment
        </div>
        <CheckoutCard autoStart plan="bid-no-bid" context={embed} />
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={startBidNoBid}
        disabled={loading}
        className="inline-flex w-full items-center justify-center rounded-sm bg-ink px-4 py-3 text-[13px] font-semibold text-white hover:bg-ink transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? (
          <>
            <span
              className="mr-2 h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white"
              aria-hidden
            />
            Checking analysis…
          </>
        ) : (
          label
        )}
      </button>
      {error && (
        <p
          className="mt-2 rounded-sm border-l-2 border-red-600 bg-red-50/40 px-3 py-2 text-[11.5px] text-red-700"
          style={{ fontFamily: MONO }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
