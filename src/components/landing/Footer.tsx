export default function Footer() {
  return (
    <footer className="bg-navy-light border-t border-white/5">
      <div className="mx-auto max-w-7xl px-6 lg:px-8 py-12">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="sm:col-span-2 lg:col-span-1">
            <span className="text-xl font-semibold text-white">
              Tender<span className="text-gold">Path</span>
            </span>
            <p className="mt-3 text-sm text-gray-400 leading-relaxed max-w-xs">
              Decoding the UN procurement maze so qualified businesses can
              compete — and win.
            </p>
          </div>

          {/* Links */}
          <div>
            <h4 className="text-xs font-bold tracking-wider uppercase text-gray-400 mb-4">
              Product
            </h4>
            <ul className="space-y-2.5">
              {[
                { label: "Free Assessment", href: "/assessment" },
                { label: "Tender Matching", href: "#" },
                { label: "Readiness Report", href: "#" },
                { label: "Pricing", href: "#" },
              ].map((link) => (
                <li key={link.label}>
                  <a href={link.href} className="text-sm text-gray-400 hover:text-white transition-colors">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-bold tracking-wider uppercase text-gray-400 mb-4">
              Resources
            </h4>
            <ul className="space-y-2.5">
              {[
                { label: "UN Procurement Guide", href: "#" },
                { label: "UNGM Registration", href: "#" },
                { label: "Blog", href: "#" },
                { label: "FAQ", href: "/faq" },
              ].map((link) => (
                <li key={link.label}>
                  <a href={link.href} className="text-sm text-gray-400 hover:text-white transition-colors">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-bold tracking-wider uppercase text-gray-400 mb-4">
              Company
            </h4>
            <ul className="space-y-2.5">
              {[
                { label: "About", href: "#" },
                { label: "Contact", href: "/contact" },
                { label: "Disclaimer", href: "/disclaimer" },
                { label: "Security", href: "/security" },
              ].map((link) => (
                <li key={link.label}>
                  <a href={link.href} className="text-sm text-gray-400 hover:text-white transition-colors">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-white/5 text-center space-y-3">
          <p className="text-xs text-gray-500">
            &copy; {new Date().getFullYear()} TenderPath. All rights reserved.
          </p>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-gray-600">
            {[
              { label: "Privacy Policy", href: "/privacy" },
              { label: "Terms", href: "/terms" },
              { label: "Cookie Policy", href: "/cookie-policy" },
              { label: "Disclaimer", href: "/disclaimer" },
              { label: "Security", href: "/security" },
            ].map((link) => (
              <a key={link.href} href={link.href} className="hover:text-gray-400 transition-colors underline underline-offset-2">
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
