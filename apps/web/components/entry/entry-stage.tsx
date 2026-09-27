"use client";

// The fixed stage behind every entry page: a pre-rendered still of the current pose (first paint,
// reduced motion, no WebGL, a lost context) and, over it, the one live canvas.
//
// The canvas is mounted once and never again. Parsing three.js and compiling shaders are long
// main-thread tasks, so it never mounts during a transition or while the page is becoming interactive:
//   - large screens with a fine pointer: once the page has loaded and gone idle
//   - phones and tablets: on the first interaction or after a quiet 7 s, and on a sign-in page only
//     while no field has focus (so compiling never lands on someone's typing)
import { AnimatePresence, m, type MotionValue } from "motion/react";
import dynamic from "next/dynamic";
import { getImageProps } from "next/image";
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import type { Quality } from "@/components/test-model/pregnancy-test";
import { cn } from "@/lib/utils";

import { layoutFor, stillFor, STILLS, WIDE_QUERY, type EntryRoute, type Layout, type StillKey } from "./poses";
import type { Director } from "./stage-canvas";

const StageCanvas = dynamic(() => import("./stage-canvas").then((mod) => mod.StageCanvas), { ssr: false, loading: () => null });

const PHONE_FALLBACK_MS = 7000;
/** No mounting, no quality changes, until this long after the model last moved. */
const QUIET_MS = 1200;
const ORDER: Quality[] = ["low", "medium", "high"];

declare global {
  interface Window {
    /** Set by scripts/render-entry-stills.mjs: render the pose with no idle motion and no page on top. */
    __PC_STILL__?: boolean;
  }
}

type Mode = "pending" | "live" | "static";

