"use client";

import { useState, useMemo, useCallback } from "react";
import { REGION_GROUPS } from "@/lib/countries";

// ── Types ──────────────────────────────────────────────────────────────────

export interface CrawlPreview {
  confidence: "high" | "medium" | "low";
  detectedName: string | null;
  detectedDescription: string | null;
  detectedSectors: string[];
  detectedServices: string[];
  detectedOrgType: string | null;
  detectedCountries: string[];
  detectedLanguage: string | null;
  isThinContent: boolean;
  renderMethod: string;
  finalUrl: string | null;
}

export interface WizardData {
  website: string;
  companyName: string;
  email: string;
  orgType: string;
  operatingCountries: string[];
  submissionLanguage: string;
  description: string;
  sectors: string[];
  capabilities: string[];
  devThemes: string[];
  contractVolume: string;
  maxContractValue: string;
  unRegistered: string;
  certifications: string[];
}

// ── Constants ──────────────────────────────────────────────────────────────

export const SECTOR_OPTIONS = [
  "Information Technology", "Healthcare", "Education & Training",
  "Logistics & Supply Chain", "Water & Sanitation", "Renewable Energy",
  "Environmental Services", "Construction", "Monitoring and Evaluation",
  "Language Services", "Security Services", "Food Services",
  "Financial Services", "Consulting & Advisory", "Media & Communications",
  "Agriculture",
];

const SECTOR_META: Record<string, { icon: string; desc: string }> = {
  "Information Technology":    { icon: "💻", desc: "Software, IT & data systems" },
  "Healthcare":                { icon: "🏥", desc: "Medical, pharma & health systems" },
  "Education & Training":      { icon: "📚", desc: "Learning & capacity building" },
  "Logistics & Supply Chain":  { icon: "🚚", desc: "Transport & warehousing" },
  "Water & Sanitation":        { icon: "💧", desc: "WASH & water infrastructure" },
  "Renewable Energy":          { icon: "⚡", desc: "Solar, wind & clean energy" },
  "Environmental Services":    { icon: "🌱", desc: "Environment & conservation" },
  "Construction":              { icon: "🏗️", desc: "Civil works & infrastructure" },
  "Monitoring and Evaluation": { icon: "📊", desc: "M&E, research & assessments" },
  "Language Services":         { icon: "🌐", desc: "Translation & interpretation" },
  "Security Services":         { icon: "🛡️", desc: "Guards & risk management" },
  "Food Services":             { icon: "🍽️", desc: "Food supply & catering" },
  "Financial Services":        { icon: "💰", desc: "Finance & microfinance" },
  "Consulting & Advisory":     { icon: "💼", desc: "Strategy & policy advisory" },
  "Media & Communications":    { icon: "📡", desc: "Media & outreach" },
  "Agriculture":               { icon: "🌿", desc: "Farming & agribusiness" },
};

const DEV_THEME_OPTIONS = [
  "Gender Equality", "Climate & Environment", "Health Systems",
  "Education", "Humanitarian Response", "Governance & Rule of Law",
  "Economic Development", "Food Security",
];

const CERT_SUGGESTIONS = [
  "ISO 9001", "ISO 14001", "ISO 27001", "OHSAS 18001",
  "UN Global Compact", "UNGM", "DUNS/SAM", "Sphere Standards",
];

const LANGUAGE_OPTIONS = ["English", "French", "Arabic", "Spanish", "Russian", "Portuguese"];

const ORG_TYPES = [
  { value: "company", label: "Company / SME" },
  { value: "ngo", label: "NGO / Non-profit" },
  { value: "sole-trader", label: "Sole trader" },
  { value: "government", label: "Government entity" },
];

const CONTRACT_VOLUME_OPTIONS = [
  { value: "none", label: "None yet" },
  { value: "1-5", label: "1–5 contracts" },
  { value: "6-20", label: "6–20 contracts" },
  { value: "20+", label: "20+ contracts" },
];

const CONTRACT_VALUE_OPTIONS = [
  { value: "<50k", label: "< $50k" },
  { value: "50k-250k", label: "$50k–$250k" },
  { value: "250k-1m", label: "$250k–$1m" },
  { value: "1m+", label: "$1m+" },
];

const UN_REG_OPTIONS = [
  { value: "yes", label: "Yes, registered" },
  { value: "in-progress", label: "In progress" },
  { value: "no", label: "Not yet" },
];

// ── Shared micro-components ────────────────────────────────────────────────

function SparkleIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
    </svg>
  );
}

