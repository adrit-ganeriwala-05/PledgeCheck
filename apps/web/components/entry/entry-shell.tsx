"use client";

// The entry group's shared layout: home, patient sign-in and sign-up, clinician sign-in. One stage
// (the 3D test) stays mounted behind every page; the pages' DOM transitions over it.
//
//   home <-> sign-in   the hero copy fades up and out (staggered), then the card rises in
//   patient <-> clinic the card stays; its contents swap and its accent cross-fades
//   sign in <-> create handled inside the patient card (tabs), without a route change
import { animate, AnimatePresence, domMax, LazyMotion, m, motionValue, useReducedMotion } from "motion/react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Wordmark } from "@/components/brand/wordmark";
import { cn } from "@/lib/utils";

import { AuthCard, useFocusFirstField } from "./auth-card";
import { EntryContext, type EntryContextValue } from "./entry-context";
import { EntryLink } from "./entry-link";
import { EntryStage } from "./entry-stage";
import { FrozenRouter, useFrozenWhileExiting } from "./frozen-router";
import { EASE, staggered } from "./motion";
import { AUTH_PATHS, entryRoute, roleOf, type EntryRoute, type Role } from "./poses";

export function EntryShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const route = entryRoute(pathname) ?? "home";
  const section = route === "home" ? "home" : "auth";
  const reduced = useReducedMotion() ?? false;

  const [storyProgress] = useState(() => motionValue(0));
  const [stageY] = useState(() => motionValue(0));
  const [intent, setIntent] = useState<EntryRoute | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [staticStory, setStaticStory] = useState(false);
  const [firstPaint, setFirstPaint] = useState(true);
  const pending = useRef<{ href: string; at: number } | null>(null);

  useEffect(() => {
    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const webgl = typeof window.WebGL2RenderingContext !== "undefined" || typeof window.WebGLRenderingContext !== "undefined";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only capability check on mount
    setStaticStory(prefersReduced || !webgl);
  }, []);

  // A committed route clears the click's intent, and ends "first paint" for panels mounted from now on.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    pending.current = null;
    setIntent(null);
    setFirstPaint(false);
  }, [pathname]);

  // Leaving home: the story rewinds and the stage comes back into view (it may have scrolled away).
  useEffect(() => {
    if (section === "home") return;
    storyProgress.set(0);
    if (stageY.get() !== 0) {
      // The stage slides back down with the model, which is already on its way to the new pose.
      const controls = animate(stageY, 0, { duration: reduced ? 0 : 0.8, ease: EASE });
      return () => controls.stop();
    }
  }, [section, storyProgress, stageY, reduced]);

  // Prefetch every entry page once the first page is idle, so the first click starts at once.
  useEffect(() => {
    const ric = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1200));
    const id = ric(
      () => {
        for (const href of ["/", AUTH_PATHS.patient, AUTH_PATHS["patient-signup"], AUTH_PATHS.clinician]) router.prefetch(href);
      },
      { timeout: 3000 },
    );
    return () => window.cancelIdleCallback?.(id);
  }, [router]);

  const intend = useCallback((href: string) => {
    const now = performance.now();
    // A second click on the same destination while the first is still on its way does nothing.
    if (pending.current && pending.current.href === href && now - pending.current.at < 1500) return false;
    pending.current = { href, at: now };
    const target = entryRoute(href.split(/[?#]/)[0]);
    if (target) setIntent(target);
    return true;
  }, []);

  const leave = useCallback(
    (href: string) => {
      setLeaving(true);
      // The card and the model fade out together, then the next page takes over the black screen.
      window.setTimeout(() => router.replace(href), reduced ? 150 : 300);
    },
    [router, reduced],
  );

  // If the destination never arrives (offline), bring the page back rather than leave it black.
  useEffect(() => {
    if (!leaving) return;
    const id = window.setTimeout(() => setLeaving(false), 10000);
    return () => window.clearTimeout(id);
  }, [leaving]);

  const context = useMemo<EntryContextValue>(
    () => ({ storyProgress, stageY, staticStory, intend, leave, firstPaint }),
    [storyProgress, stageY, staticStory, intend, leave, firstPaint],
  );

  const stageRoute = intent ?? route;
  return (
    <EntryContext.Provider value={context}>
      <LazyMotion features={domMax}>
        <EntryStage route={stageRoute} progress={storyProgress} stageY={stageY} leaving={leaving} hideHomeStill={staticStory} />
        <m.div
          className="entry-content relative z-10 flex min-h-dvh flex-1 flex-col"
          animate={{ opacity: leaving ? 0 : 1 }}
          transition={{ duration: reduced ? 0.15 : 0.3, ease: EASE }}
          style={{ pointerEvents: leaving ? "none" : undefined }}
        >
          <AnimatePresence mode="wait" initial={false} onExitComplete={() => window.scrollTo({ top: 0, left: 0, behavior: "instant" })}>
            {section === "home" ? (
              <HomePanel key="home" reduced={reduced}>
                <FrozenRouter>{children}</FrozenRouter>
              </HomePanel>
            ) : (
              <AuthPanel key="auth" route={route} reduced={reduced} firstPaint={firstPaint}>
                {children}
              </AuthPanel>
            )}
          </AnimatePresence>
        </m.div>
        {leaving ? <LeavingStatus /> : null}
      </LazyMotion>
    </EntryContext.Provider>
  );
}

/** Home only fades as a whole (it holds a fixed nav, which a transform would unpin); its hero lines
 *  carry the staggered drift themselves. */
function HomePanel({ children, reduced }: { children: ReactNode; reduced: boolean }) {
  return (
    <m.div
      data-panel="home"
      initial="hidden"
      animate="shown"
      exit="exit"
      variants={{
        hidden: { opacity: 0 },
        shown: { opacity: 1, transition: { duration: reduced ? 0.15 : 0.35, ease: EASE, ...staggered(reduced, 0.08) } },
        exit: { opacity: 0, transition: { duration: reduced ? 0.15 : 0.2, delay: reduced ? 0 : 0.06, ease: EASE, staggerChildren: 0.04 } },
      }}
      className="flex flex-1 flex-col"
    >
      {children}
    </m.div>
  );
}

function AuthPanel({
  route,
  reduced,
  firstPaint,
  children,
}: {
  route: EntryRoute;
  reduced: boolean;
  firstPaint: boolean;
  children: ReactNode;
}) {
  // While this panel exits (back to home), it keeps showing the role it had.
  const liveRole: Role = roleOf(route) ?? "patient";
  const role = useFrozenWhileExiting(liveRole);
  const [initialPaint] = useState(firstPaint);
  const card = useRef<HTMLDivElement>(null);
  useFocusFirstField(card, role, initialPaint ? 450 : 620);

  return (
    <m.div
      data-panel="auth"
      initial="hidden"
      animate="shown"
      exit="exit"
      variants={{
        hidden: { opacity: 0 },
        shown: { opacity: 1, transition: { duration: reduced ? 0.15 : 0.3, ease: EASE } },
        exit: { opacity: 0, transition: { duration: reduced ? 0.15 : 0.22, ease: EASE } },
      }}
      className="flex min-h-dvh flex-1 flex-col"
    >
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <EntryLink href="/" aria-label="PledgeCheck home" className="rounded-md">
          <Wordmark />
        </EntryLink>
        <EntryLink href="/" className="rounded-md px-2 py-1.5 text-sm text-haze transition-colors hover:text-mist">
          <span aria-hidden>← </span>Home
        </EntryLink>
      </header>
      <main className="mx-auto grid w-full max-w-6xl flex-1 grid-rows-[auto_1fr] px-4 sm:px-6 wide:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] wide:grid-rows-1 wide:gap-12">
        {/* The model's place: above the card on phones, left of it on wide screens. */}
        <div aria-hidden className="h-[max(11rem,24svh)] wide:h-auto" />
        <div className="pb-10 wide:pt-[max(1.5rem,calc(50dvh-20rem))] wide:pb-16">
          <m.div
            ref={card}
            className={cn(initialPaint && "entry-rise")}
            initial={initialPaint ? false : "hidden"}
            animate="shown"
            exit="exit"
            variants={{
              hidden: { opacity: 0, y: reduced ? 0 : 18 },
              shown: { opacity: 1, y: 0, transition: { duration: reduced ? 0.15 : 0.5, ease: EASE, ...staggered(reduced, 0.1) } },
              exit: { opacity: 0, y: reduced ? 0 : 10, transition: { duration: reduced ? 0.15 : 0.2, ease: EASE } },
            }}
          >
            <AuthCard role={role} swapKey={role}>
              {/* Two freezes: this one follows the panel's own presence (auth → home), the inner one the
                  role swap. The inner one alone would read the role swap's presence and let the next
                  page render inside the exiting card. */}
              <FrozenRouter>
                <AnimatePresence mode="wait" initial={false}>
                  <m.div
                    key={role}
                    initial="hidden"
                    animate="shown"
                    exit={{ opacity: 0, transition: { duration: reduced ? 0.08 : 0.1, ease: EASE } }}
                    variants={SWAP}
                  >
                    <FrozenRouter>{children}</FrozenRouter>
                  </m.div>
                </AnimatePresence>
              </FrozenRouter>
            </AuthCard>
          </m.div>
        </div>
      </main>
    </m.div>
  );
}

/** A swap inside the card: a quick fade-through, the new lines arriving close together. */
const SWAP = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: 0.16, ease: EASE, delayChildren: 0, staggerChildren: 0.03 } },
};

function LeavingStatus() {
  return (
    <m.div
      role="status"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.7, duration: 0.3 }}
      className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center text-sm text-haze"
    >
      <span className="flex items-center gap-3">
        <span className="size-2 animate-pulse rounded-full bg-orchid" aria-hidden />
        Signing you in…
      </span>
    </m.div>
  );
}
