"use client";

import { useState, useMemo, useCallback } from "react";
import { REGION_GROUPS } from "@/lib/countries";

/* ============================================================
   Wizard steps — Direction A (paper, serif, mono)
   - Same data shape, same exports, same constants as before.
   - Restyled to match the paper editorial system.
   - Adds "why we ask" microcopy under each field.
   ============================================================ */

// ── Types (unchanged contract) ────────────────────────────────────────────

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
  intent: string;
  operatingCountries: string[];
  submissionLanguage: string;
  description: string;
  sectors: string[];
  capabilities: string[];
  devThemes: string[];
  contractVolume: string;
  annualRevenueRange: string;
  unRegistered: string;
  certifications: string[];
}

// ── Constants ─────────────────────────────────────────────────────────────

export const SECTOR_OPTIONS = [
  "Information Technology", "Healthcare", "Education & Training",
  "Logistics & Supply Chain", "Water & Sanitation", "Renewable Energy",
  "Environmental Services", "Construction", "Monitoring and Evaluation",
  "Language Services", "Security Services", "Food Services",
  "Financial Services", "Consulting & Advisory", "Media & Communications",
  "Agriculture",
];

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

const INTENT_OPTIONS = [
  { value: "track-tenders", label: "Find & track tenders" },
  { value: "evaluate-tender", label: "Evaluate a specific tender" },
  { value: "prepare-proposal", label: "Prepare a proposal" },
  { value: "register-roster", label: "Register on a roster / LTA" },
];

const CONTRACT_VOLUME_OPTIONS = [
  { value: "none", label: "None yet" },
  { value: "1-5", label: "1–5 contracts" },
  { value: "6-20", label: "6–20 contracts" },
  { value: "20+", label: "20+ contracts" },
];

const REVENUE_RANGE_OPTIONS = [
  { value: "unknown", label: "Prefer not to say" },
  { value: "<100k", label: "< $100K" },
  { value: "100k-500k", label: "$100K–$500K" },
  { value: "500k-5m", label: "$500K–$5M" },
  { value: "5m-25m", label: "$5M–$25M" },
  { value: "25m+", label: "$25M+" },
];

const UN_REG_OPTIONS = [
  { value: "yes", label: "Yes, registered" },
  { value: "in-progress", label: "In progress" },
  { value: "no", label: "Not yet" },
];

// ── Shared editorial micro-components ─────────────────────────────────────

function Field({
  num, label, why, required, aiFilled, children,
}: {
  num: string;
  label: string;
  why: string;
  required?: boolean;
  aiFilled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-rule py-7">
      <div className="grid lg:grid-cols-[60px_1fr] gap-4 lg:gap-6">
        <div>
          <p className="font-mono text-[10px] tracking-[0.12em] text-accent tabular-nums">
            {num}
          </p>
          {aiFilled && (
            <span className="inline-block mt-2 font-mono text-[8px] tracking-[0.16em] uppercase text-accent border border-accent px-1.5 py-0.5">
              AI filled
            </span>
          )}
        </div>
        <div>
          <label className="block font-serif text-[20px] text-ink leading-tight tracking-[-0.01em] mb-1">
            {label}
            {required && <span className="text-accent ml-1">*</span>}
          </label>
          <p className="text-[12px] text-ink-3 leading-[1.5] mb-4 max-w-md">{why}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full bg-transparent border-b border-ink-2 px-0 py-2 font-serif text-[18px] text-ink placeholder:text-mute focus:outline-none focus:border-accent transition-colors"
    />
  );
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className="w-full bg-paper-2 border border-rule p-4 text-[14px] text-ink placeholder:text-mute leading-[1.6] focus:outline-none focus:border-accent resize-none transition-colors"
    />
  );
}

function ChipButton({
  active, label, onClick,
}: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`font-mono text-[11px] tracking-[0.04em] px-3 py-2 border transition-colors ${
        active
          ? "border-ink bg-ink text-paper"
          : "border-rule bg-paper text-ink-2 hover:border-ink hover:text-ink"
      }`}
    >
      {active && <span className="mr-1">✓</span>}
      {label}
    </button>
  );
}

