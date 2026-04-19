import Navbar from "@/components/landing/Navbar";
import Hero from "@/components/landing/Hero";
import Challenge from "@/components/landing/Challenge";
import HowItWorks from "@/components/landing/HowItWorks";
import Services from "@/components/landing/Services";
import WhyUs from "@/components/landing/WhyUs";
import CTA from "@/components/landing/CTA";
import Testimonials from "@/components/landing/Testimonials";
import Footer from "@/components/landing/Footer";

export default function Home() {
  return (
    <>
      <Navbar />
      <Hero />
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
