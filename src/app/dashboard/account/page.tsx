import { ComingSoonPage } from "@/components/workbench/pages/ComingSoonPage";

export default function Page() {
  return (
    <ComingSoonPage
      title="Account & settings"
      eyebrow="Account · next pass"
      body="The full tabbed account area — company profile, subscription, billing & invoices, payment method, and team invites — is being built in the next pass. Your existing settings remain available in the meantime."
      cta={{ label: "Open current settings", href: "/dashboard/settings" }}
    />
  );
}
