export const metadata = {
  title: "FAQ — TenderPath",
  description: "Answers to common questions about TenderPath and UN procurement.",
};

const faqs = [
  {
    q: "What is TenderPath?",
    a: "TenderPath is a procurement intelligence platform that helps businesses find, assess, and win UN contracts and grants. We crawl 15+ UN agency portals in real time, match opportunities to your profile, and provide the readiness analysis and proposal support you need to compete.",
  },
  {
    q: "How does the free assessment work?",
    a: "Enter your company name, email, and either your website or a short description of what you do. Our AI crawls your website, extracts your capabilities, matches you against active tenders and grants from 15+ UN agencies, and scores your readiness across 5 dimensions — all in under 30 seconds. The report is free and sent to your email.",
  },
  {
    q: "What is UNGM and do I need to register?",
    a: "UNGM (United Nations Global Marketplace) is the central vendor registration portal for most UN agencies. Registration is free but requires specific documentation. Many tenders are only visible to registered vendors. Our Roster Fast-Track service ($749) helps you complete this registration correctly and quickly.",
  },
  {
    q: "What agencies do you cover?",
    a: "We currently crawl UNDP, UNICEF, WHO, WFP, UNHCR, UNFPA, UN Women, UNOPS, FAO, ILO, UNESCO, UNGM, the World Bank, IFC, and several regional development banks. We add new sources regularly.",
  },
  {
    q: "How is the magic link sign-in different from a password?",
    a: "Instead of a password, we email you a secure sign-in link each time you want to access your account. Just enter your email, check your inbox for the link, and click it to sign in. No passwords to remember or reset — and it's more secure because the link expires after one use.",
  },
  {
    q: "What documents will I need for UN tenders?",
    a: "Most UN agencies require: UNGM registration, audited financial statements (last 2–3 years), company registration certificate, tax compliance certificate, past performance references, and technical capability documentation. The specific requirements vary by tender and agency — our readiness assessment identifies exactly which you're missing.",
  },
  {
    q: "What does the Bid Analysis ($39) include?",
    a: "For any tender in your pipeline, Bid Analysis gives you: a win probability score, a breakdown of every eligibility criterion and where you stand, a gap analysis with specific actions to close each gap, and competitor intelligence showing how many vendors are actively pursuing this opportunity.",
  },
  {
    q: "Can I cancel the Grants + Tenders Matching subscription?",
    a: "Yes, anytime. There's no long-term commitment. You can cancel from your account settings and you'll retain access until the end of your current billing period.",
  },
  {
    q: "Do you support Arabic?",
    a: "Yes. Our weekly tender digest is delivered in both English and Arabic, and our team includes Arabic-speaking procurement advisors. We specifically cover opportunities relevant to vendors in MENA and other Arabic-speaking regions.",
  },
  {
    q: "How do I get support?",
    a: "Email us at hello@tenderpath.co and we'll respond within one business day. For urgent questions, use the live chat on our website. You can also book a free 15-minute expert call — just email us with 'Book a call' in the subject line.",
  },
];

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";
const SERIF = "'Fraunces', 'Times New Roman', serif";

export default function FAQPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: "#fafaf7" }}>
      {/* Nav */}
      <nav className="border-b border-stone-200/70 bg-white/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="mx-auto max-w-5xl px-6 flex h-14 items-center justify-between">
          <a
            href="/"
            className="text-[15px] font-semibold text-stone-900"
            style={{ fontFamily: SERIF }}
          >
            Tender<span style={{ color: "#ea580c" }}>·</span>Path
          </a>
          <a
            href="/"
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500 hover:text-stone-900 transition-colors"
            style={{ fontFamily: MONO }}
          >
            ← Home
          </a>
        </div>
      </nav>

      <div className="mx-auto max-w-3xl px-6 py-16">
        {/* Header */}
        <div className="mb-12">
          <div
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400"
            style={{ fontFamily: MONO }}
          >
            Reference · Frequently asked
          </div>
          <h1
            className="mt-1.5 text-[56px] leading-[1.02] font-medium text-stone-900 tracking-tight"
            style={{ fontFamily: SERIF, fontFeatureSettings: "'ss01'" }}
          >
            Questions, answered.
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-stone-600 max-w-2xl">
            Everything you need to know about TenderPath and UN procurement. Can&apos;t find your answer?{" "}
            <a
              href="mailto:hello@tenderpath.co"
              className="text-stone-900 underline underline-offset-2 hover:text-stone-700"
            >
              Email us
            </a>
            .
          </p>
        </div>

        {/* FAQ list */}
        <div className="border-t border-stone-200">
          {faqs.map((faq, i) => (
            <details key={faq.q} className="group border-b border-stone-200 py-5">
              <summary className="flex cursor-pointer items-baseline justify-between gap-4 list-none">
                <div className="flex items-baseline gap-4 flex-1">
                  <span
                    className="text-[10px] font-semibold tabular-nums text-stone-400 shrink-0"
                    style={{ fontFamily: MONO }}
                  >
                    {(i + 1).toString().padStart(2, "0")}
                  </span>
                  <h2
                    className="text-[18px] leading-snug font-medium text-stone-900 group-open:text-stone-700 transition-colors"
                    style={{ fontFamily: SERIF }}
                  >
                    {faq.q}
                  </h2>
                </div>
                <svg
                  className="h-4 w-4 mt-1.5 flex-shrink-0 text-stone-400 group-open:rotate-45 transition-transform"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </summary>
              <p className="mt-3 ml-9 text-[14px] leading-relaxed text-stone-600 max-w-2xl">
                {faq.a}
              </p>
            </details>
          ))}
        </div>

        {/* Still have questions */}
        <div className="mt-12 rounded-md border border-stone-200/70 bg-white p-7">
          <div
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400"
            style={{ fontFamily: MONO }}
          >
            Still curious
          </div>
          <h3
            className="mt-1 text-[24px] font-medium text-stone-900 tracking-tight"
            style={{ fontFamily: SERIF }}
          >
            We respond within one business day.
          </h3>
          <p className="mt-2 text-[13.5px] leading-relaxed text-stone-600">
            For complex UN procurement questions, book a free 15-minute call with an expert. We can review your shortlist, suggest the right service path, and answer anything specific to your sector.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href="mailto:hello@tenderpath.co"
              className="rounded-sm bg-stone-900 px-4 py-2.5 text-[12.5px] font-semibold text-white hover:bg-stone-800 transition-colors"
            >
              Email us
            </a>
            <a
              href="mailto:hello@tenderpath.co?subject=Book a call"
              className="rounded-sm border border-stone-300 px-4 py-2.5 text-[12.5px] font-semibold text-stone-700 hover:border-stone-700 hover:text-stone-900 transition-colors"
            >
              Book a free expert call
            </a>
          </div>
        </div>
      </div>

      <footer className="border-t border-stone-200 py-7 text-center">
        <p
          className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-stone-400"
          style={{ fontFamily: MONO }}
        >
          © {new Date().getFullYear()} Tender·Path ·{" "}
          <a href="/" className="underline underline-offset-2 hover:text-stone-700">
            Home
          </a>
        </p>
      </footer>
    </div>
  );
}
