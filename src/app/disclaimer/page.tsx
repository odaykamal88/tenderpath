import LegalShell from "@/components/LegalShell";

export const metadata = {
  title: "Disclaimer — TenderPath",
  description: "Important limitations of TenderPath's AI-generated outputs and procurement intelligence.",
};

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-gray-900 mb-3">{heading}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export default function DisclaimerPage() {
  return (
    <LegalShell
      title="Disclaimer"
      subtitle="Understand what TenderPath's outputs are — and what they are not."
      lastUpdated="April 2025"
    >
      <div className="rounded-lg bg-gray-50 border border-gray-200 px-5 py-4 text-sm text-gray-700">
        TenderPath is a procurement intelligence tool, not a legal, financial, or professional
        advisory service. Please read this page before acting on any output from the platform.
      </div>

      <Section heading="AI-generated outputs">
        <p className="text-sm">
          TenderPath uses AI to analyse company websites, classify sectors and capabilities,
          score procurement readiness, match companies against tenders, and generate bid analysis.
          These outputs are generated automatically and reflect the information available at the
          time of processing. They may be incomplete, incorrect, or outdated.
        </p>
        <p className="text-sm">
          AI-generated content does not constitute professional procurement, legal, financial,
          or compliance advice. It should be treated as a starting point for your own research
          and decision-making, not a definitive recommendation.
        </p>
      </Section>

      <Section heading="Tender data accuracy">
        <p className="text-sm">
          Tender listings are sourced from public procurement portals operated by third-party
          organisations (UN agencies, development banks, government bodies). TenderPath does not
          control those sources and cannot guarantee that listings are current, complete, or
          accurate. Always verify tender details — including deadlines, eligibility criteria,
          and submission requirements — directly with the issuing agency before submitting a bid.
        </p>
      </Section>

      <Section heading="Readiness scores and match scores">
        <p className="text-sm">
          Readiness scores and tender match scores are indicative. A high score does not guarantee
          eligibility for a tender or success in a competitive procurement process. A low score
          does not mean you are ineligible. Scoring is based on available website content and
          user-supplied information, which may be incomplete or ambiguous.
        </p>
      </Section>

      <Section heading="No guarantee of procurement success">
        <p className="text-sm">
          TenderPath does not guarantee, and makes no representation, that using the platform
          will result in winning any tender, obtaining any contract, or achieving any particular
          procurement outcome. Procurement decisions are made by issuing agencies under their
          own independent evaluation criteria.
        </p>
      </Section>

      <Section heading="Third-party links and content">
        <p className="text-sm">
          TenderPath may link to or display content from third-party websites and procurement
          portals. We are not responsible for the accuracy, availability, or content of those
          external resources.
        </p>
      </Section>

      <Section heading="Limitation of liability">
        <p className="text-sm">
          To the fullest extent permitted by applicable law, TenderPath accepts no liability for
          decisions made in reliance on platform outputs, missed tender deadlines, procurement
          losses, or any other direct or indirect harm arising from use of the service. See our{" "}
          <a href="/terms" className="underline text-amber-600">Terms & Conditions</a> for the
          full limitation of liability clause.
        </p>
      </Section>

      <Section heading="Questions">
        <p className="text-sm">
          If you have questions about the accuracy of a specific output, contact us at{" "}
          <a href="mailto:info@tenderpath.me" className="underline">info@tenderpath.me</a>.
        </p>
      </Section>
    </LegalShell>
  );
}
