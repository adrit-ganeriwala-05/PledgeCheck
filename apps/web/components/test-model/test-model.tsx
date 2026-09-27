"use client";

// <TestModel />: the shared 3D pregnancy test. The poster (a still rendered from the high tier)
// shows instantly and stays the whole time when WebGL is unavailable or reduced motion is set;
// otherwise the live canvas loads with next/dynamic and fades in over it once real frames exist.
import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import type { Quality } from "./pregnancy-test";
import type { View } from "./scene";

const Scene = dynamic(() => import("./scene").then((m) => m.Scene), { ssr: false, loading: () => null });

// The poster and the canvas share one aspect ratio per view, so the handover is invisible.
const ASPECT: Record<View, string> = { hero: "aspect-4/3", instruction: "aspect-square" };

export const POSTERS: Record<View, string> = {
  hero: "/brand/test-hero.webp",
  instruction: "/brand/test-instruction.webp",
};

export type TestModelProps = {
  /** "auto" picks high on desktop and medium elsewhere, then steps down if frames drop. */
  tier?: Quality | "auto";
  /** Upper bound for "auto" and for runtime step-ups. The patient flow passes "medium". */
  maxTier?: Quality;
  /** 0-1, or "develop" to play the control line developing once, on load. */
  lineProgress?: number | "develop";
  /** Show the code area: the handwritten code, or empty dashes when code is null. */
  showCode?: boolean;
  code?: string | null;
  /** Tilt toward the pointer. */
  interactive?: boolean;
  /** Slow turntable sway. */
  autoRotate?: boolean;
  /** Drag to rotate (the patient instruction step). */
  draggable?: boolean;
  view?: View;
  /** Describes the image for screen readers; the canvas itself is hidden from them. */
  alt: string;
  className?: string;
  priority?: boolean;
  sizes?: string;
};

const ORDER: Quality[] = ["low", "medium", "high"];
const cap = (tier: Quality, max: Quality) => ORDER[Math.min(ORDER.indexOf(tier), ORDER.indexOf(max))];

export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return false;
    // Give the probe context back right away; phones allow only a few at once.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function autoTier(): Quality {
  const desktop = window.matchMedia("(pointer: fine)").matches && window.innerWidth >= 1024;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (desktop && cores >= 8) return "high";
  return "medium";
}

export function TestModel({
  tier = "auto",
  maxTier = "high",
  lineProgress = 1,
  showCode = false,
  code = null,
  interactive = false,
  autoRotate = false,
  draggable = false,
  view = "hero",
  alt,
  className,
  priority = false,
  sizes = "(min-width: 1024px) 60vw, 100vw",
}: TestModelProps) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<Quality | null>(null);
  const [ready, setReady] = useState(false);
  const [inView, setInView] = useState(true);

  useEffect(() => {
    // No matchMedia (very old browsers, test environments): stay on the poster.
    if (typeof window.matchMedia !== "function") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const decide = () => {
      if (reduced.matches || !hasWebGL()) {
        setLive(null);
        setReady(false);
      } else {
        setLive(cap(tier === "auto" ? autoTier() : tier, maxTier));
      }
    };
    decide();
    reduced.addEventListener("change", decide);
    return () => reduced.removeEventListener("change", decide);
  }, [tier, maxTier]);

  useEffect(() => {
    const el = wrapper.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin: "120px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={wrapper} role="img" aria-label={alt} className={cn("relative", ASPECT[view], className)}>
      <Image
        src={POSTERS[view]}
        alt=""
        fill
        priority={priority}
        sizes={sizes}
        className={cn("object-contain transition-opacity duration-700", ready && "opacity-0")}
      />
      {live ? (
        <div className={cn("absolute inset-0 transition-opacity duration-700", ready ? "opacity-100" : "opacity-0")}>
          <Scene
            tier={live}
            onDecline={() => setLive((t) => (t ? ORDER[Math.max(0, ORDER.indexOf(t) - 1)] : t))}
            view={view}
            lineProgress={lineProgress}
            showCode={showCode}
            code={code}
            interactive={interactive}
            autoRotate={autoRotate}
            draggable={draggable}
            active={inView}
            onReady={() => setReady(true)}
          />
        </div>
      ) : null}
    </div>
  );
}
