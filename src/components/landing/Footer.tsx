/* Footer — editorial footnote with columns */

const RESOURCES = [
  { label: "FAQ", href: "/faq" },
  { label: "Pricing", href: "/#services" },
  { label: "Assessment", href: "/assessment" },
];

const LEGAL = [
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Disclaimer", href: "/disclaimer" },
  { label: "Cookie Policy", href: "/cookie-policy" },
];

const PLATFORM = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Services", href: "/dashboard/services" },
  { label: "Sign in", href: "/login" },
];

export default function Footer() {
  return (
    <footer className="bg-paper border-t border-rule">
      <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8 py-14 sm:py-16 lg:py-20">

        {/* Top row — brand + columns */}
        <div className="grid grid-cols-2 sm:grid-cols-[1fr_auto_auto_auto] gap-10 sm:gap-12 lg:gap-16 pb-12 border-b border-rule">

          {/* Brand blurb */}
          <div className="col-span-2 sm:col-span-1">
            <a href="/" className="inline-flex items-baseline gap-0 mb-5">
              <span className="font-serif text-[22px] font-medium tracking-[-0.01em] text-ink">
                Tender<span className="text-accent">·</span>Path
              </span>
            </a>
            <p className="font-serif text-[14px] leading-[1.65] text-ink-2 max-w-[260px]">
              UN procurement readiness, scored.
              <br />
              Decoding the maze for vendors.
            </p>
          </div>

          {/* Platform */}
          <div>
            <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-mute mb-5">Platform</p>
            <ul className="space-y-3">
              {PLATFORM.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="font-mono text-[11px] tracking-[0.06em] text-ink-3 hover:text-ink transition-colors">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources */}
          <div>
            <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-mute mb-5">Resources</p>
            <ul className="space-y-3">
              {RESOURCES.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="font-mono text-[11px] tracking-[0.06em] text-ink-3 hover:text-ink transition-colors">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-mute mb-5">Legal</p>
            <ul className="space-y-3">
              {LEGAL.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="font-mono text-[11px] tracking-[0.06em] text-ink-3 hover:text-ink transition-colors">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom row — copyright + location */}
        <div className="pt-6 flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-3">
          <p className="font-mono text-[10px] tracking-[0.1em] uppercase text-mute">
            © 2026 TenderPath · All rights reserved
          </p>
          <p className="font-mono text-[10px] tracking-[0.1em] uppercase text-mute">
            Built in Cairo, Egypt 2026
          </p>
        </div>

      </div>
    </footer>
  );
}
