import { redirect } from "next/navigation";

/* Settings consolidated into the dossier Account area: the profile editor lives
 * in Account → Company profile, and the bot-linking card moved to Account →
 * Profile & team. This route now redirects so there's a single settings home. */
export default function SettingsPage() {
  redirect("/dashboard/account");
}
