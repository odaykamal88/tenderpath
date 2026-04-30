export default function CTA() {
  return (
    <section id="cta" className="bg-navy py-20 lg:py-28">
      <div className="mx-auto max-w-3xl px-6 lg:px-8 text-center">
        <h2 className="font-serif text-3xl sm:text-4xl font-bold text-white mb-4">
          Stop wasting time on tenders you shouldn&apos;t chase
        </h2>
        <p className="text-gray-300 text-base leading-relaxed mb-10 max-w-xl mx-auto">
          The free Vendor Readiness Assessment tells you where you stand, what
          gaps you need to fix, and which opportunities match your profile
          right now — in minutes.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <a
            href="/assessment"
            className="inline-flex items-center gap-2 rounded-lg bg-gold px-8 py-4 text-base font-semibold text-white shadow-lg shadow-gold/25 hover:bg-gold-dark transition-colors"
          >
            Start My Free Assessment
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
          Free · No credit card required · Results in minutes
        </p>
        <p className="mt-2 text-xs text-gray-500">
          Already a member?{" "}
          <a href="/login" className="text-gold hover:underline underline-offset-2">
            Sign in to your dashboard →
          </a>
        </p>
      </div>
    </section>
  );
}
