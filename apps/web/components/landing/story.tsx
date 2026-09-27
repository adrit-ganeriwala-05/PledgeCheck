"use client";

// The hero and scroll story: the copy laid over the entry group's stage (components/entry). The stage
// and its 3D test live in the shared layout, so they survive the trip to the sign-in pages; this
// section only provides the scroll length and publishes its progress.
import { m, useIsPresent, useMotionValueEvent, useScroll, useTransform, type MotionValue } from "motion/react";
import Image from "next/image";
import { useEffect, useRef } from "react";

import { EntryLink } from "@/components/entry/entry-link";
import { useEntry, useEntryMotion } from "@/components/entry/entry-context";
import { ITEM } from "@/components/entry/motion";
import { Button } from "@/components/ui/button";

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
  const entry = useEntry();
  // Reduced motion or no WebGL at all: the same story as a still and three short passages. Outside the
  // entry shell (unit tests), decide here.
  const staticStory = entry ? entry.staticStory : typeof window === "undefined" || typeof window.WebGLRenderingContext === "undefined";
  if (staticStory) return <StaticStory />;
  return <ScrollStory />;
}

function ScrollStory() {
  const section = useRef<HTMLElement>(null);
  const { storyProgress, stageY } = useEntryMotion();
  const present = useIsPresent();
  const { scrollYProgress } = useScroll({ target: section, offset: ["start start", "end end"] });
  // Past the end of the story the stage scrolls away with it, exactly like the sticky stage it replaces.
  const { scrollYProgress: past } = useScroll({ target: section, offset: ["end end", "end start"] });

  useEffect(() => {
    storyProgress.set(scrollYProgress.get());
    stageY.set(-past.get() * window.innerHeight);
  }, [scrollYProgress, past, storyProgress, stageY]);
  // While the page fades out on the way to a sign-in page, the stage belongs to the next page.
  useMotionValueEvent(scrollYProgress, "change", (v) => present && storyProgress.set(v));
  useMotionValueEvent(past, "change", (v) => present && stageY.set(-v * window.innerHeight));

  return (
    <section ref={section} aria-labelledby="hero-title" className="relative h-[460vh]">
      <div className="sticky top-0 h-dvh overflow-hidden">
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
          <m.h1 variants={ITEM} id="hero-title" className="text-hero font-semibold">
            Take your iPLEDGE test at home.
          </m.h1>
          <m.p variants={ITEM} className="mt-5 max-w-lg text-lg leading-relaxed text-mist/85 sm:text-xl">
            Since August 2026, the FDA allows at-home pregnancy tests for isotretinoin, as long as prescribers
            prevent misreading and falsification. PledgeCheck is how practices do it.
          </m.p>
          <m.div variants={ITEM}>
            <HeroActions />
          </m.div>
        </div>
      </div>
    </m.div>
  );
}

/** The calls to action, shared by the scroll story and the static story. */
export function HeroActions() {
  return (
    <div className="mt-8 flex flex-wrap items-center gap-3">
      <Button asChild variant="brand" size="lg" className="h-12 px-6 text-base active:scale-[0.98]">
        <EntryLink href="/login">Sign in as a clinician</EntryLink>
      </Button>
      <Button asChild variant="outline" size="lg" className="h-12 px-6 text-base active:scale-[0.98]">
        <EntryLink href="/portal/login">Patient sign in</EntryLink>
      </Button>
      <Button asChild variant="ghost" size="lg" className="h-12 px-5 text-base text-mist">
        <a href="#how">See how it works</a>
      </Button>
    </div>
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
    <section aria-labelledby="hero-title" className="relative bg-ink">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-8 px-4 pt-28 pb-16 min-[900px]:grid-cols-2">
        <div>
          <h1 id="hero-title" className="text-hero font-semibold">
            Take your iPLEDGE test at home.
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-mist/85 sm:text-xl">
            Since August 2026, the FDA allows at-home pregnancy tests for isotretinoin, as long as prescribers
            prevent misreading and falsification. PledgeCheck is how practices do it.
          </p>
          <HeroActions />
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
