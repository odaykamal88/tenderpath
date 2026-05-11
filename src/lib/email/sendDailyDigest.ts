import { Resend } from "resend";

export interface DailyDigestPayload {
  generatedAt: string;
  crawl: {
    status: "success" | "partial" | "failure" | "no_summary";
    failureRatio: number | null;
    totalAdded: number;
    totalUpdated: number;
    totalExpired: number;
    failedSources: string[];
    successSources: string[];
    durationMs: number | null;
    runAt: string | null;
  };
  freshness: {
    staleSources: string[];
    freshSources: string[];
    openTenders: number;
  };
  payments: {
    pendingOverFourHours: number;
    failedLast24h: number;
    successfulLast24h: number;
    pendingRecent: Array<{
      id: number;
      plan: string | null;
      payment_status: string | null;
      hours_pending: number;
    }>;
  };
  email: {
    failedLast24h: number;
    sentLast24h: number;
  };
}

const RECIPIENT_VAR_KEYS = ["OPS_DIGEST_EMAIL", "ADMIN_ALERT_EMAIL", "WORK_ORDER_OPS_EMAIL", "OPS_EMAIL"];
const DEFAULT_OPS_INBOX = "info@tenderpath.me";

function recipient(): string {
  for (const key of RECIPIENT_VAR_KEYS) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return DEFAULT_OPS_INBOX;
}

function fmt(num: number): string {
  return Number.isFinite(num) ? num.toLocaleString("en-US") : "—";
}

function severity(payload: DailyDigestPayload): "ok" | "warning" | "alert" {
  if (
    payload.crawl.status === "failure" ||
    (payload.crawl.failureRatio ?? 0) >= 0.4 ||
    payload.freshness.openTenders === 0 ||
    payload.payments.pendingOverFourHours >= 3
  ) return "alert";
  if (
    payload.crawl.status === "partial" ||
    payload.freshness.staleSources.length > 0 ||
    payload.email.failedLast24h > 0 ||
    payload.payments.pendingOverFourHours > 0
  ) return "warning";
  return "ok";
}

function renderText(payload: DailyDigestPayload): string {
  const lines: string[] = [];
  const sev = severity(payload);
  const sevEmoji = sev === "alert" ? "[ALERT]" : sev === "warning" ? "[WARN]" : "[OK]";

  lines.push(`TenderPath ops digest — ${payload.generatedAt}`);
  lines.push(`Status: ${sevEmoji}`);
  lines.push("");

  lines.push("# Last crawl run");
  if (payload.crawl.status === "no_summary") {
    lines.push("  No SUMMARY row in crawl_logs — has the daily crawl run in the last 36h?");
  } else {
    lines.push(`  Status:    ${payload.crawl.status}`);
    lines.push(`  Ran at:    ${payload.crawl.runAt ?? "—"}`);
    lines.push(`  Duration:  ${payload.crawl.durationMs != null ? `${Math.round(payload.crawl.durationMs / 1000)}s` : "—"}`);
    lines.push(`  Added:     ${fmt(payload.crawl.totalAdded)}`);
    lines.push(`  Updated:   ${fmt(payload.crawl.totalUpdated)}`);
    lines.push(`  Expired:   ${fmt(payload.crawl.totalExpired)}`);
    if (payload.crawl.failureRatio != null) {
      lines.push(`  Failure %: ${(payload.crawl.failureRatio * 100).toFixed(0)}%`);
    }
    if (payload.crawl.failedSources.length > 0) {
      lines.push(`  Failed:    ${payload.crawl.failedSources.join(", ")}`);
    }
  }
  lines.push("");

  lines.push("# Source freshness");
  lines.push(`  Open tenders:   ${fmt(payload.freshness.openTenders)}`);
  lines.push(`  Stale sources:  ${payload.freshness.staleSources.length === 0 ? "none" : payload.freshness.staleSources.join(", ")}`);
  lines.push(`  Fresh sources:  ${payload.freshness.freshSources.length}`);
  lines.push("");

  lines.push("# Payments (last 24h)");
  lines.push(`  Paid:                 ${fmt(payload.payments.successfulLast24h)}`);
  lines.push(`  Pending > 4 hours:    ${fmt(payload.payments.pendingOverFourHours)}`);
  lines.push(`  Failed transactions:  ${fmt(payload.payments.failedLast24h)}`);
  if (payload.payments.pendingRecent.length > 0) {
    lines.push("  Long-pending work orders:");
    for (const wo of payload.payments.pendingRecent.slice(0, 5)) {
      lines.push(`    #${wo.id} · ${wo.plan ?? "(no plan)"} · ${wo.payment_status ?? "?"} · ${wo.hours_pending.toFixed(1)}h pending`);
    }
  }
  lines.push("");

  lines.push("# Email (last 24h)");
  lines.push(`  Sent:    ${fmt(payload.email.sentLast24h)}`);
  lines.push(`  Failed:  ${fmt(payload.email.failedLast24h)}`);
  lines.push("");

  lines.push("Drill-down:");
  lines.push(`  /admin              — overview`);
  lines.push(`  /admin → Source health — per-platform crawl logs`);
  lines.push(`  /admin → Demo          — demo session usage`);

  return lines.join("\n");
}

function severityLabel(sev: "ok" | "warning" | "alert"): string {
  if (sev === "alert") return "ALERT";
  if (sev === "warning") return "Warning";
  return "OK";
}

export async function sendDailyDigest(payload: DailyDigestPayload): Promise<{
  sent: boolean;
  skippedReason?: string;
  recipient?: string;
}> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, skippedReason: "RESEND_API_KEY missing" };
  const to = recipient();

  const sev = severity(payload);
  const subject = `[TenderPath ${severityLabel(sev)}] Daily ops digest · ${payload.generatedAt.slice(0, 10)}`;
  const from = process.env.RESEND_FROM_EMAIL ?? "TenderPath <no-reply@tenderpath.me>";
  const body = renderText(payload);

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({ from, to, subject, text: body });
    return { sent: true, recipient: to };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown send error";
    console.error("[tp:digest:send_failed]", { recipient: to, error: message });
    return { sent: false, skippedReason: message, recipient: to };
  }
}
