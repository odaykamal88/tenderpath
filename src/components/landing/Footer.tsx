/* Footer — paper-toned, editorial colophon */

export default function Footer() {
  const product = [
    { label: "Free assessment", href: "/assessment" },
    { label: "Weekly digest · $49/mo", href: "/assessment" },
    { label: "Bid/no-bid analysis · $39", href: "/assessment" },
    { label: "Proposal draft · $299", href: "/assessment" },
    { label: "Roster fast-track · $749", href: "/assessment" },
  ];

  const resources = [
    { label: "UN procurement guide", href: "#" },
    { label: "UNGM registration", href: "#" },
    { label: "Founder note", href: "#builtby" },
    { label: "FAQ", href: "/faq" },
  ];

  const company = [
    { label: "Contact", href: "/contact" },
    { label: "Disclaimer", href: "/disclaimer" },
    { label: "Security", href: "/security" },
  ];

  const legal = [
    { label: "Privacy Policy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
    { label: "Cookie Policy", href: "/cookie-policy" },
    { label: "Disclaimer", href: "/disclaimer" },
    { label: "Security", href: "/security" },
  ];

  return (
    <footer className="bg-paper-2 border-t border-rule">
      <div className="mx-auto max-w-7xl px-6 lg:px-8 py-16">
        {/* Top: editorial colophon */}
        <div className="grid lg:grid-cols-[1.5fr_1fr_1fr_1fr] gap-10 lg:gap-14 pb-12 border-b border-rule">
          <div>
            <a href="/" className="font-serif text-[26px] font-medium tracking-[-0.01em] text-ink">
              Tender<span className="text-accent">·</span>Path
            </a>
            <p className="mt-5 text-[14px] text-ink-2 leading-[1.6] max-w-sm">
              UN procurement readiness, scored. Decoding the maze for vendors
              across the global south.
            </p>
            <p className="mt-5 font-mono text-[10px] tracking-[0.08em] uppercase text-mute leading-relaxed">
              Amman · Beirut<br />
              Built {new Date().getFullYear()}
            </p>
          </div>

          <FooterColumn title="Services" links={product} />
          <FooterColumn title="Resources" links={resources} />
          <FooterColumn title="Company" links={company} />
        </div>

        {/* Bottom: legal strip */}
        <div className="mt-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p className="font-mono text-[10px] tracking-[0.08em] text-mute">
            © {new Date().getFullYear()} TenderPath. All rights reserved.
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {legal.map((l) => (
              <a
                key={l.label}
                href={l.href}
                className="font-mono text-[10px] tracking-[0.06em] uppercase text-ink-3 hover:text-ink transition-colors"
              >
                {l.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: Array<{ label: string; href: string }>;
}) {
  return (
    <div>
      <h4 className="font-mono text-[10px] tracking-[0.16em] uppercase text-accent mb-5">
        {title}
      </h4>
      <ul className="space-y-3">
        {links.map((link) => (
          <li key={link.label}>
            <a
              href={link.href}
              className="text-[13px] text-ink-2 hover:text-ink transition-colors"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
