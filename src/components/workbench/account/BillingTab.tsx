"use client";

/* Billing & transactions — real payment history (work orders + subscription
 * logs) with CSV export, and payment-method / invoice management through the
 * secure Stripe billing portal (we never touch card data). */

import { useEffect, useState } from "react";
import { C, F } from "../tokens";
import { Btn } from "../ui";
import { useWorkbench } from "../WorkbenchProvider";
import { requestBillingPortal } from "./portal";

interface Txn {
  id: string;
  date: string;
  description: string;
  amount: number;
  currency: string;
  status: string;
  kind: "service" | "subscription";
}

function fmtDate(d: string): string {
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? "—" : x.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function downloadCsv(txns: Txn[]) {
  const head = ["ID", "Date", "Description", "Type", "Amount", "Currency", "Status"];
  const rows = txns.map((t) => [t.id, t.date.slice(0, 10), t.description.replace(/"/g, '""'), t.kind, t.amount.toFixed(2), t.currency, t.status]);
  const csv = [head, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "tenderpath-transactions.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function BillingTab() {
  const { token } = useWorkbench();
  const [txns, setTxns] = useState<Txn[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/dashboard/transactions", { headers: token ? { authorization: `Bearer ${token}` } : {}, cache: "no-store" });
        const body = (await res.json()) as { transactions: Txn[] };
        setTxns(body.transactions ?? []);
      } catch {
        setTxns([]);
      }
    })();
  }, [token]);

  const openPortal = async () => {
    setBusy(true);
    const r = await requestBillingPortal(token);
    setBusy(false);
    if (r.url) window.location.href = r.url;
    else setMsg(r.message ?? "Couldn't open the billing portal.");
  };

  return (
    <div>
      <div style={{ background: C.white, border: `1px solid ${C.rule}`, padding: "20px 22px", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
          <h3 style={{ fontFamily: F.display, fontSize: 18, fontWeight: 400, color: C.ink, margin: 0 }}>Payment method</h3>
          <Btn kind="ghost" size="sm" onClick={openPortal} disabled={busy}>{busy ? "Opening…" : "Manage in Stripe →"}</Btn>
        </div>
        <p style={{ fontFamily: F.sans, fontSize: 13, color: C.mute, margin: 0 }}>
          Cards, invoices, and plan changes are handled securely in the Stripe billing portal — we never store your card details.
        </p>
        {msg && <p style={{ fontFamily: F.sans, fontSize: 12.5, color: C.warn, marginTop: 8 }}>{msg}</p>}
      </div>

      <div style={{ background: C.white, border: `1px solid ${C.rule}`, padding: "20px 22px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
          <h3 style={{ fontFamily: F.display, fontSize: 18, fontWeight: 400, color: C.ink, margin: 0 }}>Transactions &amp; invoices</h3>
          {txns && txns.length > 0 && <Btn kind="ghost" size="sm" onClick={() => downloadCsv(txns)}>Export CSV</Btn>}
        </div>
        {!txns && <div style={{ fontFamily: F.mono, fontSize: 11, color: C.mute, textTransform: "uppercase", letterSpacing: "0.08em" }}>Loading…</div>}
        {txns && txns.length === 0 && <div style={{ fontFamily: F.sans, fontSize: 13.5, color: C.mute }}>No transactions yet. Paid submissions and your subscription will appear here.</div>}
        {txns && txns.length > 0 && (
          <div>
            {txns.map((t) => (
              <div key={t.id} style={{ display: "grid", gridTemplateColumns: "92px 1fr 110px 90px", gap: 12, alignItems: "center", padding: "11px 0", borderTop: `1px solid ${C.ruleSoft}` }}>
                <span style={{ fontFamily: F.mono, fontSize: 11, color: C.mute }}>{fmtDate(t.date)}</span>
                <span style={{ fontFamily: F.sans, fontSize: 13, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description}</span>
                <span style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase", color: C.faint }}>{t.kind === "service" ? "Per-submission" : "Subscription"}</span>
                <span style={{ fontFamily: F.mono, fontSize: 12, color: C.ink2, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{t.amount > 0 ? `${t.currency} ${t.amount.toFixed(2)}` : "—"}</span>
              </div>
            ))}
            <p style={{ fontFamily: F.sans, fontSize: 11.5, color: C.faint, marginTop: 12 }}>Itemised invoices &amp; receipts are available in the Stripe billing portal.</p>
          </div>
        )}
      </div>
    </div>
  );
}
