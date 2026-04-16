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
              {["UN Procurement Guide", "UNGM Registration", "Blog", "FAQ"].map((link) => (
                <li key={link}>
                  <a href="#" className="text-sm text-gray-400 hover:text-white transition-colors">
                    {link}
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
              {["About", "Contact", "Privacy Policy", "Terms of Service"].map((link) => (
                <li key={link}>
                  <a href="#" className="text-sm text-gray-400 hover:text-white transition-colors">
                    {link}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-white/5 text-center">
          <p className="text-xs text-gray-500">
            &copy; {new Date().getFullYear()} TenderPath. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
