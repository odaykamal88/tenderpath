"use client";

import { useState, useCallback, useMemo } from "react";
import type { AssessmentInput, TierSlug, Gap, MatchedTender, MatchedGrant, ReadinessDimensions } from "@/lib/types";
import AssessmentResults from "./AssessmentResults";
import { REGION_GROUPS } from "@/lib/countries";

interface AssessmentResponse {
  id: number;
  company_name: string;
  email: string;
  sector: string;
  sectors: string[];
  readiness_score: number;
  grant_readiness_score: number;
  recommended_tier: TierSlug;
  summary: string;
  strengths: string[];
  capabilities: string[];
  certifications_detected: string[];
  readiness_dimensions: ReadinessDimensions;
  gaps: Gap[];
  matched_tenders: MatchedTender[];
  matched_grants: MatchedGrant[];
}

const PROGRESS_STEPS = [
  "Crawling your website",
  "Extracting capabilities & services",
  "Matching tenders & grants",
  "Scoring readiness & identifying gaps",
];

export default function AssessmentPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [form, setForm] = useState<Partial<AssessmentInput>>({
    companyName: "", email: "", website: "", description: "",
    countries: [],
  });
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [includeGlobal, setIncludeGlobal] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const [countryDropdownOpen, setCountryDropdownOpen] = useState(false);
  const [progressStage, setProgressStage] = useState(0);
  const [results, setResults] = useState<AssessmentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleCountry = useCallback((country: string) => {
    setSelectedCountries((prev) =>
      prev.includes(country) ? prev.filter((c) => c !== country) : [...prev, country]
    );
    setCountrySearch("");
    setCountryDropdownOpen(false);
  }, []);

  const filteredGroups = useMemo(() => {
    const q = countrySearch.trim().toLowerCase();
    if (!q) return REGION_GROUPS;
    return REGION_GROUPS
      .map((g) => ({
        ...g,
        countries: g.countries.filter((c) => c.toLowerCase().includes(q)),
      }))
      .filter((g) => g.countries.length > 0);
  }, [countrySearch]);

  const handleSubmit = useCallback(async () => {
    if (!form.companyName || !form.email) {
      setError("Please enter your company name and email.");
      return;
    }
    if (!form.website && !form.description) {
      setError("Please share either your website or a short description of your business.");
      return;
    }
    if (!selectedCountries.length && !includeGlobal) {
      setError("Please select at least one country or enable global opportunities.");
      return;
    }

    const countries = Array.from(
      new Set([...selectedCountries, ...(includeGlobal ? ["Global"] : [])])
    );
    const payload: AssessmentInput = {
      companyName: form.companyName!,
      email: form.email!,
      website: form.website || undefined,
      description: form.description || "",
      countries,
    };
    setError(null);
    setStep(2);
    setProgressStage(0);

    // Simulate progress while API runs
    const timers = [
      setTimeout(() => setProgressStage(1), 2000),
      setTimeout(() => setProgressStage(2), 5000),
      setTimeout(() => setProgressStage(3), 8000),
    ];

    try {
      const resp = await fetch("/api/assessment/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      timers.forEach(clearTimeout);

      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.error || "Assessment failed");
      }

      const data: AssessmentResponse = await resp.json();
      setProgressStage(4);
      // Brief pause to show all checkmarks before transition
      setTimeout(() => {
        setResults(data);
        setStep(3);
      }, 600);
    } catch (err) {
      timers.forEach(clearTimeout);
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStep(1);
    }
  }, [form, selectedCountries, includeGlobal]);

  const resetAssessment = useCallback(() => {
    setStep(1);
    setResults(null);
    setForm({ companyName: "", email: "", website: "", description: "", countries: [] });
    setSelectedCountries([]);
    setIncludeGlobal(false);
    setCountrySearch("");
    setError(null);
  }, []);

  return (
    <div className="min-h-screen bg-navy text-white">
      {/* Nav */}
      <nav className="border-b border-white/10">
        <div className="mx-auto max-w-7xl px-6 flex h-14 items-center justify-between">
          <a href="/" className="text-lg font-semibold">Tender<span className="text-gold">Path</span></a>
          <div className="hidden sm:flex items-center gap-6 text-sm text-gray-400">
            <a href="/#how-it-works" className="hover:text-white transition-colors">How It Works</a>
            <a href="/#services" className="hover:text-white transition-colors">Services</a>
            <span className="rounded-md bg-gold px-4 py-1.5 text-white text-xs font-medium">Get Assessment</span>
          </div>
        </div>
      </nav>

      {/* Step indicator */}
      <div className="mx-auto max-w-xl px-6 pt-8 pb-6">
        <div className="flex items-center justify-center gap-0">
          {[1, 2, 3].map((s, i) => (
            <div key={s} className="flex items-center">
              <div className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
                  step > s ? "bg-green border-green text-white" :
                  step === s ? "border-gold text-gold" :
                  "border-gray-600 text-gray-600"
                }`}>
                  {step > s ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : s}
                </div>
                <span className={`text-[10px] mt-1 ${step >= s ? "text-gray-300" : "text-gray-600"}`}>
                  {["Company Info", "Analysis", "Results"][i]}
                </span>
              </div>
              {i < 2 && <div className={`w-20 sm:w-28 h-px mx-2 mb-4 ${step > s ? "bg-green" : "bg-gray-700"}`} />}
            </div>
          ))}
        </div>
      </div>

      {/* Step 1: Company Form */}
      {step === 1 && (
        <div className="mx-auto max-w-2xl px-6 pb-16">
          <h1 className="font-serif text-3xl font-bold text-center mb-2">Free Vendor Readiness Assessment</h1>
          <p className="text-center text-gray-400 text-sm mb-8">
            Find out how ready you are to win UN tenders and grants. Takes 2 minutes.
          </p>

          {error && (
            <div className="mb-6 rounded-lg bg-red/10 border border-red/30 px-4 py-3 text-sm text-red">{error}</div>
          )}

          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Company / Organization Name *</label>
              <input
                type="text"
                value={form.companyName}
                onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                className="w-full rounded-lg bg-navy-light border border-white/10 px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-gold focus:outline-none"
                placeholder="e.g. Mwamba Consulting Ltd"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Work Email *</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full rounded-lg bg-navy-light border border-white/10 px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-gold focus:outline-none"
                placeholder="you@company.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Website URL <span className="text-gray-500">(optional)</span></label>
              <input
                type="url"
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
                className="w-full rounded-lg bg-navy-light border border-white/10 px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-gold focus:outline-none"
                placeholder="https://yourcompany.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Describe Your Business <span className="text-gray-500">(optional if website provided)</span>
              </label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                className="w-full rounded-lg bg-navy-light border border-white/10 px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-gold focus:outline-none resize-none"
                placeholder="Skip this if you provided a website — we'll read it for you. Otherwise, share what you do in a sentence or two."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Where You Operate * <span className="text-gray-500 text-xs">(countries where you deliver work)</span>
              </label>

              {selectedCountries.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {selectedCountries.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => toggleCountry(c)}
                      className="group rounded-md bg-gold/15 border border-gold/40 px-2 py-0.5 text-xs text-white hover:bg-gold/25"
                    >
                      {c} <span className="text-gold/70 group-hover:text-white">×</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="relative">
                <input
                  type="text"
                  value={countrySearch}
                  onChange={(e) => { setCountrySearch(e.target.value); setCountryDropdownOpen(true); }}
                  onFocus={() => setCountryDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setCountryDropdownOpen(false), 150)}
                  className="w-full rounded-lg bg-navy-light border border-white/10 px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-gold focus:outline-none"
                  placeholder="Type a country to search…"
                />

                {countryDropdownOpen && (
                  <div className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-navy-light shadow-xl">
                    {filteredGroups.length === 0 ? (
                      <div className="px-3 py-4 text-xs text-gray-500">No countries match &ldquo;{countrySearch}&rdquo;.</div>
                    ) : (
                      filteredGroups.map((g) => (
                        <div key={g.label}>
                          <div className="sticky top-0 bg-navy-light/95 backdrop-blur px-3 py-1.5 text-[10px] font-semibold tracking-wider text-gold uppercase border-b border-white/5">
                            {g.label}
                          </div>
                          <div className="py-1">
                            {g.countries.map((c) => {
                              const active = selectedCountries.includes(c);
                              return (
                                <button
                                  key={c}
                                  type="button"
                                  onMouseDown={(e) => { e.preventDefault(); toggleCountry(c); }}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 hover:bg-white/5 cursor-pointer text-left"
                                >
                                  <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${active ? "bg-gold border-gold" : "border-white/20 bg-navy"}`}>
                                    {active && (
                                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                      </svg>
                                    )}
                                  </span>
                                  <span className={active ? "text-white" : ""}>{c}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              <label className="mt-3 flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeGlobal}
                  onChange={(e) => setIncludeGlobal(e.target.checked)}
                  className="mt-0.5 w-3.5 h-3.5 rounded border-white/20 bg-navy text-gold focus:ring-gold focus:ring-offset-0"
                />
                <span className="text-xs text-gray-400">
                  Also include <span className="text-white">regional / global opportunities</span> (remote-friendly tenders with no specific country)
                </span>
              </label>
            </div>

            <button
              onClick={handleSubmit}
              className="w-full rounded-lg bg-gold py-3 text-sm font-semibold text-white hover:bg-gold-dark transition-colors mt-4"
            >
              Run Free Assessment
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Analysis Progress */}
      {step === 2 && (
        <div className="mx-auto max-w-lg px-6 py-16 text-center">
          <div className="mx-auto mb-6 w-12 h-12 border-3 border-gold/30 border-t-gold rounded-full animate-spin" />
          <h2 className="font-serif text-2xl font-bold mb-2">Analyzing Your Business...</h2>
          <p className="text-gray-400 text-sm mb-8">This takes 10-20 seconds. We&apos;re doing real work here.</p>
          <div className="text-left space-y-3 max-w-sm mx-auto">
            {PROGRESS_STEPS.map((label, i) => (
              <div key={label} className="flex items-center gap-3">
                {progressStage > i ? (
                  <svg className="w-4 h-4 text-green flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : progressStage === i ? (
                  <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-gold animate-pulse" />
                  </div>
                ) : (
                  <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-gray-600" />
                  </div>
                )}
                <span className={`text-sm ${progressStage > i ? "text-green" : progressStage === i ? "text-gold" : "text-gray-500"}`}>
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step 3: Results */}
      {step === 3 && results && (
        <AssessmentResults data={results} onReset={resetAssessment} />
      )}

      {/* Footer */}
      <footer className="border-t border-white/5 py-6 text-center text-xs text-gray-500">
        &copy; {new Date().getFullYear()} TenderPath. All rights reserved. | <a href="/" className="underline hover:text-gray-300">Back to Home</a>
      </footer>
    </div>
  );
}
