/* HowItWorks — editorial four-step process · mobile-tuned */

const steps = [
  {
    n: "01",
    title: "Tell us what you do.",
    body: "Two minutes. We score your readiness across five dimensions, check UNGM status, and flag the gaps that disqualify most vendors before evaluation.",
    output: "Output · Vendor readiness file · Free",
  },
  {
    n: "02",
    title: "See matched tenders, with reasoning.",
    body: "Live opportunities scored by sector, geography, capability, and deadline urgency. Every match shows why it matched — not a black-box AI score.",
    output: "Output · Pipeline of 5–20 ranked matches",
  },
  {
    n: "03",
    title: "Decide before you draft.",
    body: "Paste any tender URL. Get a bid/no-bid recommendation with fit reasoning, gap analysis, and a required-documents checklist — before you spend 30 hours.",
    output: "Output · Bid/no-bid memo · $39 per analysis",
  },
  {
    n: "04",
    title: "Submit, fast.",
    body: "When you decide to bid, our drafting service delivers an 80% complete proposal package in 48–72 hours. Full roster-registration fast-track is coming soon.",
    output: "Output · Proposal package · Roster fast-track coming soon",
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-paper-2 py-16 sm:py-20 lg:py-28 border-y border-rule">
      <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="max-w-3xl mb-12 sm:mb-16">
          <p className="font-mono text-[10px] sm:text-[11px] tracking-[0.16em] sm:tracking-[0.18em] uppercase text-accent mb-4 sm:mb-5">
            The Process
          </p>
          <h2 className="font-serif text-[34px] sm:text-[40px] lg:text-[52px] font-normal leading-[1.05] sm:leading-[1.0] tracking-[-0.02em] text-ink text-balance">
            From &ldquo;where do I start?&rdquo; to <span className="italic text-accent">contract awarded</span>, in four steps.
          </h2>
        </div>

        {/* 2x2 step grid (1-col on mobile) */}
        <div className="grid md:grid-cols-2 gap-px bg-rule">
          {steps.map((s) => (
            <article
              key={s.n}
              className="bg-paper-2 p-6 sm:p-8 lg:p-10 relative"
            >
              <div className="flex items-baseline gap-4 sm:gap-5 mb-4 sm:mb-5">
                <span className="font-serif text-[34px] sm:text-[40px] text-accent leading-none">
                  {s.n}
                </span>
                <span className="flex-1 h-px bg-rule" />
              </div>
              <h3 className="font-serif text-[21px] sm:text-[24px] lg:text-[26px] text-ink leading-[1.2] tracking-[-0.01em] mb-3 sm:mb-4">
                {s.title}
              </h3>
              <p className="text-[14px] text-ink-2 leading-[1.65] mb-5 sm:mb-6 max-w-md">
                {s.body}
              </p>
              <p className="font-mono text-[10px] tracking-[0.08em] uppercase text-ink-3 pt-4 border-t border-rule leading-relaxed">
                {s.output}
              </p>
            </article>
          ))}
        </div>

        {/* Footer note */}
        <p className="font-mono text-[10.5px] sm:text-[11px] text-ink-3 mt-8 sm:mt-10 text-center tracking-[0.04em] leading-relaxed">
          Step 01 is always free. Pay only when you act on a specific tender.
        </p>
      </div>
    </section>
  );
}
