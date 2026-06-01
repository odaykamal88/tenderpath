"use client";

/**
 * dashboard/proposals/[workOrderId]/page.tsx — the $299 proposal output page.
 *
 * Sprint 6 (proposal-output-ux.md PART B + PART C): repurposed to consume the
 * new scoring-engine emit shape. Information hierarchy:
 *
 *   B1  Compliance verdict (TOP, most prominent) — passesGating +
 *       triggered disqualifiers with plain rule + SourceRef
 *   B2  Rubric score — estimatedTotal / achievableTotal + per-criterion
 *       breakdown (score, confidence, mechanicalConfidence, claim counts,
 *       weaknesses, missingEvidence)
 *   B3  Routed gaps — grouped by paid SKU with CTAs (Sprint 4's
 *       gap-routing module is the source of truth)
 *   B4  Draft body — one section per criterion with inline provenance
 *       badges on every claim (Sprint 2-5 DraftSection.claims)
 *   B5  Export — through pdfDocs.tsx renderScoredDraftPdf
 *
 * All five rendering components + the runtime adapter live in `./scored-view`
 * so the dev preview at /dev/proposal-preview/[name] can reuse them without
 * tripping Next.js's page-file export allow-list (which forbids named exports
 * other than `default`, metadata, viewport, etc.).
 *
 * Legacy packages (without `output.score`) render in a fallback path
 * (LegacyView, below) that preserves the existing 5-section narrative
 * with an upgrade banner pointing to Sprint 6b lazy-re-run wiring.
 *
 * Per readiness-output-ux.md C4: NO persistent footer disclaimer — the
 * score + flagged gaps + provenance ARE the expectation-setting
 * (proposal-output-ux.md C1). Legal disclaimer lives in T&C only (C3).
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { MONO, SERIF } from "@/lib/brand/tokens";
import {
  adaptScored,
  ComplianceVerdict,
  RubricScore,
  RoutedGaps,
  DraftBody,
  ExportRow,
  Section,
  type ProposalOutputJSON,
} from "./scored-view";

// ============================================================================
// Page-only shapes (everything else lives in ./scored-view)
// ============================================================================

interface ProposalPackage {
  id: number;
  plan: string;
  tender_title: string | null;
  agency: string | null;
  output: ProposalOutputJSON;
  created_at: string;
  generation_status?: string | null;
  error_message?: string | null;
  pdf_url?: string | null;
}

type Stage = "loading" | "generating" | "ready" | "error";

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };
}

// ============================================================================
// Legacy-package fallback (preserved — renders when output.score is absent)
// ============================================================================

function LegacyView({
  output,
  onUpgrade,
  upgradeBusy,
}: {
  output: ProposalOutputJSON;
  onUpgrade?: () => void;
  upgradeBusy?: boolean;
}) {
  return (
    <div className="space-y-5">
      <div className="mb-2 rounded-md border-l-2 border-amber-600 bg-amber-50/40 p-4">
        <div
          className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-800"
          style={{ fontFamily: MONO }}
        >
          Previous-format proposal
        </div>
        <p className="mt-1.5 text-[13px] text-stone-700 leading-relaxed">
          This package was generated under the previous format. The scored-draft format adds:
          compliance verdict with source-cited disqualifiers, per-criterion rubric scoring with
          inline provenance, and per-criterion findings — what to address, where to upload
          evidence, and how to push the score before submission.
        </p>
        <button
          type="button"
          onClick={onUpgrade}
          disabled={!onUpgrade || upgradeBusy}
          className="mt-3 rounded-sm bg-stone-900 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-stone-800 transition-colors disabled:bg-stone-300 disabled:text-stone-600 disabled:cursor-not-allowed"
          style={{ fontFamily: MONO }}
        >
          {upgradeBusy ? "Upgrading…" : "Upgrade to scored draft →"}
        </button>
      </div>

      <Section index="01" title="Executive summary">
        {output.executive_summary ? (
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-stone-800">{output.executive_summary}</p>
        ) : (
          <p className="text-[13px] text-stone-400 italic">Not generated.</p>
        )}
      </Section>
      <Section index="02" title="Technical approach">
        {output.technical_approach?.length ? (
          <div className="space-y-3.5">
            {output.technical_approach.map((p, i) => (
              <p key={i} className="text-[14px] leading-relaxed text-stone-800">{p}</p>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-stone-400 italic">Not generated.</p>
        )}
      </Section>
      <Section index="03" title="Compliance checklist">
        {output.compliance_checklist?.length ? (
          <ul className="space-y-2.5">
            {output.compliance_checklist.map((item, i) => {
              const row = typeof item === "string" ? { requirement: item } : item;
              return <li key={i} className="text-[13.5px] leading-relaxed text-stone-700">· {row.requirement}</li>;
            })}
          </ul>
        ) : (
          <p className="text-[13px] text-stone-400 italic">None.</p>
        )}
      </Section>
      <Section index="04" title="Missing information">
        {output.missing_information?.length ? (
          <ul className="space-y-2.5">
            {output.missing_information.map((m, i) => (
              <li key={i} className="text-[13.5px] leading-relaxed text-amber-800">⚠ {m}</li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-stone-400 italic">None identified.</p>
        )}
      </Section>
      <Section index="05" title="Next steps">
        {output.next_steps?.length ? (
          <ol className="space-y-2.5 list-decimal pl-5">
            {output.next_steps.map((s, i) => (
              <li key={i} className="text-[13.5px] leading-relaxed text-stone-700">{s}</li>
            ))}
          </ol>
        ) : (
          <p className="text-[13px] text-stone-400 italic">None.</p>
        )}
      </Section>
    </div>
  );
}

// ============================================================================
// Page
// ============================================================================

export default function ProposalPackagePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const workOrderId = params.workOrderId as string;
  const sessionId = searchParams.get("session_id");

  const [stage, setStage] = useState<Stage>("loading");
  const [pkg, setPkg] = useState<ProposalPackage | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rerunBusy, setRerunBusy] = useState(false);

  const generate = useCallback(async () => {
    setStage("generating");
    try {
      const res = await fetch("/api/proposals/generate", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          work_order_id: Number(workOrderId),
          stripe_session_id: sessionId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        package?: ProposalPackage;
        error?: string;
      };
      if (!res.ok || !data.package) {
        setErrorMsg(
          res.status === 402
            ? "Your payment is still being verified — try again in a moment."
            : data.error ?? "Generation failed.",
        );
        setStage("error");
        return;
      }
      setPkg(data.package);
      setStage("ready");
    } catch {
      setErrorMsg("Could not connect to the generation service.");
      setStage("error");
    }
  }, [workOrderId, sessionId]);

  // Sprint 6b. The two B3 footer CTAs.
  //   - onUpload: opens the Vault in a new tab. Sprint 8 will use the
  //     applicant_library row newly populated there as evidence on the
  //     next re-run; for now the file simply lands in the vault and the
  //     user comes back to click Re-run.
  //   - onRerun: POSTs to the proposal-package endpoint with force=1,
  //     bypassing the "already_generated" short-circuit. PROPOSAL_MAX_ATTEMPTS
  //     is Infinity so the API never returns max_attempts in this path.
  const onUpload = useCallback(() => {
    if (typeof window !== "undefined") window.open("/dashboard/vault", "_blank");
  }, []);

  const onRerun = useCallback(async () => {
    if (rerunBusy) return;
    setRerunBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/dashboard/work-orders/${workOrderId}/proposal-package?force=1`,
        { method: "POST", headers: authHeaders() },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        setErrorMsg(body.error ?? `${res.status} ${res.statusText}`);
        return;
      }
      // Re-fetch the package to pick up the new generation.
      const get = await fetch(`/api/proposals/generate?work_order_id=${workOrderId}`, {
        headers: authHeaders(),
      });
      if (get.ok) {
        const data = (await get.json()) as { exists: boolean; package?: ProposalPackage };
        if (data.exists && data.package) setPkg(data.package);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Re-run failed.");
    } finally {
      setRerunBusy(false);
    }
  }, [rerunBusy, workOrderId]);

  useEffect(() => {
    if (!workOrderId) return;

    // Sprint 6 dev visual verification lives at /dev/proposal-preview/[name],
    // OUTSIDE the dashboard so it bypasses proxy.ts + the dashboard client
    // layout's auth checks. The old `?fixture=` query-param branch was
    // removed because it never worked locally without DATABASE_URL — both
    // auth walls fired before this effect could run.

    (async () => {
      try {
        const res = await fetch(`/api/proposals/generate?work_order_id=${workOrderId}`, {
          headers: authHeaders(),
        });
        if (res.ok) {
          const data = (await res.json()) as { exists: boolean; package?: ProposalPackage };
          if (data.exists && data.package) {
            setPkg(data.package);
            setStage("ready");
            return;
          }
        }
        await generate();
      } catch {
        await generate();
      }
    })();
  }, [workOrderId, generate]);

  const scored = useMemo(() => (pkg ? adaptScored(pkg.output) : null), [pkg]);
  const isProposal = !pkg || pkg.plan !== "roster-fast-track";
  const title = isProposal ? "Proposal package" : "Roster / LTA package";
  const subtitle = pkg?.tender_title
    ? [pkg.tender_title, pkg.agency].filter(Boolean).join(" · ")
    : null;

  if (stage === "loading" || stage === "generating") {
    return (
      <div className="px-8 py-8 max-w-4xl">
        <div className="mb-7">
          <div
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400"
            style={{ fontFamily: MONO }}
          >
            Workbench · Proposal output
          </div>
          <h1
            className="mt-1 text-[40px] leading-[1.05] font-medium text-stone-900 tracking-tight"
            style={{ fontFamily: SERIF }}
          >
            {title}
          </h1>
          {subtitle && <p className="mt-1 text-[13px] text-stone-500">{subtitle}</p>}
        </div>
        <div className="rounded-md border border-stone-200/70 bg-white p-10 text-center">
          <div className="mx-auto mb-4 h-7 w-7 animate-spin rounded-full border-2 border-stone-300 border-t-stone-900" />
          <p className="text-[14px] font-medium text-stone-900">
            {stage === "generating" ? "Generating your scored draft — this takes about a minute…" : "Loading…"}
          </p>
          <p className="mt-1 text-[12px] text-stone-500">
            Scoring against the tender&apos;s rubric, flagging compliance gates, routing every gap to its closest paid action.
          </p>
        </div>
      </div>
    );
  }

  if (stage === "error") {
    return (
      <div className="px-8 py-8 max-w-4xl">
        <h1
          className="text-[40px] leading-[1.05] font-medium text-stone-900 tracking-tight mb-6"
          style={{ fontFamily: SERIF }}
        >
          {title}
        </h1>
        <div className="rounded-md border-l-2 border-red-600 bg-red-50/40 p-6">
          <div
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-red-700 mb-2"
            style={{ fontFamily: MONO }}
          >
            Generation failed
          </div>
          <p className="text-[13.5px] text-red-900 leading-relaxed">{errorMsg}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={generate}
              className="rounded-sm bg-stone-900 px-4 py-2.5 text-[12.5px] font-semibold text-white hover:bg-stone-800"
            >
              Retry
            </button>
            <a
              href="mailto:info@tenderpath.me?subject=Proposal package error"
              className="rounded-sm border border-stone-300 px-4 py-2.5 text-[12.5px] font-semibold text-stone-700 hover:border-stone-700 hover:text-stone-900"
            >
              Contact support
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (!pkg) return null;

  return (
    <div className="px-8 py-8 max-w-4xl">
      <Link
        href="/dashboard/pipeline"
        className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500 hover:text-stone-900 transition-colors"
        style={{ fontFamily: MONO }}
      >
        ← Pipeline
      </Link>

      <div className="mt-5 mb-7">
        <div className="flex items-center gap-3 text-[11px] text-stone-500">
          <span
            className="font-semibold uppercase tracking-[0.18em] text-stone-400"
            style={{ fontFamily: MONO }}
          >
            Workbench · Proposal output
          </span>
          <span className="text-stone-300">·</span>
          <span style={{ fontFamily: MONO }}>
            Generated{" "}
            {new Date(pkg.created_at).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        </div>
        <h1
          className="mt-1 text-[44px] leading-[1.05] font-medium text-stone-900 tracking-tight"
          style={{ fontFamily: SERIF, fontFeatureSettings: "'ss01'" }}
        >
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-[14.5px] text-stone-600 leading-relaxed">{subtitle}</p>
        )}
      </div>

      {/* B1 → B2 → B3 → B4 → B5  (when the new scoring-engine fields are present) */}
      {scored ? (
        <>
          <ComplianceVerdict score={scored.score} />
          <div className="space-y-5">
            <RubricScore
              score={scored.score}
              rubricLabels={scored.rubricLabels}
              extractionConfidence={scored.extractionConfidence}
            />
            <RoutedGaps score={scored.score} onUpload={onUpload} onRerun={onRerun} rerunBusy={rerunBusy} />
            <DraftBody draft={scored.draft} rubricLabels={scored.rubricLabels} />
            <ExportRow
              workOrderId={workOrderId}
              pdfUrl={pkg.pdf_url ?? null}
              revisionHistory={scored.revisionHistory}
            />
          </div>
        </>
      ) : (
        <LegacyView output={pkg.output} onUpgrade={onRerun} upgradeBusy={rerunBusy} />
      )}
      {/*
       * NOTE: Per proposal-output-ux.md C4 the persistent footer disclaimer
       * was REMOVED in Sprint 6. The compliance-verdict (B1) + the
       * provenance-tagged claims (B4) + the per-criterion confidence (B2)
       * do the expectation-setting that a standing "we don't guarantee
       * outcomes" banner used to do, more credibly. Legal disclaimer
       * lives in T&C (C3) only.
       */}
    </div>
  );
}
