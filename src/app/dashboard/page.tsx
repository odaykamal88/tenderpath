"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface BridgeData {
  assessment_id: number;
  readiness_score: number;
  company_name: string;
  matched_tenders: Array<{
    title: string;
    agency: string;
    deadline: string | null;
    estimated_value: string | null;
    fit_score?: number;
  }>;
  gaps: Array<{ gap: string; severity: string }>;
}

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };
}

export default function DashboardOverview() {
  const [bridge, setBridge] = useState<BridgeData | null>(null);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem("tp_bridge");
    if (!raw) return;
    try {
      const data: BridgeData = JSON.parse(raw);
      setBridge(data);
      seedPipeline(data);
    } catch {
      localStorage.removeItem("tp_bridge");
    }
  }, []);

  async function seedPipeline(data: BridgeData) {
    try {
      await Promise.all(
        data.matched_tenders.map((t) =>
          fetch("/api/dashboard/pipeline", {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({
              tender_title: t.title,
              tender_agency: t.agency,
              tender_deadline: t.deadline ?? undefined,
              tender_value: t.estimated_value ?? undefined,
              fit_score: t.fit_score ?? data.readiness_score,
              stage: "matched",
            }),
          })
        )
      );
      localStorage.removeItem("tp_bridge");
      setSeeded(true);
    } catch {
      // silently fail — pipeline still usable
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
      <p className="mt-1 text-sm text-gray-600">
        Track your tenders from match to award, and keep compliance docs ready.
      </p>

      {(bridge || seeded) && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-5 py-4">
          <div className="text-sm font-semibold text-green-800">
            Welcome{bridge?.company_name ? `, ${bridge.company_name}` : ""}!
          </div>
          <p className="text-sm text-green-700 mt-0.5">
            {seeded
              ? "Your matched tenders have been added to your pipeline. Head over to the Kanban board to start tracking."
              : "Seeding your pipeline with matched tenders…"}
          </p>
          {bridge && bridge.gaps.length > 0 && (
            <p className="text-xs text-green-600 mt-2">
              Tip: Upload documents to the Vault to close your top compliance gaps.
            </p>
          )}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          href="/dashboard/pipeline"
          className="block rounded-lg border border-gray-200 bg-white p-6 hover:border-gray-900 transition"
        >
          <div className="text-sm uppercase tracking-wide text-gray-500">Pipeline</div>
          <div className="mt-2 text-lg font-medium text-gray-900">
            Tender Kanban Board
          </div>
          <div className="mt-1 text-sm text-gray-600">
            Matched → Evaluating → Preparing → Submitted → Won / Lost
          </div>
        </Link>

        <Link
          href="/dashboard/vault"
          className="block rounded-lg border border-gray-200 bg-white p-6 hover:border-gray-900 transition"
        >
          <div className="text-sm uppercase tracking-wide text-gray-500">Vault</div>
          <div className="mt-2 text-lg font-medium text-gray-900">Document Vault</div>
          <div className="mt-1 text-sm text-gray-600">
            Certifications, financials, CVs, past performance — with expiry alerts.
          </div>
        </Link>
      </div>
    </div>
  );
}
