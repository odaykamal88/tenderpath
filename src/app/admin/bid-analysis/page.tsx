"use client";

import { useState } from "react";
import type { AdminBidNoBidRequest } from "@/app/api/admin/bid-no-bid/route";
import type { BidNoBidOutput, TenderRequirements } from "@/lib/bid-no-bid/types";

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";
const SERIF = "'Fraunces', 'Times New Roman', serif";

interface ApiResult {
  output: BidNoBidOutput;
  requirements: TenderRequirements;
}

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };
}

function recBg(rec: BidNoBidOutput["recommendation"]): string {
  if (rec === "bid") return "#166534";
  if (rec === "no-bid") return "#991b1b";
  return "#92400e";
}

function sevColor(sev: "high" | "medium" | "low"): string {
  if (sev === "high") return "#b91c1c";
  if (sev === "medium") return "#b45309";
  return "#78716c";
}

const CIM_SYR_DEFAULTS: AdminBidNoBidRequest = {
  tender_title: "EU Support for Independent Syrian Media",
  tender_agency: "European Commission / DG NEAR",
  tender_url:
    "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/prospect-details/185831PROSPECTSEN",
  tender_deadline: "",
  tender_value: "",
  tender_sector: "Civil Society / Media Development",
  tender_eligibility:
    "Registered non-profit or civil society organisations. Consortium applications accepted. Lead applicant must be established for at least 2 years. Eligible countries: Syria, Turkey, Lebanon, Jordan, Germany and other EU member states.",
  tender_description:
    "Support for independent Syrian media organisations and journalists operating in exile or inside Syria. Programme objectives include: strengthening editorial independence, improving digital security practices, supporting audience development, and building organisational sustainability of independent media outlets. Activities may include training, technical assistance, small grants, and networking initiatives.",
  company_name: "CIM-SYR Consortium",
  company_sector: "Media / Civil Society",
  company_countries: "Syria, Turkey, Lebanon, Germany, France",
  company_description:
    "CIM-SYR is a consortium of independent Syrian media organisations dedicated to professional, independent journalism and freedom of expression. Founded by Syrian journalists and media professionals in exile and inside Syria. Members produce Arabic-language digital, radio, and print content for Syrian audiences.",
  company_capabilities:
    "Independent journalism production · Arabic and Kurdish language content · Digital media operations · Radio broadcasting · Editorial independence track record · Audience reach inside Syria and diaspora · Partnerships with international media development organisations · Experience with donor-funded programmes (EU, NED, USAID)",
  intake_notes:
    "Test run requested by admin. Applicant is a consortium with four member organisations. Evaluate feasibility as lead applicant and consortium structure fit.",
  consortium_members: [
    {
      name: "Al-Jumhuriya",
      url: "https://aljumhuriya.net/",
      description:
        "Syrian digital publication focusing on political analysis, culture, and democracy promotion. Founded by Syrian intellectuals and journalists.",
      capabilities:
        "Long-form Arabic journalism · Political analysis · Cultural coverage · Digital publication · International credibility",
    },
    {
      name: "Arta FM",
      url: "https://www.artaorg.net/",
      description:
        "Syrian radio station operating from Turkey serving audiences in northern Syria and diaspora with news and cultural programming.",
      capabilities:
        "Radio broadcasting · FM and digital streaming · Northern Syria audience reach · Local reporting",
    },
    {
      name: "Rozana Radio",
      url: "https://www.rozana.fm/en",
      description:
        "Independent Syrian radio station broadcasting in Arabic and Kurdish from Paris. Produces news, human rights reporting, and cultural content.",
      capabilities:
        "Bilingual Arabic and Kurdish broadcasting · Diaspora and inside-Syria reach · Human rights reporting · EU-based operations",
    },
    {
      name: "Enab Baladi",
      url: "https://english.enabbaladi.net/",
      description:
        "Syrian civil society newspaper covering humanitarian issues, governance, and daily life. Has English-language edition and strong local reporter network.",
      capabilities:
        "Ground-level reporting inside Syria · Local correspondent network · English and Arabic content · Humanitarian focus",
    },
  ],
};

