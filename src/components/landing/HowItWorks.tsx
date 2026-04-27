const steps = [
  {
    number: "01",
    title: "Describe Your Business — In 2 Minutes",
    description:
      "Answer a short intake form: what your company does, where you operate, and which sectors you serve. No website required.",
    detail: "TenderPath uses your answers to classify your business, check UNGM registration status, and build a readiness score — instantly. You get a gap analysis before you spend anything.",
  },
  {
    number: "02",
    title: "See Matched Tenders — With Reasons",
    description:
      "Your dashboard shows live tenders scored by fit for your exact profile. Each opportunity explains why it matched: sectors, capabilities, geography, and deadline urgency.",
    detail: "Opportunities are bucketed by strength: Act Now, Strong Fit, Strategic, Adjacent. No noise — only what's relevant to your business.",
  },
  {
    number: "03",
    title: "Know Whether to Bid Before You Start",
    description:
      "Paste a tender URL and get an instant bid/no-bid recommendation with fit reasoning, gap analysis, and required-documents checklist.",
    detail: "Stop investing 30 hours in proposals you can't win. TenderPath tells you whether the opportunity is worth pursuing — before you write a single line.",
  },
  {
    number: "04",
    title: "Draft Faster",
    description:
      "Use our proposal drafting service to receive an 80% complete submission package in 48–72 hours — technical proposal, compliance docs, and financial template.",
    detail: "Or fast-track your vendor roster registration for a specific UN agency at a fraction of consultant rates.",
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
            From readiness to submission in four steps
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
