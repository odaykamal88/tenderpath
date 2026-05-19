import type { Metadata, Viewport } from "next";
import { Inter, Fraunces, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import SupportWidget from "@/components/SupportWidget";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
  axes: ["opsz", "SOFT"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "TenderPath — UN procurement readiness, scored.",
  description:
    "$25.7B in UN contracts went to vendors who knew the system. Get your readiness score in 3 minutes — see exactly where you stand, what to fix, and which open tenders match.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} ${jetbrains.variable} antialiased`}
    >
      <body className="min-h-screen bg-paper font-sans text-ink">
        {children}
        <SupportWidget />
      </body>
    </html>
  );
}
