import VendorReadinessCard from "./VendorReadinessCard";

export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-white via-cream to-cream-dark">
      <div className="mx-auto max-w-7xl px-6 lg:px-8 py-16 lg:py-24">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left content */}
          <div className="max-w-xl">
            <p className="text-xs font-bold tracking-[0.2em] uppercase text-gold mb-6">
              $40B UN Market — You&apos;re Being Locked Out
            </p>
            <h1 className="font-serif text-4xl sm:text-5xl lg:text-[3.25rem] font-bold leading-[1.15] text-navy mb-6">
              Qualified businesses lose millions in UN contracts they never even
              find.
            </h1>
            <p className="text-base lg:text-lg text-gray-600 leading-relaxed mb-10">
              The UN spends $40B a year on procurement. 70% goes to repeat
              vendors — not because they&apos;re better, but because they know
              the system. TenderPath decodes the maze so you don&apos;t have to.
            </p>
            <div className="flex flex-wrap gap-4">
              <a
                href="/assessment"
                className="inline-flex items-center gap-2 rounded-lg bg-gold px-6 py-3.5 text-sm font-semibold text-white shadow-md shadow-gold/20 hover:bg-gold-dark transition-colors"
              >
                See What You&apos;re Missing — Free
                <svg
                  className="h-4 w-4"
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
              <a
                href="#how-it-works"
                className="inline-flex items-center rounded-lg border-2 border-navy/15 px-6 py-3.5 text-sm font-semibold text-navy hover:border-navy/30 transition-colors"
              >
                See How It Works
              </a>
            </div>
          </div>

          {/* Right card */}
          <div className="flex justify-center lg:justify-end">
            <VendorReadinessCard />
          </div>
        </div>
      </div>
    </section>
  );
}
