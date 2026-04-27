const problems = [
  {
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
      </svg>
    ),
    title: "Opportunities Are Fragmented",
    description:
      "Live tenders are scattered across UNGM, agency portals, regional offices, and grant systems. Most qualifying businesses never see the right contracts at the right time.",
  },
  {
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
    title: "Compliance Mistakes Knock You Out Early",
    description:
      "UNGM registration errors, missing financial documents, and legal gaps disqualify vendors before evaluation begins. The paperwork barrier stops more bids than fit does.",
  },
  {
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    title: "The Expensive Mistake Is Chasing the Wrong Bid",
    description:
      "A full proposal takes 20–40 hours. Vendors routinely invest that time in tenders they were never going to win — wrong geography, wrong experience tier, wrong technical fit.",
  },
];

export default function Challenge() {
  return (
    <section id="challenge" className="bg-white py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-16">
          <p className="text-xs font-bold tracking-[0.2em] uppercase text-gold mb-4">
            The Challenge
          </p>
          <h2 className="font-serif text-3xl sm:text-4xl font-bold text-navy mb-4">
            UN procurement is real — but hard for new vendors to navigate
          </h2>
          <p className="text-gray-500 text-base leading-relaxed">
            The contracts exist. The barrier is knowing where you stand and which
            opportunities are actually worth pursuing.
          </p>
        </div>

        {/* Problem cards */}
        <div className="grid md:grid-cols-3 gap-8">
          {problems.map((problem) => (
            <div
              key={problem.title}
              className="p-6 rounded-xl border border-gray-100 hover:border-gold/20 hover:shadow-lg transition-all"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-red/5 text-red mb-4">
                {problem.icon}
              </div>
              <h3 className="text-lg font-semibold text-navy mb-2">
                {problem.title}
              </h3>
              <p className="text-sm text-gray-500 leading-relaxed">
                {problem.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
