export const metadata = {
  title: "Contact — TenderPath",
  description: "Get in touch with the TenderPath team.",
};

export default function ContactPage() {
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

      <div className="mx-auto max-w-4xl px-6 py-16">
        <div className="mb-12">
          <h1 className="font-serif text-4xl font-bold text-gray-900 mb-4">Get in Touch</h1>
          <p className="text-gray-500 text-lg">
            We&apos;re here to help you navigate UN procurement. Reach out anytime.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Contact options */}
          <div className="space-y-6">
            {[
              {
                icon: (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                ),
                label: "Email",
                value: "info@tenderpath.me",
                href: "mailto:info@tenderpath.me",
                note: "We respond within 1 business day",
              },
              {
                icon: (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                ),
                label: "Book a Call",
                value: "Free 15-min expert consultation",
                href: "mailto:info@tenderpath.me?subject=Book a call",
                note: "Available Mon–Fri, 9am–5pm GMT",
              },
              {
                icon: (
                  <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                  </svg>
                ),
                label: "Telegram",
                value: "Message us on Telegram",
                href: "https://t.me/tenderpath_bot",
                note: "For quick questions via Telegram",
              },
            ].map((contact) => (
              <a
                key={contact.label}
                href={contact.href}
                className="flex gap-4 p-5 rounded-xl border border-gray-200 hover:border-gray-400 hover:shadow-md transition-all group"
              >
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 group-hover:bg-amber-100 transition-colors">
                  {contact.icon}
                </div>
                <div>
                  <div className="text-sm font-semibold text-gray-900">{contact.label}</div>
                  <div className="text-sm text-gray-600 mt-0.5">{contact.value}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{contact.note}</div>
                </div>
              </a>
            ))}
          </div>

          {/* FAQ shortcut */}
          <div className="rounded-xl bg-gray-50 border border-gray-100 p-6 flex flex-col">
            <h3 className="text-base font-semibold text-gray-900 mb-2">Looking for quick answers?</h3>
            <p className="text-sm text-gray-500 mb-6 flex-1">
              Check our FAQ for answers to the most common questions about TenderPath,
              UN procurement, and getting started.
            </p>
            <a
              href="/faq"
              className="inline-flex items-center gap-2 text-sm font-semibold text-amber-600 hover:text-amber-800 transition-colors"
            >
              Browse the FAQ →
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
