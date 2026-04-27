export default function Testimonials() {
  return (
    <section className="bg-white py-20 lg:py-24 border-t border-gray-100">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <p className="text-xs font-bold tracking-[0.2em] uppercase text-gold mb-4">Client Results</p>
          <h2 className="font-serif text-3xl sm:text-4xl font-bold text-navy mb-4">
            Early results, more case studies soon
          </h2>
          <p className="text-gray-500 text-base leading-relaxed max-w-lg mx-auto">
            We&apos;re working with vendors and procurement-facing teams to refine
            readiness scoring, tender fit analysis, and proposal workflows.
            Detailed customer stories are coming soon.
          </p>
        </div>

        {/* Market proof strip */}
        <div className="grid sm:grid-cols-3 gap-6 max-w-3xl mx-auto">
          {[
            { value: "$25.7B", label: "UN procurement spend in 2024", source: "UN Annual Statistics" },
            { value: "222", label: "countries with eligible suppliers", source: "UNGM 2024" },
            { value: "$5.1B", label: "won by African suppliers in 2024", source: "UN Procurement Report" },
          ].map((stat) => (
            <div key={stat.label} className="text-center p-6 rounded-xl bg-gray-50 border border-gray-100">
              <p className="font-serif text-3xl font-bold text-gold mb-1">{stat.value}</p>
              <p className="text-sm text-gray-600 mb-1">{stat.label}</p>
              <p className="text-[10px] text-gray-400">{stat.source}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
