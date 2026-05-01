"use client";

import { useState } from "react";
import { TIERS } from "@/lib/pricing";

export default function Services() {
  const [selected, setSelected] = useState(TIERS.findIndex((t) => t.featured));

  return (
    <section id="services" className="bg-white py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-16">
          <p className="text-xs font-bold tracking-[0.2em] uppercase text-gold mb-4">
            Services
          </p>
          <h2 className="font-serif text-3xl sm:text-4xl font-bold text-navy mb-4">
            Use TenderPath where it saves you the most time
          </h2>
          <p className="text-gray-500 text-base leading-relaxed">
            Start free. Then use one service at a time — based on the exact
            point where your team gets stuck.
          </p>
        </div>

        {/* Free tier card — entire card is a link to /assessment */}
        <a
          href="/assessment"
          className="mb-6 rounded-xl border-2 border-dashed border-gold/30 bg-cream/40 p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4 hover:border-gold/60 hover:bg-cream/70 transition-colors group"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gold/10 text-gold group-hover:bg-gold/20 transition-colors">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">Always Free</p>
            <h3 className="text-base font-semibold text-navy">Vendor Readiness Assessment</h3>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              Describe your business and get an instant readiness score, UNGM status check, compliance gap analysis, and a preview of matched tenders — no payment required.
            </p>
          </div>
          <span className="shrink-0 rounded-lg bg-gold px-5 py-2.5 text-xs font-semibold text-white group-hover:bg-gold-dark shadow-md shadow-gold/20 transition-colors">
            Start free →
          </span>
        </a>

        {/* Paid tier cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {TIERS.map((tier, i) => {
            const isSelected = selected === i;
            return (
              <button
                key={tier.slug}
                onClick={() => setSelected(i)}
                className={`rounded-xl border p-6 flex flex-col text-left transition-all ${
                  isSelected
                    ? "border-gold bg-gradient-to-b from-cream to-white shadow-xl shadow-gold/10 ring-2 ring-gold/30"
                    : "border-gray-100 hover:border-gold/20 hover:shadow-lg"
                }`}
              >
                {tier.featured && (
                  <span className="inline-block self-start rounded-full bg-gold/10 text-gold text-[10px] font-bold tracking-wider uppercase px-3 py-1 mb-3">
                    Most Popular
                  </span>
                )}
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
                  {tier.label}
                </p>
                <h3 className="text-base font-semibold text-navy leading-tight">{tier.name}</h3>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="font-serif text-3xl font-bold text-navy">{tier.price}</span>
                  <span className="text-xs text-gray-400">{tier.billingPeriod}</span>
                </div>
                <p className="mt-0.5 text-[10px] text-gray-400">{tier.billingNote}</p>
                <p className="mt-3 text-xs text-gray-500 leading-relaxed flex-1">{tier.tagline}</p>

                <ul className="mt-5 space-y-2.5">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <svg
                        className="h-3.5 w-3.5 mt-0.5 shrink-0 text-green"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      <span className="text-xs text-gray-600">{feature}</span>
                    </li>
                  ))}
                </ul>

                <a
                  href={tier.ctaHref}
                  onClick={(e) => e.stopPropagation()}
                  className={`mt-6 block rounded-lg py-2.5 text-center text-xs font-semibold transition-colors ${
                    isSelected
                      ? "bg-gold text-white hover:bg-gold-dark shadow-md shadow-gold/20"
                      : "border-2 border-navy/15 text-navy hover:border-navy/30"
                  }`}
                >
                  {tier.cta}
                </a>
                <a
                  href={`/pay?plan=${tier.slug}`}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-2 block rounded-lg py-2 text-center text-[11px] font-medium text-gray-400 hover:text-gray-600 border border-gray-100 hover:border-gray-200 transition-colors"
                >
                  Pay with USDT · Wire · Whish
                </a>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
