import VendorReadinessCard from "./VendorReadinessCard";

export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-white via-cream to-cream-dark">
      <div className="mx-auto max-w-7xl px-6 lg:px-8 py-16 lg:py-24">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left content */}
          <div className="max-w-xl">
            <p className="text-xs font-bold tracking-[0.2em] uppercase text-gold mb-6">
              UN Procurement Intelligence
            </p>
            <h1 className="font-serif text-4xl sm:text-5xl lg:text-[3.25rem] font-bold leading-[1.15] text-navy mb-6">
              You may already qualify for UN contracts — and still be missing
              them.
            </h1>
            <p className="text-base lg:text-lg text-gray-600 leading-relaxed mb-10">
              The UN bought $25.7B in goods and services in 2024 from suppliers
              across 222 countries and territories, but new vendors still get
              filtered out by fragmented portals, compliance gaps, and missed
              fit signals. TenderPath helps you see where you stand, decide
              whether a tender is worth pursuing, and move faster on the ones
              you can actually win.
            </p>
            <div className="flex flex-wrap gap-4">
              <a
                href="/assessment"
                className="inline-flex items-center gap-2 rounded-lg bg-gold px-6 py-3.5 text-sm font-semibold text-white shadow-md shadow-gold/20 hover:bg-gold-dark transition-colors"
              >
                Get My Free Vendor Readiness Score
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
                See how it works ↓
              </a>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Already assessed?{" "}
              <a href="/login" className="font-medium text-navy hover:underline underline-offset-2">
                Sign in to your dashboard →
              </a>
            </p>
            <div className="mt-8 space-y-1">
              <p className="text-xs text-gray-400 leading-relaxed">
                Used by vendors exploring UN procurement across Africa, the
                Middle East, and beyond
              </p>
              <div className="flex flex-wrap gap-x-2 gap-y-1">
                {["🇯🇴", "🇬🇭", "🇰🇪", "🇪🇬", "🇵🇰", "🇳🇬"].map((flag, i) => (
                  <span
                    key={flag}
                    className="text-base"
                    style={{
                      animation: "fadeInUp 0.5s ease-out both",
                      animationDelay: `${0.1 + i * 0.06}s`,
                    }}
                  >
                    {flag}
                  </span>
                ))}
                <span className="text-xs text-gray-400 self-center">+ more</span>
              </div>
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
