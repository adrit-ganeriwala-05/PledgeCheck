"use client";

// The hero and scroll story: one sticky, full-bleed 3D stage with the copy laid over it.
import { m, useScroll, useTransform, type MotionValue } from "motion/react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { Quality } from "@/components/test-model/pregnancy-test";
import { hasWebGL } from "@/components/test-model/test-model";
import { cn } from "@/lib/utils";

import type { Layout } from "./story-canvas";

const StoryCanvas = dynamic(() => import("./story-canvas").then((mod) => mod.StoryCanvas), { ssr: false, loading: () => null });

// Stills rendered from the live scene at the top of the story (before the line develops). They are
// taller than any viewport in their layout, so object-cover crops them top and bottom, exactly
// like the camera, which keeps its horizontal field of view constant.
const POSTER: Record<Layout, { src: string }> = {
  wide: { src: "/brand/landing-wide.webp" },
  narrow: { src: "/brand/landing-narrow.webp" },
};

export const CHAPTERS = [
  {
    range: [0.1, 0.15, 0.27, 0.31],
    title: "A one-time link, not an app",
    body: "The dermatologist issues a QR link. The patient opens it on their phone and takes the test they already know.",
  },
  {
    range: [0.32, 0.36, 0.5, 0.54],
    title: "A code they only see once they start",
    body: "Tapping Start reveals a 4-character code. They write it on the test and photograph both, camera only, so an old photo can't stand in.",
  },
  {
    range: [0.57, 0.62, 0.99, 1],
    title: "Every test becomes a record",
    body: "Two independent readers check the photo, the prescriber approves in one tap, and each decision joins a hash-linked audit chain.",
  },
] as const;

