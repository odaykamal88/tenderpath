import LegalShell from "@/components/LegalShell";

export const metadata = {
  title: "Cookie Policy — TenderPath",
  description: "How TenderPath uses cookies and similar storage technologies.",
};

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-gray-900 mb-3">{heading}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export default function CookiePolicyPage() {
  return (
    <LegalShell
      title="Cookie Policy"
      subtitle="A short, honest account of what cookies TenderPath sets and why."
      lastUpdated="April 2025"
    >
      <Section heading="What are cookies?">
        <p className="text-sm">
          Cookies are small text files stored in your browser. They are used to keep you
          signed in and maintain session state. TenderPath uses cookies very sparingly.
        </p>
      </Section>

      <Section heading="Cookies TenderPath sets">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-200 text-gray-500 text-left">
              <th className="pb-2 pr-4 font-medium">Name</th>
              <th className="pb-2 pr-4 font-medium">Type</th>
              <th className="pb-2 pr-4 font-medium">Purpose</th>
              <th className="pb-2 font-medium">Duration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr>
              <td className="py-2 pr-4 font-mono text-xs text-gray-800">tp_session</td>
              <td className="py-2 pr-4 text-gray-600">Strictly necessary</td>
              <td className="py-2 pr-4 text-gray-600">
                Keeps you signed in. An httpOnly JWT — not accessible to JavaScript.
                Set on the TenderPath domain only.
              </td>
              <td className="py-2 text-gray-600">7 days from sign-in</td>
            </tr>
          </tbody>
        </table>
        <p className="text-sm text-gray-500 mt-2">
          That is the only cookie TenderPath itself sets. No advertising or analytics
          cookies are used.
        </p>
      </Section>

      <Section heading="Third-party cookies">
        <p className="text-sm">
          Some third-party services may set their own cookies or store data in your browser:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>
            <strong>Stripe</strong> — if you visit a Stripe-hosted checkout page, Stripe may set
            cookies under its own domain for fraud prevention and payment flow. These are
            governed by <a href="https://stripe.com/privacy" target="_blank" rel="noreferrer" className="underline">Stripe&apos;s privacy policy</a>.
          </li>
          <li>
            <strong>Google Fonts</strong> — TenderPath loads web fonts (Inter, Playfair Display)
            via Google Fonts. This makes a request to Google&apos;s servers and may result in your
            IP being logged by Google, per their privacy policy. No Google tracking cookies
            are intentionally set by TenderPath.
          </li>
        </ul>
      </Section>

      <Section heading="Managing cookies">
        <p className="text-sm">
          You can block or delete cookies through your browser settings. Blocking the
          <code className="mx-1 font-mono text-xs bg-gray-100 px-1 rounded">tp_session</code>
          cookie will prevent you from staying signed in to TenderPath.
        </p>
      </Section>

      <Section heading="Changes">
        <p className="text-sm">
          If we introduce analytics or other non-essential cookies in the future, we will update
          this policy and, where required, ask for your consent.
        </p>
      </Section>

      <Section heading="Questions">
        <p className="text-sm">
          Contact us at{" "}
          <a href="mailto:info@tenderpath.me" className="underline">info@tenderpath.me</a>.
        </p>
      </Section>
    </LegalShell>
  );
}
