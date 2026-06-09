import Nav from "@/components/landing/Nav";
import Hero from "@/components/landing/Hero";
import Problem from "@/components/landing/Problem";
import HowItWorks from "@/components/landing/HowItWorks";
import Features from "@/components/landing/Features";
import SocialProof from "@/components/landing/SocialProof";
import Pricing from "@/components/landing/Pricing";
import FinalCTA from "@/components/landing/FinalCTA";
import Footer from "@/components/landing/Footer";
import { getViewerHero } from "@/lib/assessment";
import { getLiveTenderCount } from "@/lib/landing/recent-tenders";

export const dynamic = "force-dynamic";

export default async function Home() {
  // Real wiring: welcome-back state + the live tender count behind the stat bar.
  // Both fail open (null) so the homepage never 500s on a DB hiccup.
  const [viewer, liveTenderCount] = await Promise.all([
    getViewerHero(),
    getLiveTenderCount(),
  ]);

  return (
    <div style={{ background: "#f6f3ec", minHeight: "100vh" }}>
      <Nav viewer={viewer} />
      <Hero viewer={viewer} />
      <Problem />
      <HowItWorks />
      <Features />
      <SocialProof liveTenderCount={liveTenderCount} />
      <Pricing />
      <FinalCTA />
      <Footer />
    </div>
  );
}
