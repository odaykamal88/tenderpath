/* Inbound agency mail (SPEC §5 contract 4) — the webhook an inbound-mail
 * provider (e.g. Cloudflare Email Workers on in.tenderpath.me) POSTs parsed
 * messages to. DORMANT until that provisioning exists: with INBOUND_MAIL_SECRET
 * unset this returns 503 and does nothing.
 *
 * Security (SPEC §9): the provider must verify DKIM/SPF AND this endpoint only
 * accepts requests carrying the shared secret — otherwise anyone who learns an
 * order ref could inject fake "agency answers". The entry lands as an
 * UNANSWERED qna[] item; ops reads it and posts the answer + draft-impact
 * verdict from the queue (we never auto-claim a parse verdict we didn't make). */

import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { ensureSubmissionsSchema, rowToOrder } from "@/lib/submissions/store";
import { notifyAdmin } from "@/lib/email/notifyAdmin";

export const dynamic = "force-dynamic";

interface InboundPayload {
  /** Either the bare ref ("tp-2007") or the full address ("tp-2007@in.tenderpath.me"). */
  to?: string;
  from?: string;
  subject?: string;
  text?: string;
}

export async function POST(request: Request) {
  const secret = process.env.INBOUND_MAIL_SECRET?.trim();
  if (!secret) {
    console.warn("[tp:submissions:inbound_mail_dormant]", { reason: "INBOUND_MAIL_SECRET unset" });
    return NextResponse.json({ error: "Inbound mail is not provisioned." }, { status: 503 });
  }
  if (request.headers.get("x-inbound-secret") !== secret) {
    console.error("[tp:submissions:inbound_mail_unauthorized]", {});
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as InboundPayload;
    const refMatch = (body.to ?? "").toLowerCase().match(/tp-(\d{3,6})/);
    if (!refMatch) {
      return NextResponse.json({ error: "No order ref in the recipient address." }, { status: 400 });
    }
    const ref = `TP-${refMatch[1]}`;
    const text = (body.text ?? "").trim().slice(0, 4000);
    if (!text) return NextResponse.json({ error: "Empty message." }, { status: 400 });

    await ensureSubmissionsSchema();
    const rows = await sql`SELECT * FROM submission_orders WHERE ref = ${ref} LIMIT 1`;
    if (!rows.length) {
      console.warn("[tp:submissions:inbound_mail_unknown_ref]", { ref });
      return NextResponse.json({ error: "Unknown order ref." }, { status: 404 });
    }
    const order = rowToOrder(rows[0]);

    const entry = {
      at: new Date().toISOString(),
      src: "forward",
      q: text,
      via: [body.subject?.trim(), body.from?.trim() ? `from ${body.from.trim()}` : null]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 160) || "inbound mail",
    };
    const event = {
      at: new Date().toISOString(),
      label: "Agency mail received on the order address — we check it against the draft.",
      by: "ops",
    };
    await sql`
      UPDATE submission_orders
      SET qna = qna || ${JSON.stringify([entry])}::jsonb,
          events = events || ${JSON.stringify([event])}::jsonb,
          updated_at = NOW()
      WHERE id = ${order.id}
    `;
    notifyAdmin(
      `[submissions] Inbound agency mail — ${order.ref}`,
      [
        `${order.type} ${order.ref} · ${order.tender}`,
        body.subject ? `Subject: ${body.subject}` : null,
        body.from ? `From: ${body.from}` : null,
        "",
        "Answer it (with a draft-impact verdict) from the queue:",
        `${process.env.NEXT_PUBLIC_APP_URL ?? "https://www.tenderpath.me"}/admin/submissions`,
      ]
        .filter((l) => l !== null)
        .join("\n"),
    ).catch(() => {});
    console.info("[tp:submissions:inbound_mail_logged]", { orderId: order.id, ref });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[tp:submissions:inbound_mail_failed]", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Could not process the message." }, { status: 500 });
  }
}
