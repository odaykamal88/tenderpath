/* Amendment watcher (SPEC §5 contract 5, pilot shape). The daily crawl already
 * refreshes the tenders table at 06:00 UTC; this pass (riding the 08:30
 * bot-nudges cron, so it always sees fresh data) compares each live order's
 * stored deadline against its linked tender row. A moved deadline becomes an
 * amendments[] entry + a due update + a client-visible event — and an ops
 * email, because the DRAFT re-base is human work the system must not pretend
 * happened. Orders without a tender_id (hand-entered notices) can't be
 * watched; the admin queue's manual amendment recorder covers those. */

import { sql } from "@/lib/db";
import { notifyAdmin } from "@/lib/email/notifyAdmin";
import { applyAdminAction, ensureSubmissionsSchema, rowToOrder } from "./store";

function fmt(d: string): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export async function watchSubmissionAmendments(opts?: { dryRun?: boolean }): Promise<{
  checked: number;
  amended: number;
  failed: number;
}> {
  await ensureSubmissionsSchema();
  const rows = await sql`
    SELECT so.*, t.deadline AS source_deadline
    FROM submission_orders so
    JOIN tenders t ON t.id = so.tender_id
    WHERE so.paid_at IS NOT NULL
      AND so.stage <> 'submitted'
      AND so.tender_id IS NOT NULL
      AND t.deadline IS NOT NULL
  `;

  let amended = 0;
  let failed = 0;
  for (const row of rows) {
    const order = rowToOrder(row);
    const sourceDeadline = String(row.source_deadline).slice(0, 10);
    if (!order.due || order.due === sourceDeadline) continue;
    if (opts?.dryRun) {
      amended++;
      continue;
    }
    try {
      await applyAdminAction(order.id, {
        action: "add_amendment",
        summary: `Deadline moved ${fmt(order.due)} → ${fmt(sourceDeadline)} on the source notice`,
        actionTaken: "Deadline updated automatically from the source — the drafting team re-bases your timeline. Nothing needed from you.",
        due: sourceDeadline,
      });
      amended++;
      notifyAdmin(
        `[submissions] Amendment detected — ${order.ref} deadline moved`,
        [
          `${order.type} ${order.ref} · ${order.tender}`,
          `Deadline moved ${order.due} → ${sourceDeadline} on the source notice.`,
          `The order's due date was updated automatically; RE-BASE THE DRAFT and check the notice for scope changes (only the deadline is watched).`,
          `Queue: ${process.env.NEXT_PUBLIC_APP_URL ?? "https://www.tenderpath.me"}/admin/submissions`,
        ].join("\n"),
      ).catch(() => {});
    } catch (err) {
      failed++;
      console.error("[tp:submissions:amendment_watch_failed]", {
        orderId: order.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log("[tp:submissions:amendment_watch]", JSON.stringify({ checked: rows.length, amended, failed, dryRun: opts?.dryRun ?? false }));
  return { checked: rows.length, amended, failed };
}
