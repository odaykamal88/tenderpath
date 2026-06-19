"use client";

/* Company profile — reads/writes the real users-row profile via
 * /api/dashboard/profile. Sectors map to the single free-text `sector` field
 * (chips split/join); countries to `country_focus`. */

import { useEffect, useState } from "react";
import { C, F } from "../tokens";
import { useWorkbench } from "../WorkbenchProvider";
import { Block, Field, ChipEditor } from "./atoms";
import { SECTOR_TAXONOMY, splitSectors, joinSectors } from "@/lib/workbench/sectors";

interface AssessmentSummary {
  business_name: string | null;
  website: string | null;
  sector: string | null;
  country_focus: string[];
  org_type: string | null;
  profile_description: string | null;
}

interface Profile {
  email: string | null;
  contact_phone: string | null;
  business_name: string | null;
  website: string | null;
  sector: string | null;
  country_focus: string[] | null;
  org_type: string | null;
  profile_description: string | null;
  profile_source: string | null;
  // Set when a manual profile has diverged from a newer assessment — drives a
  // non-destructive "update from latest assessment" prompt (audit blocker #3).
  assessment_differs?: boolean;
  latest_assessment?: AssessmentSummary | null;
}

export function CompanyProfileTab() {
  const { data, token } = useWorkbench();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // draft fields
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [orgType, setOrgType] = useState("");
  const [desc, setDesc] = useState("");
  const [sectors, setSectors] = useState<string[]>([]);
  const [countries, setCountries] = useState<string[]>([]);

  const hydrate = (p: Profile) => {
    setName(p.business_name ?? "");
    setWebsite(p.website ?? "");
    setOrgType(p.org_type ?? "");
    setDesc(p.profile_description ?? "");
    setSectors(splitSectors(p.sector));
    setCountries(p.country_focus ?? []);
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/dashboard/profile", { headers: token ? { authorization: `Bearer ${token}` } : {}, cache: "no-store" });
        if (!res.ok) { setError("Couldn't load your profile."); return; }
        const p = (await res.json()) as Profile;
        setProfile(p);
        hydrate(p);
      } catch {
        setError("Couldn't load your profile.");
      }
    })();
  }, [token]);

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        business_name: name,
        website,
        org_type: orgType,
        profile_description: desc,
        sector: joinSectors(sectors),
        country_focus: countries,
      };
      const res = await fetch("/api/dashboard/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      if (!res.ok) { setError("Couldn't save your changes."); setSaving(false); return; }
      setProfile({ ...(profile as Profile), ...body, sector: body.sector, country_focus: countries, profile_source: "manual" });
      setEditing(false);
      setError(null);
    } catch {
      setError("Couldn't save your changes.");
    }
    setSaving(false);
  };

  const cancel = () => {
    if (profile) hydrate(profile);
    setEditing(false);
  };

  // Opt-in refresh when a manual profile has gone stale against a newer
  // assessment. Non-destructive: only runs when the user clicks.
  const syncFromAssessment = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/dashboard/profile", {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) { setError("Couldn't update from your latest assessment."); setSyncing(false); return; }
      const p = (await res.json()) as Profile;
      const next: Profile = { ...(profile as Profile), ...p, assessment_differs: false, latest_assessment: null };
      setProfile(next);
      hydrate(next);
      setEditing(false);
      setError(null);
    } catch {
      setError("Couldn't update from your latest assessment.");
    }
    setSyncing(false);
  };

  if (error && !profile) return <div style={{ fontFamily: F.sans, fontSize: 13.5, color: C.neg }}>{error}</div>;
  if (!profile) return <div style={{ fontFamily: F.mono, fontSize: 11, color: C.mute, textTransform: "uppercase", letterSpacing: "0.08em" }}>Loading…</div>;

  const provenance =
    profile.profile_source === "manual"
      ? "Your edits override the imported values and are kept even when you re-run an assessment."
      : "Auto-filled from your latest assessment and Document Vault, and kept in sync as new assessments run. Edit any field to correct or add detail.";

  const stale = profile.profile_source === "manual" && profile.assessment_differs && profile.latest_assessment;

  return (
    <div>
      {stale && profile.latest_assessment && (
        <div style={{ border: `1px solid ${C.accent}`, borderLeft: `3px solid ${C.accent}`, background: C.white, padding: "14px 16px", marginBottom: 18 }}>
          <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: C.accent, marginBottom: 6 }}>
            Newer assessment available
          </div>
          <p style={{ fontFamily: F.sans, fontSize: 13, color: C.ink2, lineHeight: 1.5, margin: 0 }}>
            Your latest assessment describes <b style={{ color: C.ink }}>{profile.latest_assessment.business_name}</b>, but your saved profile still says <b style={{ color: C.ink }}>{profile.business_name}</b>. Your manual edits are kept until you choose to update.
          </p>
          <button
            onClick={syncFromAssessment}
            disabled={syncing}
            style={{
              marginTop: 11,
              fontFamily: F.mono,
              fontSize: 11,
              letterSpacing: "0.04em",
              padding: "8px 14px",
              background: C.ink,
              color: C.paper,
              border: 0,
              cursor: syncing ? "default" : "pointer",
              opacity: syncing ? 0.6 : 1,
            }}
          >
            {syncing ? "Updating…" : "Update from latest assessment →"}
          </button>
        </div>
      )}
      <Block
        title="Company background"
        editing={editing}
        onEdit={() => setEditing(true)}
        onCancel={cancel}
        onSave={save}
        saving={saving}
        note={<><span style={{ color: C.accent }}>↻</span> {provenance}</>}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 28px" }}>
          <Field label="Legal name" value={name} editing={editing} onChange={setName} badge={profile.profile_source === "assessment" ? "assessment" : undefined} />
          <Field label="Website" value={website} editing={editing} onChange={setWebsite} placeholder="company.com" />
          <Field label="Organisation type" value={orgType} editing={editing} onChange={setOrgType} placeholder="e.g. SME · consultancy" />
          <Field label="Vendor file no." value={data.company.fileNo} readOnly />
          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Description" value={desc} editing={editing} onChange={setDesc} textarea placeholder="What your company does, sells, builds or delivers…" />
          </div>
        </div>
      </Block>

      <Block title="Sectors & capabilities">
        <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: C.faint, marginBottom: 8 }}>Sectors</div>
        <ChipEditor chips={sectors} editing={editing} onChange={setSectors} suggestions={SECTOR_TAXONOMY} placeholder="Add a sector…" />
        <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: C.faint, margin: "18px 0 8px" }}>Country focus</div>
        <ChipEditor chips={countries} editing={editing} onChange={setCountries} placeholder="Add a country…" />
        <p style={{ fontFamily: F.sans, fontSize: 12.5, color: C.mute, marginTop: 14 }}>
          These tune which tenders match you. New labels are saved as free text — the matcher treats them as additional signal.
        </p>
        {!editing && <p style={{ fontFamily: F.mono, fontSize: 10.5, color: C.faint, marginTop: 8 }}>Click <b>Edit</b> on Company background to change these.</p>}
      </Block>

      {error && <div style={{ fontFamily: F.sans, fontSize: 12.5, color: C.neg }}>{error}</div>}
    </div>
  );
}
