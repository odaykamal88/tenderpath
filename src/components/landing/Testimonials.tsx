/* Testimonials — "Built by" credibility block · mobile-tuned */

export default function Testimonials() {
  return (
    <section id="builtby" className="bg-paper-2 py-16 sm:py-20 lg:py-28 border-y border-rule">
      <div className="mx-auto max-w-5xl px-5 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-[200px_1fr] gap-6 sm:gap-10 lg:gap-16 items-start">
          {/* Left rail */}
          <div className="flex lg:block items-baseline gap-4 lg:gap-0 pb-3 lg:pb-0 border-b lg:border-b-0 border-rule">
            <p className="font-mono text-[10px] sm:text-[11px] tracking-[0.16em] sm:tracking-[0.18em] uppercase text-accent lg:mb-4 flex-1 lg:flex-auto">
              Built by
            </p>
            <p className="font-mono text-[10px] tracking-[0.06em] uppercase text-mute leading-relaxed">
              Founder note · May 2026
            </p>
          </div>

          {/* Right column — pull quote */}
          <div className="relative">
            <p className="font-serif text-[22px] sm:text-[28px] lg:text-[34px] leading-[1.25] sm:leading-[1.2] tracking-[-0.01em] text-ink text-balance mb-8 sm:mb-10 max-w-3xl">
              <span className="font-serif text-[60px] sm:text-[80px] lg:text-[100px] text-accent leading-none float-left mr-3 sm:mr-4 mt-1 -ml-1">
                &ldquo;
              </span>
              I spent years inside WFP reviewing supplier bids. The same pattern, every cycle: <em className="italic text-accent not-italic font-serif">qualified</em> vendors losing on paperwork. Wrong format. Missing certificate. Filed the wrong version. Never even reached the technical evaluation.
              <br /><br />
              They had the capacity. They didn&rsquo;t have the playbook. TenderPath is the playbook.
            </p>

            {/* Attribution */}
            <div className="flex items-baseline gap-4 pt-5 sm:pt-6 border-t border-rule">
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-medium text-ink">Oday Kamal</p>
                <p className="text-[12px] text-ink-3 mt-0.5">
                  Founder, TenderPath · Former WFP supplier review
                </p>
              </div>
              <p className="font-mono text-[10px] tracking-[0.08em] uppercase text-mute hidden sm:block">
                Cairo, Egypt
              </p>
            </div>

            {/* Credentials strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-5 gap-x-6 sm:gap-x-8 mt-8 sm:mt-10 pt-5 sm:pt-6 border-t border-rule">
              {[
                ["8 yrs", "UN procurement"],
                ["1,200+", "Bids reviewed"],
                ["15+", "UN agencies"],
                ["AR · EN", "Native bilingual"],
              ].map(([n, l]) => (
                <div key={l}>
                  <p className="font-serif text-[22px] sm:text-[24px] leading-none text-ink tabular-nums">
                    {n}
                  </p>
                  <p className="font-mono text-[10px] tracking-[0.08em] uppercase text-mute mt-2">
                    {l}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
