"use client";

/* Profile & team — the viewer's contact details, the real passwordless security
 * model, and team status. Security is magic-link + (planned) 2FA — there is no
 * password. Team workspaces are a planned net-new data model; today the account
 * is single-user, so we say so plainly rather than fake an invite flow. */

import { useEffect, useState } from "react";
import { C, F } from "../tokens";
import { useWorkbench } from "../WorkbenchProvider";
import { Block, Field } from "./atoms";
import ConnectBot from "@/components/dashboard/ConnectBot";

export function TeamTab() {
  const { data, token } = useWorkbench();
  const email = data.company.user;
  const [phone, setPhone] = useState("");
  const [draftPhone, setDraftPhone] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/dashboard/profile", { headers: token ? { authorization: `Bearer ${token}` } : {}, cache: "no-store" });
        if (!res.ok) return;
        const p = (await res.json()) as { contact_phone: string | null };
        setPhone(p.contact_phone ?? "");
        setDraftPhone(p.contact_phone ?? "");
      } catch {
        /* non-fatal */
      }
    })();
  }, [token]);

  const save = async () => {
    setSaving(true);
    try {
      await fetch("/api/dashboard/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ contact_phone: draftPhone }),
      });
      setPhone(draftPhone);
      setEditing(false);
    } catch {
      /* non-fatal */
    }
    setSaving(false);
  };

  const initial = (email || "T").charAt(0).toUpperCase();

  return (
    <div>
      <Block
        title="Your profile"
        editing={editing}
        onEdit={() => setEditing(true)}
        onCancel={() => { setDraftPhone(phone); setEditing(false); }}
        onSave={save}
        saving={saving}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 28px" }}>
          <Field label="Email" value={email} readOnly />
          <Field label="Phone" value={editing ? draftPhone : phone} editing={editing} onChange={setDraftPhone} placeholder="+254…" />
        </div>
      </Block>

      <Block title="Security">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, paddingBottom: 14, borderBottom: `1px solid ${C.ruleSoft}` }}>
          <div>
            <div style={{ fontFamily: F.sans, fontSize: 14, color: C.ink, fontWeight: 500 }}>Sign-in method</div>
            <div style={{ fontFamily: F.sans, fontSize: 12.5, color: C.mute, marginTop: 3 }}>Passwordless — a secure magic link to {email}. There is no password to steal.</div>
          </div>
          <span style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase", color: C.pos, border: `1px solid #bfe0cc`, padding: "3px 8px", whiteSpace: "nowrap" }}>Active</span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, paddingTop: 14 }}>
          <div>
            <div style={{ fontFamily: F.sans, fontSize: 14, color: C.ink, fontWeight: 500 }}>Two-factor authentication</div>
            <div style={{ fontFamily: F.sans, fontSize: 12.5, color: C.mute, marginTop: 3 }}>An extra step on top of your magic link.</div>
          </div>
          <span style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase", color: C.faint, border: `1px solid ${C.rule}`, padding: "3px 8px", whiteSpace: "nowrap" }}>Coming soon</span>
        </div>
      </Block>

      <Block title="Team">
        <div style={{ display: "flex", alignItems: "center", gap: 11, paddingBottom: 14, borderBottom: `1px solid ${C.ruleSoft}` }}>
          <div style={{ width: 30, height: 30, borderRadius: 999, background: C.accent, color: C.white, display: "grid", placeItems: "center", fontFamily: F.display, fontSize: 14, flexShrink: 0 }}>{initial}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: F.sans, fontSize: 13.5, color: C.ink }}>{email}</div>
            <div style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase", color: C.mute, marginTop: 2 }}>Owner</div>
          </div>
        </div>
        <p style={{ fontFamily: F.sans, fontSize: 12.5, color: C.mute, margin: "14px 0 0", lineHeight: 1.55 }}>
          Team workspaces are coming. You&apos;ll be able to invite colleagues to share your vendor file and split bid work — with Owner / Admin / Member roles and magic-link invites. Today your account is single-user.
        </p>
      </Block>

      <ConnectBot />
    </div>
  );
}
