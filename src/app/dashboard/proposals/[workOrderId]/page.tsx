"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";

interface ProposalOutput {
  // proposal-draft fields
  executive_summary?: string;
  technical_approach?: string[];
  compliance_checklist?: Array<string | ComplianceItem>;
  required_documents?: string[];
  cover_letter_draft?: string;
  financial_template_notes?: string[];
  missing_information?: string[];
  next_steps?: string[];
  source_quality?: SourceQuality;
  gate_state?: GateState; // Sprint 11
  // roster-fast-track fields
  registration_checklist?: string[];
  capability_statement_draft?: string;
  organization_profile_notes?: string[];
  submission_guidance?: string[];
  // Sprint 14: per-agency readiness leaderboard for roster packages.
  agency_readiness_breakdown?: AgencyReadiness[];
}

interface AgencyReadiness {
  agency_slug: string;
  agency_label: string;
  readiness_0_10: number;
  document_coverage_0_10: number;
  category_fit_0_10: number;
  geographic_fit_0_10: number;
  recommendation: "start_here" | "viable" | "blocked";
  rationale: string;
  missing_documents: string[];
  next_actions: string[];
}

interface ComplianceItem {
  requirement: string;
  status: "compliant" | "partial" | "needs_action";
  evidence_or_action: string;
  // Sprint 11
  priority?: "mandatory" | "recommended";
  evidence_label?: "evidence_from_library" | "user_claim" | "inference" | "gap";
}

interface GateState {
  total: number;
  mandatory_gaps: number;
  recommended_gaps: number;
  gap_items: Array<{
    requirement: string;
    priority: "mandatory" | "recommended";
    evidence_or_action: string;
    evidence_label?: ComplianceItem["evidence_label"];
  }>;
}

interface SourceQuality {
  status: "ready" | "needs_review" | "blocked";
  score_0_10: number;
  missing_inputs?: string[];
  warnings?: string[];
}

interface ProposalPackage {
  id: number;
  plan: string;
  tender_title: string | null;
  agency: string | null;
  output: ProposalOutput;
  created_at: string;
  generation_status?: string | null;
  error_message?: string | null;
  pdf_url?: string | null;
}

type Stage = "loading" | "generating" | "ready" | "error";

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";
const SERIF = "'Fraunces', 'Times New Roman', serif";

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };
}

