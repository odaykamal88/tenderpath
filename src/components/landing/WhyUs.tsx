/* WhyUs — six reasons, editorial two-column list · mobile-tuned */

const reasons = [
  {
    n: "01",
    title: "Live opportunity monitoring",
    body: "We continuously index UNDP, UNICEF, WHO, WFP, UNHCR, UNGM, and more. You see opportunities the moment they go live — not days later when deadlines are already tight.",
  },
  {
    n: "02",
    title: "Readiness first.",
    body: "The assessment surfaces documentation gaps, registration issues, and compliance problems before they cost you a bid. Fix the blockers once — benefit on every future tender.",
  },
  {
    n: "03",
    title: "Bid/no-bid clarity.",
    body: "For any specific tender, get a clear recommendation — pursue or pass — with the reasoning behind it. Stop guessing whether 30 hours of effort will pay off.",
  },
  {
    n: "04",
    title: "Real workflow, not a dashboard.",
    body: "Every matched tender shows you why it matched: sectors, capabilities, geography, match strength. You understand the rationale before deciding whether to act on it.",
  },
  {
    n: "05",
    title: "Global supplier relevance.",
    body: "The UN sources from 222 countries. African suppliers alone won $5.1B in contracts in 2024. We surface region-relevant opportunities — in English and Arabic.",
  },
  {
    n: "06",
    title: "Free to start.",
    body: "No commitment. Take the readiness assessment in under 3 minutes and get your vendor report instantly. Upgrade only when you're ready to act on a specific tender.",
  },
];

export default function WhyUs() {
  return (
    <section id="why-us" className="bg-paper py-16 sm:py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="grid lg:grid-cols-[1fr_2fr] gap-6 sm:gap-10 lg:gap-16 mb-12 sm:mb-16 items-end">
          <div>
            <p className="font-mono text-[10px] sm:text-[11px] tracking-[0.16em] sm:tracking-[0.18em] uppercase text-accent mb-4 sm:mb-5">
              Why us
            </p>
            <h2 className="font-serif text-[34px] sm:text-[40px] lg:text-[52px] font-normal leading-[1.05] sm:leading-[1.0] tracking-[-0.02em] text-ink text-balance">
              Built to reduce wasted effort.
            </h2>
          </div>
          <p className="text-[15px] sm:text-[16px] text-ink-2 leading-[1.6] max-w-lg lg:pb-3">
            New and emerging vendors get the same intelligence repeat winners use — without the years of accumulated portal experience and relationship capital.
          </p>
        </div>

        {/* Two-column reason grid (1-col on mobile) */}
        <div className="grid md:grid-cols-2 gap-x-12 gap-y-0 border-t border-rule">
          {reasons.map((r) => (
            <article
              key={r.n}
              className="grid grid-cols-[36px_1fr] sm:grid-cols-[44px_1fr] gap-4 sm:gap-5 py-7 sm:py-8 border-b border-rule"
            >
              <span className="font-serif text-[20px] sm:text-[24px] text-accent leading-none tracking-[-0.01em]">
                {r.n}
              </span>
              <div>
                <h3 className="font-serif text-[18px] sm:text-[20px] text-ink leading-[1.2] tracking-[-0.01em] mb-2">
                  {r.title}
                </h3>
                <p className="text-[13.5px] sm:text-[14px] text-ink-2 leading-[1.6]">
                  {r.body}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
