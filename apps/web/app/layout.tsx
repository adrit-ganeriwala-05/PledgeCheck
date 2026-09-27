import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";

import { MotionProvider } from "@/components/brand/motion-provider";

import "./globals.css";

// Display face for headlines; its width and optical-size axes give it character at large sizes.
const display = Bricolage_Grotesque({
  subsets: ["latin", "latin-ext"],
  variable: "--font-bricolage",
  axes: ["wdth", "opsz"],
  display: "swap",
});

// UI and body face: legible at small sizes, with tabular figures for countdowns and codes.
const body = Instrument_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-instrument",
  axes: ["wdth"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "PledgeCheck",
  description: "Verified at-home iPLEDGE pregnancy tests for dermatology practices.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark h-full antialiased ${display.variable} ${body.variable}`}>
      <body className="flex min-h-full flex-col">
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
