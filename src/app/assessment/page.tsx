"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { AssessmentInput, TierSlug, Gap, MatchedTender, MatchedGrant, ReadinessDimensions } from "@/lib/types";
import { Step1, Step2, Step3, type WizardData, type CrawlPreview } from "./WizardSteps";
import OpportunitySignal from "@/components/assessment/OpportunitySignal";
import { C, F } from "@/components/workbench/tokens";
import { useMedia } from "@/components/workbench/useMedia";
import { FlowChrome } from "@/components/assessment/flow/FlowChrome";
import { EntryScreen } from "@/components/assessment/flow/EntryScreen";
import { AnalyzingScreen } from "@/components/assessment/flow/AnalyzingScreen";

// Audit 2026-05-19 P2 #14: landing-page CTAs pass ?goal=<intent> so the
// wizard pre-selects the intent chip in Step 1. Saves a click and gives us
// funnel attribution. Must stay in sync with INTENT_OPTIONS in WizardSteps.tsx.
const VALID_GOAL_PARAMS = new Set([
  "track-tenders",
  "evaluate-tender",
  "prepare-proposal",
  "register-roster",
]);

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
  // UUID capability id — used to hand off to the canonical /assessment/[id]
  // report view once the pipeline completes.
  public_id: string;
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

// After "analyzing" completes the wizard hands off to /assessment/[id]
// (the shared report chrome), so there is no inline "results" phase.
type WizardPhase = "entry" | "crawling" | "step1" | "step2" | "step3" | "analyzing";

const STEP_LABELS = ["Company basics", "What you do", "Experience"];
const STEP_TIME_REMAINING = ["~120s left", "~80s left", "~30s left"];

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

