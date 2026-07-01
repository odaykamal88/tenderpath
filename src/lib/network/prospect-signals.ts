/**
 * Pure per-tender annotation for a prospect: compliance read + contestability
 * band + lite verdict. NO database access, NO side effects — safe to call from
 * the public read-only briefing page AND from the admin artifact generator (which
 * additionally logs to the calibration corpus). Keeping this pure is what lets the
 * briefing keep its "NEVER writes" isolation invariant while still showing the
 * richer read.
 */

import {
  resolveSubmissionPortal,
  assessRegistrationTiming,
  resolveUngmRequirement,
  type UngmLevel,
} from "@/lib/tenders/submission-portals";
import {
  classifyContestability,
  type ContestabilitySignal,
  type RegistrationRisk,
} from "@/lib/tenders/contestability";
import {
  buildProspectVerdict,
  fitTierFromScore,
  fitTierFromBand,
  type ProspectVerdict,
} from "./prospect-verdict";

/** Prospect-facing fit band (mirrors briefing.FitBand without importing server code). */
export type ProspectFitBand = "Excellent fit" | "Strong fit" | "Good fit";

export interface ComplianceRead {
  portalName: string;
  registrationUrl: string;
  leadTimeLabel: string;
  registrationRisk: RegistrationRisk;
  /** True when we have no verified agency-specific portal (honest generic guidance). */
  isFallback: boolean;
  /** Whether this buyer is a genuine UN-agency (UNGM) tender. */
  isUngm: boolean;
  /** Minimum UNGM level we can honestly assert is needed to bid (always 'basic' today). */
  ungmMinLevel: UngmLevel | null;
  ungmNote: string | null;
  daysUntilDeadline: number | null;
}

export interface ProspectTenderSignals {
  compliance: ComplianceRead;
  contestability: ContestabilitySignal;
  verdict: ProspectVerdict;
}

export interface ProspectSignalInput {
  title: string | null;
  agency: string | null;
  /** ISO deadline (or null). */
  deadline: string | null;
  opportunityType?: string | null;
  description?: string | null;
  isUngm: boolean;
  /** Fit as either the raw match score (admin path) or the public band. */
  fit: { kind: "score"; score: number } | { kind: "band"; band: ProspectFitBand };
}

export function annotateProspectTender(input: ProspectSignalInput): ProspectTenderSignals {
  const portal = resolveSubmissionPortal(input.agency);
  const timing = assessRegistrationTiming(input.deadline, portal);
  const ungmReq = input.isUngm ? resolveUngmRequirement(input.agency) : null;

  const compliance: ComplianceRead = {
    portalName: portal.portalName,
    registrationUrl: portal.registrationUrl,
    leadTimeLabel: portal.leadTimeLabel,
    registrationRisk: timing.firstTimeRisk,
    isFallback: Boolean(portal.isFallback),
    isUngm: input.isUngm,
    ungmMinLevel: ungmReq ? ungmReq.minLevelToBid : null,
    ungmNote: ungmReq ? ungmReq.note : null,
    daysUntilDeadline: timing.daysUntilDeadline,
  };

  const contestability = classifyContestability({
    title: input.title,
    description: input.description ?? null,
    opportunityType: input.opportunityType ?? null,
    registrationRisk: timing.firstTimeRisk,
  });

  const fitTier =
    input.fit.kind === "score" ? fitTierFromScore(input.fit.score) : fitTierFromBand(input.fit.band);

  const verdict = buildProspectVerdict({
    fitTier,
    registrationRisk: timing.firstTimeRisk,
    contestabilityBand: contestability.band,
    ungmApplies: input.isUngm,
  });

  return { compliance, contestability, verdict };
}