export default function AdminBidAnalysisPage() {
  const [form, setForm] = useState<AdminBidNoBidRequest>(CIM_SYR_DEFAULTS);
  const [memberJson, setMemberJson] = useState(() =>
    JSON.stringify(CIM_SYR_DEFAULTS.consortium_members, null, 2)
  );
  const [memberJsonError, setMemberJsonError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function field(key: keyof AdminBidNoBidRequest) {
    return {
      value: (form[key] as string) ?? "",
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setForm((prev) => ({ ...prev, [key]: e.target.value })),
    };
  }

  function handleMemberJsonChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const raw = e.target.value;
    setMemberJson(raw);
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("Must be a JSON array");
      setForm((prev) => ({ ...prev, consortium_members: parsed }));
      setMemberJsonError(null);
    } catch (err) {
      setMemberJsonError(err instanceof Error ? err.message : "Invalid JSON");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (memberJsonError) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/bid-no-bid", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `${res.status} ${res.statusText}`);
      } else {
        setResult(body as ApiResult);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  const out = result?.output;
  const req = result?.requirements;

  return (
    <div style={{ maxWidth: 960 }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "#78716c", marginBottom: 6 }}>
          Admin · Bid / No-Bid Test
        </div>
        <h1 style={{ fontFamily: SERIF, fontSize: 32, fontWeight: 400, margin: 0, lineHeight: 1.1, color: "#1c1917" }}>
          Analysis workbench
        </h1>
        <p style={{ marginTop: 8, fontSize: 13, color: "#57534e", maxWidth: 600 }}>
          Run a bid/no-bid analysis without payment or a work order. Pre-filled with the CIM-SYR consortium and EC prospect 185831. Edit any field before submitting.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Tender section */}
        <section style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 6, padding: "20px 24px", marginBottom: 20 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "#a8a29e", marginBottom: 16 }}>
            01 · Tender details
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 20px" }}>
            <LabeledInput label="Title" {...field("tender_title")} />
            <LabeledInput label="Agency / Issuer" {...field("tender_agency")} />
            <LabeledInput label="Source URL" {...field("tender_url")} />
            <LabeledInput label="Deadline" {...field("tender_deadline")} placeholder="e.g. 2025-09-30" />
            <LabeledInput label="Estimated value" {...field("tender_value")} placeholder="e.g. EUR 500,000" />
            <LabeledInput label="Sector" {...field("tender_sector")} />
          </div>
          <LabeledTextarea label="Eligibility criteria" rows={4} {...field("tender_eligibility")} style={{ marginTop: 14 }} />
          <LabeledTextarea label="Full description / scope" rows={6} {...field("tender_description")} style={{ marginTop: 14 }} />
        </section>

        {/* Company section */}
        <section style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 6, padding: "20px 24px", marginBottom: 20 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "#a8a29e", marginBottom: 16 }}>
            02 · Applicant / consortium
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 20px" }}>
            <LabeledInput label="Organisation name" {...field("company_name")} />
            <LabeledInput label="Sector" {...field("company_sector")} />
            <LabeledInput label="Operating countries" {...field("company_countries")} style={{ gridColumn: "1 / -1" }} />
          </div>
          <LabeledTextarea label="Organisation description" rows={4} {...field("company_description")} style={{ marginTop: 14 }} />
          <LabeledTextarea label="Key capabilities" rows={3} {...field("company_capabilities")} style={{ marginTop: 14 }} />
          <LabeledTextarea label="Intake / analyst notes" rows={2} {...field("intake_notes")} style={{ marginTop: 14 }} />

          {/* Consortium members JSON */}
          <div style={{ marginTop: 20 }}>
            <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "#a8a29e", marginBottom: 6 }}>
              Consortium members (JSON array)
            </div>
            <textarea
              rows={14}
              value={memberJson}
              onChange={handleMemberJsonChange}
              style={{
                width: "100%",
                fontFamily: MONO,
                fontSize: 12,
                padding: "10px 12px",
                border: memberJsonError ? "1px solid #dc2626" : "1px solid #d6d3d1",
                borderRadius: 4,
                background: "#ffffff",
                resize: "vertical",
                boxSizing: "border-box",
                color: "#1c1917",
              }}
            />
            {memberJsonError && (
              <p style={{ fontFamily: MONO, fontSize: 11, color: "#dc2626", marginTop: 4 }}>
                {memberJsonError}
              </p>
            )}
            <p style={{ fontFamily: MONO, fontSize: 11, color: "#a8a29e", marginTop: 4 }}>
              Each item: {"{ name, url?, description?, capabilities? }"}. Leave as [] for a single organisation.
            </p>
          </div>
        </section>

        {/* Submit */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button
            type="submit"
            disabled={busy || !!memberJsonError}
            style={{
              background: busy ? "#78716c" : "#1c1917",
              color: "#ffffff",
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              padding: "10px 20px",
              border: "none",
              borderRadius: 3,
              cursor: busy || memberJsonError ? "not-allowed" : "pointer",
              opacity: busy || memberJsonError ? 0.7 : 1,
            }}
          >
            {busy ? "Running analysis…" : "Run bid/no-bid analysis →"}
          </button>
          {busy && (
            <span style={{ fontFamily: MONO, fontSize: 12, color: "#78716c" }}>
              Calling LLM pipeline (30–90 s) …
            </span>
          )}
        </div>
      </form>

      {/* Error */}
      {error && (
        <div style={{ marginTop: 24, borderLeft: "2px solid #dc2626", background: "#fef2f2", padding: "12px 16px", borderRadius: "0 4px 4px 0" }}>
          <div style={{ fontFamily: MONO, fontSize: 11, color: "#dc2626", fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 4 }}>
            Error
          </div>
          <p style={{ fontFamily: MONO, fontSize: 12, color: "#7f1d1d", margin: 0 }}>{error}</p>
        </div>
      )}

      {/* Result */}
      {out && (
        <div style={{ marginTop: 32 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "#a8a29e", marginBottom: 14 }}>
            Analysis result
          </div>

          {/* Verdict bar */}
          <div
            style={{
              borderLeft: `3px solid ${recBg(out.recommendation)}`,
              background: "#ffffff",
              border: "1px solid #e7e5e4",
              borderLeftWidth: 3,
              borderLeftColor: recBg(out.recommendation),
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div style={{ padding: "18px 22px", borderBottom: "1px solid #f5f5f4" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12, flexWrap: "wrap" }}>
                <span
                  style={{
                    background: recBg(out.recommendation),
                    color: "#fff",
                    fontFamily: MONO,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    padding: "5px 10px",
                    borderRadius: 3,
                  }}
                >
                  {out.recommendation}
                </span>
                <span style={{ fontFamily: MONO, fontSize: 11, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.15em" }}>
                  Win probability · {out.win_probability_band}
                </span>
                <span style={{ fontFamily: MONO, fontSize: 11, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.15em" }}>
                  Effort · {out.effort_estimate_hours} hrs
                </span>
              </div>
              <p style={{ fontFamily: SERIF, fontSize: 17, color: "#1c1917", margin: 0, lineHeight: 1.4 }}>
                {out.headline}
              </p>
            </div>

            {/* Two-col body */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
              {out.fit_reasoning.length > 0 && (
                <div style={{ padding: "16px 22px", borderBottom: "1px solid #f5f5f4" }}>
                  <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "#a8a29e", marginBottom: 10 }}>
                    Why it matches
                  </div>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                    {out.fit_reasoning.map((r, i) => (
                      <li key={i} style={{ display: "flex", gap: 8, fontSize: 13, color: "#292524", lineHeight: 1.45 }}>
                        <span style={{ color: "#b45309", flexShrink: 0 }}>·</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {out.gap_analysis.length > 0 && (
                <div style={{ padding: "16px 22px", borderBottom: "1px solid #f5f5f4", borderLeft: "1px solid #f5f5f4" }}>
                  <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "#a8a29e", marginBottom: 10 }}>
                    Gaps to close
                  </div>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                    {out.gap_analysis.map((g, i) => (
                      <li key={i}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                          <span style={{ fontFamily: MONO, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.14em", fontWeight: 700, color: sevColor(g.severity) }}>
                            {g.severity}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "#1c1917" }}>{g.gap}</span>
                        </div>
                        <p style={{ fontFamily: MONO, fontSize: 11, color: "#78716c", margin: "4px 0 0 0", paddingLeft: 36, lineHeight: 1.5 }}>
                          {g.fix}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Red flags */}
            {out.red_flags.length > 0 && (
              <div style={{ padding: "14px 22px", background: "#fff7f7", borderTop: "1px solid #fde8e8" }}>
                <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "#dc2626", marginBottom: 8 }}>
                  Red flags
                </div>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                  {out.red_flags.map((f, i) => (
                    <li key={i} style={{ fontSize: 13, color: "#7f1d1d" }}>· {f}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Conditions */}
            {out.recommendation === "conditional" && out.conditions_for_bid.length > 0 && (
              <div style={{ padding: "14px 22px", background: "#fffbeb", borderTop: "1px solid #fde68a" }}>
                <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "#b45309", marginBottom: 8 }}>
                  Conditions to convert to a bid
                </div>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                  {out.conditions_for_bid.map((c, i) => (
                    <li key={i} style={{ fontSize: 13, color: "#78350f" }}>· {c}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Next steps */}
            {out.next_steps.length > 0 && (
              <div style={{ padding: "14px 22px", borderTop: "1px solid #f5f5f4" }}>
                <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "#a8a29e", marginBottom: 10 }}>
                  Next steps
                </div>
                <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  {out.next_steps.map((s, i) => (
                    <li key={i} style={{ display: "flex", gap: 12, fontSize: 13, color: "#292524" }}>
                      <span style={{ fontFamily: MONO, fontSize: 11, color: "#b45309", flexShrink: 0, minWidth: 24 }}>
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* Required documents */}
            {out.required_documents.length > 0 && (
              <div style={{ padding: "14px 22px", borderTop: "1px solid #f5f5f4" }}>
                <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "#a8a29e", marginBottom: 10 }}>
                  Required documents ({out.required_documents.length})
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {out.required_documents.map((d, i) => (
                    <div key={i} style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                      <span style={{ fontFamily: MONO, fontSize: 10, color: "#a8a29e", flexShrink: 0, minWidth: 20 }}>
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#1c1917" }}>{d.document}</span>
                        <span style={{ fontFamily: MONO, fontSize: 11, color: "#78716c", marginLeft: 8 }}>
                          {d.why_needed}
                          {d.estimated_effort_hours != null && ` · ~${d.estimated_effort_hours}h`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Evidence */}
            {(out.evidence.tender_excerpt || out.evidence.company_capabilities_matched.length > 0) && (
              <div style={{ padding: "14px 22px", borderTop: "1px solid #f5f5f4", background: "#fafaf9" }}>
                <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "#a8a29e", marginBottom: 10 }}>
                  Evidence
                </div>
                {out.evidence.tender_excerpt && (
                  <blockquote style={{ fontFamily: MONO, fontSize: 11, color: "#57534e", borderLeft: "2px solid #d6d3d1", margin: "0 0 12px 0", padding: "6px 12px", lineHeight: 1.6 }}>
                    {out.evidence.tender_excerpt}
                  </blockquote>
                )}
                {out.evidence.company_capabilities_matched.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <span style={{ fontFamily: MONO, fontSize: 10, color: "#166534", textTransform: "uppercase", letterSpacing: "0.14em", marginRight: 8 }}>Matched</span>
                    {out.evidence.company_capabilities_matched.map((c, i) => (
                      <span key={i} style={{ fontFamily: MONO, fontSize: 11, background: "#dcfce7", color: "#166534", padding: "2px 6px", borderRadius: 3, marginRight: 6 }}>{c}</span>
                    ))}
                  </div>
                )}
                {out.evidence.company_capabilities_missing.length > 0 && (
                  <div>
                    <span style={{ fontFamily: MONO, fontSize: 10, color: "#991b1b", textTransform: "uppercase", letterSpacing: "0.14em", marginRight: 8 }}>Missing</span>
                    {out.evidence.company_capabilities_missing.map((c, i) => (
                      <span key={i} style={{ fontFamily: MONO, fontSize: 11, background: "#fee2e2", color: "#991b1b", padding: "2px 6px", borderRadius: 3, marginRight: 6 }}>{c}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Extracted requirements */}
          {req && (
            <details style={{ marginTop: 20 }}>
              <summary style={{ fontFamily: MONO, fontSize: 11, color: "#78716c", cursor: "pointer", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                Extracted tender requirements (debug)
              </summary>
              <pre style={{ fontFamily: MONO, fontSize: 11, background: "#f5f5f4", padding: "12px 16px", borderRadius: 4, marginTop: 10, overflow: "auto", color: "#292524", lineHeight: 1.6 }}>
                {JSON.stringify(req, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

/* ---- Small form helpers ---- */

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  style?: React.CSSProperties;
}

function LabeledInput({ label, style, ...props }: InputProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, ...style }}>
      <label style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "#78716c" }}>
        {label}
      </label>
      <input
        {...props}
        style={{
          fontFamily: MONO,
          fontSize: 12,
          padding: "7px 10px",
          border: "1px solid #d6d3d1",
          borderRadius: 4,
          background: "#ffffff",
          color: "#1c1917",
          outline: "none",
        }}
      />
    </div>
  );
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  style?: React.CSSProperties;
}

function LabeledTextarea({ label, style, ...props }: TextareaProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, ...style }}>
      <label style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "#78716c" }}>
        {label}
      </label>
      <textarea
        {...props}
        style={{
          fontFamily: MONO,
          fontSize: 12,
          padding: "8px 10px",
          border: "1px solid #d6d3d1",
          borderRadius: 4,
          background: "#ffffff",
          color: "#1c1917",
          resize: "vertical",
          lineHeight: 1.55,
          outline: "none",
          width: "100%",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}
