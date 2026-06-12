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
      subtitle="Please read these terms carefully before using TenderPath."
      lastUpdated="April 2025"
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
          The platform includes a free company assessment, a matched tender feed, readiness
          analysis, document vault, bid/no-bid analysis (paid), and related workflow features.
        </p>
        <p className="text-sm font-medium text-gray-800 bg-gray-50 rounded-lg px-4 py-3">
          All outputs — including assessments, sector classifications, readiness scores, tender
          matches, and bid analysis — are informational and assistive only. They do not constitute
          professional procurement, legal, or financial advice. You remain solely responsible for
          your procurement decisions.
        </p>
        <p className="text-sm font-medium text-red-700 bg-red-50 border border-red-100 rounded-lg px-4 py-3 mt-3">
          <strong>AI-generated content — user responsibility.</strong> TenderPath uses artificial
          intelligence to generate assessments, tender matches, bid analyses, proposal drafts, and
          application content. All AI-generated outputs may contain errors, omissions, or
          inaccuracies. <strong>You are solely responsible for reviewing, verifying, and approving
          all AI-generated content before submitting it to any procurement authority, donor agency,
          or third party.</strong> TenderPath makes no warranty that AI-generated content is
          accurate, complete, or fit for submission. Submitting unreviewed AI output is done
          entirely at your own risk.
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

      <Section heading="5. Free assessment and trial">
        <p className="text-sm">
          The free company assessment is available without payment. Trial access to paid dashboard
          features is offered for a <strong>14-day period</strong>. At the end of the trial, your
          account will automatically convert to a paid subscription at the standard plan rate.
          We will send you a reminder email before the trial expires. You may cancel before conversion
          by contacting us at{" "}
          <a href="mailto:info@tenderpath.me" className="underline">info@tenderpath.me</a>.
        </p>
      </Section>

      <Section heading="6. Paid services and billing">
        <p className="text-sm">
          Certain features — including bid/no-bid analysis, proposal packages, and roster
          preparation — require payment. Prices are displayed at the point of purchase.
        </p>
        <p className="text-sm font-medium text-gray-800 mb-1">Payment methods accepted:</p>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li><strong>Card</strong> — Visa, Mastercard, and other major cards via Stripe. By paying by card, you agree to <a href="https://stripe.com/legal" target="_blank" rel="noreferrer" className="underline">Stripe&apos;s terms of service</a>.</li>
          <li><strong>USDT</strong> — TRC20 network. Wallet address provided at checkout.</li>
          <li><strong>Whish Money / OMT</strong> — Mobile wallet payments (Lebanon). Links provided at checkout.</li>
          <li><strong>Bank wire transfer</strong> — Account details provided at checkout. Use your email address as payment reference.</li>
        </ul>
        <p className="text-sm text-gray-500">
          For manual payment methods, email{" "}
          <a href="mailto:payments@tenderpath.co" className="underline">payments@tenderpath.co</a>{" "}
          with your transaction confirmation to activate your account.
        </p>
        <p className="text-sm font-medium text-gray-800 mt-2 mb-1">Subscriptions:</p>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>Subscriptions renew automatically at the end of each billing cycle.</li>
          <li>We will send a renewal reminder at least <strong>30 days</strong> before the next charge.</li>
          <li>You may cancel at any time; cancellation takes effect at the end of the current billing period and you retain access until then.</li>
        </ul>
        <p id="refunds" className="text-sm font-medium text-gray-800 mt-2 mb-1">Refunds:</p>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li><strong>Subscription fees</strong> paid beyond the current billing period are refunded on a pro-rated basis.</li>
          <li><strong>One-off service fees</strong> (bid/no-bid analysis, proposal packages, roster fast-track) are non-refundable once the service has been delivered.</li>
          <li>
            <strong>Submission drafting guarantee (EOI / RFQ / ITB / RFP orders).</strong> If we
            deliver your draft pack late against the promise shown at checkout, or your submission
            is rejected by the agency for a compliance error that we made in the documents we
            drafted, we refund the order in full — no questions. Email{" "}
            <a href="mailto:info@tenderpath.me" className="underline">info@tenderpath.me</a> with
            your order reference (TP-…).
          </li>
          <li>
            <strong>Tender already closed.</strong> If you paid for a Bid/No-Bid or Proposal Package
            tied to a tender whose deadline had passed at checkout — and we failed to block the
            purchase — we refund in full within 5 business days. Email{" "}
            <a href="mailto:info@tenderpath.me" className="underline">info@tenderpath.me</a> with
            your Stripe session ID.
          </li>
          <li>
            <strong>Compliance gate held your order.</strong> If our compliance gate detects a
            mandatory eligibility blocker after payment (e.g. you can&apos;t meet an ineligibility
            criterion the call requires), no service deliverable is generated. You can either
            (a) provide the missing evidence within 30 days and we&apos;ll generate the deliverable,
            or (b) request a full refund within 30 days by emailing{" "}
            <a href="mailto:info@tenderpath.me" className="underline">info@tenderpath.me</a>.
          </li>
          <li>
            <strong>Generation failed on our side.</strong> If we are unable to deliver the
            Bid/No-Bid, Proposal Package, or Roster Fast-Track within 72 hours of payment due to
            a TenderPath technical failure (not a missing input from you), we refund in full.
          </li>
        </ul>
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
          TenderPath will use commercially reasonable efforts to make the core production service
          available at least <strong>99.5%</strong> of each calendar month, excluding scheduled
          maintenance, emergency maintenance, force majeure events, third-party service failures
          (including Vercel, Neon, Stripe, and Resend), and other circumstances outside our
          reasonable control.
        </p>
        <p className="text-sm text-gray-500">
          This availability commitment applies only to the core platform and does not create
          guaranteed support response times or remediation timelines unless expressly agreed
          in writing.
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
