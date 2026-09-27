"use client";

// Lenis smooth scrolling, on the landing page only. Off when the visitor asked for reduced motion.
// It stops the moment home starts fading out on the way to a sign-in page (the shell resets the scroll
// once home is gone), and is destroyed with the page.
import Lenis from "lenis";
import { useIsPresent } from "motion/react";
import { useEffect, useRef } from "react";

export function SmoothScroll() {
  const lenis = useRef<Lenis | null>(null);
  const present = useIsPresent();

  useEffect(() => {
    if (typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const instance = new Lenis({ autoRaf: true, anchors: true, lerp: 0.1 });
    lenis.current = instance;
    return () => {
      instance.destroy();
      lenis.current = null;
    };
  }, []);

  useEffect(() => {
    if (!present) lenis.current?.stop();
  }, [present]);

  return null;
}
