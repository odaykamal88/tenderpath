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
}

type WizardPhase = "entry" | "crawling" | "step1" | "step2" | "step3" | "analyzing" | "results";

const STEP_LABELS = ["Company basics", "What you do", "Experience"];

const ANALYZING_MESSAGES = [
  "Crawling your website and confirming your profile…",
  "Classifying your sectors and capabilities…",
  "Scanning 2,000+ live tenders across 15+ UN agencies…",
  "Matching tenders to your confirmed capabilities…",
  "Scoring readiness dimensions and identifying gaps…",
];

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

function WizardProgress({ phase }: { phase: WizardPhase }) {
  const stepPhases: WizardPhase[] = ["step1", "step2", "step3"];
  const activeIdx = stepPhases.indexOf(phase);
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {STEP_LABELS.map((label, i) => (
        <div key={label} className="flex items-center">
          <div className="flex flex-col items-center">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
              activeIdx > i ? "bg-green border-green text-white" :
              activeIdx === i ? "border-gold text-gold" :
              "border-gray-600 text-gray-600"
            }`}>
              {activeIdx > i ? (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : i + 1}
            </div>
            <span className={`text-[10px] mt-1 whitespace-nowrap ${activeIdx >= i ? "text-gray-300" : "text-gray-600"}`}>
              {label}
            </span>
          </div>
          {i < 2 && <div className={`w-14 sm:w-20 h-px mx-2 mb-4 ${activeIdx > i ? "bg-green" : "bg-gray-700"}`} />}
        </div>
      ))}
    </div>
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
    } else {
      if (msgTimer.current) clearInterval(msgTimer.current);
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
      const data = await res.json() as CrawlPreview & { error?: string };
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
        body: JSON.stringify(buildAssessmentInput(wizard)),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Assessment failed");
      }
      setResults(await res.json());
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

  const stepPhases: WizardPhase[] = ["step1", "step2", "step3"];

  return (
    <div className="min-h-screen bg-navy text-white">
      <nav className="border-b border-white/10">
        <div className="mx-auto max-w-7xl px-6 flex h-14 items-center justify-between">
          <Link href="/" className="text-lg font-semibold">Tender<span className="text-gold">Path</span></Link>
          <div className="hidden sm:flex items-center gap-6 text-sm text-gray-400">
            <Link href="/#how-it-works" className="hover:text-white transition-colors">How It Works</Link>
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-2xl px-6 pt-8 pb-16">
        {stepPhases.includes(phase) && <WizardProgress phase={phase} />}

        {error && (
          <div className="mb-6 rounded-lg bg-red/10 border border-red/30 px-4 py-3 text-sm text-red">{error}</div>
        )}

        {/* Entry */}
        {phase === "entry" && (
          <div>
            <div className="text-center mb-8">
              <h1 className="font-serif text-3xl font-bold mb-2">Free Vendor Readiness Assessment</h1>
              <p className="text-gray-400 text-sm">Match your business to 2,000+ live UN tenders. Takes 3 minutes.</p>
            </div>
            <div className="max-w-md mx-auto space-y-3">
              <div className="rounded-xl border border-white/10 bg-navy-light/40 p-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Your company website</label>
                  <input
                    type="text"
                    value={entryUrl}
                    onChange={(e) => setEntryUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && entryUrl.trim() && startCrawl()}
                    placeholder="yourcompany.com"
                    className="w-full rounded-lg bg-navy border border-white/10 px-4 py-3 text-sm text-white placeholder:text-gray-500 focus:border-gold focus:outline-none"
                  />
                </div>
                {entryUrl.trim() ? (
                  <>
                    <button onClick={startCrawl}
                      className="w-full rounded-lg bg-gold py-3 text-sm font-semibold text-white hover:bg-gold-dark transition-colors flex items-center justify-center gap-2">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                      </svg>
                      Autocomplete with AI →
                    </button>
                    <button type="button"
                      onClick={() => { setWizard((d) => ({ ...d, website: entryUrl.trim() })); setPhase("step1"); }}
                      className="w-full text-center text-xs text-gray-500 hover:text-gray-300 transition-colors py-1">
                      Skip AI — I&apos;ll fill manually instead
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setPhase("step1")}
                      className="w-full rounded-lg border border-white/15 bg-white/5 py-3 text-sm font-medium text-gray-300 hover:bg-white/10 hover:text-white transition-colors">
                      Start assessment →
                    </button>
                    <p className="text-center text-xs text-gray-600">Enter your website above to auto-fill your profile with AI</p>
                  </>
                )}
              </div>

              <div className="rounded-xl border border-white/8 bg-navy-light/20 p-4">
                <p className="text-xs font-semibold text-gold uppercase tracking-wider mb-3">What you&apos;ll receive</p>
                <ul className="space-y-2">
                  {[
                    "Vendor Readiness Score across 5 dimensions",
                    "Matched tenders & grants from 15+ UN agencies",
                    "Compliance gap analysis with specific fixes",
                    "Recommended next steps based on your profile",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2 text-xs text-gray-400">
                      <svg className="h-3.5 w-3.5 mt-0.5 text-gold flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Crawling */}
        {phase === "crawling" && (
          <div className="text-center py-16">
            <div className="relative mx-auto mb-6 w-14 h-14">
              <div className="absolute inset-0 rounded-full bg-gold/10 animate-ping" />
              <div className="relative w-14 h-14 border-4 border-gold/20 border-t-gold rounded-full animate-spin" />
            </div>
            <h2 className="font-serif text-xl font-bold mb-2">Reading your website…</h2>
            <p className="text-gray-400 text-sm">AI is detecting your business profile. 5–10 seconds.</p>
          </div>
        )}

        {/* Wizard steps */}
        {phase === "step1" && <Step1 data={wizard} preview={preview} onChange={patch} onNext={() => setPhase("step2")} />}
        {phase === "step2" && <Step2 data={wizard} preview={preview} onChange={patch} onBack={() => setPhase("step1")} onNext={() => setPhase("step3")} />}
        {phase === "step3" && <Step3 data={wizard} onChange={patch} onBack={() => setPhase("step2")} onNext={runAssessment} />}

        {/* Analyzing */}
        {phase === "analyzing" && (
          <div className="text-center py-12">
            <div className="relative mx-auto mb-8 w-16 h-16">
              <div className="absolute inset-0 rounded-full bg-gold/10 animate-ping" />
              <div className="relative w-16 h-16 border-4 border-gold/20 border-t-gold rounded-full animate-spin" />
            </div>
            <h2 className="font-serif text-2xl font-bold mb-2">Running your assessment…</h2>
            <p className="text-sm text-gray-400 mb-8">Matching tenders and scoring readiness — 15–30 seconds.</p>
            <div className="max-w-sm mx-auto space-y-3 text-left">
              {ANALYZING_MESSAGES.map((msg, i) => (
                <div key={msg} className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                    analysisMsg > i ? "bg-green" : analysisMsg === i ? "border border-gold bg-gold/10" : "border border-white/10"
                  }`}>
                    {analysisMsg > i ? (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : analysisMsg === i ? (
                      <div className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse" />
                    ) : null}
                  </div>
                  <span className={`text-sm transition-colors ${
                    analysisMsg > i ? "text-green" : analysisMsg === i ? "text-gold font-medium" : "text-gray-600"
                  }`}>{msg}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        {phase === "results" && results && (
          <AssessmentResults data={results} onReset={reset} />
        )}
      </div>

      <footer className="border-t border-white/5 py-6 text-center text-xs text-gray-500">
        &copy; {new Date().getFullYear()} TenderPath. All rights reserved.{" "}
        <Link href="/" className="underline hover:text-gray-300">Back to Home</Link>
      </footer>
    </div>
  );
}