/* ── Per-step progress strip (within the Profile stage) ─────────────────── */
function WizardProgress({ phase }: { phase: WizardPhase }) {
  const stepPhases: WizardPhase[] = ["step1", "step2", "step3"];
  const activeIdx = stepPhases.indexOf(phase);
  if (activeIdx === -1) return null;

  return (
    <div style={{ marginBottom: 40, paddingBottom: 24, borderBottom: `1px solid ${C.rule}` }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
        <span style={{ fontFamily: F.mono, fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: C.accent }}>
          Step {String(activeIdx + 1).padStart(2, "0")} of 03
        </span>
        <span style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: C.mute, fontVariantNumeric: "tabular-nums" }}>
          {STEP_TIME_REMAINING[activeIdx]}
        </span>
      </div>
      <h2 style={{ fontFamily: F.display, fontSize: 34, fontWeight: 400, lineHeight: 1.05, letterSpacing: "-0.02em", color: C.ink, margin: "0 0 20px" }}>
        {STEP_LABELS[activeIdx]}
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
        {STEP_LABELS.map((label, i) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ height: 3, background: i <= activeIdx ? C.accent : C.rule }} />
            <span style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: i === activeIdx ? C.ink : i < activeIdx ? C.mute : C.faint }}>
              {String(i + 1).padStart(2, "0")} · {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginBottom: 24,
        border: `1px solid ${C.neg}`,
        background: "rgba(156,42,42,0.06)",
        padding: "12px 16px",
        fontFamily: F.mono,
        fontSize: 12,
        color: C.neg,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

function CrawlingBeat({ site }: { site: string }) {
  return (
    <div style={{ paddingTop: 32 }}>
      <div style={{ fontFamily: F.mono, fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: C.accent, marginBottom: 14 }}>
        Reading your website
      </div>
      <h2 style={{ fontFamily: F.display, fontSize: 34, fontWeight: 400, lineHeight: 1.05, letterSpacing: "-0.02em", color: C.ink, margin: "0 0 12px" }}>
        Detecting your business profile…
      </h2>
      <p style={{ fontFamily: F.sans, fontSize: 14, color: C.ink2, marginBottom: 30 }}>
        5–10 seconds. We&rsquo;ll pre-fill the form with what we read.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            width: 16,
            height: 16,
            border: `2px solid ${C.rule}`,
            borderTopColor: C.accent,
            borderRadius: 999,
            display: "inline-block",
            animation: "spin 0.8s linear infinite",
          }}
        />
        <span style={{ fontFamily: F.mono, fontSize: 11, letterSpacing: "0.06em", color: C.mute }}>
          Crawling {site.replace(/^https?:\/\//, "")}…
        </span>
      </div>
    </div>
  );
}

// useSearchParams forces the consuming subtree into a Suspense boundary at
// build time. Wrap the wizard so static prerender stays happy.
export default function AssessmentPage() {
  return (
    <Suspense fallback={null}>
      <AssessmentWizard />
    </Suspense>
  );
}

function AssessmentWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mobile = useMedia("(max-width: 860px)");
  const goalParam = searchParams.get("goal");
  const initialIntent =
    goalParam && VALID_GOAL_PARAMS.has(goalParam) ? goalParam : "";

  const [phase, setPhase] = useState<WizardPhase>("entry");
  const [entryUrl, setEntryUrl] = useState("");
  const [preview, setPreview] = useState<CrawlPreview | null>(null);
  const [wizard, setWizard] = useState<WizardData>({
    ...INITIAL_DATA,
    intent: initialIntent,
  });
  const [error, setError] = useState<string | null>(null);
  const [authedEmail, setAuthedEmail] = useState<string | null>(null);
  // Guards the landing ?site= hand-off so the auto-crawl fires exactly once.
  const autoCrawlStarted = useRef(false);

  // Detect signed-in users so the chrome can show its auth state instead of
  // looking like an anonymous landing — otherwise users bounced here from
  // /dashboard (when they have no assessment yet) assume they're signed out.
  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    let cancelled = false;
    fetch("/api/auth/me", { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.email) return;
        setAuthedEmail(data.email as string);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const patch = useCallback((p: Partial<WizardData>) => setWizard((d) => ({ ...d, ...p })), []);

  const startCrawl = useCallback(async (explicitUrl?: string) => {
    // explicitUrl lets the landing paste-box hand-off (?site=) crawl without
    // waiting for entryUrl state to settle. Guard the type so an onClick event
    // object can never be mistaken for a URL.
    const url = (typeof explicitUrl === "string" ? explicitUrl : entryUrl).trim();
    if (!url) { setPhase("step1"); return; }
    setEntryUrl(url);
    setPhase("crawling");
    setError(null);
    try {
      const res = await fetch("/api/assessment/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website: url }),
      });
      const data = (await res.json()) as CrawlPreview & { error?: string };
      if (!data.error) {
        setPreview(data);
        setWizard((d) => ({
          ...d,
          website: url,
          companyName: d.companyName || data.detectedName || "",
          description: d.description || data.detectedDescription || "",
          sectors: d.sectors.length ? d.sectors : data.detectedSectors,
          capabilities: d.capabilities.length ? d.capabilities : data.detectedServices,
          orgType: d.orgType || data.detectedOrgType || "",
          operatingCountries: d.operatingCountries.length ? d.operatingCountries : (data.detectedCountries ?? []),
          submissionLanguage: d.submissionLanguage || data.detectedLanguage || "",
        }));
      } else {
        setWizard((d) => ({ ...d, website: url }));
      }
    } catch {
      setWizard((d) => ({ ...d, website: url }));
    }
    setPhase("step1");
  }, [entryUrl]);

  // Landing paste-box hand-off: ?site=<host> pre-fills the entry URL and kicks
  // off the crawl once, so "Score me" on the homepage flows straight into the
  // wizard's crawl → Step 1 without the user re-typing their site.
  useEffect(() => {
    if (autoCrawlStarted.current) return;
    const site = searchParams.get("site")?.trim();
    if (!site) return;
    autoCrawlStarted.current = true;
    setEntryUrl(site);
    void startCrawl(site);
  }, [searchParams, startCrawl]);

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
      if (!isQueuedAssessmentResponse(data)) {
        throw new Error("Assessment failed");
      }
      // Wait for the pipeline to finish before handing off, so the destination
      // renders the ready report rather than a computing state that doesn't
      // self-refresh. Then route to the canonical /assessment/[id] view — the
      // same AssessmentChrome the dashboard renders. The analyzing screen stays
      // up (animating) until the navigation resolves.
      await pollAssessment(data.poll_url);
      router.push(`/assessment/${data.public_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setPhase("step3");
    }
  }, [wizard, router]);

  const isWizardStep = (["step1", "step2", "step3"] as WizardPhase[]).includes(phase);

  return (
    <div style={{ minHeight: "100vh", background: C.paper, color: C.ink, display: "flex", flexDirection: "column", fontFamily: F.sans }}>
      <FlowChrome phase={phase} authedEmail={authedEmail} />

      <main
        style={{
          flex: 1,
          width: "100%",
          maxWidth: 1200,
          margin: "0 auto",
          padding: mobile ? "0 18px 64px" : "0 56px 80px",
          boxSizing: "border-box",
        }}
      >
        {phase === "entry" && (
          <EntryScreen
            initialUrl={entryUrl}
            authedEmail={authedEmail}
            onReadSite={(url) => void startCrawl(url)}
            onStartScratch={() => setPhase("step1")}
          />
        )}

        {phase === "analyzing" && (
          <>
            {error && (
              <div style={{ maxWidth: 720, margin: "0 auto", paddingTop: 28 }}>
                <ErrorBanner>{error}</ErrorBanner>
              </div>
            )}
            <AnalyzingScreen site={wizard.website || entryUrl} wizard={wizard} />
          </>
        )}

        {(phase === "crawling" || isWizardStep) && (
          <div className="d2-scope" style={{ maxWidth: 720, margin: "0 auto", paddingTop: mobile ? 24 : 40 }}>
            {error && <ErrorBanner>{error}</ErrorBanner>}

            {phase === "crawling" && <CrawlingBeat site={entryUrl} />}

            {isWizardStep && <WizardProgress phase={phase} />}

            {/* Live opportunity signal — appears once sector (Step 2) and
                country (Step 1) are both selected. */}
            {(phase === "step2" || phase === "step3") && (
              <OpportunitySignal sectors={wizard.sectors} countries={wizard.operatingCountries} />
            )}

            {phase === "step1" && (
              <Step1 data={wizard} preview={preview} onChange={patch} onNext={() => setPhase("step2")} />
            )}
            {phase === "step2" && (
              <Step2 data={wizard} preview={preview} onChange={patch} onBack={() => setPhase("step1")} onNext={() => setPhase("step3")} />
            )}
            {phase === "step3" && (
              <Step3 data={wizard} onChange={patch} onBack={() => setPhase("step2")} onNext={runAssessment} />
            )}
          </div>
        )}
      </main>

      <footer style={{ borderTop: `1px solid ${C.rule}`, padding: "32px 0", textAlign: "center" }}>
        <p style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: C.mute, margin: 0 }}>
          © {new Date().getFullYear()} TenderPath ·{" "}
          <Link href="/" style={{ color: C.mute, borderBottom: `1px solid ${C.rule}`, textDecoration: "none" }}>
            Back to home
          </Link>
        </p>
      </footer>
    </div>
  );
}
