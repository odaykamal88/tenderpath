"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type ServiceSlug = "bid-no-bid" | "digest" | "proposal" | "lta-roster";

interface ServiceActionProps {
  service: ServiceSlug;
  pipelineItemId?: string | null;
  tenderTitle?: string | null;
  checkoutHref: string;
  label: string;
}

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

  if (service !== "bid-no-bid") {
    return (
      <Link
        href={checkoutHref}
        className="inline-flex items-center justify-center rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700"
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
          className="inline-flex items-center justify-center rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700"
        >
          Select a tender in pipeline
        </Link>
        <p className="mt-2 text-xs text-gray-500">
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
      const checkRes = await fetch(
        `/api/analysis/bid-no-bid?pipeline_item_id=${encodeURIComponent(pipelineItemId)}`,
        { headers: authHeaders() },
      );
      if (checkRes.ok) {
        router.push(`/dashboard/analysis/${pipelineItemId}`);
        return;
      }

      const checkoutRes = await fetch("/api/analysis/bid-no-bid/checkout", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          pipeline_item_id: Number(pipelineItemId),
          tender_title: tenderTitle ?? undefined,
        }),
      });
      const data = (await checkoutRes.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!checkoutRes.ok || !data.url) {
        setError(data.error ?? "Could not start bid/no-bid checkout.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Could not start bid/no-bid checkout. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={startBidNoBid}
        disabled={loading}
        className="inline-flex items-center justify-center rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {loading ? "Checking analysis..." : label}
      </button>
      {error && (
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
