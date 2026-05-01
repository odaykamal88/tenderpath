"use client";

import { useEffect, useState } from "react";

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
  if (source === "assessment") return "Auto-populated from your assessment · Edit to refine";
  if (source === "manual") return "Manually updated";
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
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((c) => (
          <span key={c} className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 text-xs px-2.5 py-1 font-medium">
            {c}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== c))} className="text-amber-600 hover:text-amber-900 leading-none">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
          placeholder="Add country (press Enter)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        />
        <button type="button" onClick={add} className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">Add</button>
      </div>
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
    if (!token) return;
    fetch("/api/dashboard/profile", { headers: { authorization: `Bearer ${token}` } })
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
        headers: { "content-type": "application/json", authorization: `Bearer ${token ?? ""}` },
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

  if (loading) return <div className="text-sm text-gray-400 py-10 text-center">Loading profile…</div>;

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Business Profile</h1>
        <p className="mt-1 text-sm text-gray-500">
          {profile ? sourceLabel(profile.profile_source) : ""}
        </p>
      </div>

      {profile?.profile_source === "assessment" && (
        <div className="mb-6 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 flex items-start gap-2.5">
          <svg className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>
            This profile was auto-generated from your assessment. Your business description and sector were inferred from your website and inputs — review and refine them to improve tender matching.
          </span>
        </div>
      )}

      <form onSubmit={save} className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {/* Email — read-only */}
        <div className="px-6 py-5 grid sm:grid-cols-3 gap-4 items-start">
          <div>
            <label className="text-sm font-medium text-gray-700">Email address</label>
            <p className="text-xs text-gray-400 mt-0.5">Your login email</p>
          </div>
          <div className="sm:col-span-2">
            <input
              readOnly
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500 cursor-default focus:outline-none"
              value={profile?.email ?? ""}
            />
            <p className="mt-1 text-xs text-gray-400">Change your email in account settings via your login provider.</p>
          </div>
        </div>

        {/* Contact phone */}
        <div className="px-6 py-5 grid sm:grid-cols-3 gap-4 items-start">
          <div>
            <label className="text-sm font-medium text-gray-700">Contact phone</label>
            <p className="text-xs text-gray-400 mt-0.5">Optional · used for service follow-up</p>
          </div>
          <div className="sm:col-span-2">
            <input
              type="tel"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
              placeholder="+1 555 000 0000"
              value={form.contact_phone ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, contact_phone: e.target.value }))}
            />
          </div>
        </div>

        {/* Business name */}
        <div className="px-6 py-5 grid sm:grid-cols-3 gap-4 items-start">
          <div>
            <label className="text-sm font-medium text-gray-700">Business name</label>
            <p className="text-xs text-gray-400 mt-0.5">Legal or trading name</p>
          </div>
          <div className="sm:col-span-2">
            <input
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
              placeholder="Your company or organisation name"
              value={form.business_name ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, business_name: e.target.value }))}
            />
          </div>
        </div>

        {/* Website */}
        <div className="px-6 py-5 grid sm:grid-cols-3 gap-4 items-start">
          <div>
            <label className="text-sm font-medium text-gray-700">Website</label>
            <p className="text-xs text-gray-400 mt-0.5">Used for assessment context</p>
          </div>
          <div className="sm:col-span-2">
            <input
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
              placeholder="https://yourcompany.com"
              value={form.website ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
            />
          </div>
        </div>

        {/* Org type */}
        <div className="px-6 py-5 grid sm:grid-cols-3 gap-4 items-start">
          <div>
            <label className="text-sm font-medium text-gray-700">Organisation type</label>
          </div>
          <div className="sm:col-span-2">
            <select
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none bg-white"
              value={form.org_type ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, org_type: e.target.value }))}
            >
              <option value="">Select type…</option>
              {ORG_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Sector */}
        <div className="px-6 py-5 grid sm:grid-cols-3 gap-4 items-start">
          <div>
            <label className="text-sm font-medium text-gray-700">Primary sector</label>
            <p className="text-xs text-gray-400 mt-0.5">Drives tender matching</p>
          </div>
          <div className="sm:col-span-2">
            <select
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none bg-white"
              value={form.sector ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, sector: e.target.value }))}
            >
              <option value="">Select sector…</option>
              {SECTORS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Countries */}
        <div className="px-6 py-5 grid sm:grid-cols-3 gap-4 items-start">
          <div>
            <label className="text-sm font-medium text-gray-700">Countries of operation</label>
            <p className="text-xs text-gray-400 mt-0.5">Used for geography matching</p>
          </div>
          <div className="sm:col-span-2">
            <CountryTagInput
              value={form.country_focus ?? []}
              onChange={(v) => setForm((f) => ({ ...f, country_focus: v }))}
            />
          </div>
        </div>

        {/* Description */}
        <div className="px-6 py-5 grid sm:grid-cols-3 gap-4 items-start">
          <div>
            <label className="text-sm font-medium text-gray-700">Business description</label>
            <p className="text-xs text-gray-400 mt-0.5">What you do, sell, build, or deliver</p>
          </div>
          <div className="sm:col-span-2">
            <textarea
              rows={5}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none resize-none"
              placeholder="Describe your products, services, and key capabilities…"
              value={form.profile_description ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, profile_description: e.target.value }))}
            />
            <p className="mt-1 text-xs text-gray-400">A richer description improves tender matching quality.</p>
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 flex items-center justify-between bg-gray-50 rounded-b-xl">
          <div className="text-xs text-gray-400">
            Profile data improves your tender matches and proposal documents.
          </div>
          <div className="flex items-center gap-3">
            {saved && (
              <span className="text-xs text-green-600 font-medium">Saved ✓</span>
            )}
            {error && (
              <span className="text-xs text-red-500">{error}</span>
            )}
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save profile"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
