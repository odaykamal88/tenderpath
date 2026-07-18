import LegalShell from "@/components/LegalShell";

export const metadata = {
  title: "Privacy Policy — TenderPath",
  description: "How TenderPath collects, uses, and protects your personal data.",
};

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-gray-900 mb-3">{heading}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy Policy"
      subtitle="This policy explains what personal data TenderPath collects, why, and how it is handled."
      lastUpdated="18 July 2026"
    >
      <div className="rounded-lg bg-gray-50 border border-gray-200 px-5 py-4 text-sm text-gray-700">
        TenderPath is operated by <strong>Tenderpath Limited</strong>, 49 Street 105 Hadayek El Maadi,
        Maadi, Cairo, Egypt 10543. For questions about this policy, contact us at{" "}
        <a href="mailto:info@tenderpath.me" className="underline">info@tenderpath.me</a>.
      </div>

      <Section heading="1. What data we collect">
        <p>We collect only the data needed to provide the service:</p>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li><strong>Account data:</strong> email address and, optionally, your name — collected at signup and login.</li>
          <li><strong>Assessment data:</strong> company name, company website URL, business description, sector selections, and operating countries — entered during the free assessment wizard.</li>
          <li><strong>Assessment results:</strong> AI-generated company profile, readiness scores, matched tenders, and capability extractions — stored against your account.</li>
          <li><strong>Tender feedback:</strong> your saved, not-relevant, in-progress, or applied status on individual tenders.</li>
          <li><strong>Tender and vault documents:</strong> solicitation files, corrigenda, Q&amp;A, proposal evidence, PDFs, Word documents, spreadsheets, and images you choose to upload (up to 50 MB per file on supported upload surfaces).</li>
          <li><strong>Service-order content:</strong> tender requirements, intake answers, drafts, reviews, generated deliverables, revision notes, and submission progress associated with a service you request.</li>
          <li><strong>Billing data:</strong> subscription and payment records. Payments are processed by card through Stripe; card details are handled entirely by Stripe and are never stored on TenderPath servers.</li>
          <li><strong>Authentication tokens:</strong> short-lived magic-link tokens (expire after 30 minutes) and a session token stored in an httpOnly cookie (<code>tp_session</code>).</li>
          <li><strong>Server logs:</strong> standard web server logs including IP addresses and request metadata, retained for operational and security purposes.</li>
        </ul>
        <p className="text-sm text-gray-500">
          We do not collect payment card numbers. TenderPath does not ask for government ID or special-category personal data during signup; do not upload such material unless it is genuinely required for the procurement workflow and you are authorized to provide it.
        </p>
      </Section>

      <Section heading="2. How we use your data">
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>Delivering the assessment, matched tender feed, and readiness analysis.</li>
          <li>Sending transactional emails (magic-link sign-in, assessment reports, weekly tender digests).</li>
          <li>Processing payments and managing subscriptions.</li>
          <li>Storing your vault documents for retrieval during your active account period.</li>
          <li>Extracting and analysing documents, generating requested tender deliverables, and checking them against solicitation requirements.</li>
          <li>Operating and quality-controlling tender matching using business-profile and opportunity metadata, including staff curation where needed.</li>
          <li>Providing human fulfillment or troubleshooting for uploaded files, drafts, and other service-order content only when you grant temporary access to the relevant order.</li>
          <li>Improving crawler coverage and matching quality in aggregate (non-identifiable).</li>
          <li>Responding to your support requests.</li>
        </ul>
        <p className="text-sm text-gray-500">
          We do not sell your personal data or use it for advertising.
        </p>
      </Section>

      <Section heading="3. Third-party services that process your data">
        <p className="text-sm">
          We use the following sub-processors. Each operates under its own privacy policy:
        </p>
        <table className="w-full text-sm border-collapse mt-2">
          <thead>
            <tr className="border-b border-gray-200 text-gray-500 text-left">
              <th className="pb-2 pr-4 font-medium">Service</th>
              <th className="pb-2 pr-4 font-medium">Purpose</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {[
              ["Vercel", "Application hosting and serverless infrastructure"],
              ["Vercel Blob Storage", "Storage of user-uploaded vault documents"],
              ["Neon / Vercel Postgres", "Primary database (user accounts, assessments, tenders)"],
              ["Resend", "Transactional email delivery (magic links, reports, digests)"],
              ["Stripe", "Card payment processing and subscription management"],
              ["Cloudflare", "Browser rendering for company website crawling (assessment stage)"],
              ["Anthropic", "AI-assisted assessment, tender analysis, document extraction, proposal drafting, and review where the feature uses Anthropic models"],
              ["OpenAI", "AI-assisted answers, discovery, and selected analysis features where the feature uses OpenAI models"],
              ["Google Fonts", "Web font delivery (Inter, Playfair Display)"],
            ].map(([svc, purpose]) => (
              <tr key={svc}>
                <td className="py-2 pr-4 font-medium text-gray-800">{svc}</td>
                <td className="py-2 text-gray-600">{purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section heading="4. Data retention">
        <p className="text-sm">We retain your data for the following periods:</p>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li><strong>Account data</strong> (email, name): retained while your account is active and deleted within 90 days of account closure.</li>
          <li><strong>Assessment data</strong> (company profile, readiness scores, matched tenders): retained for 12 months from your last login or last meaningful platform activity, or earlier on request.</li>
          <li><strong>Vault documents:</strong> available for 30 days after account closure for export or recovery, then permanently deleted.</li>
          <li><strong>Billing records:</strong> retained for 7 years as required by applicable financial regulations.</li>
          <li><strong>Server and access logs:</strong> retained for 90 days in searchable form; security-relevant logs may be retained for up to 12 months for incident investigation purposes.</li>
          <li><strong>Magic-link tokens:</strong> expire 30 minutes after issue.</li>
        </ul>
        <p className="text-sm text-gray-500">
          You may request earlier deletion of your data at any time by emailing{" "}
          <a href="mailto:info@tenderpath.me" className="underline">info@tenderpath.me</a>, subject
          to any legal retention obligations.
        </p>
      </Section>

      <Section heading="5. Your rights">
        <p className="text-sm">
          TenderPath is operated in Egypt and processes data in accordance with the Egyptian Personal
          Data Protection Law (Law No. 151 of 2020). Under that law and other applicable regulations,
          you may have the right to:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>Access a copy of the personal data we hold about you.</li>
          <li>Correct inaccurate or incomplete data.</li>
          <li>Request deletion of your data (subject to legal retention obligations).</li>
          <li>Object to certain types of processing.</li>
          <li>Request a copy of your data in a portable format.</li>
        </ul>
        <p className="text-sm">
          To exercise any of these rights, email{" "}
          <a href="mailto:info@tenderpath.me" className="underline">info@tenderpath.me</a>. We will
          respond within 30 days.
        </p>
      </Section>

      <Section heading="6. Cookies">
        <p className="text-sm">
          We use a single strictly-necessary authentication cookie (<code>tp_session</code>) to keep you signed in.
          No marketing or analytics cookies are set. See our{" "}
          <a href="/cookie-policy" className="underline text-amber-600">Cookie Policy</a> for details.
        </p>
      </Section>

      <Section heading="7. Security">
        <p className="text-sm">
          Authentication tokens are short-lived. The session cookie is httpOnly and scoped to TenderPath&apos;s
          domain. New customer documents and generated artifacts are stored in private object storage and
          delivered through owner-authenticated TenderPath routes. Staff-facing queues expose operational
          metadata by default; content access for human fulfillment or support requires a customer-controlled,
          time-limited grant for the relevant work order and is recorded in an access log. We do not store payment
          card data. This is an access-control model, not zero-knowledge encryption: TenderPath systems and the
          processors named above must handle content when you request analysis or generation.
        </p>
      </Section>

      <Section heading="8. Children">
        <p className="text-sm">
          TenderPath is intended for business use by adults. We do not knowingly collect data from anyone under 18.
        </p>
      </Section>

      <Section heading="9. Changes to this policy">
        <p className="text-sm">
          We may update this policy as the product evolves. If changes are material, we will notify
          registered users by email before they take effect. Continued use of the service after that
          date constitutes acceptance of the updated policy.
        </p>
      </Section>

      <Section heading="10. Contact">
        <p className="text-sm">
          For privacy-related questions or data requests:{" "}
          <a href="mailto:info@tenderpath.me" className="underline">info@tenderpath.me</a>
          <br />
          Tenderpath Limited, 49 Street 105 Hadayek El Maadi, Maadi, Cairo, Egypt 10543
        </p>
      </Section>
    </LegalShell>
  );
}
