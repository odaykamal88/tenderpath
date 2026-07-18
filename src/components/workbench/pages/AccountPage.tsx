"use client";

/* Account & settings — tabbed: Company profile · Subscription · Billing &
 * transactions · Profile & team. */

import { useState } from "react";
import { C, F } from "../tokens";
import { SectionHead } from "../ui";
import { useMedia } from "../useMedia";
import { CompanyProfileTab } from "../account/CompanyProfileTab";
import { TeamTab } from "../account/TeamTab";
import { PrivacyTab } from "../account/PrivacyTab";

// Invite-only beta: pricing/payment is hidden, so the Subscription and Billing
// tabs are omitted (SubscriptionTab/BillingTab remain in the repo — restore them
// here when COMMERCE_ENABLED is flipped back on).
const TABS = [
  { id: "profile", label: "Company profile" },
  { id: "team", label: "Profile & team" },
  { id: "privacy", label: "Privacy & access" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function AccountPage() {
  const mobile = useMedia("(max-width: 1023px)");
  const [tab, setTab] = useState<TabId>("profile");

  return (
    <div>
      <SectionHead title="Account & settings" />
      <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "210px 1fr", gap: mobile ? 18 : 32, alignItems: "start" }}>
        <div style={{ position: mobile ? "static" : "sticky", top: 84, display: "flex", flexDirection: mobile ? "row" : "column", gap: mobile ? 6 : 2, overflowX: mobile ? "auto" : "visible" }}>
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  textAlign: "left",
                  padding: "9px 12px",
                  background: active ? C.ink : "transparent",
                  color: active ? C.paper : C.ink2,
                  border: 0,
                  borderLeft: mobile ? "none" : `2px solid ${active ? C.accent : "transparent"}`,
                  cursor: "pointer",
                  fontFamily: F.sans,
                  fontSize: 13.5,
                  whiteSpace: "nowrap",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <div style={{ minWidth: 0 }}>
          {tab === "profile" && <CompanyProfileTab />}
          {tab === "team" && <TeamTab />}
          {tab === "privacy" && <PrivacyTab />}
        </div>
      </div>
    </div>
  );
}
