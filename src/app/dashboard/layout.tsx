/* Dashboard shell — the redesigned "Workbench".
 *
 * The WorkbenchProvider authenticates (bearer → /api/dashboard/workbench),
 * loads the consolidated view model, and hosts the global overlays (Navigator,
 * Paste, Vault). The Shell renders the dossier-spine sidebar, top bar, mobile
 * drawer and trial banner. All dashboard routes render as children inside it. */

import { WorkbenchProvider } from "@/components/workbench/WorkbenchProvider";
import { Shell } from "@/components/workbench/Shell";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkbenchProvider>
      <Shell>{children}</Shell>
    </WorkbenchProvider>
  );
}
