"use client";

import { useCallback, useEffect, useState } from "react";
import { C, F } from "../tokens";
import { useWorkbench } from "../WorkbenchProvider";
import { Block } from "./atoms";
import { Btn } from "../ui";

interface AccessOrder {
  workOrderId: number;
  label: string;
  plan: string;
  status: string;
  createdAt: string;
  purpose: string | null;
  expiresAt: string | null;
}

interface AccessEvent {
  id: number;
  workOrderId: number;
  eventType: string;
  purpose: string | null;
  occurredAt: string;
}

function dateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export function PrivacyTab() {
  const { token } = useWorkbench();
  const [orders, setOrders] = useState<AccessOrder[]>([]);
  const [events, setEvents] = useState<AccessEvent[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const headers = useCallback((): HeadersInit => ({
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  }), [token]);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/dashboard/privacy/support-access", {
        headers: headers(),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error ?? "Could not load privacy controls");
      setOrders(payload.orders ?? []);
      setEvents(payload.events ?? []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load privacy controls");
    }
  }, [headers]);

  useEffect(() => { void load(); }, [load]);

  const update = async (workOrderId: number, action: "grant" | "revoke") => {
    setBusyId(workOrderId);
    try {
      const response = await fetch("/api/dashboard/privacy/support-access", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          action,
          workOrderId,
          durationHours: 72,
          purpose: "Fulfill and support this TenderPath service order",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error ?? "Could not update access");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update access");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <Block title="Confidential workspace">
        <p style={{ fontFamily: F.sans, fontSize: 13.5, color: C.ink2, lineHeight: 1.6, margin: 0 }}>
          Your files and service content are private to your account. TenderPath staff see order metadata only unless
          you grant temporary access to a specific paid order. Grants expire automatically and can be revoked here.
        </p>
        <div style={{ marginTop: 14, padding: "10px 12px", border: `1px solid ${C.ruleSoft}`, background: C.paper }}>
          <div style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.pos }}>Private by default</div>
          <div style={{ fontFamily: F.sans, fontSize: 12.5, color: C.mute, lineHeight: 1.55, marginTop: 4 }}>
            A grant covers only the selected work order for 72 hours. It does not expose your full account or unrelated vault documents.
          </div>
        </div>
      </Block>

      <Block title="TenderPath support access" note="Grant access only when you want TenderPath to fulfill or troubleshoot an order.">
        {error && <div style={{ color: C.neg, fontFamily: F.sans, fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
        {orders.length === 0 ? (
          <p style={{ fontFamily: F.sans, fontSize: 13, color: C.mute, margin: 0 }}>No paid service orders need an access decision.</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {orders.map((order) => {
              // The API returns only non-revoked, non-expired grants.
              const active = Boolean(order.expiresAt);
              return (
                <div key={order.workOrderId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "12px 0", borderBottom: `1px solid ${C.ruleSoft}` }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: F.sans, fontSize: 13.5, color: C.ink }}>{order.label}</div>
                    <div style={{ fontFamily: F.mono, fontSize: 9.5, color: C.faint, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 3 }}>
                      Work order #{order.workOrderId} · {order.plan} · {active ? `access until ${dateTime(order.expiresAt)}` : "content locked"}
                    </div>
                  </div>
                  <Btn
                    kind={active ? "ghost" : "primary"}
                    size="sm"
                    disabled={busyId === order.workOrderId}
                    onClick={() => void update(order.workOrderId, active ? "revoke" : "grant")}
                  >
                    {busyId === order.workOrderId ? "Saving…" : active ? "Revoke" : "Grant 72h"}
                  </Btn>
                </div>
              );
            })}
          </div>
        )}
      </Block>

      <Block title="Recent access activity">
        {events.length === 0 ? (
          <p style={{ fontFamily: F.sans, fontSize: 13, color: C.mute, margin: 0 }}>No support access has been granted or used.</p>
        ) : (
          <div style={{ display: "grid", gap: 9 }}>
            {events.slice(0, 20).map((event) => (
              <div key={event.id} style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: 12, fontFamily: F.sans, fontSize: 12.5, color: C.ink2 }}>
                <span style={{ color: C.mute }}>{dateTime(event.occurredAt)}</span>
                <span>Order #{event.workOrderId} · {event.eventType.replaceAll("_", " ")}{event.purpose ? ` · ${event.purpose}` : ""}</span>
              </div>
            ))}
          </div>
        )}
      </Block>
    </div>
  );
}
