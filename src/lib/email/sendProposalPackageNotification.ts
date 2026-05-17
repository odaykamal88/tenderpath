import { Resend } from "resend";

function envValue(key: string): string | null {
  const value = process.env[key]?.trim();
  return value ? value : null;
}

function appUrl(): string {
  return envValue("NEXT_PUBLIC_APP_URL") ?? "https://www.tenderpath.me";
}

function fromAddress(): string {
  return envValue("RESEND_FROM_EMAIL") ?? "TenderPath <no-reply@tenderpath.me>";
}

export interface ProposalReadyEmailArgs {
  email: string;
  workOrderId: number;
  tenderTitle: string | null;
  agency: string | null;
  zipUrl: string;
}

export async function sendProposalReadyEmail(args: ProposalReadyEmailArgs): Promise<void> {
  const apiKey = envValue("RESEND_API_KEY");
  if (!apiKey) {
    console.warn("[tp:proposal_email:skipped]", { workOrderId: args.workOrderId, reason: "RESEND_API_KEY missing" });
    return;
  }
  const resend = new Resend(apiKey);
  const subject = `Your proposal package is ready · ${args.tenderTitle ?? `Work order #${args.workOrderId}`}`;
  const body = [
    `Your 80%-complete proposal package is ready.`,
    ``,
    args.tenderTitle ? `Tender: ${args.tenderTitle}` : null,
    args.agency ? `Agency: ${args.agency}` : null,
    ``,
    `Download the ZIP bundle: ${args.zipUrl}`,
    `Review in your dashboard: ${appUrl()}/dashboard/work-orders/${args.workOrderId}`,
    ``,
    `The bundle contains:`,
    `  · Technical proposal (.docx, editable in Word)`,
    `  · Cover letter (.docx, editable in Word)`,
    `  · Financial template (.xlsx, formulas pre-wired)`,
    `  · Compliance matrix (.pdf, requirement-by-requirement)`,
    ``,
    `Open the technical proposal first. The compliance matrix tells you exactly where each tender requirement is addressed. The financial template auto-totals as you fill quantities and unit costs.`,
    ``,
    `If the package needs a revision, you can regenerate it from your dashboard (up to two more times). Reply to this email if anything is materially off.`,
    ``,
    `— TenderPath`,
  ].filter(Boolean).join("\n");

  const { error } = await resend.emails.send({ from: fromAddress(), to: args.email, subject, text: body });
  if (error) {
    throw new Error(`Resend send rejected (proposal): ${error.message ?? JSON.stringify(error)}`);
  }
}

export interface RosterReadyEmailArgs {
  email: string;
  workOrderId: number;
  agencyLabel: string;
  portalUrl: string;
  zipUrl: string;
  /** Sprint 14. Optional. Surfaced in the email as the "we also
   *  found N agencies you're ready for" hook so users return to
   *  the dashboard and see the leaderboard. */
  agencyReadinessSummary?: {
    startHereLabel: string;
    viableLabels: string[];
    totalScored: number;
  };
}

export async function sendRosterReadyEmail(args: RosterReadyEmailArgs): Promise<void> {
  const apiKey = envValue("RESEND_API_KEY");
  if (!apiKey) {
    console.warn("[tp:roster_email:skipped]", { workOrderId: args.workOrderId, reason: "RESEND_API_KEY missing" });
    return;
  }
  const resend = new Resend(apiKey);
  const summary = args.agencyReadinessSummary;
  const hasSummary = Boolean(summary);
  const startHereDiffers = hasSummary && summary!.startHereLabel.toUpperCase() !== args.agencyLabel.toUpperCase();
  const totalAlternates = hasSummary ? summary!.viableLabels.length + (startHereDiffers ? 1 : 0) : 0;

  // Subject leads with the breakdown count when present — the hook
  // that drives the dashboard click. Falls back to the legacy
  // single-agency subject for old packages without a breakdown.
  const subject = hasSummary && totalAlternates > 0
    ? `Your ${args.agencyLabel} roster is ready · ${summary!.totalScored} agencies scored`
    : `Your ${args.agencyLabel} roster package is ready`;

  const breakdownBlock: (string | null)[] = hasSummary
    ? [
        ``,
        startHereDiffers
          ? `We also scored you against ${summary!.totalScored - 1} other UN agencies. Based on your evidence library and capabilities, ${summary!.startHereLabel} is actually the highest-readiness next step — finish ${summary!.startHereLabel} first for fastest wins, then come back to ${args.agencyLabel}.`
          : totalAlternates > 0
            ? `We also scored you against ${summary!.totalScored - 1} other UN agencies. ${summary!.viableLabels.length > 0 ? `${summary!.viableLabels.slice(0, 3).join(", ")} ${summary!.viableLabels.length === 1 ? "is" : "are"} also viable today — open the dashboard to see exactly which docs each one needs.` : ""}`
            : `We scored you against ${summary!.totalScored} UN agencies. ${args.agencyLabel} is the strongest fit; the others are gated by specific missing documents (named on the dashboard).`,
        ``,
      ]
    : [];

  const body = [
    `Your ${args.agencyLabel} roster registration package is ready.`,
    ``,
    `Download the ZIP bundle: ${args.zipUrl}`,
    `Open your dashboard: ${appUrl()}/dashboard/work-orders/${args.workOrderId}`,
    `Agency portal: ${args.portalUrl}`,
    ...breakdownBlock,
    `The bundle contains:`,
    `  · Capability statement (.docx, editable)`,
    `  · Cover letter (.docx, editable)`,
    `  · Submission instructions (.pdf, step-by-step including file-naming rules)`,
    ``,
    `Open the submission instructions PDF first — it walks you through the agency portal step by step, with the exact filename rules each upload requires. When you've submitted, hit "Mark as submitted" in your dashboard so we can track the milestone.`,
    ``,
    `Reply to this email if anything is unclear.`,
    ``,
    `— TenderPath`,
  ].filter(Boolean).join("\n");

  const { error } = await resend.emails.send({ from: fromAddress(), to: args.email, subject, text: body });
  if (error) {
    throw new Error(`Resend send rejected (roster): ${error.message ?? JSON.stringify(error)}`);
  }
}
