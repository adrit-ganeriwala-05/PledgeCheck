import type { Metadata } from "next";

import { Closing, Footer, HowItWorks, LandingNav, Privacy, Problem, Trust } from "@/components/landing/sections";
import { SmoothScroll } from "@/components/landing/smooth-scroll";
import { Story } from "@/components/landing/story";

export const metadata: Metadata = {
  title: "PledgeCheck · iPLEDGE pregnancy tests at home",
  description:
    "At-home iPLEDGE pregnancy tests that can't be faked: a challenge code, two independent readers, photo-reuse checks and a hash-linked audit chain, with the prescriber's decision on every test.",
};

export default function Home() {
  return (
    <>
      <SmoothScroll />
      <LandingNav />
      <main>
        <Story />
        <Problem />
        <HowItWorks />
        <Trust />
        <Privacy />
        <Closing />
      </main>
      <Footer />
    </>
  );
}