function Section({
  index,
  title,
  children,
}: {
  index: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-stone-200/70 bg-white p-6">
      <div className="flex items-baseline gap-3 mb-4 pb-3 border-b border-stone-100">
        <span
          className="text-[10px] font-semibold tabular-nums text-stone-400"
          style={{ fontFamily: MONO }}
        >
          {index}
        </span>
        <h3
          className="text-[18px] font-medium text-stone-900"
          style={{ fontFamily: SERIF }}
        >
          {title}
        </h3>
      </div>
      {children}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (!items?.length) return <p className="text-[13px] text-stone-400 italic">None identified.</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5 text-[13.5px] leading-relaxed text-stone-700">
          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-stone-400" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function CheckList({ items }: { items: string[] }) {
  if (!items?.length) return <p className="text-[13px] text-stone-400 italic">None identified.</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5 text-[13.5px] leading-relaxed text-stone-700">
          <svg
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function ComplianceList({ items }: { items: Array<string | ComplianceItem> }) {
  if (!items?.length) return <p className="text-[13px] text-stone-400 italic">None identified.</p>;
  const statusCopy: Record<ComplianceItem["status"], string> = {
    compliant: "Compliant",
    partial: "Partial",
    needs_action: "Needs action",
  };
  const statusCls: Record<ComplianceItem["status"], string> = {
    compliant: "text-emerald-700 border-emerald-200 bg-emerald-50",
    partial: "text-amber-700 border-amber-200 bg-amber-50",
    needs_action: "text-red-700 border-red-200 bg-red-50",
  };
  // Sprint 11
  const evidenceCopy: Record<NonNullable<ComplianceItem["evidence_label"]>, string> = {
    evidence_from_library: "Evidence on file",
    user_claim: "Applicant claim",
    inference: "Inference",
    gap: "Gap",
  };
  const evidenceCls: Record<NonNullable<ComplianceItem["evidence_label"]>, string> = {
    evidence_from_library: "text-emerald-700 border-emerald-200 bg-emerald-50/60",
    user_claim: "text-stone-600 border-stone-200 bg-stone-50",
    inference: "text-stone-500 border-stone-200 bg-white",
    gap: "text-red-700 border-red-200 bg-red-50",
  };
  return (
    <div className="space-y-3">
      {items.map((item, i) => {
        const row = typeof item === "string"
          ? { requirement: item, status: "needs_action" as const, evidence_or_action: "Confirm evidence before submission." } as ComplianceItem
          : item;
        return (
          <div key={i} className="rounded-sm border border-stone-200 bg-stone-50/50 p-3">
            <div className="flex flex-wrap items-start gap-2">
              <span
                className={[
                  "rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                  statusCls[row.status],
                ].join(" ")}
                style={{ fontFamily: MONO }}
              >
                {statusCopy[row.status]}
              </span>
              {row.priority === "mandatory" && (
                <span
                  className="rounded-sm border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-red-800"
                  style={{ fontFamily: MONO }}
                >
                  Mandatory
                </span>
              )}
              {row.evidence_label && (
                <span
                  className={[
                    "rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                    evidenceCls[row.evidence_label],
                  ].join(" ")}
                  style={{ fontFamily: MONO }}
                  title={`Evidence source: ${row.evidence_label.replace(/_/g, " ")}`}
                >
                  {evidenceCopy[row.evidence_label]}
                </span>
              )}
              <p className="flex-1 text-[13.5px] font-medium leading-relaxed text-stone-800">{row.requirement}</p>
            </div>
            {row.evidence_or_action && (
              <p className="mt-2 text-[12.5px] leading-relaxed text-stone-600">{row.evidence_or_action}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SourceQualityBanner({ quality }: { quality?: SourceQuality }) {
  if (!quality) return null;
  const tone = quality.status === "ready" ? "emerald" : quality.status === "needs_review" ? "amber" : "red";
  const cls = tone === "emerald"
    ? "border-emerald-600 bg-emerald-50/40 text-emerald-950"
    : tone === "amber"
      ? "border-amber-600 bg-amber-50/40 text-amber-950"
      : "border-red-600 bg-red-50/40 text-red-950";
  return (
    <div className={`mb-6 rounded-sm border-l-2 px-4 py-3 ${cls}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.18em]"
          style={{ fontFamily: MONO }}
        >
          Source quality · {quality.status}
        </span>
        <span className="text-[11px] font-semibold tabular-nums" style={{ fontFamily: MONO }}>
          {quality.score_0_10}/10
        </span>
      </div>
      {(quality.missing_inputs?.length || quality.warnings?.length) ? (
        <div className="mt-2 space-y-1 text-[12px] leading-relaxed">
          {quality.missing_inputs?.slice(0, 4).map((item) => (
            <div key={`m-${item}`}>Missing: {item}</div>
          ))}
          {quality.warnings?.slice(0, 3).map((item) => (
            <div key={`w-${item}`}>{item}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function WarningList({ items }: { items: string[] }) {
  if (!items?.length)
    return <p className="text-[13px] text-stone-400 italic">No gaps identified — review manually before submitting.</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5 text-[13.5px] leading-relaxed text-stone-700">
          <svg
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function TextBlock({ text }: { text: string | undefined }) {
  if (!text) return <p className="text-[13px] text-stone-400 italic">Not generated.</p>;
  return (
    <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-stone-800">{text}</p>
  );
}

function NumberedList({ items }: { items: string[] }) {
  if (!items?.length) return <p className="text-[13px] text-stone-400 italic">None.</p>;
  return (
    <ol className="space-y-3">
      {items.map((step, i) => (
        <li key={i} className="flex gap-3.5 text-[13.5px] leading-relaxed text-stone-700">
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-stone-300 bg-white text-[10px] font-semibold text-stone-700 tabular-nums mt-0.5"
            style={{ fontFamily: MONO }}
          >
            {i + 1}
          </span>
          <span className="pt-0.5">{step}</span>
        </li>
      ))}
    </ol>
  );
}

function GateBanner({ gate, onRegenerate, regenerating }: {
  gate: GateState | undefined;
  onRegenerate?: () => void;
  regenerating?: boolean;
}) {
  if (!gate || gate.mandatory_gaps === 0) return null;
  return (
    <div className="mb-6 rounded-md border-l-2 border-red-700 bg-red-50/40 p-4">
      <div
        className="text-[10px] font-semibold uppercase tracking-[0.18em] text-red-800"
        style={{ fontFamily: MONO }}
      >
        Compliance gate · {gate.mandatory_gaps} mandatory {gate.mandatory_gaps === 1 ? "item" : "items"} needs remediation
      </div>
      <p className="mt-2 text-[13.5px] leading-relaxed text-red-900">
        The proposal package is being held until these items are resolved. Mandatory items affect administrative eligibility — leaving them unresolved risks rejection on submission.
      </p>
      <ul className="mt-3 space-y-2.5">
        {gate.gap_items
          .filter((g) => g.priority === "mandatory")
          .slice(0, 8)
          .map((g, i) => (
            <li key={i} className="rounded-sm border border-red-200 bg-white px-3 py-2.5">
              <p className="text-[13px] font-medium text-stone-900">{g.requirement}</p>
              {g.evidence_or_action && (
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-stone-600">{g.evidence_or_action}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <Link
                  href={`/dashboard/vault?gap=${encodeURIComponent(g.requirement.slice(0, 200))}`}
                  className="rounded-sm border border-stone-700 bg-white px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.15em] text-stone-900 hover:bg-stone-900 hover:text-white transition-colors"
                  style={{ fontFamily: MONO }}
                >
                  Provide evidence →
                </Link>
                <button
                  type="button"
                  onClick={onRegenerate}
                  disabled={regenerating}
                  className="rounded-sm bg-stone-900 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.15em] text-white hover:bg-stone-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ fontFamily: MONO }}
                >
                  {regenerating ? "Regenerating…" : "Regenerate"}
                </button>
              </div>
            </li>
          ))}
      </ul>
      {gate.recommended_gaps > 0 && (
        <p className="mt-3 text-[12px] text-red-900/80">
          {gate.recommended_gaps} additional recommended improvements are flagged in the checklist below — they affect scoring but won&apos;t block submission.
        </p>
      )}
    </div>
  );
}

function ProposalDraftView({
  output,
  onRegenerate,
  regenerating,
}: {
  output: ProposalOutput;
  onRegenerate?: () => void;
  regenerating?: boolean;
}) {
  return (
    <div className="space-y-5">
      <GateBanner gate={output.gate_state} onRegenerate={onRegenerate} regenerating={regenerating} />

      <Section index="01" title="Executive summary">
        <TextBlock text={output.executive_summary} />
      </Section>

      <Section index="02" title="Technical approach">
        {output.technical_approach?.length ? (
          <div className="space-y-3.5">
            {output.technical_approach.map((para, i) => (
              <p key={i} className="text-[14px] leading-relaxed text-stone-800">
                {para}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-stone-400 italic">Not generated.</p>
        )}
      </Section>

      <Section index="03" title="Compliance checklist">
        <ComplianceList items={output.compliance_checklist ?? []} />
      </Section>

      <Section index="04" title="Required documents">
        <BulletList items={output.required_documents ?? []} />
      </Section>

      <Section index="05" title="Cover letter draft">
        <TextBlock text={output.cover_letter_draft} />
      </Section>

      <Section index="06" title="Financial template notes">
        <BulletList items={output.financial_template_notes ?? []} />
      </Section>

      <Section index="07" title="Missing information">
        <WarningList items={output.missing_information ?? []} />
      </Section>

      <Section index="08" title="Next steps">
        <NumberedList items={output.next_steps ?? []} />
      </Section>
    </div>
  );
}

function RosterPackageView({ output }: { output: ProposalOutput }) {
  const breakdown = output.agency_readiness_breakdown ?? [];
  return (
    <div className="space-y-5">
      {breakdown.length > 0 && (
        <Section index="00" title="Agency readiness · where to start">
          <AgencyReadinessLeaderboard breakdown={breakdown} />
        </Section>
      )}

      <Section index="01" title="Registration checklist">
        <CheckList items={output.registration_checklist ?? []} />
      </Section>

      <Section index="02" title="Capability statement">
        <TextBlock text={output.capability_statement_draft} />
      </Section>

      <Section index="03" title="Required documents">
        <BulletList items={output.required_documents ?? []} />
      </Section>

      <Section index="04" title="Organisation profile notes">
        <BulletList items={output.organization_profile_notes ?? []} />
      </Section>

      <Section index="05" title="Cover letter draft">
        <TextBlock text={output.cover_letter_draft} />
      </Section>

      <Section index="06" title="Submission guidance">
        <BulletList items={output.submission_guidance ?? []} />
      </Section>

      <Section index="07" title="Missing information">
        <WarningList items={output.missing_information ?? []} />
      </Section>

      <Section index="08" title="Next steps">
        <NumberedList items={output.next_steps ?? []} />
      </Section>
    </div>
  );
}

/**
 * Sprint 14. Per-agency readiness leaderboard for the roster package
 * view (the /dashboard/proposals/[id] surface — secondary to the
 * /dashboard/work-orders/[id] workspace panel but shown alongside the
 * proposal-draft view in the same route). Same shape as the workspace
 * panel's AgencyReadinessSection, lighter chrome to fit the
 * Section/BulletList visual idiom of this surface.
 */
function AgencyReadinessLeaderboard({ breakdown }: { breakdown: AgencyReadiness[] }) {
  const startHere = breakdown.find((a) => a.recommendation === "start_here");
  const viable = breakdown.filter((a) => a.recommendation === "viable");
  const blocked = breakdown.filter((a) => a.recommendation === "blocked");
  return (
    <div className="space-y-3">
      {startHere && <AgencyLeaderCard agency={startHere} variant="start_here" />}
      {viable.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-stone-500" style={{ fontFamily: MONO }}>
            Also viable
          </div>
          {viable.map((a) => <AgencyLeaderCard key={a.agency_slug} agency={a} variant="viable" />)}
        </div>
      )}
      {blocked.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-stone-500" style={{ fontFamily: MONO }}>
            Skip for now
          </div>
          {blocked.map((a) => <AgencyLeaderCard key={a.agency_slug} agency={a} variant="blocked" />)}
        </div>
      )}
    </div>
  );
}

function AgencyLeaderCard({ agency, variant }: { agency: AgencyReadiness; variant: "start_here" | "viable" | "blocked" }) {
  const tone = variant === "start_here"
    ? { border: "border-emerald-300", bg: "bg-emerald-50/70", label: "Start here", labelBg: "bg-emerald-700", score: "text-emerald-900" }
    : variant === "viable"
    ? { border: "border-stone-200", bg: "bg-white", label: "Viable", labelBg: "bg-stone-700", score: "text-stone-900" }
    : { border: "border-amber-200", bg: "bg-amber-50/40", label: "Blocked", labelBg: "bg-amber-700", score: "text-amber-900" };
  return (
    <div className={`rounded-sm border ${tone.border} ${tone.bg} p-4`}>
      <div className="flex items-baseline gap-3 mb-1.5 flex-wrap">
        <span className={`text-[14px] font-semibold ${tone.score}`} style={{ fontFamily: MONO }}>{agency.agency_label}</span>
        <span className={`text-[16px] font-bold tabular-nums ${tone.score}`} style={{ fontFamily: MONO }}>
          {agency.readiness_0_10}<span className="text-[11px] font-normal text-stone-500">/10</span>
        </span>
        <span
          className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-white ${tone.labelBg}`}
          style={{ fontFamily: MONO }}
        >
          {tone.label}
        </span>
        <span className="text-[10.5px] text-stone-500 tabular-nums" style={{ fontFamily: MONO }}>
          docs {agency.document_coverage_0_10}/10 · category {agency.category_fit_0_10}/10 · geo {agency.geographic_fit_0_10}/10
        </span>
      </div>
      <p className="text-[12.5px] text-stone-800 leading-relaxed">{agency.rationale}</p>
      {agency.missing_documents.length > 0 && (
        <div className="mt-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-500 mb-1" style={{ fontFamily: MONO }}>Missing</div>
          <ul className="text-[12px] text-stone-700 space-y-0.5">
            {agency.missing_documents.map((d, i) => (
              <li key={i} className="flex gap-1.5"><span className="text-stone-400 shrink-0">·</span><span>{d}</span></li>
            ))}
          </ul>
        </div>
      )}
      {variant !== "blocked" && agency.next_actions.length > 0 && (
        <div className="mt-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-500 mb-1" style={{ fontFamily: MONO }}>Next actions</div>
          <ul className="text-[12px] text-stone-800 space-y-0.5">
            {agency.next_actions.map((a, i) => (
              <li key={i} className="flex gap-1.5"><span className="text-emerald-700 shrink-0">→</span><span>{a}</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SupplementaryInfoForm({ workOrderId }: { workOrderId: string }) {
  const [notes, setNotes] = useState("");
  const [uploadedFile, setUploadedFile] = useState<{ name: string; url: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
      const headers: HeadersInit = token ? { authorization: `Bearer ${token}` } : {};
      const res = await fetch("/api/dashboard/vault/upload", { method: "POST", headers, body: formData });
      const data = (await res.json().catch(() => ({}))) as { url?: string; name?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? "File upload failed.");
        return;
      }
      setUploadedFile({ url: data.url, name: data.name ?? file.name });
    } catch {
      setError("File upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (!notes && !uploadedFile) return;
    setSaving(true);
    setError(null);
    try {
      const intake: Record<string, string> = {};
      if (notes) intake.supplementary_notes = notes;
      if (uploadedFile) {
        intake.supplementary_vault_url = uploadedFile.url;
        intake.supplementary_filename = uploadedFile.name;
      }
      const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
      const headers: HeadersInit = {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      };
      const res = await fetch(`/api/dashboard/work-orders/${workOrderId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ intake }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not save.");
        return;
      }
      setSaved(true);
      setNotes("");
      setUploadedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch {
      setError("Could not save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-6 rounded-md border border-stone-200/70 bg-stone-50/40 p-6">
      <div className="flex items-baseline gap-3 mb-1.5">
        <span
          className="text-[10px] font-semibold tabular-nums text-stone-400"
          style={{ fontFamily: MONO }}
        >
          09
        </span>
        <h3
          className="text-[18px] font-medium text-stone-900"
          style={{ fontFamily: SERIF }}
        >
          Add more information
        </h3>
      </div>
      <p className="text-[12.5px] leading-relaxed text-stone-600 mb-4">
        Return any time while the tender window is open to upload additional documents or notes — your support access stays active until the window closes.
      </p>
      <div className="space-y-3">
        <div>
          <label
            className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500"
            style={{ fontFamily: MONO }}
          >
            Additional notes or context
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="New requirements, agency feedback, registration status update…"
            rows={4}
            className="mt-1.5 w-full rounded-sm border border-stone-300 bg-white px-3 py-2.5 text-[13px] text-stone-900 focus:border-stone-700 focus:outline-none resize-none"
          />
        </div>
        <div>
          <label
            className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500"
            style={{ fontFamily: MONO }}
          >
            Upload additional document
          </label>
          {uploadedFile ? (
            <div
              className="mt-1.5 flex items-center gap-2 rounded-sm border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 text-[12px] text-emerald-800"
              style={{ fontFamily: MONO }}
            >
              <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
              </svg>
              <span className="flex-1 truncate">{uploadedFile.name}</span>
              <button
                type="button"
                onClick={() => {
                  setUploadedFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className="shrink-0 text-emerald-700 underline underline-offset-2 hover:text-emerald-900"
              >
                Remove
              </button>
            </div>
          ) : (
            <label className="mt-1.5 flex cursor-pointer items-start gap-2.5 rounded-sm border border-dashed border-stone-300 bg-white px-3.5 py-3 text-[12px] text-stone-500 hover:border-stone-700 hover:text-stone-700 transition-colors">
              <svg className="h-4 w-4 shrink-0 mt-0.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M8 2v8M5 5l3-3 3 3M2 12h12v2H2z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="leading-snug flex-1">
                {uploading ? "Uploading…" : <><span className="font-semibold text-stone-700">Choose file</span> — PDF, Word, or Excel up to 10 MB</>}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx"
                className="sr-only"
                disabled={uploading}
                onChange={handleFileChange}
              />
            </label>
          )}
        </div>
        {error && (
          <p className="rounded-sm border-l-2 border-red-600 bg-red-50/40 px-3.5 py-2.5 text-[12px] text-red-700">
            {error}
          </p>
        )}
        {saved && (
          <p className="rounded-sm border-l-2 border-emerald-600 bg-emerald-50/40 px-3.5 py-2.5 text-[12px] text-emerald-800">
            Information saved — our team will incorporate it into your support.
          </p>
        )}
        <button
          onClick={handleSave}
          disabled={saving || uploading || (!notes && !uploadedFile)}
          className="rounded-sm bg-stone-900 px-4 py-2.5 text-[12.5px] font-semibold text-white hover:bg-stone-800 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save additional information"}
        </button>
      </div>
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
  const [regenerating, setRegenerating] = useState(false);

  const generate = useCallback(async (opts?: { force?: boolean }) => {
    if (!opts?.force) setStage("generating");
    try {
      const res = await fetch("/api/proposals/generate", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          work_order_id: Number(workOrderId),
          stripe_session_id: sessionId,
          force: opts?.force === true,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        package?: ProposalPackage;
        error?: string;
        code?: string;
      };
      if (!res.ok || !data.package) {
        const isPaymentPending = res.status === 402;
        setErrorMsg(
          isPaymentPending
            ? "Your payment is still being verified — this can take up to a minute. Click Retry in a moment, or contact support if it persists."
            : data.error ?? "Generation failed. Please try again or contact support."
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

  useEffect(() => {
    if (!workOrderId) return;

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

  // Sprint 11: regenerate when the compliance gate is open. We don't kick
  // back into the full "generating…" splash since the user already has the
  // draft view loaded; we just refresh the package quietly.
  const regenerate = useCallback(async () => {
    setRegenerating(true);
    try {
      await generate({ force: true });
    } finally {
      setRegenerating(false);
    }
  }, [generate]);

  const isProposal = !pkg || pkg.plan !== "roster-fast-track";
  const title = isProposal ? "Proposal package" : "Roster / LTA package";
  const subtitle = pkg?.tender_title
    ? [pkg.tender_title, pkg.agency].filter(Boolean).join(" · ")
    : null;
  const sourceQualityStatus = pkg?.output.source_quality?.status;
  // Sprint 11: compliance-gate state trumps source-quality state in the header label.
  const gateBlocked = (pkg?.output.gate_state?.mandatory_gaps ?? 0) > 0;
  const packageStatusLabel = gateBlocked
    ? `needs remediation · ${pkg?.output.gate_state?.mandatory_gaps} mandatory ${pkg?.output.gate_state?.mandatory_gaps === 1 ? "item" : "items"}`
    : sourceQualityStatus && sourceQualityStatus !== "ready"
      ? "ready · source review required"
      : "ready";

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
            {stage === "generating" ? "Generating your package — this takes about 30 seconds…" : "Loading…"}
          </p>
          <p className="mt-1 text-[12px] text-stone-500">
            Claude is analysing the tender requirements against your company profile.
          </p>
        </div>
      </div>
    );
  }

  if (stage === "error") {
    return (
      <div className="px-8 py-8 max-w-4xl">
        <div className="mb-7">
          <h1
            className="text-[40px] leading-[1.05] font-medium text-stone-900 tracking-tight"
            style={{ fontFamily: SERIF }}
          >
            {title}
          </h1>
        </div>
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
              onClick={() => generate()}
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
      {/* Back link */}
      <Link
        href="/dashboard/pipeline"
        className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500 hover:text-stone-900 transition-colors"
        style={{ fontFamily: MONO }}
      >
        ← Pipeline
      </Link>

      {/* Header */}
      <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between mb-7">
        <div className="max-w-3xl">
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
      </div>

      {/* Ready banner */}
      <div className="mb-6 rounded-sm border-l-2 border-emerald-600 bg-emerald-50/40 px-4 py-3">
        <div
          className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700"
          style={{ fontFamily: MONO }}
        >
          Status · {packageStatusLabel}
        </div>
        <p className="mt-0.5 text-[13px] text-emerald-900 leading-relaxed">
          Your {title.toLowerCase()} is ready. Review each section carefully and fill in any missing information before submission.
        </p>
      </div>

      <SourceQualityBanner quality={pkg.output.source_quality} />

      {/* Sections */}
      {isProposal ? (
        <ProposalDraftView output={pkg.output} onRegenerate={regenerate} regenerating={regenerating} />
      ) : (
        <>
          <RosterPackageView output={pkg.output} />
          <SupplementaryInfoForm workOrderId={workOrderId} />
        </>
      )}

      {/* Footer disclaimer */}
      <div className="mt-7 rounded-sm border-l-2 border-stone-300 bg-stone-50/60 px-4 py-3 text-[11.5px] leading-relaxed text-stone-500">
        This package is AI-generated and should be reviewed by your team before submission. TenderPath is not responsible for submission outcomes. Always verify requirements directly with the contracting authority.
      </div>
    </div>
  );
}
