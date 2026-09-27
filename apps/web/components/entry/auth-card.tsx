"use client";

// The one card both sign-ins share. It stays mounted from one sign-in page to the other: only its
// contents swap, its accent cross-fades (rose for patients, orchid for clinicians), and its height
// animates on a swap. Between swaps its height simply follows the content, so an error growing in
// under a field is never clipped.
import { animate, m, useReducedMotion, type AnimationPlaybackControls } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { EntryLink } from "./entry-link";
import { EASE } from "./motion";
import { AUTH_PATHS, type Role } from "./poses";

const SwapContext = createContext<() => void>(() => {});

/** Call before changing what the card shows (a tab, a confirmation state), so its height animates. */
export function useCardSwap(): () => void {
  return useContext(SwapContext);
}

export function AuthCard({ role, swapKey, children }: { role: Role; swapKey: string; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const running = useRef<AnimationPlaybackControls | null>(null);
  const release = useRef<number | undefined>(undefined);
  const reduced = useReducedMotion();

  const unpin = useCallback(() => {
    const box = outer.current;
    if (!box) return;
    box.style.height = "";
    box.style.overflowY = "";
  }, []);

  // A swap is announced before the new content mounts: pin the card at its current height right then,
  // so the new content can never paint at its own height first. The resize observer below animates
  // from the pinned height to the new one.
  const announce = useCallback(() => {
    const box = outer.current;
    if (!box || reduced) return;
    box.style.overflowY = "clip";
    box.style.height = `${box.getBoundingClientRect().height}px`;
    window.clearTimeout(release.current);
    // Nothing changed size after all: let go.
    release.current = window.setTimeout(() => {
      if (!running.current) unpin();
    }, 900);
  }, [reduced, unpin]);

  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    announce();
  }, [swapKey, announce]);

  useLayoutEffect(() => {
    const box = outer.current;
    const content = inner.current;
    if (!box || !content || typeof ResizeObserver === "undefined") return;
    let last = content.offsetHeight;
    const observer = new ResizeObserver(() => {
      const next = content.offsetHeight;
      if (next === last) return;
      last = next;
      // Not pinned and not animating: the card simply follows its content (an error growing in).
      if (!box.style.height) return;
      const from = box.getBoundingClientRect().height;
      running.current?.stop();
      const controls = animate(box, { height: [from, next] }, { duration: 0.36, ease: EASE });
      running.current = controls;
      controls.then(() => {
        if (running.current !== controls) return;
        running.current = null;
        unpin();
      });
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
      window.clearTimeout(release.current);
    };
  }, [unpin]);

  const accent = role === "clinician" ? "orchid" : "rose";
  return (
    <SwapContext.Provider value={announce}>
      <div
        data-testid="auth-card"
        data-role={role}
        className="relative isolate rounded-3xl border border-line/80 bg-surface/75 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl"
      >
        {/* Accent: a soft glow along the top edge, cross-faded between the two roles. */}
        <m.div
          aria-hidden
          initial={false}
          animate={{ opacity: accent === "rose" ? 1 : 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="pointer-events-none absolute inset-x-8 -top-px -z-10 h-px bg-linear-to-r from-rose/0 via-rose to-rose/0 shadow-[0_0_40px_6px_rgba(255,79,168,0.35)]"
        />
        <m.div
          aria-hidden
          initial={false}
          animate={{ opacity: accent === "orchid" ? 1 : 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="pointer-events-none absolute inset-x-8 -top-px -z-10 h-px bg-linear-to-r from-orchid/0 via-orchid to-orchid/0 shadow-[0_0_40px_6px_rgba(178,102,255,0.35)]"
        />
        <div ref={outer}>
          <div ref={inner} className="p-6 sm:p-8">
            {children}
          </div>
        </div>
        <RoleSwitch role={role} />
      </div>
    </SwapContext.Provider>
  );
}

function RoleSwitch({ role }: { role: Role }) {
  const other = role === "clinician" ? "patient" : "clinician";
  return (
    <p className="border-t border-line/70 px-6 py-4 text-sm text-haze sm:px-8">
      <m.span key={role} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, ease: EASE }}>
        {role === "clinician" ? "Are you a patient? " : "Are you a clinician? "}
        <EntryLink
          href={AUTH_PATHS[other]}
          className={cn(
            "rounded-sm font-medium underline decoration-1 underline-offset-4 transition-colors hover:text-mist",
            role === "clinician" ? "text-rose-text" : "text-orchid-text",
          )}
        >
          {role === "clinician" ? "Patient sign in" : "Clinician sign in"}
        </EntryLink>
      </m.span>
    </p>
  );
}

/** Moves focus to the card's first field once it has settled, on devices with a keyboard. */
export function useFocusFirstField(container: React.RefObject<HTMLElement | null>, key: string, delay: number) {
  useEffect(() => {
    if (!window.matchMedia?.("(pointer: fine)").matches) return;
    const id = window.setTimeout(() => {
      const active = document.activeElement;
      // Never steal focus the visitor has already placed somewhere.
      if (active && active !== document.body && !container.current?.contains(active)) return;
      if (active && container.current?.contains(active)) return;
      const field = container.current?.querySelector<HTMLInputElement>("input:not([type=hidden]):not(:disabled)");
      field?.focus({ preventScroll: true });
    }, delay);
    return () => window.clearTimeout(id);
  }, [container, key, delay]);
}
