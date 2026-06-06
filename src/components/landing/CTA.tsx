/* CTA — final paper-stamp card on dark ink · mobile-tuned */
import Link from "next/link";

export default function CTA() {
  return (
    <section id="cta" className="bg-ink py-16 sm:py-20 lg:py-28 relative overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 30%, #fff 1px, transparent 1px), radial-gradient(circle at 80% 70%, #fff 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />
      <div className="mx-auto max-w-4xl px-5 sm:px-6 lg:px-8 relative">
        <div className="border border-paper-2/20 p-7 sm:p-10 lg:p-16">
          <p className="font-mono text-[10px] sm:text-[11px] tracking-[0.16em] sm:tracking-[0.18em] uppercase text-accent-2 mb-5 sm:mb-6">
            Closing notice
          </p>
          <h2 className="font-serif text-[32px] sm:text-[44px] lg:text-[56px] font-normal leading-[1.07] sm:leading-[1.05] tracking-[-0.02em] text-paper text-balance mb-5 sm:mb-6">
            Stop chasing tenders<br />
            you shouldn&rsquo;t <em className="italic text-accent-2 font-serif">chase</em>.
          </h2>
          <p className="text-[14.5px] sm:text-[15px] lg:text-[16px] text-paper-2/70 leading-[1.6] mb-8 sm:mb-10 max-w-xl">
            Five minutes. The free assessment tells you where you stand, what gaps to fix, and which tenders are worth your week of evenings — before you spend them.
          </p>

          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-4 sm:gap-6 pt-5 sm:pt-6 border-t border-paper-2/15">
            <Link
              href="/assessment?goal=track-tenders"
              className="inline-flex items-center justify-center sm:justify-start gap-3 bg-paper px-6 sm:px-8 py-4 text-[14px] font-medium text-ink hover:bg-accent-2 hover:text-ink transition-colors"
            >
              Run the free assessment
              <span className="font-mono text-[13px]">→</span>
            </Link>
            <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-paper-2/50 self-center sm:self-auto">
              No card · No login · 5 min
            </span>
          </div>

          <p className="mt-8 sm:mt-10 pt-5 sm:pt-6 border-t border-paper-2/15 font-mono text-[10.5px] sm:text-[11px] text-paper-2/50">
            Already a member?{" "}
            <Link href="/login" className="text-paper border-b border-paper hover:text-accent-2 hover:border-accent-2">
              Sign in to your dashboard →
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
