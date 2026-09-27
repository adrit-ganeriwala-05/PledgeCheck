"use client";

// Lenis smooth scrolling, on the landing page only. Off when the visitor asked for reduced motion.
import Lenis from "lenis";
import { useEffect } from "react";

export function SmoothScroll() {
  useEffect(() => {
    if (typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ autoRaf: true, anchors: true, lerp: 0.1 });
    return () => lenis.destroy();
  }, []);
  return null;
}
