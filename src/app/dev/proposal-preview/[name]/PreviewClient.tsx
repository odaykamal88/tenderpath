"use client";

/**
 * PreviewClient — client child of /dev/proposal-preview/[name].
 *
 * Receives the parsed fixture output from the server parent and renders
 * the SAME B1-B5 components the production dashboard page uses. Reusing
 * them by import (rather than copy-pasting) means the dev preview stays
 * in lockstep with the real page without a separate maintenance burden.
 *
 * The components are exported from the dashboard page file directly —
 * see the inline comment on `adaptScored` for the rationale.
 */

import { useMemo } from "react";
import {
  adaptScored,
  ComplianceVerdict,
  RubricScore,
  RoutedGaps,
  DraftBody,
  ExportRow,
  type ProposalOutputJSON,
} from "@/app/dashboard/proposals/[workOrderId]/scored-view";
import { MONO, SERIF } from "@/lib/brand/tokens";

export default function PreviewClient({
  name,
  output,
}: {
  name: string;
  output: ProposalOutputJSON;
}) {
  const scored = useMemo(() => adaptScored(output), [output]);

  if (!scored) {
    return (
      <div className="min-h-screen bg-stone-50 px-8 py-10 max-w-4xl mx-auto">
        <h1 className="text-[24px] font-medium text-stone-900" style={{ fontFamily: SERIF }}>
          Fixture has no scored fields
        </h1>
        <p className="mt-3 text-[13.5px] text-stone-700">
          The fixture at <code className="rounded bg-stone-100 px-1.5 py-0.5">{name}</code> is missing
          <code className="ml-1 rounded bg-stone-100 px-1.5 py-0.5">output.score</code> with
          <code className="ml-1 rounded bg-stone-100 px-1.5 py-0.5">lotResults</code> +
          <code className="ml-1 rounded bg-stone-100 px-1.5 py-0.5">routedGaps</code> arrays. Re-run{" "}
          <code className="rounded bg-stone-100 px-1.5 py-0.5">scripts/sprint6-acceptance.ts</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Dev preview banner — makes it visually obvious this is NOT the
          real dashboard. Sticks to the top so it's hard to miss in
          screenshots. */}
      <div className="bg-amber-100 border-b border-amber-300 px-6 py-2.5">
        <div className="max-w-4xl mx-auto flex items-baseline justify-between gap-3 flex-wrap">
          <div className="flex items-baseline gap-3">
            <span
              className="rounded-sm bg-amber-700 px-2 py-1 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-white"
              style={{ fontFamily: MONO }}
            >
              Dev preview
            </span>
            <span className="text-[12.5px] text-amber-900" style={{ fontFamily: MONO }}>
              fixture · {name}
            </span>
          </div>
          <span
            className="text-[10.5px] uppercase tracking-[0.12em] text-amber-800"
            style={{ fontFamily: MONO }}
          >
            NOT the real dashboard · NODE_ENV={process.env.NODE_ENV ?? "unknown"}
          </span>
        </div>
      </div>

      <div className="px-8 py-8 max-w-4xl mx-auto">
        <div className="mb-7">
          <div className="flex items-center gap-3 text-[11px] text-stone-500">
            <span
              className="font-semibold uppercase tracking-[0.18em] text-stone-400"
              style={{ fontFamily: MONO }}
            >
              Sprint 6 · B1–B5 preview
            </span>
          </div>
          <h1
            className="mt-1 text-[44px] leading-[1.05] font-medium text-stone-900 tracking-tight"
            style={{ fontFamily: SERIF, fontFeatureSettings: "'ss01'" }}
          >
            Proposal package
          </h1>
        </div>

        <ComplianceVerdict score={scored.score} />
        <div className="space-y-5">
          <RubricScore score={scored.score} rubricLabels={scored.rubricLabels} />
          <RoutedGaps score={scored.score} />
          <DraftBody draft={scored.draft} rubricLabels={scored.rubricLabels} />
          <ExportRow
            workOrderId="dev-preview"
            pdfUrl={null}
            revisionHistory={scored.revisionHistory}
          />
        </div>
      </div>
    </div>
  );
}
