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
    a: "Instead of a password, we email you a secure verification code each time you sign in. Just enter your email, check your inbox for the code, and paste it in. No passwords to remember or reset — and it's more secure because the code expires after one use.",
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

export default function FAQPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b border-gray-100 bg-white/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="mx-auto max-w-7xl px-6 flex h-14 items-center justify-between">
          <a href="/" className="text-lg font-semibold text-gray-900">
            Tender<span className="text-amber-500">Path</span>
          </a>
          <a href="/" className="text-sm text-gray-500 hover:text-gray-900">← Back to home</a>
        </div>
      </nav>

      <div className="mx-auto max-w-3xl px-6 py-16">
        <div className="mb-12">
          <h1 className="font-serif text-4xl font-bold text-gray-900 mb-4">
            Frequently Asked Questions
          </h1>
          <p className="text-gray-500 text-lg">
            Everything you need to know about TenderPath and UN procurement.
            Can&apos;t find your answer?{" "}
            <a href="mailto:hello@tenderpath.co" className="text-amber-600 underline hover:no-underline">
              Email us
            </a>
            .
          </p>
        </div>

        <div className="space-y-0 divide-y divide-gray-100">
          {faqs.map((faq) => (
            <details key={faq.q} className="group py-5">
              <summary className="flex cursor-pointer items-center justify-between gap-4 list-none">
                <h2 className="text-base font-semibold text-gray-900 group-open:text-amber-600 transition-colors">
                  {faq.q}
                </h2>
                <svg
                  className="h-5 w-5 flex-shrink-0 text-gray-400 group-open:rotate-45 transition-transform"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </summary>
              <p className="mt-3 text-sm text-gray-600 leading-relaxed">{faq.a}</p>
            </details>
          ))}
        </div>

        <div className="mt-16 rounded-xl bg-gray-50 border border-gray-200 p-8 text-center">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Still have questions?</h3>
          <p className="text-sm text-gray-500 mb-6">
            Our team responds within one business day. For complex UN procurement questions,
            book a free 15-min call with an expert.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <a
              href="mailto:hello@tenderpath.co"
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-700 transition-colors"
            >
              Email Us
            </a>
            <a
              href="mailto:hello@tenderpath.co?subject=Book a call"
              className="inline-flex items-center gap-2 rounded-lg border-2 border-gray-200 px-5 py-2.5 text-sm font-semibold text-gray-700 hover:border-gray-400 transition-colors"
            >
              Book a Free Expert Call
            </a>
          </div>
        </div>
      </div>

      <footer className="border-t border-gray-100 py-8 text-center text-xs text-gray-400">
        © {new Date().getFullYear()} TenderPath. All rights reserved. |{" "}
        <a href="/" className="underline hover:text-gray-600">Home</a>
      </footer>
    </div>
  );
}
