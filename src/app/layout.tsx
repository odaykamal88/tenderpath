import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";
import SupportWidget from "@/components/SupportWidget";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TenderPath — Win UN Contracts With Confidence",
  description:
    "TenderPath decodes the $40B UN procurement maze. Get matched to tenders, assess your readiness, and win contracts you never knew existed.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${playfair.variable} antialiased`}
    >
      <body className="min-h-screen bg-white font-sans">
        {children}
        <SupportWidget />
      </body>
    </html>
  );
}
