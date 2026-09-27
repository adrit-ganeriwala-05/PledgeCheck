"use client";

import { domAnimation, LazyMotion, MotionConfig } from "motion/react";

/** Small motion bundle for the whole app; routes that need layout animation load domMax themselves.
 *  reducedMotion="user" turns transforms off for people who asked for less motion. */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
