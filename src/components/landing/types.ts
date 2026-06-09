/* Shared types for the redesigned landing surface. The server page
 * (app/page.tsx) fetches real data and threads it into the client sections. */

export type LandingViewer = { companyName: string; reportId: string } | null;

export interface LandingData {
  /** Set when the request carried a valid session AND that user has an
   *  assessment — drives the welcome-back CTA variants. null otherwise. */
  viewer: LandingViewer;
  /** Live, non-expired open tenders currently tracked. Real count from the DB
   *  (falls back to null when unavailable → the stat hides rather than lies). */
  liveTenderCount: number | null;
}
