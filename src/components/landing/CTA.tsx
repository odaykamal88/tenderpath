export default function CTA() {
  return (
    <section id="cta" className="bg-navy py-20 lg:py-28">
      <div className="mx-auto max-w-3xl px-6 lg:px-8 text-center">
        <h2 className="font-serif text-3xl sm:text-4xl font-bold text-white mb-4">
          Stop missing contracts you were made to win
        </h2>
        <p className="text-gray-300 text-base leading-relaxed mb-10 max-w-xl mx-auto">
          Take the free Vendor Readiness Assessment. In under 5 minutes,
          you&apos;ll know exactly where you stand — and what to do next.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <a
            href="/assessment"
            className="inline-flex items-center gap-2 rounded-lg bg-gold px-8 py-4 text-base font-semibold text-white shadow-lg shadow-gold/25 hover:bg-gold-light transition-colors"
          >
            Start Your Free Assessment
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 7l5 5m0 0l-5 5m5-5H6"
              />
            </svg>
          </a>
        </div>
        <p className="mt-6 text-xs text-gray-400">
          Free — No credit card required — Results in under 5 minutes
        </p>
      </div>
    </section>
  );
}
