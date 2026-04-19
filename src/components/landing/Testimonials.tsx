const testimonials = [
  {
    quote: "TenderPath helped us find and win our first UNDP contract in under three months. The readiness assessment showed us exactly which documents we were missing.",
    name: "Kwame A.",
    title: "CEO, Infrastructure Consultancy",
    country: "Ghana",
  },
  {
    quote: "We were losing bids to the same vendors for years. The competitor intelligence showed us why — and how to position differently. We've since won two WHO contracts.",
    name: "Fatima R.",
    title: "Director, Development Advisory",
    country: "Jordan",
  },
  {
    quote: "The weekly digest saves our team 10+ hours of manual searching. Getting matched opportunities in Arabic is something no other platform offers.",
    name: "Ahmed S.",
    title: "Procurement Manager, International NGO",
    country: "Egypt",
  },
];

export default function Testimonials() {
  return (
    <section className="bg-white py-20 lg:py-24 border-t border-gray-100">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <p className="text-xs font-bold tracking-[0.2em] uppercase text-gold mb-4">Client Results</p>
          <h2 className="font-serif text-3xl sm:text-4xl font-bold text-navy mb-4">
            Vendors winning with TenderPath
          </h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {testimonials.map((t) => (
            <div key={t.name} className="rounded-xl border border-gray-100 bg-gray-50 p-6 flex flex-col gap-4">
              <svg className="h-6 w-6 text-gold/40" fill="currentColor" viewBox="0 0 24 24">
                <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z" />
              </svg>
              <p className="text-sm text-gray-700 leading-relaxed flex-1">&ldquo;{t.quote}&rdquo;</p>
              <div>
                <div className="text-sm font-semibold text-navy">{t.name}</div>
                <div className="text-xs text-gray-500">{t.title} · {t.country}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