export function Story() {
  const section = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: section, offset: ["start start", "end end"] });
  const [layout, setLayout] = useState<Layout>("wide");
  const [mode, setMode] = useState<"pending" | "live" | "static">("pending");
  const [tier, setTier] = useState<Quality>("high");
  const [ready, setReady] = useState(false);
  const [inView, setInView] = useState(true);

  useEffect(() => {
    const decideLayout = () =>
      setLayout(window.innerWidth >= 900 && window.innerWidth / window.innerHeight >= 1.4 ? "wide" : "narrow");
    // Viewport, WebGL and reduced motion are only known in the browser, after mount.
    decideLayout();
    window.addEventListener("resize", decideLayout);
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !hasWebGL()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only capability check on mount
      setMode("static");
    } else {
      const desktop = window.matchMedia("(pointer: fine)").matches && window.innerWidth >= 1024;
      setTier(desktop && (navigator.hardwareConcurrency ?? 4) >= 8 ? "high" : "medium");
      setMode("live");
    }
    return () => window.removeEventListener("resize", decideLayout);
  }, []);

  useEffect(() => {
    const el = section.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (mode === "static") return <StaticStory />;

  const poster = POSTER[layout];
  return (
    <section ref={section} aria-labelledby="hero-title" className="relative h-[460vh]">
      <div className="sticky top-0 h-dvh overflow-hidden">
        <Image
          src={poster.src}
          alt=""
          fill
          priority
          sizes="100vw"
          className={cn("object-cover transition-opacity duration-700", ready && "opacity-0")}
        />
        {mode === "live" ? (
          <div className={cn("absolute inset-0 transition-opacity duration-700", ready ? "opacity-100" : "opacity-0")}>
            <StoryCanvas
              key={layout}
              progress={scrollYProgress}
              layout={layout}
              tier={tier}
              active={inView}
              onReady={() => setReady(true)}
              onDecline={() => setTier((t) => (t === "high" ? "medium" : "low"))}
            />
          </div>
        ) : null}
        <Flash progress={scrollYProgress} />
        {/* Phones: a scrim so the copy over the lower part of the stage stays readable. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-linear-to-t from-ink via-ink/85 to-ink/0 min-[900px]:hidden" />
        <Hero progress={scrollYProgress} />
        {CHAPTERS.map((chapter, i) => (
          <Chapter key={chapter.title} index={i} progress={scrollYProgress} {...chapter} />
        ))}
      </div>
      {/* The chapters as plain text for screen readers; the animated copies above are hidden. */}
      <ol className="sr-only">
        {CHAPTERS.map((chapter) => (
          <li key={chapter.title}>
            <h2>{chapter.title}</h2>
            <p>{chapter.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Hero({ progress }: { progress: MotionValue<number> }) {
  const opacity = useTransform(progress, [0, 0.05, 0.09], [1, 1, 0]);
  const y = useTransform(progress, [0, 0.09], [0, -40]);
  const pointerEvents = useTransform(progress, (p) => (p > 0.08 ? "none" : "auto"));
  const visibility = useTransform(progress, (p) => (p > 0.095 ? "hidden" : "visible"));
  return (
    <m.div
      style={{ opacity, y, pointerEvents, visibility }}
      className="absolute inset-x-0 bottom-0 px-4 pb-10 min-[900px]:inset-y-0 min-[900px]:flex min-[900px]:items-center min-[900px]:pb-0"
    >
      <div className="mx-auto w-full max-w-6xl">
        <div className="max-w-xl">
          <h1 id="hero-title" className="text-hero font-semibold [font-variation-settings:'wdth'_100,'opsz'_96]">
            Take your iPLEDGE test at home.
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-mist/85 sm:text-xl">
            Since August 2026, the FDA allows at-home pregnancy tests for isotretinoin, as long as prescribers
            prevent misreading and falsification. PledgeCheck is how practices do it.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild variant="brand" size="lg" className="h-12 px-6 text-base">
              <Link href="/login">Sign in as a clinician</Link>
            </Button>
            <Button asChild variant="ghost" size="lg" className="h-12 px-5 text-base text-mist">
              <a href="#how">See how it works</a>
            </Button>
          </div>
        </div>
      </div>
    </m.div>
  );
}

function Chapter({
  index,
  progress,
  range,
  title,
  body,
}: {
  index: number;
  progress: MotionValue<number>;
  range: readonly [number, number, number, number];
  title: string;
  body: string;
}) {
  // The last chapter stays up to the end of the story.
  const opacity = useTransform(progress, [...range], [0, 1, 1, range[3] >= 1 ? 1 : 0]);
  const y = useTransform(progress, [range[0], range[1]], [24, 0]);
  return (
    <m.div
      style={{ opacity, y }}
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 px-4 pb-12 min-[900px]:inset-y-0 min-[900px]:flex min-[900px]:items-center min-[900px]:pb-0"
    >
      <div className="mx-auto w-full max-w-6xl">
        <div className="max-w-md">
          <p className="tabular text-sm font-semibold text-orchid-text">{`0${index + 1}`}</p>
          <h2 className="mt-2 text-4xl font-semibold sm:text-5xl">{title}</h2>
          <p className="mt-4 text-lg leading-relaxed text-mist/85">{body}</p>
        </div>
      </div>
    </m.div>
  );
}

/** The camera "takes" the photo as the frame closes: a brief, soft flash. */
function Flash({ progress }: { progress: MotionValue<number> }) {
  const opacity = useTransform(progress, [0.455, 0.47, 0.5], [0, 0.22, 0]);
  return <m.div aria-hidden style={{ opacity }} className="pointer-events-none absolute inset-0 bg-mist" />;
}

/** Reduced motion or no WebGL: the same story as a still and three short passages. */
function StaticStory() {
  return (
    <section aria-labelledby="hero-title" className="relative">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-8 px-4 pt-28 pb-16 min-[900px]:grid-cols-2">
        <div>
          <h1 id="hero-title" className="text-hero font-semibold">
            Take your iPLEDGE test at home.
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-mist/85 sm:text-xl">
            Since August 2026, the FDA allows at-home pregnancy tests for isotretinoin, as long as prescribers
            prevent misreading and falsification. PledgeCheck is how practices do it.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild variant="brand" size="lg" className="h-12 px-6 text-base">
              <Link href="/login">Sign in as a clinician</Link>
            </Button>
            <Button asChild variant="ghost" size="lg" className="h-12 px-5 text-base text-mist">
              <a href="#how">See how it works</a>
            </Button>
          </div>
        </div>
        <Image src="/brand/test-hero.webp" alt="An unbranded at-home pregnancy test with a rose cap, lying on black acrylic." width={2400} height={1800} priority sizes="(min-width: 900px) 50vw, 100vw" className="[mask-image:radial-gradient(closest-side,black_72%,transparent)]" />
      </div>
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 pb-24 md:grid-cols-3">
        {CHAPTERS.map((chapter, i) => (
          <div key={chapter.title}>
            <p className="tabular text-sm font-semibold text-orchid-text">{`0${i + 1}`}</p>
            <h2 className="mt-2 text-2xl font-semibold">{chapter.title}</h2>
            <p className="mt-3 leading-relaxed text-haze">{chapter.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
