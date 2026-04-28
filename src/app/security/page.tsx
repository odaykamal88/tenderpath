import LegalShell from "@/components/LegalShell";

export const metadata = {
  title: "Security & Vulnerability Reporting — TenderPath",
  description: "How to report security vulnerabilities in TenderPath responsibly.",
};

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-gray-900 mb-3">{heading}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export default function SecurityPage() {
  return (
    <LegalShell
      title="Security & Vulnerability Reporting"
      subtitle="We take security seriously. If you find a vulnerability, please tell us privately."
      lastUpdated="April 2025"
    >
      <Section heading="How to report a vulnerability">
        <p className="text-sm">
          If you discover a security vulnerability in TenderPath, please report it to us
          directly before disclosing it publicly. This gives us the opportunity to investigate
          and address the issue without exposing users to unnecessary risk.
        </p>
        <div className="rounded-lg bg-gray-50 border border-gray-200 px-5 py-4 text-sm">
          <p className="font-semibold text-gray-900 mb-1">Report to:</p>
          <a href="mailto:info@tenderpath.me?subject=Security%20Vulnerability%20Report" className="underline text-amber-600">
            info@tenderpath.me
          </a>
          <p className="text-gray-500 mt-1">Subject line: <span className="font-mono">Security Vulnerability Report</span></p>
        </div>
      </Section>

      <Section heading="What to include in your report">
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>A description of the vulnerability and the potential impact.</li>
          <li>Steps to reproduce the issue or a proof-of-concept.</li>
          <li>The affected URL, endpoint, or component.</li>
          <li>Your contact details (optional, but helpful if we need to follow up).</li>
        </ul>
      </Section>

      <Section heading="What to expect from us">
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>We will acknowledge your report within <strong>5 business days</strong>.</li>
          <li>We will investigate and aim to keep you informed of our progress.</li>
          <li>We do not currently operate a formal bug bounty programme.</li>
        </ul>
      </Section>

      <Section heading="Service availability">
        <p className="text-sm">
          TenderPath targets a monthly uptime of <strong>99.5%</strong> for its core production
          service, measured per calendar month and excluding scheduled maintenance, emergency
          maintenance, force majeure events, and third-party service failures (Vercel, Neon,
          Stripe, Resend, Cloudflare). This commitment does not extend to support response or
          resolution timelines.
        </p>
      </Section>

      <Section heading="Responsible disclosure">
        <p className="text-sm">
          We ask that you:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>Do not access, modify, or exfiltrate user data beyond what is needed to demonstrate the vulnerability.</li>
          <li>Do not perform denial-of-service attacks or disrupt service availability.</li>
          <li>Give us reasonable time to investigate and respond before public disclosure.</li>
          <li>Act in good faith throughout the process.</li>
        </ul>
        <p className="text-sm">
          We commit to not pursuing legal action against researchers acting in good faith under
          these guidelines.
        </p>
      </Section>

      <Section heading="Scope">
        <p className="text-sm">
          In scope: tenderpath.me, tenderpath.co, and associated API endpoints.
        </p>
        <p className="text-sm">
          Out of scope: third-party services we use (Stripe, Vercel, Resend, Cloudflare).
          Please report vulnerabilities in those services directly to those providers.
        </p>
      </Section>

      <Section heading="Questions">
        <p className="text-sm">
          For general security questions:{" "}
          <a href="mailto:info@tenderpath.me" className="underline">info@tenderpath.me</a>
        </p>
      </Section>
    </LegalShell>
  );
}
