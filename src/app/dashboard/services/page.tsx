import { redirect } from "next/navigation";

// The Services landing page used to render a tile grid + RecentWorkOrders
// catalogue. The sidebar now ships three direct sub-items (Bid/No Bid,
// Proposal submission, Fast Track LTA Roster) under a disclosure-only
// Services parent — there's no need for a separate landing view. Anyone
// who deep-links or bookmarks /dashboard/services lands on the first
// service intake page.
export default function ServicesIndex(): never {
  redirect("/dashboard/services/bid-no-bid");
}
