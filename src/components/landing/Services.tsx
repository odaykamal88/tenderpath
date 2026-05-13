"use client";

import { TIERS } from "@/lib/pricing";

/* Services — 5-stage journey + flat rate sheet · mobile-tuned at 375px */

const journey = [
  { n: "01", label: "Assess", price: "Free", body: "Score readiness, identify gaps, preview matched tenders." },
  { n: "02", label: "Match", price: "$49/mo", body: "Weekly digest of 5–10 best-fit tenders + grants. AR + EN." },
  { n: "03", label: "Decide", price: "$39", body: "Bid/no-bid memo per tender. Fit reasoning + checklist." },
  { n: "04", label: "Submit", price: "$299", body: "80% complete proposal package, delivered in 48–72 hrs." },
  { n: "05", label: "Roster", price: "$749", body: "Full vendor registration for one target UN agency." },
];

export default function Services() {
  return (
    <section id="services" className="bg-paper py-16 sm:py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="grid lg:grid-cols-[1fr_2fr] gap-6 sm:gap-10 lg:gap-16 mb-12 sm:mb-16 items-end">
          <div>
            <p className="font-mono text-[10px] sm:text-[11px] tracking-[0.16em] sm:tracking-[0.18em] uppercase text-accent mb-4 sm:mb-5">
              Services
            </p>
            <h2 className="font-serif text-[34px] sm:text-[40px] lg:text-[52px] font-normal leading-[1.05] sm:leading-[1.0] tracking-[-0.02em] text-ink text-balance">
              One service per stage.
            </h2>
          </div>
          <p className="text-[15px] sm:text-[16px] text-ink-2 leading-[1.6] max-w-lg lg:pb-3">
            Start with a free assessment. Subscribe to matching when you want a steady pipeline. Pay per-tender for bid/no-bid memos and proposal drafting only when an opportunity is worth the effort.
          </p>
        </div>

        {/* 5-stage journey diagram */}
        <div className="border-y border-ink py-7 sm:py-10 mb-14 sm:mb-20">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-px bg-rule">
            {journey.map((j, i) => (
              <div key={j.n} className="bg-paper p-5 sm:p-6 relative">
                <div className="flex items-baseline justify-between mb-3 sm:mb-4">
                  <span className="font-mono text-[10px] tracking-[0.14em] sm:tracking-[0.16em] uppercase text-accent">
                    Stage {j.n}
                  </span>
                  <span className="font-mono text-[10px] text-ink-3 tabular-nums">
                    {j.price}
                  </span>
                </div>
                <h3 className="font-serif text-[26px] sm:text-[28px] text-ink leading-none tracking-[-0.02em] mb-2.5 sm:mb-3">
                  {j.label}
                </h3>
                <p className="text-[12.5px] text-ink-2 leading-[1.55]">
                  {j.body}
                </p>
                {i < journey.length - 1 && (
                  <span className="hidden md:block absolute right-[-7px] top-1/2 -translate-y-1/2 font-mono text-[14px] text-mute z-10 bg-paper px-1">
                    →
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Rate sheet — typographic, not selectable cards */}
        <div className="grid lg:grid-cols-[200px_1fr] gap-6 sm:gap-10 lg:gap-16 mb-8 sm:mb-10">
          <div>
            <p className="font-mono text-[10px] sm:text-[11px] tracking-[0.16em] sm:tracking-[0.18em] uppercase text-accent mb-3">
              Rate sheet
            </p>
            <p className="text-[13px] text-ink-2 leading-[1.6]">
              Transparent, listed pricing. No discovery calls. No tier upsell. Pay with card.
            </p>
          </div>
          <div className="border-t border-ink">
            {TIERS.map((tier) => (
              <article
                key={tier.slug}
                className="grid grid-cols-[1fr_auto] lg:grid-cols-[1.2fr_2fr_auto] gap-x-4 gap-y-4 lg:gap-10 py-6 sm:py-7 border-b border-rule items-baseline"
              >
                {/* Title block */}
                <div className="min-w-0">
                  <h3 className="font-serif text-[20px] sm:text-[22px] lg:text-[24px] text-ink leading-tight tracking-[-0.01em]">
                    {tier.name}
                  </h3>
                  <p className="font-mono text-[10px] tracking-[0.1em] uppercase text-mute mt-1.5 sm:mt-2">
                    {tier.label}
                  </p>
                  {tier.featured && (
                    <span className="inline-block mt-2 font-mono text-[9px] tracking-[0.16em] uppercase text-accent border border-accent px-2 py-0.5">
                      Most chosen
                    </span>
                  )}
                </div>
                {/* Desktop tagline */}
                <p className="hidden lg:block text-[13px] text-ink-2 leading-[1.55] max-w-md">
                  {tier.tagline}
                </p>
                {/* Price + CTAs */}
                <div className="flex flex-col items-end gap-1.5 sm:gap-2 min-w-[120px] sm:min-w-[160px]">
                  <div className="flex items-baseline gap-1">
                    <span className="font-serif text-[30px] sm:text-[36px] lg:text-[40px] leading-none text-ink tabular-nums tracking-[-0.02em]">
                      {tier.price}
                    </span>
                    <span className="font-mono text-[10px] sm:text-[11px] text-ink-3">
                      {tier.billingPeriod}
                    </span>
                  </div>
                  <a
                    href={tier.ctaHref}
                    className="font-mono text-[10px] tracking-[0.1em] sm:tracking-[0.12em] uppercase text-ink hover:text-accent border-b border-ink hover:border-accent pb-0.5 whitespace-nowrap"
                  >
                    {tier.cta} →
                  </a>
                </div>
                {/* Mobile-only tagline (full width) */}
                <p className="lg:hidden col-span-2 text-[13px] text-ink-2 leading-[1.55]">
                  {tier.tagline}
                </p>
              </article>
            ))}
          </div>
        </div>

        {/* Free tier promo strip */}
        <a
          href="/assessment"
          className="block bg-ink text-paper p-6 sm:p-8 lg:p-10 group hover:bg-accent transition-colors"
        >
          <div className="grid lg:grid-cols-[1fr_auto] gap-5 sm:gap-6 items-center">
            <div>
              <p className="font-mono text-[10px] tracking-[0.16em] sm:tracking-[0.18em] uppercase text-accent group-hover:text-paper mb-2.5 sm:mb-3">
                Always free · No login
              </p>
              <h3 className="font-serif text-[24px] sm:text-[28px] lg:text-[32px] leading-[1.1] tracking-[-0.02em] mb-2">
                Start with the readiness assessment.
              </h3>
              <p className="text-[13.5px] sm:text-[14px] text-paper-2 leading-[1.55] max-w-xl">
                Five minutes. Get your score, gap analysis, UNGM status check, and a preview of matched tenders — before you decide whether any of the paid tiers are worth it.
              </p>
            </div>
            <span className="font-mono text-[11px] sm:text-[12px] tracking-[0.1em] uppercase border-b border-paper pb-1 self-start lg:self-auto whitespace-nowrap">
              Run it now →
            </span>
          </div>
        </a>
      </div>
    </section>
  );
}