function FieldLabel({
  children, hint, aiDetected,
}: {
  children: React.ReactNode;
  hint?: string;
  aiDetected?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between mb-1.5">
      <label className="text-sm font-medium text-gray-300">{children}</label>
      <div className="flex items-center gap-2">
        {hint && <span className="text-xs text-gray-500">{hint}</span>}
        {aiDetected && (
          <span className="inline-flex items-center gap-1 text-[10px] text-gold/80 bg-gold/10 rounded px-1.5 py-0.5">
            <SparkleIcon className="w-2.5 h-2.5" /> AI filled
          </span>
        )}
      </div>
    </div>
  );
}

function ChipSelect({ options, selected, onChange }: {
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => toggle(o)}
          className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
            selected.includes(o)
              ? "border-gold bg-gold/20 text-white"
              : "border-white/10 bg-navy text-gray-400 hover:border-white/25 hover:text-white"
          }`}>
          {selected.includes(o) ? "✓ " : ""}{o}
        </button>
      ))}
    </div>
  );
}

function SectorGrid({ selected, onChange, aiDetected = [] }: {
  selected: string[];
  onChange: (v: string[]) => void;
  aiDetected?: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  const visible = expanded ? SECTOR_OPTIONS : SECTOR_OPTIONS.slice(0, 10);

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {visible.map((sector) => {
          const meta = SECTOR_META[sector] ?? { icon: "🔹", desc: "" };
          const isSelected = selected.includes(sector);
          const isAi = aiDetected.includes(sector);
          return (
            <button
              key={sector}
              type="button"
              onClick={() => toggle(sector)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                isSelected
                  ? "border-gold bg-gold/20 text-white"
                  : "border-white/10 bg-navy text-gray-400 hover:border-white/25 hover:text-white"
              }`}
            >
              <span className="text-sm leading-none">{meta.icon}</span>
              {isSelected && <span className="text-gold">✓</span>}
              {sector}
              {isAi && !isSelected && (
                <span className="text-[8px] bg-gold/20 text-gold rounded px-1 py-0.5 font-bold leading-none">AI</span>
              )}
            </button>
          );
        })}
      </div>
      {SECTOR_OPTIONS.length > 10 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2.5 text-xs text-gold/70 hover:text-gold transition-colors"
        >
          {expanded ? "Show fewer sectors ↑" : `+ ${SECTOR_OPTIONS.length - 10} more sectors`}
        </button>
      )}
    </div>
  );
}

function TagInput({ values, onChange, placeholder }: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");
  const add = () => {
    const v = input.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setInput("");
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-md bg-gold/15 border border-gold/30 px-2 py-0.5 text-xs text-white">
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))}
              className="text-gold/60 hover:text-white leading-none ml-0.5">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }}
          placeholder={placeholder}
          className="flex-1 rounded-lg bg-navy-light border border-white/10 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-gold focus:outline-none" />
        <button type="button" onClick={add}
          className="rounded-lg border border-white/10 px-3 py-2 text-xs text-gray-400 hover:border-gold hover:text-white transition-colors">
          Add
        </button>
      </div>
    </div>
  );
}

export function StepNav({ onBack, onNext, nextLabel = "Continue", canNext = true }: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  canNext?: boolean;
}) {
  return (
    <div className="flex items-center justify-between pt-6 mt-6 border-t border-white/10">
      {onBack ? (
        <button type="button" onClick={onBack}
          className="text-sm text-gray-400 hover:text-white transition-colors">
          ← Back
        </button>
      ) : <div />}
      <button type="button" onClick={onNext} disabled={!canNext}
        className="rounded-lg bg-gold px-6 py-2.5 text-sm font-semibold text-white hover:bg-gold-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
        {nextLabel} →
      </button>
    </div>
  );
}

// ── Step 1: Company Basics ─────────────────────────────────────────────────

