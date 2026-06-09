/* Workbench view model — the single data contract shared by the
 * `/api/dashboard/workbench` endpoint (server) and the Workbench UI (client).
 *
 * Everything here is a *view* shape: it is derived from the real backend
 * (assessments, pipeline_items, vault_documents, work_orders) by
 * `src/lib/workbench/build.ts` and rendered by `src/components/workbench/*`.
 * It deliberately mirrors the design-handoff mock shapes (COMPANY, READINESS,
 * PIPELINE, GAPS, MATCHES …) so the prototype screens map 1:1, but every field
 * is populated from data the platform actually holds — never invented. */

export type BucketKey = "act_now" | "strong_fit" | "strategic" | "adjacent" | "watchlist";

/** A click target the client maps to a nav/overlay action. Keeps page
 *  components presentational — the server decides *what* the next action is,
 *  the client only knows *how* to perform each kind. */
export type WbAction =
  | { kind: "navigator"; gapId: string }
  | { kind: "paste"; matchId?: number }
  | { kind: "route"; to: string } // workbench route id (matches/gaps/browse/proposals/account) or absolute path
  | { kind: "vault" }
  | { kind: "subscribe" };

export interface WbCompany {
  name: string;
  fileNo: string;
  sector: string;
  country: string;
  user: string;
  trialDays: number;
}

export interface WbReadiness {
  score: number;
  delta: number;
  tier: string;
  /** [label, value] rows for the 5-bar breakdown. */
  dims: [string, number][];
  line: string;
}

export interface WbPipeline {
  matched: number;
  strong: number;
  active: number;
  submitted: number;
  dueSoon: number;
  total: number;
}

export interface NavigatorStep {
  t: string;
  detail: string;
  copy?: string;
  /** External URL, or the literal "vault" to open the Document Vault drawer. */
  link?: string;
  /** Optional levels table: [name, cost/eta, what it unlocks]. */
  levels?: [string, string, string][];
}

export interface NavigatorScript {
  /** "guided" walks steps; "review" is an already-covered confirmation. */
  kind: "guided" | "review";
  est: string;
  intro: string;
  steps: NavigatorStep[];
  done: string;
}

export interface WbGap {
  /** Stable key: a recognized type ("ungm", "financials", "iso-9001",
   *  "references", …) when detectable, else "g{index}". Deep-links from the
   *  Overview "next move", the Paste ledger, and the Vault target this. */
  id: string;
  severity: "high" | "medium" | "low";
  status: "open" | "covered";
  /** Projected score uplift when closed (0 once covered — already folded in). */
  impact: number;
  /** Human effort estimate, e.g. "15 min", "6–8 weeks". */
  eta: string;
  title: string;
  why: string;
  fixLabel: string;
  /** assessment_step_completions keys (g{idx}-s{j}) for real persistence. */
  stepKeys: string[];
  /** Persistence key for "gap marked closed" (g{idx}-closed) — drives the live
   *  score and survives reload. */
  closeKey: string;
  stepsDone: number;
  copilot: NavigatorScript;
}

export interface WbMatch {
  /** Stable React key (real tender id when present, else list index). */
  id: number;
  /** Real tenders.id for pipeline/feedback writes — null when the matched
   *  tender wasn't persisted to the tenders table (cannot be acted on server-side). */
  tenderId: number | null;
  code: string;
  title: string;
  agency: string;
  type: string;
  source: string;
  deadline: string | null;
  value: string;
  fit: number;
  bucket: BucketKey;
  why: string;
  sectors: string[];
  roster: boolean;
  caveat?: string | null;
  sourceUrl?: string | null;
}

export interface WbSubmission {
  id: number;
  tender: string;
  agency: string | null;
  type: string;
  status: string;
  stage: string;
  price: number | null;
  due: string | null;
  updated: string | null;
  href: string;
}

export interface WbNextMove {
  eyebrow: string;
  title: string;
  body: string;
  primary: { label: string; action: WbAction } | null;
  secondary: { label: string; action: WbAction } | null;
  thenThisWeek: { label: string; meta: string; action: WbAction }[];
}

export interface WbAccess {
  hasAccess: boolean;
  reason: string;
  trialDaysLeft: number;
  isTrialing: boolean;
  locked: boolean;
  isPaid: boolean;
}

export interface WbVaultSummary {
  onFile: number;
  total: number;
  missing: number;
}

/* ── Browse (full tender database) ─────────────────────────── */
export interface WbBrowseRow {
  id: number;
  /** Real tenders.id for seeding the Paste/score flow. */
  tenderId: number;
  code: string;
  title: string;
  agency: string;
  type: string;
  source: string;
  deadline: string | null;
  value: string;
  sector: string | null;
  country: string | null;
  /** The viewer's fit for this tender if it's one of their matches, else null. */
  fit: number | null;
  matched: boolean;
  sourceUrl: string | null;
}

export interface WbFacet {
  value: string;
  count: number;
}

export interface WbBrowseResult {
  tenders: WbBrowseRow[];
  facets: { sector: WbFacet[]; type: WbFacet[]; source: WbFacet[] };
  total: number;
  page: number;
  pageSize: number;
}

export interface WorkbenchData {
  hasAssessment: boolean;
  assessmentStatus: "computing" | "ready" | "failed" | null;
  reportId: string | null;
  company: WbCompany;
  readiness: WbReadiness;
  pipeline: WbPipeline;
  nextMove: WbNextMove | null;
  gaps: WbGap[];
  /** Gap ids the user has marked closed (persisted) — seeds the live score so
   *  it survives reload. */
  acknowledgedGapIds: string[];
  matches: WbMatch[];
  submissions: WbSubmission[];
  vault: WbVaultSummary;
  access: WbAccess;
}
