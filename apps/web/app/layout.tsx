import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";

import { MotionProvider } from "@/components/brand/motion-provider";

import "./globals.css";

// Display face for headlines; its optical-size axis tightens it at large sizes. The latin subset
// covers Spanish (á é í ó ú ñ ¿ ¡), which keeps the font files small on phones.
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  axes: ["opsz"],
  display: "swap",
});

// UI and body face: legible at small sizes, with tabular figures for countdowns and codes.
const body = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
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
