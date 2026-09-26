import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PledgeCheck",
  description: "Verified at-home iPLEDGE pregnancy tests for dermatology practices.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
