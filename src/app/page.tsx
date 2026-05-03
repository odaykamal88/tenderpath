import Navbar from "@/components/landing/Navbar";
import Hero from "@/components/landing/Hero";
import Challenge from "@/components/landing/Challenge";
import Services from "@/components/landing/Services";
import WhyUs from "@/components/landing/WhyUs";
import CTA from "@/components/landing/CTA";
import Testimonials from "@/components/landing/Testimonials";
import Footer from "@/components/landing/Footer";

/**
 * Stat bar — three credibility-positive stats only.
 * Removed: "3 years average time to first contract" (undermined the pitch).
 * Source citations are surfaced in the small mono caption row.
 */
const STAT_BAR = [
  { value: "$25.7B", label: "UN procurement spend, 2024", source: "UN ASR" },
  { value: "222", label: "countries with eligible suppliers", source: "UNGM" },
  { value: "32", label: "active UN agencies buying", source: "UN ASR" },
];

export default function Home() {
  return (
    <>
      <Navbar />
      <Hero />

      {/* Stat bar — editorial, three columns */}
      <section className="bg-paper-2 border-y border-rule">
        <div className="mx-auto max-w-7xl px-6 lg:px-8 py-10">
          <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-mute mb-6">
            By the numbers · Annual Statistical Report on UN Procurement, 2024
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-y-8 gap-x-12">
            {STAT_BAR.map((s) => (
              <div
                key={s.label}
                className="border-l border-ink pl-5"
              >
                <p className="font-serif text-[44px] lg:text-[52px] font-normal leading-none tracking-[-0.02em] text-ink tabular-nums">
                  {s.value}
                </p>
                <p className="text-[13px] text-ink-2 mt-2 leading-snug">
                  {s.label}
                </p>
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-mute mt-2">
                  Source · {s.source}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Challenge />
      <Services />
      <WhyUs />
      <Testimonials />
      <CTA />
      <Footer />
    </>
  );
}
