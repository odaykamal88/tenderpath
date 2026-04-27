import Navbar from "@/components/landing/Navbar";
import Hero from "@/components/landing/Hero";
import Challenge from "@/components/landing/Challenge";
import HowItWorks from "@/components/landing/HowItWorks";
import Services from "@/components/landing/Services";
import WhyUs from "@/components/landing/WhyUs";
import CTA from "@/components/landing/CTA";
import Testimonials from "@/components/landing/Testimonials";
import Footer from "@/components/landing/Footer";

const STAT_BAR = [
  { value: "$25.7B", label: "UN procurement spend in 2024" },
  { value: "222", label: "countries with eligible suppliers" },
  { value: "32", label: "active UN agencies buying" },
  { value: "3 years", label: "average time to first contract" },
];

export default function Home() {
  return (
    <>
      <Navbar />
      <Hero />
      <div className="bg-navy/5 border-y border-navy/8">
        <div className="mx-auto max-w-7xl px-6 lg:px-8 py-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 text-center">
            {STAT_BAR.map((s) => (
              <div key={s.label}>
                <p className="font-serif text-2xl font-bold text-navy">{s.value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
      <Challenge />
      <HowItWorks />
      <Services />
      <WhyUs />
      <Testimonials />
      <CTA />
      <Footer />
    </>
  );
}
