import LegalShell from "@/components/LegalShell";

export const metadata = {
  title: "Terms & Conditions — TenderPath",
  description: "Terms governing use of the TenderPath procurement intelligence platform.",
};

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-gray-900 mb-3">{heading}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms & Conditions"
      subtitle="Plain-language terms for using TenderPath. If anything here is unclear, just email us — we're happy to explain."
      lastUpdated="June 2026"
    >
      <Section heading="1. Who we are">
        <p className="text-sm">
          TenderPath is operated by <strong>Tenderpath Limited</strong>, 49 Street 105 Hadayek El Maadi,
          Maadi, Cairo, Egypt 10543. By creating an account or using the platform, you agree to these terms.
        </p>
      </Section>

      <Section heading="2. The service">
        <p className="text-sm">
          TenderPath provides AI-assisted tools to help businesses discover UN and donor-agency
          procurement opportunities, assess their readiness, and prepare for tender processes.
          The platform includes a free readiness assessment and a free dashboard (the Workbench) —
          a matched tender feed, full tender database, weekly digest, Telegram alerts, and bid/no-bid
          verdicts. TenderPath is currently invite-only and free to use while we&apos;re in beta; we&apos;ll
          always show prices clearly before introducing any paid feature.
        </p>
        <p className="text-sm font-medium text-gray-800 bg-gray-50 rounded-lg px-4 py-3">
          All outputs — including assessments, sector classifications, readiness scores, tender
          matches, and bid analysis — are informational and assistive only. They aren&apos;t professional
          procurement, legal, or financial advice, and the final call on any procurement decision is
          always yours.
        </p>
        <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-4 py-3 mt-3">
          <strong>A note on AI-assisted content.</strong> TenderPath uses AI to help generate
          assessments, tender matches, bid analyses, and draft content. AI can get things wrong, so
          please review and verify anything before you submit it to a procurement authority, donor
          agency, or third party. You know your organization best — the final review is always yours.
        </p>
      </Section>

      <Section heading="3. Accounts">
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>You must provide a valid email address. You are responsible for all activity under your account.</li>
          <li>Keep your sign-in credentials secure. Notify us immediately at info@tenderpath.me if you suspect unauthorized access.</li>
          <li>Accounts are for individual or business use. Do not share account access across unrelated entities.</li>
          <li>You must be at least 18 years old and authorized to bind your organization to these terms.</li>
        </ul>
      </Section>

      <Section heading="4. Acceptable use">
        <p className="text-sm">You agree not to:</p>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>Use the platform for any unlawful purpose or in violation of any applicable laws or regulations.</li>
          <li>Attempt to access data belonging to other users.</li>
          <li>Reverse-engineer, scrape, or extract the underlying tender dataset or matching algorithms at scale.</li>
          <li>Use the service to submit false information about your company or capabilities.</li>
          <li>Resell or sublicense access to the platform without prior written consent.</li>
        </ul>
      </Section>

      <Section heading="5. Access during the beta">
        <p className="text-sm">
          The company assessment and the dashboard (the Workbench) are free to use. TenderPath is
          currently <strong>invite-only</strong> — you can request an invite from our homepage, and we
          onboard new teams in small batches. No payment or card is required to use the platform during
          the beta. You can stop using your account at any time, and you can reach us whenever you like
          at <a href="mailto:info@tenderpath.me" className="underline">info@tenderpath.me</a>.
        </p>
      </Section>

      <Section heading="6. Paid features and billing">
        <p className="text-sm">
          TenderPath is free during the invite-only beta. We may introduce optional paid features
          later — for example, additional workflow or proposal-drafting tools. If and when we do,
          we&apos;ll show the price and terms clearly before you buy anything, and update this section
          to match.
        </p>
        <p className="text-sm">
          Any payments would be processed securely by{" "}
          <a href="https://stripe.com/legal" target="_blank" rel="noreferrer" className="underline">Stripe</a>.
          Card details are handled entirely by Stripe and are never stored on TenderPath servers.
        </p>
        <p id="refunds" className="text-sm">
          <strong>Refunds.</strong> If you ever pay for something and we don&apos;t deliver what was
          promised, email us at{" "}
          <a href="mailto:info@tenderpath.me" className="underline">info@tenderpath.me</a> and we&apos;ll
          make it right — including a full refund where that&apos;s the fair outcome.
        </p>
      </Section>

      <Section heading="7. Intellectual property">
        <p className="text-sm">
          TenderPath retains all intellectual property rights in the platform, its codebase,
          design, and AI-generated outputs. Tender data sourced from public procurement portals
          is attributed to the respective issuing agencies.
        </p>
        <p className="text-sm">
          You retain ownership of any content you upload to your vault. By uploading, you grant
          TenderPath a limited licence to store and display that content to you within the platform.
        </p>
      </Section>

      <Section heading="8. Service availability">
        <p className="text-sm">
          We work hard to keep TenderPath available and reliable, using commercially reasonable
          efforts to keep the core service running. From time to time it may be unavailable — for
          example during maintenance, third-party service issues (including Vercel, Neon, Stripe, and
          Resend), or circumstances outside our reasonable control.
        </p>
        <p className="text-sm text-gray-500">
          While we aim for high availability, we don&apos;t publish a guaranteed uptime figure or fixed
          support-response times during the beta.
        </p>
      </Section>

      <Section heading="9. Disclaimer of warranties">
        <p className="text-sm">
          The platform is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. TenderPath makes no warranty
          that the service will be uninterrupted, error-free, or that tender data will be
          complete, accurate, or current at all times. Tender listings are sourced from third-party
          procurement portals and may reflect delays or inaccuracies in those sources.
        </p>
      </Section>

      <Section heading="10. Limitation of liability">
        <p className="text-sm">
          To the maximum extent permitted by applicable Egyptian law, TenderPath shall not be liable
          for indirect, incidental, or consequential damages arising from your use of the platform,
          including missed tender deadlines, procurement losses, or reliance on AI-generated outputs.
        </p>
        <p className="text-sm">
          TenderPath&apos;s total aggregate liability to you for any claim arising under or in connection
          with these terms shall not exceed the total fees you have paid to TenderPath in the{" "}
          <strong>three (3) calendar months</strong> preceding the event giving rise to the claim.
        </p>
      </Section>

      <Section heading="11. Termination">
        <p className="text-sm">
          You may close your account at any time by contacting{" "}
          <a href="mailto:info@tenderpath.me" className="underline">info@tenderpath.me</a>. We reserve
          the right to suspend or terminate access for violations of these terms, fraudulent
          activity, or non-payment. On termination, your vault documents and assessment data
          will be deleted within <strong>90 days</strong> in accordance with our Privacy Policy.
        </p>
      </Section>

      <Section heading="12. Changes to the service and these terms">
        <p className="text-sm">
          We may modify features, pricing, or these terms at any time. Material changes will be
          communicated by email with reasonable notice before taking effect. Continued use
          constitutes acceptance of the updated terms.
        </p>
      </Section>

      <Section heading="13. Governing law and disputes">
        <p className="text-sm">
          These terms are governed by the laws of the <strong>Arab Republic of Egypt</strong>.
          Any dispute arising out of or in connection with these terms shall be subject to the
          exclusive jurisdiction of the Egyptian courts.
        </p>
      </Section>

      <Section heading="14. Contact">
        <p className="text-sm">
          Questions about these terms:{" "}
          <a href="mailto:info@tenderpath.me" className="underline">info@tenderpath.me</a>
          <br />
          Tenderpath Limited, 49 Street 105 Hadayek El Maadi, Maadi, Cairo, Egypt 10543
        </p>
      </Section>
    </LegalShell>
  );
}