export function EntryStage({
  route,
  progress,
  stageY,
  leaving,
  hideHomeStill,
}: {
  route: EntryRoute;
  progress: MotionValue<number>;
  stageY: MotionValue<number>;
  leaving: boolean;
  /** The static story (reduced motion) carries its own picture of the test on home. */
  hideHomeStill: boolean;
}) {
  const [mode, setMode] = useState<Mode>("pending");
  const [layout, setLayout] = useState<Layout>("wide");
  const [tier, setTier] = useState<Quality>("high");
  const [mount, setMount] = useState(false);
  const [warm, setWarm] = useState(false);
  const [ready, setReady] = useState(false);
  const [shown, setShown] = useState(false);
  const [lost, setLost] = useState(false);
  const [offscreen, setOffscreen] = useState(false);
  const [reduced, setReduced] = useState(false);
  // Every pose still needed so far (kept mounted for the cross-fade), and all of them once idle.
  const [seen, setSeen] = useState<StillKey[]>(() => [stillFor(route)]);
  const [warmStills, setWarmStills] = useState(false);
  if (!seen.includes(stillFor(route))) setSeen([...seen, stillFor(route)]);
  const stills: StillKey[] = warmStills ? ["home", "patient", "clinician"] : seen;

  const director = useRef<Director>({ route, layout: "wide", pointer: { x: 0, y: 0 }, still: false, developed: route !== "home" });
  const invalidate = useRef<() => void>(() => {});
  const settled = useRef(true);
  const quietUntil = useRef(0);
  const pendingTier = useRef<Quality | null>(null);

  // Capabilities, layout and pointer: known only in the browser.
  useEffect(() => {
    const d = director.current;
    d.still = window.__PC_STILL__ === true;
    const wide = window.matchMedia?.(WIDE_QUERY);
    const decide = () => {
      const next = wide ? (wide.matches ? "wide" : "narrow") : layoutFor(window.innerWidth, window.innerHeight);
      d.layout = next;
      setLayout(next);
      invalidate.current();
    };
    decide();
    wide?.addEventListener("change", decide);
    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    // Only the constructors are checked here: probing with a real context would create a second
    // WebGL context. If creation fails for real, the canvas reports it and the stills stay.
    const webgl = typeof window.WebGL2RenderingContext !== "undefined" || typeof window.WebGLRenderingContext !== "undefined";
    /* eslint-disable react-hooks/set-state-in-effect -- client-only capability checks on mount */
    setReduced(prefersReduced);
    setMode(prefersReduced || !webgl ? "static" : "live");
    const desktop = window.matchMedia?.("(pointer: fine)").matches && window.innerWidth >= 1024;
    setTier(desktop && (navigator.hardwareConcurrency ?? 4) >= 8 ? "high" : "medium");
    /* eslint-enable react-hooks/set-state-in-effect */
    const onPointer = (event: PointerEvent) => {
      d.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
      d.pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    return () => {
      wide?.removeEventListener("change", decide);
      window.removeEventListener("pointermove", onPointer);
    };
  }, []);

  // The route: the scene reads it on its next frame. A route change also starts a quiet period.
  useEffect(() => {
    const d = director.current;
    if (d.route === route) return;
    d.route = route;
    if (route !== "home") d.developed = true;
    quietUntil.current = performance.now() + QUIET_MS;
    settled.current = false;
    invalidate.current();
  }, [route]);

  // Warm the other stills once the page is idle, so the first click never waits on an image.
  useEffect(() => {
    const ric = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    const id = ric(() => setWarmStills(true), { timeout: 4000 });
    return () => window.cancelIdleCallback?.(id);
  }, []);

  // When to mount the canvas.
  useEffect(() => {
    if (mode !== "live" || mount) return;
    if (window.__PC_STILL__) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- capture mode mounts at once
      setMount(true);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    let idleId: number | undefined;
    const desktop = window.matchMedia?.("(pointer: fine)").matches && window.innerWidth >= 1024;
    const typing = () => {
      const el = document.activeElement;
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
    };
    const attempt = () => {
      if (cancelled) return;
      const wait = quietUntil.current - performance.now();
      if (wait > 0) {
        timer = window.setTimeout(attempt, wait + 50);
        return;
      }
      if (!desktop && director.current.route !== "home" && typing()) {
        document.addEventListener("focusout", attempt, { once: true });
        return;
      }
      setMount(true);
    };
    const onInteract = () => attempt();
    const onLoad = () => {
      if (desktop) {
        const ric = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 300));
        idleId = ric(attempt, { timeout: 2500 });
      } else {
        for (const type of ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const) {
          window.addEventListener(type, onInteract, { once: true, passive: true, capture: true });
        }
        timer = window.setTimeout(attempt, PHONE_FALLBACK_MS);
      }
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", onLoad);
      document.removeEventListener("focusout", attempt);
      for (const type of ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const) {
        window.removeEventListener(type, onInteract, { capture: true });
      }
      if (timer !== undefined) window.clearTimeout(timer);
      if (idleId !== undefined) window.cancelIdleCallback?.(idleId);
    };
  }, [mode, mount]);

  // The canvas renders on demand; it stops entirely while scrolled away with the end of the story.
  useEffect(() => {
    const update = (y: number) => setOffscreen(y <= -window.innerHeight + 1);
    update(stageY.get());
    return stageY.on("change", update);
  }, [stageY]);

  // Kick a frame whenever rendering may resume.
  useEffect(() => {
    if (warm && !offscreen && !lost) invalidate.current();
  }, [warm, offscreen, lost, layout]);

  // Fade the canvas in over the still; only then drop the still (no dip in brightness mid-fade).
  useEffect(() => {
    if (!ready || lost) return;
    const id = window.setTimeout(() => setShown(true), 650);
    return () => window.clearTimeout(id);
  }, [ready, lost]);

  // Home's one orchestrated moment on load: a beat after the canvas shows, the control line develops.
  useEffect(() => {
    if (!ready || director.current.developed || window.__PC_STILL__) return;
    const id = window.setTimeout(() => {
      director.current.developed = true;
      invalidate.current();
    }, 900);
    return () => window.clearTimeout(id);
  }, [ready]);

  const onSettledChange = useCallback((value: boolean) => {
    settled.current = value;
    if (!value) quietUntil.current = Math.max(quietUntil.current, performance.now() + 200);
  }, []);

  // A quality step down only while nothing moves: mid-transition it would visibly pop.
  const tierNow = useRef(tier);
  useEffect(() => {
    tierNow.current = tier;
  }, [tier]);
  const onDecline = useCallback(() => {
    const next = ORDER[Math.max(0, ORDER.indexOf(pendingTier.current ?? tierNow.current) - 1)];
    if (next !== tierNow.current) pendingTier.current = next;
  }, []);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!pendingTier.current || !settled.current || performance.now() < quietUntil.current) return;
      const next = pendingTier.current;
      pendingTier.current = null;
      setTier(next);
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  const onLost = useCallback(() => {
    setLost(true);
    setShown(false);
  }, []);
  const onRestored = useCallback(() => {
    setLost(false);
    setReady(false);
    // Three re-initializes its state on restore; give it a few frames before fading back in.
    invalidate.current();
    window.setTimeout(() => {
      invalidate.current();
      setReady(true);
    }, 150);
  }, []);

  const current = stillFor(route);
  const live = mode === "live" && mount;
  const canvasVisible = live && ready && !lost;
  const fade = reduced ? 0.15 : 0.6;
  return (
    <m.div
      aria-hidden
      data-stage={mode}
      data-route={route}
      data-canvas={canvasVisible ? (shown ? "shown" : "fading") : "off"}
      style={{ y: stageY }}
      animate={{ opacity: leaving ? 0 : 1 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="pointer-events-none fixed inset-x-0 top-0 z-0 h-lvh overflow-hidden"
    >
      {/* Stills: every pose that has been needed so far, cross-faded between. */}
      <AnimatePresence initial={false}>
        {stills.map((key) => {
          const visible = !(shown && canvasVisible) && key === current && !(key === "home" && hideHomeStill);
          return (
            <m.div
              key={key}
              className="absolute inset-0"
              initial={false}
              animate={{ opacity: visible ? 1 : 0, scale: visible || reduced ? 1 : 1.015 }}
              transition={{ duration: lost ? 0 : fade, ease: [0.22, 1, 0.36, 1] }}
            >
              <Still still={key} priority={key === stillFor(route)} />
            </m.div>
          );
        })}
      </AnimatePresence>
      {live ? (
        <div
          data-testid="entry-canvas"
          className="absolute inset-0 transition-opacity ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ opacity: canvasVisible ? 1 : 0, transitionDuration: lost ? "0ms" : "600ms" }}
        >
          <CanvasBoundary onError={() => setMode("static")}>
            <StageCanvas
              director={director}
              layout={layout}
              progress={progress}
              tier={tier}
              frameloop={warm && !offscreen && !lost ? "demand" : "never"}
              onWarm={() => setWarm(true)}
              onReady={() => setReady(true)}
              onSettledChange={onSettledChange}
              onDecline={onDecline}
              onLost={onLost}
              onRestored={onRestored}
              onInvalidate={(fn) => {
                invalidate.current = fn;
              }}
            />
          </CanvasBoundary>
        </div>
      ) : null}
    </m.div>
  );
}

/** A pose still with art direction: the wide render on wide layouts, the portrait one elsewhere. */
function Still({ still, priority }: { still: StillKey; priority: boolean }) {
  const common = { alt: "", sizes: "100vw" };
  const {
    props: { srcSet: wide },
  } = getImageProps({ ...common, src: STILLS[still].wide, width: 2800, height: 2000 });
  const {
    props: { srcSet: narrow, ...rest },
  } = getImageProps({ ...common, src: STILLS[still].narrow, width: 1200, height: 2860 });
  return (
    <picture>
      <source media={WIDE_QUERY} srcSet={wide} sizes="100vw" />
      {/* eslint-disable-next-line jsx-a11y/alt-text -- art-directed still from getImageProps; alt is "" */}
      <img
        {...rest}
        srcSet={narrow}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "low"}
        className={cn("absolute inset-0 size-full object-cover")}
      />
    </picture>
  );
}


/** WebGL can fail at creation (blocklisted GPU, too many contexts): the stills simply stay. */
class CanvasBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