function ChipSelect({
  options, selected, onChange, aiDetected = [],
}: {
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  aiDetected?: string[];
}) {
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const isSel = selected.includes(o);
        const isAi = aiDetected.includes(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => toggle(o)}
            className={`font-mono text-[11px] tracking-[0.04em] px-3 py-2 border transition-colors inline-flex items-center gap-1.5 ${
              isSel
                ? "border-ink bg-ink text-paper"
                : "border-rule bg-paper text-ink-2 hover:border-ink hover:text-ink"
            }`}
          >
            {isSel && <span>✓</span>}
            {o}
            {isAi && !isSel && (
              <span className="font-mono text-[8px] tracking-[0.12em] text-accent border border-accent px-1">
                AI
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function TagInput({
  values, onChange, placeholder,
}: { values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState("");
  const add = () => {
    const v = input.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setInput("");
  };
  return (
    <div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-2 border border-ink bg-paper-2 px-2.5 py-1 font-mono text-[11px] text-ink"
            >
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                className="text-mute hover:text-ink leading-none"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className="flex-1 bg-transparent border-b border-ink-2 px-0 py-2 text-[14px] text-ink placeholder:text-mute focus:outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={add}
          className="font-mono text-[10px] tracking-[0.1em] uppercase text-ink border-b border-ink hover:text-accent hover:border-accent pb-1 px-2"
        >
          Add +
        </button>
      </div>
    </div>
  );
}

export function StepNav({
  onBack, onNext, nextLabel = "Continue", canNext = true,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  canNext?: boolean;
}) {
  return (
    <div className="flex items-center justify-between pt-8 mt-2">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="font-mono text-[11px] tracking-[0.12em] uppercase text-ink-3 hover:text-ink"
        >
          ← Back
        </button>
      ) : <div />}
      <button
        type="button"
        onClick={onNext}
        disabled={!canNext}
        className="bg-ink text-paper font-mono text-[11px] tracking-[0.14em] uppercase px-7 py-3.5 hover:bg-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {nextLabel} →
      </button>
    </div>
  );
}

// ── Step 1: Company Basics ────────────────────────────────────────────────

export function Step1({
  data, preview, onChange, onNext,
}: {
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
    <div>
      {aiDidFill && (
        <div className="border-l-2 border-accent bg-paper-2 px-5 py-4 mb-2">
          <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-accent mb-1.5">
            We read your website
          </p>
          <p className="text-[13px] text-ink-2 leading-snug">
            Pre-filled from{" "}
            <span className="text-ink font-mono text-[12px]">{preview.finalUrl ?? data.website}</span>.
            Review each field — edit anything that&rsquo;s off.
          </p>
        </div>
      )}
      {preview && !aiDidFill && (
        <div className="border-l-2 border-mute bg-paper-2 px-5 py-4 mb-2">
          <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-mute mb-1.5">
            Limited site content
          </p>
          <p className="text-[13px] text-ink-2 leading-snug">
            {preview.renderMethod === "parked"
              ? "That domain looks parked or for sale — please fill in your details below."
              : "Your website had limited content — please describe your business manually below."}
          </p>
        </div>
      )}

      <Field
        num="01"
        label="Company / organization name"
        why="Used on your readiness report and any submitted proposals."
        required
        aiFilled={!!aiDidFill && !!preview?.detectedName}
      >
        <TextInput
          type="text"
          value={data.companyName}
          onChange={(e) => onChange({ companyName: e.target.value })}
          placeholder="Mwamba Consulting Ltd"
        />
      </Field>

      <Field
        num="02"
        label="Work email"
        why="We send your full report here. No spam, no list-sharing — see /privacy."
        required
      >
        <TextInput
          type="email"
          value={data.email}
          onChange={(e) => onChange({ email: e.target.value })}
          placeholder="you@company.com"
        />
      </Field>

      <Field
        num="03"
        label="Organization type"
        why="Different vendor categories see different opportunities. NGOs also see grants."
        aiFilled={!!aiDidFill && !!preview?.detectedOrgType}
      >
        <div className="flex flex-wrap gap-1.5">
          {ORG_TYPES.map((t) => (
            <ChipButton
              key={t.value}
              active={data.orgType === t.value}
              label={t.label}
              onClick={() => onChange({ orgType: t.value })}
            />
          ))}
        </div>
      </Field>

      <Field
        num="04"
        label="What do you want to do first?"
        why="We tune the report toward your immediate goal — no point ranking 50 tenders if you&rsquo;re focused on one."
      >
        <div className="flex flex-wrap gap-1.5">
          {INTENT_OPTIONS.map((o) => (
            <ChipButton
              key={o.value}
              active={data.intent === o.value}
              label={o.label}
              onClick={() => onChange({ intent: o.value })}
            />
          ))}
        </div>
      </Field>

      <Field
        num="05"
        label="About your business"
        why="A short description sharply improves matching — especially if your website is light or focused on one product."
        aiFilled={!!aiDidFill && !!preview?.detectedDescription}
      >
        <Textarea
          rows={4}
          value={data.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="What you deliver, who you serve, the geographies you work in…"
        />
        {preview?.isThinContent && (
          <p className="font-mono text-[10px] tracking-[0.06em] text-accent mt-2">
            ⚠ Your site was thin on content — a description here meaningfully improves match quality.
          </p>
        )}
      </Field>

      <Field
        num="06"
        label="Submission language"
        why="Tenders are language-locked. We surface opportunities you can credibly submit on."
        aiFilled={!!aiDidFill && !!preview?.detectedLanguage}
      >
        <div className="flex flex-wrap gap-1.5">
          {LANGUAGE_OPTIONS.map((l) => (
            <ChipButton
              key={l}
              active={data.submissionLanguage === l}
              label={l}
              onClick={() => onChange({ submissionLanguage: l })}
            />
          ))}
        </div>
      </Field>

      <Field
        num="07"
        label="Where you operate"
        why="Geography is the #1 disqualifier on UN tenders. We only surface opportunities in countries you serve."
        required
        aiFilled={!!aiDidFill && preview != null && preview.detectedCountries.length > 0}
      >
        {data.operatingCountries.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {data.operatingCountries.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => toggleCountry(c)}
                className="inline-flex items-center gap-1.5 border border-ink bg-paper-2 px-2.5 py-1 font-mono text-[11px] text-ink hover:bg-ink hover:text-paper"
              >
                {c} <span className="text-mute">×</span>
              </button>
            ))}
          </div>
        )}
        <div className="relative">
          <input
            type="text"
            value={countrySearch}
            onChange={(e) => { setCountrySearch(e.target.value); setDropdownOpen(true); }}
            onFocus={() => setDropdownOpen(true)}
            onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
            placeholder="Type a country to search…"
            className="w-full bg-transparent border-b border-ink-2 px-0 py-2 text-[14px] text-ink placeholder:text-mute focus:outline-none focus:border-accent"
          />
          {dropdownOpen && (
            <div className="absolute z-10 mt-1 w-full max-h-72 overflow-y-auto border border-ink bg-paper shadow-xl">
              {filteredGroups.map((g) => (
                <div key={g.label}>
                  <div className="sticky top-0 bg-paper-2 px-3 py-1.5 font-mono text-[10px] tracking-[0.12em] text-accent uppercase border-b border-rule">
                    {g.label}
                  </div>
                  {g.countries.map((c) => {
                    const active = data.operatingCountries.includes(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); toggleCountry(c); }}
                        className="w-full flex items-center gap-3 px-3 py-2 text-[13px] text-ink-2 hover:bg-paper-2 hover:text-ink text-left"
                      >
                        <span className={`w-3.5 h-3.5 border flex items-center justify-center flex-shrink-0 ${active ? "bg-ink border-ink" : "border-rule"}`}>
                          {active && (
                            <svg className="w-2.5 h-2.5 text-paper" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
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
      </Field>

      <StepNav onNext={onNext} nextLabel="Next · What you do" canNext={canNext} />
    </div>
  );
}

// ── Step 2: What you do ───────────────────────────────────────────────────

export function Step2({
  data, preview, onChange, onBack, onNext,
}: {
  data: WizardData;
  preview: CrawlPreview | null;
  onChange: (patch: Partial<WizardData>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const aiSectors = preview?.detectedSectors ?? [];

  return (
    <div>
      <Field
        num="01"
        label="Core sectors"
        why="The strongest matching signal. Select all that apply — secondary sectors expand your matched pool."
        required
      >
        <ChipSelect
          options={SECTOR_OPTIONS}
          selected={data.sectors}
          onChange={(v) => onChange({ sectors: v })}
          aiDetected={aiSectors}
        />
        {aiSectors.length > 0 && (
          <p className="font-mono text-[10px] tracking-[0.06em] text-mute mt-3">
            Sectors marked <span className="text-accent">AI</span> were detected on your website. Confirm or remove.
          </p>
        )}
      </Field>

      <Field
        num="02"
        label="Services & specific capabilities"
        why="Tender requirements often go deeper than sector — e.g. &lsquo;cold-chain logistics in Sahel&rsquo;. The more specific, the better the match."
      >
        <TagInput
          values={data.capabilities}
          onChange={(v) => onChange({ capabilities: v })}
          placeholder="solar installation, M&E surveys, cold-chain logistics…"
        />
      </Field>

      {data.orgType === "ngo" && (
        <Field
          num="03"
          label="Development themes"
          why="Used to surface grant opportunities aligned to your mandate, in addition to procurement tenders."
        >
          <ChipSelect
            options={DEV_THEME_OPTIONS}
            selected={data.devThemes}
            onChange={(v) => onChange({ devThemes: v })}
          />
        </Field>
      )}

      <StepNav onBack={onBack} onNext={onNext} nextLabel="Next · Experience" canNext={data.sectors.length > 0} />
    </div>
  );
}

// ── Step 3: Experience ────────────────────────────────────────────────────

export function Step3({
  data, onChange, onBack, onNext,
}: {
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
    <div>
      <div className="mb-2 border-l-2 border-accent bg-paper-2 px-5 py-4">
        <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-accent mb-1.5">
          Free assessment · public data only
        </p>
        <p className="text-[13px] text-ink-2 leading-snug">
          No uploads, audited financials, bank references, or private documents here. We only ask for public profile details and broad self-reported bands; proof comes later if you order a paid deliverable.
        </p>
      </div>

      <Field
        num="01"
        label="Past UN / donor contracts"
        why="Used to score &lsquo;track record&rsquo; on your readiness report. Honest answer is fine — &lsquo;none yet&rsquo; doesn&rsquo;t disqualify you."
      >
        <div className="flex flex-wrap gap-1.5">
          {CONTRACT_VOLUME_OPTIONS.map((o) => (
            <ChipButton
              key={o.value}
              active={data.contractVolume === o.value}
              label={o.label}
              onClick={() => onChange({ contractVolume: o.value })}
            />
          ))}
        </div>
      </Field>

      <Field
        num="02"
        label="Annual revenue range"
        why="A self-reported band is enough for the free assessment. We use it only to avoid tenders with obvious turnover thresholds — no financial statements required."
      >
        <div className="flex flex-wrap gap-1.5">
          {REVENUE_RANGE_OPTIONS.map((o) => (
            <ChipButton
              key={o.value}
              active={data.annualRevenueRange === o.value}
              label={o.label}
              onClick={() => onChange({ annualRevenueRange: o.value })}
            />
          ))}
        </div>
      </Field>

      <Field
        num="03"
        label="UNGM / UN vendor registration"
        why="Most agencies require active UNGM registration. If you&rsquo;re not registered, we flag it as the first gap to fix."
      >
        <div className="flex flex-wrap gap-1.5">
          {UN_REG_OPTIONS.map((o) => (
            <ChipButton
              key={o.value}
              active={data.unRegistered === o.value}
              label={o.label}
              onClick={() => onChange({ unRegistered: o.value })}
            />
          ))}
        </div>
      </Field>

      <Field
        num="04"
        label="Certifications & compliance"
        why="Name registrations or certifications you already know you have. We do not ask for certificates or policy documents in the free assessment."
      >
        <div className="flex flex-wrap gap-1.5 mb-4">
          {CERT_SUGGESTIONS.map((c) => (
            <ChipButton
              key={c}
              active={data.certifications.includes(c)}
              label={c}
              onClick={() => toggleCert(c)}
            />
          ))}
        </div>
        <TagInput
          values={customCerts}
          onChange={(v) =>
            onChange({
              certifications: [
                ...data.certifications.filter((c) => CERT_SUGGESTIONS.includes(c)),
                ...v,
              ],
            })
          }
          placeholder="Other certifications…"
        />
      </Field>

      <StepNav onBack={onBack} onNext={onNext} nextLabel="Run my assessment" />
    </div>
  );
}
