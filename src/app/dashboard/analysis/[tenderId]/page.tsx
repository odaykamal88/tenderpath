"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

interface BidAnalysis {
  id: number;
  win_probability: number;
  recommendation: "Bid" | "No-Bid" | "Conditional";
  strength_areas: string[];
  gap_areas: string[];
  required_documents: string[];
  effort_estimate: "Low" | "Medium" | "High";
  key_risks: string[];
  next_steps: string[];
  created_at: string;
}

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };
}

function probabilityColor(p: number): string {
  if (p >= 65) return "text-green-600";
  if (p >= 40) return "text-amber-500";
  return "text-red-600";
}

function probabilityRingColor(p: number): string {
  if (p >= 65) return "border-green-500";
  if (p >= 40) return "border-amber-400";
  return "border-red-500";
}

function recommendationStyles(r: string): string {
  if (r === "Bid") return "bg-green-100 text-green-800 border-green-300";
  if (r === "No-Bid") return "bg-red-100 text-red-800 border-red-300";
  return "bg-amber-100 text-amber-800 border-amber-300";
}

function effortStyles(e: string): string {
  if (e === "Low") return "bg-blue-100 text-blue-700";
  if (e === "High") return "bg-orange-100 text-orange-700";
  return "bg-gray-100 text-gray-700";
}

export default function AnalysisPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const pipelineItemId = params.tenderId as string;
  const sessionId = searchParams.get("session_id");

  const [analysis, setAnalysis] = useState<BidAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const token = localStorage.getItem("tp_token");
      if (!token) {
        router.replace("/login?next=/dashboard/analysis/" + pipelineItemId);
        return;
      }

      try {
        // Check if analysis already exists
        const checkRes = await fetch(
          `/api/analysis/bid-no-bid?pipeline_item_id=${pipelineItemId}`,
          { headers: authHeaders() }
        );

        if (checkRes.ok) {
          const data = await checkRes.json();
          setAnalysis(data.analysis);
          setLoading(false);
          return;
        }

        // No existing analysis — need session_id from Stripe
        if (!sessionId) {
          setError("No analysis found. Please go back to the pipeline and run an analysis.");
          setLoading(false);
          return;
        }

        // Trigger analysis with verified payment
        const runRes = await fetch("/api/analysis/bid-no-bid", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            pipeline_item_id: Number(pipelineItemId),
            stripe_session_id: sessionId,
          }),
        });

        if (!runRes.ok) {
          const err = await runRes.json();
          setError(err.error ?? "Analysis failed. Please contact support.");
          setLoading(false);
          return;
        }

        const data = await runRes.json();
        setAnalysis(data.analysis);
      } catch {
        setError("Something went wrong. Please try again.");
      }

      setLoading(false);
    })();
  }, [pipelineItemId, sessionId, router]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <div className="w-8 h-8 border-2 border-gray-900 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-600">
          {sessionId ? "Running bid analysis — this may take 20–30 seconds…" : "Loading analysis…"}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-xl mx-auto mt-12 rounded-lg border border-red-200 bg-red-50 p-6">
        <p className="text-sm text-red-800 mb-4">{error}</p>
        <Link href="/dashboard/pipeline" className="text-sm text-gray-700 underline">
          ← Back to Pipeline
        </Link>
      </div>
    );
  }

  if (!analysis) return null;

  const prob = analysis.win_probability;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <Link href="/dashboard/pipeline" className="text-sm text-gray-500 hover:text-gray-700">
          ← Pipeline
        </Link>
      </div>

      {/* Score card */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 flex flex-col sm:flex-row items-center gap-6">
        {/* Win probability ring */}
        <div className={`flex-shrink-0 w-28 h-28 rounded-full border-8 ${probabilityRingColor(prob)} flex flex-col items-center justify-center`}>
          <span className={`text-3xl font-bold ${probabilityColor(prob)}`}>{prob}%</span>
          <span className="text-xs text-gray-500 mt-0.5">Win chance</span>
        </div>

        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`px-3 py-1 rounded-full border text-sm font-semibold ${recommendationStyles(analysis.recommendation)}`}>
              {analysis.recommendation}
            </span>
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${effortStyles(analysis.effort_estimate)}`}>
              {analysis.effort_estimate} effort
            </span>
          </div>
          <p className="text-xs text-gray-400">
            Generated {new Date(analysis.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
      </div>

      {/* Four sections */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Strengths */}
        <Section
          title="Strengths"
          icon="✓"
          iconClass="text-green-600"
          items={analysis.strength_areas}
          emptyMessage="No clear strengths identified."
          itemClass="text-gray-700"
          marker="text-green-500"
        />

        {/* Gaps */}
        <Section
          title="Gaps"
          icon="✗"
          iconClass="text-red-500"
          items={analysis.gap_areas}
          emptyMessage="No major gaps identified."
          itemClass="text-gray-700"
          marker="text-red-400"
        />

        {/* Required Documents */}
        <Section
          title="Required Documents"
          icon="📄"
          iconClass=""
          items={analysis.required_documents}
          emptyMessage="No specific documents listed."
          itemClass="text-gray-700"
          marker="text-gray-400"
        />

        {/* Next Steps */}
        <Section
          title="Next Steps"
          icon="→"
          iconClass="text-blue-600"
          items={analysis.next_steps}
          emptyMessage="No next steps generated."
          itemClass="text-gray-700"
          marker="text-blue-400"
          ordered
        />
      </div>

      {/* Key Risks */}
      {analysis.key_risks.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
          <h3 className="text-sm font-semibold text-amber-900 mb-3">Key Risks</h3>
          <ul className="space-y-1.5">
            {analysis.key_risks.map((risk, i) => (
              <li key={i} className="flex gap-2 text-sm text-amber-800">
                <span className="mt-0.5 flex-shrink-0">⚠</span>
                <span>{risk}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* CTA */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-900">Ready to build your proposal?</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Generate a full submission package with pre-filled documents.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Link
            href={`/pay?plan=proposal-draft&pipeline_item_id=${encodeURIComponent(pipelineItemId)}`}
            className="flex-shrink-0 px-5 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors text-center"
          >
            Generate proposal package
          </Link>
          <Link
            href={`/pay?plan=roster-fast-track&pipeline_item_id=${encodeURIComponent(pipelineItemId)}`}
            className="flex-shrink-0 px-5 py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:border-gray-400 transition-colors text-center"
          >
            Roster/LTA support
          </Link>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  iconClass,
  items,
  emptyMessage,
  itemClass,
  marker,
  ordered = false,
}: {
  title: string;
  icon: string;
  iconClass: string;
  items: string[];
  emptyMessage: string;
  itemClass: string;
  marker: string;
  ordered?: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-1.5">
        <span className={iconClass}>{icon}</span>
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400">{emptyMessage}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item, i) => (
            <li key={i} className={`flex gap-2 text-sm ${itemClass}`}>
              <span className={`mt-0.5 flex-shrink-0 ${marker}`}>
                {ordered ? `${i + 1}.` : "•"}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
