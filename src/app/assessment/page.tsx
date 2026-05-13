"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import type { AssessmentInput, TierSlug, Gap, MatchedTender, MatchedGrant, ReadinessDimensions } from "@/lib/types";
import AssessmentResults from "./AssessmentResults";
import { Step1, Step2, Step3, type WizardData, type CrawlPreview } from "./WizardSteps";

interface AssessmentResponse {
  id: number;
  company_name: string;
  email: string;
  status?: "queued" | "running" | "completed" | "failed";
  sector: string;
  sectors: string[];
  readiness_score: number;
  grant_readiness_score: number;
  recommended_tier: TierSlug;
  summary: string;
  strengths: string[];
  capabilities: string[];
  certifications_detected: string[];
  readiness_dimensions: ReadinessDimensions;
  gaps: Gap[];
  matched_tenders: MatchedTender[];
  matched_grants: MatchedGrant[];
  assessment_duration_ms?: number | null;
  assessment_timings?: Record<string, number>;
}

interface QueuedAssessmentResponse {
  id: number;
  status: "queued";
  queued: true;
  poll_url: string;
}

interface AssessmentPollResponse {
  id: number;
  company_name: string | null;
  email: string | null;
  sector: string | null;
  countries?: string[];
  ai_analysis?: {
    detected_industry?: string;
    sectors?: string[];
    services?: string[];
    capabilities?: string[];
    certifications_detected?: string[];
    strengths?: string[];
    gaps?: Gap[];
    readiness_dimensions?: ReadinessDimensions;
    overall_score?: number;
    summary?: string;
  } | null;
  readiness_score: number | null;
  grant_readiness_score: number | null;
  recommended_tier: TierSlug | null;
  gaps: Gap[] | null;
  matched_tenders: MatchedTender[] | null;
  matched_grants: MatchedGrant[] | null;
  status: "queued" | "running" | "completed" | "failed";
  assessment_status?: "queued" | "running" | "completed" | "failed";
  assessment_error?: string | null;
  assessment_duration_ms?: number | null;
  assessment_timings?: Record<string, number>;
}

type WizardPhase = "entry" | "crawling" | "step1" | "step2" | "step3" | "analyzing" | "results";

const STEP_LABELS = ["Company basics", "What you do", "Experience"];
const STEP_TIME_REMAINING = ["~120s left", "~80s left", "~30s left"];

const ANALYZING_MESSAGES = [
  "Crawling your website and confirming your profile",
  "Classifying your sectors and capabilities",
  "Scanning 2,000+ live tenders across 15+ UN agencies",
  "Matching tenders to your confirmed capabilities",
  "Scoring readiness dimensions and identifying gaps",
];

const ASSESSMENT_POLL_INTERVAL_MS = 2500;
const ASSESSMENT_POLL_TIMEOUT_MS = 240000;

const INITIAL_DATA: WizardData = {
  website: "",
  companyName: "",
  email: "",
  orgType: "",
  intent: "",
  operatingCountries: [],
  submissionLanguage: "",
  description: "",
  sectors: [],
  capabilities: [],
  devThemes: [],
  contractVolume: "",
  maxContractValue: "",
  unRegistered: "",
  certifications: [],
};

function buildAssessmentInput(data: WizardData): AssessmentInput {
  const parts: string[] = [];
  if (data.capabilities.length) parts.push(`Services: ${data.capabilities.join(", ")}`);
  if (data.certifications.length) parts.push(`Certifications: ${data.certifications.join(", ")}`);
  if (data.contractVolume) parts.push(`Past contract volume: ${data.contractVolume}`);
  if (data.maxContractValue) parts.push(`Largest contract value: ${data.maxContractValue}`);
  if (data.unRegistered) parts.push(`UNGM registration: ${data.unRegistered}`);
  if (data.submissionLanguage) parts.push(`Submission language: ${data.submissionLanguage}`);

  return {
    companyName: data.companyName,
    email: data.email,
    website: data.website || undefined,
    description: data.description || data.sectors.join(", "),
    countries: data.operatingCountries,
    adjacentSectors: [],
    additionalCapabilities: parts.join(". ") || undefined,
    orgType: data.orgType || undefined,
    devThemes: data.devThemes.length ? data.devThemes : undefined,
    includeConsultancies: false,
    intent: data.intent || undefined,
  };
}

