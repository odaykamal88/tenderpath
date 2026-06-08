import { ComingSoonPage } from "@/components/workbench/pages/ComingSoonPage";

export default function Page() {
  return (
    <ComingSoonPage
      n="03"
      title="Tender database"
      eyebrow="Browse · next pass"
      body="The full searchable tender database — every live opportunity with sector, type and source facets, not just your matches — is being built in the next pass. For now, your ranked matches are on the Matches screen."
      cta={{ label: "Go to Matches", href: "/dashboard/matches" }}
    />
  );
}