export function Step1({ data, preview, onChange, onNext }: {
  data: WizardData;
  preview: CrawlPreview | null;
  onChange: (patch: Partial<WizardData>) => void;
  onNext: () => void;
}) {
  const [countrySearch, setCountrySearch] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const filteredGroups = useMemo(() => {
    const q = countrySearch.trim().toLowerCase();
    if (!q) return REGION_GROUPS;
    return REGION_GROUPS
      .map((g) => ({ ...g, countries: g.countries.filter((c) => c.toLowerCase().includes(q)) }))
      .filter((g) => g.countries.length > 0);
  }, [countrySearch]);

  const toggleCountry = useCallback((c: string) => {
    onChange({
      operatingCountries: data.operatingCountries.includes(c)
        ? data.operatingCountries.filter((x) => x !== c)
        : [...data.operatingCountries, c],
    });
    setCountrySearch("");
    setDropdownOpen(false);
  }, [data.operatingCountries, onChange]);

  const aiDidFill = preview && preview.confidence !== "low";
  const canNext = Boolean(data.companyName.trim() && data.email.trim() && data.operatingCountries.length);

  return (
    <div className="space-y-5">
      {/* AI autocomplete banner */}
      {aiDidFill && (
        <div className="rounded-xl border border-gold/25 bg-gold/5 px-4 py-3 flex items-start gap-3">
          <SparkleIcon className="w-4 h-4 text-gold mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-white">AI read your website</p>
            <p className="text-xs text-gray-400 mt-0.5">
              We detected your profile from{" "}
              <span className="text-gray-300">{preview.finalUrl ?? "your website"}</span>.
              Review the fields below and edit anything that looks off.
            </p>
          </div>
        </div>
      )}
      {preview && !aiDidFill && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 flex items-start gap-3">
          <span className="text-gray-500 text-sm mt-0.5">ℹ️</span>
          <p className="text-xs text-gray-400">
            {preview.renderMethod === "parked"
              ? "That domain looks parked or for sale — no company content was found. Please fill in your details below."
              : "Your website had limited content — please describe your business manually below."}
          </p>
        </div>
      )}

      <div>
        <FieldLabel aiDetected={!!aiDidFill && !!preview?.detectedName}>Company / Organization Name *</FieldLabel>
        <input type="text" value={data.companyName}
          onChange={(e) => onChange({ companyName: e.target.value })}
          className={`w-full rounded-lg bg-navy-light border px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-gold focus:outline-none ${
            aiDidFill && preview?.detectedName ? "border-gold/40" : "border-white/10"
          }`}
          placeholder="e.g. Mwamba Consulting Ltd" />
      </div>

      <div>
        <FieldLabel>Work Email *</FieldLabel>
        <input type="email" value={data.email}
          onChange={(e) => onChange({ email: e.target.value })}
          className="w-full rounded-lg bg-navy-light border border-white/10 px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-gold focus:outline-none"
          placeholder="you@company.com" />
        <p className="mt-1 text-xs text-gray-500">Your report is sent here — no spam.</p>
      </div>

      <div>
        <FieldLabel aiDetected={!!aiDidFill && !!preview?.detectedOrgType}>Organization type</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {ORG_TYPES.map((t) => (
            <button key={t.value} type="button" onClick={() => onChange({ orgType: t.value })}
              className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                data.orgType === t.value
                  ? "border-gold bg-gold/20 text-white"
                  : "border-white/10 text-gray-400 hover:border-white/25 hover:text-white"
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <FieldLabel
          aiDetected={!!aiDidFill && !!preview?.detectedDescription}
          hint="optional if website provided">
          About your business
        </FieldLabel>
        <textarea value={data.description} onChange={(e) => onChange({ description: e.target.value })}
          rows={3}
          className={`w-full rounded-lg bg-navy-light border px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-gold focus:outline-none resize-none ${
            aiDidFill && preview?.detectedDescription ? "border-gold/40" : "border-white/10"
          }`}
          placeholder="What does your organization do, deliver, or sell?" />
        {preview?.isThinContent && (
          <p className="mt-1 text-xs text-amber-300/80">
            Your website appears thin — a description here will improve matching quality.
          </p>
        )}
      </div>

      <div>
        <FieldLabel hint="optional" aiDetected={!!aiDidFill && !!preview?.detectedLanguage}>Submission language</FieldLabel>
        <select value={data.submissionLanguage} onChange={(e) => onChange({ submissionLanguage: e.target.value })}
          className={`w-full rounded-lg bg-navy-light border px-4 py-2.5 text-sm text-white focus:border-gold focus:outline-none ${
            aiDidFill && preview?.detectedLanguage ? "border-gold/40" : "border-white/10"
          }`}>
          <option value="">Select language</option>
          {LANGUAGE_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>

      <div>
        <FieldLabel aiDetected={!!aiDidFill && preview != null && preview.detectedCountries.length > 0}>Where you operate *</FieldLabel>
        {data.operatingCountries.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {data.operatingCountries.map((c) => (
              <button key={c} type="button" onClick={() => toggleCountry(c)}
                className="rounded-md bg-gold/15 border border-gold/40 px-2 py-0.5 text-xs text-white hover:bg-gold/25">
                {c} <span className="text-gold/70">×</span>
              </button>
            ))}
          </div>
        )}
        <div className="relative">
          <input type="text" value={countrySearch}
            onChange={(e) => { setCountrySearch(e.target.value); setDropdownOpen(true); }}
            onFocus={() => setDropdownOpen(true)}
            onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
            placeholder="Type a country to search…"
            className="w-full rounded-lg bg-navy-light border border-white/10 px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-gold focus:outline-none" />
          {dropdownOpen && (
            <div className="absolute z-10 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-white/10 bg-navy-light shadow-xl">
              {filteredGroups.map((g) => (
                <div key={g.label}>
                  <div className="sticky top-0 bg-navy-light/95 backdrop-blur px-3 py-1.5 text-[10px] font-semibold tracking-wider text-gold uppercase border-b border-white/5">
                    {g.label}
                  </div>
                  {g.countries.map((c) => {
                    const active = data.operatingCountries.includes(c);
                    return (
                      <button key={c} type="button"
                        onMouseDown={(e) => { e.preventDefault(); toggleCountry(c); }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 hover:bg-white/5 text-left">
                        <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${active ? "bg-gold border-gold" : "border-white/20"}`}>
                          {active && (
                            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </span>
                        {c}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <StepNav onNext={onNext} nextLabel="Next: What you do" canNext={canNext} />
    </div>
  );
}

// ── Step 2: What You Actually Do ───────────────────────────────────────────

export function Step2({ data, preview, onChange, onBack, onNext }: {
  data: WizardData;
  preview: CrawlPreview | null;
  onChange: (patch: Partial<WizardData>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const aiSectors = preview?.detectedSectors ?? [];

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-1">
          <FieldLabel>Core sectors *</FieldLabel>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Select all that apply — these drive tender matching.
          {aiSectors.length > 0 && (
            <span className="ml-1 text-gold/70">AI-suggested ones are marked.</span>
          )}
        </p>
        <SectorGrid
          selected={data.sectors}
          onChange={(v) => onChange({ sectors: v })}
          aiDetected={aiSectors}
        />
      </div>

      <div>
        <FieldLabel hint="optional">Services & capabilities</FieldLabel>
        <p className="text-xs text-gray-500 mb-3">Add specific services you deliver. Press Enter or comma to add.</p>
        <TagInput values={data.capabilities} onChange={(v) => onChange({ capabilities: v })}
          placeholder="e.g. solar installation, data collection, cold-chain logistics…" />
      </div>

      {data.orgType === "ngo" && (
        <div>
          <FieldLabel hint="optional">Development themes</FieldLabel>
          <p className="text-xs text-gray-500 mb-3">Used to surface grant opportunities aligned to your mandate.</p>
          <ChipSelect options={DEV_THEME_OPTIONS} selected={data.devThemes}
            onChange={(v) => onChange({ devThemes: v })} />
        </div>
      )}

      <StepNav onBack={onBack} onNext={onNext} nextLabel="Next: Experience"
        canNext={data.sectors.length > 0} />
    </div>
  );
}

// ── Step 3: Procurement Experience ─────────────────────────────────────────

export function Step3({ data, onChange, onBack, onNext }: {
  data: WizardData;
  onChange: (patch: Partial<WizardData>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const customCerts = data.certifications.filter((c) => !CERT_SUGGESTIONS.includes(c));
  const toggleCert = (c: string) => {
    onChange({
      certifications: data.certifications.includes(c)
        ? data.certifications.filter((x) => x !== c)
        : [...data.certifications, c],
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <FieldLabel hint="optional">Number of past UN / donor contracts</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {CONTRACT_VOLUME_OPTIONS.map((o) => (
            <button key={o.value} type="button" onClick={() => onChange({ contractVolume: o.value })}
              className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                data.contractVolume === o.value
                  ? "border-gold bg-gold/20 text-white"
                  : "border-white/10 text-gray-400 hover:border-white/25 hover:text-white"
              }`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <FieldLabel hint="optional">Largest single contract value</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {CONTRACT_VALUE_OPTIONS.map((o) => (
            <button key={o.value} type="button" onClick={() => onChange({ maxContractValue: o.value })}
              className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                data.maxContractValue === o.value
                  ? "border-gold bg-gold/20 text-white"
                  : "border-white/10 text-gray-400 hover:border-white/25 hover:text-white"
              }`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <FieldLabel hint="optional">UNGM / UN vendor registration</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {UN_REG_OPTIONS.map((o) => (
            <button key={o.value} type="button" onClick={() => onChange({ unRegistered: o.value })}
              className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                data.unRegistered === o.value
                  ? "border-gold bg-gold/20 text-white"
                  : "border-white/10 text-gray-400 hover:border-white/25 hover:text-white"
              }`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <FieldLabel hint="optional">Certifications & compliance</FieldLabel>
        <div className="flex flex-wrap gap-2 mb-3">
          {CERT_SUGGESTIONS.map((c) => (
            <button key={c} type="button" onClick={() => toggleCert(c)}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                data.certifications.includes(c)
                  ? "border-gold bg-gold/20 text-white"
                  : "border-white/10 text-gray-400 hover:border-white/25 hover:text-white"
              }`}>
              {data.certifications.includes(c) ? "✓ " : ""}{c}
            </button>
          ))}
        </div>
        <TagInput
          values={customCerts}
          onChange={(v) => onChange({ certifications: [...data.certifications.filter((c) => CERT_SUGGESTIONS.includes(c)), ...v] })}
          placeholder="Add other certifications…" />
      </div>

      <StepNav onBack={onBack} onNext={onNext} nextLabel="Run Assessment" />
    </div>
  );
}

