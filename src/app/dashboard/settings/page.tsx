"use client";

import { useEffect, useState } from "react";
import ConnectBot from "@/components/dashboard/ConnectBot";

const ORG_TYPES = [
  { value: "company", label: "Private Company" },
  { value: "sme", label: "Small / Medium Enterprise" },
  { value: "ngo", label: "NGO / Non-profit" },
  { value: "government", label: "Government / Public Body" },
  { value: "academic", label: "Academic / Research Institution" },
  { value: "consultant", label: "Independent Consultant" },
  { value: "cooperative", label: "Cooperative / Social Enterprise" },
  { value: "other", label: "Other" },
];

const SECTORS = [
  "Health & Pharmaceuticals",
  "Education & Training",
  "Infrastructure & Construction",
  "IT & Digital Solutions",
  "Logistics & Supply Chain",
  "Agriculture & Food Security",
  "Water, Sanitation & Environment",
  "Humanitarian & Emergency Response",
  "Financial Services",
  "Energy",
  "Consulting & Advisory",
  "Media & Communications",
  "Legal & Compliance",
  "Other",
];

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";
const SERIF = "'Fraunces', 'Times New Roman', serif";

interface Profile {
  email: string | null;
  contact_phone: string | null;
  business_name: string | null;
  website: string | null;
  sector: string | null;
  country_focus: string[];
  org_type: string | null;
  profile_description: string | null;
  profile_source: "assessment" | "manual" | "unset";
}

function sourceLabel(source: string) {
  if (source === "assessment") return "Auto-populated from assessment · Refine to improve matching";
  if (source === "manual") return "Manually maintained";
  return "No profile data yet · Run an assessment to auto-populate";
}

function CountryTagInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const add = () => {
    const trimmed = input.trim();
    if (trimmed && !value.includes(trimmed)) onChange([...value, trimmed]);
    setInput("");
  };
  return (
    <div className="flex flex-col gap-2.5">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1.5 rounded-sm border border-stone-300 bg-stone-50/60 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-700 px-2 py-1"
              style={{ fontFamily: MONO }}
            >
              {c}
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x !== c))}
                className="text-stone-400 hover:text-red-600 leading-none text-[14px]"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-sm border border-stone-300 bg-white px-3 py-2 text-[13px] focus:outline-none focus:border-stone-700"
          placeholder="Add country (press Enter)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        />
        <button
          type="button"
          onClick={add}
          className="rounded-sm border border-stone-300 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-stone-700 hover:border-stone-700 hover:text-stone-900 transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function FieldRow({
  index,
  label,
  helper,
  children,
}: {
  index: string;
  label: string;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-6 py-5 grid sm:grid-cols-[180px_1fr] gap-x-6 gap-y-2 items-start">
      <div>
        <div className="flex items-baseline gap-2">
          <span
            className="text-[10px] font-semibold tabular-nums text-stone-400"
            style={{ fontFamily: MONO }}
          >
            {index}
          </span>
          <label className="text-[13px] font-medium text-stone-900">{label}</label>
        </div>
        {helper && <p className="mt-0.5 ml-5 text-[11.5px] text-stone-500 leading-snug">{helper}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState<Partial<Profile>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
    const headers: HeadersInit = token ? { authorization: `Bearer ${token}` } : {};
    fetch("/api/dashboard/profile", { headers })
      .then((r) => r.json())
      .then((data: Profile) => {
        setProfile(data);
        setForm({
          contact_phone: data.contact_phone ?? "",
          business_name: data.business_name ?? "",
          website: data.website ?? "",
          sector: data.sector ?? "",
          country_focus: data.country_focus ?? [],
          org_type: data.org_type ?? "",
          profile_description: data.profile_description ?? "",
        });
      })
      .catch(() => setError("Failed to load profile"))
      .finally(() => setLoading(false));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
    try {
      const res = await fetch("/api/dashboard/profile", {
        method: "PATCH",
        headers: token
          ? { "content-type": "application/json", authorization: `Bearer ${token}` }
          : { "content-type": "application/json" },
        body: JSON.stringify({
          contact_phone: (form.contact_phone ?? "").trim() || null,
          business_name: (form.business_name ?? "").trim() || null,
          website: (form.website ?? "").trim() || null,
          sector: (form.sector ?? "").trim() || null,
          country_focus: form.country_focus ?? [],
          org_type: (form.org_type ?? "").trim() || null,
          profile_description: (form.profile_description ?? "").trim() || null,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      setProfile((p) => p ? { ...p, ...form, profile_source: "manual" } : p);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Could not save profile. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="px-8 py-16 text-center">
        <div
          className="text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-400"
          style={{ fontFamily: MONO }}
        >
          Loading profile…
        </div>
      </div>
    );
  }

  const inputCls =
    "w-full rounded-sm border border-stone-300 bg-white px-3 py-2.5 text-[13px] focus:outline-none focus:border-stone-700";

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8 max-w-[1100px]">
      {/* Header */}
      <header className="mb-2">
        <div className="flex items-center gap-3 text-[11px] text-stone-500">
          <span className="font-semibold uppercase tracking-[0.18em] text-stone-400">Workbench · Tools</span>
          <span className="text-stone-300">·</span>
          <span style={{ fontFamily: MONO }}>{profile ? sourceLabel(profile.profile_source) : ""}</span>
        </div>
        <h1
          className="mt-1 text-[36px] sm:text-[48px] lg:text-[56px] leading-[1.05] font-medium text-stone-900 tracking-tight"
          style={{ fontFamily: SERIF, fontFeatureSettings: "'ss01'" }}
        >
          Business <em className="italic text-stone-500">profile</em>
        </h1>
        <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-stone-600">
          The data we use to match you against tenders, draft proposals, and track readiness. Keep it sharp — fuzzy fields produce fuzzy matches.
        </p>
      </header>

      {/* Auto-populate notice */}
      {profile?.profile_source === "assessment" && (
        <div className="mt-6 rounded-md border-l-2 border-amber-600 bg-amber-50/40 px-4 py-3">
          <div
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700"
            style={{ fontFamily: MONO }}
          >
            From assessment · please review
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-amber-900">
            We pre-filled this profile from your assessment. Sector and description were inferred — refining them improves match quality.
          </p>
        </div>
      )}

      <form onSubmit={save} className="mt-7 rounded-md border border-stone-200/70 bg-white divide-y divide-stone-200/70">
        <FieldRow index="01" label="Email address" helper="Your login email">
          <input
            readOnly
            className="w-full rounded-sm border border-stone-200 bg-stone-50/60 px-3 py-2.5 text-[13px] text-stone-500 cursor-default focus:outline-none"
            value={profile?.email ?? ""}
            style={{ fontFamily: MONO }}
          />
          <p className="mt-1.5 text-[11px] text-stone-500">
            Change your email through your login provider.
          </p>
        </FieldRow>

        <FieldRow index="02" label="Contact phone" helper="Optional · used for service follow-up">
          <input
            type="tel"
            className={inputCls}
            placeholder="+1 555 000 0000"
            value={form.contact_phone ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, contact_phone: e.target.value }))}
            style={{ fontFamily: MONO }}
          />
        </FieldRow>

        <FieldRow index="03" label="Business name" helper="Legal or trading name">
          <input
            className={inputCls}
            placeholder="Your company or organisation name"
            value={form.business_name ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, business_name: e.target.value }))}
          />
        </FieldRow>

        <FieldRow index="04" label="Website" helper="Used for assessment context">
          <input
            className={inputCls}
            placeholder="https://yourcompany.com"
            value={form.website ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
            style={{ fontFamily: MONO }}
          />
        </FieldRow>

        <FieldRow index="05" label="Organisation type">
          <select
            className={inputCls}
            value={form.org_type ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, org_type: e.target.value }))}
          >
            <option value="">Select type…</option>
            {ORG_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </FieldRow>

        <FieldRow index="06" label="Primary sector" helper="Drives tender matching">
          <select
            className={inputCls}
            value={form.sector ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, sector: e.target.value }))}
          >
            <option value="">Select sector…</option>
            {SECTORS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </FieldRow>

        <FieldRow index="07" label="Countries of operation" helper="Used for geography matching">
          <CountryTagInput
            value={form.country_focus ?? []}
            onChange={(v) => setForm((f) => ({ ...f, country_focus: v }))}
          />
        </FieldRow>

        <FieldRow index="08" label="Business description" helper="What you do, sell, build, or deliver">
          <textarea
            rows={5}
            className="w-full rounded-sm border border-stone-300 bg-white px-3 py-2.5 text-[13px] focus:outline-none focus:border-stone-700 resize-none"
            placeholder="Describe your products, services, and key capabilities…"
            value={form.profile_description ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, profile_description: e.target.value }))}
          />
          <p className="mt-1.5 text-[11px] text-stone-500">
            A richer description improves tender matching quality.
          </p>
        </FieldRow>

        {/* Footer actions */}
        <div className="px-6 py-4 flex items-center justify-between bg-stone-50/40">
          <div
            className="text-[11px] text-stone-500"
            style={{ fontFamily: MONO }}
          >
            Profile data → tender matches → proposal documents.
          </div>
          <div className="flex items-center gap-4">
            {saved && (
              <span
                className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700"
                style={{ fontFamily: MONO }}
              >
                Saved ✓
              </span>
            )}
            {error && (
              <span className="text-[11px] text-red-700">{error}</span>
            )}
            <button
              type="submit"
              disabled={saving}
              className="rounded-sm bg-stone-900 px-5 py-2.5 text-[12.5px] font-medium text-white hover:bg-stone-800 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save profile"}
            </button>
          </div>
        </div>
      </form>

      <ConnectBot />
    </div>
  );
}
