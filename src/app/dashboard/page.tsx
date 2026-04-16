"use client";

import Link from "next/link";

export default function DashboardOverview() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
      <p className="mt-1 text-sm text-gray-600">
        Track your tenders from match to award, and keep compliance docs ready.
      </p>

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
