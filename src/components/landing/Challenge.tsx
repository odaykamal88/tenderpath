/* Challenge — editorial numbered list with quantified callouts · mobile-tuned */

const problems = [
  {
    n: "01",
    pull: "$25.7B",
    pullLabel: "Spread across UNGM, agency portals, regional offices, and grant systems",
    title: "Opportunities are fragmented.",
    body: "Live tenders sit on a dozen different portals. Most qualifying vendors never see the right contract at the right time — by the time it surfaces in a roundup, the deadline is already tight.",
  },
  {
    n: "02",
    pull: "70%",
    pullLabel: "of bids that fail are eliminated on paperwork, not fit",
    title: "Compliance gaps disqualify you before evaluation.",
    body: "UNGM registration errors, missing financial documents, and legal gaps stop more bids than technical capability does. The paperwork barrier is solvable — but only if you know which barrier you're hitting.",
  },
  {
    n: "03",
    pull: "30hrs",
    pullLabel: "Average time to draft a serious UN proposal",
    title: "The expensive mistake is chasing the wrong bid.",
    body: "Vendors routinely invest 30 hours in tenders they were never going to win — wrong geography, wrong experience tier, wrong technical fit. The cost isn't the proposal. It's the ones you didn't write because you were busy with this one.",
  },
];

export default function Challenge() {
  return (
    <section id="challenge" className="bg-paper py-16 sm:py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="grid lg:grid-cols-[1fr_2fr] gap-6 sm:gap-10 lg:gap-16 mb-12 sm:mb-16 items-end">
          <div>
            <p className="font-mono text-[10px] sm:text-[11px] tracking-[0.16em] sm:tracking-[0.18em] uppercase text-accent mb-4 sm:mb-5">
              The Challenge
            </p>
            <h2 className="font-serif text-[34px] sm:text-[40px] lg:text-[52px] font-normal leading-[1.05] sm:leading-[1.0] tracking-[-0.02em] text-ink text-balance">
              UN procurement is real.<br />
              <span className="text-ink-3">Just hard to navigate.</span>
            </h2>
          </div>
          <p className="text-[15px] sm:text-[16px] text-ink-2 leading-[1.6] max-w-lg lg:pb-3">
            The contracts exist. The barrier is knowing where you stand and which opportunities are actually worth pursuing — before you spend a week of evenings on a proposal nobody will read.
          </p>
        </div>

        {/* Numbered problem list */}
        <div className="border-t border-rule">
          {problems.map((p) => (
            <article
              key={p.n}
              className="grid lg:grid-cols-[80px_1fr_280px] gap-5 sm:gap-8 lg:gap-12 py-9 sm:py-10 lg:py-12 border-b border-rule"
            >
              {/* Mobile: number + pullquote inline. Desktop: number first column. */}
              <div className="flex items-baseline justify-between lg:block">
                <div className="font-serif text-[40px] sm:text-[44px] text-accent leading-none tracking-[-0.02em]">
                  {p.n}
                </div>
                {/* Mobile-only inline pull number */}
                <div className="lg:hidden border-l border-ink pl-3">
                  <p className="font-serif text-[28px] leading-none text-ink tabular-nums">
                    {p.pull}
                  </p>
                </div>
              </div>
              <div>
                <h3 className="font-serif text-[22px] sm:text-[26px] lg:text-[28px] text-ink leading-[1.2] sm:leading-[1.15] tracking-[-0.01em] mb-3">
                  {p.title}
                </h3>
                <p className="text-[14.5px] sm:text-[15px] text-ink-2 leading-[1.6] max-w-xl">
                  {p.body}
                </p>
                {/* Mobile-only: pull label sits below body */}
                <p className="lg:hidden font-mono text-[10px] tracking-[0.06em] text-ink-3 mt-4 pt-3 border-t border-rule leading-relaxed">
                  {p.pullLabel}
                </p>
              </div>
              {/* Desktop pull aside */}
              <aside className="hidden lg:block border-l border-ink pl-5 lg:self-center">
                <p className="font-serif text-[36px] lg:text-[40px] leading-none text-ink tabular-nums">
                  {p.pull}
                </p>
                <p className="font-mono text-[10px] tracking-[0.06em] text-ink-3 mt-2 leading-relaxed">
                  {p.pullLabel}
                </p>
              </aside>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
