const tiers = [
  {
    name: "Tender Intelligence",
    price: "$49",
    period: "/mo",
    description: "For businesses exploring UN procurement opportunities.",
    features: [
      "Vendor Readiness Assessment",
      "Live tender matching (up to 10/month)",
      "Basic compliance checklist",
      "UNGM registration guidance",
      "Email notifications for new matches",
    ],
    cta: "Start Free Assessment",
    featured: false,
  },
  {
    name: "Submission Package",
    price: "$199",
    period: "/mo",
    description: "For businesses ready to bid on UN contracts.",
    features: [
      "Everything in Tender Intelligence",
      "Unlimited tender matching",
      "Full gap analysis & remediation plan",
      "Bid/no-bid recommendation engine",
      "Document preparation templates",
      "Competitor activity monitoring",
    ],
    cta: "Get Started",
    featured: false,
  },
  {
    name: "Strategic Partnership",
    price: "$599",
    period: "/mo",
    description: "For businesses serious about winning consistently.",
    features: [
      "Everything in Submission Package",
      "Dedicated account strategist",
      "End-to-end submission support",
      "Pre-bid compliance review",
      "Post-award contract support",
      "Quarterly performance reviews",
      "Priority tender alerts",
    ],
    cta: "Contact Sales",
    featured: true,
  },
];

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
            Choose the level of support you need
          </h2>
          <p className="text-gray-500 text-base leading-relaxed">
            Start with a free assessment. Upgrade when you&apos;re ready to
            compete.
          </p>
        </div>

        {/* Pricing cards */}
        <div className="grid md:grid-cols-3 gap-8">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`rounded-xl border p-8 flex flex-col ${
                tier.featured
                  ? "border-gold bg-gradient-to-b from-cream to-white shadow-xl shadow-gold/10 ring-1 ring-gold/20"
                  : "border-gray-100 hover:border-gold/20 hover:shadow-lg transition-all"
              }`}
            >
              {tier.featured && (
                <span className="inline-block self-start rounded-full bg-gold/10 text-gold text-[10px] font-bold tracking-wider uppercase px-3 py-1 mb-4">
                  Most Popular
                </span>
              )}
              <h3 className="text-lg font-semibold text-navy">{tier.name}</h3>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="font-serif text-4xl font-bold text-navy">
                  {tier.price}
                </span>
                <span className="text-sm text-gray-400">{tier.period}</span>
              </div>
              <p className="mt-3 text-sm text-gray-500">{tier.description}</p>

              <ul className="mt-6 space-y-3 flex-1">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <svg
                      className="h-4 w-4 mt-0.5 shrink-0 text-green"
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
                    <span className="text-sm text-gray-600">{feature}</span>
                  </li>
                ))}
              </ul>

              <a
                href="/assessment"
                className={`mt-8 block rounded-lg py-3 text-center text-sm font-semibold transition-colors ${
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