function normalizeAssessmentResponse(data: AssessmentResponse | AssessmentPollResponse): AssessmentResponse {
  const analysis = "ai_analysis" in data ? data.ai_analysis : null;
  const sector =
    data.sector ||
    analysis?.detected_industry ||
    analysis?.sectors?.[0] ||
    "General";
  const sectors =
    "sectors" in data && Array.isArray(data.sectors) && data.sectors.length
      ? data.sectors
      : analysis?.sectors?.length
      ? analysis.sectors
      : [sector];

  return {
    id: data.id,
    company_name: data.company_name || "Your company",
    email: data.email || "",
    status: data.status,
    sector,
    sectors,
    readiness_score: data.readiness_score ?? analysis?.overall_score ?? 0,
    grant_readiness_score: data.grant_readiness_score ?? 0,
    recommended_tier: data.recommended_tier ?? "tender-intelligence",
    summary: "summary" in data && data.summary ? data.summary : analysis?.summary ?? "Assessment completed.",
    strengths: "strengths" in data && Array.isArray(data.strengths) ? data.strengths : analysis?.strengths ?? [],
    capabilities:
      "capabilities" in data && Array.isArray(data.capabilities)
        ? data.capabilities
        : analysis?.capabilities ?? analysis?.services ?? [],
    certifications_detected:
      "certifications_detected" in data && Array.isArray(data.certifications_detected)
        ? data.certifications_detected
        : analysis?.certifications_detected ?? [],
    readiness_dimensions:
      ("readiness_dimensions" in data && data.readiness_dimensions
        ? data.readiness_dimensions
        : analysis?.readiness_dimensions) ?? {
        technical_capability: 0,
        compliance_readiness: 0,
        geographic_reach: 0,
        experience_relevance: 0,
      },
    gaps: data.gaps ?? analysis?.gaps ?? [],
    matched_tenders: data.matched_tenders ?? [],
    matched_grants: data.matched_grants ?? [],
    assessment_duration_ms: data.assessment_duration_ms ?? null,
    assessment_timings: data.assessment_timings ?? {},
  };
}

async function pollAssessment(pollUrl: string): Promise<AssessmentResponse> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < ASSESSMENT_POLL_TIMEOUT_MS) {
    const res = await fetch(pollUrl, { cache: "no-store" });
    const data = (await res.json()) as AssessmentPollResponse & { error?: string };

    if (!res.ok) throw new Error(data.error || "Assessment failed");
    if (data.status === "failed" || data.assessment_status === "failed") {
      throw new Error(data.assessment_error || "Assessment failed");
    }
    if (data.status === "completed" || data.assessment_status === "completed") {
      return normalizeAssessmentResponse(data);
    }

    await new Promise((resolve) => setTimeout(resolve, ASSESSMENT_POLL_INTERVAL_MS));
  }

  throw new Error("Assessment is taking longer than expected. Please check your email shortly.");
}

function isQueuedAssessmentResponse(data: unknown): data is QueuedAssessmentResponse {
  return Boolean(
    data &&
      typeof data === "object" &&
      "queued" in data &&
      (data as QueuedAssessmentResponse).queued === true &&
      typeof (data as QueuedAssessmentResponse).poll_url === "string",
  );
}

