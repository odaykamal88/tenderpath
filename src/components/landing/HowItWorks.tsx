const steps = [
  {
    number: "01",
    title: "Free Readiness Assessment",
    description:
      "Answer a short questionnaire about your business — sector, capabilities, certifications, and experience. Takes 2 minutes.",
    detail: "We evaluate your UNGM registration, documentation, and financial compliance instantly.",
  },
  {
    number: "02",
    title: "Know Before You Bid",
    description:
      "Paste a tender URL and get an instant bid/no-bid recommendation with win probability, scoring criteria breakdown, and a gap analysis.",
    detail: "Stop wasting 30 hours on proposals you can't win. Devex shows the tender — TenderPath tells you whether to bother.",
  },
  {
    number: "03",
    title: "Get Weekly Matched Opportunities",
    description:
      "Receive a curated digest of 5–10 AI-matched tenders and grants scored by fit for your exact profile. Arabic and English.",
    detail: "Real-time matching across UNDP, UNICEF, WHO, WFP, and 190+ UN agencies.",
  },
  {
    number: "04",
    title: "Submit and Win",
    description:
      "Use our proposal drafting service to get an 80% complete submission package in 48–72 hours — then review, sign, and send.",
    detail: "Also: fast-track your vendor roster registration for WFP, UNICEF, UNDP at a fraction of consultant rates.",
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-gray-50 py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-16">
          <p className="text-xs font-bold tracking-[0.2em] uppercase text-gold mb-4">
            How It Works
          </p>
          <h2 className="font-serif text-3xl sm:text-4xl font-bold text-navy mb-4">
            From assessment to award in four steps
          </h2>
          <p className="text-gray-500 text-base leading-relaxed">
            No jargon, no guesswork. A clear path from &quot;where do I
            start?&quot; to &quot;contract awarded.&quot;
          </p>
        </div>

        {/* Steps */}
        <div className="grid md:grid-cols-2 gap-8 lg:gap-10">
          {steps.map((step) => (
            <div
              key={step.number}
              className="relative bg-white rounded-xl p-8 border border-gray-100 hover:shadow-lg transition-all group"
            >
              <span className="text-5xl font-serif font-bold text-gold/15 absolute top-6 right-8 group-hover:text-gold/25 transition-colors">
                {step.number}
              </span>
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gold text-white text-xs font-bold">
                  {step.number}
                </div>
                <h3 className="text-lg font-semibold text-navy">
                  {step.title}
                </h3>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed mb-3">
                {step.description}
              </p>
              <p className="text-xs text-gray-400 leading-relaxed">
                {step.detail}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
