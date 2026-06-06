"use client";

import { useEffect, useMemo, useState } from "react";
import UpgradeGate from "../components/UpgradeGate";

type DocType = "certification" | "financial" | "cv" | "past_performance" | "other";

interface VaultDoc {
  id: number;
  name: string;
  type: DocType;
  expiry_date: string | null;
  file_url: string;
  download_url?: string;
  created_at: string;
  /** Sprint 10: auto-applied capability tags (e.g. iso-9001, pador,
   *  external-audit). Used by the proposal generator to match evidence
   *  to tender requirements. */
  tags?: string[] | null;
}

const TYPES: { value: DocType; label: string }[] = [
  { value: "certification", label: "Certification" },
  { value: "financial", label: "Financial" },
  { value: "cv", label: "CV" },
  { value: "past_performance", label: "Past performance" },
  { value: "other", label: "Other" },
];

const EXPIRY_WARN_DAYS = 60;

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";
const SERIF = "'Fraunces', 'Times New Roman', serif";

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };
}

function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const diff = new Date(date).getTime() - Date.now();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function shortDate(d: string | null): string {
  if (!d) return "—";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function docRef(id: number): string {
  return `DOC-${id.toString(16).toUpperCase().padStart(4, "0")}`;
}

// Sprint 13. Shape of the mined_profile_facts JSONB column (mirrors
// MinedProfileFacts from src/lib/applicant-evidence/profile-miner.ts).
// Inlined here as a UI-local type so the Vault page doesn't depend on a
// server-only module.
interface MinedFactsUi {
  years_of_experience?: number;
  sectors_covered?: string[];
  agencies_worked_with?: string[];
  geographic_reach?: string[];
  key_capabilities?: string[];
}

function minedFactsCount(f: MinedFactsUi | null | undefined): number {
  if (!f) return 0;
  let n = 0;
  if (typeof f.years_of_experience === "number") n += 1;
  if (Array.isArray(f.sectors_covered) && f.sectors_covered.length > 0) n += 1;
  if (Array.isArray(f.agencies_worked_with) && f.agencies_worked_with.length > 0) n += 1;
  if (Array.isArray(f.geographic_reach) && f.geographic_reach.length > 0) n += 1;
  if (Array.isArray(f.key_capabilities) && f.key_capabilities.length > 0) n += 1;
  return n;
}

export default function VaultPage() {
  const [docs, setDocs] = useState<VaultDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    type: "certification" as DocType,
    expiry_date: "",
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [requestedGap, setRequestedGap] = useState<string | null>(null);
  // Sprint 13. Mined profile facts (Sprint 8e free-text intake miner output)
  // surfaced for user visibility — they can see what was inferred from their
  // own typed answers, and (in a future sprint) correct anything wrong.
  const [minedFacts, setMinedFacts] = useState<MinedFactsUi | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/dashboard/vault", { headers: authHeaders() });
      if (res.ok) {
        const body = await res.json();
        setDocs(body.documents);
      }
      // Sprint 13. Fetch the profile in parallel — mined_profile_facts is
      // surfaced as a small "What we inferred about you" card. Failure is
      // non-fatal: the page just renders without the card.
      try {
        const pRes = await fetch("/api/dashboard/profile", { headers: authHeaders() });
        if (pRes.ok) {
          const profile = (await pRes.json()) as { mined_profile_facts?: MinedFactsUi | null };
          if (profile.mined_profile_facts) setMinedFacts(profile.mined_profile_facts);
        }
      } catch {
        // intentionally silent — the card is purely additive
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedType = params.get("type");
    if (requestedType && TYPES.some((t) => t.value === requestedType)) {
      setForm((prev) => ({ ...prev, type: requestedType as DocType }));
    }
    setRequestedGap(params.get("gap"));
  }, []);

  const expiring = useMemo(
    () =>
      docs.filter((d) => {
        const days = daysUntil(d.expiry_date);
        return days !== null && days <= EXPIRY_WARN_DAYS;
      }),
    [docs]
  );

  const totals = useMemo(() => {
    const byType: Record<DocType, number> = {
      certification: 0, financial: 0, cv: 0, past_performance: 0, other: 0,
    };
    for (const d of docs) byType[d.type]++;
    return {
      total: docs.length,
      expiring: expiring.length,
      certs: byType.certification,
      financial: byType.financial,
    };
  }, [docs, expiring]);

  async function upload(e?: React.FormEvent, fileOverride?: File) {
    e?.preventDefault();
    setError(null);

    const file = fileOverride ?? selectedFile;
    if (!file) {
      setError("Please select a file to upload.");
      return;
    }

    setUploading(true);

    try {
      const uploadData = new FormData();
      uploadData.append("file", file);

      const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
      const uploadRes = await fetch("/api/dashboard/vault/upload", {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: uploadData,
      });

      if (!uploadRes.ok) {
        const body = await uploadRes.json().catch(() => ({}));
        setError(body.error || "File upload failed");
        setUploading(false);
        return;
      }

      const { upload_id } = await uploadRes.json() as { upload_id?: number };
      if (!upload_id) {
        setError("Upload completed but could not be saved. Please try again.");
        setUploading(false);
        return;
      }

      const res = await fetch("/api/dashboard/vault", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          name: form.name || file.name,
          type: form.type,
          expiry_date: form.expiry_date || null,
          upload_id,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Save failed");
        setUploading(false);
        return;
      }

      const body = await res.json();
      setDocs((prev) => [body.document, ...prev]);
      setForm({ name: "", type: "certification", expiry_date: "" });
      setSelectedFile(null);
      const fileInput = document.getElementById("vault-file-input") as HTMLInputElement;
      if (fileInput) fileInput.value = "";
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this document? This cannot be undone.")) return;
    await fetch(`/api/dashboard/vault/${id}`, { method: "DELETE", headers: authHeaders() });
    setDocs((prev) => prev.filter((d) => d.id !== id));
  }

  return (
    <UpgradeGate
      title="Unlock the document vault"
      description="Preview the compliance library and expiry tracking. A subscription lets you store reusable bid documents and connect them to readiness gaps."
    >
      <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8 max-w-[1400px]">
        {/* Header */}
        <header className="flex items-end justify-between gap-6 mb-2">
          <div>
            <div className="flex items-center gap-3 text-[11px] text-stone-500">
              <span className="font-semibold uppercase tracking-[0.18em] text-stone-400">Workbench · Tools</span>
              <span className="text-stone-300">·</span>
              <span style={{ fontFamily: MONO }}>{loading ? "loading…" : `${docs.length} on file`}</span>
            </div>
            <h1
              className="mt-1 text-[36px] sm:text-[48px] lg:text-[56px] leading-[1.05] font-medium text-stone-900 tracking-tight"
              style={{ fontFamily: SERIF, fontFeatureSettings: "'ss01'" }}
            >
              Document <em className="italic text-stone-500">vault</em>
            </h1>
            <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-stone-600">
              The compliance library you reuse across submissions. Track expiry, attach to readiness gaps, and pull straight into proposals.
            </p>
          </div>
        </header>

        {/* Stats */}
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-px bg-stone-200/70 rounded-md overflow-hidden">
          {[
            { label: "Total", value: totals.total, sub: "all documents" },
            { label: "Expiring", value: totals.expiring, sub: `≤ ${EXPIRY_WARN_DAYS} days`, urgent: totals.expiring > 0 },
            { label: "Certifications", value: totals.certs, sub: "compliance" },
            { label: "Financial", value: totals.financial, sub: "audits · statements" },
          ].map((s) => (
            <div key={s.label} className="bg-stone-50/60 px-4 py-3.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-stone-500">{s.label}</div>
              <div
                className={`mt-1 text-[28px] leading-none font-medium tabular-nums ${s.urgent ? "text-red-600" : "text-stone-900"}`}
                style={{ fontFamily: SERIF }}
              >
                {loading ? "—" : s.value}
              </div>
              <div className="mt-1 text-[11px] text-stone-500">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Gap callout */}
        {requestedGap && (
          <div className="mt-5 rounded-md border-l-2 border-amber-600 bg-amber-50/40 px-4 py-3">
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700"
              style={{ fontFamily: MONO }}
            >
              Readiness gap · attach evidence
            </div>
            <p className="mt-1.5 text-[14px] leading-relaxed text-amber-900">{requestedGap}</p>
          </div>
        )}

        {/* Expiring warning */}
        {expiring.length > 0 && !requestedGap && (
          <div className="mt-5 rounded-md border-l-2 border-red-600 bg-red-50/40 px-4 py-3">
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-red-700"
              style={{ fontFamily: MONO }}
            >
              {expiring.length} document{expiring.length === 1 ? "" : "s"} expire within {EXPIRY_WARN_DAYS} days
            </div>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-red-900">
              {expiring.map((d) => d.name).join(" · ")}
            </p>
          </div>
        )}

        {/* Sprint 13. Mined profile facts — Sprint 8e's free-text intake miner
            output. Surfaces what TenderPath has inferred from the narrative
            the user typed into Bid/No-Bid / Proposal-Draft intake forms so
            they can audit it. CLAIMS, not evidence — labelled accordingly. */}
        {minedFactsCount(minedFacts) > 0 && (
          <div className="mt-5 rounded-md border border-stone-200 bg-stone-50/40 px-4 py-3.5">
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <div
                className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-600"
                style={{ fontFamily: MONO }}
              >
                What we inferred from your intake
              </div>
              <div
                className="text-[10px] uppercase tracking-[0.15em] text-stone-400"
                style={{ fontFamily: MONO }}
              >
                Claims · not evidence
              </div>
            </div>
            <p className="text-[11.5px] leading-relaxed text-stone-500 mb-3">
              Extracted from the narrative you typed into intake forms.
              Carried forward across tenders so you don&rsquo;t retype.
              The proposal engine uses these only to fill empty profile
              fields — uploaded documents always win.
            </p>
            <dl
              className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-[12.5px]"
              style={{ fontFamily: MONO }}
            >
              {typeof minedFacts?.years_of_experience === "number" && (
                <div className="flex items-baseline gap-2">
                  <dt className="text-stone-500 min-w-[110px]">Years of experience</dt>
                  <dd className="text-stone-800 font-medium">{minedFacts.years_of_experience}</dd>
                </div>
              )}
              {Array.isArray(minedFacts?.sectors_covered) && minedFacts.sectors_covered.length > 0 && (
                <div className="flex items-baseline gap-2 sm:col-span-2">
                  <dt className="text-stone-500 min-w-[110px] shrink-0">Sectors</dt>
                  <dd className="text-stone-800">{minedFacts.sectors_covered.join(", ")}</dd>
                </div>
              )}
              {Array.isArray(minedFacts?.agencies_worked_with) && minedFacts.agencies_worked_with.length > 0 && (
                <div className="flex items-baseline gap-2 sm:col-span-2">
                  <dt className="text-stone-500 min-w-[110px] shrink-0">Agencies / donors</dt>
                  <dd className="text-stone-800">{minedFacts.agencies_worked_with.join(", ")}</dd>
                </div>
              )}
              {Array.isArray(minedFacts?.geographic_reach) && minedFacts.geographic_reach.length > 0 && (
                <div className="flex items-baseline gap-2 sm:col-span-2">
                  <dt className="text-stone-500 min-w-[110px] shrink-0">Geographic reach</dt>
                  <dd className="text-stone-800">{minedFacts.geographic_reach.join(", ")}</dd>
                </div>
              )}
              {Array.isArray(minedFacts?.key_capabilities) && minedFacts.key_capabilities.length > 0 && (
                <div className="flex items-baseline gap-2 sm:col-span-2">
                  <dt className="text-stone-500 min-w-[110px] shrink-0">Key capabilities</dt>
                  <dd className="text-stone-800">{minedFacts.key_capabilities.join(", ")}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

        {/* Upload form */}
        <form
          onSubmit={upload}
          className="mt-7 rounded-md border border-stone-200/70 bg-white p-5"
        >
          <div
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400 mb-3"
            style={{ fontFamily: MONO }}
          >
            New document · drop in or upload
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              className="rounded-sm border border-stone-300 bg-white px-3 py-2.5 text-[13px] focus:outline-none focus:border-stone-700"
              placeholder="Document name (defaults to filename)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <select
              className="rounded-sm border border-stone-300 bg-white px-3 py-2.5 text-[13px] focus:outline-none focus:border-stone-700"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as DocType })}
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <div>
              <label
                className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400 mb-1.5"
                style={{ fontFamily: MONO }}
              >
                Expiry date · optional
              </label>
              <input
                type="date"
                className="w-full rounded-sm border border-stone-300 bg-white px-3 py-2.5 text-[13px] focus:outline-none focus:border-stone-700"
                value={form.expiry_date}
                onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
                style={{ fontFamily: MONO }}
              />
            </div>
            <div>
              <label
                className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400 mb-1.5"
                style={{ fontFamily: MONO }}
              >
                File · required
              </label>
              <input
                id="vault-file-input"
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp"
                className="w-full text-[12.5px] text-stone-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-sm file:border-0 file:text-[10px] file:font-semibold file:uppercase file:tracking-[0.15em] file:bg-stone-900 file:text-white hover:file:bg-stone-800 cursor-pointer"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setSelectedFile(file);
                  if (file) upload(undefined, file);
                }}
                required
              />
              <p className="mt-1 text-[11px] text-stone-500">PDF, Word, Excel, or image · max 10MB</p>
            </div>
          </div>
          {uploading && (
            <div className="mt-3 flex items-center gap-2 text-[12.5px] text-stone-600">
              <svg className="animate-spin h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Uploading…
            </div>
          )}
          {error && (
            <div className="mt-3 text-[12px] text-red-700 border-l-2 border-red-600 pl-3">{error}</div>
          )}
        </form>

        {/* Documents table */}
        <section className="mt-7 rounded-md border border-stone-200/70 bg-white overflow-hidden">
          <div className="border-b border-stone-200/70 px-5 py-4 flex items-baseline justify-between">
            <h2
              className="text-[20px] font-medium text-stone-900"
              style={{ fontFamily: SERIF }}
            >
              <span
                className="text-[10px] font-semibold tabular-nums text-stone-400 mr-2 align-middle"
                style={{ fontFamily: MONO }}
              >
                01 ·
              </span>
              On file
            </h2>
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400"
              style={{ fontFamily: MONO }}
            >
              {docs.length.toString().padStart(2, "0")} documents
            </span>
          </div>

          {loading ? (
            <div className="p-5 text-[13px] text-stone-500">Loading…</div>
          ) : docs.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-[13.5px] text-stone-500 max-w-md mx-auto">
                No documents yet. Upload your first compliance certificate, financial statement, or past-performance reference above.
              </p>
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="bg-stone-50/60">
                <tr
                  className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500 text-left"
                  style={{ fontFamily: MONO }}
                >
                  <th className="px-5 py-3 font-semibold">Ref · Name</th>
                  <th className="px-5 py-3 font-semibold">Type</th>
                  <th className="px-5 py-3 font-semibold">Expiry</th>
                  <th className="px-5 py-3 font-semibold">File</th>
                  <th className="px-5 py-3 font-semibold">Action</th>
                  <th className="px-5 py-3 font-semibold text-right">Manage</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => {
                  const days = daysUntil(d.expiry_date);
                  const expired = days !== null && days < 0;
                  const warning = days !== null && days >= 0 && days <= EXPIRY_WARN_DAYS;
                  return (
                    <tr key={d.id} className="border-t border-stone-200/70 hover:bg-stone-50/40 transition-colors">
                      <td className="px-5 py-3.5 align-top">
                        <div
                          className="text-[10px] tracking-wider text-stone-400"
                          style={{ fontFamily: MONO }}
                        >
                          {docRef(d.id)}
                        </div>
                        <div className="mt-0.5 text-stone-900 font-medium leading-tight">{d.name}</div>
                        {Array.isArray(d.tags) && d.tags.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {d.tags.slice(0, 6).map((tag) => (
                              <span
                                key={tag}
                                className="inline-block rounded-sm bg-stone-100 px-1.5 py-0.5 text-[10px] tracking-wide text-stone-600"
                                style={{ fontFamily: MONO }}
                              >
                                {tag}
                              </span>
                            ))}
                            {d.tags.length > 6 && (
                              <span className="text-[10px] text-stone-400" style={{ fontFamily: MONO }}>
                                +{d.tags.length - 6}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3.5 align-top">
                        <span
                          className="inline-block text-[10px] uppercase tracking-[0.15em] font-semibold text-stone-700"
                          style={{ fontFamily: MONO }}
                        >
                          {d.type.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 align-top">
                        {d.expiry_date ? (
                          <div
                            className={`text-[12px] tabular-nums ${expired ? "text-red-700 font-semibold" : warning ? "text-amber-700 font-semibold" : "text-stone-600"}`}
                            style={{ fontFamily: MONO }}
                          >
                            {shortDate(d.expiry_date)}
                            <span className="ml-1.5 text-[10.5px] uppercase tracking-wider">
                              {expired ? "· expired" : warning ? `· ${days}d` : ""}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[12px] text-stone-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 align-top">
                        <a
                          href={d.download_url ?? d.file_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[12.5px] text-stone-900 underline underline-offset-2 hover:no-underline"
                        >
                          Open ↗
                        </a>
                      </td>
                      <td className="px-5 py-3.5 align-top">
                        <a
                          href={`/dashboard/services/proposal?doc_id=${d.id}`}
                          className="text-[10.5px] font-semibold uppercase tracking-[0.15em] text-stone-700 border border-stone-300 rounded-sm px-2 py-1 bg-white hover:border-stone-700 hover:text-stone-900 transition-colors whitespace-nowrap"
                        >
                          Use in proposal
                        </a>
                      </td>
                      <td className="px-5 py-3.5 align-top text-right">
                        <button
                          onClick={() => remove(d.id)}
                          className="text-[11px] text-stone-400 hover:text-red-600 transition-colors"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </UpgradeGate>
  );
}