/* ── Typographic progress strip ────────────────────────────────────────── */
function WizardProgress({ phase }: { phase: WizardPhase }) {
  const stepPhases: WizardPhase[] = ["step1", "step2", "step3"];
  const activeIdx = stepPhases.indexOf(phase);
  if (activeIdx === -1) return null;

  return (
    <div className="mb-12 pb-6 border-b border-rule">
      <div className="flex items-baseline justify-between mb-4">
        <p className="font-mono text-[11px] tracking-[0.18em] uppercase text-accent">
          Step {String(activeIdx + 1).padStart(2, "0")} of 03
        </p>
        <p className="font-mono text-[10px] tracking-[0.06em] uppercase text-mute tabular-nums">
          {STEP_TIME_REMAINING[activeIdx]}
        </p>
      </div>
      <h2 className="font-serif text-[32px] lg:text-[38px] font-normal leading-[1.05] tracking-[-0.02em] text-ink mb-5">
        {STEP_LABELS[activeIdx]}
      </h2>
      {/* Segmented progress bar */}
      <div className="grid grid-cols-3 gap-1.5">
        {STEP_LABELS.map((label, i) => (
          <div key={label} className="flex flex-col gap-2">
            <div
              className={`h-[3px] transition-colors ${
                i <= activeIdx ? "bg-accent" : "bg-rule"
              }`}
            />
            <p
              className={`font-mono text-[10px] tracking-[0.06em] uppercase ${
                i === activeIdx ? "text-ink" : i < activeIdx ? "text-ink-3" : "text-mute"
              }`}
            >
              {String(i + 1).padStart(2, "0")} · {label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Sample readiness card (shown on entry — "you'll get this") ────────── */
function SampleReadinessCard() {
  const dims = [
    { label: "Sector fit", score: 82 },
    { label: "Geography", score: 91 },
    { label: "Compliance", score: 58 },
    { label: "Track record", score: 64 },
    { label: "Documentation", score: 71 },
  ];
  return (
    <aside className="border border-ink bg-paper-2 p-6 lg:p-7">
      <div className="flex items-baseline justify-between mb-5 pb-4 border-b border-rule">
        <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-mute">
          Sample report
        </p>
        <p className="font-mono text-[10px] tracking-[0.06em] uppercase text-mute">
          Mwamba Consulting
        </p>
      </div>

      {/* Big score */}
      <div className="flex items-baseline gap-2 mb-1">
        <span className="font-serif text-[80px] lg:text-[96px] font-normal leading-none tracking-[-0.03em] text-ink tabular-nums">
          74
        </span>
        <span className="font-serif text-[28px] text-ink-3 leading-none">/100</span>
      </div>
      <p className="font-mono text-[10px] tracking-[0.12em] uppercase text-accent mb-6">
        Strong fit · Bid-ready in 14 days
      </p>

      {/* Dimensions */}
      <div className="space-y-3 pt-5 border-t border-rule">
        {dims.map((d) => (
          <div key={d.label} className="grid grid-cols-[1fr_auto] items-baseline gap-3">
            <div>
              <p className="text-[12px] text-ink mb-1.5">{d.label}</p>
              <div className="h-[2px] bg-rule">
                <div
                  className={d.score < 60 ? "h-full bg-red-700" : d.score < 75 ? "h-full bg-accent" : "h-full bg-ink"}
                  style={{ width: `${d.score}%` }}
                />
              </div>
            </div>
            <span className="font-mono text-[11px] text-ink-2 tabular-nums">{d.score}</span>
          </div>
        ))}
      </div>

      {/* Bottom strip */}
      <div className="grid grid-cols-2 gap-4 mt-6 pt-5 border-t border-rule">
        <div>
          <p className="font-serif text-[28px] leading-none text-ink tabular-nums">12</p>
          <p className="font-mono text-[9px] tracking-[0.08em] uppercase text-mute mt-1.5">
            Matched tenders
          </p>
        </div>
        <div>
          <p className="font-serif text-[28px] leading-none text-ink tabular-nums">3</p>
          <p className="font-mono text-[9px] tracking-[0.08em] uppercase text-mute mt-1.5">
            Compliance gaps
          </p>
        </div>
      </div>
    </aside>
  );
}

export default function AssessmentPage() {
  const [phase, setPhase] = useState<WizardPhase>("entry");
  const [entryUrl, setEntryUrl] = useState("");
  const [preview, setPreview] = useState<CrawlPreview | null>(null);
  const [wizard, setWizard] = useState<WizardData>(INITIAL_DATA);
  const [results, setResults] = useState<AssessmentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysisMsg, setAnalysisMsg] = useState(0);
  const msgTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const patch = useCallback((p: Partial<WizardData>) => setWizard((d) => ({ ...d, ...p })), []);

  useEffect(() => {
    if (phase === "analyzing") {
      setAnalysisMsg(0);
      msgTimer.current = setInterval(() => {
        setAnalysisMsg((n) => Math.min(n + 1, ANALYZING_MESSAGES.length - 1));
      }, 4000);
    } else if (msgTimer.current) {
      clearInterval(msgTimer.current);
    }
    return () => { if (msgTimer.current) clearInterval(msgTimer.current); };
  }, [phase]);

  const startCrawl = useCallback(async () => {
    if (!entryUrl.trim()) { setPhase("step1"); return; }
    setPhase("crawling");
    setError(null);
    try {
      const res = await fetch("/api/assessment/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website: entryUrl.trim() }),
      });
      const data = (await res.json()) as CrawlPreview & { error?: string };
      if (!data.error) {
        setPreview(data);
        setWizard((d) => ({
          ...d,
          website: entryUrl.trim(),
          companyName: d.companyName || data.detectedName || "",
          description: d.description || data.detectedDescription || "",
          sectors: d.sectors.length ? d.sectors : data.detectedSectors,
          capabilities: d.capabilities.length ? d.capabilities : data.detectedServices,
          orgType: d.orgType || data.detectedOrgType || "",
          operatingCountries: d.operatingCountries.length ? d.operatingCountries : (data.detectedCountries ?? []),
          submissionLanguage: d.submissionLanguage || data.detectedLanguage || "",
        }));
      } else {
        setWizard((d) => ({ ...d, website: entryUrl.trim() }));
      }
    } catch {
      setWizard((d) => ({ ...d, website: entryUrl.trim() }));
    }
    setPhase("step1");
  }, [entryUrl]);

  const runAssessment = useCallback(async () => {
    setPhase("analyzing");
    setError(null);
    try {
      const res = await fetch("/api/assessment/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...buildAssessmentInput(wizard), mode: "queued" }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Assessment failed");
      }
      const result = isQueuedAssessmentResponse(data)
        ? await pollAssessment(data.poll_url)
        : normalizeAssessmentResponse(data as AssessmentResponse);
      setResults(result);
      setPhase("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setPhase("step3");
    }
  }, [wizard]);

  const reset = useCallback(() => {
    setPhase("entry");
    setEntryUrl("");
    setPreview(null);
    setWizard(INITIAL_DATA);
    setResults(null);
    setError(null);
  }, []);

  const isWizardStep = (["step1", "step2", "step3"] as WizardPhase[]).includes(phase);

  return (
    <div className="min-h-screen bg-paper text-ink">
      {/* Editorial header */}
      <nav className="border-b border-rule bg-paper">
        <div className="mx-auto max-w-6xl px-6 lg:px-8 flex h-16 items-center justify-between">
          <Link href="/" className="font-serif text-[22px] font-medium tracking-[-0.01em] text-ink">
            Tender<span className="text-accent">·</span>Path
          </Link>
          <Link
            href="/"
            className="font-mono text-[11px] tracking-[0.12em] uppercase text-ink-3 hover:text-ink transition-colors"
          >
            ← Back to home
          </Link>
        </div>
      </nav>

      {/* ── ENTRY: hero + sample card right rail ─────────────────────────── */}
      {phase === "entry" && (
        <div className="mx-auto max-w-6xl px-6 lg:px-8 py-14 lg:py-20">
          <p className="font-mono text-[11px] tracking-[0.18em] uppercase text-accent mb-6">
            Free · No login · 5 minutes
          </p>
          <div className="grid lg:grid-cols-[1.2fr_1fr] gap-10 lg:gap-16 items-start">
            {/* Left — pitch + form */}
            <div>
              <h1 className="font-serif text-[44px] sm:text-[56px] lg:text-[68px] font-normal leading-[0.98] tracking-[-0.025em] text-ink text-balance mb-6">
                See your <em className="italic text-accent">readiness</em><br />
                before you draft<br />
                a single proposal.
              </h1>
              <p className="text-[16px] lg:text-[17px] text-ink-2 leading-[1.55] max-w-xl mb-10">
                Match your business to 2,000+ live UN tenders across 15+ agencies.
                Get a 5-dimension readiness score, gap analysis, and the specific
                opportunities worth your week of evenings.
              </p>

              {/* URL form */}
              <div className="border-t border-ink pt-8 mb-6">
                <label className="font-mono text-[10px] tracking-[0.16em] uppercase text-mute mb-3 block">
                  Step 00 · Your website (optional)
                </label>
                <div className="grid grid-cols-[1fr_auto] gap-0">
                  <input
                    type="text"
                    value={entryUrl}
                    onChange={(e) => setEntryUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && entryUrl.trim() && startCrawl()}
                    placeholder="yourcompany.com"
                    className="bg-transparent border-b border-ink px-0 py-3 font-serif text-[22px] text-ink placeholder:text-mute focus:outline-none focus:border-accent"
                  />
                  <button
                    onClick={startCrawl}
                    disabled={!entryUrl.trim()}
                    className="bg-ink text-paper font-mono text-[11px] tracking-[0.12em] uppercase px-6 hover:bg-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Read site →
                  </button>
                </div>
                <p className="font-mono text-[10px] tracking-[0.04em] text-mute mt-3">
                  We&rsquo;ll crawl your site, detect sectors and capabilities, and pre-fill the form.
                </p>
              </div>

              <div className="flex items-center gap-4">
                <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-mute">or</span>
                <button
                  onClick={() => setPhase("step1")}
                  className="font-mono text-[11px] tracking-[0.12em] uppercase text-ink border-b border-ink hover:text-accent hover:border-accent pb-1"
                >
                  Start from scratch · 3 min →
                </button>
              </div>

              {/* Bottom: what you get */}
              <ul className="grid sm:grid-cols-2 gap-x-8 gap-y-3 mt-12 pt-8 border-t border-rule">
                {[
                  "Vendor readiness score across 5 dimensions",
                  "Live tender + grant matches from 15+ agencies",
                  "Compliance gap analysis with specific fixes",
                  "Recommended next step based on your profile",
                ].map((item, i) => (
                  <li key={item} className="flex items-baseline gap-3">
                    <span className="font-mono text-[10px] tracking-[0.06em] text-mute tabular-nums">
                      0{i + 1}
                    </span>
                    <span className="text-[13px] text-ink-2 leading-snug">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Right — sample readiness card */}
            <div className="lg:sticky lg:top-24">
              <SampleReadinessCard />
              <p className="font-mono text-[10px] tracking-[0.06em] text-mute mt-4 text-center">
                You&rsquo;ll get a report like this · sample data shown
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── CRAWLING / WIZARD / ANALYZING / RESULTS ──────────────────────── */}
      {phase !== "entry" && (
        <div className="mx-auto max-w-3xl px-6 lg:px-8 py-12 lg:py-16">
          {error && (
            <div className="mb-6 border border-red-700 bg-red-50 px-4 py-3 font-mono text-[12px] text-red-900">
              {error}
            </div>
          )}

          {phase === "crawling" && (
            <div className="py-20">
              <p className="font-mono text-[11px] tracking-[0.18em] uppercase text-accent mb-4">
                Reading your website
              </p>
              <h2 className="font-serif text-[28px] sm:text-[32px] lg:text-[40px] font-normal leading-[1.05] tracking-[-0.02em] text-ink mb-3">
                Detecting your business profile…
              </h2>
              <p className="text-[14px] text-ink-2 mb-10">
                5–10 seconds. We&rsquo;ll pre-fill the form with what we read.
              </p>
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 border-2 border-rule border-t-accent rounded-full animate-spin" />
                <p className="font-mono text-[11px] tracking-[0.06em] text-ink-3">
                  Crawling {entryUrl.replace(/^https?:\/\//, "")}…
                </p>
              </div>
            </div>
          )}

          {isWizardStep && <WizardProgress phase={phase} />}

          {phase === "step1" && (
            <Step1 data={wizard} preview={preview} onChange={patch} onNext={() => setPhase("step2")} />
          )}
          {phase === "step2" && (
            <Step2
              data={wizard}
              preview={preview}
              onChange={patch}
              onBack={() => setPhase("step1")}
              onNext={() => setPhase("step3")}
            />
          )}
          {phase === "step3" && (
            <Step3 data={wizard} onChange={patch} onBack={() => setPhase("step2")} onNext={runAssessment} />
          )}

          {phase === "analyzing" && (
            <div className="py-12">
              <p className="font-mono text-[11px] tracking-[0.18em] uppercase text-accent mb-4">
                Running your assessment
              </p>
              <h2 className="font-serif text-[28px] sm:text-[32px] lg:text-[40px] font-normal leading-[1.05] tracking-[-0.02em] text-ink mb-3">
                Scoring readiness and matching tenders…
              </h2>
              <p className="text-[14px] text-ink-2 mb-10">15–30 seconds.</p>

              <ol className="space-y-0 border-t border-rule">
                {ANALYZING_MESSAGES.map((msg, i) => {
                  const done = analysisMsg > i;
                  const active = analysisMsg === i;
                  return (
                    <li
                      key={msg}
                      className="grid grid-cols-[44px_1fr_auto] gap-4 py-4 border-b border-rule items-baseline"
                    >
                      <span
                        className={`font-mono text-[11px] tracking-[0.06em] tabular-nums ${
                          done ? "text-accent" : active ? "text-ink" : "text-mute"
                        }`}
                      >
                        0{i + 1}
                      </span>
                      <span
                        className={`text-[14px] leading-snug ${
                          done ? "text-ink-3" : active ? "text-ink font-medium" : "text-mute"
                        }`}
                      >
                        {msg}
                      </span>
                      <span
                        className={`font-mono text-[10px] tracking-[0.1em] uppercase ${
                          done ? "text-accent" : active ? "text-ink-2" : "text-mute"
                        }`}
                      >
                        {done ? "Done" : active ? "Running…" : "Queued"}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {phase === "results" && results && <AssessmentResults data={results} onReset={reset} />}
        </div>
      )}

      <footer className="border-t border-rule py-8 text-center">
        <p className="font-mono text-[10px] tracking-[0.08em] uppercase text-mute">
          © {new Date().getFullYear()} TenderPath ·{" "}
          <Link href="/" className="border-b border-mute hover:text-ink hover:border-ink">
            Back to home
          </Link>
        </p>
      </footer>
    </div>
  );
}
