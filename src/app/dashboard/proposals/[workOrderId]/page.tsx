"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";

interface ProposalOutput {
  // proposal-draft fields
  executive_summary?: string;
  technical_approach?: string[];
  compliance_checklist?: string[];
  required_documents?: string[];
  cover_letter_draft?: string;
  financial_template_notes?: string[];
  missing_information?: string[];
  next_steps?: string[];
  // roster-fast-track fields
  registration_checklist?: string[];
  capability_statement_draft?: string;
  organization_profile_notes?: string[];
  submission_guidance?: string[];
}

interface ProposalPackage {
  id: number;
  plan: string;
  tender_title: string | null;
  agency: string | null;
  output: ProposalOutput;
  created_at: string;
}

type Stage = "loading" | "generating" | "ready" | "error";

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      {children}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (!items?.length) return <p className="text-sm text-gray-400 italic">None identified.</p>;
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm text-gray-700">
          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
          {item}
        </li>
      ))}
    </ul>
  );
}

function CheckList({ items }: { items: string[] }) {
  if (!items?.length) return <p className="text-sm text-gray-400 italic">None identified.</p>;
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm text-gray-700">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          {item}
        </li>
      ))}
    </ul>
  );
}

function WarningList({ items }: { items: string[] }) {
  if (!items?.length) return <p className="text-sm text-gray-400 italic">No gaps identified — review manually before submitting.</p>;
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm text-gray-700">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          {item}
        </li>
      ))}
    </ul>
  );
}

function TextBlock({ text }: { text: string | undefined }) {
  if (!text) return <p className="text-sm text-gray-400 italic">Not generated.</p>;
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{text}</p>
  );
}

function ProposalDraftView({ output }: { output: ProposalOutput }) {
  return (
    <div className="space-y-4">
      <Section title="Executive Summary">
        <TextBlock text={output.executive_summary} />
      </Section>

      <Section title="Technical Approach">
        {output.technical_approach?.length ? (
          <div className="space-y-3">
            {output.technical_approach.map((para, i) => (
              <p key={i} className="text-sm leading-relaxed text-gray-700">{para}</p>
            ))}
          </div>
        ) : <p className="text-sm text-gray-400 italic">Not generated.</p>}
      </Section>

      <Section title="Compliance Checklist">
        <CheckList items={output.compliance_checklist ?? []} />
      </Section>

      <Section title="Required Documents">
        <BulletList items={output.required_documents ?? []} />
      </Section>

      <Section title="Cover Letter Draft">
        <TextBlock text={output.cover_letter_draft} />
      </Section>

      <Section title="Financial Template Notes">
        <BulletList items={output.financial_template_notes ?? []} />
      </Section>

      <Section title="Missing Information">
        <WarningList items={output.missing_information ?? []} />
      </Section>

      <Section title="Next Steps">
        <ol className="space-y-2">
          {(output.next_steps ?? []).map((step, i) => (
            <li key={i} className="flex gap-3 text-sm text-gray-700">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[10px] font-bold text-white">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}

function RosterPackageView({ output }: { output: ProposalOutput }) {
  return (
    <div className="space-y-4">
      <Section title="Registration Checklist">
        <CheckList items={output.registration_checklist ?? []} />
      </Section>

      <Section title="Capability Statement">
        <TextBlock text={output.capability_statement_draft} />
      </Section>

      <Section title="Required Documents">
        <BulletList items={output.required_documents ?? []} />
      </Section>

      <Section title="Organisation Profile Notes">
        <BulletList items={output.organization_profile_notes ?? []} />
      </Section>

      <Section title="Cover Letter Draft">
        <TextBlock text={output.cover_letter_draft} />
      </Section>

      <Section title="Submission Guidance">
        <BulletList items={output.submission_guidance ?? []} />
      </Section>

      <Section title="Missing Information">
        <WarningList items={output.missing_information ?? []} />
      </Section>

      <Section title="Next Steps">
        <ol className="space-y-2">
          {(output.next_steps ?? []).map((step, i) => (
            <li key={i} className="flex gap-3 text-sm text-gray-700">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[10px] font-bold text-white">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}

export default function ProposalPackagePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const workOrderId = params.workOrderId as string;
  const sessionId = searchParams.get("session_id");

  const [stage, setStage] = useState<Stage>("loading");
  const [pkg, setPkg] = useState<ProposalPackage | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
      const data = await res.json().catch(() => ({})) as { package?: ProposalPackage; error?: string; code?: string };
      if (!res.ok || !data.package) {
        const isPaymentPending = res.status === 402;
        setErrorMsg(isPaymentPending
          ? "Your payment is still being verified — this can take up to a minute. Click Retry in a moment, or contact support if it persists."
          : (data.error ?? "Generation failed. Please try again or contact support."));
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

  useEffect(() => {
    if (!workOrderId) return;

    // First check if already generated
    (async () => {
      try {
        const res = await fetch(`/api/proposals/generate?work_order_id=${workOrderId}`, {
          headers: authHeaders(),
        });
        if (res.ok) {
          const data = await res.json() as { exists: boolean; package?: ProposalPackage };
          if (data.exists && data.package) {
            setPkg(data.package);
            setStage("ready");
            return;
          }
        }
        // Not generated yet — trigger generation
        await generate();
      } catch {
        await generate();
      }
    })();
  }, [workOrderId, generate]);

  const isProposal = !pkg || pkg.plan !== "roster-fast-track";
  const title = isProposal ? "Proposal Package" : "Roster / LTA Package";
  const subtitle = pkg?.tender_title
    ? [pkg.tender_title, pkg.agency].filter(Boolean).join(" — ")
    : null;

  if (stage === "loading" || stage === "generating") {
    return (
      <div className="max-w-3xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-6 text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-amber-300 border-t-amber-700" />
          <p className="text-sm font-medium text-amber-900">
            {stage === "generating" ? "Generating your package — this takes about 30 seconds…" : "Loading…"}
          </p>
          <p className="mt-1 text-xs text-amber-600">
            Claude is analysing the tender requirements against your company profile.
          </p>
        </div>
      </div>
    );
  }

  if (stage === "error") {
    return (
      <div className="max-w-3xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6">
          <p className="text-sm font-medium text-red-900">Generation failed</p>
          <p className="mt-1 text-sm text-red-700">{errorMsg}</p>
          <div className="mt-4 flex gap-3">
            <button
              onClick={generate}
              className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
            >
              Retry
            </button>
            <a
              href="mailto:info@tenderpath.me?subject=Proposal package error"
              className="rounded-md border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:border-red-500"
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
    <div className="max-w-3xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
          <p className="mt-0.5 text-xs text-gray-400">
            Generated {new Date(pkg.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </p>
        </div>
        <Link
          href="/dashboard/pipeline"
          className="shrink-0 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:border-gray-400"
        >
          ← Pipeline
        </Link>
      </div>

      <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
        Your {title.toLowerCase()} is ready. Review each section carefully and fill in any missing information before submission.
      </div>

      {isProposal ? (
        <ProposalDraftView output={pkg.output} />
      ) : (
        <RosterPackageView output={pkg.output} />
      )}

      <div className="mt-6 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-500">
        This package is AI-generated and should be reviewed by your team before submission.
        TenderPath is not responsible for submission outcomes. Always verify requirements directly with the contracting authority.
      </div>
    </div>
  );
}
