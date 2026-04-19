import { TIERS } from "@/lib/pricing";

export default function Services() {
  return (
    <section id="services" className="bg-white py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-16">
          <p className="text-xs font-bold tracking-[0.2em] uppercase text-gold mb-4">
            Services
          </p>
          <h2 className="font-serif text-3xl sm:text-4xl font-bold text-navy mb-4">
            The right tool for every stage of winning
          </h2>
          <p className="text-gray-500 text-base leading-relaxed">
            Use one service or all four — each delivers immediate value on its own.
          </p>
        </div>

        {/* Pricing cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {TIERS.map((tier) => (
            <div
              key={tier.slug}
              className={`rounded-xl border p-6 flex flex-col ${
                tier.featured
                  ? "border-gold bg-gradient-to-b from-cream to-white shadow-xl shadow-gold/10 ring-1 ring-gold/20"
                  : "border-gray-100 hover:border-gold/20 hover:shadow-lg transition-all"
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
                <span className="font-serif text-3xl font-bold text-navy">
                  {tier.price}
                </span>
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
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4.5 12.75l6 6 9-13.5"
                      />
                    </svg>
                    <span className="text-xs text-gray-600">{feature}</span>
                  </li>
                ))}
              </ul>

              <a
                href={tier.ctaHref}
                className={`mt-6 block rounded-lg py-2.5 text-center text-xs font-semibold transition-colors ${
                  tier.featured
                    ? "bg-gold text-white hover:bg-gold-dark shadow-md shadow-gold/20"
                    : "border-2 border-navy/15 text-navy hover:border-navy/30"
                }`}
              >
                {tier.cta}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
