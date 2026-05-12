"use client";

import { useState } from "react";
import type { AdminBidNoBidRequest } from "@/app/api/admin/bid-no-bid/route";
import type { BidNoBidOutput, TenderRequirements } from "@/lib/bid-no-bid/types";

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";
const SERIF = "'Fraunces', 'Times New Roman', serif";

interface ApiResult {
  output: BidNoBidOutput;
  requirements: TenderRequirements;
  emailSent?: boolean;
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
  tender_title: "Support to justice, freedom of expression and social cohesion in Syria",
  tender_agency: "European Commission - International Partnerships / EuropeAid",
  tender_url:
    "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/prospect-details/185831PROSPECTSEN?isExactMatch=true&status=31094502&order=DESC&pageNumber=1&pageSize=50&sortBy=startDate",
  tender_deadline: "2026-05-18 10:00 UTC",
  tender_value: "Total budget EUR 13,350,000; grants EUR 675,000 to EUR 4,000,000; 70-100% co-financing",
  tender_sector: "Governance, rule of law, human rights, media freedom, social cohesion, civil society",
  tender_eligibility:
    "Lead applicant must be a legal person, non-profit-making, and a type of organisation such as a non-governmental organisation, public sector operator, or local authority. Lead applicant must be directly responsible for preparation and management of the action with co-applicants and affiliated entities, not an intermediary. Actions must take place in Syria. Concept note and lead applicant declaration are submitted online via PROSPECT.",
  tender_description:
    "Reference: EuropeAid/185831/DD/ACT/SY / 185831PROSPECTSEN. Global objective: contribute to sustainable and equitable development of communities in Syria and full enjoyment of all human rights by all. Specific lots: Lot 1 access to affordable justice for all in Syria; Lot 2 promotion of transitional justice processes in Syria; Lot 3 promotion of and support to media freedom and pluralism in Syria; Lot 4 promotion of social cohesion in Syria. Relevant to independent Syrian media under Lot 3 and potentially Lot 4. Submission is concept note stage via EU PROSPECT.",
  company_name: "Consortium of Syrian Independent Media (CSIM / CIM Syria)",
  company_sector: "Independent media, journalism, civil society, freedom of expression, media development",
  company_countries: "Syria; Syrian diaspora / regional operations",
  company_description:
    "The Consortium of Syrian Independent Media is a consortium of Syrian independent media organisations founded to strengthen sustainability, independence, solidarity, integrity, and collective influence of independent Syrian journalism. The consortium works in a landscape affected by conflict, displacement, and disinformation and aims to support a free and independent Syrian media landscape.",
  company_capabilities:
    "Independent journalism and editorial production · media freedom and pluralism · Syrian audience reach · multilingual and Arabic media production · conflict-sensitive reporting · civil-society communications · local knowledge of Syria · consortium coordination across independent media outlets · public-interest journalism · community trust and audience engagement",
  intake_notes:
    "Pre-deployment Tenderpath validation run requested by admin. Evaluate as a real bid/no-bid test for the consortium against Lot 3 media freedom/pluralism and possibly Lot 4 social cohesion. Be rigorous about likely EU eligibility, consortium governance, registration status, audited financial/admin capacity, co-applicant structure, PROSPECT documentation, and short time to concept note deadline.",
  consortium_members: [
    {
      name: "Al-Jumhuriya",
      url: "https://aljumhuriya.net/",
      description:
        "Independent Syrian media platform / knowledge-production publication covering Syrian politics, society, culture, and public debate.",
      capabilities:
        "Analysis · essays · journalism · civic debate · freedom of expression · Syrian intellectual and media networks",
    },
    {
      name: "ARTA for Media and Development",
      url: "https://www.artaorg.net/",
      description:
        "Media and development organisation working on the ground since 2013 in northeastern Syria / Rojava.",
      capabilities:
        "Local journalism · field reporting · media development · community storytelling · on-the-ground networks",
    },
    {
      name: "Radio Rozana",
      url: "https://www.rozana.fm/en",
      description:
        "Syrian independent radio/media outlet.",
      capabilities:
        "Broadcast/audio journalism · digital media · Syrian audience reach · independent reporting",
    },
    {
      name: "Enab Baladi",
      url: "https://english.enabbaladi.net/",
      description:
        "Independent Syrian media organization founded in 2011 with multilingual interactive websites and weekly newspaper coverage of Syrian political and social issues.",
      capabilities:
        "News coverage · investigations · multilingual publishing · print and digital journalism · Syrian civil-society coverage",
    },
  ],
};

export default function AdminBidAnalysisPage() {
  const [form, setForm] = useState<AdminBidNoBidRequest>(CIM_SYR_DEFAULTS);
  const [memberJson, setMemberJson] = useState(() =>
    JSON.stringify(CIM_SYR_DEFAULTS.consortium_members, null, 2)
  );
  const [memberJsonError, setMemberJsonError] = useState<string | null>(null);
  const [sendTo, setSendTo] = useState("");
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
        body: JSON.stringify({ ...form, ...(sendTo ? { send_to: sendTo } : {}) }),
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

        {/* Delivery */}
        <section style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 6, padding: "20px 24px", marginBottom: 20 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "#a8a29e", marginBottom: 16 }}>
            03 · Delivery (optional)
          </div>
          <LabeledInput
            label="Email PDF results to"
            type="email"
            value={sendTo}
            onChange={(e) => setSendTo(e.target.value)}
            placeholder="you@example.com — leave blank to skip"
            style={{ maxWidth: 360 }}
          />
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

      {/* Email sent notice */}
      {result?.emailSent && sendTo && (
        <div style={{ marginTop: 16, borderLeft: "2px solid #16a34a", background: "#f0fdf4", padding: "10px 16px", borderRadius: "0 4px 4px 0" }}>
          <span style={{ fontFamily: MONO, fontSize: 12, color: "#15803d" }}>
            PDF sent to {sendTo}
          </span>
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
